import { z } from 'zod';

/**
 * Explicacion contextualizada de un hallazgo — la salida del Context Agent.
 *
 * Describe la cadena de explotabilidad: de donde viene la entrada no
 * confiable, en que operacion peligrosa termina, y que se expone si se
 * explota (v0.4 §3.6). Vive en `core` junto a los demas tipos de datos
 * compartidos; lo produce la capa Cerebro (`@synaptic-sentinel/agents`).
 *
 * La respuesta del LLM es entrada no confiable: se valida con este schema
 * antes de usarse (defensa en profundidad anti Memory Poisoning, v0.4 §9.6).
 */
export const ContextExplanationSchema = z.object({
  /** Resumen en una frase. */
  summary: z.string().min(1),
  /** De donde proviene la entrada no confiable (entry point). */
  entryPoint: z.string().min(1),
  /** La operacion peligrosa donde termina el flujo (sink). */
  sink: z.string().min(1),
  /** Que se expone o se logra si el hallazgo se explota. */
  exposure: z.string().min(1),
});

/** Explicacion contextualizada de un hallazgo. */
export type ContextExplanation = z.infer<typeof ContextExplanationSchema>;

/** Explicacion de contexto persistida en la colony DB, con su trazabilidad. */
export const ContextExplanationRecordSchema = ContextExplanationSchema.extend({
  /** Identificador unico del registro (UUID). */
  id: z.string().uuid(),
  /** Scan al que pertenece el hallazgo explicado. */
  scanId: z.string().min(1),
  /** Huella estable del hallazgo explicado (`Finding.fingerprint`). */
  fingerprint: z.string().min(1),
  /** Agente que emitio la explicacion — trazabilidad (OWASP ASI 2026). */
  agentId: z.string().min(1),
  /** Marca temporal de creacion (ISO-8601). */
  createdAt: z.string().datetime(),
});

/** Explicacion de contexto persistida. */
export type ContextExplanationRecord = z.infer<typeof ContextExplanationRecordSchema>;
