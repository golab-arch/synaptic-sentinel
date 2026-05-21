import { z } from 'zod';

/** Una vulnerabilidad de dependencia reportada por Trivy. */
const TrivyVulnerabilitySchema = z.object({
  VulnerabilityID: z.string().min(1),
  PkgName: z.string().min(1),
  InstalledVersion: z.string().default(''),
  FixedVersion: z.string().optional(),
  Severity: z.string().default('UNKNOWN'),
  Title: z.string().optional(),
  Description: z.string().optional(),
  PrimaryURL: z.string().optional(),
  CweIDs: z.array(z.string()).optional(),
});

/** Un resultado de Trivy: un target (manifiesto de dependencias) escaneado. */
const TrivyResultSchema = z.object({
  Target: z.string().default(''),
  /** Trivy emite `null` cuando un target no tiene vulnerabilidades. */
  Vulnerabilities: z.array(TrivyVulnerabilitySchema).nullable().optional(),
});

/**
 * Schema de la salida JSON de Trivy (`trivy fs --format json`).
 *
 * Solo se modela lo que el normalizer consume; zod descarta el resto de
 * claves. Validar la salida del scanner es defensa en profundidad (v0.4 §9.6).
 */
export const TrivyOutputSchema = z.object({
  Results: z.array(TrivyResultSchema).nullable().optional(),
});

/** Una vulnerabilidad individual de Trivy. */
export type TrivyVulnerability = z.infer<typeof TrivyVulnerabilitySchema>;

/** Salida completa de Trivy. */
export type TrivyOutput = z.infer<typeof TrivyOutputSchema>;
