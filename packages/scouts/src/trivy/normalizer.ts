import { randomUUID } from 'node:crypto';
import { FindingSchema, type Finding, type Severity } from '@synaptic-sentinel/core';
import { relativizePath } from '../opengrep/normalizer.js';
import type { TrivyOutput } from './trivy-output.js';

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
          ? `; corregido en ${vuln.FixedVersion}`
          : '; sin version corregida disponible';
      // El VulnerabilityID (CVE/GHSA) y los CWE son referencias de cumplimiento.
      const complianceRefs = [...new Set([vuln.VulnerabilityID, ...(vuln.CweIDs ?? [])])];
      const finding = {
        id: newId(),
        scanId: ctx.scanId,
        scoutId: ctx.scoutId,
        severity: SEVERITY_BY_TRIVY[vuln.Severity.toUpperCase()] ?? 'info',
        category: 'SCA',
        ruleId: vuln.VulnerabilityID,
        title: vuln.Title ?? `${vuln.PkgName}: ${vuln.VulnerabilityID}`,
        message:
          `${vuln.PkgName} ${vuln.InstalledVersion} es vulnerable ` +
          `(${vuln.VulnerabilityID})${fixed}.`,
        location: { path: target, startLine: 1 },
        complianceRefs,
        fingerprint: `${target}:${vuln.PkgName}:${vuln.VulnerabilityID}`,
        lifecycleState: 'new',
        createdAt: now(),
      };
      findings.push(FindingSchema.parse(finding));
    }
  }
  return findings;
}
