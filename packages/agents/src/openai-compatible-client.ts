import OpenAI from 'openai';
import type {
  LlmClient,
  LlmCompletionRequest,
  LlmCompletionResult,
  TokenUsage,
} from './llm-client.js';

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
/**
 * Tope mas amplio para gpt-5* family (DG-086 A). El PILOT benchmark de
 * DG-077 expuso que gpt-5-nano consume el techo de `max_completion_tokens`
 * en reasoning tokens INTERNOS y devuelve `content=null` (100% errors). 8K
 * deja ~7K para reasoning + ~1K para content emitido visible — empirica-
 * mente suficiente para los prompts de triage/context/remediation que
 * caben en ~512 tokens. Solo aplica cuando el llamante no pasa
 * `request.maxTokens` (un override explicito se respeta). El cost del cap
 * NO es el cost del actual usage — el provider cobra por los tokens
 * generados realmente, no por el cap.
 */
const DEFAULT_MAX_TOKENS_GPT5 = 8192;
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
 * Extrae el `usage` REAL del payload OpenAI-compatible (DG-085 A). El
 * protocolo OpenAI Chat Completions expone `usage.prompt_tokens` +
 * `usage.completion_tokens` en cada respuesta — soportado por todos los
 * 14+ providers OpenAI-compatible que sirve este adapter. Devuelve `null`
 * si el shape no coincide (algunos providers o versiones antiguas omiten
 * el campo; tratamos eso como "no disponible", no como error).
 */
export function parseOpenAiCompatibleUsage(payload: unknown): TokenUsage | null {
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== 'object' || usage === null) return null;
  const input = (usage as { prompt_tokens?: unknown }).prompt_tokens;
  const output = (usage as { completion_tokens?: unknown }).completion_tokens;
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  if (input < 0 || output < 0) return null;
  return { inputTokens: input, outputTokens: output };
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
    const result = await this.completeWithUsage(request);
    return result.text;
  }

  async completeWithUsage(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    // gpt-5* family tiene tres quirks descubiertos empíricamente en el PILOT
    // benchmark de DG-077: (1) rechaza `max_tokens` y exige
    // `max_completion_tokens`; (2) rechaza `temperature: 0` con
    // "Unsupported value: 'temperature' does not support 0 with this model.
    // Only the default (1) value is supported" — solo acepta su default 1;
    // (3) consume el techo de `max_completion_tokens` en reasoning tokens
    // INTERNOS antes de emitir texto visible — con default 1024 (cross-
    // provider) devolvia content=null el 100% de las veces. DG-086 A
    // sube el default a 8192 SOLO para gpt-5* (override del caller se
    // respeta). El resto de providers se queda en 1024.
    const isGpt5 = this.#model.startsWith('gpt-5');
    const tokens = request.maxTokens ?? (isGpt5 ? DEFAULT_MAX_TOKENS_GPT5 : DEFAULT_MAX_TOKENS);
    const tokensParam = isGpt5 ? { max_completion_tokens: tokens } : { max_tokens: tokens };
    // Para gpt-5* omitimos `temperature` y dejamos que el modelo use su
    // default (1). Para el resto fijamos 0 para determinism.
    const temperatureParam = isGpt5 ? {} : { temperature: DETERMINISTIC_TEMPERATURE };
    // `response_format: json_object` mejora dramáticamente la JSON adherence
    // en providers que la respetan (OpenAI / Groq / DeepSeek / Gemini-compat /
    // Mistral). Para los que no la soportan / la ignoran, no daña — el
    // adapter sigue obteniendo el `content` y `parseOpenAiCompatibleResponse`
    // lo extrae igual. Los system prompts de los 3 agentes ya mencionan
    // "json" — requisito de OpenAI para esta opción.
    const completion = await this.#client.chat.completions.create({
      model: this.#model,
      ...tokensParam,
      ...temperatureParam,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    });
    return {
      text: parseOpenAiCompatibleResponse(completion),
      usage: parseOpenAiCompatibleUsage(completion),
    };
  }
}
