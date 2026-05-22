import { access } from 'node:fs/promises';
import type {
  FindingCategory,
  ScanRequest,
  ScoutAgent,
  ScoutResult,
} from '@synaptic-sentinel/core';
import { runProcess } from '../run-process.js';
import { CheckovOutputSchema } from './checkov-output.js';
import { normalizeCheckovOutput } from './normalizer.js';

/** Opciones de construccion de un `CheckovScout`. */
export interface CheckovScoutOptions {
  /** Ruta al binario de Checkov (lo instala `synaptic-sentinel scanners install`). */
  readonly binaryPath: string;
}

/**
 * Construye los argumentos de Checkov para una peticion de escaneo.
 *
 * `--soft-fail` fuerza exit 0 aun con checks fallidos (un scan con hallazgos
 * no es un fallo del scout); `--compact` y `--quiet` recortan el ruido de la
 * salida JSON (sin bloques de codigo ni listado de checks aprobados).
 */
export function buildCheckovArgs(request: ScanRequest): string[] {
  const target = request.targetPaths[0] ?? '.';
  return ['-d', target, '-o', 'json', '--compact', '--quiet', '--soft-fail'];
}

/**
 * Scout de IaC que envuelve Checkov.
 *
 * Ejecuta `checkov -d` como child process dentro del perimetro del cliente y
 * normaliza su salida JSON a `Finding[]` (categoria `IaC`): misconfiguraciones
 * de infraestructura como codigo (Dockerfile, Terraform, Kubernetes, ...).
 * Un fallo se reporta como `ScoutResult` `failed`; este scout nunca lanza
 * desde `scan()`.
 */
export class CheckovScout implements ScoutAgent {
  readonly id = 'checkov';
  readonly displayName = 'Checkov';
  readonly category: FindingCategory = 'IaC';

  constructor(private readonly options: CheckovScoutOptions) {}

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
        `Binario de Checkov no encontrado: ${this.options.binaryPath}`,
      );
    }

    try {
      const proc = await runProcess(
        this.options.binaryPath,
        buildCheckovArgs(request),
        request.rootPath,
        request.signal,
      );

      let rawJson: unknown;
      try {
        // Checkov emite un objeto (un framework) o un array (varios); tolerar
        // stdout vacio (ningun archivo de IaC en el proyecto).
        rawJson = JSON.parse(proc.stdout.trim() === '' ? '{}' : proc.stdout);
      } catch {
        return this.failedResult(
          request.scanId,
          startedAt,
          `Checkov no devolvio JSON valido (exit ${String(proc.exitCode)}). ${proc.stderr.trim()}`,
        );
      }

      const parsed = CheckovOutputSchema.safeParse(rawJson);
      if (!parsed.success) {
        return this.failedResult(
          request.scanId,
          startedAt,
          `Salida de Checkov inesperada: ${parsed.error.message}`,
        );
      }

      const findings = normalizeCheckovOutput(parsed.data, {
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
