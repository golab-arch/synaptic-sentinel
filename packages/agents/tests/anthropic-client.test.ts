import { describe, it, expect } from 'vitest';
import { AnthropicLlmClient, parseAnthropicResponse } from '../src/anthropic-client.js';

describe('parseAnthropicResponse', () => {
  it('extrae y concatena los bloques de texto', () => {
    expect(
      parseAnthropicResponse({
        content: [
          { type: 'text', text: 'hola ' },
          { type: 'text', text: 'mundo' },
        ],
      }),
    ).toBe('hola mundo');
  });

  it('ignora los bloques que no son de texto', () => {
    expect(
      parseAnthropicResponse({
        content: [
          { type: 'tool_use', id: 'x' },
          { type: 'text', text: 'solo esto' },
        ],
      }),
    ).toBe('solo esto');
  });

  it('lanza si la respuesta no trae un arreglo content', () => {
    expect(() => parseAnthropicResponse({})).toThrow();
  });

  it('lanza si no hay ningun bloque de texto', () => {
    expect(() => parseAnthropicResponse({ content: [{ type: 'tool_use' }] })).toThrow();
  });
});

describe('AnthropicLlmClient.complete (vs @anthropic-ai/sdk)', () => {
  it('envia la peticion via el SDK y devuelve el texto de la respuesta', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: unknown;
    const fakeFetch = ((url: string | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(url);
      capturedMethod = init?.method ?? '';
      capturedBody = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'msg_x',
            type: 'message',
            role: 'assistant',
            model: 'claude-haiku-4-5-20251001',
            content: [{ type: 'text', text: 'veredicto' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }) as typeof fetch;

    const client = new AnthropicLlmClient({
      apiKey: 'sk-x',
      fetchImpl: fakeFetch,
      maxRetries: 0,
    });
    const text = await client.complete({ system: 's', user: 'u' });

    expect(text).toBe('veredicto');
    expect(capturedUrl).toContain('api.anthropic.com');
    expect(capturedUrl).toContain('/v1/messages');
    expect(capturedMethod).toBe('POST');
    // El cuerpo es el JSON que el SDK construye a partir de la peticion.
    const body = capturedBody as Record<string, unknown>;
    expect(body['model']).toBe('claude-haiku-4-5-20251001');
    expect(body['system']).toBe('s');
    expect(body['max_tokens']).toBe(1024);
    expect(body['messages']).toEqual([{ role: 'user', content: 'u' }]);
  });

  it('lanza si el endpoint responde con un estado de error (sin reintentos)', async () => {
    const fakeFetch = ((): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
      )) as typeof fetch;
    const client = new AnthropicLlmClient({
      apiKey: 'k',
      fetchImpl: fakeFetch,
      maxRetries: 0,
    });
    await expect(client.complete({ system: 's', user: 'u' })).rejects.toThrow(/429/);
  });
});
