import { describe, it, expect } from 'vitest';
import { AnthropicLlmClient } from '../src/anthropic-client.js';
import { runAgent } from '../src/brain-agent.js';
import { ContextAgent } from '../src/context-agent.js';

// Requiere una API key real de Anthropic (BYOK). Sin ella, la suite se omite.
// Nota de entorno: bajo Norton 360 la llamada de red puede requerir
// NODE_OPTIONS=--use-system-ca (ver learning L-001).
const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
const suite = apiKey !== '' ? describe : describe.skip;

suite('ContextAgent - integracion con la API real de Anthropic', () => {
  it('explica un hallazgo real y devuelve una explicacion valida', async () => {
    const llm = new AnthropicLlmClient({ apiKey });
    const finding = {
      id: '00000000-0000-4000-8000-000000000001',
      scanId: 'scan-it',
      scoutId: 'opengrep',
      severity: 'high',
      category: 'SAST',
      ruleId: 'sentinel-js-eval-usage',
      title: 'sentinel-js-eval-usage',
      message: 'Uso de eval() con entrada no confiable.',
      location: { path: 'src/x.js', startLine: 1, snippet: 'const r = eval(req.query.expr);' },
      complianceRefs: ['CWE-95'],
      fingerprint: 'src/x.js:sentinel-js-eval-usage:1',
      lifecycleState: 'new',
      createdAt: '2026-05-21T00:00:00.000Z',
    };
    const explanation = await runAgent(new ContextAgent(), finding as never, llm);

    expect(explanation.summary.length).toBeGreaterThan(0);
    expect(explanation.entryPoint.length).toBeGreaterThan(0);
    expect(explanation.sink.length).toBeGreaterThan(0);
    expect(explanation.exposure.length).toBeGreaterThan(0);
  }, 30_000);
});
