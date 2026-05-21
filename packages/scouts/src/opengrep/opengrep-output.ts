import { z } from 'zod';

/**
 * Schema de la salida JSON de OpenGrep (`opengrep scan --json`).
 *
 * Solo se modela lo que el normalizer consume; zod descarta el resto de
 * claves. Validar la salida del scanner es defensa en profundidad: trata
 * la salida de un proceso externo como entrada no confiable (v0.4 §9.6).
 */

/** Posicion (linea/columna 1-based) dentro de un archivo. */
const OpenGrepPositionSchema = z.object({
  line: z.number().int(),
  col: z.number().int(),
  offset: z.number().int(),
});

/** Metadata de una regla OpenGrep. `cwe` y `owasp` pueden ser string o lista. */
const OpenGrepMetadataSchema = z.object({
  cwe: z.union([z.string(), z.array(z.string())]).optional(),
  owasp: z.union([z.string(), z.array(z.string())]).optional(),
});

/** Metadata de una regla OpenGrep. */
export type OpenGrepMetadata = z.infer<typeof OpenGrepMetadataSchema>;

/** Un hallazgo individual en la salida de OpenGrep. */
const OpenGrepResultSchema = z.object({
  check_id: z.string().min(1),
  path: z.string().min(1),
  start: OpenGrepPositionSchema,
  end: OpenGrepPositionSchema,
  extra: z.object({
    message: z.string(),
    severity: z.string(),
    fingerprint: z.string().min(1),
    lines: z.string().optional(),
    metadata: OpenGrepMetadataSchema.optional(),
  }),
});

/** Salida completa de `opengrep scan --json`. */
export const OpenGrepOutputSchema = z.object({
  version: z.string().optional(),
  results: z.array(OpenGrepResultSchema),
  errors: z.array(z.unknown()).default([]),
});

/** Salida completa de OpenGrep. */
export type OpenGrepOutput = z.infer<typeof OpenGrepOutputSchema>;

/** Un hallazgo individual de OpenGrep. */
export type OpenGrepResult = z.infer<typeof OpenGrepResultSchema>;
