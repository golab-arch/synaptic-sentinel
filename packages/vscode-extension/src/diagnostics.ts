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
    finding.triage !== undefined
      ? ` [triage: ${triageLabel(finding.triage.classification)}]`
      : '';
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
