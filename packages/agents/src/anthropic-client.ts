import Anthropic from '@anthropic-ai/sdk';
import {
  QuotaExhaustedError,
  type LlmClient,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type TokenUsage,
} from './llm-client.js';

/**
 * Detecta si un error del SDK Anthropic corresponde a una cuota agotada /
 * rate limit (DG-088 A). Misma logica defensiva que el helper del
 * adapter OpenAI-compat. Retorna `null` si NO es quota — el caller relanza.
 */
function quotaErrorFromAnthropic(err: unknown): QuotaExhaustedError | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as {
    status?: unknown;
    error?: { type?: unknown; message?: unknown } | undefined;
    message?: unknown;
    headers?: Record<string, string | undefined> | undefined;
  };
  const status = typeof e.status === 'number' ? e.status : -1;
  const innerType = typeof e.error?.type === 'string' ? e.error.type : '';
  const innerMsg = typeof e.error?.message === 'string' ? e.error.message : '';
  const topMsg = typeof e.message === 'string' ? e.message : '';
  const isQuota =
    status === 429 ||
    /rate[_-]?limit|quota|overloaded|too[_-]?many[_-]?requests/i.test(
      `${innerType} ${innerMsg} ${topMsg}`,
    );
  if (!isQuota) return null;
  const retryAfter = e.headers?.['retry-after'];
  const retrySec =
    typeof retryAfter === 'string' && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
  return new QuotaExhaustedError({
    providerLabel: 'anthropic',
    httpStatus: status === -1 ? 429 : status,
    retryAfterSeconds: retrySec,
    message: `Quota/rate-limit at anthropic: ${innerMsg || innerType || topMsg || 'no detail'}`,
  });
}

/** Modelo por defecto: Haiku — rapido y barato, adecuado para triage masivo. */
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
/** Tope de tokens por defecto de una respuesta. */
const DEFAULT_MAX_TOKENS = 1024;
/**
 * Temperature hardcoded a 0 (DG-110 A — Step 1 del SENTINEL-EVALUATION-REPORT
 * contra SYNAPTIC_SAAS, 2026-05-29). Sentinel es una security tool y necesita
 * determinism cross-provider. El cliente OpenAI-compat ya tenia esta politica
 * desde DG-071 A; el cliente Anthropic la omitia y el SDK quedaba corriendo a
 * temperature=1.0 (default). Reportado empiricamente como driver de la TP%
 * noise (0.40-0.90 sin correlacion con risk/reachability) y de la dificultad
 * de diagnosticar otras failures del Brain Layer — la triage era no-deterministica
 * y confounded content-driven failures con sampling noise. Sin esto, re-runs del
 * mismo workspace producen verdicts distintos, lo cual hace imposible un
 * before/after comparison para los Steps 2-5 del reporte.
 */
const DETERMINISTIC_TEMPERATURE = 0;

/** Opciones de construccion de un `AnthropicLlmClient`. */
export interface AnthropicClientOptions {
  /** API key del cliente (BYOK — nunca se persiste). */
  readonly apiKey: string;
  /** Modelo a usar. Por defecto Haiku 4.5. */
  readonly model?: string;
  /** URL del endpoint (override para tests o proxies). */
  readonly baseUrl?: string;
  /** Implementacion de `fetch` (override para tests). Se pasa al SDK. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Cuantas veces el SDK reintenta automaticamente en errores transitorios
   * (429s + 5xx). Default del SDK: 2. Tests inyectan 0 para evitar esperas.
   */
  readonly maxRetries?: number;
}

/** Bloque de texto de una respuesta de la Messages API. */
function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
  );
}

/**
 * Extrae el texto del payload de respuesta de la Messages API (funcion pura).
 *
 * Acepta tanto un `Message` tipado del SDK como un objeto JSON crudo (la
 * forma del campo `content` es identica). Lanza si la forma es inesperada
 * — defensa contra respuestas corruptas / drift del API.
 */
export function parseAnthropicResponse(payload: unknown): string {
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error('Respuesta de Anthropic sin un arreglo "content".');
  }
  const text = content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join('');
  if (text === '') {
    throw new Error('Respuesta de Anthropic sin bloques de texto.');
  }
  return text;
}

/**
 * Extrae el `usage` REAL del payload de respuesta de la Messages API
 * (DG-085 A). La Messages API expone `usage.input_tokens` + `usage.output_tokens`
 * en cada respuesta — no es una proxy. Devuelve `null` si el shape no
 * coincide (defensa contra drift del API o respuestas corruptas).
 */
export function parseAnthropicUsage(payload: unknown): TokenUsage | null {
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== 'object' || usage === null) return null;
  const input = (usage as { input_tokens?: unknown }).input_tokens;
  const output = (usage as { output_tokens?: unknown }).output_tokens;
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  if (input < 0 || output < 0) return null;
  return { inputTokens: input, outputTokens: output };
}

/**
 * Cliente LLM contra la Messages API de Anthropic via `@anthropic-ai/sdk`
 * (BYOK, FI-009 cerrado en DG-064 A).
 *
 * Migrado desde un cliente `fetch` propio al SDK oficial: aporta retries
 * automaticos en errores transitorios (429s + 5xx), manejo nativo de
 * rate-limiting y soporte para streaming (cuando se necesite). Los
 * consumidores no ven la libreria — toda la API queda detras del contrato
 * `LlmClient`, que sigue siendo el unico punto no-deterministico del
 * Brain Layer (los unit tests inyectan un cliente falso).
 *
 * `parseAnthropicResponse` se mantiene como helper puro: la forma de
 * `Message.content` es identica entre el JSON crudo de la API y el `Message`
 * tipado que devuelve el SDK.
 */
export class AnthropicLlmClient implements LlmClient {
  readonly #client: Anthropic;
  readonly #model: string;

  constructor(options: AnthropicClientOptions) {
    this.#client = new Anthropic({
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
    let message;
    try {
      message = await this.#client.messages.create({
        model: this.#model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: DETERMINISTIC_TEMPERATURE,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      });
    } catch (err) {
      // DG-088 A: convertir 429 / rate-limit / overloaded en QuotaExhaustedError.
      const quotaErr = quotaErrorFromAnthropic(err);
      if (quotaErr !== null) throw quotaErr;
      throw err;
    }
    return {
      text: parseAnthropicResponse(message),
      usage: parseAnthropicUsage(message),
    };
  }
}
