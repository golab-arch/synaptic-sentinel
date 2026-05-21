import { z } from 'zod';

/**
 * Un check fallido reportado por Checkov dentro de `results.failed_checks`.
 *
 * Solo se modela lo que el normalizer consume; zod descarta el resto de
 * claves (Checkov emite ~30 campos por check). Validar la salida del scanner
 * es defensa en profundidad (v0.4 §9.6).
 */
const CheckovFailedCheckSchema = z.object({
  /** Identificador de la politica (ej. `CKV_DOCKER_2`). */
  check_id: z.string().min(1),
  /** Nombre legible de la politica. */
  check_name: z.string().default(''),
  /** Ruta del archivo, relativa al directorio escaneado y con `/` inicial. */
  file_path: z.string().default(''),
  /** Rango `[inicio, fin]` de lineas afectadas, 1-based. */
  file_line_range: z.tuple([z.number(), z.number()]).nullable().optional(),
  /** Recurso afectado dentro del archivo. */
  resource: z.string().nullable().optional(),
  /** Severidad: Checkov OSS no la asigna y emite `null`. */
  severity: z.string().nullable().optional(),
  /** URL con la guia de remediacion de la politica. */
  guideline: z.string().nullable().optional(),
});

/** Reporte de Checkov para un framework (dockerfile, terraform, kubernetes...). */
const CheckovReportSchema = z.object({
  /** Framework analizado (ej. `dockerfile`, `terraform`). */
  check_type: z.string().default(''),
  results: z
    .object({
      /** Checkov emite `null` cuando un framework no tiene checks fallidos. */
      failed_checks: z.array(CheckovFailedCheckSchema).nullable().optional(),
    })
    .optional(),
});

/**
 * Schema de la salida JSON de Checkov (`checkov -o json`).
 *
 * Checkov emite un objeto unico cuando un solo framework encuentra archivos, o
 * un array de objetos cuando varios frameworks coinciden (un reporte por cada
 * uno). Se acepta tambien el array vacio (ningun framework con archivos).
 */
export const CheckovOutputSchema = z.union([
  CheckovReportSchema,
  z.array(CheckovReportSchema),
]);

/** Un check fallido de Checkov. */
export type CheckovFailedCheck = z.infer<typeof CheckovFailedCheckSchema>;

/** Reporte de Checkov para un framework. */
export type CheckovReport = z.infer<typeof CheckovReportSchema>;

/** Salida completa de Checkov. */
export type CheckovOutput = z.infer<typeof CheckovOutputSchema>;
