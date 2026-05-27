import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCostSummary, parseTomo, type CostSummary, type ExtensionTomo } from './tomo.js';

/**
 * Resuelve la ruta por defecto del entry de la CLI.
 *
 * `extensionRoot` es la raiz del paquete de la extension
 * (`vscode.ExtensionContext.extensionPath`). La CLI se bundlea dentro de la
 * extension (FI-008): `dist/cli.mjs` (formato ESM, junto al bundle de la
 * extension). El bundle es ESM porque la CLI resuelve assets via
 * `new URL(..., import.meta.url)` — `import.meta` solo existe en ESM.
 */
export function defaultCliEntry(extensionRoot: string): string {
  return join(extensionRoot, 'dist', 'cli.mjs');
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
  /**
   * Callback de streaming: recibe cada chunk de stdout Y stderr del child
   * (mezclados). Usado por los flujos verbose (scan / triage / install)
   * que pintan todo en el pseudoterminal sin distinguir.
   */
  readonly onOutput?: (chunk: string) => void;
  /**
   * Callback solo-stdout (DG-099 A). Cuando se necesita capturar el
   * stdout del child para parsearlo como datos (p.ej. JSON del
   * `cost-history --json`), `onStdout` aisla los chunks sin
   * contaminacion de stderr. NO se acumula con `onOutput`: si ambos
   * estan presentes, `onStdout` recibe los chunks de stdout y
   * `onOutput` recibe SOLO stderr.
   */
  readonly onStdout?: (chunk: string) => void;
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
    // `NODE_NO_WARNINGS=1` silencia DEP0040 (punycode) y demas deprecation warnings
    // del runtime de Node — ruido que ensucia el pseudoterminal del usuario sin
    // accion posible (DG-097 A).
    const env = { ...process.env, ...(options.env ?? {}), NODE_NO_WARNINGS: '1' };
    const child = spawn(options.nodePath ?? process.execPath, [options.cliEntry, ...options.args], {
      cwd: options.cwd,
      env,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      // DG-099 A: si hay onStdout, las dos pipes se aislan (stdout va a
      // onStdout, stderr a onOutput). Si no, comportamiento legacy: ambas
      // mezcladas en onOutput.
      if (options.onStdout !== undefined) {
        options.onStdout(text);
      } else {
        options.onOutput?.(text);
      }
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
  /**
   * Env vars con las API keys de cada provider (BYOK). Se pasan al child
   * process por entorno, nunca por argumentos. Multi-provider (Phase 11
   * DG-073 B): cada provider con apiKey configurada va como
   * `SENTINEL_<PROVIDER>_API_KEY`; la legacy `ANTHROPIC_API_KEY` se
   * duplica si Anthropic esta configurada (retro-compat con la CLI
   * v0.2.0). El helper `collectAllApiKeysAsEnv` en `secret-storage.ts`
   * arma este map desde `vscode.SecretStorage`.
   */
  readonly apiKeyEnv: Readonly<Record<string, string>>;
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
 * triage`). Las API keys de cada provider se entregan via env vars
 * `SENTINEL_<PROVIDER>_API_KEY` (multi-provider, DG-073 B); la
 * `ANTHROPIC_API_KEY` legacy queda duplicada cuando Anthropic esta
 * configurada (retro-compat). Las keys nunca van como argumentos (no
 * deben aparecer en la lista de procesos). Lanza si la CLI no termina
 * con codigo 0.
 */
export async function runCliTriage(options: RunCliTriageOptions): Promise<void> {
  const result = await spawnCli({
    cliEntry: options.cliEntry,
    cwd: options.workspacePath,
    args: ['triage', '--path', options.workspacePath],
    env: {
      ...options.apiKeyEnv,
      ...(options.onOutput !== undefined ? { FORCE_COLOR: '1' } : {}),
    },
    ...(options.onOutput !== undefined ? { onOutput: options.onOutput } : {}),
    ...(options.nodePath !== undefined ? { nodePath: options.nodePath } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  assertCliOk(result, 'triage');
}

/** Opciones para leer el cost summary de la CLI (DG-099 A). */
export interface RunCliCostHistoryOptions {
  /** Ruta al entry de la CLI (`cli/dist/index.js`). */
  readonly cliEntry: string;
  /** Carpeta del proyecto cuyo `colony.db` se consulta. */
  readonly workspacePath: string;
  /**
   * Cuántas sesiones recientes incluir en el rollup. Default 1 — la cost
   * card del sidebar muestra el costo de la última corrida; histórico mas
   * largo queda para el sub-comando CLI `cost-history` sin flag.
   */
  readonly limit?: number;
  /** Ejecutable de Node a usar. Por defecto el del extension host (`process.execPath`). */
  readonly nodePath?: string;
  /** Senal de cancelacion. */
  readonly signal?: AbortSignal;
}

/**
 * Lee el cost summary de la CLI (`synaptic-sentinel cost-history --json`)
 * para mostrar en la cost card del sidebar webview (DG-099 A).
 *
 * `--json` es opt-in: el comando regular sigue emitiendo la tabla
 * formateada para uso desde el terminal. La extension consume el JSON
 * para integrarlo en la UI sin tener que parsear stdout.
 *
 * Si el comando falla o el JSON no parsea contra el schema, devuelve
 * `null` defensivamente. El caller decide no renderear la cost card en
 * ese caso en lugar de romper el render del sidebar entero.
 */
export async function runCliCostHistory(
  options: RunCliCostHistoryOptions,
): Promise<CostSummary | null> {
  let stdout = '';
  const result = await spawnCli({
    cliEntry: options.cliEntry,
    cwd: options.workspacePath,
    args: [
      'cost-history',
      '--path',
      options.workspacePath,
      '--limit',
      String(options.limit ?? 1),
      '--json',
    ],
    ...(options.nodePath !== undefined ? { nodePath: options.nodePath } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    onStdout: (chunk) => {
      stdout += chunk;
    },
  });
  if (result.code !== 0) return null;
  try {
    const raw: unknown = JSON.parse(stdout.trim());
    return parseCostSummary(raw);
  } catch {
    return null;
  }
}

/** Opciones para correr el install de scanners a traves de la CLI (DG-059). */
export interface RunCliScannersInstallOptions {
  /** Ruta al entry de la CLI (`dist/cli.mjs` de la extension bundleada). */
  readonly cliEntry: string;
  /** Ejecutable de Node a usar. Por defecto el del extension host (`process.execPath`). */
  readonly nodePath?: string;
  /** Senal de cancelacion. */
  readonly signal?: AbortSignal;
  /**
   * Callback de streaming de la salida de la CLI. Si se provee, la CLI corre
   * con `FORCE_COLOR=1` para que emita ANSI hacia el pseudoterminal.
   */
  readonly onOutput?: (chunk: string) => void;
}

/**
 * Instala los binarios de los scanners en la cache global por usuario
 * llamando a la CLI (`synaptic-sentinel scanners install --global`).
 *
 * `NODE_OPTIONS=--use-system-ca` es necesario porque el install descarga
 * desde GitHub y el entorno del usuario puede tener inspeccion TLS
 * (corporativo / antivirus); el child Node lo lee al arrancar. Lanza si
 * la CLI no termina con codigo 0.
 */
export async function runCliScannersInstall(options: RunCliScannersInstallOptions): Promise<void> {
  const result = await spawnCli({
    cliEntry: options.cliEntry,
    cwd: process.cwd(),
    args: ['scanners', 'install', '--global'],
    env: {
      NODE_OPTIONS: '--use-system-ca',
      ...(options.onOutput !== undefined ? { FORCE_COLOR: '1' } : {}),
    },
    ...(options.onOutput !== undefined ? { onOutput: options.onOutput } : {}),
    ...(options.nodePath !== undefined ? { nodePath: options.nodePath } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  assertCliOk(result, 'scanners install');
}
