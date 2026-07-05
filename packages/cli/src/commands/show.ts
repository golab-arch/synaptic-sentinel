import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ColonyDb,
  FindingSchema,
  resolveColonyDbPath,
  type ScanOutcome,
} from '@synaptic-sentinel/core';
import { buildTomo, renderTomoJson } from '@synaptic-sentinel/reporters';

/**
 * Sub-comando `show` (DG-103 A).
 *
 * Reconstruye el tomo del scan mas reciente persistido en `colony.db`
 * SIN re-correr scanners ni el Brain Layer. Sirve para hidratar el
 * sidebar webview de la extension VSCode cuando el usuario reabre un
 * proyecto que ya tiene un scan/triage previo: en lugar de mostrar el
 * empty state "Run Scan Workspace to see findings here" se carga la
 * ultima corrida cacheada (findings + triage verdicts + context +
 * remediation) y se preserva el trabajo + cost LLM previos.
 *
 * Costo: 0 (no LLM, no scout binaries). Solo lectura de colony.db +
 * serializacion JSON.
 */

/** Opciones del comando `show`. */
export interface ShowCommandOptions {
  /** Directorio del proyecto cuyo `colony.db` se consulta. */
  readonly path: string;
  /** Path donde exportar el tomo JSON. Si no se provee, va a stdout. */
  readonly exportPath?: string;
}

/**
 * Version del producto que se incrusta en el tomo. Igual que scan.ts,
 * usa '0.0.0' como placeholder — la version real del binario no la
 * conocemos en runtime sin un build step adicional. La consume el
 * reporter HTML para mostrar la version, no afecta el parsing del
 * tomo en la extension.
 */
const SENTINEL_VERSION = '0.0.0';

export function runShowCommand(options: ShowCommandOptions): number {
  const projectRoot = resolve(options.path);
  // DG-093 A: dual-read del colony.db (preferencia .sentinel/, fallback al
  // legacy .synaptic-sentinel/).
  const dbResolution = resolveColonyDbPath(projectRoot);
  const dbPath = dbResolution.path;
  if (!existsSync(dbPath)) {
    console.error(
      `No colony.db in ${projectRoot}. Run "synaptic-sentinel scan" first to create one.`,
    );
    return 1;
  }
  if (dbResolution.isLegacy) {
    console.warn(
      `Using legacy .synaptic-sentinel/colony.db (pre-DG-093). Consider ` +
        `moving it to .sentinel/colony.db at your leisure.`,
    );
  }
  const db = ColonyDb.open(dbPath);
  try {
    const scanId = db.getLatestScanId();
    if (scanId === undefined) {
      console.error('colony.db has no scan yet. Run "synaptic-sentinel scan" first.');
      return 1;
    }
    const scan = db.getScan(scanId);
    if (scan === undefined) {
      // No deberia pasar dado que `getLatestScanId` lo devolvio, pero
      // defensa adicional: si la fila de scans se borro entre llamadas.
      console.error(`Scan ${scanId} not found in colony.db (race condition?).`);
      return 1;
    }
    const findings = db
      .getPheromonesByScan(scanId)
      .filter((p) => p.type === 'finding')
      .map((p) => FindingSchema.parse(p.payload));
    // Reconstruccion minima del ScanOutcome — la tabla scans NO persiste
    // el status ni el suppressedCount ni los scouts (solo el ScanOutcome
    // en memoria del Coordinator los tiene durante runScan). Para el tomo
    // exportado:
    //   - status: 'ok' por default (no tenemos modo de inferir 'degraded'
    //     sin re-correr los scouts; el caller del show NO esta validando
    //     status — solo necesita findings + enrichment).
    //   - findingsCount: se deriva de los findings reales leidos.
    //   - suppressedCount: 0 (no persistido; el reporter HTML lo muestra
    //     pero el extension webview lo ignora).
    //   - scouts: [] (idem).
    //   - startedAt / finishedAt: vienen del row scans.
    const outcome: ScanOutcome = {
      scanId,
      status: 'ok',
      findingsCount: findings.length,
      suppressedCount: 0,
      scouts: [],
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt ?? scan.startedAt,
    };
    // DG-130 A Sub-A2 (Cycle 116 FASE III): carga verdict_history +
    // computa scan diff para hidratar el sidebar "Previously" + banner
    // "Verdict changed" + summary card diff-aware line.
    const fingerprintsForHistory = findings.map((f) => f.fingerprint);
    const verdictHistoryByFingerprint = db.getVerdictHistoryByFingerprints(
      fingerprintsForHistory,
      5,
    );
    const diff = db.getVerdictDiffAgainstPrevious(fingerprintsForHistory);
    const anyDiffActivity =
      diff.newFindings.length > 0 || diff.reclassified.length > 0 || diff.unchanged.length > 0;
    // DG-132 A Sub-A2: breakdown de reclassified por reason.
    const reclassifiedByReason = {
      classChanged: diff.reclassified.filter((r) => r.reason === 'class-changed').length,
      confidenceDelta: diff.reclassified.filter((r) => r.reason === 'confidence-delta').length,
      providerChanged: diff.reclassified.filter((r) => r.reason === 'provider-changed').length,
    };
    const tomo = buildTomo(
      outcome,
      findings,
      { rootPath: projectRoot, sentinelVersion: SENTINEL_VERSION },
      {
        triageVerdicts: db.getTriageVerdicts(),
        contextExplanations: db.getContextExplanations(),
        remediationSuggestions: db.getRemediationSuggestions(),
        verdictHistoryByFingerprint,
        ...(anyDiffActivity
          ? {
              scanDiff: {
                newFindingsCount: diff.newFindings.length,
                reclassifiedCount: diff.reclassified.length,
                unchangedCount: diff.unchanged.length,
                reclassifiedByReason,
              },
            }
          : {}),
      },
    );
    if (options.exportPath !== undefined) {
      const target = resolve(options.exportPath);
      writeFileSync(target, renderTomoJson(tomo));
      console.log(`Tome exported (JSON): ${target}`);
    } else {
      // Sin --export: emite el JSON a stdout. Util para pipes en CLI;
      // la extension VSCode SIEMPRE usa --export con un temp file (la
      // misma estrategia de runCliScan, mas robusta cross-platform que
      // capturar stdout grande).
      console.log(renderTomoJson(tomo));
    }
    return 0;
  } finally {
    db.close();
  }
}
