import { join } from 'node:path';
import type { ExtensionFinding } from './tomo.js';

/** Nivel de diagnostico, agnostico de la API de VSCode. */
export type DiagnosticLevel = 'error' | 'warning' | 'info';

/**
 * Diagnostico en forma agnostica de VSCode: la capa `index.ts` lo convierte
 * en un `vscode.Diagnostic`. Las lineas y columnas son 1-based (como en el
 * Finding); la conversion a 0-based ocurre en la capa VSCode.
 */
export interface DiagnosticInput {
  readonly path: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly message: string;
  readonly level: DiagnosticLevel;
  readonly ruleId: string;
  readonly fingerprint: string;
}

/** Mapea la severidad de Sentinel al nivel de diagnostico de VSCode. */
const LEVEL_BY_SEVERITY: Readonly<Record<string, DiagnosticLevel>> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
  info: 'info',
};

/** Nivel de diagnostico para una severidad; `warning` si es desconocida. */
export function diagnosticLevelForSeverity(severity: string): DiagnosticLevel {
  return LEVEL_BY_SEVERITY[severity] ?? 'warning';
}

/** Etiqueta legible de una clasificacion de triage. */
export function triageLabel(classification: string): string {
  if (classification === 'true_positive') return 'verdadero positivo';
  if (classification === 'false_positive') return 'falso positivo';
  if (classification === 'inconclusive') return 'inconcluso';
  return classification;
}

/** Convierte un hallazgo en un `DiagnosticInput` agnostico de VSCode. */
export function findingToDiagnosticInput(finding: ExtensionFinding): DiagnosticInput {
  const loc = finding.location;
  const startColumn = loc.startColumn ?? 1;
  const lifecycle = finding.lifecycleState !== 'new' ? ` (${finding.lifecycleState})` : '';
  const triage =
    finding.triage !== undefined ? ` [triage: ${triageLabel(finding.triage.classification)}]` : '';
  return {
    path: loc.path,
    startLine: loc.startLine,
    startColumn,
    endLine: loc.endLine ?? loc.startLine,
    endColumn: loc.endColumn ?? startColumn,
    message: `${finding.title}${lifecycle}: ${finding.message}${triage}`,
    level: diagnosticLevelForSeverity(finding.severity),
    ruleId: finding.ruleId,
    fingerprint: finding.fingerprint,
  };
}

/**
 * Construye el contenido Markdown del hover de un hallazgo: severidad, regla
 * y -si el Brain Layer los produjo- el veredicto de triage, la cadena de
 * contexto (entrada -> sink -> exposicion) y la sugerencia de remediacion.
 *
 * Funcion pura (sin la API de VSCode): la capa `index.ts` la envuelve en un
 * `vscode.MarkdownString`. Asi es testeable de forma directa.
 */
export function findingHoverMarkdown(finding: ExtensionFinding): string {
  const lines: string[] = [
    `**Synaptic Sentinel** — ${finding.title}`,
    '',
    `Severidad: \`${finding.severity}\` · Categoria: \`${finding.category}\` · ` +
      `Regla: \`${finding.ruleId}\``,
  ];
  const triage = finding.triage;
  if (triage !== undefined) {
    lines.push(
      '',
      `**Triage:** ${triageLabel(triage.classification)} ` +
        `(confianza ${triage.confidence.toFixed(2)}) — ${triage.rationale}`,
    );
  }
  const context = finding.context;
  if (context !== undefined) {
    lines.push(
      '',
      `**Contexto:** ${context.summary}`,
      `- Entrada: ${context.entryPoint}`,
      `- Sink: ${context.sink}`,
      `- Exposicion: ${context.exposure}`,
    );
  }
  const remediation = finding.remediation;
  if (remediation !== undefined) {
    lines.push('', `**Remediacion:** ${remediation.summary}`, '', remediation.recommendation);
    if (remediation.fixedSnippet !== undefined) {
      lines.push('', '```', remediation.fixedSnippet, '```');
    }
  }
  return lines.join('\n');
}

/**
 * Texto plano de la remediacion de un hallazgo, para copiar al portapapeles.
 * Devuelve `undefined` si el hallazgo no tiene sugerencia de remediacion.
 */
export function remediationClipboardText(finding: ExtensionFinding): string | undefined {
  const remediation = finding.remediation;
  if (remediation === undefined) return undefined;
  const loc = `${finding.location.path}:${String(finding.location.startLine)}`;
  const parts = [
    'Remediacion sugerida por Synaptic Sentinel',
    `Hallazgo: ${finding.title} (${loc})`,
    '',
    remediation.summary,
    '',
    remediation.recommendation,
  ];
  if (remediation.fixedSnippet !== undefined) {
    parts.push('', 'Codigo sugerido:', remediation.fixedSnippet);
  }
  return parts.join('\n');
}

/** Agrupa una lista de `DiagnosticInput` por ruta de archivo. */
export function groupDiagnosticsByPath(
  inputs: readonly DiagnosticInput[],
): Map<string, DiagnosticInput[]> {
  const byPath = new Map<string, DiagnosticInput[]>();
  for (const input of inputs) {
    const bucket = byPath.get(input.path);
    if (bucket !== undefined) bucket.push(input);
    else byPath.set(input.path, [input]);
  }
  return byPath;
}

/**
 * Devuelve los hallazgos que caen en `documentFsPath` dentro del rango de
 * lineas `[startLine0, endLine0]` (0-based, como `vscode.Range`).
 *
 * Alimenta el Code Action "marcar falso positivo": dado el cursor/seleccion
 * del usuario, encuentra los hallazgos de Sentinel en esa(s) linea(s).
 */
export function findingsInRange(
  findings: readonly ExtensionFinding[],
  workspacePath: string,
  documentFsPath: string,
  startLine0: number,
  endLine0: number,
): ExtensionFinding[] {
  return findings.filter((finding) => {
    if (join(workspacePath, finding.location.path) !== documentFsPath) return false;
    const line0 = finding.location.startLine - 1;
    return line0 >= startLine0 && line0 <= endLine0;
  });
}
