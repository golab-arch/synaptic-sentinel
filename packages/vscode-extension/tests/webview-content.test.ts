import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  groupByTriageState,
  renderTomoWebviewHtml,
  triageStateOf,
} from '../src/webview-content.js';
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

describe('triageStateOf — DG-097 A', () => {
  it('mapea true_positive a tp', () => {
    expect(
      triageStateOf(
        makeFinding({
          triage: { classification: 'true_positive', confidence: 0.95, rationale: 'r' },
        }),
      ),
    ).toBe('tp');
  });

  it('mapea false_positive a fp', () => {
    expect(
      triageStateOf(
        makeFinding({
          triage: { classification: 'false_positive', confidence: 0.85, rationale: 'r' },
        }),
      ),
    ).toBe('fp');
  });

  it('mapea inconclusive a inc', () => {
    expect(
      triageStateOf(
        makeFinding({
          triage: { classification: 'inconclusive', confidence: 0.5, rationale: 'r' },
        }),
      ),
    ).toBe('inc');
  });

  it('finding sin triage queda como untriaged', () => {
    expect(triageStateOf(makeFinding())).toBe('untriaged');
  });

  it('classification desconocida cae a untriaged defensivamente', () => {
    expect(
      triageStateOf(
        makeFinding({
          triage: { classification: 'something_new_from_agent', confidence: 0.7, rationale: 'r' },
        }),
      ),
    ).toBe('untriaged');
  });
});

describe('groupByTriageState — DG-097 A', () => {
  it('agrupa findings por triage state preservando severity orden interno', () => {
    const buckets = groupByTriageState([
      makeFinding({ severity: 'low', title: 'A' }), // untriaged
      makeFinding({
        severity: 'critical',
        title: 'B',
        triage: { classification: 'true_positive', confidence: 0.95, rationale: 'r' },
      }),
      makeFinding({
        severity: 'high',
        title: 'C',
        triage: { classification: 'true_positive', confidence: 0.9, rationale: 'r' },
      }),
      makeFinding({
        severity: 'medium',
        title: 'D',
        triage: { classification: 'false_positive', confidence: 0.85, rationale: 'r' },
      }),
    ]);
    expect(buckets.tp.map((f) => f.title)).toEqual(['B', 'C']); // critical antes que high
    expect(buckets.fp.map((f) => f.title)).toEqual(['D']);
    expect(buckets.untriaged.map((f) => f.title)).toEqual(['A']);
    expect(buckets.inc).toEqual([]);
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

  it('renderiza una tarjeta clickeable por hallazgo, agrupada por severidad dentro del bucket', () => {
    const html = renderTomoWebviewHtml(
      [makeFinding({ severity: 'low' }), makeFinding({ severity: 'critical', title: 'Critico' })],
      opts,
    );
    expect(html).toContain('data-path="src/a.js"');
    expect(html).toContain('data-line="4"');
    // Ambas untriaged → mismo bucket; critical antes que low.
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

  it('agrupa TP antes que INC antes que Untriaged antes que FP (DG-097 A)', () => {
    const html = renderTomoWebviewHtml(
      [
        makeFinding({
          severity: 'low',
          title: 'TheFP',
          triage: { classification: 'false_positive', confidence: 0.95, rationale: 'r' },
        }),
        makeFinding({ severity: 'medium', title: 'TheUntriaged' }),
        makeFinding({
          severity: 'high',
          title: 'TheINC',
          triage: { classification: 'inconclusive', confidence: 0.5, rationale: 'r' },
        }),
        makeFinding({
          severity: 'critical',
          title: 'TheTP',
          triage: { classification: 'true_positive', confidence: 0.95, rationale: 'r' },
        }),
      ],
      opts,
    );
    const idxTP = html.indexOf('TheTP');
    const idxINC = html.indexOf('TheINC');
    const idxUntr = html.indexOf('TheUntriaged');
    const idxFP = html.indexOf('TheFP');
    expect(idxTP).toBeLessThan(idxINC);
    expect(idxINC).toBeLessThan(idxUntr);
    expect(idxUntr).toBeLessThan(idxFP);
  });

  it('emite section headers con count por bucket no-vacio (DG-097 A)', () => {
    const html = renderTomoWebviewHtml(
      [
        makeFinding({
          triage: { classification: 'true_positive', confidence: 0.95, rationale: 'r' },
        }),
        makeFinding({
          triage: { classification: 'true_positive', confidence: 0.92, rationale: 'r' },
        }),
        makeFinding({
          triage: { classification: 'false_positive', confidence: 0.95, rationale: 'r' },
        }),
      ],
      opts,
    );
    // Las clases section-* viven SIEMPRE en el <style>, asi que verificamos
    // el TEXTO del heading (que solo aparece si el bucket no esta vacio).
    expect(html).toContain('To fix · true positive');
    expect(html).toContain('Already false positive');
    expect(html).not.toContain('Inconclusive · agent could not decide');
    expect(html).not.toContain('Untriaged · run Triage Findings');
  });

  it('cada card lleva la clase state-* segun su bucket (DG-097 A)', () => {
    const html = renderTomoWebviewHtml(
      [
        makeFinding({
          title: 'CardTP',
          triage: { classification: 'true_positive', confidence: 0.95, rationale: 'r' },
        }),
        makeFinding({
          title: 'CardFP',
          triage: { classification: 'false_positive', confidence: 0.85, rationale: 'r' },
        }),
        makeFinding({ title: 'CardUntriaged' }),
      ],
      opts,
    );
    expect(html).toMatch(/<div class="finding sev-\w+ state-tp"[^>]*>[\s\S]*?CardTP/);
    expect(html).toMatch(/<div class="finding sev-\w+ state-fp"[^>]*>[\s\S]*?CardFP/);
    expect(html).toMatch(/<div class="finding sev-\w+ state-untriaged"[^>]*>[\s\S]*?CardUntriaged/);
  });

  it('state badge muestra confidence como porcentaje en cards triadas (DG-097 A)', () => {
    const html = renderTomoWebviewHtml(
      [
        makeFinding({
          triage: { classification: 'true_positive', confidence: 0.95, rationale: 'r' },
        }),
        makeFinding({
          triage: { classification: 'inconclusive', confidence: 0.5, rationale: 'r' },
        }),
      ],
      opts,
    );
    expect(html).toContain('TP 95%');
    expect(html).toContain('INC 50%');
  });

  it('state badge para untriaged es "NEW" sin porcentaje (DG-097 A)', () => {
    const html = renderTomoWebviewHtml([makeFinding()], opts);
    expect(html).toContain('>NEW<');
    expect(html).not.toContain('NEW 0%');
  });

  it('summary header muestra total + breakdown por bucket presente (DG-097 A)', () => {
    const html = renderTomoWebviewHtml(
      [
        makeFinding({
          triage: { classification: 'true_positive', confidence: 0.95, rationale: 'r' },
        }),
        makeFinding({
          triage: { classification: 'true_positive', confidence: 0.92, rationale: 'r' },
        }),
        makeFinding({
          triage: { classification: 'false_positive', confidence: 0.95, rationale: 'r' },
        }),
        makeFinding(),
      ],
      opts,
    );
    expect(html).toContain('class="summary"');
    expect(html).toContain('4 findings');
    expect(html).toContain('2 TP');
    expect(html).toContain('1 FP');
    expect(html).toContain('1 NEW');
  });

  it('summary header usa "1 finding" en singular cuando hay solo uno (DG-097 A)', () => {
    const html = renderTomoWebviewHtml([makeFinding()], opts);
    expect(html).toContain('1 finding<');
    expect(html).not.toContain('1 findings');
  });
});
