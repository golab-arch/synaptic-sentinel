import { describe, it, expect } from 'vitest';
import { runAgent } from '../src/brain-agent.js';
import type { LlmClient } from '../src/llm-client.js';
import { TRIAGE_CLASSIFICATIONS, TriageAgent } from '../src/triage-agent.js';

/** Construye un Finding valido para alimentar al Triage Agent. */
function makeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    scanId: 'scan-1',
    scoutId: 'opengrep',
    severity: 'high',
    category: 'SAST',
    ruleId: 'test-rule',
    title: 'sentinel-js-eval-usage',
    message: 'Uso de eval() con entrada no confiable.',
    location: { path: 'src/x.ts', startLine: 3, snippet: 'eval(userInput)' },
    complianceRefs: ['CWE-95'],
    fingerprint: 'src/x.ts:test-rule:3',
    lifecycleState: 'new',
    createdAt: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('TriageAgent.buildPrompt', () => {
  it('incluye los datos del hallazgo y pide una respuesta JSON', () => {
    const prompt = new TriageAgent().buildPrompt(makeFinding() as never);
    expect(prompt.system).toContain('JSON');
    expect(prompt.user).toContain('test-rule');
    expect(prompt.user).toContain('src/x.ts:3');
    expect(prompt.user).toContain('eval(userInput)'); // snippet
  });

  it('usa "(no disponible)" cuando el hallazgo no trae snippet', () => {
    const prompt = new TriageAgent().buildPrompt(
      makeFinding({ location: { path: 'a.js', startLine: 1 } }) as never,
    );
    expect(prompt.user).toContain('(no disponible)');
  });
});

describe('TriageAgent.parseResponse', () => {
  const agent = new TriageAgent();

  it('parsea un veredicto JSON valido', () => {
    const verdict = agent.parseResponse(
      '{"classification":"false_positive","confidence":0.9,"rationale":"patron sin riesgo"}',
    );
    expect(verdict.classification).toBe('false_positive');
    expect(verdict.confidence).toBe(0.9);
    expect(verdict.rationale).toBe('patron sin riesgo');
  });

  it('tolera el veredicto envuelto en un bloque markdown', () => {
    const verdict = agent.parseResponse(
      '```json\n{"classification":"true_positive","confidence":0.7,"rationale":"riesgo real"}\n```',
    );
    expect(verdict.classification).toBe('true_positive');
  });

  it('rechaza una clasificacion invalida', () => {
    expect(() =>
      agent.parseResponse('{"classification":"quizas","confidence":0.5,"rationale":"x"}'),
    ).toThrow();
  });

  it('rechaza una confianza fuera del rango 0..1', () => {
    expect(() =>
      agent.parseResponse(
        '{"classification":"inconclusive","confidence":1.8,"rationale":"x"}',
      ),
    ).toThrow();
  });

  it('rechaza una respuesta sin JSON', () => {
    expect(() => agent.parseResponse('no puedo decidir')).toThrow();
  });
});

describe('runAgent con TriageAgent', () => {
  it('tria un hallazgo de punta a punta con un LLM falso', async () => {
    const llm: LlmClient = {
      complete: () =>
        Promise.resolve(
          '{"classification":"true_positive","confidence":0.85,"rationale":"eval con entrada del usuario"}',
        ),
    };
    const verdict = await runAgent(new TriageAgent(), makeFinding() as never, llm);
    expect(TRIAGE_CLASSIFICATIONS).toContain(verdict.classification);
    expect(verdict.classification).toBe('true_positive');
    expect(verdict.confidence).toBe(0.85);
  });
});
