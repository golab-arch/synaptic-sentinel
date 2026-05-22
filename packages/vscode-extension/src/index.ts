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
  runCliScan,
  runCliScannersInstall,
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
/** Id del comando para configurar la API key de Anthropic (BYOK). */
const COMMAND_SET_API_KEY = 'synaptic-sentinel.setAnthropicApiKey';
/** Id del comando que instala los binarios de los scanners (FI-008, DG-059). */
const COMMAND_INSTALL_SCANNERS = 'synaptic-sentinel.installScanners';
/** `source` que aparece en cada diagnostico. */
const DIAGNOSTIC_SOURCE = 'Synaptic Sentinel';
/** Clave del almacen de secretos de VSCode donde se guarda la API key. */
const SECRET_API_KEY = 'synaptic-sentinel.anthropicApiKey';

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
    vscode.commands.registerCommand(COMMAND_SET_API_KEY, () => {
      void setApiKey(secrets);
    }),
    vscode.commands.registerCommand(COMMAND_INSTALL_SCANNERS, () => {
      void installScanners(extensionRoot, terminal);
    }),
    vscode.languages.registerCodeActionsProvider(
      '*',
      { provideCodeActions },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
    vscode.languages.registerHoverProvider('*', { provideHover }),
  );
}

/** Estado ocioso del status bar. */
function setStatusIdle(statusBar: vscode.StatusBarItem): void {
  statusBar.text = '$(shield) Sentinel';
  statusBar.tooltip = 'Synaptic Sentinel: scan the workspace';
}

/** Estado "escaneando" del status bar. */
function setStatusScanning(statusBar: vscode.StatusBarItem): void {
  statusBar.text = '$(sync~spin) Sentinel: scanning...';
  statusBar.tooltip = 'Synaptic Sentinel is scanning the workspace';
}

/** Estado con el resultado del ultimo scan. */
function setStatusResult(statusBar: vscode.StatusBarItem, count: number): void {
  statusBar.text = `$(shield) Sentinel: ${String(count)} finding(s)`;
  statusBar.tooltip = 'Synaptic Sentinel: scan again';
}

/** Estado "triando" del status bar. */
function setStatusTriaging(statusBar: vscode.StatusBarItem): void {
  statusBar.text = '$(sync~spin) Sentinel: triaging...';
  statusBar.tooltip = 'Synaptic Sentinel is triaging the findings';
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
      `Synaptic Sentinel: mark "${finding.title}" as a false positive`,
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
        `Synaptic Sentinel: copy suggested remediation for "${finding.title}"`,
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
    'Synaptic Sentinel: suggested remediation copied to the clipboard.',
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
    void vscode.window.showWarningMessage('Synaptic Sentinel: open a project folder to scan.');
    return;
  }
  const workspacePath = folder.uri.fsPath;
  const cliEntry = resolveCliEntry(extensionRoot);
  // Trae la terminal verbose al frente: la salida de la CLI se transmite ahi.
  terminal.show();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Synaptic Sentinel: scanning the workspace...',
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
        tomoView?.update(workspacePath, tomo.findings);
        setStatusResult(statusBar, tomo.findings.length);
        void vscode.window.showInformationMessage(
          `Synaptic Sentinel: ${String(tomo.findings.length)} finding(s) in the workspace.`,
        );
      } catch (err) {
        setStatusIdle(statusBar);
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Synaptic Sentinel: the scan failed. ${message}`);
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
      'Synaptic Sentinel: finding marked as a false positive.',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(
      `Synaptic Sentinel: could not mark the false positive. ${message}`,
    );
  }
}

/**
 * Maneja el comando `Set Anthropic API Key`: guarda (o borra) la API key
 * BYOK en el almacen de secretos de VSCode — cifrado por el sistema
 * operativo, nunca en texto plano ni en la configuracion.
 */
async function setApiKey(secrets: vscode.SecretStorage): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: 'Synaptic Sentinel — Anthropic API key (BYOK)',
    prompt: 'Stored encrypted in the system secret store. Empty = delete.',
    password: true,
    ignoreFocusOut: true,
  });
  if (key === undefined) return; // el usuario cancelo
  const trimmed = key.trim();
  if (trimmed === '') {
    await secrets.delete(SECRET_API_KEY);
    void vscode.window.showInformationMessage('Synaptic Sentinel: API key deleted.');
    return;
  }
  await secrets.store(SECRET_API_KEY, trimmed);
  void vscode.window.showInformationMessage('Synaptic Sentinel: API key saved.');
}

/** Maneja el comando `Triage Findings`: corre el Brain Layer sobre el scan. */
async function triageWorkspace(
  diagnostics: vscode.DiagnosticCollection,
  statusBar: vscode.StatusBarItem,
  extensionRoot: string,
  secrets: vscode.SecretStorage,
  terminal: SentinelTerminal,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    void vscode.window.showWarningMessage('Synaptic Sentinel: open a project folder to triage.');
    return;
  }
  if (lastScan === undefined) {
    void vscode.window.showWarningMessage(
      'Synaptic Sentinel: run "Scan Workspace" before triaging.',
    );
    return;
  }
  const apiKey = await secrets.get(SECRET_API_KEY);
  if (apiKey === undefined || apiKey === '') {
    const pick = await vscode.window.showWarningMessage(
      'Synaptic Sentinel: the Anthropic API key (BYOK) is missing.',
      'Configure API key',
    );
    if (pick === 'Configure API key') await setApiKey(secrets);
    return;
  }

  const workspacePath = folder.uri.fsPath;
  const cliEntry = resolveCliEntry(extensionRoot);
  const previousCount = lastScan.findings.length;
  // Trae la terminal verbose al frente: el show del triage se transmite ahi.
  terminal.show();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Synaptic Sentinel: triaging the findings...',
      cancellable: true,
    },
    async (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => {
        controller.abort();
      });
      setStatusTriaging(statusBar);
      try {
        await runCliTriage({
          cliEntry,
          workspacePath,
          apiKey,
          signal: controller.signal,
          onOutput: (chunk) => {
            terminal.write(chunk);
          },
        });
        // Re-escaneo silencioso: refresca el tomo con el triage (sin onOutput,
        // para no duplicar un "show" de scan justo despues del de triage).
        const tomo = await runCliScan({ cliEntry, workspacePath, signal: controller.signal });
        lastScan = { workspacePath, findings: tomo.findings };
        renderDiagnostics(diagnostics, workspacePath, tomo.findings);
        tomoView?.update(workspacePath, tomo.findings);
        setStatusResult(statusBar, tomo.findings.length);
        void vscode.window.showInformationMessage('Synaptic Sentinel: triage complete.');
      } catch (err) {
        setStatusResult(statusBar, previousCount);
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Synaptic Sentinel: the triage failed. ${message}`);
      }
    },
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
      title: 'Synaptic Sentinel: installing the scanner binaries...',
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
          'Synaptic Sentinel: scanners installed. You can run "Scan Workspace" now.',
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(
          `Synaptic Sentinel: the scanner install failed. ${message}`,
        );
      }
    },
  );
}
