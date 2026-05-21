import { randomUUID } from 'node:crypto';
import { FindingSchema, type Finding, type Severity } from '@synaptic-sentinel/core';
import { relativizePath } from '../opengrep/normalizer.js';
import type { CheckovOutput, CheckovReport } from './checkov-output.js';

/** Contexto necesario para normalizar la salida de Checkov a `Finding[]`. */
export interface CheckovNormalizeContext {
  /** Scan al que pertenecen los hallazgos. */
  readonly scanId: string;
  /** Identificador del scout (`checkov`). */
  readonly scoutId: string;
  /** Raiz del proyecto, para relativizar las rutas. */
  readonly rootPath: string;
  /** Generador de marca temporal (inyectable para tests deterministas). */
  readonly now?: () => string;
  /** Generador de IDs (inyectable para tests deterministas). */
  readonly newId?: () => string;
}

/** Severidad textual de Checkov (Enterprise) → severidad de Sentinel. */
const SEVERITY_BY_CHECKOV: Readonly<Record<string, Severity>> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
};

/**
 * Mapea la severidad de un check de Checkov.
 *
 * Checkov OSS no asigna severidad (emite `null`): se asume `medium` como
 * criticidad por defecto de una misconfiguracion de IaC. El Brain Layer afina
 * la criticidad real en el contexto del proyecto.
 */
function mapSeverity(severity: string | null | undefined): Severity {
  if (severity === null || severity === undefined) return 'medium';
  return SEVERITY_BY_CHECKOV[severity.toUpperCase()] ?? 'medium';
}

/** Normaliza la salida de Checkov (objeto unico o array) a una lista de reportes. */
function toReports(output: CheckovOutput): CheckovReport[] {
  return Array.isArray(output) ? output : [output];
}

/**
 * Normaliza la salida de Checkov a la lista canonica de `Finding`.
 *
 * Cada check fallido se mapea a un `Finding` de categoria `IaC`: una
 * misconfiguracion de infraestructura como codigo (Dockerfile, Terraform,
 * Kubernetes, ...). La discriminacion fina (TP/FP, criticidad real en este
 * proyecto) la afina el Brain Layer.
 */
export function normalizeCheckovOutput(
  output: CheckovOutput,
  ctx: CheckovNormalizeContext,
): Finding[] {
  const now = ctx.now ?? ((): string => new Date().toISOString());
  const newId = ctx.newId ?? ((): string => randomUUID());
  const findings: Finding[] = [];

  for (const report of toReports(output)) {
    for (const check of report.results?.failed_checks ?? []) {
      // file_path llega relativo al directorio escaneado y con `/` inicial
      // (ej. `/Dockerfile`); se relativiza y se le quita el separador inicial.
      const relPath = relativizePath(check.file_path, ctx.rootPath).replace(/^\/+/, '');
      const path = relPath.length > 0 ? relPath : 'unknown';
      const startLine = Math.max(1, check.file_line_range?.[0] ?? 1);
      const endLine = check.file_line_range?.[1];
      const resource = check.resource ?? '';
      const title = check.check_name.length > 0 ? check.check_name : check.check_id;
      const guideline =
        check.guideline !== null && check.guideline !== undefined && check.guideline !== ''
          ? ` Guia: ${check.guideline}`
          : '';
      const finding = {
        id: newId(),
        scanId: ctx.scanId,
        scoutId: ctx.scoutId,
        severity: mapSeverity(check.severity),
        category: 'IaC',
        ruleId: check.check_id,
        title,
        message: `${title} (${check.check_id}).${guideline}`,
        location: {
          path,
          startLine,
          ...(endLine !== undefined && endLine >= startLine ? { endLine } : {}),
        },
        fingerprint: `${path}:${check.check_id}:${resource}:${String(startLine)}`,
        lifecycleState: 'new',
        createdAt: now(),
      };
      findings.push(FindingSchema.parse(finding));
    }
  }
  return findings;
}
