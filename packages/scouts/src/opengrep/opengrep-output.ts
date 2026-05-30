import { z } from 'zod';

/**
 * Schema de la salida JSON de OpenGrep (`opengrep scan --json`).
 *
 * Solo se modela lo que el normalizer consume; zod descarta el resto de
 * claves. Validar la salida del scanner es defensa en profundidad: trata
 * la salida de un proceso externo como entrada no confiable (v0.4 §9.6).
 */

/** Posicion (linea/columna 1-based) dentro de un archivo. */
const OpenGrepPositionSchema = z.object({
  line: z.number().int(),
  col: z.number().int(),
  offset: z.number().int(),
});

/** Metadata de una regla OpenGrep. `cwe` y `owasp` pueden ser string o lista. */
const OpenGrepMetadataSchema = z.object({
  cwe: z.union([z.string(), z.array(z.string())]).optional(),
  owasp: z.union([z.string(), z.array(z.string())]).optional(),
});

/** Metadata de una regla OpenGrep. */
export type OpenGrepMetadata = z.infer<typeof OpenGrepMetadataSchema>;

/**
 * Location dentro de un `dataflow_trace` (DG-112 A Step 3 — §4 #3 del
 * SENTINEL-EVALUATION-REPORT). OpenGrep emite locations con `start`/`end`
 * y `offset`; modelamos solo los campos que el normalizer canoniza al
 * `Finding`. Los demas son ignorados defensivamente por Zod.
 */
const TaintLocationSchema = z.object({
  path: z.string().min(1),
  start: z.object({
    line: z.number().int(),
    col: z.number().int(),
  }),
  end: z.object({
    line: z.number().int(),
    col: z.number().int(),
  }),
});

/**
 * Source / sink de un `dataflow_trace`: OpenGrep los emite como tupla
 * `["CliLoc", [location, content]]`. El primer elemento es un tag interno
 * (Command-Line Location); el segundo es la pareja real. Desempaquetamos
 * en el normalizer y mantenemos solo `{location, content}` en el shape
 * canonico del Finding (DG-112 A).
 */
const TaintEndpointSchema = z.tuple([z.string(), z.tuple([TaintLocationSchema, z.string()])]);

/** Variable intermedia en el dataflow trace (DG-112 A). */
const TaintIntermediateVarSchema = z.object({
  location: TaintLocationSchema,
  content: z.string(),
});

/**
 * Dataflow trace crudo (shape de OpenGrep `mode: taint`) — verificado
 * empiricamente contra 8 taint rules (JS + Python, command-injection +
 * sql-injection + xss + path-traversal) con shape consistente al 100%.
 *
 * Todos los campos son opcionales para que pattern-based rules (que NO
 * emiten dataflow_trace) sigan validando. El normalizer drop-ea el trace
 * si source o sink faltan (trace incompleto = no se canoniza).
 */
const DataflowTraceRawSchema = z.object({
  taint_source: TaintEndpointSchema.optional(),
  intermediate_vars: z.array(TaintIntermediateVarSchema).optional(),
  taint_sink: TaintEndpointSchema.optional(),
});

/** Dataflow trace crudo (shape de OpenGrep). */
export type DataflowTraceRaw = z.infer<typeof DataflowTraceRawSchema>;

/** Un hallazgo individual en la salida de OpenGrep. */
const OpenGrepResultSchema = z.object({
  check_id: z.string().min(1),
  path: z.string().min(1),
  start: OpenGrepPositionSchema,
  end: OpenGrepPositionSchema,
  extra: z.object({
    message: z.string(),
    severity: z.string(),
    fingerprint: z.string().min(1),
    lines: z.string().optional(),
    metadata: OpenGrepMetadataSchema.optional(),
    // DG-112 A: dataflow trace para reglas mode:taint. Optional porque
    // pattern-based rules no lo emiten.
    dataflow_trace: DataflowTraceRawSchema.optional(),
  }),
});

/** Salida completa de `opengrep scan --json`. */
export const OpenGrepOutputSchema = z.object({
  version: z.string().optional(),
  results: z.array(OpenGrepResultSchema),
  errors: z.array(z.unknown()).default([]),
});

/** Salida completa de OpenGrep. */
export type OpenGrepOutput = z.infer<typeof OpenGrepOutputSchema>;

/** Un hallazgo individual de OpenGrep. */
export type OpenGrepResult = z.infer<typeof OpenGrepResultSchema>;
