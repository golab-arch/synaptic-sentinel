import { describe, it, expect } from 'vitest';
import { mergeAgentConfig } from '../src/agents-config-merge.js';
import type { AgentsConfig } from '@synaptic-sentinel/core';

/** Construye una AgentsConfig base Anthropic-only (igual al fallback). */
function baseConfig(): AgentsConfig {
  const agent = { provider: 'anthropic' as const, model: 'claude-haiku-4-5-20251001' };
  return { agents: { triage: agent, context: agent, remediation: agent } };
}

describe('mergeAgentConfig (DG-090 A — helper puro testeable)', () => {
  it('aplica el merge solo al agente especificado, deja los otros 2 intactos', () => {
    const out = mergeAgentConfig(baseConfig(), 'triage', 'deepseek', 'deepseek-v4-flash');
    expect(out).not.toBeNull();
    expect(out!.agents.triage).toEqual({ provider: 'deepseek', model: 'deepseek-v4-flash' });
    expect(out!.agents.context.provider).toBe('anthropic');
    expect(out!.agents.remediation.provider).toBe('anthropic');
  });

  it('preserva inmutabilidad: NO muta el objeto current', () => {
    const current = baseConfig();
    const snapshot = JSON.stringify(current);
    mergeAgentConfig(current, 'triage', 'deepseek', 'deepseek-v4-flash');
    expect(JSON.stringify(current)).toBe(snapshot);
  });

  it('trims whitespace del model name', () => {
    const out = mergeAgentConfig(baseConfig(), 'context', 'anthropic', '  claude-sonnet-4-6  ');
    expect(out!.agents.context.model).toBe('claude-sonnet-4-6');
  });

  it('devuelve null si agentId no es triage/context/remediation', () => {
    expect(mergeAgentConfig(baseConfig(), 'unknown-agent', 'anthropic', 'm')).toBeNull();
    expect(mergeAgentConfig(baseConfig(), null, 'anthropic', 'm')).toBeNull();
    expect(mergeAgentConfig(baseConfig(), 42, 'anthropic', 'm')).toBeNull();
  });

  it('devuelve null si provider no esta en PROVIDER_NAMES (anti-typo / anti-injection)', () => {
    expect(mergeAgentConfig(baseConfig(), 'triage', 'unknown-provider', 'm')).toBeNull();
    expect(mergeAgentConfig(baseConfig(), 'triage', '', 'm')).toBeNull();
    expect(mergeAgentConfig(baseConfig(), 'triage', 42, 'm')).toBeNull();
  });

  it('devuelve null si el model es vacio o solo whitespace', () => {
    expect(mergeAgentConfig(baseConfig(), 'triage', 'anthropic', '')).toBeNull();
    expect(mergeAgentConfig(baseConfig(), 'triage', 'anthropic', '   ')).toBeNull();
    expect(mergeAgentConfig(baseConfig(), 'triage', 'anthropic', 42)).toBeNull();
  });

  it('soporta los 13 providers conocidos (anthropic + 11 openai-compat + ollama)', () => {
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
      'ollama',
    ];
    for (const provider of providers) {
      const out = mergeAgentConfig(baseConfig(), 'remediation', provider, 'some-model');
      expect(out).not.toBeNull();
      expect(out!.agents.remediation.provider).toBe(provider);
    }
  });
});
