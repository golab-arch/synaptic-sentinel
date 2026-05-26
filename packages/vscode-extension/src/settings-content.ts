import type { BrainAgentId, ProviderName } from '@synaptic-sentinel/core';
import { escapeHtml } from './webview-content.js';

/**
 * Renderer puro del HTML del panel "Configure Brain Layer Providers"
 * (Phase 11 DG-074 B).
 *
 * Sigue el patron de `webview-content.ts` (DG-039 B "tomo vivo"): el
 * renderer es una funcion pura, sin acceso a `vscode.SecretStorage` ni a
 * `fetch` — solo recibe `state` ya resuelto por la extension host. Todo
 * el round-trip de SecretStorage + ping a Ollama vive en
 * `settings-view.ts`; aqui solo se pinta.
 *
 * Defensa contra inyeccion: todo string del state pasa por `escapeHtml`
 * (mismo helper que el tomo vivo). El unico `<script>` lleva nonce CSP.
 */

/** State que la extension le pasa al renderer (forma minima necesaria). */
export interface SettingsViewState {
  /** Config activa per-agente — la que el CLI resolveria si corriese triage AHORA. */
  readonly active: Readonly<Record<BrainAgentId, ResolvedAgentConfig>>;
  /** Origen de la `active` config (yaml | injected fallback | error). */
  readonly source: 'agents.yaml' | 'fallback' | 'none';
  /** Path al `agents.yaml` (si existe) — para mostrarlo en la UI. */
  readonly agentsYamlPath: string | undefined;
  /** Si el `agents.yaml` actual tiene comentarios (warning antes de sobrescribir). */
  readonly agentsYamlHasComments: boolean;
  /** Estado de cada provider con auth (los 12 OpenAI-compat + Anthropic; Ollama queda aparte). */
  readonly credentials: Readonly<Record<string, CredentialStatus>>;
  /** Status de auto-discovery de Ollama. */
  readonly ollama: OllamaStatus;
  /**
   * `true` si el usuario clickeo "Don't remind me again" en el warning de
   * modelos Ollama pesados (DG-087 A). Persistido en `vscode.globalState`.
   * Cuando `true` el badge "heavy" y el panel-level warning se omiten.
   */
  readonly suppressHeavyModelWarning: boolean;
}

/** Config resuelta de un agente (lo que el panel muestra en "Active"). */
export interface ResolvedAgentConfig {
  readonly provider: ProviderName;
  readonly model: string;
}

/** Estado de una credencial — sin exponer NUNCA el valor real al webview. */
export interface CredentialStatus {
  /** `true` si hay una key configurada en SecretStorage para este provider. */
  readonly configured: boolean;
  /** Ultima vez que se hizo "Test" — `'pending'` cuando no se intento todavia. */
  readonly testStatus: 'pending' | 'ok' | 'error';
  /** Mensaje del ultimo "Test" (puede incluir el codigo de error del provider). */
  readonly testMessage?: string;
}

/** Info por modelo Ollama disponible (DG-087 A). */
export interface OllamaModelEntry {
  readonly name: string;
  /** Bytes ocupados — `0` si Ollama no lo reporto (neutraliza el warning). */
  readonly sizeBytes: number;
}

/** Status de Ollama. */
export interface OllamaStatus {
  /** `true` si `GET /api/tags` respondio 200 al pingear localhost:11434. */
  readonly available: boolean;
  /** Modelos pulled en Ollama (vacio si `available === false`). */
  readonly models: readonly string[];
  /**
   * Modelos con info de tamaño (DG-087 A). Opcional para retro-compat con
   * builds previos del provider; cuando esta presente, el renderer lo usa
   * para mostrar tamaño + badge "heavy" si supera el umbral. Si esta
   * ausente, el renderer cae al render legacy (solo `models: string[]`).
   */
  readonly modelsInfo?: readonly OllamaModelEntry[];
  /** Endpoint usado para el ping — visible en la UI para diagnosticar. */
  readonly endpoint: string;
}

/**
 * Umbral empirico-defensivo a partir del cual un modelo Ollama se considera
 * "heavy" y dispara el warning de RAM (DG-087 A). El PILOT de DG-077 vio
 * que Gemma 4 (9.6 GB) y gpt-oss:20b (13 GB) saturaron RAM tras 2 horas;
 * 5 GB deja modelos como qwen2.5-coder:7b (~4.4 GB), gemma3:4b (~3 GB) y
 * mistral-nemo:7b sin disparar el warning. El usuario puede suprimirlo
 * globalmente con "Don't remind me again".
 */
export const HEAVY_MODEL_THRESHOLD_BYTES = 5 * 1024 * 1024 * 1024;

/** Opciones de renderizado (CSP). */
export interface SettingsHtmlOptions {
  /** Nonce CSP — autoriza el unico `<script>` inline. */
  readonly nonce: string;
  /** `webview.cspSource` — origen permitido para los estilos. */
  readonly cspSource: string;
}

/** Lista de providers con auth (ollama excluido). */
const AUTH_PROVIDERS: readonly ProviderName[] = [
  'anthropic',
  'openai',
  'groq',
  'deepseek',
  'mistral',
  'together',
  'fireworks',
  'perplexity',
  'xai',
  'gemini',
  'bedrock',
  'azure',
];

/** Display label de cada agente. */
const AGENT_LABELS: Readonly<Record<BrainAgentId, string>> = {
  triage: 'Triage Agent',
  context: 'Context Agent',
  remediation: 'Remediation Agent',
};

/** Lista de los 3 agentes del Brain Layer. */
const AGENT_IDS: readonly BrainAgentId[] = ['triage', 'context', 'remediation'];

/** Hoja de estilos del panel; reusa las variables de tema de VSCode. */
const STYLE = `
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    font-size: var(--vscode-font-size); padding: 0.75rem; line-height: 1.4; }
  h2 { font-size: 1rem; margin: 0.25rem 0 0.75rem; }
  h3 { font-size: 0.9rem; margin: 1rem 0 0.4rem;
    color: var(--vscode-descriptionForeground); text-transform: uppercase;
    letter-spacing: 0.04em; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85em;
    margin: 0 0 0.6rem; }
  .row { display: flex; align-items: center; gap: 0.4rem;
    padding: 0.3rem 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .row:last-child { border-bottom: none; }
  .row label { flex: 1; }
  .row code { background: var(--vscode-textCodeBlock-background);
    padding: 0.05rem 0.3rem; border-radius: 3px; font-family:
    var(--vscode-editor-font-family), monospace; font-size: 0.85em; }
  .badge { font-size: 0.7em; font-weight: 700; text-transform: uppercase;
    color: #fff; border-radius: 3px; padding: 0.05rem 0.35rem; }
  .badge-ok { background: #2d8a4e; }
  .badge-missing { background: #6b7280; }
  .badge-error { background: #c0392b; }
  .badge-pending { background: #4b6fb5; }
  .badge-warning { background: #c08020; }
  .meta-inline { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .warning { background: var(--vscode-inputValidation-warningBackground);
    border-left: 3px solid var(--vscode-inputValidation-warningBorder);
    padding: 0.4rem 0.6rem; font-size: 0.85em; margin: 0.5rem 0; }
  input[type="password"], input[type="text"], select {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border); border-radius: 3px;
    padding: 0.2rem 0.4rem; font-family: inherit; font-size: 0.9em;
    min-width: 8rem; }
  button { background: var(--vscode-button-background);
    color: var(--vscode-button-foreground); border: none; border-radius: 3px;
    padding: 0.25rem 0.6rem; font-family: inherit; font-size: 0.85em;
    cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.55; cursor: not-allowed; }
  button.secondary { background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground); }
  .help { font-size: 0.8em; color: var(--vscode-descriptionForeground);
    margin-top: 0.4rem; }
`;

/** Renderiza el badge de status de una credencial. */
function renderCredentialBadge(status: CredentialStatus): string {
  if (!status.configured) return '<span class="badge badge-missing">not set</span>';
  if (status.testStatus === 'ok') return '<span class="badge badge-ok">tested</span>';
  if (status.testStatus === 'error') return '<span class="badge badge-error">error</span>';
  return '<span class="badge badge-pending">configured</span>';
}

/** Renderiza una linea de credencial (provider con auth). */
function renderCredentialRow(provider: ProviderName, status: CredentialStatus): string {
  const message =
    status.testMessage !== undefined && status.testMessage !== ''
      ? `<div class="help">${escapeHtml(status.testMessage)}</div>`
      : '';
  return [
    `<div class="row" data-provider="${escapeHtml(provider)}">`,
    `<label><code>${escapeHtml(provider)}</code></label>`,
    renderCredentialBadge(status),
    `<input type="password" placeholder="paste API key" data-input-for="${escapeHtml(provider)}" />`,
    `<button data-action="set-key" data-provider="${escapeHtml(provider)}">Save</button>`,
    `<button class="secondary" data-action="delete-key" data-provider="${escapeHtml(provider)}"` +
      `${status.configured ? '' : ' disabled'}>Delete</button>`,
    `<button class="secondary" data-action="test-key" data-provider="${escapeHtml(provider)}"` +
      `${status.configured ? '' : ' disabled'}>Test</button>`,
    '</div>',
    message,
  ].join('');
}

/** Renderiza una linea de configuracion per-agente. */
function renderAgentRow(agentId: BrainAgentId, active: ResolvedAgentConfig): string {
  // El Record esta indexado por BrainAgentId, asi que AGENT_LABELS[agentId]
  // siempre existe; el cast silencia noUncheckedIndexedAccess.
  const label = AGENT_LABELS[agentId] as string;
  return [
    `<div class="row" data-agent="${escapeHtml(agentId)}">`,
    `<label>${escapeHtml(label)}</label>`,
    `<code>${escapeHtml(active.provider)}</code>`,
    '<span>/</span>',
    `<code>${escapeHtml(active.model)}</code>`,
    '</div>',
  ].join('');
}

/** Formatea un tamano en bytes a "X.Y GB" (1 decimal). */
function formatGb(sizeBytes: number): string {
  const gb = sizeBytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

/** Renderiza un <li> de un modelo Ollama (con info de tamaño si disponible). */
function renderOllamaModelLi(entry: OllamaModelEntry, suppressHeavyModelWarning: boolean): string {
  const codeName = `<code>${escapeHtml(entry.name)}</code>`;
  if (entry.sizeBytes <= 0) {
    // El payload de Ollama no reporto size — render legacy sin badge.
    return `<li>${codeName}</li>`;
  }
  const sizeLabel = ` <span class="meta-inline">${escapeHtml(formatGb(entry.sizeBytes))}</span>`;
  const isHeavy = entry.sizeBytes > HEAVY_MODEL_THRESHOLD_BYTES;
  const heavyBadge =
    isHeavy && !suppressHeavyModelWarning
      ? ' <span class="badge badge-warning" title="Heavy model — may saturate RAM under sustained inference. See README for ≤3 GB alternatives.">⚠ heavy</span>'
      : '';
  return `<li>${codeName}${sizeLabel}${heavyBadge}</li>`;
}

/** Renderiza la seccion "Local Models" (Ollama). */
function renderOllamaSection(ollama: OllamaStatus, suppressHeavyModelWarning: boolean): string {
  const badge = ollama.available
    ? '<span class="badge badge-ok">found</span>'
    : '<span class="badge badge-error">not found</span>';

  // Si el provider envia modelsInfo (con tamaños), usar ese; si no, caer al
  // render legacy con solo nombres (retro-compat).
  let modelsHtml: string;
  let anyHeavy = false;
  if (ollama.available && ollama.modelsInfo !== undefined && ollama.modelsInfo.length > 0) {
    anyHeavy = ollama.modelsInfo.some((m) => m.sizeBytes > HEAVY_MODEL_THRESHOLD_BYTES);
    modelsHtml = `<ul style="margin: 0.4rem 0 0 1rem; padding: 0;">${ollama.modelsInfo
      .map((entry) => renderOllamaModelLi(entry, suppressHeavyModelWarning))
      .join('')}</ul>`;
  } else if (ollama.available && ollama.models.length > 0) {
    modelsHtml = `<ul style="margin: 0.4rem 0 0 1rem; padding: 0;">${ollama.models
      .map((name) => `<li><code>${escapeHtml(name)}</code></li>`)
      .join('')}</ul>`;
  } else if (ollama.available) {
    modelsHtml =
      '<div class="help">No models pulled. Try <code>ollama pull mistral-nemo:12b</code>.</div>';
  } else {
    modelsHtml = '<div class="help">Install Ollama and start it: <code>ollama serve</code>.</div>';
  }

  // Panel-level warning + "Don't remind me again" SOLO si:
  // (1) hay al menos un modelo pesado visible, y
  // (2) el usuario NO ha clickeado "Don't remind me again" antes.
  const heavyWarning =
    anyHeavy && !suppressHeavyModelWarning
      ? [
          '<div class="warning">',
          '⚠ One or more models above exceed 5 GB and may saturate RAM under sustained inference ',
          '(observed during the DG-077 benchmark with Gemma 4 / gpt-oss:20b). ',
          'Consider <code>gemma3:4b</code> (~3 GB) or <code>qwen2.5-coder:7b</code> (~4.4 GB) for batch workloads.',
          ' <button class="secondary" data-action="dismiss-heavy-warning">',
          "Don't remind me again",
          '</button>',
          '</div>',
        ].join('')
      : '';

  return [
    '<div class="row">',
    `<label>Ollama at <code>${escapeHtml(ollama.endpoint)}</code></label>`,
    badge,
    '<button data-action="refresh-ollama">Refresh</button>',
    '</div>',
    modelsHtml,
    heavyWarning,
  ].join('');
}

/** Renderiza el bloque "Active Configuration" con su origen. */
function renderActiveSection(state: SettingsViewState): string {
  const sourceLabel = (() => {
    switch (state.source) {
      case 'agents.yaml':
        return `Source: <code>${escapeHtml(state.agentsYamlPath ?? '.sentinel/agents.yaml')}</code>`;
      case 'fallback':
        return 'Source: Anthropic Haiku fallback (legacy <code>ANTHROPIC_API_KEY</code>)';
      case 'none':
        return 'Source: <em>none configured — set a provider below</em>';
    }
  })();
  const rows = AGENT_IDS.map((id) =>
    renderAgentRow(id, state.active[id] as ResolvedAgentConfig),
  ).join('');
  const warning = state.agentsYamlHasComments
    ? '<div class="warning">⚠ Your <code>agents.yaml</code> contains comments. ' +
      'Saving from this panel will preserve the configuration but strip comments. ' +
      'Edit the YAML manually if you want to keep them.</div>'
    : '';
  return [
    '<h3>Active Configuration</h3>',
    `<p class="meta">${sourceLabel}</p>`,
    rows,
    warning,
  ].join('');
}

/**
 * Renderiza el documento HTML del panel de settings.
 *
 * El unico script registra handlers de click + un puente `postMessage`
 * con la extension host. Cada accion (`set-key`, `delete-key`,
 * `test-key`, `refresh-ollama`) viaja con su payload; la extension
 * responde con un nuevo `state` que dispara el siguiente render.
 */
export function renderSettingsHtml(state: SettingsViewState, options: SettingsHtmlOptions): string {
  const csp =
    `default-src 'none'; ` +
    `style-src ${options.cspSource} 'unsafe-inline'; ` +
    `script-src 'nonce-${options.nonce}';`;

  const activeSection = renderActiveSection(state);
  const credentialsSection = AUTH_PROVIDERS.map((provider) =>
    renderCredentialRow(
      provider,
      state.credentials[provider] ?? { configured: false, testStatus: 'pending' },
    ),
  ).join('');
  const ollamaSection = renderOllamaSection(state.ollama, state.suppressHeavyModelWarning);

  const script =
    `const api = acquireVsCodeApi();` +
    `function send(type, payload) { api.postMessage({ type, ...payload }); }` +
    `document.body.addEventListener('click', (e) => {` +
    `const btn = e.target.closest('button[data-action]');` +
    `if (btn === null) return;` +
    `const action = btn.getAttribute('data-action');` +
    `const provider = btn.getAttribute('data-provider');` +
    `if (action === 'set-key') {` +
    `const input = document.querySelector('input[data-input-for="' + provider + '"]');` +
    `const apiKey = input ? input.value : '';` +
    `if (input) input.value = '';` +
    `send('set-key', { provider, apiKey });` +
    `} else if (action === 'delete-key') {` +
    `send('delete-key', { provider });` +
    `} else if (action === 'test-key') {` +
    `send('test-key', { provider });` +
    `} else if (action === 'refresh-ollama') {` +
    `send('refresh-ollama', {});` +
    `} else if (action === 'dismiss-heavy-warning') {` +
    `send('dismiss-heavy-warning', {});` +
    `}` +
    `});` +
    `// Inicial: pedirle a la extension el state actual.` +
    `send('ready', {});`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${STYLE}</style>
</head>
<body>
<h2>SYNAPTIC Sentinel — Brain Layer Providers</h2>
<p class="meta">Configure which LLM provider runs each agent of the Brain Layer. The Triage / Context / Remediation agents can each use a different provider (CLI configurable via <code>.sentinel/agents.yaml</code>; this panel manages the credentials side).</p>
${activeSection}
<h3>Managed Credentials</h3>
<p class="meta">API keys go directly to each provider (BYOK). Stored encrypted in the OS secret store — never in plain text or in the project repo.</p>
${credentialsSection}
<h3>Local Models (Auto-Discovery)</h3>
<p class="meta">Ollama runs locally and needs no API key. The "Test" button is enabled automatically when Ollama responds at the endpoint below.</p>
${ollamaSection}
<script nonce="${options.nonce}">${script}</script>
</body>
</html>`;
}
