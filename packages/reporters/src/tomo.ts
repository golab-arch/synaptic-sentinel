import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ContextExplanationSchema,
  FindingSchema,
  ScoutStatusSchema,
  TriageVerdictSchema,
  type ContextExplanationRecord,
  type Finding,
  type ScanOutcome,
  type TriageVerdictRecord,
} from '@synaptic-sentinel/core';

/** Metadata del tomo (v0.4 §4.2). */
const TomoMetadataSchema = z.object({
  tomoId: z.string().uuid(),
  /** Huella estable del proyecto del cliente — "biblioteca" (v0.4 §4.1). */
  bibliotecaId: z.string().min(1),
  sentinelVersion: z.string().min(1),
  publishedAt: z.string().datetime(),
  gitSha: z.string().min(1).optional(),
  scope: z.object({ rootPath: z.string().min(1) }),
});

/**
 * Resumen ejecutivo determinista del tomo: conteos por severidad y categoria.
 * El `posture_score` y los deltas del v0.4 §4.2 los agrega el Brain Layer.
 */
const TomoSummarySchema = z.object({
  scanId: z.string().min(1),
  status: z.enum(['ok', 'degraded']),
  totalFindings: z.number().int().nonnegative(),
  /** Hallazgos descartados en stage 2 del Coordinator (dedup + fp_known). */
  suppressedCount: z.number().int().nonnegative(),
  bySeverity: z.record(z.number().int().nonnegative()),
  byCategory: z.record(z.number().int().nonnegative()),
  /** Conteo de hallazgos por clasificacion de triage (vacio si no hubo triage). */
  byTriage: z.record(z.number().int().nonnegative()),
});

/** Metodologia: scouts ejecutados y ventana temporal del scan. */
const TomoMethodologySchema = z.object({
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  scouts: z.array(
    z.object({
      scoutId: z.string().min(1),
      status: ScoutStatusSchema,
      findings: z.number().int().nonnegative(),
      error: z.string().min(1).optional(),
    }),
  ),
});

/**
 * Hallazgo del tomo: el `Finding` determinista mas el enriquecimiento del
 * Brain Layer — el veredicto de triage y la explicacion de contexto, cada
 * uno presente solo si el agente correspondiente proceso el hallazgo.
 */
export const TomoFindingSchema = FindingSchema.extend({
  triage: TriageVerdictSchema.optional(),
  context: ContextExplanationSchema.optional(),
});

/** Hallazgo del tomo (Finding + triage opcional). */
export type TomoFinding = z.infer<typeof TomoFindingSchema>;

/** Cuerpo del tomo: todo menos la firma de integridad. */
export const TomoBodySchema = z.object({
  metadata: TomoMetadataSchema,
  summary: TomoSummarySchema,
  findings: z.array(TomoFindingSchema),
  methodology: TomoMethodologySchema,
});

/** Firma de integridad del tomo — SHA-256, en todos los tiers (v0.4 §4.2). */
const TomoIntegritySchema = z.object({
  algorithm: z.literal('sha256'),
  hash: z.string().length(64),
});

/** Tomo completo: una auditoria publicada (v0.4 §4.1). */
export const TomoSchema = TomoBodySchema.extend({ integrity: TomoIntegritySchema });

/** Cuerpo del tomo, sin la firma de integridad. */
export type TomoBody = z.infer<typeof TomoBodySchema>;

/** Tomo completo. */
export type Tomo = z.infer<typeof TomoSchema>;

/** Forma canonica de un valor: claves de objeto ordenadas recursivamente. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

/** Hash SHA-256 (hex) de la forma canonica de un valor — determinista. */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

/** Metadata de entrada para construir un tomo. */
export interface TomoMetadataInput {
  readonly rootPath: string;
  readonly sentinelVersion: string;
  readonly gitSha?: string;
}

/** Enriquecimiento del Brain Layer con que se construye el tomo. */
export interface TomoEnrichment {
  /** Veredictos de triage a unir con los hallazgos por `fingerprint`. */
  readonly triageVerdicts?: readonly TriageVerdictRecord[];
  /** Explicaciones de contexto a unir con los hallazgos por `fingerprint`. */
  readonly contextExplanations?: readonly ContextExplanationRecord[];
}

/**
 * Construye un tomo a partir del resultado de un scan y sus hallazgos.
 *
 * Si se pasa `enrichment`, cada hallazgo se une por `fingerprint` con su
 * veredicto de triage y su explicacion de contexto (el registro mas reciente
 * gana). El resumen es determinista (conteos); incluye una firma SHA-256
 * sobre la forma canonica del cuerpo, como evidencia de no-manipulacion.
 */
export function buildTomo(
  outcome: ScanOutcome,
  findings: readonly Finding[],
  meta: TomoMetadataInput,
  enrichment: TomoEnrichment = {},
): Tomo {
  // Join por fingerprint (el registro mas reciente gana, orden de entrada).
  const triageByFingerprint = new Map<string, TriageVerdictRecord>();
  for (const verdict of enrichment.triageVerdicts ?? []) {
    triageByFingerprint.set(verdict.fingerprint, verdict);
  }
  const contextByFingerprint = new Map<string, ContextExplanationRecord>();
  for (const explanation of enrichment.contextExplanations ?? []) {
    contextByFingerprint.set(explanation.fingerprint, explanation);
  }

  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byTriage: Record<string, number> = {};
  const tomoFindings = findings.map((finding) => {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
    byCategory[finding.category] = (byCategory[finding.category] ?? 0) + 1;
    const verdict = triageByFingerprint.get(finding.fingerprint);
    const explanation = contextByFingerprint.get(finding.fingerprint);
    if (verdict !== undefined) {
      byTriage[verdict.classification] = (byTriage[verdict.classification] ?? 0) + 1;
    }
    return {
      ...finding,
      ...(verdict !== undefined
        ? {
            triage: {
              classification: verdict.classification,
              confidence: verdict.confidence,
              rationale: verdict.rationale,
            },
          }
        : {}),
      ...(explanation !== undefined
        ? {
            context: {
              summary: explanation.summary,
              entryPoint: explanation.entryPoint,
              sink: explanation.sink,
              exposure: explanation.exposure,
            },
          }
        : {}),
    };
  });

  const body = TomoBodySchema.parse({
    metadata: {
      tomoId: randomUUID(),
      bibliotecaId: canonicalHash(meta.rootPath).slice(0, 16),
      sentinelVersion: meta.sentinelVersion,
      publishedAt: new Date().toISOString(),
      ...(meta.gitSha !== undefined ? { gitSha: meta.gitSha } : {}),
      scope: { rootPath: meta.rootPath },
    },
    summary: {
      scanId: outcome.scanId,
      status: outcome.status,
      totalFindings: findings.length,
      suppressedCount: outcome.suppressedCount,
      bySeverity,
      byCategory,
      byTriage,
    },
    findings: tomoFindings,
    methodology: {
      startedAt: outcome.startedAt,
      finishedAt: outcome.finishedAt,
      scouts: outcome.scouts.map((scout) => ({
        scoutId: scout.scoutId,
        status: scout.status,
        findings: scout.findings,
        ...(scout.error !== undefined ? { error: scout.error } : {}),
      })),
    },
  });

  return TomoSchema.parse({
    ...body,
    integrity: { algorithm: 'sha256', hash: canonicalHash(body) },
  });
}

/** Verifica que la firma de integridad del tomo coincida con su contenido. */
export function verifyTomoIntegrity(tomo: Tomo): boolean {
  const { integrity, ...body } = tomo;
  return integrity.hash === canonicalHash(body);
}
