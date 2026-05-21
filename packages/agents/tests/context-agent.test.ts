import { describe, it, expect } from 'vitest';
import { runAgent } from '../src/brain-agent.js';
import type { LlmClient } from '../src/llm-client.js';
import { ContextAgent } from '../src/context-agent.js';

/** Construye un Finding valido para alimentar al Context Agent. */
function makeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    scanId: 'scan-1',
    scoutId: 'opengrep',
    severity: 'high',
    category: 'SAST',
    ruleId: 'sentinel-js-eval-usage',
    title: 'sentinel-js-eval-usage',
    message: 'Uso de eval() con entrada no confiable.',
    location: { path: 'src/x.ts', startLine: 3, snippet: 'eval(req.query.expr)' },
    complianceRefs: ['CWE-95'],
    fingerprint: 'src/x.ts:eval:3',
    lifecycleState: 'new',
    createdAt: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

/** Respuesta JSON valida de ejemplo del Context Agent. */
const VALID_RESPONSE =
  '{"summary":"eval con entrada del usuario","entryPoint":"req.query.expr",' +
  '"sink":"eval()","exposure":"ejecucion de codigo arbitrario"}';

describe('ContextAgent.buildPrompt', () => {
  it('incluye los datos del hallazgo y pide una respuesta JSON', () => {
    const prompt = new ContextAgent().buildPrompt(makeFinding() as never);
    expect(prompt.system).toContain('JSON');
    expect(prompt.user).toContain('sentinel-js-eval-usage');
    expect(prompt.user).toContain('src/x.ts:3');
    expect(prompt.user).toContain('eval(req.query.expr)');
  });
});

describe('ContextAgent.parseResponse', () => {
  const agent = new ContextAgent();

  it('parsea una explicacion JSON valida', () => {
    const explanation = agent.parseResponse(VALID_RESPONSE);
    expect(explanation.entryPoint).toBe('req.query.expr');
    expect(explanation.sink).toBe('eval()');
    expect(explanation.exposure).toContain('codigo arbitrario');
  });

  it('tolera la explicacion envuelta en un bloque markdown', () => {
    const explanation = agent.parseResponse('```json\n' + VALID_RESPONSE + '\n```');
    expect(explanation.summary).toBe('eval con entrada del usuario');
  });

  it('rechaza una respuesta sin el campo sink', () => {
    expect(() =>
      agent.parseResponse('{"summary":"s","entryPoint":"e","exposure":"x"}'),
    ).toThrow();
  });

  it('rechaza una respuesta sin JSON', () => {
    expect(() => agent.parseResponse('no puedo explicar')).toThrow();
  });
});

describe('runAgent con ContextAgent', () => {
  it('explica un hallazgo de punta a punta con un LLM falso', async () => {
    const llm: LlmClient = { complete: () => Promise.resolve(VALID_RESPONSE) };
    const explanation = await runAgent(new ContextAgent(), makeFinding() as never, llm);
    expect(explanation.summary).toBe('eval con entrada del usuario');
    expect(explanation.sink).toBe('eval()');
  });
});
