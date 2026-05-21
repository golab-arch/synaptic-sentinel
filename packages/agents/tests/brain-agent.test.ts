import { describe, it, expect } from 'vitest';
import { runAgent, type BrainAgent } from '../src/brain-agent.js';
import type { LlmClient, LlmCompletionRequest } from '../src/llm-client.js';

/** Agente de prueba: construye un prompt y pasa la respuesta a mayusculas. */
const fakeAgent: BrainAgent<string, string> = {
  id: 'fake',
  displayName: 'Fake Agent',
  maxTokens: 123,
  buildPrompt: (input) => ({ system: 'sistema', user: `tarea: ${input}` }),
  parseResponse: (raw) => raw.toUpperCase(),
};

describe('runAgent', () => {
  it('construye el prompt, llama al LLM y parsea la respuesta', async () => {
    const llm: LlmClient = {
      complete: (req) => Promise.resolve(`respuesta a [${req.user}]`),
    };
    const out = await runAgent(fakeAgent, 'hola', llm);
    expect(out).toBe('RESPUESTA A [TAREA: HOLA]');
  });

  it('pasa el maxTokens del agente al LLM', async () => {
    let captured: LlmCompletionRequest | undefined;
    const llm: LlmClient = {
      complete: (req) => {
        captured = req;
        return Promise.resolve('ok');
      },
    };
    await runAgent(fakeAgent, 'x', llm);
    expect(captured?.maxTokens).toBe(123);
    expect(captured?.system).toBe('sistema');
  });
});
