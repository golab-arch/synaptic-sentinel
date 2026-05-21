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
import { defaultCliEntry, runCliMarkFp, runCliScan } from './cli-runner.js';
import {
  findingToDiagnosticInput,
  findingsInRange,
  groupDiagnosticsByPath,
  type DiagnosticInput,
  type DiagnosticLevel,
} from './diagnostics.js';
import type { ExtensionFinding } from './tomo.js';

/** Id del comando de escaneo contribuido en package.json. */
const COMMAND_SCAN = 'synaptic-sentinel.scanWorkspace';
/** Id del comando interno de marcado de falso positivo (lo invoca un Code Action). */
const COMMAND_MARK_FP = 'synaptic-sentinel.markFalsePositive';
/** `source` que aparece en cada diagnostico. */
const DIAGNOSTIC_SOURCE = 'Synaptic Sentinel';

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

  context.subscriptions.push(
    diagnostics,
    statusBar,
    vscode.commands.registerCommand(COMMAND_SCAN, () => {
      void runScanCommand(diagnostics, statusBar, extensionRoot);
    }),
    vscode.commands.registerCommand(COMMAND_MARK_FP, (fingerprint: unknown) => {
      if (typeof fingerprint === 'string') {
        void markFalsePositive(diagnostics, statusBar, extensionRoot, fingerprint);
      }
    }),
    vscode.languages.registerCodeActionsProvider(
      '*',
      { provideCodeActions },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
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

/** Provee Code Actions "marcar falso positivo" para los hallazgos en rango. */
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
  return matches.map((finding) => {
    const action = new vscode.CodeAction(
      `Synaptic Sentinel: marcar "${finding.title}" como falso positivo`,
      vscode.CodeActionKind.QuickFix,
    );
    action.command = {
      command: COMMAND_MARK_FP,
      title: 'Marcar como falso positivo',
      arguments: [finding.fingerprint],
    };
    return action;
  });
}

/** Maneja el comando `Scan Workspace`. */
async function runScanCommand(
  diagnostics: vscode.DiagnosticCollection,
  statusBar: vscode.StatusBarItem,
  extensionRoot: string,
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
        const tomo = await runCliScan({ cliEntry, workspacePath, signal: controller.signal });
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
