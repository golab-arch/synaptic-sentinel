import { z } from 'zod';
import { FindingSchema } from './finding.js';
import type { FindingCategory } from './finding.js';
import type { ScanMode } from './scan.js';

/**
 * Estado de la ejecucion de un Scout.
 * `partial` corresponde a un scan degradado: el scout fallo parcialmente
 * pero el Coordinator continua con los demas (v0.4 §3.7 — degraded > failed).
 */
export const SCOUT_STATUSES = ['ok', 'partial', 'failed'] as const;

/** Schema de validacion para el estado de un Scout. */
export const ScoutStatusSchema = z.enum(SCOUT_STATUSES);

/** Estado de la ejecucion de un Scout. */
export type ScoutStatus = z.infer<typeof ScoutStatusSchema>;

/**
 * Peticion de escaneo que el Coordinator entrega a un Scout.
 *
 * No tiene schema `zod` porque incluye `signal`, un objeto de runtime no
 * serializable. La construye el Coordinator (interno y confiable).
 */
export interface ScanRequest {
  /** Scan al que pertenece esta ejecucion. */
  readonly scanId: string;
  /** Raiz del proyecto del cliente (ruta absoluta). */
  readonly rootPath: string;
  /** Rutas a escanear, relativas a `rootPath`. Vacio = todo el proyecto. */
  readonly targetPaths: readonly string[];
  /** Modo de escaneo. */
  readonly mode: ScanMode;
  /**
   * Senal de cancelacion del Coordinator — kill-switch para agentes que
   * exceden su presupuesto de tiempo (v0.4 §9.6 — Rogue Agents).
   */
  readonly signal?: AbortSignal;
}

/** Resultado de la ejecucion de un Scout. */
export const ScoutResultSchema = z.object({
  /** Scout que produjo el resultado. */
  scoutId: z.string().min(1),
  /** Scan al que pertenece. */
  scanId: z.string().min(1),
  /** Hallazgos normalizados producidos por el Scout. */
  findings: z.array(FindingSchema),
  /** Estado de la ejecucion. */
  status: ScoutStatusSchema,
  /** Inicio de la ejecucion (ISO-8601). */
  startedAt: z.string().datetime(),
  /** Fin de la ejecucion (ISO-8601). */
  finishedAt: z.string().datetime(),
  /** Mensaje de error cuando `status` es `partial` o `failed`. */
  error: z.string().min(1).optional(),
});

/** Resultado de la ejecucion de un Scout. */
export type ScoutResult = z.infer<typeof ScoutResultSchema>;

/**
 * Contrato comun de todo scanner de la capa Scout.
 *
 * Un ScoutAgent es determinista (sin LLM): corre el scanner OSS subyacente
 * como child process dentro del perimetro del cliente y normaliza su salida
 * a `Finding[]`. El Coordinator lo invoca; el fallo de un Scout degrada el
 * scan, no lo aborta (v0.4 §3.7).
 *
 * El contrato vive en `core`; los wrappers concretos (ej. OpenGrepScout) lo
 * implementan desde el paquete `scouts`.
 */
export interface ScoutAgent {
  /** Identificador estable del scout (ej. `opengrep`). */
  readonly id: string;
  /** Nombre legible para mostrar al usuario. */
  readonly displayName: string;
  /** Categoria de hallazgos que produce este scout. */
  readonly category: FindingCategory;
  /**
   * Indica si el scanner subyacente esta disponible para ejecutarse
   * (binario instalado y accesible). El Coordinator lo consulta antes de
   * incluir al scout en el pipeline.
   */
  isAvailable(): Promise<boolean>;
  /** Ejecuta el escaneo y devuelve los hallazgos normalizados. */
  scan(request: ScanRequest): Promise<ScoutResult>;
}
