import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  buildTomo,
  verifyTomoIntegrity,
  canonicalHash,
  TomoSchema,
} from '../src/tomo.js';
import { renderTomoJson } from '../src/json-reporter.js';

/** Construye un Finding valido. */
function makeFinding(severity: string, category: string): Record<string, unknown> {
  return {
    id: randomUUID(),
    scanId: 'scan-1',
    scoutId: 'opengrep',
    severity,
    category,
    ruleId: 'rule-x',
    title: 'rule-x',
    message: 'Hallazgo de prueba.',
    location: { path: 'src/x.ts', startLine: 1 },
    complianceRefs: [],
    fingerprint: `fp-${randomUUID()}`,
    lifecycleState: 'new',
    createdAt: '2026-05-21T00:00:00.000Z',
  };
}

/** Construye un ScanOutcome valido. */
function makeOutcome(scanId: string): Record<string, unknown> {
  return {
    scanId,
    status: 'ok',
    findingsCount: 0,
    suppressedCount: 0,
    scouts: [{ scoutId: 'opengrep', status: 'ok', findings: 0 }],
    startedAt: '2026-05-21T00:00:00.000Z',
    finishedAt: '2026-05-21T00:00:05.000Z',
  };
}

describe('buildTomo', () => {
  it('construye un tomo valido con el resumen por severidad y categoria', () => {
    const findings = [
      makeFinding('high', 'SAST'),
      makeFinding('high', 'SAST'),
      makeFinding('low', 'Secrets'),
    ];
    const tomo = buildTomo(makeOutcome('scan-1'), findings, {
      rootPath: '/proyecto',
      sentinelVersion: '0.0.0',
    });

    expect(TomoSchema.safeParse(tomo).success).toBe(true);
    expect(tomo.summary.totalFindings).toBe(3);
    expect(tomo.summary.suppressedCount).toBe(0); // FI-006: viene de outcome.suppressedCount
    expect(tomo.summary.bySeverity['high']).toBe(2);
    expect(tomo.summary.bySeverity['low']).toBe(1);
    expect(tomo.summary.byCategory['Secrets']).toBe(1);
    expect(tomo.metadata.scope.rootPath).toBe('/proyecto');
  });

  it('adjunta el veredicto de triage al hallazgo con fingerprint coincidente', () => {
    const finding = makeFinding('high', 'SAST');
    finding['fingerprint'] = 'fp-triaged';
    const verdict = {
      id: randomUUID(),
      scanId: 'scan-1',
      fingerprint: 'fp-triaged',
      classification: 'false_positive',
      confidence: 0.95,
      rationale: 'el patron se disparo pero no hay riesgo real',
      agentId: 'triage',
      createdAt: '2026-05-21T00:00:00.000Z',
    };
    const tomo = buildTomo(
      makeOutcome('scan-1'),
      [finding],
      { rootPath: '/p', sentinelVersion: '0.0.0' },
      { triageVerdicts: [verdict] },
    );
    expect(tomo.findings[0]?.triage?.classification).toBe('false_positive');
    expect(tomo.findings[0]?.triage?.rationale).toContain('no hay riesgo real');
    expect(tomo.summary.byTriage['false_positive']).toBe(1);
  });

  it('adjunta la explicacion de contexto al hallazgo con fingerprint coincidente', () => {
    const finding = makeFinding('high', 'SAST');
    finding['fingerprint'] = 'fp-ctx';
    const explanation = {
      id: randomUUID(),
      scanId: 'scan-1',
      fingerprint: 'fp-ctx',
      summary: 'eval sobre entrada del usuario',
      entryPoint: 'req.query.expr',
      sink: 'eval()',
      exposure: 'ejecucion de codigo arbitrario',
      agentId: 'context',
      createdAt: '2026-05-21T00:00:00.000Z',
    };
    const tomo = buildTomo(
      makeOutcome('scan-1'),
      [finding],
      { rootPath: '/p', sentinelVersion: '0.0.0' },
      { contextExplanations: [explanation] },
    );
    expect(tomo.findings[0]?.context?.sink).toBe('eval()');
    expect(tomo.findings[0]?.context?.exposure).toContain('codigo arbitrario');
    expect(tomo.findings[0]?.triage).toBeUndefined();
  });

  it('adjunta la sugerencia de remediacion al hallazgo con fingerprint coincidente', () => {
    const finding = makeFinding('high', 'SAST');
    finding['fingerprint'] = 'fp-rem';
    const suggestion = {
      id: randomUUID(),
      scanId: 'scan-1',
      fingerprint: 'fp-rem',
      summary: 'reemplazar eval por un parser seguro',
      recommendation: 'usar JSON.parse en vez de eval sobre la entrada',
      fixedSnippet: 'JSON.parse(input)',
      agentId: 'remediation',
      createdAt: '2026-05-21T00:00:00.000Z',
    };
    const tomo = buildTomo(
      makeOutcome('scan-1'),
      [finding],
      { rootPath: '/p', sentinelVersion: '0.0.0' },
      { remediationSuggestions: [suggestion] },
    );
    expect(tomo.findings[0]?.remediation?.summary).toContain('parser seguro');
    expect(tomo.findings[0]?.remediation?.fixedSnippet).toBe('JSON.parse(input)');
    expect(tomo.findings[0]?.triage).toBeUndefined();
  });

  it('deja sin triage los hallazgos sin veredicto', () => {
    const tomo = buildTomo(makeOutcome('scan-1'), [makeFinding('low', 'SAST')], {
      rootPath: '/p',
      sentinelVersion: '0.0.0',
    });
    expect(tomo.findings[0]?.triage).toBeUndefined();
    expect(tomo.summary.byTriage).toEqual({});
  });

  it('incluye una firma de integridad SHA-256 verificable', () => {
    const tomo = buildTomo(makeOutcome('scan-1'), [makeFinding('high', 'SAST')], {
      rootPath: '/p',
      sentinelVersion: '0.0.0',
    });
    expect(tomo.integrity.algorithm).toBe('sha256');
    expect(tomo.integrity.hash).toHaveLength(64);
    expect(verifyTomoIntegrity(tomo)).toBe(true);
  });

  it('verifyTomoIntegrity detecta una manipulacion del contenido', () => {
    const tomo = buildTomo(makeOutcome('scan-1'), [makeFinding('high', 'SAST')], {
      rootPath: '/p',
      sentinelVersion: '0.0.0',
    });
    const tampered = { ...tomo, summary: { ...tomo.summary, totalFindings: 999 } };
    expect(verifyTomoIntegrity(tampered)).toBe(false);
  });
});

describe('canonicalHash', () => {
  it('es independiente del orden de las claves', () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });

  it('cambia si cambia el contenido', () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });
});

describe('renderTomoJson', () => {
  it('serializa el tomo a JSON parseable', () => {
    const tomo = buildTomo(makeOutcome('scan-9'), [], {
      rootPath: '/p',
      sentinelVersion: '0.0.0',
    });
    const json = renderTomoJson(tomo);
    const parsed = JSON.parse(json) as { summary: { scanId: string } };
    expect(parsed.summary.scanId).toBe('scan-9');
  });
});
