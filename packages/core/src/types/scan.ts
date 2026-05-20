import { z } from 'zod';

/**
 * Modos de escaneo (v0.4 §3.8). El modo `background-continuous` es una
 * funcionalidad Pro/post-MVP y se incorporara cuando corresponda.
 */
export const SCAN_MODES = ['on-save', 'on-commit', 'full'] as const;

/** Schema de validacion para el modo de escaneo. */
export const ScanModeSchema = z.enum(SCAN_MODES);

/** Modo de escaneo. */
export type ScanMode = z.infer<typeof ScanModeSchema>;

/** Registro global de un scan, segun se persiste en la tabla `scans`. */
export const ScanSchema = z.object({
  /** Identificador unico del scan (UUID). */
  id: z.string().uuid(),
  /** Inicio del scan (ISO-8601). */
  startedAt: z.string().datetime(),
  /** Fin del scan (ISO-8601). Ausente mientras el scan esta en curso. */
  finishedAt: z.string().datetime().nullable().optional(),
  /** SHA del commit git sobre el que se ejecuto el scan, si aplica. */
  gitSha: z.string().min(1).nullable().optional(),
  /** Resumen por agente — objeto JSON libre. */
  agentSummary: z.record(z.unknown()).nullable().optional(),
});

/** Registro global de un scan. */
export type Scan = z.infer<typeof ScanSchema>;
