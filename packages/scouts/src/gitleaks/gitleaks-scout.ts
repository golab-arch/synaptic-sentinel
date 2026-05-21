import { access } from 'node:fs/promises';
import type {
  FindingCategory,
  ScanRequest,
  ScoutAgent,
  ScoutResult,
} from '@synaptic-sentinel/core';
import { runProcess } from '../run-process.js';
import { GitleaksOutputSchema } from './gitleaks-output.js';
import { normalizeGitleaksOutput } from './normalizer.js';

/** Opciones de construccion de un `GitleaksScout`. */
export interface GitleaksScoutOptions {
  /** Ruta al binario de Gitleaks (lo instala scripts/install-scanners.ts). */
  readonly binaryPath: string;
}

/** Construye los argumentos de `gitleaks dir` para una peticion de escaneo. */
export function buildGitleaksArgs(request: ScanRequest): string[] {
  const target = request.targetPaths[0] ?? '.';
  return [
    'dir',
    target,
    '--report-format',
    'json',
    '--report-path',
    '-',
    '--no-banner',
    '--exit-code',
    '0',
    '--redact',
    '--log-level',
    'error',
  ];
}

/**
 * Scout de secrets que envuelve Gitleaks.
 *
 * Ejecuta `gitleaks dir` como child process dentro del perimetro del cliente
 * y normaliza su salida JSON a `Finding[]`. Se corre con `--redact`: el valor
 * del secreto nunca se persiste en la colony DB ni en el tomo. Un fallo se
 * reporta como `ScoutResult` `failed`; este scout nunca lanza desde `scan()`.
 */
export class GitleaksScout implements ScoutAgent {
  readonly id = 'gitleaks';
  readonly displayName = 'Gitleaks';
  readonly category: FindingCategory = 'Secrets';

  constructor(private readonly options: GitleaksScoutOptions) {}

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
        `Binario de Gitleaks no encontrado: ${this.options.binaryPath}`,
      );
    }

    try {
      const proc = await runProcess(
        this.options.binaryPath,
        buildGitleaksArgs(request),
        request.rootPath,
        request.signal,
      );

      let rawJson: unknown;
      try {
        // Gitleaks emite `[]` cuando no hay hallazgos; tolerar stdout vacio.
        rawJson = JSON.parse(proc.stdout.trim() === '' ? '[]' : proc.stdout);
      } catch {
        return this.failedResult(
          request.scanId,
          startedAt,
          `Gitleaks no devolvio JSON valido (exit ${String(proc.exitCode)}). ${proc.stderr.trim()}`,
        );
      }

      const parsed = GitleaksOutputSchema.safeParse(rawJson);
      if (!parsed.success) {
        return this.failedResult(
          request.scanId,
          startedAt,
          `Salida de Gitleaks inesperada: ${parsed.error.message}`,
        );
      }

      const findings = normalizeGitleaksOutput(parsed.data, {
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
