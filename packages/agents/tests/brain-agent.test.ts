import { describe, it, expect } from 'vitest';
import { extractJsonObject, runAgent, type BrainAgent } from '../src/brain-agent.js';
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

describe('extractJsonObject', () => {
  it('extrae un objeto JSON plano', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('tolera un bloque de codigo markdown', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('tolera prosa alrededor del objeto', () => {
    expect(extractJsonObject('Aqui esta el veredicto: {"a":1} listo.')).toBe('{"a":1}');
  });

  it('lanza si no hay ningun objeto JSON', () => {
    expect(() => extractJsonObject('sin json aqui')).toThrow();
  });
});
