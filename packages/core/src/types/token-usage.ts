import { z } from 'zod';

/**
 * Registro de tokens consumidos + costo USD estimado de UNA llamada del
 * Brain Layer a un LLM provider (DG-078 B).
 *
 * Persistido en la tabla aditiva `triage_token_usage` (schema v5). Cada
 * fila representa una sola invocación de un agente (Triage / Context /
 * Remediation) contra un provider concreto sobre un finding concreto.
 *
 * Las cifras de tokens son **proxies** (heurística `chars/4`, ver
 * `proxyTokenCount`). El cost USD estimate puede divergir ±15-20% del cost
 * real facturado por el provider — caveat documentado en el summary del
 * comando `triage`.
 */
export const TokenUsageRecordSchema = z.object({
  /** Identificador unico del registro (UUID). */
  id: z.string().uuid(),
  /** Sesion de triage a la que pertenece (UUID que agrupa todos los agent calls de UNA invocación CLI). */
  triageSessionId: z.string().uuid(),
  /** Scan asociado al finding triado. */
  scanId: z.string().min(1),
  /** Identificador estable del finding (`Finding.fingerprint`). */
  fingerprint: z.string().min(1),
  /** Etiqueta `<provider>/<model>` (ej. `anthropic/claude-haiku-4-5-20251001`). */
  providerLabel: z.string().min(1),
  /** Agente del Brain Layer que emitió el call. */
  agentId: z.enum(['triage', 'context', 'remediation']),
  /** Tokens de input (system + user prompt) — proxy `chars/4`. */
  inputTokens: z.number().int().nonnegative(),
  /** Tokens de output (raw response del LLM) — proxy `chars/4`. */
  outputTokens: z.number().int().nonnegative(),
  /** Cost USD estimado de esta sola call. */
  estimatedCostUsd: z.number().nonnegative(),
  /** Latencia end-to-end de la call (ms). */
  latencyMs: z.number().int().nonnegative(),
  /** Marca temporal ISO-8601 de la call. */
  createdAt: z.string().datetime(),
});

/** Registro de uso de tokens persistido. */
export type TokenUsageRecord = z.infer<typeof TokenUsageRecordSchema>;

/**
 * Rollup de costo por `{provider, model, agent}` — output del comando
 * `cost-history`. Sin scan_id/fingerprint, agrega across sesiones.
 */
export interface CostHistoryRow {
  readonly providerLabel: string;
  readonly agentId: 'triage' | 'context' | 'remediation';
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  /** Latencia promedio (ms) sobre los `calls` registros. */
  readonly avgLatencyMs: number;
}
