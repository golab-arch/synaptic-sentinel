import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTomo, type ExtensionTomo } from './tomo.js';

/**
 * Resuelve la ruta por defecto del entry de la CLI.
 *
 * `extensionRoot` es la raiz del paquete de la extension
 * (`vscode.ExtensionContext.extensionPath`); la CLI vive en el paquete
 * hermano `cli`.
 */
export function defaultCliEntry(extensionRoot: string): string {
  return join(extensionRoot, '..', 'cli', 'dist', 'index.js');
}

/** Resultado de la ejecucion de un proceso de la CLI. */
interface CliProcessResult {
  readonly code: number | null;
  readonly stderr: string;
}

/** Parametros de bajo nivel para lanzar la CLI. */
interface SpawnCliOptions {
  readonly cliEntry: string;
  readonly cwd: string;
  readonly args: readonly string[];
  /** Variables de entorno extra (se fusionan con `process.env`). */
  readonly env?: Readonly<Record<string, string>>;
  /** Ejecutable de Node a usar. Por defecto el del extension host (`process.execPath`). */
  readonly nodePath?: string;
  readonly signal?: AbortSignal;
  /** Callback de streaming: recibe cada chunk de stdout/stderr del child. */
  readonly onOutput?: (chunk: string) => void;
}

/**
 * Lanza la CLI como child process y espera a que termine.
 *
 * Por defecto usa `process.execPath` — el Node con el que VSCode corre el
 * extension host — en vez de `node` del `PATH`: una extension empaquetada
 * (`.vsix`) no puede asumir que el usuario tenga `node` instalado en el
 * `PATH` (FI-008).
 */
function spawnCli(options: SpawnCliOptions): Promise<CliProcessResult> {
  return new Promise<CliProcessResult>((resolvePromise, reject) => {
    const child = spawn(options.nodePath ?? process.execPath, [options.cliEntry, ...options.args], {
      cwd: options.cwd,
      ...(options.env !== undefined ? { env: { ...process.env, ...options.env } } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      options.onOutput?.(chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      options.onOutput?.(text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise({ code, stderr });
    });
  });
}

/** Lanza una excepcion si el proceso de la CLI no termino con codigo 0. */
function assertCliOk(result: CliProcessResult, command: string): void {
  if (result.code === 0) return;
  const detail = result.stderr.trim();
  throw new Error(
    `The CLI (${command}) exited with code ${String(result.code)}.` +
      (detail !== '' ? ` ${detail}` : ''),
  );
}

/** Opciones para ejecutar un scan a traves de la CLI. */
export interface RunCliScanOptions {
  /** Ruta al entry de la CLI (`cli/dist/index.js`). */
  readonly cliEntry: string;
  /** Carpeta del proyecto a escanear. */
  readonly workspacePath: string;
  /** Ejecutable de Node a usar. Por defecto el del extension host (`process.execPath`). */
  readonly nodePath?: string;
  /** Senal de cancelacion (kill-switch, v0.4 §9.6). */
  readonly signal?: AbortSignal;
  /**
   * Callback de streaming de la salida de la CLI. Si se provee, la CLI corre
   * con `FORCE_COLOR=1` para que emita ANSI hacia el pseudoterminal (DG-038 B).
   */
  readonly onOutput?: (chunk: string) => void;
}

/**
 * Ejecuta un scan llamando a la CLI (`synaptic-sentinel scan --export`).
 *
 * El scan corre en el proceso propio de la CLI (DG-021 A): la extension
 * nunca importa el motor ni toca `node:sqlite`, y el codigo del cliente no
 * cruza su perimetro. El tomo se exporta a un archivo temporal que se
 * parsea y se borra siempre.
 */
export async function runCliScan(options: RunCliScanOptions): Promise<ExtensionTomo> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'synaptic-sentinel-'));
  const tomoPath = join(tmpDir, 'tomo.json');
  try {
    const result = await spawnCli({
      cliEntry: options.cliEntry,
      cwd: options.workspacePath,
      args: ['scan', '--path', options.workspacePath, '--export', tomoPath],
      ...(options.onOutput !== undefined
        ? { onOutput: options.onOutput, env: { FORCE_COLOR: '1' } }
        : {}),
      ...(options.nodePath !== undefined ? { nodePath: options.nodePath } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    assertCliOk(result, 'scan');
    const raw: unknown = JSON.parse(readFileSync(tomoPath, 'utf8'));
    return parseTomo(raw);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Opciones para marcar un falso positivo a traves de la CLI. */
export interface RunCliMarkFpOptions {
  /** Ruta al entry de la CLI (`cli/dist/index.js`). */
  readonly cliEntry: string;
  /** Carpeta del proyecto cuyo `colony.db` se actualiza. */
  readonly workspacePath: string;
  /** Huella estable del hallazgo a marcar. */
  readonly fingerprint: string;
  /** Motivo del descarte, opcional. */
  readonly reason?: string;
  /** Ejecutable de Node a usar. Por defecto el del extension host (`process.execPath`). */
  readonly nodePath?: string;
  /** Senal de cancelacion. */
  readonly signal?: AbortSignal;
}

/**
 * Marca un hallazgo como falso positivo llamando a la CLI
 * (`synaptic-sentinel mark-fp`). Lanza si la CLI no termina con codigo 0.
 */
export async function runCliMarkFp(options: RunCliMarkFpOptions): Promise<void> {
  const result = await spawnCli({
    cliEntry: options.cliEntry,
    cwd: options.workspacePath,
    args: [
      'mark-fp',
      '--path',
      options.workspacePath,
      '--fingerprint',
      options.fingerprint,
      ...(options.reason !== undefined ? ['--reason', options.reason] : []),
    ],
    ...(options.nodePath !== undefined ? { nodePath: options.nodePath } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  assertCliOk(result, 'mark-fp');
}

/** Opciones para correr el triage del Brain Layer a traves de la CLI. */
export interface RunCliTriageOptions {
  /** Ruta al entry de la CLI (`cli/dist/index.js`). */
  readonly cliEntry: string;
  /** Carpeta del proyecto a triar. */
  readonly workspacePath: string;
  /** API key de Anthropic (BYOK). Se pasa por entorno, nunca por argumentos. */
  readonly apiKey: string;
  /** Ejecutable de Node a usar. Por defecto el del extension host (`process.execPath`). */
  readonly nodePath?: string;
  /** Senal de cancelacion. */
  readonly signal?: AbortSignal;
  /**
   * Callback de streaming de la salida de la CLI. Si se provee, la CLI corre
   * con `FORCE_COLOR=1` para que emita ANSI hacia el pseudoterminal (DG-038 B).
   */
  readonly onOutput?: (chunk: string) => void;
}

/**
 * Corre el triage del Brain Layer llamando a la CLI (`synaptic-sentinel
 * triage`). La API key se entrega via `ANTHROPIC_API_KEY` en el entorno del
 * child process — nunca como argumento (no debe aparecer en la lista de
 * procesos). Lanza si la CLI no termina con codigo 0.
 */
export async function runCliTriage(options: RunCliTriageOptions): Promise<void> {
  const result = await spawnCli({
    cliEntry: options.cliEntry,
    cwd: options.workspacePath,
    args: ['triage', '--path', options.workspacePath],
    env: {
      ANTHROPIC_API_KEY: options.apiKey,
      ...(options.onOutput !== undefined ? { FORCE_COLOR: '1' } : {}),
    },
    ...(options.onOutput !== undefined ? { onOutput: options.onOutput } : {}),
    ...(options.nodePath !== undefined ? { nodePath: options.nodePath } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  assertCliOk(result, 'triage');
}
