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
/**
 * Override directive recomendada para SCA findings transitive nested-pinned
 * (DG-115 A Step 5 — §4 #15 'prismjs misleading remediation').
 *
 * Cuando un finding SCA tiene `dependencyContext.directness === 'indirect'`,
 * un bump top-level puede NO resolver la vulnerabilidad porque la copia
 * vulnerable esta pineada por un parent transitive (caso prismjs: 1.27.0
 * nested bajo `refractor@3.6.0 ~1.27.0` aunque `prismjs` 1.30.0 ya este
 * top-level). El override directive fuerza la version fija via
 * `package.json` overrides (npm) / `resolutions` (yarn) / `pnpm.overrides`.
 */
export const OverrideDirectiveSchema = z.object({
  /** Package manager del lockfile target. */
  manager: z.enum(['npm', 'yarn', 'pnpm']),
  /** Nombre del package a overridear. */
  packageName: z.string().min(1),
  /**
   * Constraint semver (e.g. `^1.30.0`). Se computa como `^<recommendedFix>`
   * de la track del installedVersion del primer finding indirect del grupo.
   */
  versionRange: z.string().min(1),
  /**
   * JSON snippet listo para copiar/pegar en `package.json`. Forma amplia
   * (no scoped al pinner) — DG-115 A v1 explicit decision.
   */
  snippet: z.string().min(1),
  /**
   * `true` si existe otra copia del mismo `packageName` con version >= fix
   * en el lockfile. Determina caveat **FUERTE** ("bump top-level WILL NOT
   * fix") vs **SUAVE** ("plain update may suffice").
   */
  hasSiblingFixedCopy: z.boolean(),
  /**
   * IDs `name@version` de los parents que pinean copias vulnerables.
   * Citados en el risk caveat (e.g. `["refractor@3.6.0"]`). Dedupeado.
   */
  pinnedBy: z.array(z.string().min(1)).default([]),
});

/** Override directive de un FindingGroup. */
export type OverrideDirective = z.infer<typeof OverrideDirectiveSchema>;

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
  /**
   * Override directive (DG-115 A Step 5). Se emite cuando el grupo tiene
   * al menos un finding con `directness: 'indirect'` y hay al menos una
   * fix version conocida. Opcional — si no hay info de directness o
   * package manager, queda `undefined` y el sidebar no renderea el bloque.
   */
  overrideDirective: OverrideDirectiveSchema.optional(),
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
 *
 * DG-113.1 A — Filter downgrade tracks (§4 #4 lever #6/#11 'discard
 * downgrades'): si se proporciona `installedVersions`, los major tracks
 * por debajo del MIN(installed majors) del grupo se filtran como
 * downgrades. Trigger empirico: fast-xml-parser instalado 5.5.6 con fix
 * set {4.5.5, 5.7.0} → output naive `{4:'4.5.5', 5:'5.7.0'}` recomendaba
 * downgrade a 4.5.5 (rompe codigo del usuario). Filter scope-controlled:
 * solo aplica si installedVersions no vacio Y al menos una version
 * parseable; backward compat (sin segundo arg el filter no aplica).
 */
export function computeRemediationTarget(
  fixVersionArrays: readonly (readonly string[])[],
  installedVersions: readonly string[] = [],
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

  // DG-113.1 A: filter downgrade tracks. Compute MIN installed major; any
  // track BELOW that is a downgrade for at least one member of the group.
  // MIN (no MAX) es la decision safer: no eliminamos tracks que sirven al
  // miembro de menor major instalado. E.g. grupo con installs [4.x, 5.x]:
  // track 4 se preserva (sirve al user en 4.x); track 3 se filtra
  // (downgrade para ambos).
  if (installedVersions.length > 0) {
    const installedMajors = installedVersions
      .map((v) => semver.coerce(v))
      .filter((c): c is semver.SemVer => c !== null)
      .map((c) => c.major);
    if (installedMajors.length > 0) {
      const minInstalledMajor = Math.min(...installedMajors);
      for (const track of [...maxByTrack.keys()]) {
        if (Number(track) < minInstalledMajor) {
          maxByTrack.delete(track);
        }
      }
    }
  }

  if (maxByTrack.size === 0) {
    return {
      recommendedFixes: {},
      display: 'no upgrade path available (all known fixes are downgrades)',
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
 * Construye el snippet JSON listo para copiar/pegar en `package.json`
 * segun el package manager (DG-115 A Step 5). v1: forma amplia
 * (`overrides`/`resolutions` top-level), no scoped al parent pinner.
 *
 * - npm: `"overrides": { "<pkg>": "<range>" }`
 * - yarn: `"resolutions": { "<pkg>": "<range>" }`
 * - pnpm: `"pnpm": { "overrides": { "<pkg>": "<range>" } }`
 */
export function buildOverrideSnippet(
  manager: 'npm' | 'yarn' | 'pnpm',
  packageName: string,
  versionRange: string,
): string {
  if (manager === 'npm') {
    return `"overrides": {\n  "${packageName}": "${versionRange}"\n}`;
  }
  if (manager === 'yarn') {
    return `"resolutions": {\n  "${packageName}": "${versionRange}"\n}`;
  }
  return `"pnpm": {\n  "overrides": {\n    "${packageName}": "${versionRange}"\n  }\n}`;
}

/**
 * Computa el override directive de un FindingGroup (DG-115 A Step 5).
 *
 * Trigger: al menos un finding del grupo tiene
 * `sca.dependencyContext.directness === 'indirect'`. Decision deliberada
 * (G7 del plan, ajuste del usuario): emitir SIEMPRE que haya indirect
 * (over-approximation segura — el caveat se gradua con `hasSiblingFixedCopy`).
 *
 * Inputs derivados del grupo:
 * - `manager`: primer `sca.packageManager` del grupo que matchee `npm`/
 *   `yarn`/`pnpm`. Si ninguno, devuelve `undefined`.
 * - `packageName`: del primer finding indirect.
 * - `versionRange`: `^<recommendedFix>` donde `recommendedFix` es el max
 *   semver de la track del installedVersion del primer finding indirect.
 * - `hasSiblingFixedCopy`: OR sobre todos los findings indirect.
 * - `pinnedBy`: union deduped de todos los `pinnedBy` indirect.
 */
function computeOverrideDirective(
  findings: readonly Finding[],
  remediation: RemediationTarget,
): OverrideDirective | undefined {
  const indirectFindings = findings.filter(
    (f) => f.sca?.dependencyContext?.directness === 'indirect',
  );
  if (indirectFindings.length === 0) return undefined;
  if (remediation.noFixAvailable) return undefined;

  const managerRaw = findings.map((f) => f.sca?.packageManager).find((m) => m !== undefined);
  if (managerRaw !== 'npm' && managerRaw !== 'yarn' && managerRaw !== 'pnpm') return undefined;

  const firstIndirect = indirectFindings[0];
  if (firstIndirect === undefined || firstIndirect.sca === undefined) return undefined;
  const packageName = firstIndirect.sca.packageName;
  const installedCoerced = semver.coerce(firstIndirect.sca.installedVersion);
  const installedMajor = installedCoerced !== null ? String(installedCoerced.major) : undefined;
  const fixForTrack =
    installedMajor !== undefined ? remediation.recommendedFixes[installedMajor] : undefined;
  const fix = fixForTrack ?? Object.values(remediation.recommendedFixes)[0];
  if (fix === undefined) return undefined;
  const versionRange = `^${fix}`;

  const hasSiblingFixedCopy = indirectFindings.some(
    (f) => f.sca?.dependencyContext?.hasSiblingFixedCopy === true,
  );
  const pinnedBy = [
    ...new Set(indirectFindings.flatMap((f) => f.sca?.dependencyContext?.pinnedBy ?? [])),
  ];

  return {
    manager: managerRaw,
    packageName,
    versionRange,
    snippet: buildOverrideSnippet(managerRaw, packageName, versionRange),
    hasSiblingFixedCopy,
    pinnedBy,
  };
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
    // DG-113.1 A: pasar installedVersions para filter downgrade tracks.
    const installedVersions = groupFindings
      .map((f) => f.sca?.installedVersion ?? '')
      .filter((v) => v !== '');
    const remediationBase = computeRemediationTarget(fixVersionArrays, installedVersions);
    // DG-115 A Step 5: enriquece con override directive cuando hay indirect.
    const overrideDirective = computeOverrideDirective(groupFindings, remediationBase);
    const remediation: RemediationTarget =
      overrideDirective !== undefined ? { ...remediationBase, overrideDirective } : remediationBase;
    groups.push({ familyKey, findings: groupFindings, remediation });
  }

  groups.sort((a, b) => {
    const sizeDiff = b.findings.length - a.findings.length;
    if (sizeDiff !== 0) return sizeDiff;
    return a.familyKey.localeCompare(b.familyKey);
  });

  return groups;
}
