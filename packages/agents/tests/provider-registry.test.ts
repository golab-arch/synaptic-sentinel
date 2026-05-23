import { describe, it, expect } from 'vitest';
import {
  AGENT_OUTPUT_SCHEMAS,
  CONTEXT_EXPLANATION_JSON_SCHEMA,
  REMEDIATION_SUGGESTION_JSON_SCHEMA,
  TRIAGE_VERDICT_JSON_SCHEMA,
  type AgentConfig,
} from '@synaptic-sentinel/core';
import { AnthropicLlmClient } from '../src/anthropic-client.js';
import { OllamaLlmClient } from '../src/ollama-client.js';
import { OpenAiCompatibleLlmClient } from '../src/openai-compatible-client.js';
import {
  ANTHROPIC_FALLBACK_MODEL,
  apiKeyEnvVarName,
  buildAnthropicFallbackConfig,
  createLlmClient,
  providerRequiresApiKey,
  resolveApiKeyFromEnv,
} from '../src/provider-registry.js';

const fakeFetch = (() => Promise.resolve(new Response('{}'))) as typeof fetch;

describe('AGENT_OUTPUT_SCHEMAS (literal JSON Schemas for XGrammar)', () => {
  it('mapea cada agente a su schema correspondiente', () => {
    expect(AGENT_OUTPUT_SCHEMAS.triage).toBe(TRIAGE_VERDICT_JSON_SCHEMA);
    expect(AGENT_OUTPUT_SCHEMAS.context).toBe(CONTEXT_EXPLANATION_JSON_SCHEMA);
    expect(AGENT_OUTPUT_SCHEMAS.remediation).toBe(REMEDIATION_SUGGESTION_JSON_SCHEMA);
  });

  it('los 3 schemas declaran type:object + required fields', () => {
    for (const id of ['triage', 'context', 'remediation'] as const) {
      const schema = AGENT_OUTPUT_SCHEMAS[id] as { type?: string; required?: string[] };
      expect(schema.type).toBe('object');
      expect(Array.isArray(schema.required)).toBe(true);
      expect((schema.required ?? []).length).toBeGreaterThan(0);
    }
  });
});

describe('providerRequiresApiKey', () => {
  it('ollama NO requiere apiKey (local sin auth)', () => {
    expect(providerRequiresApiKey('ollama')).toBe(false);
  });

  it('todos los demas providers requieren apiKey', () => {
    const providers = [
      'anthropic',
      'openai',
      'groq',
      'deepseek',
      'mistral',
      'together',
      'fireworks',
      'perplexity',
      'xai',
      'gemini',
      'bedrock',
      'azure',
    ] as const;
    for (const provider of providers) {
      expect(providerRequiresApiKey(provider)).toBe(true);
    }
  });
});

describe('createLlmClient — dispatch por provider', () => {
  it('anthropic devuelve un AnthropicLlmClient', () => {
    const config: AgentConfig = { provider: 'anthropic', model: 'claude-sonnet-4-6' };
    const client = createLlmClient({
      config,
      apiKey: 'sk-x',
      agentId: 'triage',
      fetchImpl: fakeFetch,
    });
    expect(client).toBeInstanceOf(AnthropicLlmClient);
  });

  it('ollama devuelve un OllamaLlmClient con el JSON Schema del agente', () => {
    const config: AgentConfig = { provider: 'ollama', model: 'mistral-nemo:12b' };
    const client = createLlmClient({ config, agentId: 'triage', fetchImpl: fakeFetch });
    expect(client).toBeInstanceOf(OllamaLlmClient);
  });

  it('groq / deepseek / mistral / openai todos devuelven OpenAiCompatibleLlmClient', () => {
    for (const provider of ['groq', 'deepseek', 'mistral', 'openai'] as const) {
      const config: AgentConfig = { provider, model: 'some-model' };
      const client = createLlmClient({
        config,
        apiKey: 'k',
        agentId: 'triage',
        fetchImpl: fakeFetch,
      });
      expect(client).toBeInstanceOf(OpenAiCompatibleLlmClient);
    }
  });

  it('lanza si un provider que requiere apiKey no recibe apiKey', () => {
    const config: AgentConfig = { provider: 'deepseek', model: 'deepseek-v3.2' };
    expect(() => createLlmClient({ config, agentId: 'triage', fetchImpl: fakeFetch })).toThrow(
      /SENTINEL_DEEPSEEK_API_KEY/,
    );
  });

  it('lanza si bedrock o azure no traen baseUrl explicito', () => {
    expect(() =>
      createLlmClient({
        config: { provider: 'bedrock', model: 'anthropic.claude-opus-4' },
        apiKey: 'aws-token',
        agentId: 'triage',
        fetchImpl: fakeFetch,
      }),
    ).toThrow(/baseUrl/);
    expect(() =>
      createLlmClient({
        config: { provider: 'azure', model: 'gpt-5' },
        apiKey: 'azure-token',
        agentId: 'triage',
        fetchImpl: fakeFetch,
      }),
    ).toThrow(/baseUrl/);
  });

  it('bedrock / azure / self-hosted aceptan baseUrl explicito', () => {
    const config: AgentConfig = {
      provider: 'bedrock',
      model: 'anthropic.claude-opus-4',
      baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/v1',
    };
    const client = createLlmClient({
      config,
      apiKey: 'aws-token',
      agentId: 'triage',
      fetchImpl: fakeFetch,
    });
    expect(client).toBeInstanceOf(OpenAiCompatibleLlmClient);
  });
});

describe('apiKeyEnvVarName', () => {
  it('produce el patron estandar SENTINEL_<PROVIDER>_API_KEY', () => {
    expect(apiKeyEnvVarName('anthropic')).toBe('SENTINEL_ANTHROPIC_API_KEY');
    expect(apiKeyEnvVarName('deepseek')).toBe('SENTINEL_DEEPSEEK_API_KEY');
    expect(apiKeyEnvVarName('xai')).toBe('SENTINEL_XAI_API_KEY');
  });
});

describe('resolveApiKeyFromEnv', () => {
  it('resuelve desde la env var namespaceada', () => {
    const env = { SENTINEL_DEEPSEEK_API_KEY: 'sk-deep' };
    expect(resolveApiKeyFromEnv('deepseek', env)).toBe('sk-deep');
  });

  it('para anthropic acepta tambien la legacy ANTHROPIC_API_KEY (retro-compat v0.2.0)', () => {
    const env = { ANTHROPIC_API_KEY: 'sk-ant-legacy' };
    expect(resolveApiKeyFromEnv('anthropic', env)).toBe('sk-ant-legacy');
  });

  it('la namespaceada gana sobre la legacy', () => {
    const env = {
      ANTHROPIC_API_KEY: 'sk-legacy',
      SENTINEL_ANTHROPIC_API_KEY: 'sk-namespaced',
    };
    expect(resolveApiKeyFromEnv('anthropic', env)).toBe('sk-namespaced');
  });

  it('devuelve undefined si no hay ninguna', () => {
    expect(resolveApiKeyFromEnv('deepseek', {})).toBeUndefined();
  });

  it('devuelve undefined si la env var existe pero es cadena vacia', () => {
    expect(resolveApiKeyFromEnv('deepseek', { SENTINEL_DEEPSEEK_API_KEY: '' })).toBeUndefined();
  });
});

describe('buildAnthropicFallbackConfig (retro-compat v0.2.0)', () => {
  it('construye una config con los 3 agentes apuntando a Anthropic Haiku 4.5', () => {
    const config = buildAnthropicFallbackConfig();
    expect(config.agents.triage.provider).toBe('anthropic');
    expect(config.agents.triage.model).toBe(ANTHROPIC_FALLBACK_MODEL);
    expect(config.agents.context.provider).toBe('anthropic');
    expect(config.agents.remediation.provider).toBe('anthropic');
  });
});
