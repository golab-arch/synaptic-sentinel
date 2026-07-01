import { describe, it, expect } from 'vitest';
import {
  EmptyResponseError,
  OpenAiCompatibleLlmClient,
  parseOpenAiCompatibleResponse,
  parseOpenAiCompatibleUsage,
  retryOnEmptyContent,
} from '../src/openai-compatible-client.js';
import { QuotaExhaustedError } from '../src/llm-client.js';

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
    // el adapter hace el switch automatico por prefijo del model name. El
    // default para gpt-5* es 8192 (DG-086 A): los reasoning tokens internos
    // consumen el techo antes de emitir texto visible — 1024 producia
    // content=null el 100% de las veces en el benchmark real.
    expect(body['max_completion_tokens']).toBe(8192);
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

  it('respeta el maxTokens override del caller incluso para gpt-5* (DG-086 A)', async () => {
    // Anti-regresion: el bump del default a 8192 NO debe pisar un override
    // explicito del caller. Cuando request.maxTokens viene seteado, se usa
    // ese valor independientemente del model.
    let capturedBody: unknown;
    const fakeFetch = ((_url: string | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
      return Promise.resolve(
        new Response(JSON.stringify(buildChatCompletion('ok')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;
    const client = new OpenAiCompatibleLlmClient({
      apiKey: 'sk-x',
      model: 'gpt-5-nano',
      fetchImpl: fakeFetch,
      maxRetries: 0,
    });
    await client.complete({ system: 's', user: 'u', maxTokens: 512 });
    const body = capturedBody as Record<string, unknown>;
    expect(body['max_completion_tokens']).toBe(512);
  });

  it('NO bumpea el default para non-gpt-5* models (regresion guard DG-086 A)', async () => {
    // El bump a 8192 aplica SOLO a gpt-5*. gpt-4o / Llama / Mistral / DeepSeek
    // siguen con el default cross-provider de 1024.
    let capturedBody: unknown;
    const fakeFetch = ((_url: string | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
      return Promise.resolve(
        new Response(JSON.stringify(buildChatCompletion('ok')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;
    const client = new OpenAiCompatibleLlmClient({
      apiKey: 'sk-x',
      model: 'gpt-4o-mini',
      fetchImpl: fakeFetch,
      maxRetries: 0,
    });
    await client.complete({ system: 's', user: 'u' });
    const body = capturedBody as Record<string, unknown>;
    expect(body['max_tokens']).toBe(1024);
    expect(body['max_completion_tokens']).toBeUndefined();
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

describe('OpenAiCompatibleLlmClient — QuotaExhaustedError (DG-088 A)', () => {
  it('lanza QuotaExhaustedError cuando el provider responde HTTP 429', async () => {
    const fakeFetch = ((): Promise<Response> =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              type: 'rate_limit_exceeded',
              message:
                'You exceeded your current quota, please check your plan and billing details.',
            },
          }),
          {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '60' },
          },
        ),
      )) as typeof fetch;
    const client = new OpenAiCompatibleLlmClient({
      apiKey: 'sk-x',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      fetchImpl: fakeFetch,
      maxRetries: 0,
    });
    await expect(client.complete({ system: 's', user: 'u' })).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    );
  });

  it('preserva errores NO-quota como Error genérico (regresion guard)', async () => {
    const fakeFetch = ((): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'internal server error' } }), {
          status: 500,
        }),
      )) as typeof fetch;
    const client = new OpenAiCompatibleLlmClient({
      apiKey: 'sk-x',
      fetchImpl: fakeFetch,
      maxRetries: 0,
    });
    const err = await client.complete({ system: 's', user: 'u' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(QuotaExhaustedError);
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

// ============================================================================
// DG-125 A (Cycle 112 FASE I): retryOnEmptyContent + EmptyResponseError
// ============================================================================

describe('DG-125 A — retryOnEmptyContent helper', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const noSleep = (_ms: number): Promise<void> => Promise.resolve();

  it('devuelve el resultado inmediatamente si el primer attempt tiene éxito', async () => {
    let attempts = 0;
    const result = await retryOnEmptyContent(
      () => {
        attempts += 1;
        return Promise.resolve('ok');
      },
      'provider-x',
      { sleepImpl: noSleep },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(1);
  });

  it('reintenta 1 vez si el primer attempt lanza empty, y devuelve el segundo', async () => {
    let attempts = 0;
    const result = await retryOnEmptyContent(
      () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Respuesta OpenAI-compatible sin texto en choices[0].message.content.');
        }
        return Promise.resolve('rescued');
      },
      'provider-x',
      { sleepImpl: noSleep },
    );
    expect(result).toBe('rescued');
    expect(attempts).toBe(2);
  });

  it('reintenta 2 veces si los primeros 2 attempts lanzan empty, y devuelve el tercero', async () => {
    let attempts = 0;
    const result = await retryOnEmptyContent(
      () => {
        attempts += 1;
        if (attempts <= 2) {
          throw new Error('Respuesta OpenAI-compatible sin texto en choices[0].message.content.');
        }
        return Promise.resolve('rescued at 3rd');
      },
      'provider-x',
      { sleepImpl: noSleep },
    );
    expect(result).toBe('rescued at 3rd');
    expect(attempts).toBe(3);
  });

  it('lanza EmptyResponseError después de 3 attempts fallidos (2 retries maxRetries default)', async () => {
    let attempts = 0;
    await expect(
      retryOnEmptyContent(
        () => {
          attempts += 1;
          throw new Error('Respuesta OpenAI-compatible sin texto en choices[0].message.content.');
        },
        'deepseek-v4-flash',
        { sleepImpl: noSleep },
      ),
    ).rejects.toThrow(EmptyResponseError);
    expect(attempts).toBe(3);
  });

  it('EmptyResponseError carries providerLabel + attemptsExhausted', async () => {
    let caught: unknown = null;
    try {
      await retryOnEmptyContent(
        () => {
          throw new Error('Respuesta OpenAI-compatible sin texto en choices[0].message.content.');
        },
        'groq-llama',
        { sleepImpl: noSleep, maxRetries: 1 },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EmptyResponseError);
    const e = caught as EmptyResponseError;
    expect(e.providerLabel).toBe('groq-llama');
    expect(e.attemptsExhausted).toBe(2); // maxRetries=1 → 1 initial + 1 retry = 2 total
  });

  it('propaga errores NO-empty inmediatamente sin retry (network, quota, schema drift)', async () => {
    let attempts = 0;
    await expect(
      retryOnEmptyContent(
        () => {
          attempts += 1;
          throw new Error('ECONNRESET: network glitch');
        },
        'provider-x',
        { sleepImpl: noSleep },
      ),
    ).rejects.toThrow('ECONNRESET');
    // Solo 1 attempt — no retry para errores non-empty
    expect(attempts).toBe(1);
  });

  it('completeWithUsage integra el retry: rescata el segundo attempt cuando el primero devuelve content=null', async () => {
    // Fake fetch que devuelve content=null en el primer call, luego texto valido.
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const fakeFetch = (async (_url: string | URL, _init?: RequestInit): Promise<Response> => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            id: 'chatcmpl-empty',
            object: 'chat.completion',
            created: 0,
            model: 'deepseek-v4-flash',
            choices: [
              { index: 0, message: { role: 'assistant', content: null }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-ok',
          object: 'chat.completion',
          created: 0,
          model: 'deepseek-v4-flash',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{"veredicto":"ok"}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const client = new OpenAiCompatibleLlmClient({
      apiKey: 'sk-x',
      model: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1',
      fetchImpl: fakeFetch,
      maxRetries: 0, // SDK-level retries off — el retry de DG-125 A es application-level
    });

    // El retry (con backoff exponencial 500ms default) hace este test lento;
    // pero como el segundo attempt tiene exito, solo espera ~500ms. Aceptable.
    const result = await client.completeWithUsage({ system: 's', user: 'u' });
    expect(result.text).toBe('{"veredicto":"ok"}');
    expect(callCount).toBe(2); // 1 empty + 1 rescued
  }, 5000);
});
