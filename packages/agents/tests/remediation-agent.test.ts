import { describe, it, expect } from 'vitest';
import { runAgent } from '../src/brain-agent.js';
import type { LlmClient } from '../src/llm-client.js';
import { RemediationAgent } from '../src/remediation-agent.js';

/** Construye un Finding valido para alimentar al Remediation Agent. */
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

/** Respuesta JSON valida de ejemplo del Remediation Agent. */
const VALID_RESPONSE =
  '{"summary":"reemplazar eval por un parser seguro",' +
  '"recommendation":"usar JSON.parse o una libreria de expresiones segura",' +
  '"fixedSnippet":"const r = JSON.parse(req.query.expr);"}';

describe('RemediationAgent.buildPrompt', () => {
  it('incluye los datos del hallazgo y pide una respuesta JSON', () => {
    const prompt = new RemediationAgent().buildPrompt(makeFinding() as never);
    expect(prompt.system).toContain('JSON');
    expect(prompt.user).toContain('sentinel-js-eval-usage');
    expect(prompt.user).toContain('src/x.ts:3');
    expect(prompt.user).toContain('eval(req.query.expr)');
  });
});

describe('RemediationAgent.parseResponse', () => {
  const agent = new RemediationAgent();

  it('parsea una sugerencia JSON valida con snippet', () => {
    const suggestion = agent.parseResponse(VALID_RESPONSE);
    expect(suggestion.summary).toContain('parser seguro');
    expect(suggestion.fixedSnippet).toContain('JSON.parse');
  });

  it('tolera la sugerencia envuelta en un bloque markdown', () => {
    const suggestion = agent.parseResponse('```json\n' + VALID_RESPONSE + '\n```');
    expect(suggestion.recommendation).toContain('JSON.parse');
  });

  it('normaliza un fixedSnippet vacio a ausente', () => {
    const suggestion = agent.parseResponse(
      '{"summary":"rotar el secreto","recommendation":"revocar y emitir uno nuevo","fixedSnippet":""}',
    );
    expect(suggestion.fixedSnippet).toBeUndefined();
  });

  it('acepta una sugerencia sin la clave fixedSnippet', () => {
    const suggestion = agent.parseResponse(
      '{"summary":"rotar el secreto","recommendation":"revocar y emitir uno nuevo"}',
    );
    expect(suggestion.fixedSnippet).toBeUndefined();
  });

  it('rechaza una respuesta sin el campo recommendation', () => {
    expect(() => agent.parseResponse('{"summary":"s"}')).toThrow();
  });

  it('rechaza una respuesta sin JSON', () => {
    expect(() => agent.parseResponse('no puedo remediar')).toThrow();
  });
});

describe('runAgent con RemediationAgent', () => {
  it('remedia un hallazgo de punta a punta con un LLM falso', async () => {
    const llm: LlmClient = { complete: () => Promise.resolve(VALID_RESPONSE) };
    const suggestion = await runAgent(new RemediationAgent(), makeFinding() as never, llm);
    expect(suggestion.summary).toContain('parser seguro');
    expect(suggestion.fixedSnippet).toContain('JSON.parse');
  });
});
