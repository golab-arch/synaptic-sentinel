import { z } from 'zod';

/** Tipos de feromona digital de la colony DB (v0.4 §3.5). */
export const PHEROMONE_TYPES = [
  'finding',
  'context',
  'hypothesis',
  'exploration_marker',
  'fp_known',
] as const;

/** Schema de validacion para el tipo de feromona. */
export const PheromoneTypeSchema = z.enum(PHEROMONE_TYPES);

/** Tipo de una feromona digital. */
export type PheromoneType = z.infer<typeof PheromoneTypeSchema>;

/**
 * Feromona digital — unidad de memoria compartida del enjambre.
 *
 * Se persiste en la tabla `pheromones` de la colony DB. El `payload` concreto
 * se valida con un schema especifico segun el `type` antes de insertar, como
 * defensa en profundidad contra Memory Poisoning (v0.4 §9.6); `agentId` y
 * `scanId` dan trazabilidad (OWASP ASI 2026).
 */
export const PheromoneSchema = z.object({
  /** Identificador unico de la feromona (UUID). */
  id: z.string().uuid(),
  /** Tipo de feromona. */
  type: PheromoneTypeSchema,
  /** Agente que deposito la feromona — trazabilidad. */
  agentId: z.string().min(1),
  /** Scan en el que se deposito. */
  scanId: z.string().min(1),
  /** Ruta objetivo, si la feromona esta asociada a un archivo. */
  targetPath: z.string().min(1).nullable().optional(),
  /** Carga util (objeto JSON) — validada por tipo aguas arriba. */
  payload: z.record(z.unknown()),
  /** Confianza en el rango 0..1, si aplica. */
  confidence: z.number().min(0).max(1).nullable().optional(),
  /** Tasa de decaimiento temporal en el rango 0..1. */
  decayRate: z.number().min(0).max(1).default(0.1),
  /** Marca temporal de creacion (ISO-8601). */
  createdAt: z.string().datetime(),
  /** Expiracion (ISO-8601), si la feromona caduca. */
  expiresAt: z.string().datetime().nullable().optional(),
});

/** Feromona digital. */
export type Pheromone = z.infer<typeof PheromoneSchema>;
