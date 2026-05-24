import { describe, it, expect } from 'vitest';
import {
  renderBenchmarkReport,
  type AgentRollup,
  type BenchmarkReport,
} from '../../src/benchmark/report.js';

function makeRollup(overrides: Partial<AgentRollup> = {}): AgentRollup {
  return {
    invocations: 10,
    jsonValid: 10,
    passed: 8,
    totalLatencyMs: 12000,
    latencies: [800, 1200, 1500, 1100, 900, 1300, 1400, 1000, 1200, 1600],
    inputTokens: 5000,
    outputTokens: 1500,
    ...overrides,
  };
}

function makeReport(overrides: Partial<BenchmarkReport> = {}): BenchmarkReport {
  return {
    generatedAt: '2026-05-23T22:30:00.000Z',
    groundTruthVersion: '1.0',
    groundTruthReviewStatus: { 'ai-draft': 27, 'human-confirmed': 0, 'human-corrected': 0 },
    totalEntries: 27,
    runsPerEntry: 3,
    providers: [],
    notRun: [],
    ...overrides,
  };
}

describe('renderBenchmarkReport — estructura base', () => {
  it('incluye titulo + timestamp + ground truth metadata', () => {
    const md = renderBenchmarkReport(makeReport());
    expect(md).toContain('# Brain Layer Cross-Provider Benchmark — v0.3.0-DRAFT');
    expect(md).toContain('2026-05-23T22:30:00.000Z');
    expect(md).toContain('27 entries');
    expect(md).toContain('3 runs each');
  });

  it('incluye disclaimer fuerte cuando el ground truth es 100% ai-draft', () => {
    const md = renderBenchmarkReport(makeReport());
    expect(md).toContain('Anti-optimismo ilusorio');
    expect(md).toContain('ai-draft');
    expect(md).toContain('NO human-AppSec review');
    expect(md).toContain('internal-comparative only');
  });

  it('omite el disclaimer fuerte cuando hay revision humana', () => {
    const md = renderBenchmarkReport(
      makeReport({
        groundTruthReviewStatus: { 'ai-draft': 5, 'human-confirmed': 20, 'human-corrected': 2 },
      }),
    );
    expect(md).not.toContain('Anti-optimismo ilusorio');
    expect(md).toContain('20 confirmed');
    expect(md).toContain('2 corrected');
    expect(md).toContain('5 draft');
  });

  it('imprime mensaje claro si no se corrieron providers', () => {
    const md = renderBenchmarkReport(makeReport({ providers: [] }));
    expect(md).toContain('No providers were successfully run');
    expect(md).toContain('pnpm benchmark:run');
  });
});

describe('renderBenchmarkReport — tabla de providers + breakdown per-agente', () => {
  const provider = {
    providerLabel: 'anthropic/claude-haiku-4-5-20251001',
    attemptedRuns: 81,
    completedRuns: 81,
    triage: makeRollup({ invocations: 81, passed: 75, jsonValid: 81 }),
    context: makeRollup({ invocations: 60, passed: 55, jsonValid: 60 }),
    remediation: makeRollup({ invocations: 60, passed: 50, jsonValid: 60 }),
    estimatedCostUsd: 0.42,
    determinismRate: 0.95,
    errors: [],
  };

  it('renderiza una row de tabla por provider con cost + determinism', () => {
    const md = renderBenchmarkReport(makeReport({ providers: [provider] }));
    expect(md).toContain('anthropic/claude-haiku-4-5-20251001');
    expect(md).toContain('$0.4200');
    expect(md).toContain('95.0%'); // determinismo
  });

  it('renderiza el breakdown per-agente (Triage / Context / Remediation)', () => {
    const md = renderBenchmarkReport(makeReport({ providers: [provider] }));
    expect(md).toContain('**Triage**');
    expect(md).toContain('**Context**');
    expect(md).toContain('**Remediation**');
  });

  it('muestra cost "$0 (local)" para providers Ollama', () => {
    const md = renderBenchmarkReport(
      makeReport({
        providers: [{ ...provider, providerLabel: 'ollama/gemma3:latest', estimatedCostUsd: 0 }],
      }),
    );
    expect(md).toContain('$0 (local)');
  });

  it('muestra el conteo de errores cuando hay alguno', () => {
    const md = renderBenchmarkReport(
      makeReport({
        providers: [{ ...provider, errors: ['429 rate limit', 'parse error: ...', 'timeout'] }],
      }),
    );
    expect(md).toContain('Errors (3)');
    expect(md).toContain('429 rate limit');
  });

  it('listado de providers not-run aparece como tabla con razon', () => {
    const md = renderBenchmarkReport(
      makeReport({
        notRun: [
          { providerLabel: 'openai/gpt-5-nano', reason: 'SENTINEL_OPENAI_API_KEY not set.' },
          { providerLabel: 'deepseek/deepseek-v3.2', reason: 'SENTINEL_DEEPSEEK_API_KEY not set.' },
        ],
      }),
    );
    expect(md).toContain('## Providers not run');
    expect(md).toContain('openai/gpt-5-nano');
    expect(md).toContain('SENTINEL_OPENAI_API_KEY');
  });

  it('imprime "n/a" cuando un agente no fue invocado nunca', () => {
    const md = renderBenchmarkReport(
      makeReport({
        providers: [
          {
            ...provider,
            context: makeRollup({
              invocations: 0,
              jsonValid: 0,
              passed: 0,
              totalLatencyMs: 0,
              latencies: [],
              inputTokens: 0,
              outputTokens: 0,
            }),
          },
        ],
      }),
    );
    expect(md).toContain('| **Context** | n/a |');
  });
});
