/**
 * @synaptic-sentinel/agents  [PRO]
 *
 * Capa Cerebro: agentes LLM (prompt especializado + parser de salida, NO
 * microservicios) que enriquecen los hallazgos deterministas de los scouts.
 * BYOK del cliente; la frontera con el LLM es la interfaz `LlmClient`.
 *
 * NO se distribuye bajo Apache-2.0 — ver LICENSE-PRO (EULA, Ley 17.336).
 */

export const PACKAGE_NAME = '@synaptic-sentinel/agents';

export * from './llm-client.js';
export * from './anthropic-client.js';
export * from './brain-agent.js';
export * from './triage-agent.js';
