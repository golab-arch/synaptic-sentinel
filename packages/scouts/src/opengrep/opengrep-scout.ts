import { access } from 'node:fs/promises';
import type {
  FindingCategory,
  ScanRequest,
  ScoutAgent,
  ScoutResult,
} from '@synaptic-sentinel/core';
import { runProcess } from '../run-process.js';
import { OpenGrepOutputSchema } from './opengrep-output.js';
import { normalizeOpenGrepOutput } from './normalizer.js';

/** Opciones de construccion de un `OpenGrepScout`. */
export interface OpenGrepScoutOptions {
  /** Ruta al binario de OpenGrep (lo instala scripts/install-scanners.ts). */
  readonly binaryPath: string;
  /** Argumentos de configuracion de reglas (ej. `['--config', 'auto']`). */
  readonly configArgs: readonly string[];
}

/** Construye los argumentos de `opengrep scan` para una peticion de escaneo. */
export function buildOpenGrepArgs(configArgs: readonly string[], request: ScanRequest): string[] {
  const targets = request.targetPaths.length > 0 ? [...request.targetPaths] : ['.'];
  return ['scan', '--json', '--quiet', '--disable-version-check', ...configArgs, ...targets];
}

/**
 * Scout de SAST que envuelve OpenGrep.
 *
 * Ejecuta el binario de OpenGrep como child process dentro del perimetro del
 * cliente y normaliza su salida JSON a `Finding[]`. Un fallo se reporta como
 * un `ScoutResult` con estado `failed` o `partial` — el Coordinator decide
 * (v0.4 §3.7: degraded > failed); este scout nunca lanza desde `scan()`.
 */
export class OpenGrepScout implements ScoutAgent {
  readonly id = 'opengrep';
  readonly displayName = 'OpenGrep';
  readonly category: FindingCategory = 'SAST';

  constructor(private readonly options: OpenGrepScoutOptions) {}

  async isAvailable(): Promise<boolean> {
    try {
      await access(this.options.binaryPath);
      return true;
    } catch {
      return false;
    }
  }

  async scan(request: ScanRequest): Promise<ScoutResult> {
    const startedAt = new Date().toISOString();

    if (!(await this.isAvailable())) {
      return this.failedResult(
        request.scanId,
        startedAt,
        `Binario de OpenGrep no encontrado: ${this.options.binaryPath}`,
      );
    }

    const args = buildOpenGrepArgs(this.options.configArgs, request);
    try {
      const proc = await runProcess(
        this.options.binaryPath,
        args,
        request.rootPath,
        request.signal,
      );

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(proc.stdout);
      } catch {
        return this.failedResult(
          request.scanId,
          startedAt,
          `OpenGrep no devolvio JSON valido (exit ${String(proc.exitCode)}). ${proc.stderr.trim()}`,
        );
      }

      const parsed = OpenGrepOutputSchema.safeParse(rawJson);
      if (!parsed.success) {
        return this.failedResult(
          request.scanId,
          startedAt,
          `Salida de OpenGrep inesperada: ${parsed.error.message}`,
        );
      }

      const findings = normalizeOpenGrepOutput(parsed.data, {
        scanId: request.scanId,
        scoutId: this.id,
        rootPath: request.rootPath,
      });
      const errorCount = parsed.data.errors.length;
      const result: ScoutResult = {
        scoutId: this.id,
        scanId: request.scanId,
        findings,
        status: errorCount > 0 ? 'partial' : 'ok',
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      return errorCount > 0
        ? { ...result, error: `OpenGrep reporto ${String(errorCount)} error(es) durante el scan.` }
        : result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.failedResult(request.scanId, startedAt, message);
    }
  }

  /** Construye un `ScoutResult` en estado `failed`. */
  private failedResult(scanId: string, startedAt: string, error: string): ScoutResult {
    return {
      scoutId: this.id,
      scanId,
      findings: [],
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      error,
    };
  }
}
