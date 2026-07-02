import { z } from 'zod';
import {
  CrossFileContextSchema,
  FileContextSchema,
  SymbolContextSchema,
} from '../coordinator/interaction-graph.js';
import { PriorityScoreSchema } from '../coordinator/priority-score.js';
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
/**
 * Contexto de dependency-graph de un finding SCA (DG-115 A Step 5 — §4 #15
 * 'prismjs misleading remediation'). Sirve para detectar el caso clasico
 * en que un bump top-level NO resuelve la vulnerabilidad porque existe
 * una copia anidada pineada por un parent transitive (e.g. `prismjs`
 * 1.27.0 vulnerable bajo `refractor@3.6.0` pinned `~1.27.0`, mientras
 * `prismjs` 1.30.0 ya existe top-level).
 *
 * Populado desde `Trivy Result.Packages[]` matcheando vuln↔Package via
 * `PkgIdentifier.UID`. Opcional — Trivy versions older o targets no-npm
 * pueden no exponerlo; en ese caso degrada gracefully (no se emite
 * override directive).
 */
export const DependencyContextSchema = z.object({
  /**
   * Es transitive (`indirect`) o top-level (`direct`)? `root` para el
   * package raiz del proyecto. `unknown` cuando Trivy no lo expone.
   */
  directness: z.enum(['direct', 'indirect', 'root', 'unknown']).default('unknown'),
  /**
   * IDs `name@version` de los packages que pinean esta copia especifica
   * (i.e. la incluyen en su `DependsOn`). Permite construir el caveat
   * que cita al pinner ("pinned by refractor@3.6.0"). Vacio si no hay
   * pinners detectados (e.g. para `direct` deps top-level).
   */
  pinnedBy: z.array(z.string().min(1)).default([]),
  /**
   * `true` si OTRA copia del mismo `packageName` con version >= fix
   * existe en el grafo. Indica el caso clasico "bump top-level no fixea
   * porque la vulnerable esta nested pineada por otra cosa" — el caveat
   * UX se vuelve FUERTE.
   */
  hasSiblingFixedCopy: z.boolean().default(false),
});

/** Contexto de dependency-graph de un finding SCA. */
export type DependencyContext = z.infer<typeof DependencyContextSchema>;

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
  /**
   * Package manager autoritativo del target — `npm`, `yarn`, `pnpm`,
   * etc. (DG-115 A). Viene del field `Type` del `Result` de Trivy.
   * Determina el formato del override directive (npm `overrides`, yarn
   * `resolutions`, pnpm `pnpm.overrides`). Opcional — si Trivy no lo
   * emite, el directive no se construye.
   */
  packageManager: z.string().optional(),
  /** Contexto de dependency-graph (DG-115 A). */
  dependencyContext: DependencyContextSchema.optional(),
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
  /**
   * Priority/risk score (DG-118 A Cycle 109) — SEPARADO del `confidence`
   * del triage verdict. Computado deterministicamente desde (severity,
   * triage classification) por `computePriorityScore`. Solo poblado en el
   * tomo emitido por el reporter (tras join con TriageVerdict); en
   * findings persistidos crudos en colony.db queda `undefined`. UI lo
   * renderiza como badge prominente al lado del severity, demoteando el
   * confidence% a placement secundario para evitar la confusion
   * empirica "TP% se lee como prioridad" reportada en el user-handoff.
   */
  priorityScore: PriorityScoreSchema.optional(),
  /**
   * File context del Interaction Graph (DG-123 A Cycle 111 — R18 v1 del
   * research doc Section 12 "Architectural North Star").
   *
   * Poblado por el Coordinator en Stage 1.5b (post-exclude-list, pre-stage-2)
   * cuando el archivo del finding es de un lenguaje soportado (TS/TSX/JS/
   * Python en v1). Solo aditivo + backward-compatible: findings persistidos
   * pre-DG-123 A quedan sin este campo (undefined). Findings en archivos de
   * lenguajes no soportados también quedan sin el campo.
   *
   * Sirve para que Triage/Context Agents evalúen el finding como nodo en un
   * grafo de interacciones (rol del archivo, quién lo importa, qué importa)
   * en lugar de un snippet aislado.
   */
  fileContext: FileContextSchema.optional(),
  /**
   * Symbol context del Interaction Graph (DG-123 A Cycle 111).
   *
   * Símbolos top-level (functions/classes/consts) declarados en el archivo del
   * finding, y cuáles están exportados. Mismos criterios de población que
   * `fileContext`.
   */
  symbolContext: SymbolContextSchema.optional(),
  /**
   * DG-127 A (Cycle 113 FASE II — R18 v2 symbol-level cross-file resolution).
   *
   * Signatures cross-file resueltas per-finding: para cada identifier del
   * snippet que match un import, adjunta la signature del symbol en el
   * archivo target. Precomputado en Coordinator Stage 1.5b desde
   * `location.snippet` + `fileContext.importedSymbols` + graph nodes.
   *
   * Habilita al LLM razonar cross-module: en el caso original SQL injection
   * cross-module (SYNAPTIC_SAAS `agent.ts` → `agentLoop.execute()`), el LLM
   * ahora ve la signature de `execute()` desde `agent-loop.ts` sin pedir
   * "internals". Cap defensivo: MAX_CROSS_FILE_SIGNATURES_PER_FINDING = 3.
   *
   * Aditivo backward-compat — findings de pre-DG-127 A en colony.db siguen
   * valid con `crossFileContext` undefined.
   */
  crossFileContext: CrossFileContextSchema.optional(),
});

/** Hallazgo de seguridad. */
export type Finding = z.infer<typeof FindingSchema>;
