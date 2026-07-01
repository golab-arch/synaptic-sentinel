import { randomUUID } from 'node:crypto';
import { ColonyDb } from '../colony/colony-db.js';
import type { Finding, LifecycleState } from '../types/finding.js';
import type { Pheromone } from '../types/pheromone.js';
import type { Scan, ScanMode } from '../types/scan.js';
import type { ScanRequest, ScoutAgent, ScoutResult, ScoutStatus } from '../types/scout-agent.js';
import { isPathExcluded } from './excluded-paths.js';
import { buildInteractionGraph, type InteractionGraphNode } from './interaction-graph.js';

/**
 * Presupuesto de tiempo por defecto para un scout: 5 minutos. Es un
 * kill-switch para scouts colgados (v0.4 §9.6), no un SLA — debe ser holgado
 * para no matar un scan legitimo de un proyecto grande.
 */
const DEFAULT_SCOUT_TIMEOUT_MS = 5 * 60 * 1000;

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
  /** Senal de cancelacion del llamante (kill-switch, v0.4 §9.6). */
  readonly signal?: AbortSignal;
  /**
   * Presupuesto de tiempo por scout, en ms. Un scout que lo excede se cancela
   * y se reporta `failed` — un scout colgado degrada el scan, no lo cuelga
   * (v0.4 §9.6 "Rogue Agents"). Por defecto 5 minutos.
   */
  readonly scoutTimeoutMs?: number;
  /**
   * Callback opcional invocado cuando cada scout termina (en el orden en que
   * van terminando): habilita feedback de progreso en vivo. Best-effort —
   * un fallo del callback no afecta el scan.
   */
  readonly onScoutSettled?: (outcome: ScoutOutcome) => void;
  /**
   * DG-123.0.1 (Cycle 111): callback opcional invocado tras la construccion
   * del Interaction Graph (Stage 1.5b). Habilita observabilidad de la infra
   * R18 v1: cuantos nodos parseados, cuantos findings elegibles para
   * enriquecimiento, si el build fallo o degrado al fallback graceful.
   * Best-effort — un fallo del callback no afecta el scan.
   */
  readonly onInteractionGraphBuilt?: (stats: InteractionGraphStats) => void;
  /**
   * DG-123.0.1: callback opcional invocado por cada finding cuyo archivo
   * SI tiene un nodo en el Interaction Graph (i.e. lenguaje soportado +
   * parseo exitoso). Emite el path + rol inferido + numero de imports/
   * importedBy/symbols para inspeccion humana. Best-effort.
   */
  readonly onFindingEnriched?: (event: FindingEnrichedEvent) => void;
}

/**
 * DG-123.0.1 (Cycle 111): resumen de la construccion del Interaction Graph
 * para telemetry / observabilidad. Emitido a `onInteractionGraphBuilt` tras
 * completarse Stage 1.5b. Distingue entre exito (`ok: true`) y fallback
 * graceful (`ok: false, error: string`).
 */
export interface InteractionGraphStats {
  /** `true` si buildInteractionGraph completo sin excepcion. */
  readonly ok: boolean;
  /**
   * Numero de nodos en el graph resultante. 0 si `ok: false` o si el
   * workspace no contenia archivos de lenguajes soportados.
   */
  readonly graphSize: number;
  /**
   * Numero de findings (post exclude-list) cuyo archivo tiene un nodo en
   * el graph — i.e. seran enriquecidos con fileContext/symbolContext.
   */
  readonly enrichableFindings: number;
  /**
   * Numero total de findings post exclude-list. Permite computar el ratio
   * `enrichableFindings / totalFindings` = "cuanta superficie del scan es
   * cubierta por R18 v1".
   */
  readonly totalFindings: number;
  /** Duracion del buildInteractionGraph en ms. */
  readonly durationMs: number;
  /**
   * Mensaje del error si `ok: false`. Undefined si `ok: true`. Permite
   * distinguir en telemetry el crash silencioso (WASM ABI, workspace
   * inexistente) del fallback graceful legitimo (workspace sin archivos
   * soportados).
   */
  readonly error?: string;
}

/**
 * DG-123.0.1 (Cycle 111): evento per-finding para observabilidad del
 * enrichment. Emitido a `onFindingEnriched` SOLO para findings cuyo path
 * tiene nodo en el Interaction Graph. Findings sin enrichment NO emiten.
 */
export interface FindingEnrichedEvent {
  /** Fingerprint del finding para correlacion cross-scan. */
  readonly fingerprint: string;
  /** Ruta relativa del archivo del finding. */
  readonly path: string;
  /** Rol inferido por el graph builder. */
  readonly inferredRole: string;
  /** Numero de modulos que este archivo importa (staticos, relative). */
  readonly imports: number;
  /** Numero de archivos que importan a este (reverse index). */
  readonly importedBy: number;
  /** Numero de simbolos top-level definidos en este archivo. */
  readonly definedSymbols: number;
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

/** Resume el resultado crudo de un scout en un `ScoutOutcome`. */
function toScoutOutcome(result: ScoutResult): ScoutOutcome {
  return {
    scoutId: result.scoutId,
    status: result.status,
    findings: result.findings.length,
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
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
 * Cada scout corre con un presupuesto de tiempo (kill-switch, v0.4 §9.6): si
 * se cuelga, se cancela y se reporta `failed`, y el scan sigue con los demas.
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

    // Stage 1 — scouts disponibles, en paralelo, cada uno con su presupuesto.
    const timeoutMs = options.scoutTimeoutMs ?? DEFAULT_SCOUT_TIMEOUT_MS;
    const available = await this.#availableScouts();
    const results = await Promise.all(
      available.map(async (scout) => {
        const result = await this.#runScout(scout, request, timeoutMs);
        if (options.onScoutSettled !== undefined) {
          // El progreso es best-effort: un callback que lanza no rompe el scan.
          try {
            options.onScoutSettled(toScoutOutcome(result));
          } catch {
            /* se ignora */
          }
        }
        return result;
      }),
    );

    // DG-117 A (Cycle 108) — Stage 1.5: filtro de paths estructuralmente
    // ruidosos (fixtures/, dist/, build/, node_modules/, ...). Descarta
    // findings antes del stage 2 para que no entren al dedup ni se persistan.
    // Los descartados se cuentan como `suppressedCount` (mismo bucket que
    // dedup + fp_known) — el usuario ve el agregado, no el desglose.
    // Rationale: empirica del Cycle 107 — 5 findings de Trivy en
    // `packages/scouts/tests/trivy/fixtures/...` + ruido de vibe-detect en
    // fixtures generaron 2 TPs falsos a nivel proyecto + 30 FPs visuales.
    const rawAllFindings = results.flatMap((result) => result.findings);
    const rawFindingsPreGraph: Finding[] = [];
    let excludedByPathCount = 0;
    for (const finding of rawAllFindings) {
      if (isPathExcluded(finding.location.path)) {
        excludedByPathCount += 1;
        continue;
      }
      rawFindingsPreGraph.push(finding);
    }

    // DG-123 A (Cycle 111) — Stage 1.5b: construye el Interaction Graph
    // project-wide + atacha `fileContext` y `symbolContext` a cada finding
    // cuyo archivo sea de un lenguaje soportado (TS/TSX/JS/Python en v1).
    // Findings en otros lenguajes o con errores de parse quedan sin estos
    // fields (undefined) — fallback graceful.
    //
    // Rationale: R18 v1 del research doc Section 12 "Architectural North
    // Star" — SENTINEL debe entender el desarrollo como sistema de
    // interacciones, no como snippets aislados. Este es el enabler
    // arquitectural.
    let interactionGraph: Map<string, InteractionGraphNode>;
    let graphBuildOk = true;
    let graphBuildError: string | undefined;
    const graphBuildStart = Date.now();
    try {
      interactionGraph = await buildInteractionGraph(options.rootPath);
    } catch (err) {
      // Fallback graceful: si el WASM no carga o el parse explota, el scan
      // continua sin graph. Los findings quedan con behavior pre-DG-123 A.
      interactionGraph = new Map();
      graphBuildOk = false;
      graphBuildError = err instanceof Error ? err.message : String(err);
    }
    const graphBuildDurationMs = Date.now() - graphBuildStart;

    // DG-123.0.1 (Cycle 111): computa enrichable count ANTES del map para
    // el evento onInteractionGraphBuilt (telemetry lo espera antes del
    // per-finding).
    let enrichableCount = 0;
    for (const finding of rawFindingsPreGraph) {
      if (interactionGraph.has(finding.location.path)) enrichableCount += 1;
    }
    if (options.onInteractionGraphBuilt !== undefined) {
      // Best-effort: un callback que lanza no rompe el scan (mismo pattern
      // que onScoutSettled).
      try {
        options.onInteractionGraphBuilt({
          ok: graphBuildOk,
          graphSize: interactionGraph.size,
          enrichableFindings: enrichableCount,
          totalFindings: rawFindingsPreGraph.length,
          durationMs: graphBuildDurationMs,
          ...(graphBuildError !== undefined ? { error: graphBuildError } : {}),
        });
      } catch {
        /* se ignora */
      }
    }

    const rawFindings: Finding[] = rawFindingsPreGraph.map((finding) => {
      const node = interactionGraph.get(finding.location.path);
      if (node === undefined) return finding;
      // DG-123.0.1: emit per-finding enrichment event antes del spread.
      if (options.onFindingEnriched !== undefined) {
        try {
          options.onFindingEnriched({
            fingerprint: finding.fingerprint,
            path: finding.location.path,
            inferredRole: node.fileContext.inferredRole,
            imports: node.fileContext.imports.length,
            importedBy: node.fileContext.importedBy.length,
            definedSymbols: node.symbolContext.definedSymbols.length,
          });
        } catch {
          /* se ignora */
        }
      }
      return {
        ...finding,
        fileContext: node.fileContext,
        symbolContext: node.symbolContext,
      };
    });

    // Stage 2 — dedup por fingerprint, supresion de falsos positivos
    // conocidos y clasificacion del ciclo de vida.
    const { persisted, suppressedCount: stage2SuppressedCount } = this.#applyStage2(rawFindings);
    const suppressedCount = stage2SuppressedCount + excludedByPathCount;
    this.#db.insertPheromones(persisted.map(findingToPheromone));

    const finishedAt = new Date().toISOString();
    const scouts: ScoutOutcome[] = results.map(toScoutOutcome);
    const status: 'ok' | 'degraded' = scouts.some((s) => s.status !== 'ok') ? 'degraded' : 'ok';

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
      const lifecycleState: LifecycleState = seenInPriorScans.has(fingerprint) ? 'known' : 'new';
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

  /**
   * Corre un scout con un presupuesto de tiempo (kill-switch, v0.4 §9.6).
   *
   * El scout recibe una `AbortSignal` propia que se dispara si (a) expira el
   * presupuesto o (b) aborta el `signal` del llamante. La ejecucion del scout
   * compite contra esa senal: si el scout se cuelga e ignora su signal, gana
   * la carrera la cancelacion y el scout se reporta `failed` sin colgar el
   * scan. Cualquier excepcion del scout tambien se captura como `failed`.
   */
  async #runScout(
    scout: ScoutAgent,
    baseRequest: ScanRequest,
    timeoutMs: number,
  ): Promise<ScoutResult> {
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const parentSignal = baseRequest.signal;
    const onParentAbort = (): void => controller.abort();
    if (parentSignal !== undefined) {
      if (parentSignal.aborted) controller.abort();
      else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    // Se rechaza en cuanto el controller aborta (timeout o signal del
    // llamante); asi la carrera termina aunque el scout ignore su signal.
    const aborted = new Promise<never>((_resolve, reject) => {
      if (controller.signal.aborted) {
        reject(new Error('scout-cancelado'));
        return;
      }
      controller.signal.addEventListener('abort', () => reject(new Error('scout-cancelado')), {
        once: true,
      });
    });

    const request: ScanRequest = { ...baseRequest, signal: controller.signal };
    try {
      const scoutRun = scout.scan(request);
      // La carrera ya maneja el rechazo de `scoutRun`; este catch evita un
      // unhandled rejection si el scout rechaza despues de perder la carrera.
      void scoutRun.catch(() => undefined);
      return await Promise.race([scoutRun, aborted]);
    } catch (err) {
      const finishedAt = new Date().toISOString();
      let error: string;
      if (timedOut) {
        error =
          `El scout excedio su presupuesto de tiempo (${String(timeoutMs)} ms) ` +
          'y fue cancelado.';
      } else if (controller.signal.aborted) {
        error = 'El scout fue cancelado por el llamante.';
      } else {
        error = err instanceof Error ? err.message : String(err);
      }
      return {
        scoutId: scout.id,
        scanId: baseRequest.scanId,
        findings: [],
        status: 'failed',
        startedAt,
        finishedAt,
        error,
      };
    } finally {
      clearTimeout(timer);
      if (parentSignal !== undefined) parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
}
