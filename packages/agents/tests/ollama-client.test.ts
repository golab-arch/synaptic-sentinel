import { describe, it, expect } from 'vitest';
import {
  OllamaLlmClient,
  isOllamaAvailable,
  listOllamaModels,
  parseOllamaResponse,
} from '../src/ollama-client.js';

/** Construye un payload `/api/chat` valido con el texto dado en message.content. */
function buildChatResponse(text: string): Record<string, unknown> {
  return {
    model: 'mistral-nemo:12b',
    created_at: '2026-05-23T18:30:00Z',
    message: { role: 'assistant', content: text },
    done: true,
  };
}

/** Construye un payload `/api/tags` con la lista de modelos dada. */
function buildTagsResponse(names: readonly string[]): Record<string, unknown> {
  return {
    models: names.map((name) => ({
      name,
      modified_at: '2026-05-23T00:00:00Z',
      size: 7_000_000_000,
    })),
  };
}

describe('parseOllamaResponse', () => {
  it('extrae el texto de message.content', () => {
    expect(parseOllamaResponse(buildChatResponse('veredicto'))).toBe('veredicto');
  });

  it('lanza si la respuesta no trae el objeto message', () => {
    expect(() => parseOllamaResponse({})).toThrow();
  });

  it('lanza si message.content no es string', () => {
    expect(() => parseOllamaResponse({ message: { content: null } })).toThrow();
  });

  it('lanza si message.content es cadena vacia', () => {
    expect(() => parseOllamaResponse({ message: { content: '' } })).toThrow();
  });
});

describe('OllamaLlmClient.complete', () => {
  it('POSTea a /api/chat en el default localhost:11434 con el body correcto', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: unknown;
    const fakeFetch = ((url: string | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(url);
      capturedMethod = init?.method ?? '';
      capturedBody = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
      return Promise.resolve(
        new Response(JSON.stringify(buildChatResponse('veredicto')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    const client = new OllamaLlmClient({ fetchImpl: fakeFetch });
    const text = await client.complete({ system: 's', user: 'u' });

    expect(text).toBe('veredicto');
    // Endpoint nativo de Ollama, NO el OpenAI-compat.
    expect(capturedUrl).toBe('http://localhost:11434/api/chat');
    expect(capturedMethod).toBe('POST');

    const body = capturedBody as Record<string, unknown>;
    expect(body['model']).toBe('mistral-nemo:12b'); // default recomendado
    expect(body['stream']).toBe(false);
    expect(body['messages']).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]);
    expect(body['options']).toEqual({
      temperature: 0, // determinism hardcoded
      num_predict: 1024, // default maxTokens
    });
    expect(body['format']).toBeUndefined(); // sin XGrammar cuando no se pasa
  });

  it('respeta baseUrl override + modelo custom + maxTokens custom', async () => {
    let capturedUrl = '';
    let capturedBody: unknown;
    const fakeFetch = ((url: string | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(url);
      capturedBody = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
      return Promise.resolve(
        new Response(JSON.stringify(buildChatResponse('ok')), {
          status: 200,
        }),
      );
    }) as typeof fetch;

    const client = new OllamaLlmClient({
      baseUrl: 'http://10.0.0.5:11434/', // con trailing slash para ejercitar el normalize
      model: 'qwen2.5-coder:32b',
      fetchImpl: fakeFetch,
    });
    await client.complete({ system: 's', user: 'u', maxTokens: 256 });

    expect(capturedUrl).toBe('http://10.0.0.5:11434/api/chat'); // trailing slash normalizado
    const body = capturedBody as Record<string, unknown>;
    expect(body['model']).toBe('qwen2.5-coder:32b');
    expect((body['options'] as Record<string, unknown>)['num_predict']).toBe(256);
  });

  it('incluye format en el body cuando se pasa un JSON Schema (XGrammar opt-in)', async () => {
    let capturedBody: unknown;
    const fakeFetch = ((_url: string | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
      return Promise.resolve(
        new Response(JSON.stringify(buildChatResponse('{"k":"v"}')), { status: 200 }),
      );
    }) as typeof fetch;

    const schema = {
      type: 'object',
      properties: { k: { type: 'string' } },
      required: ['k'],
    } as const;
    const client = new OllamaLlmClient({ format: schema, fetchImpl: fakeFetch });
    await client.complete({ system: 's', user: 'u' });

    const body = capturedBody as Record<string, unknown>;
    expect(body['format']).toEqual(schema);
  });

  it('acepta format: "json" (modo JSON legacy sin schema)', async () => {
    let capturedBody: unknown;
    const fakeFetch = ((_url: string | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
      return Promise.resolve(
        new Response(JSON.stringify(buildChatResponse('{}')), { status: 200 }),
      );
    }) as typeof fetch;

    const client = new OllamaLlmClient({ format: 'json', fetchImpl: fakeFetch });
    await client.complete({ system: 's', user: 'u' });

    expect((capturedBody as Record<string, unknown>)['format']).toBe('json');
  });

  it('lanza si Ollama responde con un estado de error (ej. 404 - modelo no descargado)', async () => {
    const fakeFetch = ((): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'model not found' }), { status: 404 }),
      )) as typeof fetch;
    const client = new OllamaLlmClient({ fetchImpl: fakeFetch });
    await expect(client.complete({ system: 's', user: 'u' })).rejects.toThrow(/404/);
  });
});

describe('isOllamaAvailable (auto-discovery)', () => {
  it('devuelve true cuando GET /api/tags responde 200', async () => {
    let capturedUrl = '';
    const fakeFetch = ((url: string | URL): Promise<Response> => {
      capturedUrl = String(url);
      return Promise.resolve(
        new Response(JSON.stringify(buildTagsResponse(['mistral-nemo:12b'])), {
          status: 200,
        }),
      );
    }) as typeof fetch;

    const available = await isOllamaAvailable(undefined, fakeFetch);
    expect(available).toBe(true);
    expect(capturedUrl).toBe('http://localhost:11434/api/tags'); // default endpoint
  });

  it('devuelve false cuando fetch falla (Ollama no esta corriendo)', async () => {
    const fakeFetch = ((): Promise<Response> =>
      Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch;
    const available = await isOllamaAvailable(undefined, fakeFetch);
    expect(available).toBe(false);
  });

  it('devuelve false cuando GET /api/tags responde con un estado de error', async () => {
    const fakeFetch = ((): Promise<Response> =>
      Promise.resolve(new Response('Internal Server Error', { status: 500 }))) as typeof fetch;
    const available = await isOllamaAvailable(undefined, fakeFetch);
    expect(available).toBe(false);
  });
});

describe('listOllamaModels', () => {
  it('devuelve los nombres de modelos del payload de /api/tags', async () => {
    const fakeFetch = ((): Promise<Response> =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            buildTagsResponse(['mistral-nemo:12b', 'qwen2.5-coder:32b', 'llama3.3:70b']),
          ),
          { status: 200 },
        ),
      )) as typeof fetch;

    const models = await listOllamaModels(undefined, fakeFetch);
    expect(models).toEqual(['mistral-nemo:12b', 'qwen2.5-coder:32b', 'llama3.3:70b']);
  });

  it('devuelve [] cuando Ollama no responde (fetch rechaza)', async () => {
    const fakeFetch = ((): Promise<Response> =>
      Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch;
    const models = await listOllamaModels(undefined, fakeFetch);
    expect(models).toEqual([]);
  });

  it('devuelve [] cuando la respuesta no tiene la forma esperada', async () => {
    const fakeFetch = ((): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
      )) as typeof fetch;
    const models = await listOllamaModels(undefined, fakeFetch);
    expect(models).toEqual([]);
  });
});
