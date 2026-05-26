import { proxyTokenCount } from '@synaptic-sentinel/core';
import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from './llm-client.js';

/**
 * Decorator pattern sobre `LlmClient` que registra tokens, latencia y un
 * sample del raw response de CADA call (DG-078 B + DG-085 A).
 *
 * Mantiene intacto el contrato `LlmClient.complete(req): Promise<string>`
 * — los 3 agentes del Brain Layer (`TriageAgent` / `ContextAgent` /
 * `RemediationAgent`) NO se enteran de que el client está siendo
 * observado. Caller-side wrapping: el comando `triage` envuelve el cliente
 * antes de pasarlo a `runAgent`, drena los `records` después, los
 * persiste en `colony.db` y los imprime en el summary.
 *
 * **Fuente de tokens (DG-085 A)**: si el inner client implementa
 * `completeWithUsage` y el provider expone usage real, se usa eso —
 * `usageSource: 'provider'`. Si el inner no lo implementa o el provider
 * no incluye usage en el response, se cae a `proxyTokenCount` = `chars/4`
 * con `usageSource: 'proxy'` (caveat documentado, ±15-20% vs facturado
 * real del provider).
 */

/** Origen de los counts de tokens reportados (DG-085 A). */
export type TokenUsageSource = 'provider' | 'proxy';

/** Una sola observación de un `complete()` exitoso o fallido. */
export interface TokenUsageObservation {
  /** Tokens del system + user prompt. */
  readonly inputTokens: number;
  /** Tokens del raw response. 0 si la call falló. */
  readonly outputTokens: number;
  /** Latencia end-to-end de la call (ms). */
  readonly latencyMs: number;
  /** `true` si la call retornó raw exitosamente; `false` si lanzó. */
  readonly ok: boolean;
  /** Mensaje de error si `ok=false`. */
  readonly errorMessage?: string;
  /**
   * Origen de los counts (DG-085 A): `'provider'` si vienen del usage real
   * del response, `'proxy'` si vienen de la heurística `chars/4`. Sirve
   * para que el caller imprima el caveat apropiado en el summary.
   */
  readonly usageSource: TokenUsageSource;
}

/** Detecta si el cliente implementa la extension opcional del contrato. */
function hasCompleteWithUsage(client: LlmClient): client is LlmClient &
  Required<Pick<LlmClient, 'completeWithUsage'>> & {
    completeWithUsage(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
  } {
  return typeof client.completeWithUsage === 'function';
}

/** Decorator de un `LlmClient`. Recolecta observaciones de cada call. */
export class TokenTrackingLlmClient implements LlmClient {
  readonly #inner: LlmClient;
  readonly #observations: TokenUsageObservation[] = [];

  constructor(inner: LlmClient) {
    this.#inner = inner;
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    const proxyInputTokens = proxyTokenCount(request.system) + proxyTokenCount(request.user);
    const start = Date.now();
    if (hasCompleteWithUsage(this.#inner)) {
      let result: LlmCompletionResult;
      try {
        result = await this.#inner.completeWithUsage(request);
      } catch (err) {
        const latencyMs = Date.now() - start;
        this.#observations.push({
          inputTokens: proxyInputTokens,
          outputTokens: 0,
          latencyMs,
          ok: false,
          errorMessage: err instanceof Error ? err.message : String(err),
          // Fallo antes de tener usage real → la unica info disponible es la proxy del prompt.
          usageSource: 'proxy',
        });
        throw err;
      }
      const latencyMs = Date.now() - start;
      // Preferir usage real del provider si esta disponible; caer a proxy si no.
      if (result.usage !== null) {
        this.#observations.push({
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          latencyMs,
          ok: true,
          usageSource: 'provider',
        });
      } else {
        this.#observations.push({
          inputTokens: proxyInputTokens,
          outputTokens: proxyTokenCount(result.text),
          latencyMs,
          ok: true,
          usageSource: 'proxy',
        });
      }
      return result.text;
    }
    // Legacy path: el inner solo implementa `complete` (ej. tests con fakes).
    let raw: string;
    try {
      raw = await this.#inner.complete(request);
    } catch (err) {
      const latencyMs = Date.now() - start;
      this.#observations.push({
        inputTokens: proxyInputTokens,
        outputTokens: 0,
        latencyMs,
        ok: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        usageSource: 'proxy',
      });
      throw err;
    }
    const latencyMs = Date.now() - start;
    this.#observations.push({
      inputTokens: proxyInputTokens,
      outputTokens: proxyTokenCount(raw),
      latencyMs,
      ok: true,
      usageSource: 'proxy',
    });
    return raw;
  }

  /** Snapshot inmutable de las observaciones registradas hasta ahora. */
  get observations(): readonly TokenUsageObservation[] {
    return [...this.#observations];
  }

  /** Limpia el buffer (útil entre sesiones reutilizando el wrapper). */
  reset(): void {
    this.#observations.length = 0;
  }
}
