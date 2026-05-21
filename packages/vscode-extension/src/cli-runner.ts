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
  readonly nodePath?: string;
  readonly signal?: AbortSignal;
}

/** Lanza la CLI como child process y espera a que termine. */
function spawnCli(options: SpawnCliOptions): Promise<CliProcessResult> {
  return new Promise<CliProcessResult>((resolvePromise, reject) => {
    const child = spawn(options.nodePath ?? 'node', [options.cliEntry, ...options.args], {
      cwd: options.cwd,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
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
    `La CLI (${command}) termino con codigo ${String(result.code)}.` +
      (detail !== '' ? ` ${detail}` : ''),
  );
}

/** Opciones para ejecutar un scan a traves de la CLI. */
export interface RunCliScanOptions {
  /** Ruta al entry de la CLI (`cli/dist/index.js`). */
  readonly cliEntry: string;
  /** Carpeta del proyecto a escanear. */
  readonly workspacePath: string;
  /** Ejecutable de Node a usar. Por defecto `node` (del PATH). */
  readonly nodePath?: string;
  /** Senal de cancelacion (kill-switch, v0.4 §9.6). */
  readonly signal?: AbortSignal;
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
  /** Ejecutable de Node a usar. Por defecto `node` (del PATH). */
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
