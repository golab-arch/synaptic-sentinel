import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  FindingSchema,
  ScoutStatusSchema,
  type Finding,
  type ScanOutcome,
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
  bySeverity: z.record(z.number().int().nonnegative()),
  byCategory: z.record(z.number().int().nonnegative()),
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

/** Cuerpo del tomo: todo menos la firma de integridad. */
export const TomoBodySchema = z.object({
  metadata: TomoMetadataSchema,
  summary: TomoSummarySchema,
  findings: z.array(FindingSchema),
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

/**
 * Construye un tomo a partir del resultado de un scan y sus hallazgos.
 *
 * El resumen es determinista (conteos); el enriquecimiento del Brain Layer
 * (posture score, explicaciones, mapeo de cumplimiento) se agrega aguas
 * abajo. Incluye una firma SHA-256 sobre la forma canonica del cuerpo, como
 * evidencia de no-manipulacion.
 */
export function buildTomo(
  outcome: ScanOutcome,
  findings: readonly Finding[],
  meta: TomoMetadataInput,
): Tomo {
  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const finding of findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
    byCategory[finding.category] = (byCategory[finding.category] ?? 0) + 1;
  }

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
      bySeverity,
      byCategory,
    },
    findings: [...findings],
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
