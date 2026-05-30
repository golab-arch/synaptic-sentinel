import { z } from 'zod';
import { SeveritySchema } from './severity.js';

/** Categorias de hallazgo cubiertas por SYNAPTIC Sentinel (v0.4 §2.5, §4.2). */
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
 * Paso (step) en el dataflow trace de un hallazgo taint (DG-112 A Step 3).
 *
 * Forma canonica unificada para source, sink y variables intermedias del
 * trace que OpenGrep emite para reglas `mode: taint`. Los paths estan
 * relativizados al rootPath del scan + normalizados con separador `/`
 * (igual que `FindingLocation.path`). El campo `content` es el snippet
 * de codigo en ese punto del flujo.
 */
export const DataflowStepSchema = z.object({
  /** Ruta relativa a la raiz del proyecto, separador `/`. */
  path: z.string().min(1),
  /** Linea (1-based) del step. */
  startLine: z.number().int().positive(),
  /** Snippet del codigo en ese punto del flujo. */
  content: z.string().min(1),
});

/** Paso en un dataflow trace. */
export type DataflowStep = z.infer<typeof DataflowStepSchema>;

/**
 * Dataflow trace canonico de un hallazgo taint (DG-112 A Step 3 — §4 #3
 * del SENTINEL-EVALUATION-REPORT). Source → (intermediate steps) → sink.
 *
 * Se popula solo para findings que vienen de reglas `mode: taint` (SAST
 * taint). Pattern-based, secrets, SCA, IaC, VibeCoded, BusinessLogic: el
 * field queda `undefined`. El Brain Layer (TriageAgent) usa el trace en
 * el user prompt para razonar sobre la verdadera reachability source→sink
 * en lugar de mirar solo el snippet del match.
 */
export const DataflowTraceSchema = z.object({
  source: DataflowStepSchema,
  intermediateSteps: z.array(DataflowStepSchema).default([]),
  sink: DataflowStepSchema,
});

/** Dataflow trace de un hallazgo taint. */
export type DataflowTrace = z.infer<typeof DataflowTraceSchema>;

/**
 * Metadata SCA (Software Composition Analysis) de un hallazgo de Trivy
 * (DG-113 A Step 4 — §4 #4 del SENTINEL-EVALUATION-REPORT). Se popula solo
 * para findings de `category: 'SCA'`; sub-objeto opcional para preservar
 * backward compatibility con Findings legacy en colony.db.
 *
 * Sirve para el grouping de findings por package family (cross-lockfile +
 * intra-package) y el computo del remediation target (MAX semver de los
 * fix versions del grupo). Los 3 campos vienen del Trivy `Vulnerability`:
 * `PkgName`, `InstalledVersion`, `FixedVersion` (parseado a `string[]`).
 */
export const ScaMetadataSchema = z.object({
  /** Nombre del paquete (e.g. `protobufjs`, `@protobufjs/utf8`). */
  packageName: z.string().min(1),
  /** Version instalada (e.g. `7.5.4`). */
  installedVersion: z.string().min(1),
  /**
   * Fix versions parseadas desde Trivy `FixedVersion` (que puede ser
   * comma-separated, e.g. `"7.5.6, 8.0.2"`). Lista vacia si no hay fix
   * conocido.
   */
  fixVersions: z.array(z.string().min(1)).default([]),
});

/** Metadata SCA. */
export type ScaMetadata = z.infer<typeof ScaMetadataSchema>;

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
  /**
   * Dataflow trace de un hallazgo taint (DG-112 A Step 3 — §4 #3 del
   * reporte). Solo poblado para findings de reglas `mode: taint`; queda
   * `undefined` para pattern-based, secrets, SCA, IaC, etc. Aditivo +
   * backward-compatible: Findings ya persistidos en colony.db sin este
   * field siguen validando contra el schema (queda undefined).
   */
  dataflowTrace: DataflowTraceSchema.optional(),
  /**
   * Metadata SCA — solo poblada para findings de `category: 'SCA'`
   * (Trivy). Aditiva + backward-compatible (DG-113 A Step 4 — §4 #4 del
   * reporte). Sirve para grouping por package family + computo de
   * remediation target.
   */
  sca: ScaMetadataSchema.optional(),
});

/** Hallazgo de seguridad. */
export type Finding = z.infer<typeof FindingSchema>;
