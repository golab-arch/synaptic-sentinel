import { z } from 'zod';

/** Niveles de severidad de un hallazgo, de mayor a menor gravedad (v0.4 §4.3). */
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

/** Schema de validacion en runtime para una severidad. */
export const SeveritySchema = z.enum(SEVERITIES);

/** Severidad de un hallazgo de seguridad. */
export type Severity = z.infer<typeof SeveritySchema>;

/**
 * Rango numerico de cada severidad — mayor es mas grave.
 * Util para ordenar hallazgos y para umbrales de bloqueo en CI.
 */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

/** Devuelve `true` si `severity` es al menos tan grave como `threshold`. */
export function severityAtLeast(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}
