import { SEVERITY_RANK } from '@synaptic-sentinel/core';
import type { Tomo, TomoFinding } from './tomo.js';

/** Severidades en orden de gravedad descendente, para presentacion. */
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

/** Escapa los caracteres con significado en HTML (defensa anti-inyeccion). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Hoja de estilos embebida — el HTML es autocontenido, sin recursos externos. */
const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2rem; background: #f4f5f7; color: #1a1a2e;
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5; }
  main { max-width: 64rem; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
  h2 { font-size: 1.1rem; margin: 2rem 0 0.75rem; border-bottom: 1px solid #d8dade;
    padding-bottom: 0.25rem; }
  .meta { color: #5a5f6a; font-size: 0.85rem; }
  .meta code { background: #e8eaed; padding: 0.1rem 0.35rem; border-radius: 3px; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.5rem 0; }
  .chip { background: #e8eaed; border-radius: 999px; padding: 0.2rem 0.7rem;
    font-size: 0.8rem; }
  .badge { display: inline-block; border-radius: 4px; padding: 0.1rem 0.5rem;
    font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.03em; color: #fff; }
  .sev-critical { background: #7c1d1d; }
  .sev-high { background: #c0392b; }
  .sev-medium { background: #c87f0a; }
  .sev-low { background: #2c6fbb; }
  .sev-info { background: #6b7280; }
  .ok { background: #1f7a3d; }
  .degraded { background: #c87f0a; }
  .finding { background: #fff; border: 1px solid #e0e2e6; border-left-width: 4px;
    border-radius: 6px; padding: 0.85rem 1rem; margin: 0.6rem 0; }
  .finding-head { display: flex; align-items: center; gap: 0.6rem;
    flex-wrap: wrap; }
  .finding-title { font-weight: 600; }
  .finding-loc { font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.82rem; color: #5a5f6a; }
  .finding-msg { margin: 0.4rem 0 0; }
  .lifecycle { font-size: 0.72rem; color: #5a5f6a; }
  .triage { margin: 0.45rem 0 0; font-size: 0.82rem; color: #3a3f4a; }
  .triage-tp { background: #7c1d1d; }
  .triage-fp { background: #1f7a3d; }
  .triage-inc { background: #6b7280; }
  .context { margin: 0.45rem 0 0; font-size: 0.82rem; color: #3a3f4a;
    background: #eef0f3; border-radius: 4px; padding: 0.5rem 0.7rem; }
  .context ul { margin: 0.3rem 0 0; padding-left: 1.1rem; }
  .remediation { margin: 0.45rem 0 0; font-size: 0.82rem; color: #3a3f4a;
    background: #eaf3ec; border-radius: 4px; padding: 0.5rem 0.7rem; }
  .remediation p { margin: 0.3rem 0 0; }
  .remediation pre { margin: 0.4rem 0 0; padding: 0.55rem 0.7rem; background: #1a1a2e;
    color: #e8eaed; border-radius: 4px; overflow-x: auto; font-size: 0.78rem;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
  table { border-collapse: collapse; width: 100%; font-size: 0.88rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #e0e2e6; }
  th { color: #5a5f6a; font-weight: 600; }
  footer { margin-top: 2.5rem; color: #5a5f6a; font-size: 0.8rem;
    border-top: 1px solid #d8dade; padding-top: 0.75rem; word-break: break-all; }
`;

/** Clase CSS de la badge de severidad. */
function severityClass(severity: string): string {
  return `sev-${SEVERITY_ORDER.includes(severity as (typeof SEVERITY_ORDER)[number]) ? severity : 'info'}`;
}

/** Etiqueta legible de una clasificacion de triage. */
function triageLabel(classification: string): string {
  if (classification === 'true_positive') return 'true positive';
  if (classification === 'false_positive') return 'false positive';
  return 'inconclusive';
}

/** Clase CSS de la badge de triage. */
function triageClass(classification: string): string {
  if (classification === 'true_positive') return 'triage-tp';
  if (classification === 'false_positive') return 'triage-fp';
  return 'triage-inc';
}

/** Renderiza los conteos de un `Record<string, number>` como chips. */
function renderChips(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return '<p class="meta">No data.</p>';
  return `<div class="chips">${entries
    .map(([key, n]) => `<span class="chip">${escapeHtml(key)}: ${String(n)}</span>`)
    .join('')}</div>`;
}

/** Renderiza el veredicto de triage de un hallazgo, si fue triado. */
function renderTriage(finding: TomoFinding): string {
  const triage = finding.triage;
  if (triage === undefined) return '';
  return (
    `<p class="triage"><span class="badge ${triageClass(triage.classification)}">` +
    `Triage: ${escapeHtml(triageLabel(triage.classification))}</span> ` +
    `(confidence ${triage.confidence.toFixed(2)}) — ${escapeHtml(triage.rationale)}</p>`
  );
}

/** Renderiza la explicacion de contexto de un hallazgo, si fue explicado. */
function renderContext(finding: TomoFinding): string {
  const context = finding.context;
  if (context === undefined) return '';
  return `<div class="context">
      <strong>Context:</strong> ${escapeHtml(context.summary)}
      <ul>
        <li><strong>Entry point:</strong> ${escapeHtml(context.entryPoint)}</li>
        <li><strong>Sink:</strong> ${escapeHtml(context.sink)}</li>
        <li><strong>Exposure:</strong> ${escapeHtml(context.exposure)}</li>
      </ul>
    </div>`;
}

/** Renderiza la sugerencia de remediacion de un hallazgo, si fue remediado. */
function renderRemediation(finding: TomoFinding): string {
  const remediation = finding.remediation;
  if (remediation === undefined) return '';
  const snippet =
    remediation.fixedSnippet !== undefined
      ? `<pre>${escapeHtml(remediation.fixedSnippet)}</pre>`
      : '';
  return `<div class="remediation">
      <strong>Remediation:</strong> ${escapeHtml(remediation.summary)}
      <p>${escapeHtml(remediation.recommendation)}</p>
      ${snippet}
    </div>`;
}

/** Renderiza un hallazgo como una tarjeta. */
function renderFinding(finding: TomoFinding): string {
  const loc = `${finding.location.path}:${String(finding.location.startLine)}`;
  const lifecycle =
    finding.lifecycleState !== 'new'
      ? ` <span class="lifecycle">(${escapeHtml(finding.lifecycleState)})</span>`
      : '';
  const refs =
    finding.complianceRefs.length > 0
      ? `<div class="chips">${finding.complianceRefs
          .map((ref) => `<span class="chip">${escapeHtml(ref)}</span>`)
          .join('')}</div>`
      : '';
  return `<article class="finding ${severityClass(finding.severity)}">
      <div class="finding-head">
        <span class="badge ${severityClass(finding.severity)}">${escapeHtml(finding.severity)}</span>
        <span class="chip">${escapeHtml(finding.category)}</span>
        <span class="finding-title">${escapeHtml(finding.title)}</span>${lifecycle}
      </div>
      <div class="finding-loc">${escapeHtml(loc)} · ${escapeHtml(finding.scoutId)}</div>
      <p class="finding-msg">${escapeHtml(finding.message)}</p>
      ${renderTriage(finding)}
      ${renderContext(finding)}
      ${renderRemediation(finding)}
      ${refs}
    </article>`;
}

/** Renderiza la tabla de metodologia (scouts ejecutados). */
function renderMethodology(tomo: Tomo): string {
  const rows = tomo.methodology.scouts
    .map(
      (scout) =>
        `<tr><td>${escapeHtml(scout.scoutId)}</td><td>${escapeHtml(scout.status)}</td>` +
        `<td>${String(scout.findings)}</td><td>${escapeHtml(scout.error ?? '')}</td></tr>`,
    )
    .join('');
  return `<table>
      <thead><tr><th>Scout</th><th>Status</th><th>Findings</th><th>Error</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * Renderiza un tomo como un documento HTML autocontenido (v0.4 §4.3).
 *
 * MVP: legible y compartible (para mostrar a un stakeholder/CISO). El HTML
 * "elaborado" (navegacion, links, copy-paste de patches) es Pro. Todo el
 * contenido dinamico se escapa: el reporte de una herramienta de seguridad
 * no debe poder inyectar HTML a partir de los hallazgos.
 */
export function renderTomoHtml(tomo: Tomo): string {
  const { metadata, summary } = tomo;
  const sorted = [...tomo.findings].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
  const findingsHtml =
    sorted.length > 0 ? sorted.map(renderFinding).join('\n') : '<p class="meta">No findings. ✓</p>';
  // Conteos de triage con etiquetas legibles; se omite la seccion sin triage.
  const triageLabeled: Record<string, number> = {};
  for (const [key, count] of Object.entries(summary.byTriage)) {
    triageLabeled[triageLabel(key)] = count;
  }
  const triageSection =
    Object.keys(triageLabeled).length > 0
      ? `<p class="meta">By triage</p>\n${renderChips(triageLabeled)}`
      : '';
  const gitSha =
    metadata.gitSha !== undefined ? ` · commit <code>${escapeHtml(metadata.gitSha)}</code>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Synaptic Sentinel — Audit tome</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
<h1>Synaptic Sentinel — Audit tome</h1>
<p class="meta">Project <code>${escapeHtml(metadata.scope.rootPath)}</code> ·
published ${escapeHtml(metadata.publishedAt)} ·
Sentinel ${escapeHtml(metadata.sentinelVersion)}${gitSha}</p>
<p class="meta">scan <code>${escapeHtml(summary.scanId)}</code> ·
status <span class="badge ${summary.status === 'ok' ? 'ok' : 'degraded'}">${escapeHtml(summary.status)}</span></p>
</header>

<h2>Summary</h2>
<p><strong>${String(summary.totalFindings)}</strong> finding(s) ·
<strong>${String(summary.suppressedCount)}</strong> suppressed (duplicates or known false positives)</p>
<p class="meta">By severity</p>
${renderChips(summary.bySeverity)}
<p class="meta">By category</p>
${renderChips(summary.byCategory)}
${triageSection}

<h2>Methodology</h2>
<p class="meta">Scan started ${escapeHtml(tomo.methodology.startedAt)},
finished ${escapeHtml(tomo.methodology.finishedAt)}.</p>
${renderMethodology(tomo)}

<h2>Findings (${String(sorted.length)})</h2>
${findingsHtml}

<footer>
Integrity ${escapeHtml(tomo.integrity.algorithm)}:
<code>${escapeHtml(tomo.integrity.hash)}</code><br>
Generated by Synaptic Sentinel · tome <code>${escapeHtml(metadata.tomoId)}</code>
</footer>
</main>
</body>
</html>
`;
}
