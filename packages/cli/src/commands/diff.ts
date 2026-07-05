import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ColonyDb, FindingSchema, resolveColonyDbPath } from '@synaptic-sentinel/core';

/**
 * DG-132 A Sub-A2 (Cycle 118 FASE III R22): CLI comando `diff` — export
 * structured JSON del scan diff vs previous triage. Contrato claro para
 * CI/CD tooling downstream (parse without regex, feed a dashboards,
 * gate en shells).
 *
 * Semantics: read-only. Consulta el colony.db existente y compara veredicto
 * ACTUAL (más reciente en verdict_history) vs PREVIO por fingerprint. NO
 * re-triage, NO nuevas insertions.
 *
 * Output shape (JSON to stdout):
 * ```
 * {
 *   "scanId": "<current-scan-id>",
 *   "summary": { "newFindings": N, "reclassified": M, "unchanged": K },
 *   "reclassifiedByReason": { "classChanged": X, "confidenceDelta": Y, "providerChanged": Z },
 *   "newFindings": [{ "fingerprint", "ruleId", "severity", "location" }],
 *   "reclassified": [{ "fingerprint", "ruleId", "severity", "location", "reason",
 *                      "from", "to", "confidenceDelta", "fromConfidence", "toConfidence",
 *                      "fromProvider", "toProvider" }],
 *   "unchanged": [{ "fingerprint", "ruleId", "severity", "location" }]
 * }
 * ```
 */

export interface DiffCommandOptions {
  /** Directorio del proyecto cuyo `colony.db` se consulta. */
  readonly path: string;
  /**
   * Threshold para reclasificacion por confidence delta (default 0.15,
   * matching DG-130 A banner heuristic).
   */
  readonly confidenceDeltaThreshold?: number;
}

/**
 * Ejecuta el comando `diff` y emite JSON a stdout.
 * @returns exit code (0 OK, 1 error).
 */
export function runDiffCommand(options: DiffCommandOptions): number {
  const projectRoot = resolve(options.path);
  const dbResolution = resolveColonyDbPath(projectRoot);
  const dbPath = dbResolution.path;
  if (!existsSync(dbPath)) {
    console.error(
      `No colony.db in ${projectRoot}. Run "synaptic-sentinel scan" first to create one.`,
    );
    return 1;
  }
  const db = ColonyDb.open(dbPath);
  try {
    const scanId = db.getLatestScanId();
    if (scanId === undefined) {
      console.error('colony.db has no scan yet. Run "synaptic-sentinel scan" first.');
      return 1;
    }
    const findings = db
      .getPheromonesByScan(scanId)
      .filter((p) => p.type === 'finding')
      .map((p) => FindingSchema.parse(p.payload));
    const findingsByFp = new Map(findings.map((f) => [f.fingerprint, f]));
    const fingerprints = findings.map((f) => f.fingerprint);
    const diff = db.getVerdictDiffAgainstPrevious(fingerprints, {
      ...(options.confidenceDeltaThreshold !== undefined
        ? { confidenceDeltaThreshold: options.confidenceDeltaThreshold }
        : {}),
    });
    const findingSubset = (fp: string): Record<string, unknown> | undefined => {
      const f = findingsByFp.get(fp);
      if (f === undefined) return undefined;
      return {
        fingerprint: f.fingerprint,
        ruleId: f.ruleId,
        severity: f.severity,
        location: f.location,
        title: f.title,
      };
    };
    const output = {
      scanId,
      summary: {
        newFindings: diff.newFindings.length,
        reclassified: diff.reclassified.length,
        unchanged: diff.unchanged.length,
      },
      reclassifiedByReason: {
        classChanged: diff.reclassified.filter((r) => r.reason === 'class-changed').length,
        confidenceDelta: diff.reclassified.filter((r) => r.reason === 'confidence-delta').length,
        providerChanged: diff.reclassified.filter((r) => r.reason === 'provider-changed').length,
      },
      newFindings: diff.newFindings.map((fp) => findingSubset(fp)).filter((x) => x !== undefined),
      reclassified: diff.reclassified.map((r) => ({
        ...findingSubset(r.fingerprint),
        reason: r.reason,
        from: r.from,
        to: r.to,
        confidenceDelta: r.confidenceDelta,
        fromConfidence: r.fromConfidence,
        toConfidence: r.toConfidence,
        fromProvider: r.fromProvider,
        toProvider: r.toProvider,
      })),
      unchanged: diff.unchanged.map((fp) => findingSubset(fp)).filter((x) => x !== undefined),
    };
    console.log(JSON.stringify(output, null, 2));
    return 0;
  } finally {
    db.close();
  }
}
