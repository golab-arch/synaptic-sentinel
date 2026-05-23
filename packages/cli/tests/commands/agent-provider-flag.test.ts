import { describe, it, expect } from 'vitest';
import {
  parseAgentProviderFlag,
  parseAgentProviderFlags,
} from '../../src/commands/agent-provider-flag.js';

describe('parseAgentProviderFlag', () => {
  it('parsea triage=deepseek/deepseek-v3.2', () => {
    const result = parseAgentProviderFlag('triage=deepseek/deepseek-v3.2');
    expect(result.agent).toBe('triage');
    expect(result.config.provider).toBe('deepseek');
    expect(result.config.model).toBe('deepseek-v3.2');
  });

  it('soporta modelos con ":" (Ollama)', () => {
    const result = parseAgentProviderFlag('remediation=ollama/mistral-nemo:12b');
    expect(result.agent).toBe('remediation');
    expect(result.config.provider).toBe('ollama');
    expect(result.config.model).toBe('mistral-nemo:12b');
  });

  it('soporta modelos con "/" interno (despues del primer slash)', () => {
    const result = parseAgentProviderFlag('triage=bedrock/anthropic.claude-opus-4');
    expect(result.config.model).toBe('anthropic.claude-opus-4');
  });

  it('lanza si falta el "="', () => {
    expect(() => parseAgentProviderFlag('triage:deepseek/v3.2')).toThrow();
  });

  it('lanza si el agente no es uno de los 3', () => {
    expect(() => parseAgentProviderFlag('foo=anthropic/claude')).toThrow(
      /triage, context, remediation/,
    );
  });

  it('lanza si el provider es desconocido', () => {
    expect(() => parseAgentProviderFlag('triage=pepito/m')).toThrow();
  });

  it('lanza si falta el modelo despues del "/"', () => {
    expect(() => parseAgentProviderFlag('triage=anthropic/')).toThrow();
  });

  it('lanza si falta el "/"', () => {
    expect(() => parseAgentProviderFlag('triage=anthropic')).toThrow();
  });
});

describe('parseAgentProviderFlags', () => {
  it('compone overrides para multiples agentes', () => {
    const overrides = parseAgentProviderFlags([
      'triage=deepseek/deepseek-v3.2',
      'context=anthropic/claude-sonnet-4-6',
      'remediation=ollama/mistral-nemo:12b',
    ]);
    expect(overrides.triage?.provider).toBe('deepseek');
    expect(overrides.context?.provider).toBe('anthropic');
    expect(overrides.remediation?.provider).toBe('ollama');
  });

  it('si el mismo agente aparece dos veces, el ultimo gana', () => {
    const overrides = parseAgentProviderFlags([
      'triage=anthropic/claude-haiku-4-5',
      'triage=deepseek/deepseek-v3.2',
    ]);
    expect(overrides.triage?.provider).toBe('deepseek');
  });

  it('devuelve overrides vacios para una lista vacia', () => {
    expect(parseAgentProviderFlags([])).toEqual({});
  });
});
