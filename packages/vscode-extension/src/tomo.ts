import { z } from 'zod';

/** Severidad de un hallazgo (subconjunto del contrato del tomo). */
const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);

/** Ubicacion de un hallazgo dentro del codigo del cliente. */
const FindingLocationSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  startColumn: z.number().int().positive().optional(),
  endColumn: z.number().int().positive().optional(),
  snippet: z.string().optional(),
});

/** Hallazgo, en la forma minima que consume la extension. */
const ExtensionFindingSchema = z.object({
  severity: SeveritySchema,
  category: z.string().min(1),
  ruleId: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  location: FindingLocationSchema,
  lifecycleState: z.string().min(1).default('new'),
});

/**
 * Schema minimo del tomo exportado por la CLI.
 *
 * Solo valida el subconjunto que la extension necesita para pintar
 * diagnostics; los demas campos del tomo (metadata, integrity, ...) se
 * ignoran. El tomo es la frontera de contrato entre la CLI y la extension
 * (DG-021 A: la extension no importa los paquetes del motor).
 */
export const ExtensionTomoSchema = z.object({
  summary: z.object({
    scanId: z.string().min(1),
    status: z.enum(['ok', 'degraded']),
    totalFindings: z.number().int().nonnegative(),
  }),
  findings: z.array(ExtensionFindingSchema),
});

/** Tomo en la forma que consume la extension. */
export type ExtensionTomo = z.infer<typeof ExtensionTomoSchema>;

/** Hallazgo en la forma que consume la extension. */
export type ExtensionFinding = z.infer<typeof ExtensionFindingSchema>;

/** Valida y parsea el JSON de un tomo. Lanza si no cumple el contrato minimo. */
export function parseTomo(raw: unknown): ExtensionTomo {
  return ExtensionTomoSchema.parse(raw);
}
