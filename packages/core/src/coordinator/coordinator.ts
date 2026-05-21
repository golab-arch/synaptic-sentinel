import { randomUUID } from 'node:crypto';
import { ColonyDb } from '../colony/colony-db.js';
import type { Finding, LifecycleState } from '../types/finding.js';
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
  /** Hallazgos persistidos, despues de deduplicar y suprimir (stage 2). */
  readonly findingsCount: number;
  /** Hallazgos descartados en stage 2: duplicados o falsos positivos conocidos. */
  readonly suppressedCount: number;
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
 * Coordinator del enjambre — stages 1 y 2.
 *
 * Stage 1: orquesta los `ScoutAgent` inyectados (Least Agency, v0.4 §9.6:
 * solo corre los scouts que recibe, sin delegacion libre) y agrega sus
 * hallazgos. El fallo de un scout degrada el scan, nunca lo aborta (v0.4
 * §3.7: degraded > failed) — por eso `runScan` no lanza por culpa de un scout.
 *
 * Stage 2: deduplica los hallazgos por `fingerprint` (dentro del scan),
 * suprime los que sean falsos positivos confirmados (`fp_known`), marca como
 * `known` los ya vistos en scans anteriores y persiste el resto como
 * feromonas `finding` en la colony DB.
 */
export class Coordinator {
  readonly #db: ColonyDb;
  readonly #scouts: readonly ScoutAgent[];

  constructor(db: ColonyDb, scouts: readonly ScoutAgent[]) {
    this.#db = db;
    this.#scouts = scouts;
  }

  /** Ejecuta un scan: stage 1 (scouts en paralelo) + stage 2 + persistencia. */
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

    // Stage 2 — dedup por fingerprint, supresion de falsos positivos
    // conocidos y clasificacion del ciclo de vida.
    const rawFindings = results.flatMap((result) => result.findings);
    const { persisted, suppressedCount } = this.#applyStage2(rawFindings);
    this.#db.insertPheromones(persisted.map(findingToPheromone));

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
      findingsCount: persisted.length,
      suppressedCount,
      scouts,
    });

    return {
      scanId,
      status,
      findingsCount: persisted.length,
      suppressedCount,
      scouts,
      startedAt,
      finishedAt,
    };
  }

  /**
   * Stage 2: a partir de los hallazgos crudos de los scouts devuelve los que
   * deben persistirse y cuantos se descartaron.
   *
   * Reglas, en orden: (1) si el `fingerprint` tiene una feromona `fp_known`
   * es un falso positivo confirmado y se suprime; (2) si el `fingerprint` ya
   * aparecio en este mismo scan es un duplicado y se suprime; (3) si aparecio
   * en un scan anterior, el hallazgo se marca `known`, si no, conserva `new`.
   */
  #applyStage2(rawFindings: readonly Finding[]): {
    persisted: Finding[];
    suppressedCount: number;
  } {
    const seenInPriorScans = this.#db.getKnownFingerprints('finding');
    const knownFalsePositives = this.#db.getKnownFingerprints('fp_known');

    const seenInThisScan = new Set<string>();
    const persisted: Finding[] = [];
    let suppressedCount = 0;

    for (const finding of rawFindings) {
      const fingerprint = finding.fingerprint;
      if (knownFalsePositives.has(fingerprint) || seenInThisScan.has(fingerprint)) {
        suppressedCount += 1;
        continue;
      }
      seenInThisScan.add(fingerprint);
      const lifecycleState: LifecycleState = seenInPriorScans.has(fingerprint)
        ? 'known'
        : 'new';
      persisted.push({ ...finding, lifecycleState });
    }

    return { persisted, suppressedCount };
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
