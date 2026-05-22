import { access } from 'node:fs/promises';
import type {
  FindingCategory,
  ScanRequest,
  ScoutAgent,
  ScoutResult,
} from '@synaptic-sentinel/core';
import { runProcess } from '../run-process.js';
import { TrivyOutputSchema } from './trivy-output.js';
import { normalizeTrivyOutput } from './normalizer.js';

/** Opciones de construccion de un `TrivyScout`. */
export interface TrivyScoutOptions {
  /** Ruta al binario de Trivy (lo instala `synaptic-sentinel scanners install`). */
  readonly binaryPath: string;
}

/** Construye los argumentos de `trivy fs` para una peticion de escaneo. */
export function buildTrivyArgs(request: ScanRequest): string[] {
  const target = request.targetPaths[0] ?? '.';
  return ['fs', '--scanners', 'vuln', '--format', 'json', '--quiet', target];
}

/**
 * Scout de SCA que envuelve Trivy.
 *
 * Ejecuta `trivy fs --scanners vuln` como child process dentro del perimetro
 * del cliente y normaliza su salida JSON a `Finding[]` (categoria `SCA`):
 * dependencias con vulnerabilidades conocidas. Solo escanea vulnerabilidades
 * — secrets y misconfig son tarea de otros scouts. Un fallo se reporta como
 * `ScoutResult` `failed`; este scout nunca lanza desde `scan()`.
 *
 * Nota: Trivy descarga su base de datos de vulnerabilidades en la primera
 * corrida (cache propia de Trivy, ~/.cache/trivy).
 */
export class TrivyScout implements ScoutAgent {
  readonly id = 'trivy';
  readonly displayName = 'Trivy';
  readonly category: FindingCategory = 'SCA';

  constructor(private readonly options: TrivyScoutOptions) {}

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
        `Binario de Trivy no encontrado: ${this.options.binaryPath}`,
      );
    }

    try {
      const proc = await runProcess(
        this.options.binaryPath,
        buildTrivyArgs(request),
        request.rootPath,
        request.signal,
      );

      let rawJson: unknown;
      try {
        // Trivy emite un objeto JSON; tolerar stdout vacio.
        rawJson = JSON.parse(proc.stdout.trim() === '' ? '{}' : proc.stdout);
      } catch {
        return this.failedResult(
          request.scanId,
          startedAt,
          `Trivy no devolvio JSON valido (exit ${String(proc.exitCode)}). ${proc.stderr.trim()}`,
        );
      }

      const parsed = TrivyOutputSchema.safeParse(rawJson);
      if (!parsed.success) {
        return this.failedResult(
          request.scanId,
          startedAt,
          `Salida de Trivy inesperada: ${parsed.error.message}`,
        );
      }

      const findings = normalizeTrivyOutput(parsed.data, {
        scanId: request.scanId,
        scoutId: this.id,
        rootPath: request.rootPath,
      });
      return {
        scoutId: this.id,
        scanId: request.scanId,
        findings,
        status: 'ok',
        startedAt,
        finishedAt: new Date().toISOString(),
      };
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
