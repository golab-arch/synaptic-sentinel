import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTomo, type ExtensionTomo } from './tomo.js';

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

/** Lanza la CLI como child process y espera a que termine. */
function spawnCli(options: RunCliScanOptions, tomoPath: string): Promise<CliProcessResult> {
  return new Promise<CliProcessResult>((resolve, reject) => {
    const child = spawn(
      options.nodePath ?? 'node',
      [options.cliEntry, 'scan', '--path', options.workspacePath, '--export', tomoPath],
      {
        cwd: options.workspacePath,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stderr });
    });
  });
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
    const result = await spawnCli(options, tomoPath);
    if (result.code !== 0) {
      const detail = result.stderr.trim();
      throw new Error(
        `La CLI termino con codigo ${String(result.code)}.` +
          (detail !== '' ? ` ${detail}` : ''),
      );
    }
    const raw: unknown = JSON.parse(readFileSync(tomoPath, 'utf8'));
    return parseTomo(raw);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
