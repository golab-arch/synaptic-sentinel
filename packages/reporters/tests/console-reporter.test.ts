import { describe, it, expect } from 'vitest';
import type { Finding, ScanOutcome, Severity } from '@synaptic-sentinel/core';
import {
  paint,
  renderBanner,
  renderScanReveal,
  renderScoutLine,
  SPINNER_FRAMES,
} from '../src/console-reporter.js';

/** Construye un `Finding` valido de base. */
function makeFinding(severity: Severity, overrides: Partial<Finding> = {}): Finding {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    scanId: 'scan-1',
    scoutId: 'opengrep',
    severity,
    category: 'SAST',
    ruleId: 'rule-x',
    title: 'Hallazgo de prueba',
    message: 'mensaje',
    location: { path: 'src/x.ts', startLine: 7 },
    complianceRefs: [],
    fingerprint: 'fp-1',
    lifecycleState: 'new',
    createdAt: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

/** Construye un `ScanOutcome` valido de base. */
function makeOutcome(overrides: Partial<ScanOutcome> = {}): ScanOutcome {
  return {
    scanId: 'scan-abc',
    status: 'ok',
    findingsCount: 0,
    suppressedCount: 0,
    scouts: [],
    startedAt: '2026-05-21T00:00:00.000Z',
    finishedAt: '2026-05-21T00:00:05.000Z',
    ...overrides,
  };
}

describe('paint', () => {
  it('envuelve el texto en codigos ANSI cuando color es true', () => {
    expect(paint('x', '\x1b[1m', true)).toBe('\x1b[1mx\x1b[0m');
  });

  it('deja el texto crudo cuando color es false', () => {
    expect(paint('x', '\x1b[1m', false)).toBe('x');
  });
});

describe('renderBanner', () => {
  it('incluye el nombre del producto', () => {
    expect(renderBanner(false)).toContain('SYNAPTIC SENTINEL');
  });

  it('emite ANSI con color y texto plano sin color', () => {
    expect(renderBanner(true)).toContain('\x1b[');
    expect(renderBanner(false)).not.toContain('\x1b[');
  });
});

describe('SPINNER_FRAMES', () => {
  it('expone varios frames no vacios', () => {
    expect(SPINNER_FRAMES.length).toBeGreaterThan(1);
    expect(SPINNER_FRAMES.every((frame) => frame.length > 0)).toBe(true);
  });
});

describe('renderScoutLine', () => {
  it('marca un scout ok con ✓ y muestra el conteo', () => {
    const line = renderScoutLine({ scoutId: 'opengrep', status: 'ok', findings: 3 }, false);
    expect(line).toContain('✓');
    expect(line).toContain('opengrep');
    expect(line).toContain('3 hallazgo(s)');
  });

  it('marca un scout failed con ✗ y muestra el error', () => {
    const line = renderScoutLine(
      { scoutId: 'trivy', status: 'failed', findings: 0, error: 'timeout' },
      false,
    );
    expect(line).toContain('✗');
    expect(line).toContain('timeout');
  });
});

describe('renderScanReveal', () => {
  it('muestra OK, los conteos y los hallazgos agrupados por severidad', () => {
    const outcome = makeOutcome({ status: 'ok', findingsCount: 2, suppressedCount: 1 });
    const text = renderScanReveal(outcome, [makeFinding('low'), makeFinding('critical')], false);
    expect(text).toContain('OK');
    expect(text).toContain('2 hallazgo(s)');
    expect(text).toContain('1 suprimido(s)');
    // critical se renderiza antes que low (orden por severidad).
    expect(text.indexOf('CRITICAL')).toBeLessThan(text.indexOf('LOW'));
  });

  it('muestra DEGRADED cuando el scan degrada', () => {
    expect(renderScanReveal(makeOutcome({ status: 'degraded' }), [], false)).toContain('DEGRADED');
  });

  it('muestra "sin hallazgos" cuando no hay findings', () => {
    expect(renderScanReveal(makeOutcome(), [], false)).toContain('sin hallazgos');
  });

  it('anota el ciclo de vida no-new', () => {
    const text = renderScanReveal(
      makeOutcome({ findingsCount: 1 }),
      [makeFinding('high', { lifecycleState: 'known' })],
      false,
    );
    expect(text).toContain('(known)');
  });

  it('emite ANSI cuando color es true', () => {
    expect(renderScanReveal(makeOutcome(), [makeFinding('high')], true)).toContain('\x1b[');
  });
});
