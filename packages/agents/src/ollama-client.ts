import type {
  LlmClient,
  LlmCompletionRequest,
  LlmCompletionResult,
  TokenUsage,
} from './llm-client.js';

/**
 * Cliente LLM contra una instancia local de Ollama (Phase 11 DG-072 B).
 *
 * Ollama expone DOS APIs distintas en el mismo puerto:
 *   - `/v1/chat/completions` — protocolo OpenAI-compatible, basico
 *   - `/api/chat` — API nativa de Ollama, soporta `format` para structured
 *     outputs constrained-by-grammar (XGrammar desde v0.5+)
 *
 * Este cliente usa la API nativa porque la diferencia es el unlock real
 * del posicionamiento "Ollama recommended con ~99% JSON validity"
 * decidido en DG-070: pasando un JSON Schema en `format`, el motor de
 * Ollama fuerza al modelo a producir tokens que conformen al schema a
 * nivel FSM. Sin esto, Sentinel cae a prompt engineering + extractor
 * regex (mismo nivel que cualquier otro provider sin structured outputs
 * nativos, ~85-95% JSON validity en modelos locales segun el discovery
 * de DG-070).
 *
 * Usa `fetch` global (Node 20+) en vez del SDK `ollama` npm para no
 * agregar una dependencia que no aporta sobre HTTP simple. El bundle de
 * la extension NO va a necesitar `--external:ollama` cuando DG-073
 * wiree el cliente al CLI.
 *
 * Ollama corre local sin auth — no hay `apiKey`. El usuario controla
 * el endpoint via `baseUrl` (default `http://localhost:11434`).
 *
 * Caveat conocido: en versiones de Ollama anteriores a v0.5 el campo
 * `format` se ignora silenciosamente y el modelo devuelve JSON pero
 * NO constrained. Esto es indetectable client-side — el cliente igual
 * recibe un string con JSON que parsea. La validez sigue dependiendo
 * del modelo + el extractor `extractJsonObject` (que ya tolera el
 * caso). El benchmark empirico DG-076 va a revelar si XGrammar
 * funciona como esperado en la version instalada del usuario.
 */

/** URL por defecto de una instancia local de Ollama. */
const DEFAULT_BASE_URL = 'http://localhost:11434';
/** Modelo por defecto recomendado en DG-070 (Mistral Nemo: 88% JSON validity sin grammar + 7GB en disco). */
const DEFAULT_MODEL = 'mistral-nemo:12b';
/** Tope de tokens de respuesta por defecto, alineado con los otros adapters. */
const DEFAULT_MAX_TOKENS = 1024;
/** Temperature fija — determinism cross-provider. */
const DETERMINISTIC_TEMPERATURE = 0;
/** Timeout corto para la sonda de auto-discovery — ~1 segundo. */
const PROBE_TIMEOUT_MS = 1000;

/**
 * `format` aceptado por el endpoint `/api/chat` de Ollama. Acepta:
 *   - un objeto JSON Schema (activa XGrammar constrained decoding)
 *   - la cadena literal `"json"` (modo JSON legacy, sin schema enforcement)
 *   - undefined (texto libre — extractor regex en el agente lidia con eso)
 */
export type OllamaFormat = Readonly<Record<string, unknown>> | 'json';

/** Opciones de construccion de un `OllamaLlmClient`. */
export interface OllamaClientOptions {
  /** Endpoint de Ollama. Default `http://localhost:11434`. */
  readonly baseUrl?: string;
  /** Modelo a usar (ej. `mistral-nemo:12b`, `qwen2.5-coder:32b`). */
  readonly model?: string;
  /**
   * Activa structured outputs constrained-by-grammar (XGrammar) si se
   * pasa un JSON Schema. Si se pasa la cadena `"json"`, activa el modo
   * JSON legacy (sin schema enforcement). Si se omite, el modelo
   * responde texto libre y el extractor del agente parsea.
   */
  readonly format?: OllamaFormat;
  /** Implementacion de `fetch` (override para tests). */
  readonly fetchImpl?: typeof fetch;
}

/** Respuesta del endpoint `/api/chat` (forma minima que usamos). */
interface OllamaChatResponse {
  readonly message?: { readonly role?: string; readonly content?: unknown };
}

/**
 * Extrae el texto del payload de respuesta del endpoint `/api/chat` de
 * Ollama (funcion pura).
 */
export function parseOllamaResponse(payload: unknown): string {
  const message = (payload as OllamaChatResponse).message;
  if (message === undefined || message === null) {
    throw new Error('Respuesta de Ollama sin objeto "message".');
  }
  const content = message.content;
  if (typeof content !== 'string' || content === '') {
    throw new Error('Respuesta de Ollama sin texto en "message.content".');
  }
  return content;
}

/**
 * Extrae el `usage` REAL del payload de `/api/chat` de Ollama (DG-085 A).
 * Ollama nativo expone `prompt_eval_count` (tokens del prompt) +
 * `eval_count` (tokens generados) en el payload de cada respuesta. Devuelve
 * `null` si el shape no coincide — algunos modelos antiguos o el modo
 * streaming intermedio pueden no incluirlos.
 */
export function parseOllamaUsage(payload: unknown): TokenUsage | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const input = (payload as { prompt_eval_count?: unknown }).prompt_eval_count;
  const output = (payload as { eval_count?: unknown }).eval_count;
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  if (input < 0 || output < 0) return null;
  return { inputTokens: input, outputTokens: output };
}

/**
 * Cliente LLM contra `/api/chat` de una instancia local de Ollama.
 *
 * Patron identico al `AnthropicLlmClient` y al `OpenAiCompatibleLlmClient`:
 * toda la API queda detras del contrato `LlmClient`, los tests inyectan un
 * `fetch` falso (determinista, sin red) y la unica diferencia funcional
 * es la forma del request (`/api/chat` vs `/v1/messages` o
 * `/v1/chat/completions`) y la forma de la respuesta — `parseOllamaResponse`
 * la absorbe.
 */
export class OllamaLlmClient implements LlmClient {
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #format: OllamaFormat | undefined;
  readonly #fetchImpl: typeof fetch;

  constructor(options: OllamaClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#format = options.format;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    const result = await this.completeWithUsage(request);
    return result.text;
  }

  async completeWithUsage(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const body: Record<string, unknown> = {
      model: this.#model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      stream: false,
      options: {
        temperature: DETERMINISTIC_TEMPERATURE,
        num_predict: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      },
    };
    if (this.#format !== undefined) {
      body['format'] = this.#format;
    }
    const response = await this.#fetchImpl(`${this.#baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Ollama respondio ${String(response.status)} en /api/chat.`);
    }
    const payload: unknown = await response.json();
    return {
      text: parseOllamaResponse(payload),
      usage: parseOllamaUsage(payload),
    };
  }
}

/**
 * Sonda de auto-discovery: devuelve `true` si la instancia de Ollama
 * responde en `baseUrl` dentro del timeout corto (1s).
 *
 * Lo usa la UI (DG-074) para mostrar el badge "✓ Found / ✗ Not found"
 * y la CLI (DG-073) para fallback cuando el config apunta a Ollama
 * pero el daemon no esta corriendo.
 */
export async function isOllamaAvailable(
  baseUrl: string = DEFAULT_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Lista los modelos disponibles localmente en `baseUrl`. Devuelve un
 * array vacio si Ollama no responde o si la respuesta no tiene el
 * shape esperado — no lanza (la UI lo trata como "sin modelos").
 */
export async function listOllamaModels(
  baseUrl: string = DEFAULT_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly string[]> {
  const infos = await listOllamaModelsWithInfo(baseUrl, fetchImpl);
  return infos.map((info) => info.name);
}

/**
 * Info por modelo en una instancia local de Ollama (DG-087 A): nombre + tamaño
 * en bytes (campo nativo del `/api/tags`). Usado por la UI del Settings panel
 * para mostrar el peso de cada modelo y advertir cuando supera el umbral que
 * empiricamente saturo RAM en DG-077 (Gemma 4 9.6 GB / gpt-oss:20b 13 GB).
 */
export interface OllamaModelInfo {
  readonly name: string;
  /** Bytes ocupados en disco — `0` si Ollama no lo reporto para este modelo. */
  readonly sizeBytes: number;
}

/**
 * Lista los modelos disponibles localmente con info de tamaño (DG-087 A).
 * Mismo contrato defensivo que `listOllamaModels`: devuelve `[]` en cualquier
 * error y no lanza. `sizeBytes` cae a `0` si el payload no incluye el field
 * `size` (esto NO descarta el modelo del array — solo neutraliza el warning
 * de RAM en la UI).
 */
export async function listOllamaModelsWithInfo(
  baseUrl: string = DEFAULT_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly OllamaModelInfo[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    const models = (payload as { models?: unknown }).models;
    if (!Array.isArray(models)) return [];
    return models
      .map((entry) => {
        const name = (entry as { name?: unknown }).name;
        const size = (entry as { size?: unknown }).size;
        if (typeof name !== 'string' || name.length === 0) return null;
        const sizeBytes = typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : 0;
        return { name, sizeBytes } satisfies OllamaModelInfo;
      })
      .filter((info): info is OllamaModelInfo => info !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
