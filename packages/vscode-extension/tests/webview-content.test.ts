import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  formatLastSessionAt,
  groupByTriageState,
  renderCostCard,
  renderFindingGroupCard,
  renderOverrideDirective,
  renderTomoWebviewHtml,
  triageStateOf,
} from '../src/webview-content.js';
import { parseCostSummary, type CostSummary, type ExtensionFinding } from '../src/tomo.js';

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

  it('state badge muestra solo TP/INC/FP/NEW (DG-118 A retiro el confidence% del badge)', () => {
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
    // DG-118 A (Cycle 109): state badge YA NO incluye confidence% — usuarios
    // novatos lo leian como prioridad. La confianza se muestra en la linea
    // del brain section con label explicit "LLM confidence: N%".
    expect(html).toContain('>TP<');
    expect(html).toContain('>INC<');
    expect(html).not.toContain('TP 95%');
    expect(html).not.toContain('INC 50%');
  });

  it('confidence% se muestra en brain section con label "LLM confidence" (DG-118 A)', () => {
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
    expect(html).toContain('llm-confidence');
    expect(html).toContain('LLM confidence: 95%');
    expect(html).toContain('LLM confidence: 50%');
  });

  it('state badge para untriaged es "NEW" sin porcentaje (DG-097 A)', () => {
    const html = renderTomoWebviewHtml([makeFinding()], opts);
    expect(html).toContain('>NEW<');
    expect(html).not.toContain('NEW 0%');
  });

  it('priority badge se emite cuando finding.priorityScore esta presente (DG-118 A)', () => {
    const html = renderTomoWebviewHtml(
      [
        makeFinding({
          severity: 'high',
          triage: { classification: 'true_positive', confidence: 0.95, rationale: 'r' },
          priorityScore: 'high',
        }),
        makeFinding({
          severity: 'critical',
          triage: { classification: 'inconclusive', confidence: 0.5, rationale: 'r' },
          priorityScore: 'high', // critical INC → high demote
        }),
        makeFinding({
          severity: 'high',
          triage: { classification: 'false_positive', confidence: 0.95, rationale: 'r' },
          priorityScore: 'noise',
        }),
      ],
      opts,
    );
    expect(html).toContain('priority-badge priority-high');
    expect(html).toContain('priority-badge priority-noise');
    expect(html).toContain('>high<');
    expect(html).toContain('>noise<');
  });

  it('priority badge se OMITE en findings sin priorityScore (backward compat con tomos pre-DG-118 A)', () => {
    const html = renderTomoWebviewHtml(
      [
        makeFinding({
          severity: 'high',
          // sin priorityScore — tomo legacy
        }),
      ],
      opts,
    );
    // El CSS class `.priority-badge` siempre esta en el STYLE block del head,
    // pero el span correspondiente NO debe aparecer en el body si no hay
    // priorityScore. Assertion: no aparece como atributo class de span.
    expect(html).not.toContain('<span class="priority-badge');
    // Pero el severity badge sigue renderizando normalmente
    expect(html).toContain('badge-high');
  });

  it('priority badge title (tooltip) incluye severity + triage state explicit (DG-118 A discoverability)', () => {
    const html = renderTomoWebviewHtml(
      [
        makeFinding({
          severity: 'critical',
          triage: { classification: 'true_positive', confidence: 0.9, rationale: 'r' },
          priorityScore: 'urgent',
        }),
      ],
      opts,
    );
    expect(html).toContain('Priority: urgent (severity critical + tp triage state)');
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

  it('summary header muestra boton "Triage Remaining" cuando untriaged > 0 (DG-101 A)', () => {
    const html = renderTomoWebviewHtml(
      [
        makeFinding(),
        makeFinding(),
        makeFinding(),
        makeFinding({
          triage: { classification: 'true_positive', confidence: 0.95, rationale: 'r' },
        }),
      ],
      opts,
    );
    expect(html).toContain('data-action="triage-remaining"');
    expect(html).toContain('Triage 3 untriaged');
  });

  it('summary header NO muestra el boton cuando untriaged === 0 (DG-101 A)', () => {
    const html = renderTomoWebviewHtml(
      [
        makeFinding({
          triage: { classification: 'true_positive', confidence: 0.95, rationale: 'r' },
        }),
        makeFinding({
          triage: { classification: 'false_positive', confidence: 0.85, rationale: 'r' },
        }),
      ],
      opts,
    );
    // El querySelector 'data-action="triage-remaining"' vive en el <script>
    // siempre; chequeamos el elemento <button> directamente y el texto.
    expect(html).not.toContain('<button class="triage-remaining-btn"');
    expect(html).not.toContain('untriaged</button>');
  });

  it('script del webview registra handler para el boton Triage Remaining (DG-101 A)', () => {
    const html = renderTomoWebviewHtml([makeFinding()], opts);
    expect(html).toContain("type: 'triage-remaining'");
  });

  it('summary header muestra boton "Re-triage all" cuando triagedCount > 0 (DG-107 A)', () => {
    const html = renderTomoWebviewHtml(
      [
        makeFinding({
          triage: { classification: 'true_positive', confidence: 0.95, rationale: 'r' },
        }),
        makeFinding({
          triage: { classification: 'false_positive', confidence: 0.85, rationale: 'r' },
        }),
        makeFinding(), // untriaged
      ],
      opts,
    );
    expect(html).toContain('data-action="re-triage-all"');
    expect(html).toContain('Re-triage all');
  });

  it('summary header NO muestra boton "Re-triage all" cuando triagedCount === 0 (DG-107 A)', () => {
    const html = renderTomoWebviewHtml([makeFinding(), makeFinding()], opts);
    expect(html).not.toContain('<button class="re-triage-btn"');
    expect(html).not.toContain('>Re-triage all<');
  });

  it('script del webview registra handler para el boton Re-triage all (DG-107 A)', () => {
    const html = renderTomoWebviewHtml(
      [
        makeFinding({
          triage: { classification: 'true_positive', confidence: 0.95, rationale: 'r' },
        }),
      ],
      opts,
    );
    expect(html).toContain("type: 're-triage-all'");
  });

  it('renderiza la cost card cuando se pasa un CostSummary con rows (DG-099 A)', () => {
    const summary: CostSummary = {
      limit: 1,
      rows: [
        {
          providerLabel: 'anthropic/claude-haiku-4-5-20251001',
          agentId: 'triage',
          calls: 25,
          inputTokens: 7719,
          outputTokens: 2417,
          estimatedCostUsd: 0.0198,
          avgLatencyMs: 1761,
        },
      ],
      totals: { calls: 25, inputTokens: 7719, outputTokens: 2417, estimatedCostUsd: 0.0198 },
    };
    const html = renderTomoWebviewHtml([makeFinding()], opts, summary);
    expect(html).toContain('<div class="cost-card">');
    expect(html).toContain('Brain Layer cost');
    expect(html).toContain('anthropic/claude-haiku-4-5-20251001');
    expect(html).toContain('triage');
    expect(html).toContain('$0.0198');
    expect(html).toContain('1761ms');
    expect(html).toContain('Total: 25 calls');
  });

  it('NO emite la cost card cuando costSummary es null o undefined (DG-099 A)', () => {
    // Las clases .cost-card viven en el <style>; verificamos el TEXTO de la card.
    const htmlNull = renderTomoWebviewHtml([makeFinding()], opts, null);
    const htmlUndef = renderTomoWebviewHtml([makeFinding()], opts);
    expect(htmlNull).not.toContain('Brain Layer cost');
    expect(htmlUndef).not.toContain('Brain Layer cost');
  });

  it('NO emite la cost card cuando NO hay findings (no se renderea body principal — DG-099 A)', () => {
    const summary: CostSummary = {
      limit: 1,
      rows: [],
      totals: { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    };
    const html = renderTomoWebviewHtml([], opts, summary);
    expect(html).not.toContain('Brain Layer cost');
    expect(html).toContain('Scan Workspace');
  });
});

describe('renderCostCard — DG-099 A', () => {
  it('rinde el caveat "~estimated" + breakdown por (provider, agent)', () => {
    const summary: CostSummary = {
      limit: 1,
      rows: [
        {
          providerLabel: 'anthropic/claude-haiku-4-5-20251001',
          agentId: 'triage',
          calls: 25,
          inputTokens: 7719,
          outputTokens: 2417,
          estimatedCostUsd: 0.0198,
          avgLatencyMs: 1761,
        },
        {
          providerLabel: 'anthropic/claude-haiku-4-5-20251001',
          agentId: 'context',
          calls: 14,
          inputTokens: 4052,
          outputTokens: 2154,
          estimatedCostUsd: 0.0148,
          avgLatencyMs: 2311,
        },
        {
          providerLabel: 'anthropic/claude-haiku-4-5-20251001',
          agentId: 'remediation',
          calls: 14,
          inputTokens: 3954,
          outputTokens: 2644,
          estimatedCostUsd: 0.0172,
          avgLatencyMs: 2773,
        },
      ],
      totals: { calls: 53, inputTokens: 15725, outputTokens: 7215, estimatedCostUsd: 0.0518 },
    };
    const html = renderCostCard(summary);
    expect(html).toContain('~estimated USD');
    expect(html).toContain('triage');
    expect(html).toContain('context');
    expect(html).toContain('remediation');
    expect(html).toContain('$0.0198');
    expect(html).toContain('$0.0148');
    expect(html).toContain('$0.0172');
    expect(html).toContain('Total: 53 calls');
    expect(html).toContain('$0.0518');
  });

  it('rinde "last session" cuando limit === 1 (DG-099 A)', () => {
    const summary: CostSummary = {
      limit: 1,
      rows: [
        {
          providerLabel: 'p',
          agentId: 'triage',
          calls: 1,
          inputTokens: 100,
          outputTokens: 50,
          estimatedCostUsd: 0.001,
          avgLatencyMs: 1000,
        },
      ],
      totals: { calls: 1, inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.001 },
    };
    expect(renderCostCard(summary)).toContain('last session');
  });

  it('rinde "last N sessions" cuando limit > 1 (DG-099 A)', () => {
    const summary: CostSummary = {
      limit: 10,
      rows: [
        {
          providerLabel: 'p',
          agentId: 'triage',
          calls: 1,
          inputTokens: 100,
          outputTokens: 50,
          estimatedCostUsd: 0.001,
          avgLatencyMs: 1000,
        },
      ],
      totals: { calls: 1, inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.001 },
    };
    expect(renderCostCard(summary)).toContain('last 10 sessions');
  });

  it('rinde mensaje minimo cuando no hay rows (DG-099 A)', () => {
    const summary: CostSummary = {
      limit: 1,
      rows: [],
      totals: { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    };
    const html = renderCostCard(summary);
    expect(html).toContain('run Triage Findings');
    expect(html).not.toContain('Total:');
  });

  it('rinde "as of YYYY-MM-DD HH:MM" cuando latestSessionAt esta presente (DG-107 A)', () => {
    const summary: CostSummary = {
      limit: 1,
      rows: [
        {
          providerLabel: 'anthropic/claude-sonnet-4-6',
          agentId: 'triage',
          calls: 1,
          inputTokens: 100,
          outputTokens: 50,
          estimatedCostUsd: 0.001,
          avgLatencyMs: 1000,
        },
      ],
      totals: { calls: 1, inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.001 },
      latestSessionAt: '2026-05-26T14:32:18.000Z',
    };
    const html = renderCostCard(summary);
    expect(html).toContain('as of 2026-05-26 14:32');
  });

  it('NO emite el "as of" cuando latestSessionAt es undefined (DG-107 A)', () => {
    const summary: CostSummary = {
      limit: 1,
      rows: [
        {
          providerLabel: 'p',
          agentId: 'triage',
          calls: 1,
          inputTokens: 100,
          outputTokens: 50,
          estimatedCostUsd: 0.001,
          avgLatencyMs: 1000,
        },
      ],
      totals: { calls: 1, inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.001 },
    };
    expect(renderCostCard(summary)).not.toContain('as of');
  });
});

describe('formatLastSessionAt — DG-107 A', () => {
  it('formatea un ISO 8601 valido como "YYYY-MM-DD HH:MM"', () => {
    expect(formatLastSessionAt('2026-05-26T14:32:18.000Z')).toBe('2026-05-26 14:32');
  });

  it('formatea un ISO 8601 sin milisegundos correctamente', () => {
    expect(formatLastSessionAt('2026-01-01T00:00:00Z')).toBe('2026-01-01 00:00');
  });

  it('devuelve el string raw si el input no es un ISO valido (fallback defensivo)', () => {
    expect(formatLastSessionAt('not-an-iso')).toBe('not-an-iso');
    expect(formatLastSessionAt('')).toBe('');
  });

  it('NO usa Date() / timezone conversion (pure regex extract)', () => {
    // 14:32 UTC debe quedar 14:32 sin importar la TZ del runtime de tests.
    expect(formatLastSessionAt('2026-05-26T14:32:00.000Z')).toBe('2026-05-26 14:32');
  });
});

describe('parseCostSummary — DG-099 A', () => {
  it('parsea un JSON valido del CLI cost-history --json', () => {
    const raw = {
      limit: 1,
      rows: [
        {
          providerLabel: 'anthropic/claude-haiku-4-5-20251001',
          agentId: 'triage',
          calls: 25,
          inputTokens: 7719,
          outputTokens: 2417,
          estimatedCostUsd: 0.0198,
          avgLatencyMs: 1761,
        },
      ],
      totals: { calls: 25, inputTokens: 7719, outputTokens: 2417, estimatedCostUsd: 0.0198 },
    };
    const parsed = parseCostSummary(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.limit).toBe(1);
    expect(parsed?.rows[0]?.agentId).toBe('triage');
  });

  it('parsea un JSON con rows vacio (DB sin triage previo)', () => {
    const raw = {
      limit: 10,
      rows: [],
      totals: { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    };
    const parsed = parseCostSummary(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.rows).toEqual([]);
  });

  it('devuelve null defensivamente si el shape no coincide', () => {
    expect(parseCostSummary({ limit: 'no-int', rows: [], totals: {} })).toBeNull();
    expect(parseCostSummary(null)).toBeNull();
    expect(parseCostSummary({})).toBeNull();
  });

  it('devuelve null si agentId trae un valor desconocido (anti-drift schema)', () => {
    const raw = {
      limit: 1,
      rows: [
        {
          providerLabel: 'p',
          agentId: 'something_new',
          calls: 1,
          inputTokens: 1,
          outputTokens: 1,
          estimatedCostUsd: 0.001,
          avgLatencyMs: 1,
        },
      ],
      totals: { calls: 1, inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
    };
    expect(parseCostSummary(raw)).toBeNull();
  });
});

describe('renderFindingGroupCard — DG-113 A Step 4 / §4 #4', () => {
  /** Construye un FindingGroup-like para tests del renderer. */
  function makeGroup(args: {
    familyKey?: string;
    childCount?: number;
    display?: string;
    heterogeneous?: boolean;
    noFixAvailable?: boolean;
  }) {
    const familyKey = args.familyKey ?? 'protobufjs';
    const childCount = args.childCount ?? 3;
    return {
      familyKey,
      findings: Array.from({ length: childCount }, (_, i) => ({
        fingerprint: `fp-${String(i)}`,
        title: `${familyKey}: CVE-2026-44288-${String(i)}`,
        severity: 'high',
        location: { path: 'package-lock.json', startLine: 1 },
      })),
      remediation: {
        recommendedFixes: args.noFixAvailable ? {} : { '7': '7.5.8', '8': '8.2.0' },
        display: args.display ?? '7.5.8 / 8.2.0',
        heterogeneous: args.heterogeneous ?? true,
        noFixAvailable: args.noFixAvailable ?? false,
      },
    };
  }

  it('renderea card con familyKey, count, action y children', () => {
    const html = renderFindingGroupCard(makeGroup({ familyKey: 'protobufjs', childCount: 3 }));
    expect(html).toContain('protobufjs');
    expect(html).toContain('3 findings');
    expect(html).toContain('Upgrade');
    expect(html).toContain('7.5.8 / 8.2.0');
  });

  it('usa "1 finding" singular con childCount=1', () => {
    const html = renderFindingGroupCard(makeGroup({ childCount: 1 }));
    expect(html).toContain('1 finding<');
    expect(html).not.toContain('1 findings');
  });

  it('muestra nota de heterogeneidad cuando aplica', () => {
    const html = renderFindingGroupCard(makeGroup({ heterogeneous: true }));
    expect(html).toContain('Fix set is heterogeneous');
  });

  it('NO muestra nota cuando heterogeneous=false', () => {
    const html = renderFindingGroupCard(makeGroup({ heterogeneous: false, display: '7.5.8' }));
    expect(html).not.toContain('Fix set is heterogeneous');
  });

  it('muestra "No fix available" cuando noFixAvailable=true', () => {
    const html = renderFindingGroupCard(makeGroup({ noFixAvailable: true }));
    expect(html).toContain('No fix available');
    expect(html).not.toContain('Upgrade');
  });

  it('escapa el familyKey (anti-XSS via package name pathologico)', () => {
    const html = renderFindingGroupCard(makeGroup({ familyKey: '<img src=x>' }));
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
  });

  it('usa <details> nativo (collapse por default sin JS)', () => {
    const html = renderFindingGroupCard(makeGroup({}));
    expect(html).toMatch(/<details>[\s\S]*<summary>/);
  });
});

describe('renderTomoWebviewHtml — groups section (DG-113 A Step 4)', () => {
  function makeFindingFor(severity: string = 'high'): ExtensionFinding {
    return {
      severity: severity as 'critical' | 'high' | 'medium' | 'low' | 'info',
      category: 'SCA',
      ruleId: 'CVE-X',
      title: 'pkg: CVE-X',
      message: 'pkg is vulnerable.',
      location: { path: 'package-lock.json', startLine: 1 },
      fingerprint: 'fp-test',
      lifecycleState: 'new',
    };
  }
  function makeGroupForRender() {
    return {
      familyKey: 'protobufjs',
      findings: [
        {
          fingerprint: 'fp-1',
          title: 'protobufjs: CVE-2026-44288',
          severity: 'high',
          location: { path: 'package-lock.json', startLine: 1 },
        },
      ],
      remediation: {
        recommendedFixes: { '7': '7.5.8' },
        display: '7.5.8',
        heterogeneous: false,
        noFixAvailable: false,
      },
    };
  }

  it('incluye seccion "SCA grouped remediations" cuando hay groups', () => {
    const html = renderTomoWebviewHtml([makeFindingFor()], { nonce: 'N1', cspSource: 'cs' }, null, [
      makeGroupForRender(),
    ]);
    // Header HTML del bucket (NO el comentario CSS del <style>).
    expect(html).toContain('<h3 class="section section-groups">');
    expect(html).toContain('protobufjs');
  });

  it('NO incluye seccion cuando groups esta vacio', () => {
    const html = renderTomoWebviewHtml(
      [makeFindingFor()],
      { nonce: 'N1', cspSource: 'cs' },
      null,
      [],
    );
    expect(html).not.toContain('<h3 class="section section-groups">');
    expect(html).not.toContain('class="finding-group"');
  });

  it('NO incluye seccion cuando groups es undefined', () => {
    const html = renderTomoWebviewHtml([makeFindingFor()], { nonce: 'N1', cspSource: 'cs' }, null);
    expect(html).not.toContain('<h3 class="section section-groups">');
    expect(html).not.toContain('class="finding-group"');
  });
});

describe('renderOverrideDirective — DG-115 A Step 5 / §4 #15 (prismjs)', () => {
  function makeDirective(overrides: Partial<Parameters<typeof renderOverrideDirective>[0]> = {}) {
    return {
      manager: 'npm' as const,
      packageName: 'prismjs',
      versionRange: '^1.30.0',
      snippet: '"overrides": {\n  "prismjs": "^1.30.0"\n}',
      hasSiblingFixedCopy: true,
      pinnedBy: ['refractor@3.6.0'],
      ...overrides,
    };
  }

  it('variant STRONG cuando hasSiblingFixedCopy=true (caveat fuerte)', () => {
    const html = renderOverrideDirective(makeDirective({ hasSiblingFixedCopy: true }), '1.30.0');
    expect(html).toContain('override-directive strong');
    expect(html).toContain('Top-level bump alone will NOT fix this');
    // Mixed case (no full-caps en el header)
    expect(html).not.toContain('TOP-LEVEL BUMP ALONE WILL NOT FIX THIS');
  });

  it('STRONG NO se envuelve en <details> (queda expandido por default)', () => {
    const html = renderOverrideDirective(makeDirective({ hasSiblingFixedCopy: true }), '1.30.0');
    expect(html).not.toContain('override-collapsed');
    expect(html.startsWith('<div class="override-directive strong"')).toBe(true);
  });

  it('SOFT (DG-115.1 A G7): se envuelve en <details class="override-collapsed soft"> con summary one-liner', () => {
    const html = renderOverrideDirective(
      makeDirective({ hasSiblingFixedCopy: false, pinnedBy: ['refractor@3.6.0'] }),
      '1.30.0',
    );
    expect(html).toContain('<details class="override-collapsed soft"');
    expect(html).toContain('<summary>');
    expect(html).toContain('Transitive (via <code>refractor@3.6.0</code>)');
    expect(html).toContain('plain bump usually works; override if it persists');
  });

  it('SOFT summary cita pinnedBy[0] real (G4 + user-mandate: no placeholder)', () => {
    const html = renderOverrideDirective(
      makeDirective({ hasSiblingFixedCopy: false, pinnedBy: ['@grpc/grpc-js@1.10.0'] }),
      '1.30.0',
    );
    expect(html).toContain('Transitive (via <code>@grpc/grpc-js@1.10.0</code>)');
  });

  it('SOFT con multiples pinners: summary cita el primero + "+ N more"', () => {
    const html = renderOverrideDirective(
      makeDirective({
        hasSiblingFixedCopy: false,
        pinnedBy: ['parentA@1.0.0', 'parentB@2.0.0', 'parentC@3.0.0'],
      }),
      '1.30.0',
    );
    expect(html).toContain('Transitive (via <code>parentA@1.0.0</code> + 2 more)');
  });

  it('SOFT sin pinners (degenerado): summary cae a "Transitive" sin via', () => {
    const html = renderOverrideDirective(
      makeDirective({ hasSiblingFixedCopy: false, pinnedBy: [] }),
      '1.30.0',
    );
    expect(html).toContain('<summary>Transitive — plain bump usually works');
    expect(html).not.toContain('via <code>');
  });

  it('SOFT body contiene el override completo (caveat + plain bump + snippet + Copy + risk) dentro del <details>', () => {
    const html = renderOverrideDirective(makeDirective({ hasSiblingFixedCopy: false }), '1.30.0');
    // El override-directive-body es el wrapper interno del details.
    expect(html).toContain('override-directive-body');
    expect(html).toContain('A plain update of');
    expect(html).toContain('Plain bump:');
    expect(html).toContain('prismjs@1.30.0');
    expect(html).toContain('data-action="copy-override"');
    expect(html).toContain('Conservative alternative');
  });

  it('OMITE la linea "Plain bump:" cuando hasSiblingFixedCopy=true', () => {
    const html = renderOverrideDirective(makeDirective({ hasSiblingFixedCopy: true }), '1.30.0');
    expect(html).not.toContain('Plain bump:');
  });

  it('incluye Copy button con data-snippet y data-action', () => {
    const html = renderOverrideDirective(makeDirective(), '1.30.0');
    expect(html).toContain('data-action="copy-override"');
    expect(html).toContain('data-snippet=');
    expect(html).toContain('Copy</button>');
  });

  it('cita el pinner en el caveat de riesgo + ofrece exact como conservadora', () => {
    const html = renderOverrideDirective(makeDirective(), '1.30.0');
    expect(html).toContain('refractor@3.6.0');
    expect(html).toContain('Conservative alternative');
    expect(html).toContain('prismjs@1.30.0');
  });

  it('renderea el snippet escapado como bloque pre', () => {
    const html = renderOverrideDirective(makeDirective(), '1.30.0');
    expect(html).toContain('class="override-snippet"');
    // El snippet contiene comillas — deben estar escapadas en el atributo data-snippet
    // pero el contenido del <pre> tambien.
    expect(html).toContain('&quot;prismjs&quot;');
  });

  it('escapa pinnedBy (anti-XSS via parent name pathologico)', () => {
    const html = renderOverrideDirective(
      makeDirective({ pinnedBy: ['<img src=x onerror=alert(1)>'] }),
      '1.30.0',
    );
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renderFindingGroupCard inserta el directive cuando esta presente', () => {
    const group = {
      familyKey: 'prismjs',
      findings: [
        {
          fingerprint: 'fp-prismjs',
          title: 'prismjs: CVE-2024-53382',
          severity: 'medium',
          location: { path: 'pnpm-lock.yaml', startLine: 1 },
        },
      ],
      remediation: {
        recommendedFixes: { '1': '1.30.0' },
        display: '1.30.0',
        heterogeneous: false,
        noFixAvailable: false,
        overrideDirective: {
          manager: 'npm' as const,
          packageName: 'prismjs',
          versionRange: '^1.30.0',
          snippet: '"overrides": {\n  "prismjs": "^1.30.0"\n}',
          hasSiblingFixedCopy: true,
          pinnedBy: ['refractor@3.6.0'],
        },
      },
    };
    const html = renderFindingGroupCard(group);
    expect(html).toContain('override-directive strong');
    expect(html).toContain('refractor@3.6.0');
  });

  it('renderFindingGroupCard NO inserta directive cuando esta ausente', () => {
    const group = {
      familyKey: 'protobufjs',
      findings: [
        {
          fingerprint: 'fp-1',
          title: 'protobufjs: CVE-X',
          severity: 'high',
          location: { path: 'package-lock.json', startLine: 1 },
        },
      ],
      remediation: {
        recommendedFixes: { '7': '7.5.8' },
        display: '7.5.8',
        heterogeneous: false,
        noFixAvailable: false,
      },
    };
    const html = renderFindingGroupCard(group);
    expect(html).not.toContain('override-directive');
  });
});

/**
 * DG-130 A Sub-A2 (Cycle 116 FASE III): render banner "Verdict changed" +
 * section "Previously" + summary card scan-diff line.
 */
describe('renderTomoWebviewHtml — DG-130 A Sub-A2 (verdict history + diff)', () => {
  it('no emite banner ni Previously cuando el finding no tiene previouslyVerdicts', () => {
    const finding = makeFinding({
      triage: { classification: 'true_positive', confidence: 0.9, rationale: 'r' },
    });
    const html = renderTomoWebviewHtml([finding], opts);
    // `verdict-changed-banner` aparece en el CSS SIEMPRE, buscamos DIV real
    expect(html).not.toContain('class="verdict-changed-banner"');
    expect(html).not.toContain('<details class="previously">');
  });

  it('no emite banner ni Previously cuando solo hay 1 entry (primera vez triaged)', () => {
    const finding = makeFinding({
      triage: { classification: 'true_positive', confidence: 0.9, rationale: 'r' },
      previouslyVerdicts: [
        {
          classification: 'true_positive',
          confidence: 0.9,
          rationale: 'r',
          providerLabel: 'deepseek/v4-flash',
          createdAt: '2026-07-03T00:00:00.000Z',
        },
      ],
    });
    const html = renderTomoWebviewHtml([finding], opts);
    expect(html).not.toContain('class="verdict-changed-banner"');
    expect(html).not.toContain('<details class="previously">');
  });

  it('emite banner cuando classification CAMBIÓ vs previous', () => {
    const finding = makeFinding({
      triage: { classification: 'inconclusive', confidence: 0.7, rationale: 'ambiguous' },
      previouslyVerdicts: [
        {
          classification: 'inconclusive',
          confidence: 0.7,
          rationale: 'current',
          providerLabel: 'deepseek/v4-flash',
          createdAt: '2026-07-03T00:00:00.000Z',
        },
        {
          classification: 'false_positive',
          confidence: 0.95,
          rationale: 'prior',
          providerLabel: 'deepseek/v4-flash',
          createdAt: '2026-07-02T00:00:00.000Z',
        },
      ],
    });
    const html = renderTomoWebviewHtml([finding], opts);
    expect(html).toContain('class="verdict-changed-banner"');
    expect(html).toContain('Verdict changed since last scan');
    // Baseline-13 empirical: FP 95% → INC 70%
    expect(html).toContain('95%');
    expect(html).toContain('70%');
    // Reason heurístico: same provider + class change → "Verdict reclassified"
    expect(html).toContain('Verdict reclassified');
  });

  it('emite banner con reason "Different provider" cuando cambió el provider', () => {
    const finding = makeFinding({
      triage: { classification: 'true_positive', confidence: 0.9, rationale: 'r' },
      previouslyVerdicts: [
        {
          classification: 'true_positive',
          confidence: 0.9,
          rationale: 'current',
          providerLabel: 'openai/gpt-4o',
          createdAt: '2026-07-03T00:00:00.000Z',
        },
        {
          classification: 'inconclusive',
          confidence: 0.5,
          rationale: 'prior',
          providerLabel: 'deepseek/v4-flash',
          createdAt: '2026-07-02T00:00:00.000Z',
        },
      ],
    });
    const html = renderTomoWebviewHtml([finding], opts);
    expect(html).toContain('class="verdict-changed-banner"');
    expect(html).toContain('Different provider');
    expect(html).toContain('deepseek/v4-flash');
    expect(html).toContain('openai/gpt-4o');
  });

  it('no emite banner cuando el classification NO cambió y confidence delta es pequeño', () => {
    const finding = makeFinding({
      triage: { classification: 'true_positive', confidence: 0.92, rationale: 'r' },
      previouslyVerdicts: [
        {
          classification: 'true_positive',
          confidence: 0.92,
          rationale: 'current',
          providerLabel: 'deepseek/v4-flash',
          createdAt: '2026-07-03T00:00:00.000Z',
        },
        {
          classification: 'true_positive',
          confidence: 0.9, // delta 0.02 < 0.15 threshold
          rationale: 'prior',
          providerLabel: 'deepseek/v4-flash',
          createdAt: '2026-07-02T00:00:00.000Z',
        },
      ],
    });
    const html = renderTomoWebviewHtml([finding], opts);
    expect(html).not.toContain('class="verdict-changed-banner"');
    // Previously SÍ debe aparecer (length >= 2)
    expect(html).toContain('<details class="previously">');
    expect(html).toContain('1 prior verdict');
  });

  it('section Previously excluye el actual y muestra solo los históricos', () => {
    const finding = makeFinding({
      triage: { classification: 'inconclusive', confidence: 0.7, rationale: 'r' },
      previouslyVerdicts: [
        {
          classification: 'inconclusive',
          confidence: 0.7,
          rationale: 'ACTUAL DEBE ESTAR EN CARD TRIAGE, NO EN LA LISTA',
          providerLabel: 'deepseek/v4-flash',
          createdAt: '2026-07-03T00:00:00.000Z',
        },
        {
          classification: 'false_positive',
          confidence: 0.95,
          rationale: 'MOTIVO_PREVIO_UNICO',
          providerLabel: 'deepseek/v4-flash',
          createdAt: '2026-07-02T00:00:00.000Z',
        },
        {
          classification: 'inconclusive',
          confidence: 0.45,
          rationale: 'MOTIVO_ANTERIOR_ANTERIOR',
          providerLabel: 'anthropic/claude-haiku-4-5',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    });
    const html = renderTomoWebviewHtml([finding], opts);
    expect(html).toContain('<details class="previously">');
    expect(html).toContain('2 prior verdicts');
    // El rationale ACTUAL aparece en la triage line (card), NO dentro de la
    // sección Previously — verificamos que los prior rationales sí aparecen
    expect(html).toContain('MOTIVO_PREVIO_UNICO');
    expect(html).toContain('MOTIVO_ANTERIOR_ANTERIOR');
    // "ACTUAL DEBE ESTAR..." está en la triage line pero no debería duplicarse
    // dentro de <ul class="prev-list"> — chequeo laxo:
    const prevListStart = html.indexOf('<ul class="prev-list">');
    const prevListEnd = html.indexOf('</ul>', prevListStart);
    const prevListSection = html.slice(prevListStart, prevListEnd);
    expect(prevListSection).not.toContain('ACTUAL DEBE ESTAR');
  });

  it('summary card emite scan-diff line cuando scanDiff.reclassifiedCount > 0', () => {
    const finding = makeFinding({
      triage: { classification: 'true_positive', confidence: 0.9, rationale: 'r' },
    });
    const html = renderTomoWebviewHtml([finding], opts, undefined, undefined, {
      newFindingsCount: 2,
      reclassifiedCount: 1,
      unchangedCount: 5,
    });
    expect(html).toContain('class="scan-diff"');
    expect(html).toContain('Scan diff vs previous triage');
    expect(html).toContain('2 new');
    expect(html).toContain('1 re-classified');
    expect(html).toContain('5 unchanged');
    // reclassified > 0 tiene destaque visual con clase "diff-reclassified"
    expect(html).toContain('diff-reclassified');
  });

  it('summary card NO emite scan-diff line cuando scanDiff es undefined', () => {
    const finding = makeFinding({
      triage: { classification: 'true_positive', confidence: 0.9, rationale: 'r' },
    });
    const html = renderTomoWebviewHtml([finding], opts);
    expect(html).not.toContain('class="scan-diff"');
    expect(html).not.toContain('Scan diff vs previous triage');
  });
});

/**
 * DG-132 A Sub-A2 (Cycle 118 FASE III R22): scan-diff line breakdown por reason.
 */
describe('renderTomoWebviewHtml — DG-132 A Sub-A2 (scan-diff breakdown)', () => {
  it('emite breakdown (X class, Y confidence, Z provider) cuando reclassifiedByReason presente', () => {
    const finding = makeFinding({
      triage: { classification: 'true_positive', confidence: 0.9, rationale: 'r' },
    });
    const html = renderTomoWebviewHtml([finding], opts, undefined, undefined, {
      newFindingsCount: 1,
      reclassifiedCount: 5,
      unchangedCount: 30,
      reclassifiedByReason: {
        classChanged: 2,
        confidenceDelta: 3,
        providerChanged: 0,
      },
    });
    expect(html).toContain('5 re-classified (2 class, 3 confidence, 0 provider)');
    expect(html).toContain('1 new');
    expect(html).toContain('30 unchanged');
  });

  it('sin reclassifiedByReason NO emite breakdown suffix (backward-compat)', () => {
    const finding = makeFinding({
      triage: { classification: 'true_positive', confidence: 0.9, rationale: 'r' },
    });
    const html = renderTomoWebviewHtml([finding], opts, undefined, undefined, {
      newFindingsCount: 1,
      reclassifiedCount: 2,
      unchangedCount: 10,
    });
    // NO paréntesis con class/confidence/provider en el output
    expect(html).not.toContain('class,');
    expect(html).not.toContain('confidence,');
    expect(html).not.toContain('provider)');
  });
});

/**
 * DG-131 A Sub-A2 (Cycle 117 FASE III R20): badge [grouped] en finding card.
 */
describe('renderTomoWebviewHtml — DG-131 A Sub-A2 (group badge)', () => {
  it('no emite grouped-badge cuando finding no tiene groupId', () => {
    const finding = makeFinding({
      triage: { classification: 'true_positive', confidence: 0.9, rationale: 'r' },
    });
    const html = renderTomoWebviewHtml([finding], opts);
    expect(html).not.toContain('class="grouped-badge');
    expect(html).not.toContain('GROUPED REP');
    expect(html).not.toContain('>GROUPED<');
  });

  it('emite GROUPED REP badge cuando finding es representative', () => {
    const finding = makeFinding({
      triage: { classification: 'true_positive', confidence: 0.75, rationale: 'r' },
      groupId: 'group-xyz',
      isGroupRepresentative: true,
    });
    const html = renderTomoWebviewHtml([finding], opts);
    expect(html).toContain('grouped-representative');
    expect(html).toContain('GROUPED REP');
    expect(html).toContain('Group representative');
  });

  it('emite GROUPED badge cuando finding es member (non-representative)', () => {
    const finding = makeFinding({
      triage: {
        classification: 'true_positive',
        confidence: 0.675,
        rationale: 'r [group SCA:x, member 2 of 3]',
      },
      groupId: 'group-xyz',
      isGroupRepresentative: false,
    });
    const html = renderTomoWebviewHtml([finding], opts);
    expect(html).toContain('grouped-member');
    expect(html).toContain('>GROUPED<');
    expect(html).toContain('Group member');
  });
});
