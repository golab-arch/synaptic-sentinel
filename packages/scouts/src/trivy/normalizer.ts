import { randomUUID } from 'node:crypto';
import {
  FindingSchema,
  type Finding,
  type ScaMetadata,
  type Severity,
} from '@synaptic-sentinel/core';
import { relativizePath } from '../opengrep/normalizer.js';
import type { TrivyOutput } from './trivy-output.js';

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
    for (const vuln of result.Vulnerabilities ?? []) {
      const fixed =
        vuln.FixedVersion !== undefined && vuln.FixedVersion !== ''
          ? `; fixed in ${vuln.FixedVersion}`
          : '; no fixed version available';
      // El VulnerabilityID (CVE/GHSA) y los CWE son referencias de cumplimiento.
      const complianceRefs = [...new Set([vuln.VulnerabilityID, ...(vuln.CweIDs ?? [])])];
      // DG-113 A Step 4: SCA metadata estructurada para el grouping por
      // package family + remediation MAX semver.
      const sca: ScaMetadata = {
        packageName: vuln.PkgName,
        installedVersion: vuln.InstalledVersion,
        fixVersions: parseTrivyFixedVersion(vuln.FixedVersion),
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
