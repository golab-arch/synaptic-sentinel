import { randomUUID } from 'node:crypto';
import { ColonyDb } from '../colony/colony-db.js';
import type { Finding } from '../types/finding.js';
import type { Pheromone } from '../types/pheromone.js';
import type { Scan, ScanMode } from '../types/scan.js';
import type { ScanRequest, ScoutAgent, ScoutResult, ScoutStatus } from '../types/scout-agent.js';

/** Parametros de un scan dirigido al Coordinator. */
export interface ScanOptions {
  /** Raiz del proyecto del cliente (ruta absoluta). */
  readonly rootPath: string;
  /** Rutas a escanear, relativas a `rootPath`. Vacio = todo el proyecto. */
  readonly targetPaths?: readonly string[];
  /** Modo de escaneo. */
  readonly mode: ScanMode;
  /** SHA del commit git sobre el que se ejecuta el scan, si aplica. */
  readonly gitSha?: string;
  /** Senal de cancelacion (kill-switch, v0.4 §9.6). */
  readonly signal?: AbortSignal;
}

/** Resumen de la ejecucion de un scout dentro de un scan. */
export interface ScoutOutcome {
  readonly scoutId: string;
  readonly status: ScoutStatus;
  readonly findings: number;
  readonly error?: string;
}

/** Resultado de un scan completo del Coordinator. */
export interface ScanOutcome {
  readonly scanId: string;
  /** `degraded` si algun scout no termino en estado `ok` (v0.4 §3.7). */
  readonly status: 'ok' | 'degraded';
  readonly findingsCount: number;
  readonly scouts: readonly ScoutOutcome[];
  readonly startedAt: string;
  readonly finishedAt: string;
}

/** Convierte un `Finding` en una feromona `finding` para la colony DB. */
function findingToPheromone(finding: Finding): Pheromone {
  return {
    id: randomUUID(),
    type: 'finding',
    agentId: finding.scoutId,
    scanId: finding.scanId,
    targetPath: finding.location.path,
    payload: { ...finding },
    decayRate: 0.1,
    createdAt: finding.createdAt,
  };
}

/**
 * Coordinator del enjambre — stage 1 (scout + persistencia).
 *
 * Orquesta los `ScoutAgent` inyectados (Least Agency, v0.4 §9.6: solo corre
 * los scouts que recibe, sin delegacion libre), agrega sus hallazgos y los
 * persiste como feromonas `finding` en la colony DB. El fallo de un scout
 * degrada el scan, nunca lo aborta (v0.4 §3.7: degraded > failed) — por eso
 * `runScan` no lanza por culpa de un scout.
 */
export class Coordinator {
  readonly #db: ColonyDb;
  readonly #scouts: readonly ScoutAgent[];

  constructor(db: ColonyDb, scouts: readonly ScoutAgent[]) {
    this.#db = db;
    this.#scouts = scouts;
  }

  /** Ejecuta un scan: stage 1 (scouts en paralelo) + persistencia. */
  async runScan(options: ScanOptions): Promise<ScanOutcome> {
    const scanId = randomUUID();
    const startedAt = new Date().toISOString();

    const scan: Scan = {
      id: scanId,
      startedAt,
      ...(options.gitSha !== undefined ? { gitSha: options.gitSha } : {}),
    };
    this.#db.insertScan(scan);

    const request: ScanRequest = {
      scanId,
      rootPath: options.rootPath,
      targetPaths: options.targetPaths ?? [],
      mode: options.mode,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    };

    // Stage 1 — scouts disponibles, en paralelo.
    const available = await this.#availableScouts();
    const results = await Promise.all(
      available.map((scout) => this.#runScout(scout, request)),
    );

    // Persistencia: cada Finding se deposita como feromona `finding`.
    const findings = results.flatMap((result) => result.findings);
    this.#db.insertPheromones(findings.map(findingToPheromone));

    const finishedAt = new Date().toISOString();
    const scouts: ScoutOutcome[] = results.map((result) => ({
      scoutId: result.scoutId,
      status: result.status,
      findings: result.findings.length,
      ...(result.error !== undefined ? { error: result.error } : {}),
    }));
    const status: 'ok' | 'degraded' = scouts.some((s) => s.status !== 'ok')
      ? 'degraded'
      : 'ok';

    this.#db.completeScan(scanId, finishedAt, {
      status,
      findingsCount: findings.length,
      scouts,
    });

    return { scanId, status, findingsCount: findings.length, scouts, startedAt, finishedAt };
  }

  /** Devuelve los scouts cuyo scanner subyacente esta disponible. */
  async #availableScouts(): Promise<ScoutAgent[]> {
    const checks = await Promise.all(
      this.#scouts.map(async (scout) => ({
        scout,
        ok: await scout.isAvailable().catch(() => false),
      })),
    );
    return checks.filter((check) => check.ok).map((check) => check.scout);
  }

  /** Corre un scout; cualquier excepcion se captura como `ScoutResult` failed. */
  async #runScout(scout: ScoutAgent, request: ScanRequest): Promise<ScoutResult> {
    try {
      return await scout.scan(request);
    } catch (err) {
      const now = new Date().toISOString();
      return {
        scoutId: scout.id,
        scanId: request.scanId,
        findings: [],
        status: 'failed',
        startedAt: now,
        finishedAt: now,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
