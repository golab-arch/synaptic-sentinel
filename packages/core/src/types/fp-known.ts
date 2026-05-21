import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pheromone } from './pheromone.js';

/**
 * Carga util de una feromona `fp_known`.
 *
 * Marca el `fingerprint` de un hallazgo como falso positivo confirmado, para
 * que el Coordinator (stage 2) lo suprima en los scans siguientes. El schema
 * pinea el contrato del `payload` — defensa en profundidad contra Memory
 * Poisoning (v0.4 §9.6): cualquier `fp_known` se valida antes de insertarse.
 */
export const FpKnownPayloadSchema = z.object({
  /** Huella estable del hallazgo descartado (`Finding.fingerprint`). */
  fingerprint: z.string().min(1),
  /** Motivo del descarte, si se registro. */
  reason: z.string().min(1).optional(),
  /** Marca temporal en que se confirmo el falso positivo (ISO-8601). */
  markedAt: z.string().datetime(),
});

/** Carga util de una feromona `fp_known`. */
export type FpKnownPayload = z.infer<typeof FpKnownPayloadSchema>;

/** Datos para marcar un `fingerprint` como falso positivo. */
export interface MarkFalsePositiveInput {
  /** Scan desde el que se confirma el falso positivo (trazabilidad). */
  readonly scanId: string;
  /** Agente que confirma el descarte (trazabilidad, OWASP ASI 2026). */
  readonly agentId: string;
  /** Huella estable del hallazgo a descartar. */
  readonly fingerprint: string;
  /** Motivo del descarte, opcional. */
  readonly reason?: string;
  /** Ruta del archivo afectado, si se conoce. */
  readonly targetPath?: string;
}

/**
 * Construye una feromona `fp_known` validada.
 *
 * Es la via canonica para registrar un falso positivo en la colony DB; el
 * Coordinator (stage 2) suprime los hallazgos cuyo `fingerprint` tenga una
 * feromona `fp_known`. Un falso positivo confirmado no decae (`decayRate` 0).
 */
export function buildFpKnownPheromone(input: MarkFalsePositiveInput): Pheromone {
  const markedAt = new Date().toISOString();
  const payload = FpKnownPayloadSchema.parse({
    fingerprint: input.fingerprint,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    markedAt,
  });
  return {
    id: randomUUID(),
    type: 'fp_known',
    agentId: input.agentId,
    scanId: input.scanId,
    ...(input.targetPath !== undefined ? { targetPath: input.targetPath } : {}),
    payload,
    decayRate: 0,
    createdAt: markedAt,
  };
}
