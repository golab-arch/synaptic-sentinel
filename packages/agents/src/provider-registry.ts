import {
  AGENT_OUTPUT_SCHEMAS,
  type AgentConfig,
  type BrainAgentId,
  type ProviderName,
} from '@synaptic-sentinel/core';
import { AnthropicLlmClient } from './anthropic-client.js';
import type { LlmClient } from './llm-client.js';
import { OllamaLlmClient } from './ollama-client.js';
import { OpenAiCompatibleLlmClient } from './openai-compatible-client.js';

/**
 * Provider registry — factory que compone los 3 adapters extraidos en
 * Phase 11 (Phase 11 DG-073 B).
 *
 * Toma una configuracion de agente (`{provider, model, baseUrl?}` de
 * `.sentinel/agents.yaml` o de la CLI flag) + el `apiKey` resuelto desde
 * env vars / SecretStorage + el `BrainAgentId` que va a usar el cliente
 * (para inyectar el JSON Schema correcto al `OllamaLlmClient`), y devuelve
 * la instancia concreta de `LlmClient` correcta.
 *
 * Dispatch:
 *   - `anthropic`            -> AnthropicLlmClient (preserva caching/vision/thinking)
 *   - `ollama`               -> OllamaLlmClient (API nativa /api/chat + XGrammar
 *                                vía `format` derivado de `AGENT_OUTPUT_SCHEMAS`)
 *   - todos los demas        -> OpenAiCompatibleLlmClient con baseUrl correcto
 *
 * La tabla de `baseUrl` defaults vive aqui, no en el cliente, porque el
 * adapter `OpenAiCompatibleLlmClient` no tiene noción de "providers
 * famosos" - es un adapter generico. El usuario igual puede sobrescribir
 * el `baseUrl` desde el config si su provider mueve el endpoint.
 */

/** Tabla de URLs base por defecto para providers OpenAI-compatible. */
const OPENAI_COMPAT_DEFAULT_BASE_URLS: Readonly<Record<string, string>> = {
  // No incluimos `openai` aqui: si baseUrl es undefined, el SDK usa el default
  // oficial https://api.openai.com/v1 .
  groq: 'https://api.groq.com/openai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  together: 'https://api.together.ai/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  perplexity: 'https://api.perplexity.ai',
  xai: 'https://api.x.ai/v1',
  // Gemini via su layer OpenAI-compatible (GA desde Sept 2025).
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  // bedrock + azure: requieren la URL completa del usuario (region/instance);
  // el config DEBE traer baseUrl explicito para esos providers - se valida
  // mas abajo.
};

/** Opciones para construir un `LlmClient` desde un `AgentConfig`. */
export interface CreateLlmClientOptions {
  /** Configuracion del agente (provider, model, baseUrl?) del YAML o CLI flag. */
  readonly config: AgentConfig;
  /**
   * API key del provider (resuelto desde env vars / SecretStorage). Es
   * obligatorio para todos los providers EXCEPTO `ollama` (local sin auth).
   */
  readonly apiKey?: string;
  /**
   * Identidad del agente que va a usar este cliente. Se usa para inyectar
   * el `format` (JSON Schema) en el `OllamaLlmClient` y activar XGrammar.
   * Para los otros providers se ignora (no hay structured outputs
   * universales que portar - cada provider tiene su propio dialecto).
   */
  readonly agentId: BrainAgentId;
  /** Implementacion de `fetch` (override para tests). */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Indica si un provider requiere `apiKey`. Ollama es local sin auth (la
 * unica excepcion).
 */
export function providerRequiresApiKey(provider: ProviderName): boolean {
  return provider !== 'ollama';
}

/**
 * Construye un `LlmClient` para el provider especificado. Lanza si el
 * config es inconsistente (provider que requiere apiKey sin apiKey, o
 * provider que requiere baseUrl explicito sin baseUrl).
 */
export function createLlmClient(options: CreateLlmClientOptions): LlmClient {
  const { config, apiKey, agentId, fetchImpl } = options;
  const { provider, model } = config;

  // Validacion: providers que requieren apiKey.
  if (providerRequiresApiKey(provider) && (apiKey === undefined || apiKey === '')) {
    throw new Error(
      `Provider "${provider}" requires an API key (set ` +
        `SENTINEL_${provider.toUpperCase()}_API_KEY or sentinel.${provider}.apiKey).`,
    );
  }

  if (provider === 'anthropic') {
    return new AnthropicLlmClient({
      apiKey: apiKey as string,
      model,
      ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
      ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    });
  }

  if (provider === 'ollama') {
    return new OllamaLlmClient({
      ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
      model,
      // XGrammar activo: pasamos el JSON Schema del agente correspondiente.
      // Esto es el unlock real del posicionamiento "Ollama recommended con
      // ~99% JSON validity" (DG-070 + DG-072 B).
      format: AGENT_OUTPUT_SCHEMAS[agentId],
      ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    });
  }

  // OpenAI-compatible. Resolvemos el baseUrl:
  //   1) baseUrl explicito en el config (gana siempre - permite Bedrock,
  //      Azure, self-hosted vLLM, etc).
  //   2) Default conocido del provider (Groq, DeepSeek, Mistral, ...).
  //   3) undefined - el SDK openai cae al default oficial de OpenAI.
  let baseUrl: string | undefined = config.baseUrl;
  if (baseUrl === undefined && provider in OPENAI_COMPAT_DEFAULT_BASE_URLS) {
    baseUrl = OPENAI_COMPAT_DEFAULT_BASE_URLS[provider];
  }
  // Providers que SI o SI necesitan baseUrl explicito.
  if (baseUrl === undefined && (provider === 'bedrock' || provider === 'azure')) {
    throw new Error(
      `Provider "${provider}" requires an explicit baseUrl in agents.yaml ` +
        `(region/instance varies per user).`,
    );
  }
  return new OpenAiCompatibleLlmClient({
    apiKey: apiKey as string,
    model,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
  });
}

/**
 * Nombre de la env var donde la CLI lee la API key del provider. Convencion:
 * `SENTINEL_<PROVIDER>_API_KEY` en mayusculas. Excepcion historica:
 * `ANTHROPIC_API_KEY` se acepta tambien para retro-compat con v0.2.0.
 */
export function apiKeyEnvVarName(provider: ProviderName): string {
  return `SENTINEL_${provider.toUpperCase()}_API_KEY`;
}

/**
 * Resuelve la API key de un provider desde `process.env` con el patron
 * estandar. Para `anthropic` acepta tambien la legacy `ANTHROPIC_API_KEY`
 * (retro-compat con la CLI v0.2.0 que solo soportaba Anthropic).
 *
 * Devuelve `undefined` si no se encuentra ninguna o si estan vacias - el
 * caller decide si eso es error o si activa el fallback.
 */
export function resolveApiKeyFromEnv(
  provider: ProviderName,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const namespaced = env[apiKeyEnvVarName(provider)];
  if (namespaced !== undefined && namespaced !== '') return namespaced;
  if (provider === 'anthropic') {
    const legacy = env['ANTHROPIC_API_KEY'];
    if (legacy !== undefined && legacy !== '') return legacy;
  }
  return undefined;
}

/**
 * Config implicita para retro-compatibilidad con el comportamiento v0.2.0:
 * si no hay `.sentinel/agents.yaml` pero hay `ANTHROPIC_API_KEY` (o
 * `SENTINEL_ANTHROPIC_API_KEY`) en el entorno, todos los agentes corren
 * contra Anthropic Claude Haiku 4.5 (el default historico). Asi un
 * usuario del `.vsix v0.2.0` que actualice a v0.3.0 no necesita crear
 * `agents.yaml` para que el producto siga funcionando.
 */
export const ANTHROPIC_FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

/** Construye una `AgentsConfig` implicita Anthropic-only para retro-compat. */
export function buildAnthropicFallbackConfig(): {
  agents: { triage: AgentConfig; context: AgentConfig; remediation: AgentConfig };
} {
  const agent: AgentConfig = { provider: 'anthropic', model: ANTHROPIC_FALLBACK_MODEL };
  return { agents: { triage: agent, context: agent, remediation: agent } };
}
