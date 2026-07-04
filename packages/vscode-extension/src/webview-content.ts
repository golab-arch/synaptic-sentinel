import { triageLabel } from './diagnostics.js';
import type { CostSummary, ExtensionFinding, ExtensionScanDiff } from './tomo.js';

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
  .summary .triage-remaining-btn,
  .summary .re-triage-btn {
    display: inline-block; margin-left: 0.6rem;
    padding: 0.15rem 0.6rem; border-radius: 3px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-button-border, transparent);
    font-size: 0.85em; font-weight: 600; cursor: pointer; }
  .summary .triage-remaining-btn:hover,
  .summary .re-triage-btn:hover { background: var(--vscode-button-hoverBackground); }
  .summary .re-triage-btn {
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground)); }
  .summary .re-triage-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
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
  /* DG-118 A (Cycle 109): priority badge — SEPARADO del severity y del
     confidence del triage. Colores intencionalmente DIFERENTES de los
     severity badges para que el usuario lea ambos como conceptos
     distintos (no como duplicacion). */
  .priority-badge { font-size: 0.62em; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.4px;
    border-radius: 3px; padding: 0.05rem 0.35rem; color: #fff;
    border: 1px solid transparent; }
  .priority-urgent { background: #a61b29; border-color: #ff5566;
    color: #fff; }
  .priority-high { background: #d4541c; color: #fff; }
  .priority-medium { background: #b78d00; color: #fff; }
  .priority-low { background: #5586bd; color: #fff; }
  .priority-noise { background: transparent;
    color: var(--vscode-descriptionForeground);
    border-color: var(--vscode-descriptionForeground);
    font-style: italic; }
  /* Confidence% del LLM, demoteado a la linea de brain — clarifica que
     es "LLM confidence en su veredicto", NO prioridad. */
  .llm-confidence { font-size: 0.85em; opacity: 0.75;
    margin-left: 0.4rem; font-style: italic; }
  .title { font-weight: 600; }
  .loc { font-family: var(--vscode-editor-font-family), monospace; font-size: 0.8em;
    color: var(--vscode-descriptionForeground); margin-top: 0.15rem; }
  .msg { font-size: 0.9em; margin-top: 0.25rem; }
  .brain { font-size: 0.85em; margin-top: 0.3rem;
    color: var(--vscode-descriptionForeground); }
  .cost-card { border: 1px solid var(--vscode-panel-border);
    border-left: 3px solid #6aa1d6; border-radius: 4px;
    padding: 0.5rem 0.6rem; margin: 0.4rem 0 0.8rem; font-size: 0.85em;
    background: var(--vscode-textBlockQuote-background, transparent); }
  .cost-card .cost-title { font-weight: 700; }
  .cost-card .cost-caveat { color: var(--vscode-descriptionForeground);
    font-size: 0.9em; margin-left: 0.4rem; }
  .cost-card .cost-asof { color: var(--vscode-descriptionForeground);
    font-size: 0.9em; margin-left: 0.4rem; font-style: italic; }
  .cost-card table { width: 100%; border-collapse: collapse;
    margin: 0.4rem 0 0.25rem; font-family: var(--vscode-editor-font-family), monospace; }
  .cost-card th, .cost-card td { padding: 0.15rem 0.4rem;
    text-align: left; font-size: 0.85em; }
  .cost-card th { font-weight: 600;
    color: var(--vscode-descriptionForeground); }
  .cost-card td.num { text-align: right;
    font-variant-numeric: tabular-nums; }
  .cost-card .cost-total { margin-top: 0.25rem;
    color: var(--vscode-foreground); font-weight: 600; }
  .cost-card .cost-empty { color: var(--vscode-descriptionForeground);
    font-style: italic; }
  /* DG-113 A Step 4 — §4 #4: SCA grouped remediations. */
  .section-groups { color: var(--vscode-foreground); }
  .finding-group { border: 1px solid var(--vscode-panel-border);
    border-left: 3px solid #8b5cf6; border-radius: 4px;
    padding: 0; margin: 0.25rem 0; font-size: 0.9em;
    background: var(--vscode-textBlockQuote-background, transparent); }
  .finding-group details { padding: 0.4rem 0.6rem; }
  .finding-group summary { cursor: pointer; display: flex; flex-wrap: wrap;
    align-items: center; gap: 0.4rem; outline: none; }
  .finding-group summary::-webkit-details-marker { display: none; }
  .finding-group summary::marker { display: none; content: ''; }
  .finding-group .group-family { font-weight: 700;
    font-family: var(--vscode-editor-font-family), monospace; }
  .finding-group .group-count { font-size: 0.85em;
    color: var(--vscode-descriptionForeground); }
  .finding-group .group-action { flex: 1 1 100%; font-size: 0.9em;
    margin-top: 0.2rem; }
  .finding-group .group-action code { font-family: var(--vscode-editor-font-family), monospace;
    background: var(--vscode-textCodeBlock-background, transparent); padding: 0 0.2rem; }
  .finding-group .group-note { font-size: 0.85em; margin-top: 0.35rem;
    padding: 0.3rem 0.4rem; background: rgba(232, 130, 26, 0.15);
    border-left: 2px solid #e8821a; }
  .finding-group .group-children { list-style: none; padding: 0;
    margin: 0.4rem 0 0; font-size: 0.85em; }
  .finding-group .group-children li { display: flex; align-items: center;
    gap: 0.4rem; padding: 0.15rem 0; }
  .finding-group .group-child-sev { width: 6px; height: 6px;
    border-radius: 50%; flex-shrink: 0; }
  .finding-group .group-child-sev.sev-critical { background: #d11; }
  .finding-group .group-child-sev.sev-high { background: #e8821a; }
  .finding-group .group-child-sev.sev-medium { background: #d6b400; }
  .finding-group .group-child-sev.sev-low { background: #3a8bd6; }
  .finding-group .group-child-sev.sev-info { background: #888; }
  .finding-group .group-child-title { flex: 1; }
  .finding-group .group-child-loc {
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family), monospace;
    font-size: 0.9em; }
  /* DG-115 A Step 5 — override directive (transitive nested-pinned). */
  .override-directive { margin-top: 0.5rem; padding: 0.5rem 0.6rem;
    border-radius: 4px; font-size: 0.95em; }
  .override-directive.strong {
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    border-left: 4px solid var(--vscode-editorError-foreground);
    background: var(--vscode-inputValidation-errorBackground, transparent); }
  .override-directive.soft {
    border: 1px solid var(--vscode-inputValidation-warningBorder);
    border-left: 4px solid var(--vscode-editorWarning-foreground);
    background: var(--vscode-inputValidation-warningBackground, transparent); }
  .override-header { font-weight: 700; margin-bottom: 0.35rem; }
  .override-directive.strong .override-header {
    color: var(--vscode-editorError-foreground); }
  .override-directive.soft .override-header {
    color: var(--vscode-editorWarning-foreground); }
  .override-snippet-row { display: flex; align-items: stretch;
    gap: 0.35rem; margin: 0.35rem 0; }
  .override-snippet { flex: 1; margin: 0; padding: 0.4rem 0.5rem;
    background: var(--vscode-textCodeBlock-background, transparent);
    border-radius: 3px; white-space: pre;
    font-family: var(--vscode-editor-font-family), monospace;
    font-size: 0.9em; tabindex: 0; }
  .override-copy-btn { padding: 0 0.6rem;
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, inherit);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 3px; cursor: pointer; font-size: 0.85em; }
  .override-copy-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, transparent); }
  .override-plain-bump { font-size: 0.85em; margin-top: 0.25rem;
    color: var(--vscode-descriptionForeground); }
  .override-caveat { font-size: 0.85em; margin-top: 0.35rem; }
  .override-pinner-risk { font-size: 0.85em; margin-top: 0.35rem;
    color: var(--vscode-descriptionForeground); }
  .override-pinner-risk code { font-family: var(--vscode-editor-font-family), monospace;
    background: var(--vscode-textCodeBlock-background, transparent); padding: 0 0.2rem; }
  /* DG-115.1 A G7 refinamiento: SOFT directive colapsado por default.
     Suaviza el bloque para el caso comun (8 soft vs 1 strong prismjs)
     manteniendo el override completo accesible al expandir. */
  .override-collapsed { margin-top: 0.5rem; }
  .override-collapsed summary { cursor: pointer; outline: none;
    padding: 0.35rem 0.5rem; border-radius: 3px;
    border: 1px solid var(--vscode-inputValidation-warningBorder);
    border-left: 3px solid var(--vscode-editorWarning-foreground);
    background: var(--vscode-inputValidation-warningBackground, transparent);
    font-size: 0.9em;
    color: var(--vscode-editorWarning-foreground); }
  .override-collapsed summary:hover {
    background: var(--vscode-list-hoverBackground, transparent); }
  .override-collapsed summary code {
    font-family: var(--vscode-editor-font-family), monospace;
    background: var(--vscode-textCodeBlock-background, transparent);
    padding: 0 0.2rem; color: var(--vscode-foreground); }
  .override-collapsed .override-collapsed-mgr {
    color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .override-collapsed[open] > summary { margin-bottom: 0.35rem; }
  .override-collapsed .override-directive-body { padding: 0.4rem 0.5rem;
    border: 1px solid var(--vscode-panel-border);
    border-left: 3px solid var(--vscode-editorWarning-foreground);
    border-radius: 3px;
    background: var(--vscode-textBlockQuote-background, transparent); }
  /* DG-130 A Sub-A2 (Cycle 116 FASE III): verdict-change banner + Previously. */
  .verdict-changed-banner { margin-top: 0.4rem; padding: 0.35rem 0.5rem;
    border-radius: 3px; font-size: 0.85em;
    border: 1px solid var(--vscode-inputValidation-warningBorder, #c87f0a);
    border-left: 3px solid var(--vscode-editorWarning-foreground, #c87f0a);
    background: var(--vscode-inputValidation-warningBackground, rgba(200, 127, 10, 0.12));
    color: var(--vscode-foreground); }
  .verdict-changed-banner .banner-title { font-weight: 700; }
  .verdict-changed-banner .banner-reason {
    color: var(--vscode-descriptionForeground);
    font-style: italic; font-size: 0.95em; margin-top: 0.15rem; }
  .previously { margin-top: 0.4rem; font-size: 0.85em; }
  .previously summary { cursor: pointer; outline: none;
    color: var(--vscode-descriptionForeground); font-weight: 600;
    padding: 0.2rem 0; }
  .previously summary::-webkit-details-marker { display: none; }
  .previously summary::marker { display: none; content: ''; }
  .previously summary::before { content: '▶ '; font-size: 0.7em; }
  .previously[open] summary::before { content: '▼ '; }
  .previously .prev-list { list-style: none; padding: 0;
    margin: 0.25rem 0 0 0.8rem; }
  .previously .prev-list li { padding: 0.2rem 0;
    border-top: 1px dotted var(--vscode-panel-border); }
  .previously .prev-list li:first-child { border-top: none; }
  .previously .prev-timestamp { font-family: var(--vscode-editor-font-family), monospace;
    font-size: 0.9em; color: var(--vscode-descriptionForeground); }
  .previously .prev-classification { font-weight: 600; margin: 0 0.35rem; }
  .previously .prev-provider { font-family: var(--vscode-editor-font-family), monospace;
    font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  .previously .prev-rationale { display: block; margin-top: 0.15rem;
    color: var(--vscode-descriptionForeground); font-size: 0.95em; }
  .summary .scan-diff { margin-top: 0.35rem; font-size: 0.9em;
    color: var(--vscode-descriptionForeground); }
  .summary .scan-diff .diff-reclassified {
    color: var(--vscode-editorWarning-foreground, #c87f0a); font-weight: 600; }
  /* DG-131 A Sub-A2 (Cycle 117 FASE III): grouped badge para findings del R20 grupo. */
  .grouped-badge { display: inline-block; font-size: 0.65em; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.3px;
    border-radius: 3px; padding: 0.05rem 0.35rem;
    margin-left: 0.4rem;
    background: #6b46c1; color: #fff;
    border: 1px solid transparent; }
  .grouped-badge.grouped-representative { background: #8b5cf6; }
  .grouped-badge.grouped-member { background: #6b46c1; opacity: 0.85; }
  .grouped-hint { font-size: 0.8em; color: var(--vscode-descriptionForeground);
    margin-top: 0.2rem; font-style: italic; }
`;

/** Formatea la confidence (0..1) como porcentaje entero ("95%"). */
function formatConfidence(confidence: number): string {
  return `${String(Math.round(confidence * 100))}%`;
}

/**
 * Texto del state badge del card. **DG-118 A (Cycle 109)**: ya NO incluye
 * el confidence% — fue empiricamente leido como "prioridad" por usuarios
 * novatos (user-handoff post-DG-115.1). La confianza del LLM se muestra
 * ahora en una linea secundaria del brain section con label explicit
 * "LLM confidence: N%"; la prioridad real va en el priority-badge
 * separado (DG-118 A `priorityScore`).
 */
function stateBadgeText(state: TriageState): string {
  return STATE_BADGE_LABEL[state];
}

/** Renderiza la tarjeta clickeable de un hallazgo. */
function renderCard(finding: ExtensionFinding): string {
  const severity = finding.severity;
  const state = triageStateOf(finding);
  const loc = `${finding.location.path}:${String(finding.location.startLine)}`;
  // DG-118 A (Cycle 109): priority badge — emitido cuando el tomo trae
  // priorityScore (siempre poblado por el reporter post-DG-118 A). Fallback
  // graceful: tomos pre-DG-118 A NO traen priorityScore → la card renderea
  // como antes (solo severity badge, sin priority).
  const priority = finding.priorityScore;
  const priorityBadge =
    priority !== undefined
      ? `<span class="priority-badge priority-${escapeHtml(priority)}" ` +
        `title="Priority: ${escapeHtml(priority)} (severity ${escapeHtml(severity)} + ${escapeHtml(state)} triage state)">` +
        `${escapeHtml(priority)}</span>`
      : '';
  const parts = [
    `<div class="finding sev-${escapeHtml(severity)} state-${state}" ` +
      `data-path="${escapeHtml(finding.location.path)}" ` +
      `data-line="${String(finding.location.startLine)}" ` +
      `data-state="${state}" ` +
      `tabindex="0" role="button">`,
    `<div class="head"><span class="badge badge-${escapeHtml(severity)}">` +
      `${escapeHtml(severity)}</span>` +
      priorityBadge +
      renderGroupedBadge(finding) +
      `<span class="title">${escapeHtml(finding.title)}</span>` +
      `<span class="state-badge">${escapeHtml(stateBadgeText(state))}</span></div>`,
    `<div class="loc">${escapeHtml(loc)} · ${escapeHtml(finding.category)}</div>`,
    `<div class="msg">${escapeHtml(finding.message)}</div>`,
  ];
  if (finding.triage !== undefined) {
    // DG-130 A Sub-A2 (Cycle 116 FASE III): banner "Verdict changed since
    // last scan" cuando el classification actual difiere del previo en
    // verdict_history. Empíricamente motivado por Baseline-13 donde el
    // usuario vio FP 0.95 → INC 0.70 sin explicación.
    const banner = renderVerdictChangedBanner(finding);
    if (banner !== '') parts.push(banner);
    // DG-118 A: el LLM confidence% se muestra como linea secundaria con
    // label explicit "LLM confidence: N%" — clarifica que es CONFIANZA
    // del LLM en su veredicto, NO prioridad.
    const confidenceHtml = `<span class="llm-confidence">LLM confidence: ${escapeHtml(formatConfidence(finding.triage.confidence))}</span>`;
    parts.push(
      `<div class="brain"><strong>Triage:</strong> ` +
        `${escapeHtml(triageLabel(finding.triage.classification))} — ` +
        `${escapeHtml(finding.triage.rationale)}${confidenceHtml}</div>`,
    );
  }
  // DG-130 A Sub-A2: section colapsable "Previously (N prior verdicts)".
  const previously = renderPreviouslySection(finding);
  if (previously !== '') parts.push(previously);
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
 * DG-131 A Sub-A2 (Cycle 117 FASE III R20): badge visual "[grouped]" para
 * findings que pertenecen a un grupo triage-agregado.
 *
 * Distingue representative (fuentes primaria del LLM call) vs member
 * (verdict propagado con confidence downgrade). Emit '' si no hay group.
 */
function renderGroupedBadge(finding: ExtensionFinding): string {
  if (finding.groupId === undefined) return '';
  const isRep = finding.isGroupRepresentative === true;
  const cls = isRep ? 'grouped-representative' : 'grouped-member';
  const label = isRep ? 'GROUPED REP' : 'GROUPED';
  const title = isRep
    ? 'Group representative — made the LLM call; verdict propagated to members.'
    : 'Group member — verdict propagated from representative, confidence downgraded.';
  return (
    `<span class="grouped-badge ${cls}" title="${escapeHtml(title)}">` +
    `${escapeHtml(label)}</span>`
  );
}

/**
 * DG-130 A Sub-A2 (Cycle 116 FASE III): banner "Verdict changed since last
 * scan" con delta rationale heurístico.
 *
 * Comportamiento:
 *  - Emite '' si el finding no tiene `previouslyVerdicts` o el array es < 2
 *    (primera vez triaged, no hay veredicto previo para comparar).
 *  - Compara `previouslyVerdicts[0]` (current, mismo que `triage`) vs
 *    `previouslyVerdicts[1]` (previous). Si son idénticos, emite ''.
 *  - Si difieren en classification O confidence delta > 0.15, emite banner
 *    con reason heurístico:
 *      * Provider changed → "Different provider"
 *      * Class change → "Verdict reclassified"
 *      * Confidence delta significativo → "Confidence changed significantly"
 *      * Fallback → "Re-analysis produced a different result"
 */
function renderVerdictChangedBanner(finding: ExtensionFinding): string {
  const history = finding.previouslyVerdicts;
  if (history === undefined || history.length < 2) return '';
  const current = history[0];
  const previous = history[1];
  if (current === undefined || previous === undefined) return '';
  const classChanged = current.classification !== previous.classification;
  const confidenceDelta = Math.abs(current.confidence - previous.confidence);
  const confidenceChanged = confidenceDelta >= 0.15;
  if (!classChanged && !confidenceChanged) return '';
  // Reason heurístico — precedencia: provider > class > confidence.
  let reason: string;
  if (current.providerLabel !== previous.providerLabel) {
    reason =
      `Different provider (${previous.providerLabel} → ${current.providerLabel}) — ` +
      `cross-provider agreement is not guaranteed.`;
  } else if (classChanged) {
    reason =
      `Verdict reclassified — likely new context signals available ` +
      `(e.g., trust boundary, cross-file taint patterns).`;
  } else {
    reason = `Confidence changed significantly (Δ ${confidenceDelta.toFixed(2)}).`;
  }
  const prevPct = formatConfidence(previous.confidence);
  const currPct = formatConfidence(current.confidence);
  const prevLabel = escapeHtml(triageLabel(previous.classification));
  const currLabel = escapeHtml(triageLabel(current.classification));
  return (
    `<div class="verdict-changed-banner">` +
    `<div class="banner-title">⚠ Verdict changed since last scan: ` +
    `${prevLabel} ${escapeHtml(prevPct)} → ${currLabel} ${escapeHtml(currPct)}</div>` +
    `<div class="banner-reason">${escapeHtml(reason)}</div>` +
    `</div>`
  );
}

/**
 * DG-130 A Sub-A2: section colapsable "Previously (N prior verdicts)".
 *
 * Muestra hasta 4 veredictos previos (index 1..4 del array — index 0 es
 * el actual, ya renderizado en la triage line). Emite '' si no hay history
 * o si solo hay 1 elemento (el actual).
 */
function renderPreviouslySection(finding: ExtensionFinding): string {
  const history = finding.previouslyVerdicts;
  if (history === undefined || history.length < 2) return '';
  const previous = history.slice(1); // Skip index 0 (current).
  const items = previous.map((v) => {
    const label = escapeHtml(triageLabel(v.classification));
    const pct = escapeHtml(formatConfidence(v.confidence));
    const provider = escapeHtml(v.providerLabel);
    const ts = escapeHtml(formatVerdictTimestamp(v.createdAt));
    const rationale = escapeHtml(v.rationale);
    return (
      `<li>` +
      `<span class="prev-timestamp">${ts}</span>` +
      `<span class="prev-classification">${label} ${pct}</span>` +
      `<span class="prev-provider">${provider}</span>` +
      `<span class="prev-rationale">${rationale}</span>` +
      `</li>`
    );
  });
  return (
    `<details class="previously">` +
    `<summary>Previously (${String(previous.length)} prior verdict${previous.length === 1 ? '' : 's'})</summary>` +
    `<ul class="prev-list">${items.join('')}</ul>` +
    `</details>`
  );
}

/**
 * Formatea un ISO 8601 timestamp a "YYYY-MM-DD HH:MM" (UTC).
 * Defensivo: si el input no parsea, devuelve el string crudo.
 */
function formatVerdictTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${String(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
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

/**
 * Renderiza la cost card del Brain Layer (DG-099 A).
 *
 * Muestra una tabla compacta por `{provider/model, agente}` con calls + in
 * tokens + out tokens + cost USD + avg latency, y el total al final. Si
 * `rows` esta vacio (no hubo triage todavia o el JSON no parseo), emite
 * un mensaje minimo invitando a correr Triage Findings.
 *
 * El caveat "~estimated" del CLI cost-history se preserva: los tokens
 * son del provider (cuando expone `usage`) o `chars/4` proxy fallback
 * (DG-085 A). La cost card no distingue por ahora; si hay drift entre
 * runs el usuario lo nota en el cost-history del CLI.
 */
export function renderCostCard(summary: CostSummary): string {
  if (summary.rows.length === 0) {
    return (
      `<div class="cost-card">` +
      `<span class="cost-title">Brain Layer cost</span>` +
      `<span class="cost-caveat">— run Triage Findings to start tracking cost</span>` +
      `</div>`
    );
  }
  const sessions = summary.limit === 1 ? 'last session' : `last ${String(summary.limit)} sessions`;
  // DG-107 A: timestamp opcional para que el usuario sepa que la cost
  // summary es de hace X tiempo y no del triage que acaba de correr
  // (caso: cambio de provider con todos ya triaged → 0 LLM calls).
  const asOfHtml =
    summary.latestSessionAt !== undefined
      ? `<span class="cost-asof">as of ${escapeHtml(formatLastSessionAt(summary.latestSessionAt))}</span>`
      : '';
  const rowsHtml = summary.rows
    .map((row) => {
      const avgLatency = Math.round(row.avgLatencyMs);
      return (
        `<tr>` +
        `<td>${escapeHtml(row.providerLabel)}</td>` +
        `<td>${escapeHtml(row.agentId)}</td>` +
        `<td class="num">${String(row.calls)}</td>` +
        `<td class="num">${String(row.inputTokens)} in</td>` +
        `<td class="num">${String(row.outputTokens)} out</td>` +
        `<td class="num">$${row.estimatedCostUsd.toFixed(4)}</td>` +
        `<td class="num">${String(avgLatency)}ms</td>` +
        `</tr>`
      );
    })
    .join('');
  return (
    `<div class="cost-card">` +
    `<span class="cost-title">Brain Layer cost · ${escapeHtml(sessions)}</span>` +
    `<span class="cost-caveat">~estimated USD</span>` +
    asOfHtml +
    `<table>` +
    `<thead><tr>` +
    `<th>provider/model</th><th>agent</th>` +
    `<th class="num">calls</th><th class="num">input</th>` +
    `<th class="num">output</th><th class="num">cost</th>` +
    `<th class="num">avg lat</th>` +
    `</tr></thead>` +
    `<tbody>${rowsHtml}</tbody>` +
    `</table>` +
    `<div class="cost-total">` +
    `Total: ${String(summary.totals.calls)} calls · ` +
    `${String(summary.totals.inputTokens)} in · ` +
    `${String(summary.totals.outputTokens)} out · ` +
    `$${summary.totals.estimatedCostUsd.toFixed(4)}` +
    `</div>` +
    `</div>`
  );
}

/**
 * Renderiza la summary card del header con el breakdown por triage state.
 *
 * DG-101 A: si hay findings untriaged (bucket NEW > 0), agrega un boton
 * "Triage X untriaged" que dispara el comando interno
 * `synaptic-sentinel.triageRemaining` via postMessage. Resuelve el silent
 * UX trap del cap=25 — ahora el usuario ve explicitamente cuantos quedaron
 * sin triar y puede dispararlos con un click sin tener que conocer el
 * setting o el flag CLI.
 */
function renderSummary(
  buckets: Readonly<Record<TriageState, readonly ExtensionFinding[]>>,
  scanDiff?: ExtensionScanDiff,
): string {
  const total = STATE_ORDER.reduce((acc, s) => acc + buckets[s].length, 0);
  const untriagedCount = buckets.untriaged.length;
  const triagedCount = total - untriagedCount;
  const segments: string[] = [];
  for (const state of STATE_ORDER) {
    const count = buckets[state].length;
    if (count === 0) continue;
    segments.push(
      `<span class="pill-${state}">${String(count)} ${STATE_BADGE_LABEL[state]}</span>`,
    );
  }
  const triageRemainingBtn =
    untriagedCount > 0
      ? `<button class="triage-remaining-btn" data-action="triage-remaining" ` +
        `title="Run Brain Layer on the ${String(untriagedCount)} untriaged finding(s)">` +
        `Triage ${String(untriagedCount)} untriaged` +
        `</button>`
      : '';
  // DG-107 A: boton Re-triage all aparece cuando hay findings ya triagados.
  // Sirve al caso de "cambie de provider en .sentinel/agents.yaml y quiero
  // re-evaluar las mismas findings con el nuevo provider". El comando
  // interno reTriageAll muestra un confirm dialog destructivo antes de
  // borrar los verdicts existentes.
  const reTriageBtn =
    triagedCount > 0
      ? `<button class="re-triage-btn" data-action="re-triage-all" ` +
        `title="Clear ${String(triagedCount)} existing verdict(s) and re-evaluate with the ` +
        `current Brain Layer provider (e.g. after changing .sentinel/agents.yaml)">` +
        `Re-triage all` +
        `</button>`
      : '';
  // DG-130 A Sub-A2 (Cycle 116 FASE III): diff-aware line en la summary
  // card. Solo se emite si el tomo trae scanDiff y hay AL MENOS un finding
  // en algún bucket del diff (evita ruido en el primer scan-ever).
  const scanDiffHtml = renderScanDiffLine(scanDiff);
  return (
    `<div class="summary">` +
    `<span class="total">${String(total)} finding${total === 1 ? '' : 's'}</span>` +
    (segments.length > 0
      ? `<span class="sep">·</span>${segments.join('<span class="sep">·</span>')}`
      : '') +
    triageRemainingBtn +
    reTriageBtn +
    scanDiffHtml +
    `<div class="loc">click a card to open the file</div>` +
    `</div>`
  );
}

/**
 * DG-130 A Sub-A2: linea "Scan diff vs previous triage" en la summary card.
 * Emite '' si `scanDiff` es undefined o si no hay actividad (0/0/0).
 * Cuando hay reclassifications, se muestran con destaque visual naranja.
 */
function renderScanDiffLine(scanDiff: ExtensionScanDiff | undefined): string {
  if (scanDiff === undefined) return '';
  const { newFindingsCount, reclassifiedCount, unchangedCount } = scanDiff;
  if (newFindingsCount === 0 && reclassifiedCount === 0 && unchangedCount === 0) return '';
  const reclassPart =
    reclassifiedCount > 0
      ? `<span class="diff-reclassified">${String(reclassifiedCount)} re-classified</span>`
      : `${String(reclassifiedCount)} re-classified`;
  return (
    `<div class="scan-diff">Scan diff vs previous triage: ` +
    `${String(newFindingsCount)} new · ${reclassPart} · ` +
    `${String(unchangedCount)} unchanged` +
    `</div>`
  );
}

/**
 * Formatea un ISO 8601 timestamp como "YYYY-MM-DD HH:MM" (UTC truncado)
 * para mostrarlo legible en la cost card (DG-107 A). Pure: NO usa
 * timezone local ni `Date.now()`, asi que el renderer queda testeable.
 * Si el input no es un ISO valido devuelve el string raw como fallback.
 */
export function formatLastSessionAt(iso: string): string {
  // ISO 8601 es estrictamente parseable con regex — evitamos new Date()
  // para no pasar por timezone conversion.
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (m === null) return iso;
  return `${m[1] ?? ''} ${m[2] ?? ''}`;
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
/**
 * Renderiza una card de FindingGroup (DG-113 A Step 4 — §4 #4) para el
 * sidebar. Forma minima: family name (e.g. `protobufjs`) + count de
 * findings hijos + remediation target (display) + nota de heterogeneidad
 * cuando aplica + lista colapsada por default (`<details>`).
 *
 * Decision (G7 del plan): card expandible con collapse por default.
 * Implementacion: `<details>` nativo HTML — sin JS adicional, accessible
 * por keyboard, respeta scrolling.
 */
/**
 * Renderiza el bloque del override directive (DG-115 A Step 5 — §4 #15
 * 'prismjs misleading remediation' + DG-115.1 A refinamiento G7
 * 'reduce noise of 8 soft blocks').
 *
 * Variantes:
 * - `STRONG` (`hasSiblingFixedCopy:true`, rojo) — caso prismjs: una copia
 *   fixeada ya existe top-level; un bump top-level NO resuelve la nested
 *   pineada. Render: bloque prominente expandido, header "Top-level
 *   bump alone will NOT fix this", caveat fuerte, snippet + Copy + risk.
 * - `SOFT` (`hasSiblingFixedCopy:false`, soft warning) — caso protobufjs/
 *   node-forge/fast-uri/etc: el plain bump del package puede ser
 *   suficiente. Render: `<details>` colapsado por default con summary
 *   one-liner ("Transitive (via X@v) — plain bump usually works;
 *   override if it persists"); el override completo (caveat + plain bump
 *   line + snippet + Copy + risk caveat) queda DENTRO del `<details>`,
 *   accesible al expandir. Reduce el ruido visual: el plain-bump
 *   (display) y la heteroNote del FindingGroupCard quedan como accion
 *   primaria visible; el override no compite por atencion en los 8
 *   casos SOFT donde el bump suele bastar.
 *
 * Data del tomo NO cambia (`overrideDirective` se sigue computando para
 * ambos) — solo cambia el render webview.
 *
 * UX (heredada de DG-115 A Q1-Q4 user-approved):
 * - CSS vars semanticas (no hex) → accesibilidad + theme-coherence.
 * - Header STRONG mixed case (NO full-caps).
 * - "Plain bump:" linea subordinada en SOFT; OMITIDA en STRONG.
 * - Copy button: try `clipboard.writeText` con fallback a
 *   `getSelection().selectAllChildren` (handler tomo-wide).
 * - Risk caveat: cita pinner(s) + version conservadora exacta como alt.
 */
export function renderOverrideDirective(
  directive: {
    readonly manager: 'npm' | 'yarn' | 'pnpm';
    readonly packageName: string;
    readonly versionRange: string;
    readonly snippet: string;
    readonly hasSiblingFixedCopy: boolean;
    readonly pinnedBy: readonly string[];
  },
  fixExact: string | undefined,
): string {
  // Cuerpo del directive (caveat + plain bump + snippet + Copy + risk).
  // Compartido entre STRONG (renderizado directo) y SOFT (envuelto en
  // <details>). No incluye el header "Top-level bump alone..." porque
  // STRONG lo agrega arriba y SOFT lo reemplaza con el summary one-liner.
  const renderBody = (): string => {
    const caveat = directive.hasSiblingFixedCopy
      ? `A fixed copy of <code>${escapeHtml(directive.packageName)}</code> already exists top-level, ` +
        `but a transitive dependency is pinning a vulnerable nested copy. ` +
        `You MUST apply the override below.`
      : `A plain update of <code>${escapeHtml(directive.packageName)}</code> may suffice. ` +
        `If the nested copy persists after the bump, apply the override below.`;
    const plainBump =
      !directive.hasSiblingFixedCopy && fixExact !== undefined
        ? `<div class="override-plain-bump">Plain bump: <code>${escapeHtml(directive.packageName)}@${escapeHtml(fixExact)}</code> (try first).</div>`
        : '';
    const pinnerStr = directive.pinnedBy.length > 0 ? directive.pinnedBy.join(', ') : 'a parent';
    const pinnerRisk =
      fixExact !== undefined
        ? `<div class="override-pinner-risk">This overrides the version pinned by ` +
          `<code>${escapeHtml(pinnerStr)}</code>; verify <code>${escapeHtml(pinnerStr)}</code> ` +
          `still works after applying — test. Conservative alternative: use exact ` +
          `<code>${escapeHtml(directive.packageName)}@${escapeHtml(fixExact)}</code>.</div>`
        : `<div class="override-pinner-risk">This overrides the version pinned by ` +
          `<code>${escapeHtml(pinnerStr)}</code>; verify <code>${escapeHtml(pinnerStr)}</code> ` +
          `still works after applying — test.</div>`;
    return (
      `<div class="override-caveat">${caveat}</div>` +
      plainBump +
      `<div class="override-snippet-row">` +
      `<pre class="override-snippet" tabindex="0">${escapeHtml(directive.snippet)}</pre>` +
      `<button type="button" class="override-copy-btn" data-action="copy-override" ` +
      `data-snippet="${escapeHtml(directive.snippet)}">Copy</button>` +
      `</div>` +
      pinnerRisk
    );
  };

  if (directive.hasSiblingFixedCopy) {
    // STRONG: bloque prominente expandido (caso prismjs).
    return (
      `<div class="override-directive strong" data-directive="override">` +
      `<div class="override-header">${escapeHtml(`Top-level bump alone will NOT fix this`)} (${escapeHtml(directive.manager)})</div>` +
      renderBody() +
      `</div>`
    );
  }

  // SOFT: <details> colapsado por default. Summary one-liner cita el
  // primer pinner real (pinnedBy[0]); si hay multiples, indica "+ N
  // more". Si no hay pinner (degenerado), summary cae al wording sin via.
  const firstPinner = directive.pinnedBy[0];
  const extraPinners = directive.pinnedBy.length - 1;
  const viaPhrase =
    firstPinner === undefined
      ? 'Transitive'
      : extraPinners > 0
        ? `Transitive (via <code>${escapeHtml(firstPinner)}</code> + ${String(extraPinners)} more)`
        : `Transitive (via <code>${escapeHtml(firstPinner)}</code>)`;
  const summaryHtml =
    `${viaPhrase} — plain bump usually works; override if it persists ` +
    `<span class="override-collapsed-mgr">(${escapeHtml(directive.manager)})</span>`;
  return (
    `<details class="override-collapsed soft" data-directive="override">` +
    `<summary>${summaryHtml}</summary>` +
    `<div class="override-directive-body">${renderBody()}</div>` +
    `</details>`
  );
}

export function renderFindingGroupCard(group: {
  readonly familyKey: string;
  readonly findings: readonly {
    readonly fingerprint: string;
    readonly title: string;
    readonly severity: string;
    readonly location: { readonly path: string; readonly startLine: number };
  }[];
  readonly remediation: {
    readonly recommendedFixes: Readonly<Record<string, string>>;
    readonly display: string;
    readonly heterogeneous: boolean;
    readonly noFixAvailable: boolean;
    readonly overrideDirective?:
      | {
          readonly manager: 'npm' | 'yarn' | 'pnpm';
          readonly packageName: string;
          readonly versionRange: string;
          readonly snippet: string;
          readonly hasSiblingFixedCopy: boolean;
          readonly pinnedBy: readonly string[];
        }
      | undefined;
  };
}): string {
  const count = group.findings.length;
  const action = group.remediation.noFixAvailable
    ? 'No fix available'
    : `Upgrade <code>${escapeHtml(group.familyKey)}</code> to ${escapeHtml(group.remediation.display)}`;
  const heteroNote = group.remediation.heterogeneous
    ? `<div class="group-note">Fix set is heterogeneous across major tracks — bumping to a single version may leave other CVEs open. Apply the per-track maxes shown above.</div>`
    : '';
  // DG-115 A: override directive (transitive nested-pinned). Renderea
  // DENTRO del <details> pero ANTES de la lista de children — visualmente
  // dominante sobre el rationale del LLM (que aparece en cada child card).
  let overrideHtml = '';
  if (group.remediation.overrideDirective !== undefined) {
    // fixExact: del recommendedFix de la track del majorRange. Si solo hay
    // 1 track, usa esa; si hay varias, intenta matchear con la track del
    // versionRange (^X.Y.Z → major X).
    const fixExact = pickExactFix(
      group.remediation.recommendedFixes,
      group.remediation.overrideDirective.versionRange,
    );
    overrideHtml = renderOverrideDirective(group.remediation.overrideDirective, fixExact);
  }
  const childItems = group.findings
    .map(
      (f) =>
        `<li>` +
        `<span class="group-child-sev sev-${escapeHtml(f.severity)}"></span>` +
        `<span class="group-child-title">${escapeHtml(f.title)}</span>` +
        `<span class="group-child-loc">${escapeHtml(f.location.path)}:${String(f.location.startLine)}</span>` +
        `</li>`,
    )
    .join('');
  return (
    `<div class="finding-group">` +
    `<details>` +
    `<summary>` +
    `<span class="group-family">${escapeHtml(group.familyKey)}</span>` +
    `<span class="group-count">${String(count)} finding${count === 1 ? '' : 's'}</span>` +
    `<span class="group-action">${action}</span>` +
    `</summary>` +
    overrideHtml +
    heteroNote +
    `<ul class="group-children">${childItems}</ul>` +
    `</details>` +
    `</div>`
  );
}

/**
 * Extrae la version exacta del fix para una `versionRange` (`^X.Y.Z`).
 * Match por major track; si no hay match exacto, devuelve el primer fix
 * disponible.
 */
function pickExactFix(
  recommendedFixes: Readonly<Record<string, string>>,
  versionRange: string,
): string | undefined {
  const match = /\^?(\d+)\./.exec(versionRange);
  const major = match?.[1];
  if (major !== undefined) {
    const fix = recommendedFixes[major];
    if (fix !== undefined) return fix;
  }
  return Object.values(recommendedFixes)[0];
}

export function renderTomoWebviewHtml(
  findings: readonly ExtensionFinding[],
  options: WebviewHtmlOptions,
  costSummary?: CostSummary | null,
  groups?: readonly {
    readonly familyKey: string;
    readonly findings: readonly {
      readonly fingerprint: string;
      readonly title: string;
      readonly severity: string;
      readonly location: { readonly path: string; readonly startLine: number };
    }[];
    readonly remediation: {
      readonly recommendedFixes: Readonly<Record<string, string>>;
      readonly display: string;
      readonly heterogeneous: boolean;
      readonly noFixAvailable: boolean;
      readonly overrideDirective?:
        | {
            readonly manager: 'npm' | 'yarn' | 'pnpm';
            readonly packageName: string;
            readonly versionRange: string;
            readonly snippet: string;
            readonly hasSiblingFixedCopy: boolean;
            readonly pinnedBy: readonly string[];
          }
        | undefined;
    };
  }[],
  scanDiff?: ExtensionScanDiff,
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
    // DG-099 A: cost card opcional entre la summary card y las sections.
    // Solo se emite si el caller pasa un CostSummary parseado (puede ser
    // null si el CLI fallo o el JSON no validaba contra el schema).
    const costHtml =
      costSummary !== undefined && costSummary !== null ? renderCostCard(costSummary) : '';
    // DG-113 A Step 4: seccion de grupos SCA (cross-lockfile +
    // intra-package por exact package name). Solo se emite si hay al menos
    // 1 grupo. Posicion: despues de cost card, antes de las sections —
    // permite ver primero la accion remediativa agregada y despues los
    // findings individuales triaged.
    const groupsHtml =
      groups !== undefined && groups.length > 0
        ? `<h3 class="section section-groups">` +
          `<span class="heading-icon">◆</span>SCA grouped remediations` +
          `<span class="count">· ${String(groups.length)}</span>` +
          `</h3>` +
          groups.map(renderFindingGroupCard).join('')
        : '';
    body = renderSummary(buckets, scanDiff) + costHtml + groupsHtml + sections.join('');
  }

  // El script: al hacer click en una tarjeta, pide a la extension abrir el
  // archivo. `acquireVsCodeApi` lo expone el host del webview. DG-101 A:
  // ademas registra un handler para el boton "Triage Remaining" que
  // dispara el comando interno via postMessage type 'triage-remaining'.
  const script =
    `const api = acquireVsCodeApi();` +
    `for (const el of document.querySelectorAll('.finding')) {` +
    `el.addEventListener('click', () => {` +
    `api.postMessage({ type: 'reveal', path: el.dataset.path, ` +
    `line: Number(el.dataset.line) });` +
    `});}` +
    `const btn = document.querySelector('[data-action="triage-remaining"]');` +
    `if (btn) { btn.addEventListener('click', (e) => {` +
    `e.stopPropagation();` +
    `api.postMessage({ type: 'triage-remaining' });` +
    `});}` +
    `const rtBtn = document.querySelector('[data-action="re-triage-all"]');` +
    `if (rtBtn) { rtBtn.addEventListener('click', (e) => {` +
    `e.stopPropagation();` +
    `api.postMessage({ type: 're-triage-all' });` +
    `});}` +
    // DG-115 A Step 5: Copy override snippet. Try Clipboard API; fallback
    // a getSelection().selectAllChildren del <pre> sibling. Eat click para
    // no togglear el <details> parent.
    `for (const cBtn of document.querySelectorAll('[data-action="copy-override"]')) {` +
    `cBtn.addEventListener('click', (e) => {` +
    `e.stopPropagation(); e.preventDefault();` +
    `const snippet = cBtn.dataset.snippet || '';` +
    `const done = () => { const orig = cBtn.textContent; cBtn.textContent = 'Copied'; ` +
    `setTimeout(() => { cBtn.textContent = orig; }, 1500); };` +
    `if (navigator.clipboard && navigator.clipboard.writeText) {` +
    `navigator.clipboard.writeText(snippet).then(done).catch(() => {` +
    `const pre = cBtn.parentElement && cBtn.parentElement.querySelector('.override-snippet');` +
    `if (pre) { const sel = window.getSelection(); if (sel) { sel.removeAllRanges(); ` +
    `const r = document.createRange(); r.selectNodeContents(pre); sel.addRange(r); } done(); }` +
    `});` +
    `} else {` +
    `const pre = cBtn.parentElement && cBtn.parentElement.querySelector('.override-snippet');` +
    `if (pre) { const sel = window.getSelection(); if (sel) { sel.removeAllRanges(); ` +
    `const r = document.createRange(); r.selectNodeContents(pre); sel.addRange(r); } done(); }` +
    `}` +
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
