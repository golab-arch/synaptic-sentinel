import { z } from 'zod';

/**
 * Sugerencia de remediacion de un hallazgo — la salida del Remediation Agent.
 *
 * Describe como corregir el hallazgo: un resumen, los pasos concretos de
 * remediacion y, cuando aplica un cambio de codigo puntual, un fragmento
 * corregido orientativo (v0.4 §3.6 — Remediation Agent). Vive en `core`
 * junto a los demas tipos compartidos; lo produce la capa Cerebro
 * (`@synaptic-sentinel/agents`).
 *
 * La respuesta del LLM es entrada no confiable: se valida con este schema
 * antes de usarse (defensa en profundidad anti Memory Poisoning, v0.4 §9.6).
 */
export const RemediationSuggestionSchema = z.object({
  /** Resumen en una frase de la remediacion propuesta. */
  summary: z.string().min(1),
  /** Pasos concretos para remediar el hallazgo. */
  recommendation: z.string().min(1),
  /**
   * Fragmento de codigo corregido orientativo. Opcional: muchas remediaciones
   * son de configuracion o de proceso (rotar un secreto, quitar una
   * dependencia) y no tienen un snippet de codigo asociado.
   */
  fixedSnippet: z.string().min(1).optional(),
});

/** Sugerencia de remediacion de un hallazgo. */
export type RemediationSuggestion = z.infer<typeof RemediationSuggestionSchema>;

/** Sugerencia de remediacion persistida en la colony DB, con su trazabilidad. */
export const RemediationSuggestionRecordSchema = RemediationSuggestionSchema.extend({
  /** Identificador unico del registro (UUID). */
  id: z.string().uuid(),
  /** Scan al que pertenece el hallazgo remediado. */
  scanId: z.string().min(1),
  /** Huella estable del hallazgo remediado (`Finding.fingerprint`). */
  fingerprint: z.string().min(1),
  /** Agente que emitio la sugerencia — trazabilidad (OWASP ASI 2026). */
  agentId: z.string().min(1),
  /** Marca temporal de creacion (ISO-8601). */
  createdAt: z.string().datetime(),
});

/** Sugerencia de remediacion persistida. */
export type RemediationSuggestionRecord = z.infer<typeof RemediationSuggestionRecordSchema>;
