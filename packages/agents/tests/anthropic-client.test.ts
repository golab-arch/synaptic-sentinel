import { describe, it, expect } from 'vitest';
import {
  AnthropicLlmClient,
  buildAnthropicRequest,
  parseAnthropicResponse,
} from '../src/anthropic-client.js';

describe('buildAnthropicRequest', () => {
  it('construye la peticion a la Messages API con headers y body correctos', () => {
    const req = buildAnthropicRequest(
      { apiKey: 'sk-test' },
      { system: 'eres un analista', user: 'tria esto' },
    );
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers['x-api-key']).toBe('sk-test');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    expect(req.headers['content-type']).toBe('application/json');

    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body['model']).toBe('claude-haiku-4-5-20251001');
    expect(body['system']).toBe('eres un analista');
    expect(body['max_tokens']).toBe(1024);
    expect(body['messages']).toEqual([{ role: 'user', content: 'tria esto' }]);
  });

  it('respeta el modelo, la URL base y el maxTokens cuando se proveen', () => {
    const req = buildAnthropicRequest(
      { apiKey: 'k', model: 'claude-opus-4-7', baseUrl: 'http://localhost/x' },
      { system: 's', user: 'u', maxTokens: 256 },
    );
    expect(req.url).toBe('http://localhost/x');
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body['model']).toBe('claude-opus-4-7');
    expect(body['max_tokens']).toBe(256);
  });
});

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

describe('AnthropicLlmClient.complete', () => {
  it('envia la peticion y devuelve el texto de la respuesta', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fakeFetch = ((url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'veredicto' }] }), {
          status: 200,
        }),
      );
    }) as typeof fetch;

    const client = new AnthropicLlmClient({ apiKey: 'sk-x', fetchImpl: fakeFetch });
    const text = await client.complete({ system: 's', user: 'u' });

    expect(text).toBe('veredicto');
    expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(capturedInit?.method).toBe('POST');
  });

  it('lanza si el endpoint responde con un estado de error', async () => {
    const fakeFetch = ((): Promise<Response> =>
      Promise.resolve(new Response('rate limited', { status: 429 }))) as typeof fetch;
    const client = new AnthropicLlmClient({ apiKey: 'k', fetchImpl: fakeFetch });
    await expect(client.complete({ system: 's', user: 'u' })).rejects.toThrow(/429/);
  });
});
