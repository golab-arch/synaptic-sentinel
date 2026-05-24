import { proxyTokenCount } from '@synaptic-sentinel/core';
import type { LlmClient, LlmCompletionRequest } from './llm-client.js';

/**
 * Decorator pattern sobre `LlmClient` que registra tokens, latencia y un
 * sample del raw response de CADA call (DG-078 B).
 *
 * Mantiene intacto el contrato `LlmClient.complete(req): Promise<string>`
 * — los 3 agentes del Brain Layer (`TriageAgent` / `ContextAgent` /
 * `RemediationAgent`) NO se enteran de que el client está siendo
 * observado. Caller-side wraping: el comando `triage` envuelve el cliente
 * antes de pasarlo a `runAgent`, drena los `records` después, los
 * persiste en `colony.db` y los imprime en el summary.
 *
 * **Tokens son PROXIES** (`proxyTokenCount` = `chars/4`). Costo USD se
 * calcula caller-side con `estimateCostUsd` de core; este wrapper solo
 * registra brute counts + latency.
 */

/** Una sola observación de un `complete()` exitoso o fallido. */
export interface TokenUsageObservation {
  /** Tokens estimados del system + user prompt (proxy `chars/4`). */
  readonly inputTokens: number;
  /** Tokens estimados del raw response (proxy `chars/4`). 0 si la call falló. */
  readonly outputTokens: number;
  /** Latencia end-to-end de la call (ms). */
  readonly latencyMs: number;
  /** `true` si la call retornó raw exitosamente; `false` si lanzó. */
  readonly ok: boolean;
  /** Mensaje de error si `ok=false`. */
  readonly errorMessage?: string;
}

/** Decorator de un `LlmClient`. Recolecta observaciones de cada call. */
export class TokenTrackingLlmClient implements LlmClient {
  readonly #inner: LlmClient;
  readonly #observations: TokenUsageObservation[] = [];

  constructor(inner: LlmClient) {
    this.#inner = inner;
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    const inputTokens = proxyTokenCount(request.system) + proxyTokenCount(request.user);
    const start = Date.now();
    let raw: string;
    try {
      raw = await this.#inner.complete(request);
    } catch (err) {
      const latencyMs = Date.now() - start;
      this.#observations.push({
        inputTokens,
        outputTokens: 0,
        latencyMs,
        ok: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    const latencyMs = Date.now() - start;
    this.#observations.push({
      inputTokens,
      outputTokens: proxyTokenCount(raw),
      latencyMs,
      ok: true,
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
