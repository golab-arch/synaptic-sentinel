import { randomUUID } from 'node:crypto';
import {
  FindingSchema,
  type DataflowStep,
  type DataflowTrace,
  type Finding,
  type Severity,
} from '@synaptic-sentinel/core';
import type { DataflowTraceRaw, OpenGrepMetadata, OpenGrepOutput } from './opengrep-output.js';

/** Mapea la severidad de OpenGrep (INFO/WARNING/ERROR...) a la de Sentinel. */
const SEVERITY_MAP: Readonly<Record<string, Severity>> = {
  CRITICAL: 'critical',
  ERROR: 'high',
  HIGH: 'high',
  WARNING: 'medium',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
};

/** Traduce una severidad de OpenGrep; las desconocidas caen a `info`. */
export function mapSeverity(opengrepSeverity: string): Severity {
  return SEVERITY_MAP[opengrepSeverity.toUpperCase()] ?? 'info';
}

/** Normaliza `string | string[] | undefined` a un array. */
function toArray(value: string | string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

/**
 * Extrae referencias de cumplimiento (ej. `CWE-95`, `OWASP-A03`) desde la
 * metadata de una regla OpenGrep. El Compliance Mapper amplia el mapeo aguas
 * abajo; aqui solo se recogen las referencias crudas del scanner.
 */
export function extractComplianceRefs(metadata: OpenGrepMetadata | undefined): string[] {
  if (!metadata) return [];
  const refs: string[] = [];
  for (const entry of toArray(metadata.cwe)) {
    const code = /CWE-\d+/i.exec(entry)?.[0];
    if (code) refs.push(code.toUpperCase());
  }
  for (const entry of toArray(metadata.owasp)) {
    const code = /A\d+/i.exec(entry)?.[0];
    if (code) refs.push(`OWASP-${code.toUpperCase()}`);
  }
  return [...new Set(refs)];
}

/**
 * Convierte una ruta absoluta en relativa a `rootPath`, normalizada con
 * separador `/` (v0.4 §3.9). Operacion puramente de string para ser
 * determinista independientemente del sistema operativo.
 */
export function relativizePath(absolutePath: string, rootPath: string): string {
  const toPosix = (p: string): string => p.replace(/\\/g, '/');
  const file = toPosix(absolutePath);
  const root = toPosix(rootPath).replace(/\/+$/, '');
  if (root.length > 0 && file.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return file.slice(root.length + 1);
  }
  return file;
}

/**
 * Id canonico de una regla: el ultimo segmento del `check_id`.
 *
 * Cuando se corre OpenGrep con `--config <archivo>`, el `check_id` viene
 * prefijado con los segmentos de la ruta de ese archivo (p. ej.
 * `d.tmp.probe.js-eval-usage`). El id real de la regla — el campo `id` del
 * ruleset, en kebab-case plano — es el ultimo segmento. Normalizarlo da un
 * `ruleId` estable, independiente de donde viva el archivo de reglas, y un
 * `patternSignature` consistente para la memoria del enjambre (FI-005).
 */
export function canonicalRuleId(checkId: string): string {
  const segments = checkId.split('.');
  return segments[segments.length - 1] ?? checkId;
}

/**
 * Construye un `DataflowStep` canonico desde un location + content crudos
 * (DG-112 A Step 3). Relativiza el path con `relativizePath` para
 * coherencia con `FindingLocation.path` y normaliza `\` → `/`.
 */
function buildDataflowStep(
  loc: { path: string; start: { line: number } },
  content: string,
  rootPath: string,
): DataflowStep {
  return {
    path: relativizePath(loc.path, rootPath),
    startLine: loc.start.line,
    content,
  };
}

/**
 * Convierte el `dataflow_trace` crudo de OpenGrep a la forma canonica
 * `DataflowTrace` del Finding (DG-112 A Step 3 — §4 #3 del reporte).
 *
 * Desempaqueta el wrapper `["CliLoc", [location, content]]` de source y
 * sink (el tag interno se descarta). Devuelve `undefined` si source o
 * sink faltan — un trace incompleto NO se canoniza (defensive: el
 * TriageAgent espera siempre source + sink + intermediateSteps); el
 * Finding queda sin `dataflowTrace` y el TriageAgent omite la seccion
 * del prompt.
 */
export function normalizeDataflowTrace(
  raw: DataflowTraceRaw,
  rootPath: string,
): DataflowTrace | undefined {
  if (!raw.taint_source || !raw.taint_sink) return undefined;
  const [, [srcLoc, srcContent]] = raw.taint_source;
  const [, [sinkLoc, sinkContent]] = raw.taint_sink;
  return {
    source: buildDataflowStep(srcLoc, srcContent, rootPath),
    intermediateSteps: (raw.intermediate_vars ?? []).map((iv) =>
      buildDataflowStep(iv.location, iv.content, rootPath),
    ),
    sink: buildDataflowStep(sinkLoc, sinkContent, rootPath),
  };
}

/** Contexto necesario para normalizar la salida de OpenGrep a `Finding[]`. */
export interface NormalizeContext {
  /** Scan al que pertenecen los hallazgos. */
  readonly scanId: string;
  /** Identificador del scout (`opengrep`). */
  readonly scoutId: string;
  /** Raiz del proyecto, para relativizar las rutas. */
  readonly rootPath: string;
  /** Generador de marca temporal (inyectable para tests deterministas). */
  readonly now?: () => string;
  /** Generador de IDs (inyectable para tests deterministas). */
  readonly newId?: () => string;
}

/** Normaliza la salida de OpenGrep a la lista canonica de `Finding`. */
export function normalizeOpenGrepOutput(output: OpenGrepOutput, ctx: NormalizeContext): Finding[] {
  const now = ctx.now ?? ((): string => new Date().toISOString());
  const newId = ctx.newId ?? ((): string => randomUUID());

  return output.results.map((result): Finding => {
    const snippet = result.extra.lines?.trim();
    // FI-005: el ruleId canonico (ultimo segmento del check_id) es estable
    // independientemente de la ruta del archivo de reglas.
    const ruleId = canonicalRuleId(result.check_id);
    // DG-112 A Step 3: canoniza el dataflow trace si la regla es mode:taint.
    const dataflowTrace =
      result.extra.dataflow_trace !== undefined
        ? normalizeDataflowTrace(result.extra.dataflow_trace, ctx.rootPath)
        : undefined;
    const finding = {
      id: newId(),
      scanId: ctx.scanId,
      scoutId: ctx.scoutId,
      severity: mapSeverity(result.extra.severity),
      category: 'SAST',
      ruleId,
      title: ruleId,
      message: result.extra.message,
      location: {
        path: relativizePath(result.path, ctx.rootPath),
        startLine: result.start.line,
        endLine: result.end.line,
        startColumn: result.start.col,
        endColumn: result.end.col,
        ...(snippet !== undefined && snippet.length > 0 ? { snippet } : {}),
      },
      complianceRefs: extractComplianceRefs(result.extra.metadata),
      fingerprint: result.extra.fingerprint,
      lifecycleState: 'new',
      createdAt: now(),
      ...(dataflowTrace !== undefined ? { dataflowTrace } : {}),
    };
    // Valida y aplica defaults: el normalizer no puede emitir un Finding invalido.
    return FindingSchema.parse(finding);
  });
}
