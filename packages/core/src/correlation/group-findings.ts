import semver from 'semver';
import { z } from 'zod';
import { FindingSchema, type Finding } from '../types/finding.js';

/**
 * Remediation target derivado del MAX semver por major track de un grupo
 * de findings SCA (DG-113 A Step 4 — §4 #4 del SENTINEL-EVALUATION-REPORT).
 *
 * Heterogeneidad: si los fix versions del grupo cruzan multiple major
 * tracks (e.g. fixes en `7.5.6` y `8.0.2`), el target lista un MAX por
 * track. Caso real del reporte: protobufjs CVE-2026-45740 necesita
 * `7.5.8`, otros CVEs `7.5.6` — el MAX es `7.5.8` para la track v7. Un
 * naive bump a `7.5.6` deja CVE-2026-45740 abierto.
 */
export const RemediationTargetSchema = z.object({
  /**
   * Mapeo majorTrack → max semver de esa track.
   * E.g. `{ "7": "7.5.8", "8": "8.2.0" }`.
   */
  recommendedFixes: z.record(z.string(), z.string()),
  /**
   * Display string del target (las versions de cada major track unidas con `/`).
   * E.g. `"7.5.8 / 8.2.0"`.
   */
  display: z.string(),
  /**
   * `true` si el fix set cruza multiple major tracks — flag de UI para
   * mostrar nota sobre heterogeneidad.
   */
  heterogeneous: z.boolean(),
  /** `true` si NO hay fix version conocida en ninguno de los findings del grupo. */
  noFixAvailable: z.boolean(),
});

/** Remediation target de un FindingGroup. */
export type RemediationTarget = z.infer<typeof RemediationTargetSchema>;

/**
 * Grupo de findings SCA correlacionados por package family (DG-113 A Step 4).
 *
 * Para Step 4, la family key es el **nombre exacto del package** — captura
 * cross-lockfile (mismo pkg en root + web) + intra-package (mismo pkg con
 * N CVEs distintos). Parent/child resolution real (`@protobufjs/utf8` ↔
 * `protobufjs`) requiere dep graph y queda diferida al sub-DG
 * `DG-future-SCA-dep-graph`.
 *
 * El grouping es UI/output puro: NO toca el contrato del Brain Layer ni
 * el dedup del Coordinator stage 2. Cada finding hijo del grupo sigue
 * triagandose individualmente.
 */
export const FindingGroupSchema = z.object({
  /** Family key del grupo. En Step 4: exact package name. */
  familyKey: z.string().min(1),
  /** Findings hijos del grupo (todos category SCA con sca metadata). */
  findings: z.array(FindingSchema),
  /** Remediation target unificado del grupo (MAX semver por major track). */
  remediation: RemediationTargetSchema,
});

/** Grupo de findings correlacionados. */
export type FindingGroup = z.infer<typeof FindingGroupSchema>;

/**
 * Family key heuristic para Step 4 (DG-113 A): EXACT package name match.
 *
 * Decision deliberada (G2 del plan, ajuste del usuario): NO hacer
 * scope-stripping `@<X>/Y → X` porque over-mergea casos legitimos como
 * `@types/node + @types/lodash` en una "types family" con UNA remediacion =
 * grupo falso, peor que no agrupar. Para Step 4 el agrupamiento es por
 * nombre exacto — captura ~11 de los ~13 findings de protobufjs reportados
 * (cross-lockfile + intra-package). Parent/child real
 * (`@protobufjs/utf8 ↔ protobufjs`) queda diferida al
 * `DG-future-SCA-dep-graph` donde el dep graph lo resuelve correctamente.
 */
export function packageFamilyKey(packageName: string): string {
  return packageName;
}

/**
 * Calcula el remediation target de un grupo: MAX semver por major track de
 * TODAS las fix versions conocidas del grupo. Usa la library `semver` para
 * handling robusto de pre-release, build metadata, ranges.
 *
 * Casos:
 * - Grupo con 0 fix versions conocidas → `noFixAvailable: true`.
 * - Versions que `semver.coerce` no puede parsear (e.g. `"latest"`) se
 *   descartan; si TODAS son inparseables, `noFixAvailable: true`.
 * - 1 major track → `heterogeneous: false`, display = `"X.Y.Z"`.
 * - Multiple major tracks → `heterogeneous: true`, display =
 *   `"X.Y.Z / W.V.U"` (sorted por major asc).
 */
export function computeRemediationTarget(
  fixVersionArrays: readonly (readonly string[])[],
): RemediationTarget {
  const allFixVersions = fixVersionArrays.flat();
  if (allFixVersions.length === 0) {
    return {
      recommendedFixes: {},
      display: 'no fix available',
      heterogeneous: false,
      noFixAvailable: true,
    };
  }

  const maxByTrack = new Map<string, string>();
  for (const version of allFixVersions) {
    const coerced = semver.coerce(version);
    if (coerced === null) continue;
    const major = String(coerced.major);
    const currentMax = maxByTrack.get(major);
    if (currentMax === undefined || semver.gt(coerced, currentMax)) {
      maxByTrack.set(major, coerced.version);
    }
  }

  if (maxByTrack.size === 0) {
    return {
      recommendedFixes: {},
      display: 'fix versions could not be parsed',
      heterogeneous: false,
      noFixAvailable: true,
    };
  }

  const tracksSorted = [...maxByTrack.keys()].sort((a, b) => Number(a) - Number(b));
  const recommendedFixes: Record<string, string> = {};
  for (const track of tracksSorted) {
    const v = maxByTrack.get(track);
    if (v !== undefined) recommendedFixes[track] = v;
  }
  const display = tracksSorted
    .map((track) => recommendedFixes[track] ?? '')
    .filter((v) => v !== '')
    .join(' / ');
  const heterogeneous = maxByTrack.size > 1;

  return { recommendedFixes, display, heterogeneous, noFixAvailable: false };
}

/**
 * Agrupa findings SCA por package family (DG-113 A Step 4 — §4 #4).
 *
 * Reglas:
 * - Solo agrupa findings con `category: 'SCA'` y `sca` metadata populada.
 * - Family key = `packageFamilyKey(sca.packageName)` = exact match en Step 4.
 * - Cada grupo trae `remediation` unificado via `computeRemediationTarget`.
 * - Grupos ordenados: mas findings primero (mas accionable), tiebreaker
 *   alfabetico por `familyKey`.
 *
 * Findings sin `sca` metadata o de category != 'SCA' NO se incluyen en
 * grupos — quedan sueltos en el tomo. El grouping es UI/output puro.
 */
export function groupFindingsByCorrelation(findings: readonly Finding[]): FindingGroup[] {
  const groupsByKey = new Map<string, Finding[]>();

  for (const finding of findings) {
    if (finding.category !== 'SCA') continue;
    if (finding.sca === undefined) continue;
    const key = packageFamilyKey(finding.sca.packageName);
    const existing = groupsByKey.get(key);
    if (existing !== undefined) existing.push(finding);
    else groupsByKey.set(key, [finding]);
  }

  const groups: FindingGroup[] = [];
  for (const [familyKey, groupFindings] of groupsByKey.entries()) {
    const fixVersionArrays = groupFindings.map((f) => f.sca?.fixVersions ?? []);
    const remediation = computeRemediationTarget(fixVersionArrays);
    groups.push({ familyKey, findings: groupFindings, remediation });
  }

  groups.sort((a, b) => {
    const sizeDiff = b.findings.length - a.findings.length;
    if (sizeDiff !== 0) return sizeDiff;
    return a.familyKey.localeCompare(b.familyKey);
  });

  return groups;
}
