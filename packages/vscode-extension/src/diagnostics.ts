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

/** Convierte un hallazgo en un `DiagnosticInput` agnostico de VSCode. */
export function findingToDiagnosticInput(finding: ExtensionFinding): DiagnosticInput {
  const loc = finding.location;
  const startColumn = loc.startColumn ?? 1;
  const lifecycle = finding.lifecycleState !== 'new' ? ` (${finding.lifecycleState})` : '';
  return {
    path: loc.path,
    startLine: loc.startLine,
    startColumn,
    endLine: loc.endLine ?? loc.startLine,
    endColumn: loc.endColumn ?? startColumn,
    message: `${finding.title}${lifecycle}: ${finding.message}`,
    level: diagnosticLevelForSeverity(finding.severity),
    ruleId: finding.ruleId,
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
