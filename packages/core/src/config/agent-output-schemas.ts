/**
 * JSON Schemas de la salida esperada de los 3 agentes del Brain Layer
 * (Phase 11 DG-073 B).
 *
 * Estos JSON Schemas son una transcripcion *literal* de los schemas Zod
 * de los outputs en `packages/core/src/types/*` (`TriageVerdictSchema`,
 * `ContextExplanationSchema`, `RemediationSuggestionSchema`). Se usan en
 * un solo lugar: pasar como `format` al constructor de `OllamaLlmClient`
 * para activar XGrammar constrained decoding y subir el JSON validity a
 * ~99% en modelos locales (DG-070 + DG-072 B).
 *
 * Se mantienen como const literals - sin generacion automatica Zod->JSON
 * Schema - por dos razones:
 *
 * 1) Los 3 schemas son chicos (3-4 campos cada uno); escribirlos a mano
 *    es trivial y no requiere agregar una dep nueva (`zod-to-json-schema`
 *    pesa ~5KB pero introduce su propio rate de incompatibilidades con
 *    versiones de Zod).
 *
 * 2) XGrammar parece tener quirks sutiles con ciertos features de JSON
 *    Schema (oneOf, allOf, refs); escribir el schema a mano nos da
 *    control total sobre que features usamos.
 *
 * Si algun schema Zod en `types/` cambia, hay que actualizar el JSON
 * Schema aqui MANUALMENTE - el matching se valida con tests
 * (`agent-output-schemas.test.ts`).
 */

/** JSON Schema del output del Triage Agent (matcheo de `TriageVerdictSchema`). */
export const TRIAGE_VERDICT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    classification: {
      type: 'string',
      enum: ['true_positive', 'false_positive', 'inconclusive'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string', minLength: 1 },
  },
  required: ['classification', 'confidence', 'rationale'],
} as const;

/** JSON Schema del output del Context Agent (matcheo de `ContextExplanationSchema`). */
export const CONTEXT_EXPLANATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', minLength: 1 },
    entryPoint: { type: 'string', minLength: 1 },
    sink: { type: 'string', minLength: 1 },
    exposure: { type: 'string', minLength: 1 },
  },
  required: ['summary', 'entryPoint', 'sink', 'exposure'],
} as const;

/** JSON Schema del output del Remediation Agent (matcheo de `RemediationSuggestionSchema`). */
export const REMEDIATION_SUGGESTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', minLength: 1 },
    recommendation: { type: 'string', minLength: 1 },
    fixedSnippet: { type: 'string' },
  },
  required: ['summary', 'recommendation'],
} as const;

/** Tipo discriminante del agente del Brain Layer (matcheo de los `id` del `BrainAgent`). */
export type BrainAgentId = 'triage' | 'context' | 'remediation';

/**
 * JSON Schema correspondiente al output esperado de cada agente. Lo usa
 * `createLlmClient` para inyectarlo como `format` en `OllamaLlmClient`.
 */
export const AGENT_OUTPUT_SCHEMAS: Readonly<
  Record<BrainAgentId, Readonly<Record<string, unknown>>>
> = {
  triage: TRIAGE_VERDICT_JSON_SCHEMA,
  context: CONTEXT_EXPLANATION_JSON_SCHEMA,
  remediation: REMEDIATION_SUGGESTION_JSON_SCHEMA,
};
