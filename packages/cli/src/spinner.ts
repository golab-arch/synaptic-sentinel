import { SPINNER_FRAMES } from '@synaptic-sentinel/reporters';

/** Codigo ANSI: vuelve al inicio de la linea y borra hasta el fin. */
const CLEAR_LINE = '\r\x1b[K';

/**
 * Spinner de terminal para el feedback "en vivo" del scan.
 *
 * Con `enabled = true` (TTY interactiva con color) anima un frame braille en
 * una linea que se reescribe; `log()` imprime una linea permanente por encima
 * sin romper la animacion. Con `enabled = false` (pipe / CI) degrada a texto
 * plano: no anima y `log()` simplemente imprime la linea.
 *
 * Es una pieza con estado (timer + escrituras a stdout): se verifica de punta
 * a punta en la corrida real de la CLI, no con un unit test del temporizador.
 */
export class Spinner {
  #text = '';
  #frame = 0;
  #timer: ReturnType<typeof setInterval> | undefined;
  readonly #enabled: boolean;
  readonly #stream: NodeJS.WriteStream;

  constructor(enabled: boolean, stream: NodeJS.WriteStream = process.stdout) {
    this.#enabled = enabled;
    this.#stream = stream;
  }

  /** Arranca el spinner con el texto dado. */
  start(text: string): void {
    this.#text = text;
    if (!this.#enabled) {
      this.#stream.write(`${text}\n`);
      return;
    }
    this.#render();
    this.#timer = setInterval(() => {
      this.#frame = (this.#frame + 1) % SPINNER_FRAMES.length;
      this.#render();
    }, 80);
  }

  /** Imprime una linea permanente por encima del spinner. */
  log(line: string): void {
    if (!this.#enabled) {
      this.#stream.write(`${line}\n`);
      return;
    }
    this.#stream.write(`${CLEAR_LINE}${line}\n`);
    this.#render();
  }

  /** Detiene el spinner y limpia su linea. */
  stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    if (this.#enabled) this.#stream.write(CLEAR_LINE);
  }

  /** Dibuja el frame actual del spinner en la linea viva. */
  #render(): void {
    const frame = SPINNER_FRAMES[this.#frame] ?? '*';
    this.#stream.write(`${CLEAR_LINE}${frame} ${this.#text}`);
  }
}
