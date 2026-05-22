import type { LlmClient, LlmCompletionRequest } from './llm-client.js';

/** Endpoint de la Messages API de Anthropic. */
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
/** Version de la API de Anthropic (header obligatorio). */
const ANTHROPIC_VERSION = '2023-06-01';
/** Modelo por defecto: Haiku — rapido y barato, adecuado para triage masivo. */
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
/** Tope de tokens por defecto de una respuesta. */
const DEFAULT_MAX_TOKENS = 1024;

/** Opciones de construccion de un `AnthropicLlmClient`. */
export interface AnthropicClientOptions {
  /** API key del cliente (BYOK — nunca se persiste). */
  readonly apiKey: string;
  /** Modelo a usar. Por defecto Haiku 4.5. */
  readonly model?: string;
  /** URL del endpoint (override para tests). */
  readonly baseUrl?: string;
  /** Implementacion de `fetch` (override para tests). */
  readonly fetchImpl?: typeof fetch;
}

/** Forma de una peticion HTTP a la Messages API. */
export interface AnthropicHttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Construye la peticion HTTP a la Messages API de Anthropic (funcion pura). */
export function buildAnthropicRequest(
  options: AnthropicClientOptions,
  request: LlmCompletionRequest,
): AnthropicHttpRequest {
  return {
    url: options.baseUrl ?? ANTHROPIC_MESSAGES_URL,
    headers: {
      'content-type': 'application/json',
      'x-api-key': options.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: options.model ?? DEFAULT_MODEL,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
    }),
  };
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
 * Extrae el texto de la respuesta JSON de la Messages API (funcion pura).
 * Lanza si la forma es inesperada — defensa contra respuestas corruptas.
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
 * Cliente LLM contra la Messages API de Anthropic (BYOK).
 *
 * Cliente minimo basado en `fetch`: `buildAnthropicRequest` y
 * `parseAnthropicResponse` son funciones puras y testeables; solo el
 * round-trip de red queda fuera de los unit tests (ver el test de
 * integracion, gated por `ANTHROPIC_API_KEY`).
 *
 * Desviacion informada del v0.4 (linea 695, `@anthropic-ai/sdk`): se
 * prioriza testabilidad total y cero dependencias de red. Cuando se
 * necesiten retries / streaming / rate-limiting (v0.4 §rate-limiting LLM)
 * se evaluara migrar al SDK oficial — el contrato `LlmClient` aisla el
 * cambio.
 */
export class AnthropicLlmClient implements LlmClient {
  readonly #options: AnthropicClientOptions;
  readonly #fetch: typeof fetch;

  constructor(options: AnthropicClientOptions) {
    this.#options = options;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    const http = buildAnthropicRequest(this.#options, request);
    const response = await this.#fetch(http.url, {
      method: 'POST',
      headers: { ...http.headers },
      body: http.body,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Anthropic respondio ${String(response.status)}. ${detail.slice(0, 500)}`);
    }
    const payload: unknown = await response.json();
    return parseAnthropicResponse(payload);
  }
}
