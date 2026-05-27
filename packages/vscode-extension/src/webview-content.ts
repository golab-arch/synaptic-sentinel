import { triageLabel } from './diagnostics.js';
import type { ExtensionFinding } from './tomo.js';

/** Escapa los caracteres con significado en HTML (defensa anti-inyeccion). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Severidades de mayor a menor gravedad, para ordenar dentro de cada bucket. */
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

/**
 * Estado de triage que define el bucket visual del finding (DG-097 A).
 *
 * El sidebar agrupa findings por triage state ANTES que por severidad: el
 * usuario quiere ver primero lo que tiene que arreglar (TP), despues lo que
 * el agente no pudo clasificar (INC), despues lo nuevo sin triage, y por
 * ultimo lo ya descartado (FP). Severity sigue determinando el orden dentro
 * de cada bucket.
 */
export type TriageState = 'tp' | 'inc' | 'untriaged' | 'fp';

/** Orden de buckets en el sidebar (TP arriba, FP abajo). */
const STATE_ORDER: readonly TriageState[] = ['tp', 'inc', 'untriaged', 'fp'];

/** Etiqueta legible del bucket. */
const STATE_HEADING: Readonly<Record<TriageState, string>> = {
  tp: 'To fix · true positive',
  inc: 'Inconclusive · agent could not decide',
  untriaged: 'Untriaged · run Triage Findings',
  fp: 'Already false positive',
};

/** Etiqueta corta del badge por estado. */
const STATE_BADGE_LABEL: Readonly<Record<TriageState, string>> = {
  tp: 'TP',
  inc: 'INC',
  untriaged: 'NEW',
  fp: 'FP',
};

/**
 * Mapea la `classification` de un Finding al bucket de triage state.
 *
 * Si el finding no fue triado, queda como `untriaged`. Si trae una
 * clasificacion desconocida (drift del agente), tambien cae a `untriaged`
 * defensivamente — preferimos sub-clasificar a sobre-clasificar.
 */
export function triageStateOf(finding: ExtensionFinding): TriageState {
  if (finding.triage === undefined) return 'untriaged';
  const c = finding.triage.classification;
  if (c === 'true_positive') return 'tp';
  if (c === 'false_positive') return 'fp';
  if (c === 'inconclusive') return 'inc';
  return 'untriaged';
}

/** Opciones para renderizar el HTML del webview. */
export interface WebviewHtmlOptions {
  /** Nonce CSP — autoriza el unico `<script>` inline del webview. */
  readonly nonce: string;
  /** `webview.cspSource` — origen permitido para los estilos. */
  readonly cspSource: string;
}

/** Hoja de estilos del webview; usa las variables de tema de VSCode. */
const STYLE = `
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    font-size: var(--vscode-font-size); padding: 0.5rem; }
  h2 { font-size: 1rem; margin: 0.25rem 0; }
  .empty { color: var(--vscode-descriptionForeground); }
  .summary { background: var(--vscode-textBlockQuote-background, transparent);
    border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-panel-border));
    padding: 0.5rem 0.6rem; margin: 0.4rem 0 0.8rem; font-size: 0.85em;
    line-height: 1.5; }
  .summary .total { font-weight: 700; }
  .summary .sep { color: var(--vscode-descriptionForeground); margin: 0 0.35rem; }
  .summary .pill-tp { color: #e8826d; font-weight: 600; }
  .summary .pill-inc { color: #d6b400; font-weight: 600; }
  .summary .pill-untriaged { color: var(--vscode-foreground); font-weight: 600; }
  .summary .pill-fp { color: #6aa1d6; font-weight: 600; }
  h3.section { font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.5px;
    margin: 1rem 0 0.4rem; padding: 0.25rem 0; font-weight: 700;
    border-bottom: 1px solid var(--vscode-panel-border);
    color: var(--vscode-descriptionForeground); }
  h3.section .count { font-weight: 400; margin-left: 0.4rem; }
  h3.section .heading-icon { display: inline-block; width: 1.1em; text-align: center;
    margin-right: 0.3rem; }
  h3.section-tp .heading-icon { color: #e8826d; }
  h3.section-inc .heading-icon { color: #d6b400; }
  h3.section-untriaged .heading-icon { color: var(--vscode-foreground); }
  h3.section-fp .heading-icon { color: #6aa1d6; }
  .finding { border: 1px solid var(--vscode-panel-border); border-left-width: 3px;
    border-radius: 4px; padding: 0.5rem 0.6rem; margin: 0.4rem 0; cursor: pointer; }
  .finding:hover { background: var(--vscode-list-hoverBackground); }
  .finding.state-fp { opacity: 0.55; }
  .finding.state-fp:hover { opacity: 1; }
  .sev-critical { border-left-color: #d11; }
  .sev-high { border-left-color: #e8821a; }
  .sev-medium { border-left-color: #d6b400; }
  .sev-low { border-left-color: #3a8bd6; }
  .sev-info { border-left-color: #888; }
  .head { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .badge { font-size: 0.68em; font-weight: 700; text-transform: uppercase;
    color: #fff; border-radius: 3px; padding: 0.05rem 0.35rem; }
  .badge-critical { background: #7c1d1d; }
  .badge-high { background: #c0392b; }
  .badge-medium { background: #c87f0a; }
  .badge-low { background: #2c6fbb; }
  .badge-info { background: #6b7280; }
  .state-badge { font-size: 0.65em; font-weight: 700; letter-spacing: 0.3px;
    border-radius: 3px; padding: 0.05rem 0.35rem; margin-left: auto;
    background: #444; color: #fff; }
  .state-tp .state-badge { background: #c0392b; }
  .state-inc .state-badge { background: #c87f0a; }
  .state-untriaged .state-badge { background: #4a4a4a; }
  .state-fp .state-badge { background: #2c6fbb; }
  .title { font-weight: 600; }
  .loc { font-family: var(--vscode-editor-font-family), monospace; font-size: 0.8em;
    color: var(--vscode-descriptionForeground); margin-top: 0.15rem; }
  .msg { font-size: 0.9em; margin-top: 0.25rem; }
  .brain { font-size: 0.85em; margin-top: 0.3rem;
    color: var(--vscode-descriptionForeground); }
`;

/** Formatea la confidence (0..1) como porcentaje entero ("95%"). */
function formatConfidence(confidence: number): string {
  return `${String(Math.round(confidence * 100))}%`;
}

/**
 * Texto del state badge del card. Incluye la confidence cuando el finding
 * esta triado (no se muestra para `untriaged` porque no hay confidence).
 */
function stateBadgeText(state: TriageState, finding: ExtensionFinding): string {
  const label = STATE_BADGE_LABEL[state];
  if (state === 'untriaged' || finding.triage === undefined) return label;
  return `${label} ${formatConfidence(finding.triage.confidence)}`;
}

/** Renderiza la tarjeta clickeable de un hallazgo. */
function renderCard(finding: ExtensionFinding): string {
  const severity = finding.severity;
  const state = triageStateOf(finding);
  const loc = `${finding.location.path}:${String(finding.location.startLine)}`;
  const parts = [
    `<div class="finding sev-${escapeHtml(severity)} state-${state}" ` +
      `data-path="${escapeHtml(finding.location.path)}" ` +
      `data-line="${String(finding.location.startLine)}" ` +
      `data-state="${state}" ` +
      `tabindex="0" role="button">`,
    `<div class="head"><span class="badge badge-${escapeHtml(severity)}">` +
      `${escapeHtml(severity)}</span>` +
      `<span class="title">${escapeHtml(finding.title)}</span>` +
      `<span class="state-badge">${escapeHtml(stateBadgeText(state, finding))}</span></div>`,
    `<div class="loc">${escapeHtml(loc)} · ${escapeHtml(finding.category)}</div>`,
    `<div class="msg">${escapeHtml(finding.message)}</div>`,
  ];
  if (finding.triage !== undefined) {
    parts.push(
      `<div class="brain"><strong>Triage:</strong> ` +
        `${escapeHtml(triageLabel(finding.triage.classification))} — ` +
        `${escapeHtml(finding.triage.rationale)}</div>`,
    );
  }
  if (finding.context !== undefined) {
    parts.push(
      `<div class="brain"><strong>Context:</strong> ` +
        `${escapeHtml(finding.context.summary)}</div>`,
    );
  }
  if (finding.remediation !== undefined) {
    parts.push(
      `<div class="brain"><strong>Remediation:</strong> ` +
        `${escapeHtml(finding.remediation.summary)}</div>`,
    );
  }
  parts.push('</div>');
  return parts.join('');
}

/**
 * Agrupa findings por triage state (DG-097 A). Cada bucket mantiene su orden
 * interno por severidad (critical > high > medium > low > info).
 */
export function groupByTriageState(
  findings: readonly ExtensionFinding[],
): Readonly<Record<TriageState, readonly ExtensionFinding[]>> {
  const buckets: Record<TriageState, ExtensionFinding[]> = {
    tp: [],
    inc: [],
    untriaged: [],
    fp: [],
  };
  for (const finding of findings) {
    buckets[triageStateOf(finding)].push(finding);
  }
  for (const state of STATE_ORDER) {
    buckets[state].sort((a, b) => {
      const ia = SEVERITY_ORDER.indexOf(a.severity);
      const ib = SEVERITY_ORDER.indexOf(b.severity);
      return ia - ib;
    });
  }
  return buckets;
}

/** Glyph del section heading por estado (solo CSS-styled, sin emoji). */
const STATE_HEADING_GLYPH: Readonly<Record<TriageState, string>> = {
  tp: '●',
  inc: '?',
  untriaged: '○',
  fp: '✓',
};

/** Renderiza la summary card del header con el breakdown por triage state. */
function renderSummary(
  buckets: Readonly<Record<TriageState, readonly ExtensionFinding[]>>,
): string {
  const total = STATE_ORDER.reduce((acc, s) => acc + buckets[s].length, 0);
  const segments: string[] = [];
  for (const state of STATE_ORDER) {
    const count = buckets[state].length;
    if (count === 0) continue;
    segments.push(
      `<span class="pill-${state}">${String(count)} ${STATE_BADGE_LABEL[state]}</span>`,
    );
  }
  return (
    `<div class="summary">` +
    `<span class="total">${String(total)} finding${total === 1 ? '' : 's'}</span>` +
    (segments.length > 0
      ? `<span class="sep">·</span>${segments.join('<span class="sep">·</span>')}`
      : '') +
    `<div class="loc">click a card to open the file</div>` +
    `</div>`
  );
}

/**
 * Renderiza el documento HTML del webview "tomo vivo" (v0.4 §4.3): los
 * hallazgos del ultimo scan agrupados por triage state (DG-097 A) y, dentro
 * de cada bucket, por severidad. Funcion pura — el `WebviewViewProvider` la
 * envuelve.
 *
 * Todo el contenido dinamico se escapa: el panel de una herramienta de
 * seguridad no debe poder inyectar HTML a partir de los hallazgos. El unico
 * `<script>` se autoriza con un nonce CSP.
 */
export function renderTomoWebviewHtml(
  findings: readonly ExtensionFinding[],
  options: WebviewHtmlOptions,
): string {
  const csp =
    `default-src 'none'; ` +
    `style-src ${options.cspSource} 'unsafe-inline'; ` +
    `script-src 'nonce-${options.nonce}';`;

  let body: string;
  if (findings.length === 0) {
    body = '<p class="empty">Run "Scan Workspace" to see findings here.</p>';
  } else {
    const buckets = groupByTriageState(findings);
    const sections: string[] = [];
    for (const state of STATE_ORDER) {
      const bucket = buckets[state];
      if (bucket.length === 0) continue;
      sections.push(
        `<h3 class="section section-${state}">` +
          `<span class="heading-icon">${STATE_HEADING_GLYPH[state]}</span>` +
          `${escapeHtml(STATE_HEADING[state])}` +
          `<span class="count">· ${String(bucket.length)}</span>` +
          `</h3>`,
      );
      for (const finding of bucket) {
        sections.push(renderCard(finding));
      }
    }
    body = renderSummary(buckets) + sections.join('');
  }

  // El script: al hacer click en una tarjeta, pide a la extension abrir el
  // archivo. `acquireVsCodeApi` lo expone el host del webview.
  const script =
    `const api = acquireVsCodeApi();` +
    `for (const el of document.querySelectorAll('.finding')) {` +
    `el.addEventListener('click', () => {` +
    `api.postMessage({ type: 'reveal', path: el.dataset.path, ` +
    `line: Number(el.dataset.line) });` +
    `});}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${STYLE}</style>
</head>
<body>
<h2>SYNAPTIC Sentinel</h2>
${body}
<script nonce="${options.nonce}">${script}</script>
</body>
</html>`;
}
