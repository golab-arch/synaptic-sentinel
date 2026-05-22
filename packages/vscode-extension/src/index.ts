/**
 * @synaptic-sentinel/vscode-extension
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
import { defaultCliEntry, runCliMarkFp, runCliScan, runCliTriage } from './cli-runner.js';
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

  context.subscriptions.push(
    diagnostics,
    statusBar,
    terminal,
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
  statusBar.tooltip = 'Synaptic Sentinel: escanear el workspace';
}

/** Estado "escaneando" del status bar. */
function setStatusScanning(statusBar: vscode.StatusBarItem): void {
  statusBar.text = '$(sync~spin) Sentinel: escaneando...';
  statusBar.tooltip = 'Synaptic Sentinel esta escaneando el workspace';
}

/** Estado con el resultado del ultimo scan. */
function setStatusResult(statusBar: vscode.StatusBarItem, count: number): void {
  statusBar.text = `$(shield) Sentinel: ${String(count)} hallazgo(s)`;
  statusBar.tooltip = 'Synaptic Sentinel: escanear de nuevo';
}

/** Estado "triando" del status bar. */
function setStatusTriaging(statusBar: vscode.StatusBarItem): void {
  statusBar.text = '$(sync~spin) Sentinel: triando...';
  statusBar.tooltip = 'Synaptic Sentinel esta triando los hallazgos';
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
      `Synaptic Sentinel: marcar "${finding.title}" como falso positivo`,
      vscode.CodeActionKind.QuickFix,
    );
    markFp.command = {
      command: COMMAND_MARK_FP,
      title: 'Marcar como falso positivo',
      arguments: [finding.fingerprint],
    };
    actions.push(markFp);
    if (finding.remediation !== undefined) {
      const copy = new vscode.CodeAction(
        `Synaptic Sentinel: copiar remediacion sugerida de "${finding.title}"`,
        vscode.CodeActionKind.QuickFix,
      );
      copy.command = {
        command: COMMAND_COPY_REMEDIATION,
        title: 'Copiar remediacion sugerida',
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
  const markdown = new vscode.MarkdownString(
    matches.map(findingHoverMarkdown).join('\n\n---\n\n'),
  );
  return new vscode.Hover(markdown);
}

/** Maneja el comando interno `copyRemediation` (lo invoca un Code Action). */
function copyRemediation(fingerprint: string): void {
  const finding = lastScan?.findings.find((item) => item.fingerprint === fingerprint);
  const text = finding !== undefined ? remediationClipboardText(finding) : undefined;
  if (text === undefined) return;
  void vscode.env.clipboard.writeText(text);
  void vscode.window.showInformationMessage(
    'Synaptic Sentinel: remediacion sugerida copiada al portapapeles.',
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
    void vscode.window.showWarningMessage(
      'Synaptic Sentinel: abre una carpeta de proyecto para escanear.',
    );
    return;
  }
  const workspacePath = folder.uri.fsPath;
  const cliEntry = resolveCliEntry(extensionRoot);
  // Trae la terminal verbose al frente: la salida de la CLI se transmite ahi.
  terminal.show();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Synaptic Sentinel: escaneando el workspace...',
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
        setStatusResult(statusBar, tomo.findings.length);
        void vscode.window.showInformationMessage(
          `Synaptic Sentinel: ${String(tomo.findings.length)} hallazgo(s) en el workspace.`,
        );
      } catch (err) {
        setStatusIdle(statusBar);
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Synaptic Sentinel: el scan fallo. ${message}`);
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
    setStatusResult(statusBar, remaining.length);
    void vscode.window.showInformationMessage(
      'Synaptic Sentinel: hallazgo marcado como falso positivo.',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(
      `Synaptic Sentinel: no se pudo marcar el falso positivo. ${message}`,
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
    title: 'Synaptic Sentinel — API key de Anthropic (BYOK)',
    prompt: 'Se guarda cifrada en el almacen de secretos del sistema. Vacio = borrar.',
    password: true,
    ignoreFocusOut: true,
  });
  if (key === undefined) return; // el usuario cancelo
  const trimmed = key.trim();
  if (trimmed === '') {
    await secrets.delete(SECRET_API_KEY);
    void vscode.window.showInformationMessage('Synaptic Sentinel: API key eliminada.');
    return;
  }
  await secrets.store(SECRET_API_KEY, trimmed);
  void vscode.window.showInformationMessage('Synaptic Sentinel: API key guardada.');
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
    void vscode.window.showWarningMessage(
      'Synaptic Sentinel: abre una carpeta de proyecto para triar.',
    );
    return;
  }
  if (lastScan === undefined) {
    void vscode.window.showWarningMessage(
      'Synaptic Sentinel: ejecuta "Scan Workspace" antes de triar.',
    );
    return;
  }
  const apiKey = await secrets.get(SECRET_API_KEY);
  if (apiKey === undefined || apiKey === '') {
    const pick = await vscode.window.showWarningMessage(
      'Synaptic Sentinel: falta la API key de Anthropic (BYOK).',
      'Configurar API key',
    );
    if (pick === 'Configurar API key') await setApiKey(secrets);
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
      title: 'Synaptic Sentinel: triando los hallazgos...',
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
        setStatusResult(statusBar, tomo.findings.length);
        void vscode.window.showInformationMessage('Synaptic Sentinel: triage completado.');
      } catch (err) {
        setStatusResult(statusBar, previousCount);
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Synaptic Sentinel: el triage fallo. ${message}`);
      }
    },
  );
}
