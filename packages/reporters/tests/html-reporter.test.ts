import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildTomo } from '../src/tomo.js';
import { escapeHtml, renderTomoHtml } from '../src/html-reporter.js';

/** Construye un Finding valido de base. */
function makeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    scanId: 'scan-1',
    scoutId: 'opengrep',
    severity: 'high',
    category: 'SAST',
    ruleId: 'rule-x',
    title: 'rule-x',
    message: 'Hallazgo de prueba.',
    location: { path: 'src/x.ts', startLine: 3 },
    complianceRefs: ['CWE-95'],
    fingerprint: `fp-${randomUUID()}`,
    lifecycleState: 'new',
    createdAt: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

/** Construye un ScanOutcome valido de base. */
function makeOutcome(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scanId: 'scan-1',
    status: 'ok',
    findingsCount: 1,
    suppressedCount: 2,
    scouts: [{ scoutId: 'opengrep', status: 'ok', findings: 1 }],
    startedAt: '2026-05-21T00:00:00.000Z',
    finishedAt: '2026-05-21T00:00:05.000Z',
    ...overrides,
  };
}

const meta = { rootPath: '/proyecto', sentinelVersion: '0.0.0' };

describe('escapeHtml', () => {
  it('escapa los caracteres con significado en HTML', () => {
    expect(escapeHtml('<script>"&\'</script>')).toBe(
      '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;',
    );
  });
});

describe('renderTomoHtml', () => {
  it('renderiza un documento HTML autocontenido con el contenido del tomo', () => {
    const tomo = buildTomo(makeOutcome(), [makeFinding()], meta);
    const html = renderTomoHtml(tomo);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('scan-1');
    expect(html).toContain('rule-x');
    expect(html).toContain('src/x.ts:3');
    expect(html).toContain(tomo.integrity.hash);
    expect(html).toContain('2</strong> suprimido'); // suppressedCount (FI-006)
    expect(html).not.toContain('<link'); // autocontenido, sin recursos externos
  });

  it('escapa el contenido dinamico de los hallazgos (anti-inyeccion)', () => {
    const tomo = buildTomo(
      makeOutcome(),
      [makeFinding({ message: '<script>alert(1)</script>', title: 'xss-test' })],
      meta,
    );
    const html = renderTomoHtml(tomo);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('muestra un mensaje cuando no hay hallazgos', () => {
    const tomo = buildTomo(makeOutcome({ findingsCount: 0 }), [], meta);
    expect(renderTomoHtml(tomo)).toContain('Sin hallazgos');
  });

  it('renderiza el veredicto de triage cuando el hallazgo fue triado', () => {
    const finding = makeFinding({ fingerprint: 'fp-t' });
    const verdict = {
      id: randomUUID(),
      scanId: 'scan-1',
      fingerprint: 'fp-t',
      classification: 'false_positive',
      confidence: 0.91,
      rationale: 'no es explotable en este contexto',
      agentId: 'triage',
      createdAt: '2026-05-21T00:00:00.000Z',
    };
    const html = renderTomoHtml(
      buildTomo(makeOutcome(), [finding], meta, { triageVerdicts: [verdict] }),
    );
    expect(html).toContain('Triage: falso positivo');
    expect(html).toContain('no es explotable en este contexto');
    expect(html).toContain('Por triage');
  });

  it('renderiza la explicacion de contexto cuando el hallazgo fue explicado', () => {
    const finding = makeFinding({ fingerprint: 'fp-c' });
    const explanation = {
      id: randomUUID(),
      scanId: 'scan-1',
      fingerprint: 'fp-c',
      summary: 'eval sobre entrada del usuario',
      entryPoint: 'el parametro req.query.expr',
      sink: 'la llamada a eval()',
      exposure: 'ejecucion de codigo arbitrario',
      agentId: 'context',
      createdAt: '2026-05-21T00:00:00.000Z',
    };
    const html = renderTomoHtml(
      buildTomo(makeOutcome(), [finding], meta, { contextExplanations: [explanation] }),
    );
    expect(html).toContain('Contexto:');
    expect(html).toContain('el parametro req.query.expr');
    expect(html).toContain('ejecucion de codigo arbitrario');
  });
});
