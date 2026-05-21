import { z } from 'zod';

/**
 * Schema de la salida JSON de Gitleaks (`gitleaks ... --report-format json`).
 *
 * La salida es un array de hallazgos. Solo se modela lo que el normalizer
 * consume; zod descarta el resto de claves. Validar la salida del scanner es
 * defensa en profundidad (v0.4 §9.6).
 */
const GitleaksFindingSchema = z.object({
  RuleID: z.string().min(1),
  Description: z.string(),
  StartLine: z.number().int(),
  EndLine: z.number().int(),
  StartColumn: z.number().int(),
  EndColumn: z.number().int(),
  /** Texto coincidente; con `--redact` el secreto aparece como `REDACTED`. */
  Match: z.string(),
  File: z.string().min(1),
  Fingerprint: z.string().min(1),
});

/** Salida de `gitleaks ... --report-format json`: un array de hallazgos. */
export const GitleaksOutputSchema = z.array(GitleaksFindingSchema);

/** Un hallazgo individual de Gitleaks. */
export type GitleaksFinding = z.infer<typeof GitleaksFindingSchema>;

/** Salida completa de Gitleaks. */
export type GitleaksOutput = z.infer<typeof GitleaksOutputSchema>;
