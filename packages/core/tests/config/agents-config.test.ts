import { describe, it, expect } from 'vitest';
import { parseAgentsConfig, parseAgentsConfigYaml } from '../../src/config/agents-config.js';

describe('parseAgentsConfig', () => {
  it('valida una config completa con los 3 agentes', () => {
    const raw = {
      agents: {
        triage: { provider: 'deepseek', model: 'deepseek-v3.2' },
        context: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        remediation: { provider: 'openai', model: 'gpt-5-nano' },
      },
    };
    const config = parseAgentsConfig(raw);
    expect(config.agents.triage.provider).toBe('deepseek');
    expect(config.agents.triage.model).toBe('deepseek-v3.2');
    expect(config.agents.context.provider).toBe('anthropic');
    expect(config.agents.remediation.provider).toBe('openai');
  });

  it('acepta baseUrl opcional', () => {
    const raw = {
      agents: {
        triage: {
          provider: 'ollama',
          model: 'mistral-nemo:12b',
          baseUrl: 'http://10.0.0.5:11434',
        },
        context: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        remediation: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      },
    };
    const config = parseAgentsConfig(raw);
    expect(config.agents.triage.baseUrl).toBe('http://10.0.0.5:11434');
  });

  it('lanza si falta uno de los 3 agentes', () => {
    const raw = {
      agents: {
        triage: { provider: 'anthropic', model: 'claude-haiku-4-5' },
        context: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        // sin remediation
      },
    };
    expect(() => parseAgentsConfig(raw)).toThrow();
  });

  it('lanza con un provider desconocido', () => {
    const raw = {
      agents: {
        triage: { provider: 'pepito-llm', model: 'foo' },
        context: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        remediation: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      },
    };
    expect(() => parseAgentsConfig(raw)).toThrow();
  });

  it('lanza si el model es vacio', () => {
    const raw = {
      agents: {
        triage: { provider: 'anthropic', model: '' },
        context: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        remediation: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      },
    };
    expect(() => parseAgentsConfig(raw)).toThrow();
  });
});

describe('parseAgentsConfigYaml', () => {
  it('parsea un YAML valido', () => {
    const yaml = `agents:
  triage:
    provider: deepseek
    model: deepseek-v3.2
  context:
    provider: anthropic
    model: claude-sonnet-4-6
  remediation:
    provider: openai
    model: gpt-5-nano
`;
    const config = parseAgentsConfigYaml(yaml);
    expect(config.agents.triage.provider).toBe('deepseek');
    expect(config.agents.context.provider).toBe('anthropic');
    expect(config.agents.remediation.provider).toBe('openai');
  });

  it('lanza si el YAML es invalido', () => {
    expect(() => parseAgentsConfigYaml('agents:\n  triage:\n  invalid: : :')).toThrow();
  });

  it('lanza si la forma no matchea el schema', () => {
    expect(() => parseAgentsConfigYaml('agents: {}')).toThrow();
  });
});
