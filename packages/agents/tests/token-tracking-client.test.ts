import { describe, it, expect } from 'vitest';
import { TokenTrackingLlmClient } from '../src/token-tracking-client.js';
import type { LlmClient, LlmCompletionRequest } from '../src/llm-client.js';

/** Fake LlmClient determinista para los tests. */
function makeFake(response: string, latencyMs = 5): LlmClient {
  return {
    complete: (_req: LlmCompletionRequest): Promise<string> => {
      void _req;
      return new Promise((res) =>
        setTimeout(() => {
          res(response);
        }, latencyMs),
      );
    },
  };
}

/** Fake LlmClient que lanza. */
function makeFailingFake(message: string): LlmClient {
  return {
    complete: (): Promise<string> => Promise.reject(new Error(message)),
  };
}

describe('TokenTrackingLlmClient', () => {
  it('pasa la request al cliente envuelto y devuelve la respuesta', async () => {
    const inner = makeFake('hello world response');
    const wrapped = new TokenTrackingLlmClient(inner);
    const result = await wrapped.complete({ system: 'sys', user: 'usr' });
    expect(result).toBe('hello world response');
  });

  it('registra una observation con tokens proxy + latencia + ok=true', async () => {
    const inner = makeFake('xxxx xxxx xxxx'); // 14 chars -> ceil(14/4) = 4 tokens
    const wrapped = new TokenTrackingLlmClient(inner);
    await wrapped.complete({ system: 'sys-prompt', user: 'user-message' });
    expect(wrapped.observations).toHaveLength(1);
    const obs = wrapped.observations[0]!;
    // input: "sys-prompt" (10 chars, 3 tokens) + "user-message" (12 chars, 3 tokens) = 6 tokens
    expect(obs.inputTokens).toBe(6);
    // output: "xxxx xxxx xxxx" (14 chars, 4 tokens)
    expect(obs.outputTokens).toBe(4);
    expect(obs.ok).toBe(true);
    expect(obs.errorMessage).toBeUndefined();
    expect(obs.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('registra una observation con ok=false + errorMessage cuando el client lanza', async () => {
    const inner = makeFailingFake('rate limit hit');
    const wrapped = new TokenTrackingLlmClient(inner);
    await expect(wrapped.complete({ system: 's', user: 'u' })).rejects.toThrow('rate limit hit');
    expect(wrapped.observations).toHaveLength(1);
    const obs = wrapped.observations[0]!;
    expect(obs.ok).toBe(false);
    expect(obs.errorMessage).toBe('rate limit hit');
    // output tokens = 0 porque la call fallo
    expect(obs.outputTokens).toBe(0);
    // input tokens > 0 igual (el prompt si se construyo)
    expect(obs.inputTokens).toBeGreaterThan(0);
  });

  it('acumula multiples observations en orden', async () => {
    const inner = makeFake('A');
    const wrapped = new TokenTrackingLlmClient(inner);
    await wrapped.complete({ system: 's1', user: 'u1' });
    await wrapped.complete({ system: 's2', user: 'u2' });
    await wrapped.complete({ system: 's3', user: 'u3' });
    expect(wrapped.observations).toHaveLength(3);
  });

  it('reset() vacia el buffer de observations', async () => {
    const inner = makeFake('A');
    const wrapped = new TokenTrackingLlmClient(inner);
    await wrapped.complete({ system: 's', user: 'u' });
    expect(wrapped.observations).toHaveLength(1);
    wrapped.reset();
    expect(wrapped.observations).toHaveLength(0);
  });

  it('observations es snapshot inmutable (no expone el array interno)', async () => {
    const inner = makeFake('A');
    const wrapped = new TokenTrackingLlmClient(inner);
    await wrapped.complete({ system: 's', user: 'u' });
    const snap = wrapped.observations;
    // Modificar el snapshot NO afecta el buffer interno.
    (snap as { length: number }).length = 0;
    expect(wrapped.observations).toHaveLength(1);
  });
});
