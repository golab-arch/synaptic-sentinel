import { z } from 'zod';

/** Clasificaciones de triage de un hallazgo (v0.4 §3.6: TP / FP / inconcluso). */
export const TRIAGE_CLASSIFICATIONS = ['true_positive', 'false_positive', 'inconclusive'] as const;

/** Schema de validacion de la clasificacion de triage. */
export const TriageClassificationSchema = z.enum(TRIAGE_CLASSIFICATIONS);

/** Clasificacion de triage de un hallazgo. */
export type TriageClassification = z.infer<typeof TriageClassificationSchema>;

/**
 * Veredicto de triage sobre un hallazgo — la salida del Triage Agent.
 *
 * Vive en `core` porque se persiste en la colony DB; lo produce la capa
 * Cerebro (`@synaptic-sentinel/agents`). La respuesta del LLM es entrada no
 * confiable: se valida con este schema (anti Memory Poisoning, v0.4 §9.6).
 */
export const TriageVerdictSchema = z.object({
  classification: TriageClassificationSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

/** Veredicto de triage. */
export type TriageVerdict = z.infer<typeof TriageVerdictSchema>;

/** Veredicto de triage persistido en la colony DB, con su trazabilidad. */
export const TriageVerdictRecordSchema = TriageVerdictSchema.extend({
  /** Identificador unico del registro (UUID). */
  id: z.string().uuid(),
  /** Scan al que pertenece el hallazgo triado. */
  scanId: z.string().min(1),
  /** Huella estable del hallazgo triado (`Finding.fingerprint`). */
  fingerprint: z.string().min(1),
  /** Agente que emitio el veredicto — trazabilidad (OWASP ASI 2026). */
  agentId: z.string().min(1),
  /** Marca temporal de creacion (ISO-8601). */
  createdAt: z.string().datetime(),
});

/** Veredicto de triage persistido. */
export type TriageVerdictRecord = z.infer<typeof TriageVerdictRecordSchema>;

/**
 * Registro de historia de veredictos append-only (DG-130 A, FASE III).
 *
 * Se persiste en la tabla `verdict_history` de la colony DB para preservar
 * TODOS los veredictos emitidos cross-scan — incluso los que fueron
 * reemplazados por re-triage. Habilita:
 *  - Section "Previously (N prior verdicts)" en el sidebar
 *  - Banner "Verdict changed since last scan" con delta rationale
 *  - Diff-aware line post scan
 *
 * DIFERENCIA con {@link TriageVerdictRecord}: este record incluye
 * `providerLabel` (necesario para el banner heurístico "same/different
 * provider changed"). El schema es aditivo — extiende TriageVerdictRecordSchema.
 */
export const TriageVerdictHistoryRecordSchema = TriageVerdictRecordSchema.extend({
  /** Label "<provider>/<model>" o "colony-memory" (si el veredicto vino del enjambre). */
  providerLabel: z.string().min(1),
});

/** Registro de historia de veredictos (append-only cross-scan). */
export type TriageVerdictHistoryRecord = z.infer<typeof TriageVerdictHistoryRecordSchema>;
