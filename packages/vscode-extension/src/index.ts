/**
 * synaptic-sentinel — extension VSCode
 *
 * Extension VSCode (capa UX delgada). Arquitectura spawn-CLI (DG-021 A): la
 * extension lanza la CLI como child process, lee el tomo exportado y pinta
 * los hallazgos como diagnostics inline. No importa el motor ni toca
 * `node:sqlite` — eso corre en el proceso propio de la CLI.
 *
 * Licencia: Apache-2.0 (OSS).
 */
import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  defaultCliEntry,
  runCliMarkFp,
  runCliCostHistory,
  runCliScan,
  runCliScannersInstall,
  runCliShow,
  runCliTriage,
} from './cli-runner.js';
import {
  findingHoverMarkdown,
  findingToDiagnosticInput,
  findingsInRange,
  groupDiagnosticsByPath,
  remediationClipboardText,
  type DiagnosticInput,
  type DiagnosticLevel,
} from './diagnostics.js';
import type { ExtensionFinding } from './tomo.js';
import {
  collectAllApiKeysAsEnv,
  deleteProviderApiKey,
  getProviderApiKey,
  setProviderApiKey,
} from './secret-storage.js';
import { SentinelSettingsViewProvider } from './settings-view.js';
import { SentinelTerminal } from './terminal.js';
import { SentinelTomoViewProvider } from './tomo-view.js';

/** Id del comando de escaneo contribuido en package.json. */
const COMMAND_SCAN = 'synaptic-sentinel.scanWorkspace';
/** Id del comando interno de marcado de falso positivo (lo invoca un Code Action). */
const COMMAND_MARK_FP = 'synaptic-sentinel.markFalsePositive';
/** Id del comando interno de copia de remediacion (lo invoca un Code Action). */
const COMMAND_COPY_REMEDIATION = 'synaptic-sentinel.copyRemediation';
/** Id del comando de triage del Brain Layer. */
const COMMAND_TRIAGE = 'synaptic-sentinel.triageWorkspace';
/**
 * Id del comando interno "Triage Remaining" (DG-101 A) — lo invoca el
 * boton del sidebar cuando hay findings untriaged tras un triage previo
 * (capeado por `synaptic-sentinel.triageLimit`). NO se expone en el
 * Command Palette: solo el sidebar lo dispara.
 */
const COMMAND_TRIAGE_REMAINING = 'synaptic-sentinel.triageRemaining';
/**
 * Id del comando interno "Re-triage All" (DG-107 A) — lo invoca el boton
 * del sidebar cuando hay findings ya triagados y el usuario quiere
 * re-evaluar (tipico caso: cambio de provider en `.sentinel/agents.yaml`).
 * NO se expone en el Command Palette: el flujo es contextual al sidebar.
 */
const COMMAND_RE_TRIAGE_ALL = 'synaptic-sentinel.reTriageAll';
/** Id del comando para configurar la API key de Anthropic (BYOK). */
const COMMAND_SET_API_KEY = 'synaptic-sentinel.setAnthropicApiKey';
/** Id del comando que instala los binarios de los scanners (FI-008, DG-059). */
const COMMAND_INSTALL_SCANNERS = 'synaptic-sentinel.installScanners';
/** Id del comando que abre el panel multi-provider (Phase 11 DG-074 B). */
const COMMAND_CONFIGURE_PROVIDERS = SentinelSettingsViewProvider.commandId;
/** `source` que aparece en cada diagnostico. */
const DIAGNOSTIC_SOURCE = 'SYNAPTIC Sentinel';

/** Estado del ultimo scan; alimenta los Code Actions de "marcar falso positivo". */
interface ScanState {
  readonly workspacePath: string;
  readonly findings: readonly ExtensionFinding[];
}

/** Resultado del ultimo scan de la sesion (instancia unica de la extension). */
let lastScan: ScanState | undefined;

/** Proveedor del webview "tomo vivo"; se asigna en `activate`. */
let tomoView: SentinelTomoViewProvider | undefined;

/** Punto de entrada de la extension; lo invoca el extension host. */
export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('synaptic-sentinel');
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBar.command = COMMAND_SCAN;
  setStatusIdle(statusBar);
  statusBar.show();

  const extensionRoot = context.extensionPath;
  const secrets = context.secrets;
  // Terminal de solo-lectura para la salida verbose de la CLI (DG-038 B).
  const terminal = new SentinelTerminal();
  // Webview "tomo vivo": panel lateral con los hallazgos (DG-039 B).
  tomoView = new SentinelTomoViewProvider();
  // Panel multi-provider (Phase 11 DG-074 B): provider per agent + Ollama
  // auto-discovery + managed credentials. La extension lo expone via comando.
  const settingsView = new SentinelSettingsViewProvider(
    secrets,
    () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      return folder?.uri.fsPath;
    },
    context.globalState,
  );

  context.subscriptions.push(
    diagnostics,
    statusBar,
    terminal,
    vscode.window.registerWebviewViewProvider(SentinelTomoViewProvider.viewId, tomoView),
    vscode.commands.registerCommand(COMMAND_SCAN, () => {
      void runScanCommand(diagnostics, statusBar, extensionRoot, terminal);
    }),
    vscode.commands.registerCommand(COMMAND_MARK_FP, (fingerprint: unknown) => {
      if (typeof fingerprint === 'string') {
        void markFalsePositive(diagnostics, statusBar, extensionRoot, fingerprint);
      }
    }),
    vscode.commands.registerCommand(COMMAND_COPY_REMEDIATION, (fingerprint: unknown) => {
      if (typeof fingerprint === 'string') copyRemediation(fingerprint);
    }),
    vscode.commands.registerCommand(COMMAND_TRIAGE, () => {
      void triageWorkspace(diagnostics, statusBar, extensionRoot, secrets, terminal);
    }),
    // DG-101 A: comando interno invocado desde el sidebar webview cuando
    // hay untriaged findings tras un triage capeado. Reusa triageWorkspace
    // con un limit alto para procesar todos los untriaged restantes en
    // una sola corrida.
    vscode.commands.registerCommand(COMMAND_TRIAGE_REMAINING, () => {
      void triageWorkspace(
        diagnostics,
        statusBar,
        extensionRoot,
        secrets,
        terminal,
        TRIAGE_REMAINING_LIMIT,
      );
    }),
    // DG-107 A: comando interno invocado desde el sidebar webview cuando
    // el usuario quiere re-evaluar findings ya triagados (cambio de
    // provider). Muestra un confirm dialog destructivo y, si confirmado,
    // corre triage con `reTriage: true` + limit alto.
    vscode.commands.registerCommand(COMMAND_RE_TRIAGE_ALL, () => {
      void reTriageAllWorkspace(diagnostics, statusBar, extensionRoot, secrets, terminal);
    }),
    vscode.commands.registerCommand(COMMAND_SET_API_KEY, () => {
      void setApiKey(secrets);
    }),
    vscode.commands.registerCommand(COMMAND_INSTALL_SCANNERS, () => {
      void installScanners(extensionRoot, terminal);
    }),
    vscode.commands.registerCommand(COMMAND_CONFIGURE_PROVIDERS, () => {
      void settingsView.open();
    }),
    vscode.languages.registerCodeActionsProvider(
      '*',
      { provideCodeActions },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
    vscode.languages.registerHoverProvider('*', { provideHover }),
  );

  // DG-103 A: hidratacion silenciosa al activar la extension. Si el
  // workspace ya tiene un colony.db con una corrida previa (scan +/-
  // triage), reconstruimos el sidebar webview + status bar + diagnostics
  // sin re-correr scanners ni LLM. Cost: 0. Si falla por cualquier razon
  // (DB corrupt, schema mismatch, sin scans aun, etc.) caemos al empty
  // state actual silenciosamente — un fallo de hidratacion NO debe
  // romper la activacion (los hotfixes DG-079.1/DG-079.2/DG-082.1
  // enseñaron a defender el activate path).
  void hydrateSidebarFromCache(diagnostics, statusBar, extensionRoot);
}

/**
 * Carga la ultima corrida cacheada en colony.db y rehidrata el sidebar
 * + diagnostics + status bar + cost card. Silencioso end-to-end: si
 * algo falla, el sidebar queda en su empty state inicial.
 *
 * Decision de scope (DG-103 A): solo se invoca al activar la extension.
 * No se re-llama al detectar cambios en colony.db ni al cambiar de
 * workspace folder — eso seria scope creep. Si el usuario edita codigo
 * fuera de la extension y quiere refresh, corre Scan Workspace de
 * nuevo (mismo flujo de siempre).
 */
async function hydrateSidebarFromCache(
  diagnostics: vscode.DiagnosticCollection,
  statusBar: vscode.StatusBarItem,
  extensionRoot: string,
): Promise<void> {
  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder === undefined) return;
    const workspacePath = folder.uri.fsPath;
    const cliEntry = resolveCliEntry(extensionRoot);
    const tomo = await runCliShow({ cliEntry, workspacePath });
    if (tomo === null) return; // No hay scans previos o la lectura fallo.
    lastScan = { workspacePath, findings: tomo.findings };
    renderDiagnostics(diagnostics, workspacePath, tomo.findings);
    // Cost summary tambien viene de colony.db; si no hay triage previo
    // devuelve null y la cost card simplemente no se renderea.
    const costSummary = await runCliCostHistory({ cliEntry, workspacePath, limit: 1 });
    tomoView?.update(workspacePath, tomo.findings, costSummary, tomo.groups);
    setStatusResult(statusBar, tomo.findings.length);
  } catch {
    // Hidratacion best-effort: cualquier error → empty state silencioso.
    // No tocamos lastScan ni el sidebar para no enmascarar un bug real
    // del usuario tipeando un comando.
  }
}

/** Estado ocioso del status bar. */
function setStatusIdle(statusBar: vscode.StatusBarItem): void {
  statusBar.text = '$(shield) Sentinel';
  statusBar.tooltip = 'SYNAPTIC Sentinel: scan the workspace';
}

/** Estado "escaneando" del status bar. */
function setStatusScanning(statusBar: vscode.StatusBarItem): void {
  statusBar.text = '$(sync~spin) Sentinel: scanning...';
  statusBar.tooltip = 'SYNAPTIC Sentinel is scanning the workspace';
}

/** Estado con el resultado del ultimo scan. */
function setStatusResult(statusBar: vscode.StatusBarItem, count: number): void {
  statusBar.text = `$(shield) Sentinel: ${String(count)} finding(s)`;
  statusBar.tooltip = 'SYNAPTIC Sentinel: scan again';
}

/** Estado "triando" del status bar. */
function setStatusTriaging(statusBar: vscode.StatusBarItem): void {
  statusBar.text = '$(sync~spin) Sentinel: triaging...';
  statusBar.tooltip = 'SYNAPTIC Sentinel is triaging the findings';
}

/** Convierte el nivel agnostico en la severidad de VSCode. */
function toVscodeSeverity(level: DiagnosticLevel): vscode.DiagnosticSeverity {
  if (level === 'error') return vscode.DiagnosticSeverity.Error;
  if (level === 'warning') return vscode.DiagnosticSeverity.Warning;
  return vscode.DiagnosticSeverity.Information;
}

/** Construye un `vscode.Diagnostic` a partir de un `DiagnosticInput`. */
function toVscodeDiagnostic(input: DiagnosticInput): vscode.Diagnostic {
  // El Finding usa lineas/columnas 1-based; vscode.Range es 0-based.
  const range = new vscode.Range(
    Math.max(0, input.startLine - 1),
    Math.max(0, input.startColumn - 1),
    Math.max(0, input.endLine - 1),
    Math.max(0, input.endColumn - 1),
  );
  const diagnostic = new vscode.Diagnostic(range, input.message, toVscodeSeverity(input.level));
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = input.ruleId;
  return diagnostic;
}

/** Pinta los hallazgos como diagnostics inline, agrupados por archivo. */
function renderDiagnostics(
  diagnostics: vscode.DiagnosticCollection,
  workspacePath: string,
  findings: readonly ExtensionFinding[],
): void {
  diagnostics.clear();
  const inputs = findings.map(findingToDiagnosticInput);
  for (const [relativePath, group] of groupDiagnosticsByPath(inputs)) {
    const uri = vscode.Uri.file(join(workspacePath, relativePath));
    diagnostics.set(uri, group.map(toVscodeDiagnostic));
  }
}

/** Resuelve el entry de la CLI: setting `cliPath` o la ruta junto a la extension. */
function resolveCliEntry(extensionRoot: string): string {
  const configured = vscode.workspace
    .getConfiguration('synaptic-sentinel')
    .get<string>('cliPath', '')
    .trim();
  if (configured !== '') return configured;
  return defaultCliEntry(extensionRoot);
}

/**
 * Provee Code Actions para los hallazgos bajo el cursor: "marcar falso
 * positivo" para todos, y "copiar remediacion sugerida" para los que el
 * Remediation Agent ya proceso.
 */
function provideCodeActions(
  document: vscode.TextDocument,
  range: vscode.Range | vscode.Selection,
): vscode.CodeAction[] {
  if (lastScan === undefined) return [];
  const matches = findingsInRange(
    lastScan.findings,
    lastScan.workspacePath,
    document.uri.fsPath,
    range.start.line,
    range.end.line,
  );
  const actions: vscode.CodeAction[] = [];
  for (const finding of matches) {
    const markFp = new vscode.CodeAction(
      `SYNAPTIC Sentinel: mark "${finding.title}" as a false positive`,
      vscode.CodeActionKind.QuickFix,
    );
    markFp.command = {
      command: COMMAND_MARK_FP,
      title: 'Mark as false positive',
      arguments: [finding.fingerprint],
    };
    actions.push(markFp);
    if (finding.remediation !== undefined) {
      const copy = new vscode.CodeAction(
        `SYNAPTIC Sentinel: copy suggested remediation for "${finding.title}"`,
        vscode.CodeActionKind.QuickFix,
      );
      copy.command = {
        command: COMMAND_COPY_REMEDIATION,
        title: 'Copy suggested remediation',
        arguments: [finding.fingerprint],
      };
      actions.push(copy);
    }
  }
  return actions;
}

/**
 * Provee un hover con el detalle del Brain Layer (triage + contexto +
 * remediacion) para los hallazgos que caen en la linea bajo el cursor.
 */
function provideHover(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Hover | undefined {
  if (lastScan === undefined) return undefined;
  const matches = findingsInRange(
    lastScan.findings,
    lastScan.workspacePath,
    document.uri.fsPath,
    position.line,
    position.line,
  );
  if (matches.length === 0) return undefined;
  const markdown = new vscode.MarkdownString(matches.map(findingHoverMarkdown).join('\n\n---\n\n'));
  return new vscode.Hover(markdown);
}

/** Maneja el comando interno `copyRemediation` (lo invoca un Code Action). */
function copyRemediation(fingerprint: string): void {
  const finding = lastScan?.findings.find((item) => item.fingerprint === fingerprint);
  const text = finding !== undefined ? remediationClipboardText(finding) : undefined;
  if (text === undefined) return;
  void vscode.env.clipboard.writeText(text);
  void vscode.window.showInformationMessage(
    'SYNAPTIC Sentinel: suggested remediation copied to the clipboard.',
  );
}

/** Maneja el comando `Scan Workspace`. */
async function runScanCommand(
  diagnostics: vscode.DiagnosticCollection,
  statusBar: vscode.StatusBarItem,
  extensionRoot: string,
  terminal: SentinelTerminal,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    void vscode.window.showWarningMessage('SYNAPTIC Sentinel: open a project folder to scan.');
    return;
  }
  const workspacePath = folder.uri.fsPath;
  const cliEntry = resolveCliEntry(extensionRoot);
  // Trae la terminal verbose al frente: la salida de la CLI se transmite ahi.
  terminal.show();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'SYNAPTIC Sentinel: scanning the workspace...',
      cancellable: true,
    },
    async (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => {
        controller.abort();
      });
      setStatusScanning(statusBar);
      try {
        const tomo = await runCliScan({
          cliEntry,
          workspacePath,
          signal: controller.signal,
          onOutput: (chunk) => {
            terminal.write(chunk);
          },
        });
        lastScan = { workspacePath, findings: tomo.findings };
        renderDiagnostics(diagnostics, workspacePath, tomo.findings);
        tomoView?.update(workspacePath, tomo.findings, undefined, tomo.groups);
        setStatusResult(statusBar, tomo.findings.length);
        void vscode.window.showInformationMessage(
          `SYNAPTIC Sentinel: ${String(tomo.findings.length)} finding(s) in the workspace.`,
        );
      } catch (err) {
        setStatusIdle(statusBar);
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`SYNAPTIC Sentinel: the scan failed. ${message}`);
      }
    },
  );
}

/** Maneja el comando interno `markFalsePositive` (lo invoca un Code Action). */
async function markFalsePositive(
  diagnostics: vscode.DiagnosticCollection,
  statusBar: vscode.StatusBarItem,
  extensionRoot: string,
  fingerprint: string,
): Promise<void> {
  if (lastScan === undefined) return;
  const { workspacePath } = lastScan;
  try {
    await runCliMarkFp({ cliEntry: resolveCliEntry(extensionRoot), workspacePath, fingerprint });
    // Feedback inmediato: se quita el hallazgo marcado de la vista.
    const remaining = lastScan.findings.filter((finding) => finding.fingerprint !== fingerprint);
    lastScan = { workspacePath, findings: remaining };
    renderDiagnostics(diagnostics, workspacePath, remaining);
    tomoView?.update(workspacePath, remaining);
    setStatusResult(statusBar, remaining.length);
    void vscode.window.showInformationMessage(
      'SYNAPTIC Sentinel: finding marked as a false positive.',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(
      `SYNAPTIC Sentinel: could not mark the false positive. ${message}`,
    );
  }
}

/**
 * Maneja el comando `Set Anthropic API Key`: guarda (o borra) la API key
 * de Anthropic (BYOK) en el almacen de secretos de VSCode — cifrado por
 * el sistema operativo, nunca en texto plano. La key se almacena bajo el
 * slot namespaceado `sentinel.anthropic.apiKey` (Phase 11 DG-073 B); la
 * legacy `synaptic-sentinel.anthropicApiKey` se migra automaticamente la
 * primera vez que cualquier flow del Brain Layer lee la key. El comando
 * sigue exponiendose con su titulo historico para no romper la UX de
 * usuarios v0.2.0; el panel multi-provider que permite configurar otros
 * providers (OpenAI, Groq, DeepSeek, etc.) llega en DG-074.
 */
async function setApiKey(secrets: vscode.SecretStorage): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: 'SYNAPTIC Sentinel — Anthropic API key (BYOK)',
    prompt: 'Stored encrypted in the system secret store. Empty = delete.',
    password: true,
    ignoreFocusOut: true,
  });
  if (key === undefined) return; // el usuario cancelo
  const trimmed = key.trim();
  if (trimmed === '') {
    await deleteProviderApiKey(secrets, 'anthropic');
    void vscode.window.showInformationMessage('SYNAPTIC Sentinel: API key deleted.');
    return;
  }
  await setProviderApiKey(secrets, 'anthropic', trimmed);
  void vscode.window.showInformationMessage('SYNAPTIC Sentinel: API key saved.');
}

/**
 * Lee el cap configurado en `synaptic-sentinel.triageLimit` (DG-101 A) — el
 * usuario puede subirlo desde VSCode settings sin tener que invocar la CLI
 * directamente. Si la lectura devuelve algo no-positivo, cae al default
 * que la CLI tiene definido (25).
 */
function readTriageLimitSetting(): number | undefined {
  const raw = vscode.workspace.getConfiguration('synaptic-sentinel').get<number>('triageLimit');
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) return undefined;
  return Math.floor(raw);
}

/**
 * Limite usado por el comando `Triage Remaining` del sidebar (DG-101 A):
 * lo suficientemente alto como para procesar todos los untriaged restantes
 * en una sola corrida sin obligar al usuario a tocar settings. La CLI
 * skip-ea los ya triaged y los known FP, asi que el cap solo aplica a los
 * untriaged reales — incluso valores enormes son seguros.
 */
const TRIAGE_REMAINING_LIMIT = 9999;

/** Maneja el comando `Triage Findings`: corre el Brain Layer sobre el scan. */
async function triageWorkspace(
  diagnostics: vscode.DiagnosticCollection,
  statusBar: vscode.StatusBarItem,
  extensionRoot: string,
  secrets: vscode.SecretStorage,
  terminal: SentinelTerminal,
  limitOverride?: number,
  reTriage?: boolean,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    void vscode.window.showWarningMessage('SYNAPTIC Sentinel: open a project folder to triage.');
    return;
  }
  if (lastScan === undefined) {
    void vscode.window.showWarningMessage(
      'SYNAPTIC Sentinel: run "Scan Workspace" before triaging.',
    );
    return;
  }
  // Phase 11 DG-073 B: recolecta TODAS las apiKeys configuradas (no solo
  // Anthropic). Las pasa al child process como env vars SENTINEL_<PROVIDER>
  // _API_KEY + la legacy ANTHROPIC_API_KEY duplicada para retro-compat.
  // La CLI las resuelve via resolveApiKeyFromEnv segun el provider de
  // cada agente (.sentinel/agents.yaml o ANTHROPIC fallback).
  const apiKeyEnv = await collectAllApiKeysAsEnv(secrets);
  if (Object.keys(apiKeyEnv).length === 0) {
    const anthropicKey = await getProviderApiKey(secrets, 'anthropic');
    if (anthropicKey === undefined) {
      const pick = await vscode.window.showWarningMessage(
        'SYNAPTIC Sentinel: no LLM provider API key is configured.',
        'Configure Anthropic API key',
      );
      if (pick === 'Configure Anthropic API key') await setApiKey(secrets);
      return;
    }
  }

  const workspacePath = folder.uri.fsPath;
  const cliEntry = resolveCliEntry(extensionRoot);
  const previousCount = lastScan.findings.length;
  // Trae la terminal verbose al frente: el show del triage se transmite ahi.
  terminal.show();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'SYNAPTIC Sentinel: triaging the findings...',
      cancellable: true,
    },
    async (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => {
        controller.abort();
      });
      setStatusTriaging(statusBar);
      try {
        const limit = limitOverride ?? readTriageLimitSetting();
        await runCliTriage({
          cliEntry,
          workspacePath,
          apiKeyEnv,
          signal: controller.signal,
          ...(limit !== undefined ? { limit } : {}),
          ...(reTriage === true ? { reTriage: true } : {}),
          onOutput: (chunk) => {
            terminal.write(chunk);
          },
        });
        // Re-escaneo silencioso: refresca el tomo con el triage (sin onOutput,
        // para no duplicar un "show" de scan justo despues del de triage).
        const tomo = await runCliScan({ cliEntry, workspacePath, signal: controller.signal });
        lastScan = { workspacePath, findings: tomo.findings };
        renderDiagnostics(diagnostics, workspacePath, tomo.findings);
        // DG-099 A: lee el cost summary del ultimo triage session via
        // `cost-history --json --limit 1` para mostrarlo como cost card
        // en el sidebar webview. El helper devuelve null defensivamente
        // si el comando falla o el JSON no parsea — el renderer en ese
        // caso simplemente no emite la cost card.
        const costSummary = await runCliCostHistory({
          cliEntry,
          workspacePath,
          limit: 1,
          signal: controller.signal,
        });
        tomoView?.update(workspacePath, tomo.findings, costSummary, tomo.groups);
        setStatusResult(statusBar, tomo.findings.length);
        void vscode.window.showInformationMessage('SYNAPTIC Sentinel: triage complete.');
      } catch (err) {
        setStatusResult(statusBar, previousCount);
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`SYNAPTIC Sentinel: the triage failed. ${message}`);
      }
    },
  );
}

/**
 * Maneja el comando interno "Re-triage All" (DG-107 A): cuenta cuantos
 * findings tienen verdict actualmente, muestra un confirm dialog
 * destructivo, y si el usuario confirma corre `triageWorkspace` con
 * `reTriage: true` + limit alto para procesar todos.
 *
 * Resuelve el caso de uso reportado en feedback empirico: el usuario
 * cambio de provider en `.sentinel/agents.yaml`, corrio Triage Findings,
 * y la CLI hizo skip de los 83 findings ya triagados (correcto pero
 * UX-engañoso: cero verdicts nuevos, cero cost). Re-triage limpia los
 * verdicts viejos y deja que el nuevo provider re-evalue.
 */
async function reTriageAllWorkspace(
  diagnostics: vscode.DiagnosticCollection,
  statusBar: vscode.StatusBarItem,
  extensionRoot: string,
  secrets: vscode.SecretStorage,
  terminal: SentinelTerminal,
): Promise<void> {
  if (lastScan === undefined) {
    void vscode.window.showWarningMessage(
      'SYNAPTIC Sentinel: run "Scan Workspace" before re-triaging.',
    );
    return;
  }
  const triagedCount = lastScan.findings.filter((f) => f.triage !== undefined).length;
  if (triagedCount === 0) {
    void vscode.window.showInformationMessage(
      'SYNAPTIC Sentinel: no findings are currently triaged. Run "Triage Findings" instead.',
    );
    return;
  }
  const pick = await vscode.window.showWarningMessage(
    `SYNAPTIC Sentinel: re-triage will overwrite ${String(triagedCount)} existing verdict(s) ` +
      'and incur LLM cost again. False positives marked manually (`mark-fp`) and the cost ' +
      'history rollup are preserved. Continue?',
    { modal: true },
    'Re-triage all',
  );
  if (pick !== 'Re-triage all') return;
  await triageWorkspace(
    diagnostics,
    statusBar,
    extensionRoot,
    secrets,
    terminal,
    TRIAGE_REMAINING_LIMIT,
    true,
  );
}

/**
 * Maneja el comando `Install Scanners`: descarga e instala los binarios de
 * OpenGrep / Gitleaks / Trivy / Checkov en la cache global por usuario
 * (`~/.synaptic-sentinel/scanners`) llamando a la CLI bundleada
 * (`scanners install --global`). El show de la CLI se transmite al
 * pseudoterminal verbose (FI-008, DG-059).
 */
async function installScanners(extensionRoot: string, terminal: SentinelTerminal): Promise<void> {
  const cliEntry = resolveCliEntry(extensionRoot);
  // Trae la terminal verbose al frente: el show del install se transmite ahi.
  terminal.show();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'SYNAPTIC Sentinel: installing the scanner binaries...',
      cancellable: true,
    },
    async (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => {
        controller.abort();
      });
      try {
        await runCliScannersInstall({
          cliEntry,
          signal: controller.signal,
          onOutput: (chunk) => {
            terminal.write(chunk);
          },
        });
        void vscode.window.showInformationMessage(
          'SYNAPTIC Sentinel: scanners installed. You can run "Scan Workspace" now.',
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(
          `SYNAPTIC Sentinel: the scanner install failed. ${message}`,
        );
      }
    },
  );
}
