import OpenAI from 'openai';
import {
  QuotaExhaustedError,
  type LlmClient,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type TokenUsage,
} from './llm-client.js';

/**
 * Detecta si un error del SDK de OpenAI (o de cualquier provider OpenAI-
 * compatible) corresponde a una cuota agotada / rate limit (DG-088 A).
 * Defensiva: mira `status` y campos de mensaje sin asumir clases internas
 * del SDK. Retorna `null` si NO es un caso de quota — el caller relanza.
 */
function quotaErrorFromOpenAi(err: unknown, providerLabel: string): QuotaExhaustedError | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as {
    status?: unknown;
    code?: unknown;
    type?: unknown;
    message?: unknown;
    headers?: Record<string, string | undefined> | undefined;
  };
  const status = typeof e.status === 'number' ? e.status : -1;
  const codeStr = typeof e.code === 'string' ? e.code : '';
  const typeStr = typeof e.type === 'string' ? e.type : '';
  const messageStr = typeof e.message === 'string' ? e.message : '';
  const isQuota =
    status === 429 ||
    /rate[_-]?limit|quota|insufficient_quota|tokens_per_day|requests_per_minute|too[_-]?many[_-]?requests/i.test(
      `${codeStr} ${typeStr} ${messageStr}`,
    );
  if (!isQuota) return null;
  const retryAfter = e.headers?.['retry-after'];
  const retrySec =
    typeof retryAfter === 'string' && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
  return new QuotaExhaustedError({
    providerLabel,
    httpStatus: status === -1 ? 429 : status,
    retryAfterSeconds: retrySec,
    message: `Quota/rate-limit at ${providerLabel}: ${messageStr || codeStr || typeStr || 'no detail'}`,
  });
}

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
 * DG-125 A (Cycle 112 FASE I): error tipado para el caso "provider
 * intermittently returns HTTP 200 OK with content=null/empty string".
 * Provider-agnostic — reproducido empíricamente 3+ Baselines consecutivos
 * (8, 8c, 8d) contra deepseek-v4-flash, pero el mismo pattern puede
 * emerger contra CUALQUIER de los 14+ providers OpenAI-compatible que
 * sirve este adapter (groq, openai, mistral, gemini-compat, together,
 * fireworks, xAI, etc.) — content-filter policies, transient network
 * glitches, reasoning-token exhaustion, y provider-side timeouts pueden
 * disparar el mismo síntoma.
 *
 * El caller (triage.ts / CLI) catchea este error específicamente y lo
 * transforma en verdict `inconclusive` con rationale determinístico, en
 * vez de dejar el finding sin veredicto ("triage failed for X").
 */
export class EmptyResponseError extends Error {
  readonly providerLabel: string;
  readonly attemptsExhausted: number;
  constructor(providerLabel: string, attemptsExhausted: number) {
    super(
      `Provider ${providerLabel} returned empty content in choices[0].message.content ` +
        `after ${String(attemptsExhausted)} attempt(s). Not retryable — see DG-125 A.`,
    );
    this.name = 'EmptyResponseError';
    this.providerLabel = providerLabel;
    this.attemptsExhausted = attemptsExhausted;
  }
}

/**
 * DG-125 A: default para el número máximo de reintentos en application-
 * level cuando el provider devuelve `content=null/''`. Con 2 retries
 * (3 attempts total) cubrimos casos transient sin blow-up de cost —
 * cada retry es una call nueva al provider (fresh completion).
 */
const DEFAULT_EMPTY_RETRY_ATTEMPTS = 2;

/**
 * DG-125 A: backoff exponencial entre retries. Base 500ms, factor 2 →
 * 500ms, 1000ms. Evita hammering al provider si el problema es transient
 * de infra + da tiempo para que el content-filter re-evaluate (si el
 * empty era filter-triggered).
 */
const EMPTY_RETRY_BACKOFF_MS_BASE = 500;

/** Sleep helper para el backoff (test-friendly via setTimeout promise). */
function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * DG-125 A helper: distingue si un error es el "empty content" case
 * (retryable) vs otros errores del SDK (no retryable — quota, network,
 * schema drift). Match por substring de message porque
 * parseOpenAiCompatibleResponse lanza `Error` genérico con message
 * determinístico.
 */
function isEmptyContentError(err: unknown): boolean {
  if (err instanceof EmptyResponseError) return true;
  if (!(err instanceof Error)) return false;
  return err.message.includes('sin texto en choices[0].message.content');
}

/**
 * DG-125 A (Cycle 112 FASE I): reintenta una operación asincrónica cuando
 * dispara un empty-content error. Retorna el primer resultado exitoso.
 * Provider-agnostic — el `providerLabel` solo se usa para el
 * `EmptyResponseError` final.
 *
 * Semantics:
 * - Attempt 1: si OK → return; si empty → wait backoff #1, retry
 * - Attempt 2 (retry #1): si OK → return; si empty → wait backoff #2, retry
 * - Attempt 3 (retry #2): si OK → return; si empty → throw EmptyResponseError
 * - Errores NON-empty (quota, network, schema): propagan inmediatamente sin retry
 */
export async function retryOnEmptyContent<T>(
  op: () => Promise<T>,
  providerLabel: string,
  options: {
    maxRetries?: number;
    backoffMsBase?: number;
    sleepImpl?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_EMPTY_RETRY_ATTEMPTS;
  const backoffMsBase = options.backoffMsBase ?? EMPTY_RETRY_BACKOFF_MS_BASE;
  const sleep = options.sleepImpl ?? sleepMs;
  const totalAttempts = maxRetries + 1;
  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      return await op();
    } catch (err) {
      if (!isEmptyContentError(err)) throw err; // NON-empty errors propagan sin retry
      const isLastAttempt = attempt === totalAttempts - 1;
      if (isLastAttempt) {
        throw new EmptyResponseError(providerLabel, totalAttempts);
      }
      // Backoff exponencial: attempt=0 → base * 1, attempt=1 → base * 2, ...
      const backoffMs = backoffMsBase * Math.pow(2, attempt);
      await sleep(backoffMs);
    }
  }
  // Unreachable, satisfies TS type checker.
  throw new EmptyResponseError(providerLabel, totalAttempts);
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
  readonly #providerLabel: string;

  constructor(options: OpenAiCompatibleClientOptions) {
    this.#client = new OpenAI({
      apiKey: options.apiKey,
      ...(options.baseUrl !== undefined ? { baseURL: options.baseUrl } : {}),
      ...(options.fetchImpl !== undefined ? { fetch: options.fetchImpl } : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    });
    this.#model = options.model ?? DEFAULT_MODEL;
    // Label simple para el QuotaExhaustedError: deriva del baseUrl host
    // o cae a 'openai-compat' si no se paso. El benchmark runner ya tiene
    // su propio providerLabel mas rico (provider/model) cuando llama.
    this.#providerLabel = options.baseUrl !== undefined ? options.baseUrl : 'openai';
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
    // DG-125 A (Cycle 112 FASE I): envuelve create + parse en
    // retryOnEmptyContent para manejar el caso "provider devuelve HTTP 200
    // OK con content=null/''" transient. Reproducido empíricamente 3+
    // Baselines contra deepseek-v4-flash, pero provider-agnostic (aplica a
    // groq, mistral, gemini-compat, etc. — 14+ providers OpenAI-compat).
    // Backoff exponencial 500ms → 1000ms entre retries; después de 3
    // attempts total, throw EmptyResponseError que el caller (triage.ts)
    // catchea explicit y transforma en verdict `inconclusive` en vez de
    // dejar el finding sin veredicto.
    return retryOnEmptyContent(async () => {
      let completion;
      try {
        completion = await this.#client.chat.completions.create({
          model: this.#model,
          ...tokensParam,
          ...temperatureParam,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        });
      } catch (err) {
        // DG-088 A: convertir 429 / rate-limit en QuotaExhaustedError tipado
        // para que el benchmark runner pueda skip-ear el provider tras 2
        // ocurrencias consecutivas en vez de tratarlo como error opaco.
        const quotaErr = quotaErrorFromOpenAi(err, this.#providerLabel);
        if (quotaErr !== null) throw quotaErr;
        throw err;
      }
      return {
        // parseOpenAiCompatibleResponse throws el "sin texto" error si content
        // es null/'' — retryOnEmptyContent captura ese case específico y
        // reintenta la create+parse desde cero (fresh completion).
        text: parseOpenAiCompatibleResponse(completion),
        usage: parseOpenAiCompatibleUsage(completion),
      };
    }, this.#providerLabel);
  }
}
