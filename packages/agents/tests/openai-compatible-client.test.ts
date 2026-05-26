import { describe, it, expect } from 'vitest';
import {
  OpenAiCompatibleLlmClient,
  parseOpenAiCompatibleResponse,
  parseOpenAiCompatibleUsage,
} from '../src/openai-compatible-client.js';

/** Construye una respuesta OpenAI-compat valida con un mensaje de texto. */
function buildChatCompletion(text: string): Record<string, unknown> {
  return {
    id: 'chatcmpl-x',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-5-nano',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

describe('parseOpenAiCompatibleResponse', () => {
  it('extrae el texto de choices[0].message.content', () => {
    expect(parseOpenAiCompatibleResponse(buildChatCompletion('veredicto'))).toBe('veredicto');
  });

  it('lanza si la respuesta no trae un arreglo choices', () => {
    expect(() => parseOpenAiCompatibleResponse({})).toThrow();
  });

  it('lanza si choices esta vacio', () => {
    expect(() => parseOpenAiCompatibleResponse({ choices: [] })).toThrow();
  });

  it('lanza si content es null (solo tool_calls)', () => {
    expect(() =>
      parseOpenAiCompatibleResponse({
        choices: [{ message: { role: 'assistant', content: null } }],
      }),
    ).toThrow();
  });

  it('lanza si content es cadena vacia', () => {
    expect(() =>
      parseOpenAiCompatibleResponse({
        choices: [{ message: { role: 'assistant', content: '' } }],
      }),
    ).toThrow();
  });
});

describe('OpenAiCompatibleLlmClient.complete (vs openai SDK)', () => {
  it('envia la peticion via el SDK contra el endpoint default y devuelve el texto', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: unknown;
    let capturedAuth = '';
    const fakeFetch = ((url: string | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(url);
      capturedMethod = init?.method ?? '';
      capturedBody = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get('authorization') ?? '';
      return Promise.resolve(
        new Response(JSON.stringify(buildChatCompletion('veredicto')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    const client = new OpenAiCompatibleLlmClient({
      apiKey: 'sk-x',
      fetchImpl: fakeFetch,
      maxRetries: 0,
    });
    const text = await client.complete({ system: 's', user: 'u' });

    expect(text).toBe('veredicto');
    // Default del SDK = api.openai.com cuando baseUrl no se pasa.
    expect(capturedUrl).toContain('api.openai.com');
    expect(capturedUrl).toContain('/chat/completions');
    expect(capturedMethod).toBe('POST');
    expect(capturedAuth).toBe('Bearer sk-x');

    const body = capturedBody as Record<string, unknown>;
    expect(body['model']).toBe('gpt-5-nano');
    // gpt-5* exige max_completion_tokens (descubierto en el PILOT de DG-077);
    // el adapter hace el switch automatico por prefijo del model name.
    expect(body['max_completion_tokens']).toBe(1024);
    expect(body['max_tokens']).toBeUndefined();
    // gpt-5* tambien rechaza temperature=0 — solo acepta el default (1).
    // Por eso para gpt-5* el adapter OMITE el campo temperature y deja que el
    // modelo use su default. Caveat documentado en el adapter.
    expect(body['temperature']).toBeUndefined();
    expect(body['response_format']).toEqual({ type: 'json_object' });
    expect(body['messages']).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]);
  });

  it('respeta el baseUrl override (apuntando a Groq) y el model elegido', async () => {
    let capturedUrl = '';
    let capturedBody: unknown;
    const fakeFetch = ((url: string | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(url);
      capturedBody = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
      return Promise.resolve(
        new Response(JSON.stringify(buildChatCompletion('groq response')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    const client = new OpenAiCompatibleLlmClient({
      apiKey: 'gsk_x',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      fetchImpl: fakeFetch,
      maxRetries: 0,
    });
    const text = await client.complete({ system: 's', user: 'u', maxTokens: 256 });

    expect(text).toBe('groq response');
    expect(capturedUrl).toContain('api.groq.com');
    expect(capturedUrl).toContain('/openai/v1');
    expect(capturedUrl).toContain('/chat/completions');

    const body = capturedBody as Record<string, unknown>;
    expect(body['model']).toBe('llama-3.3-70b-versatile');
    // Llama (no gpt-5*) sigue usando max_tokens clasico.
    expect(body['max_tokens']).toBe(256);
    expect(body['max_completion_tokens']).toBeUndefined();
    expect(body['response_format']).toEqual({ type: 'json_object' });
  });

  it('lanza si el endpoint responde con un estado de error (sin reintentos)', async () => {
    const fakeFetch = ((): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
      )) as typeof fetch;
    const client = new OpenAiCompatibleLlmClient({
      apiKey: 'k',
      fetchImpl: fakeFetch,
      maxRetries: 0,
    });
    await expect(client.complete({ system: 's', user: 'u' })).rejects.toThrow(/429/);
  });
});

describe('parseOpenAiCompatibleUsage (DG-085 A)', () => {
  it('extrae prompt_tokens y completion_tokens del payload', () => {
    expect(
      parseOpenAiCompatibleUsage({
        usage: { prompt_tokens: 88, completion_tokens: 22, total_tokens: 110 },
      }),
    ).toEqual({ inputTokens: 88, outputTokens: 22 });
  });

  it('devuelve null si falta el campo usage', () => {
    expect(parseOpenAiCompatibleUsage({ choices: [] })).toBeNull();
  });

  it('devuelve null si los counts no son numeros finitos no negativos', () => {
    expect(
      parseOpenAiCompatibleUsage({ usage: { prompt_tokens: '88', completion_tokens: 22 } }),
    ).toBeNull();
    expect(
      parseOpenAiCompatibleUsage({ usage: { prompt_tokens: -1, completion_tokens: 22 } }),
    ).toBeNull();
  });
});

describe('OpenAiCompatibleLlmClient.completeWithUsage (DG-085 A)', () => {
  it('devuelve text + usage real extraido del response', async () => {
    const fakeFetch = ((): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify(buildChatCompletion('respuesta')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )) as typeof fetch;
    const client = new OpenAiCompatibleLlmClient({
      apiKey: 'sk-x',
      fetchImpl: fakeFetch,
      maxRetries: 0,
    });
    const result = await client.completeWithUsage({ system: 's', user: 'u' });
    expect(result.text).toBe('respuesta');
    expect(result.usage).toEqual({ inputTokens: 1, outputTokens: 1 });
  });
});
