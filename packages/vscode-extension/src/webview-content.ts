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

/** Severidades de mayor a menor gravedad, para agrupar y ordenar. */
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

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
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin: 0 0 0.75rem; }
  .empty { color: var(--vscode-descriptionForeground); }
  .finding { border: 1px solid var(--vscode-panel-border); border-left-width: 3px;
    border-radius: 4px; padding: 0.5rem 0.6rem; margin: 0.4rem 0; cursor: pointer; }
  .finding:hover { background: var(--vscode-list-hoverBackground); }
  .sev-critical { border-left-color: #d11; }
  .sev-high { border-left-color: #e8821a; }
  .sev-medium { border-left-color: #d6b400; }
  .sev-low { border-left-color: #3a8bd6; }
  .sev-info { border-left-color: #888; }
  .head { display: flex; align-items: center; gap: 0.4rem; }
  .badge { font-size: 0.68em; font-weight: 700; text-transform: uppercase;
    color: #fff; border-radius: 3px; padding: 0.05rem 0.35rem; }
  .badge-critical { background: #7c1d1d; }
  .badge-high { background: #c0392b; }
  .badge-medium { background: #c87f0a; }
  .badge-low { background: #2c6fbb; }
  .badge-info { background: #6b7280; }
  .title { font-weight: 600; }
  .loc { font-family: var(--vscode-editor-font-family), monospace; font-size: 0.8em;
    color: var(--vscode-descriptionForeground); margin-top: 0.15rem; }
  .msg { font-size: 0.9em; margin-top: 0.25rem; }
  .brain { font-size: 0.85em; margin-top: 0.3rem;
    color: var(--vscode-descriptionForeground); }
`;

/** Renderiza la tarjeta clickeable de un hallazgo. */
function renderCard(finding: ExtensionFinding): string {
  const severity = finding.severity;
  const loc = `${finding.location.path}:${String(finding.location.startLine)}`;
  const parts = [
    `<div class="finding sev-${escapeHtml(severity)}" ` +
      `data-path="${escapeHtml(finding.location.path)}" ` +
      `data-line="${String(finding.location.startLine)}" ` +
      `tabindex="0" role="button">`,
    `<div class="head"><span class="badge badge-${escapeHtml(severity)}">` +
      `${escapeHtml(severity)}</span>` +
      `<span class="title">${escapeHtml(finding.title)}</span></div>`,
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
      `<div class="brain"><strong>Contexto:</strong> ` +
        `${escapeHtml(finding.context.summary)}</div>`,
    );
  }
  if (finding.remediation !== undefined) {
    parts.push(
      `<div class="brain"><strong>Remediacion:</strong> ` +
        `${escapeHtml(finding.remediation.summary)}</div>`,
    );
  }
  parts.push('</div>');
  return parts.join('');
}

/**
 * Renderiza el documento HTML del webview "tomo vivo" (v0.4 §4.3): los
 * hallazgos del ultimo scan, agrupados por severidad y clickeables para
 * saltar al codigo. Funcion pura — el `WebviewViewProvider` la envuelve.
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
    body = '<p class="empty">Ejecuta "Scan Workspace" para ver los hallazgos aqui.</p>';
  } else {
    const cards: string[] = [];
    for (const severity of SEVERITY_ORDER) {
      for (const finding of findings.filter((f) => f.severity === severity)) {
        cards.push(renderCard(finding));
      }
    }
    body =
      `<p class="meta">${String(findings.length)} hallazgo(s) · ` +
      'click para abrir en el editor</p>' +
      cards.join('');
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
<html lang="es">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${STYLE}</style>
</head>
<body>
<h2>Synaptic Sentinel</h2>
${body}
<script nonce="${options.nonce}">${script}</script>
</body>
</html>`;
}
