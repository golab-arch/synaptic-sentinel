import { describe, it, expect } from 'vitest';
import { escapeHtml, renderTomoWebviewHtml } from '../src/webview-content.js';
import type { ExtensionFinding } from '../src/tomo.js';

/** Construye un ExtensionFinding valido de base. */
function makeFinding(overrides: Partial<ExtensionFinding> = {}): ExtensionFinding {
  return {
    severity: 'high',
    category: 'SAST',
    ruleId: 'rule-x',
    title: 'Hallazgo de prueba',
    message: 'mensaje',
    location: { path: 'src/a.js', startLine: 4 },
    fingerprint: 'fp-1',
    lifecycleState: 'new',
    ...overrides,
  };
}

const opts = { nonce: 'NONCE123', cspSource: 'vscode-webview://x' };

describe('escapeHtml', () => {
  it('escapa los caracteres con significado en HTML', () => {
    expect(escapeHtml('<script>"&\'</script>')).toBe(
      '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;',
    );
  });
});

describe('renderTomoWebviewHtml', () => {
  it('emite un documento HTML con una CSP que usa el nonce', () => {
    const html = renderTomoWebviewHtml([], opts);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('nonce-NONCE123');
    expect(html).toContain('<script nonce="NONCE123">');
  });

  it('muestra un estado vacio cuando no hay hallazgos', () => {
    expect(renderTomoWebviewHtml([], opts)).toContain('Scan Workspace');
  });

  it('renderiza una tarjeta clickeable por hallazgo, agrupada por severidad', () => {
    const html = renderTomoWebviewHtml(
      [makeFinding({ severity: 'low' }), makeFinding({ severity: 'critical', title: 'Critico' })],
      opts,
    );
    expect(html).toContain('2 finding(s)');
    expect(html).toContain('data-path="src/a.js"');
    expect(html).toContain('data-line="4"');
    // critical se renderiza antes que low (orden por severidad).
    expect(html.indexOf('Critico')).toBeLessThan(html.indexOf('Hallazgo de prueba'));
  });

  it('escapa el contenido dinamico de los hallazgos (anti-inyeccion)', () => {
    const html = renderTomoWebviewHtml(
      [makeFinding({ title: '<img src=x onerror=alert(1)>' })],
      opts,
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('muestra el detalle del Brain Layer cuando esta presente', () => {
    const html = renderTomoWebviewHtml(
      [
        makeFinding({
          triage: { classification: 'true_positive', confidence: 0.9, rationale: 'riesgo real' },
          remediation: {
            summary: 'parametrizar la consulta',
            recommendation: 'usar consultas preparadas',
          },
        }),
      ],
      opts,
    );
    expect(html).toContain('Triage:');
    expect(html).toContain('riesgo real');
    expect(html).toContain('Remediation:');
    expect(html).toContain('parametrizar la consulta');
  });
});
