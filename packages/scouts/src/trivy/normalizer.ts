import { randomUUID } from 'node:crypto';
import semver from 'semver';
import {
  FindingSchema,
  type DependencyContext,
  type Finding,
  type ScaMetadata,
  type Severity,
} from '@synaptic-sentinel/core';
import { relativizePath } from '../opengrep/normalizer.js';
import type { TrivyOutput, TrivyPackage } from './trivy-output.js';

/**
 * Indices de packages del lockfile (DG-115 A Step 5 — §4 #15) para resolver
 * `dependencyContext` en O(1) durante el normalizer. Se construye una vez
 * por `Result` (un lockfile) — los lookups son por UID, por PkgID, y por
 * Name.
 */
interface PackageIndex {
  /** Match 1:1 vuln↔Package via Trivy UID (preciso para copias duplicadas). */
  readonly byUid: ReadonlyMap<string, TrivyPackage>;
  /** Fallback: match por ID (`name@version`) cuando el UID no esta presente. */
  readonly byId: ReadonlyMap<string, TrivyPackage>;
  /**
   * Todas las copias por package `Name` — usado para detectar
   * `hasSiblingFixedCopy` (existe otra copia con version >= fix?).
   */
  readonly byName: ReadonlyMap<string, readonly TrivyPackage[]>;
  /**
   * Reverse-index del grafo de deps: `packageId → list de packages que
   * lo incluyen en su DependsOn`. Sirve para popular `pinnedBy` del
   * `dependencyContext`.
   */
  readonly parentsByDep: ReadonlyMap<string, readonly string[]>;
}

/** Construye el indice de packages a partir de `Result.Packages[]` (DG-115 A). */
function buildPackageIndex(packages: readonly TrivyPackage[]): PackageIndex {
  const byUid = new Map<string, TrivyPackage>();
  const byId = new Map<string, TrivyPackage>();
  const byName = new Map<string, TrivyPackage[]>();
  const parentsByDep = new Map<string, string[]>();
  for (const pkg of packages) {
    const uid = pkg.Identifier?.UID;
    if (uid !== undefined && uid !== '') byUid.set(uid, pkg);
    if (pkg.ID !== undefined && pkg.ID !== '') byId.set(pkg.ID, pkg);
    if (pkg.Name !== undefined && pkg.Name !== '') {
      const list = byName.get(pkg.Name) ?? [];
      list.push(pkg);
      byName.set(pkg.Name, list);
    }
    // Reverse-edges del grafo: por cada dep en DependsOn, este package
    // es uno de sus parents.
    for (const depId of pkg.DependsOn ?? []) {
      if (pkg.ID === undefined || pkg.ID === '') continue;
      const parents = parentsByDep.get(depId) ?? [];
      parents.push(pkg.ID);
      parentsByDep.set(depId, parents);
    }
  }
  return { byUid, byId, byName, parentsByDep };
}

/**
 * Calcula el `dependencyContext` de una vulnerabilidad (DG-115 A Step 5).
 *
 * Estrategia:
 * 1. Match vuln↔Package via `PkgIdentifier.UID` (preciso para copias
 *    duplicadas). Fallback a `PkgID` si el UID no esta presente.
 * 2. `directness`: del campo `Relationship` del Package (`direct` |
 *    `indirect` | `root`) o `unknown` si no esta.
 * 3. `pinnedBy`: del `parentsByDep` indexado — los packages que tienen
 *    este `Package.ID` en su `DependsOn`.
 * 4. `hasSiblingFixedCopy`: si existe otra copia del mismo `Name` con
 *    `Version >= fixVersions[0]` (la primera fix conocida). Usa
 *    `semver.coerce` + `semver.gte` para robustez.
 *
 * Si no hay info suficiente (Trivy no expone `Packages` o no hay match),
 * devuelve `undefined` — el caller hace degrade gracefully (no emite
 * override directive).
 */
function computeDependencyContext(
  vuln: {
    PkgID?: string | undefined;
    PkgIdentifier?: { UID?: string | undefined } | undefined;
    PkgName: string;
  },
  fixVersions: readonly string[],
  index: PackageIndex,
): DependencyContext | undefined {
  const uid = vuln.PkgIdentifier?.UID;
  let pkg: TrivyPackage | undefined;
  if (uid !== undefined && uid !== '') pkg = index.byUid.get(uid);
  if (pkg === undefined && vuln.PkgID !== undefined && vuln.PkgID !== '') {
    pkg = index.byId.get(vuln.PkgID);
  }
  if (pkg === undefined) return undefined;

  const directnessRaw = pkg.Relationship;
  const directness: DependencyContext['directness'] =
    directnessRaw === 'direct' || directnessRaw === 'indirect' || directnessRaw === 'root'
      ? directnessRaw
      : 'unknown';

  const pinnedBy = pkg.ID !== undefined ? (index.parentsByDep.get(pkg.ID) ?? []) : [];

  // hasSiblingFixedCopy: hay otra copia del mismo Name con version >= fix?
  let hasSiblingFixedCopy = false;
  if (fixVersions.length > 0) {
    const allCopies = index.byName.get(vuln.PkgName) ?? [];
    const fixCoerced = semver.coerce(fixVersions[0]);
    if (fixCoerced !== null) {
      for (const copy of allCopies) {
        if (copy.Identifier?.UID === uid) continue; // skip self
        if (copy.Version === undefined) continue;
        const copyCoerced = semver.coerce(copy.Version);
        if (copyCoerced === null) continue;
        if (semver.gte(copyCoerced, fixCoerced)) {
          hasSiblingFixedCopy = true;
          break;
        }
      }
    }
  }

  return {
    directness,
    pinnedBy: [...new Set(pinnedBy)],
    hasSiblingFixedCopy,
  };
}

/**
 * Parsea el campo `FixedVersion` de Trivy a una lista de versions.
 * Trivy a veces emite comma-separated (e.g. `"7.5.6, 8.0.2"`), a veces
 * single (`"7.5.6"`), a veces vacio o undefined. DG-113 A Step 4: la
 * lista se usa para computar el remediation MAX semver por major track
 * del FindingGroup.
 */
export function parseTrivyFixedVersion(raw: string | undefined): string[] {
  if (raw === undefined || raw === '') return [];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** Contexto necesario para normalizar la salida de Trivy a `Finding[]`. */
export interface TrivyNormalizeContext {
  /** Scan al que pertenecen los hallazgos. */
  readonly scanId: string;
  /** Identificador del scout (`trivy`). */
  readonly scoutId: string;
  /** Raiz del proyecto, para relativizar las rutas. */
  readonly rootPath: string;
  /** Generador de marca temporal (inyectable para tests deterministas). */
  readonly now?: () => string;
  /** Generador de IDs (inyectable para tests deterministas). */
  readonly newId?: () => string;
}

/** Severidad de Trivy (UPPERCASE) → severidad de Sentinel. */
const SEVERITY_BY_TRIVY: Readonly<Record<string, Severity>> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  UNKNOWN: 'info',
};

/**
 * Normaliza la salida de Trivy a la lista canonica de `Finding`.
 *
 * Cada vulnerabilidad de dependencia se mapea a un `Finding` de categoria
 * `SCA`. La discriminacion fina (TP/FP, criticidad real en este proyecto) la
 * afina el Brain Layer.
 */
export function normalizeTrivyOutput(output: TrivyOutput, ctx: TrivyNormalizeContext): Finding[] {
  const now = ctx.now ?? ((): string => new Date().toISOString());
  const newId = ctx.newId ?? ((): string => randomUUID());
  const findings: Finding[] = [];

  for (const result of output.Results ?? []) {
    const target = relativizePath(result.Target, ctx.rootPath);
    // DG-115 A Step 5: indice de packages del lockfile (1 por Result).
    // Si Trivy no expone `Packages`, el indice queda vacio y
    // `computeDependencyContext` devuelve undefined → degrada gracefully.
    const packageIndex = buildPackageIndex(result.Packages ?? []);
    for (const vuln of result.Vulnerabilities ?? []) {
      const fixed =
        vuln.FixedVersion !== undefined && vuln.FixedVersion !== ''
          ? `; fixed in ${vuln.FixedVersion}`
          : '; no fixed version available';
      // El VulnerabilityID (CVE/GHSA) y los CWE son referencias de cumplimiento.
      const complianceRefs = [...new Set([vuln.VulnerabilityID, ...(vuln.CweIDs ?? [])])];
      // DG-113 A Step 4: SCA metadata estructurada para el grouping por
      // package family + remediation MAX semver.
      // DG-115 A Step 5: extiende con packageManager (Result.Type) +
      // dependencyContext (directness/pinnedBy/hasSiblingFixedCopy)
      // para detectar el caso prismjs (nested-pineada bajo refractor).
      const fixVersions = parseTrivyFixedVersion(vuln.FixedVersion);
      const dependencyContext = computeDependencyContext(vuln, fixVersions, packageIndex);
      const sca: ScaMetadata = {
        packageName: vuln.PkgName,
        installedVersion: vuln.InstalledVersion,
        fixVersions,
        ...(result.Type !== undefined && result.Type !== '' ? { packageManager: result.Type } : {}),
        ...(dependencyContext !== undefined ? { dependencyContext } : {}),
      };
      const finding = {
        id: newId(),
        scanId: ctx.scanId,
        scoutId: ctx.scoutId,
        severity: SEVERITY_BY_TRIVY[vuln.Severity.toUpperCase()] ?? 'info',
        category: 'SCA',
        ruleId: vuln.VulnerabilityID,
        title: vuln.Title ?? `${vuln.PkgName}: ${vuln.VulnerabilityID}`,
        message:
          `${vuln.PkgName} ${vuln.InstalledVersion} is vulnerable ` +
          `(${vuln.VulnerabilityID})${fixed}.`,
        location: { path: target, startLine: 1 },
        complianceRefs,
        fingerprint: `${target}:${vuln.PkgName}:${vuln.VulnerabilityID}`,
        lifecycleState: 'new',
        createdAt: now(),
        sca,
      };
      findings.push(FindingSchema.parse(finding));
    }
  }
  return findings;
}
