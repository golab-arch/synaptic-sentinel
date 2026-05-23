import OpenAI from 'openai';
import type { LlmClient, LlmCompletionRequest } from './llm-client.js';

/**
 * Cliente LLM contra cualquier endpoint OpenAI-compatible (Phase 11 DG-071 A).
 *
 * El protocolo OpenAI Chat Completions es la lingua franca de facto del
 * ecosistema LLM en 2026 — un mismo SDK (`openai`) sirve a 14+ providers
 * cambiando solo `baseURL`. Sentinel lo aprovecha para correr el Brain Layer
 * contra cualquier provider que exponga `/v1/chat/completions`:
 *
 *   OpenAI               https://api.openai.com/v1            (default del SDK)
 *   Groq                 https://api.groq.com/openai/v1
 *   DeepSeek             https://api.deepseek.com/v1
 *   Mistral              https://api.mistral.ai/v1
 *   Together AI          https://api.together.ai/v1
 *   Fireworks AI         https://api.fireworks.ai/inference/v1
 *   Perplexity           https://api.perplexity.ai
 *   xAI Grok             https://api.x.ai/v1
 *   Gemini (compat)      https://generativelanguage.googleapis.com/v1beta/openai
 *   AWS Bedrock Mantle   https://bedrock-mantle.<region>.api.aws/v1
 *   Azure OpenAI v1      https://<instance>.openai.azure.com/openai/v1
 *   Ollama (sin grammar) http://localhost:11434/v1
 *   LM Studio            http://localhost:1234/v1
 *   vLLM                 http://localhost:8000/v1
 *
 * NO se usa para Anthropic: el endpoint OpenAI-compatible de Anthropic es
 * beta y pierde prompt caching + extended thinking + citations + vision.
 * `AnthropicLlmClient` sigue siendo la implementacion canonica para Claude.
 * Tampoco se usa para Ollama cuando se quiera aprovechar XGrammar (eso vive
 * en `OllamaLlmClient`, agregado en DG-072).
 *
 * `temperature` queda hardcoded a 0 en el cliente: Sentinel es una security
 * tool y prefiere determinism cross-provider (alineado con el hallazgo del
 * paper PromptBridge — fijar temperature reduce la variancia que un
 * benchmark cross-provider tendria que filtrar). Si DG-076 (benchmark
 * empirico) revela que un provider necesita temperature distinto, se
 * abrira un sub-DG para exponerlo en el contrato.
 */

/** Modelo por defecto si el llamante no especifica uno. */
const DEFAULT_MODEL = 'gpt-5-nano';
/** Tope de tokens de respuesta por defecto, alineado con `AnthropicLlmClient`. */
const DEFAULT_MAX_TOKENS = 1024;
/** Temperature fija — determinism cross-provider. */
const DETERMINISTIC_TEMPERATURE = 0;

/** Opciones de construccion de un `OpenAiCompatibleLlmClient`. */
export interface OpenAiCompatibleClientOptions {
  /** API key del usuario (BYOK — nunca se persiste fuera de `SecretStorage`). */
  readonly apiKey: string;
  /** Modelo a usar. Sin default sensato cross-provider — siempre conviene fijarlo. */
  readonly model?: string;
  /**
   * URL del endpoint. Cambia este valor para apuntar a Groq / DeepSeek /
   * Mistral / etc. en vez de OpenAI. Si se omite, el SDK usa la URL oficial
   * de OpenAI (`https://api.openai.com/v1`).
   */
  readonly baseUrl?: string;
  /** Implementacion de `fetch` (override para tests). Se pasa al SDK. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Cuantas veces el SDK reintenta automaticamente en errores transitorios
   * (429s + 5xx). Default del SDK: 2. Tests inyectan 0 para evitar esperas.
   */
  readonly maxRetries?: number;
}

/**
 * Extrae el texto del payload de respuesta de un endpoint OpenAI-compatible
 * (funcion pura).
 *
 * Acepta tanto el `ChatCompletion` tipado del SDK como un objeto JSON crudo
 * (la forma del campo `choices` es identica). Lanza si la forma es
 * inesperada — defensa contra respuestas corruptas / drift del API entre
 * providers (algunos devuelven `content: null` cuando solo hay tool_calls;
 * tratamos eso como respuesta sin texto y lanzamos).
 */
export function parseOpenAiCompatibleResponse(payload: unknown): string {
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('Respuesta OpenAI-compatible sin un arreglo "choices".');
  }
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  if (typeof content !== 'string' || content === '') {
    throw new Error('Respuesta OpenAI-compatible sin texto en choices[0].message.content.');
  }
  return content;
}

/**
 * Cliente LLM contra cualquier endpoint OpenAI-compatible (BYOK).
 *
 * Patron identico al `AnthropicLlmClient`: toda la API queda detras del
 * contrato `LlmClient`, los tests inyectan un `fetch` falso (determinista,
 * sin red) y la implementacion concreta del SDK queda aislada en este
 * archivo. La unica diferencia funcional vs Anthropic es la URL del
 * endpoint (configurable via `baseUrl`) y la forma de la respuesta —
 * `parseOpenAiCompatibleResponse` la absorbe.
 */
export class OpenAiCompatibleLlmClient implements LlmClient {
  readonly #client: OpenAI;
  readonly #model: string;

  constructor(options: OpenAiCompatibleClientOptions) {
    this.#client = new OpenAI({
      apiKey: options.apiKey,
      ...(options.baseUrl !== undefined ? { baseURL: options.baseUrl } : {}),
      ...(options.fetchImpl !== undefined ? { fetch: options.fetchImpl } : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    });
    this.#model = options.model ?? DEFAULT_MODEL;
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    const completion = await this.#client.chat.completions.create({
      model: this.#model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: DETERMINISTIC_TEMPERATURE,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    });
    return parseOpenAiCompatibleResponse(completion);
  }
}
