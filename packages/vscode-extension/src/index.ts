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
import { defaultCliEntry, runCliScan } from './cli-runner.js';
import {
  findingToDiagnosticInput,
  groupDiagnosticsByPath,
  type DiagnosticInput,
  type DiagnosticLevel,
} from './diagnostics.js';
import type { ExtensionFinding } from './tomo.js';

/** Id del comando de escaneo contribuido en package.json. */
const COMMAND_SCAN = 'synaptic-sentinel.scanWorkspace';
/** `source` que aparece en cada diagnostico. */
const DIAGNOSTIC_SOURCE = 'Synaptic Sentinel';

/** Punto de entrada de la extension; lo invoca el extension host. */
export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('synaptic-sentinel');
  const extensionRoot = context.extensionPath;
  context.subscriptions.push(
    diagnostics,
    vscode.commands.registerCommand(COMMAND_SCAN, () => {
      void runScanCommand(diagnostics, extensionRoot);
    }),
  );
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
    diagnostics.set(
      uri,
      group.map(toVscodeDiagnostic),
    );
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

/** Maneja el comando `Scan Workspace`. */
async function runScanCommand(
  diagnostics: vscode.DiagnosticCollection,
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
      try {
        const tomo = await runCliScan({ cliEntry, workspacePath, signal: controller.signal });
        renderDiagnostics(diagnostics, workspacePath, tomo.findings);
        void vscode.window.showInformationMessage(
          `Synaptic Sentinel: ${String(tomo.findings.length)} hallazgo(s) en el workspace.`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Synaptic Sentinel: el scan fallo. ${message}`);
      }
    },
  );
}
