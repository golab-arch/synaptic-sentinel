import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { renderTomoWebviewHtml } from './webview-content.js';
import type { CostSummary, ExtensionFinding } from './tomo.js';

/**
 * Proveedor del webview "tomo vivo" (v0.4 §4.3): un panel lateral con los
 * hallazgos del ultimo scan, agrupados por severidad y clickeables para
 * saltar al codigo. Es el increment 3 de la UX verbose (DG-039 B).
 *
 * Arquitectura spawn-CLI (DG-021): el panel solo consume los `ExtensionFinding`
 * que la extension ya tiene; no importa el motor ni toca el tomo crudo.
 */
export class SentinelTomoViewProvider implements vscode.WebviewViewProvider {
  /** Id de la vista contribuida en package.json. */
  static readonly viewId = 'synaptic-sentinel.tomo';

  #view: vscode.WebviewView | undefined;
  #findings: readonly ExtensionFinding[] = [];
  #costSummary: CostSummary | null = null;
  #workspacePath: string | undefined;

  /** Lo invoca VSCode cuando el panel se abre por primera vez. */
  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((message: unknown) => {
      void this.#onMessage(message);
    });
    this.#render();
  }

  /**
   * Actualiza el panel con los hallazgos de un nuevo scan o triage.
   *
   * `costSummary` es opcional (DG-099 A): se pasa solo desde el flow de
   * triage (post-Triage Findings). Despues de un scan plano, queda null
   * y el renderer no emite la cost card.
   */
  update(
    workspacePath: string,
    findings: readonly ExtensionFinding[],
    costSummary?: CostSummary | null,
  ): void {
    this.#workspacePath = workspacePath;
    this.#findings = findings;
    if (costSummary !== undefined) this.#costSummary = costSummary;
    this.#render();
  }

  /** Re-renderiza el HTML del webview, si el panel ya esta abierto. */
  #render(): void {
    const view = this.#view;
    if (view === undefined) return;
    view.webview.html = renderTomoWebviewHtml(
      this.#findings,
      {
        nonce: randomUUID(),
        cspSource: view.webview.cspSource,
      },
      this.#costSummary,
    );
  }

  /**
   * Maneja un mensaje del webview:
   * - `reveal` abre el archivo en el editor.
   * - `triage-remaining` (DG-101 A) dispara el comando interno que corre
   *   el Brain Layer sobre los findings untriaged restantes.
   */
  async #onMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) return;
    const msg = message as { type?: unknown; path?: unknown; line?: unknown };
    if (msg.type === 'triage-remaining') {
      await vscode.commands.executeCommand('synaptic-sentinel.triageRemaining');
      return;
    }
    if (msg.type !== 'reveal' || typeof msg.path !== 'string') return;
    const base = this.#workspacePath;
    if (base === undefined) return;
    // Las lineas del Finding son 1-based; vscode.Position es 0-based.
    const line = typeof msg.line === 'number' && msg.line > 0 ? msg.line - 1 : 0;
    const uri = vscode.Uri.file(join(base, msg.path));
    try {
      const editor = await vscode.window.showTextDocument(uri);
      const position = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
    } catch {
      void vscode.window.showWarningMessage(`SYNAPTIC Sentinel: could not open ${msg.path}.`);
    }
  }
}
