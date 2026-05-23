import * as vscode from 'vscode';
import { toCrlf } from './terminal-format.js';

/**
 * Terminal de solo-lectura "SYNAPTIC Sentinel".
 *
 * Envuelve un `Pseudoterminal` nativo de VSCode al que se transmite la salida
 * ANSI de la CLI (spawneada con `FORCE_COLOR=1`): banner, progreso en vivo y
 * reveal se ven dentro del IDE con color y animacion. Es la superficie del
 * increment 2 de la UX verbose (DG-038 B) — API nativa, sin webview.
 *
 * Se reutiliza entre corridas; si el usuario cierra el terminal, la proxima
 * escritura lo recrea. El texto escrito antes de que el terminal abra se
 * almacena en un buffer y se vuelca en `open` (evita perder el banner).
 */
export class SentinelTerminal {
  #terminal: vscode.Terminal | undefined;
  #emitter: vscode.EventEmitter<string> | undefined;
  #opened = false;
  #buffer: string[] = [];

  /** Garantiza que el terminal existe y lo trae al frente sin robar foco. */
  show(): void {
    if (this.#terminal === undefined) this.#create();
    this.#terminal?.show(true);
  }

  /** Escribe texto en el terminal (normaliza LF -> CRLF). */
  write(text: string): void {
    if (this.#emitter === undefined) this.#create();
    const data = toCrlf(text);
    if (this.#opened) this.#emitter?.fire(data);
    else this.#buffer.push(data);
  }

  /** Libera los recursos del terminal. */
  dispose(): void {
    this.#terminal?.dispose();
    this.#emitter?.dispose();
    this.#reset();
  }

  /** Crea el Pseudoterminal y el terminal de VSCode. */
  #create(): void {
    const emitter = new vscode.EventEmitter<string>();
    const pty: vscode.Pseudoterminal = {
      onDidWrite: emitter.event,
      open: () => {
        this.#opened = true;
        for (const chunk of this.#buffer) emitter.fire(chunk);
        this.#buffer = [];
      },
      close: () => {
        this.#reset();
      },
    };
    this.#emitter = emitter;
    this.#terminal = vscode.window.createTerminal({ name: 'SYNAPTIC Sentinel', pty });
  }

  /** Reinicia el estado interno (el terminal ya no existe). */
  #reset(): void {
    this.#terminal = undefined;
    this.#emitter = undefined;
    this.#opened = false;
    this.#buffer = [];
  }
}
