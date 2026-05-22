import { randomUUID } from 'node:crypto';
import { FindingSchema, type Finding, type Severity } from '@synaptic-sentinel/core';
import type { OpenGrepMetadata, OpenGrepOutput } from './opengrep-output.js';

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
    };
    // Valida y aplica defaults: el normalizer no puede emitir un Finding invalido.
    return FindingSchema.parse(finding);
  });
}
