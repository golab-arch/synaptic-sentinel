import { z } from 'zod';
import { SeveritySchema } from './severity.js';

/** Categorias de hallazgo cubiertas por Synaptic Sentinel (v0.4 §2.5, §4.2). */
export const FINDING_CATEGORIES = [
  'SAST',
  'Secrets',
  'SCA',
  'IaC',
  'VibeCoded',
  'BusinessLogic',
] as const;

/** Schema de validacion para la categoria de un hallazgo. */
export const FindingCategorySchema = z.enum(FINDING_CATEGORIES);

/** Categoria de un hallazgo de seguridad. */
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

/** Estados del ciclo de vida de un hallazgo (v0.4 §4.2). */
export const LIFECYCLE_STATES = ['new', 'known', 'accepted_risk', 'remediated'] as const;

/** Schema de validacion para el estado de ciclo de vida. */
export const LifecycleStateSchema = z.enum(LIFECYCLE_STATES);

/** Estado de ciclo de vida de un hallazgo. */
export type LifecycleState = z.infer<typeof LifecycleStateSchema>;

/** Ubicacion de un hallazgo dentro del codigo del cliente. */
export const FindingLocationSchema = z.object({
  /** Ruta relativa a la raiz del proyecto, normalizada con separador `/`. */
  path: z.string().min(1),
  /** Linea inicial, 1-based. */
  startLine: z.number().int().positive(),
  /** Linea final, 1-based. Si se omite, se asume igual a `startLine`. */
  endLine: z.number().int().positive().optional(),
  /** Columna inicial, 1-based. */
  startColumn: z.number().int().positive().optional(),
  /** Columna final, 1-based. */
  endColumn: z.number().int().positive().optional(),
  /** Fragmento de codigo afectado, si el scanner lo provee. */
  snippet: z.string().optional(),
});

/** Ubicacion de un hallazgo. */
export type FindingLocation = z.infer<typeof FindingLocationSchema>;

/**
 * Hallazgo de seguridad producido por un Scout (capa determinista, sin LLM).
 *
 * Los campos de enriquecimiento del Brain Layer (explicacion contextualizada,
 * cadena de explotabilidad, remediacion) se agregan aguas abajo del pipeline;
 * no forman parte del hallazgo crudo de un Scout.
 */
export const FindingSchema = z.object({
  /** Identificador unico del hallazgo (UUID). */
  id: z.string().uuid(),
  /** Scan al que pertenece el hallazgo. */
  scanId: z.string().min(1),
  /** Scout que lo produjo (ej. `opengrep`, `gitleaks`). */
  scoutId: z.string().min(1),
  /** Severidad del hallazgo. */
  severity: SeveritySchema,
  /** Categoria del hallazgo. */
  category: FindingCategorySchema,
  /** Identificador de la regla del scanner que disparo el hallazgo. */
  ruleId: z.string().min(1),
  /** Titulo corto y legible. */
  title: z.string().min(1),
  /** Descripcion del hallazgo. */
  message: z.string().min(1),
  /** Ubicacion en el codigo. */
  location: FindingLocationSchema,
  /**
   * Referencias a controles y estandares (ej. `CWE-89`, `OWASP-A03`).
   * El mapeo completo a frameworks de cumplimiento lo amplia el Compliance Mapper.
   */
  complianceRefs: z.array(z.string().min(1)).default([]),
  /**
   * Huella estable del hallazgo, independiente del `scanId` — habilita la
   * deduplicacion entre scans y alimenta `learning_records.pattern_signature`.
   */
  fingerprint: z.string().min(1),
  /** Estado de ciclo de vida. Un hallazgo recien producido es `new`. */
  lifecycleState: LifecycleStateSchema.default('new'),
  /** Marca temporal de creacion (ISO-8601). */
  createdAt: z.string().datetime(),
});

/** Hallazgo de seguridad. */
export type Finding = z.infer<typeof FindingSchema>;
