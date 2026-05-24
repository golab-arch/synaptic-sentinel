/**
 * @synaptic-sentinel/agents
 *
 * Brain Layer: agentes LLM (prompt especializado + parser de salida, NO
 * microservicios) que enriquecen los hallazgos deterministas de los scouts.
 * BYOK del cliente; la frontera con el LLM es la interfaz `LlmClient`.
 *
 * Distribuido bajo Apache-2.0 (ver LICENSE en la raiz del repo).
 */

export const PACKAGE_NAME = '@synaptic-sentinel/agents';

export * from './llm-client.js';
export * from './anthropic-client.js';
export * from './openai-compatible-client.js';
export * from './ollama-client.js';
export * from './brain-agent.js';
export * from './provider-registry.js';
export * from './token-tracking-client.js';
export * from './triage-agent.js';
export * from './context-agent.js';
export * from './remediation-agent.js';
