import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ContextExplanationSchema,
  FindingGroupSchema,
  FindingSchema,
  RemediationSuggestionSchema,
  ScoutStatusSchema,
  TRIAGE_CLASSIFICATIONS,
  TriageVerdictSchema,
  computePriorityScore,
  groupFindingsByCorrelation,
  type ContextExplanationRecord,
  type Finding,
  type RemediationSuggestionRecord,
  type ScanOutcome,
  type TriageVerdictHistoryRecord,
  type TriageVerdictRecord,
} from '@synaptic-sentinel/core';

/** Metadata del tomo (v0.4 §4.2). */
const TomoMetadataSchema = z.object({
  tomoId: z.string().uuid(),
  /** Huella estable del proyecto del cliente — "biblioteca" (v0.4 §4.1). */
  bibliotecaId: z.string().min(1),
  sentinelVersion: z.string().min(1),
  publishedAt: z.string().datetime(),
  gitSha: z.string().min(1).optional(),
  scope: z.object({ rootPath: z.string().min(1) }),
});

/**
 * Diff-aware summary cross-scan (DG-130 A, FASE III Sub-A2). Compara los
 * veredictos ACTUALES contra los veredictos previos en `verdict_history`.
 * Solo se emite si hay al menos un finding con history (0 en primera-vez).
 */
const TomoScanDiffSchema = z.object({
  /** Fingerprints que aparecen por primera vez en history. */
  newFindingsCount: z.number().int().nonnegative(),
  /** Fingerprints cuyo classification cambió respecto al veredicto anterior. */
  reclassifiedCount: z.number().int().nonnegative(),
  /** Fingerprints con la misma classification cross-scan. */
  unchangedCount: z.number().int().nonnegative(),
});

/** Diff-aware summary del scan actual. */
export type TomoScanDiff = z.infer<typeof TomoScanDiffSchema>;

/**
 * Resumen ejecutivo determinista del tomo: conteos por severidad y categoria.
 * El `posture_score` y los deltas del v0.4 §4.2 los agrega el Brain Layer.
 */
const TomoSummarySchema = z.object({
  scanId: z.string().min(1),
  status: z.enum(['ok', 'degraded']),
  totalFindings: z.number().int().nonnegative(),
  /** Hallazgos descartados en stage 2 del Coordinator (dedup + fp_known). */
  suppressedCount: z.number().int().nonnegative(),
  bySeverity: z.record(z.number().int().nonnegative()),
  byCategory: z.record(z.number().int().nonnegative()),
  /** Conteo de hallazgos por clasificacion de triage (vacio si no hubo triage). */
  byTriage: z.record(z.number().int().nonnegative()),
  /**
   * DG-130 A (Sub-A2): diff cross-scan opcional. Presente solo si hay al
   * menos un finding con veredicto histórico cargado. Aditivo backward-compat:
   * tomos legacy sin este field siguen validando.
   */
  scanDiff: TomoScanDiffSchema.optional(),
});

/** Metodologia: scouts ejecutados y ventana temporal del scan. */
const TomoMethodologySchema = z.object({
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  scouts: z.array(
    z.object({
      scoutId: z.string().min(1),
      status: ScoutStatusSchema,
      findings: z.number().int().nonnegative(),
      error: z.string().min(1).optional(),
    }),
  ),
});

/**
 * Hallazgo del tomo: el `Finding` determinista mas el enriquecimiento del
 * Brain Layer — el veredicto de triage, la explicacion de contexto y la
 * sugerencia de remediacion, cada uno presente solo si el agente
 * correspondiente proceso el hallazgo.
 */
/**
 * Registro histórico de veredicto en la forma que consume el reporter/UI
 * (DG-130 A Sub-A2). Subset de {@link TriageVerdictHistoryRecord} con solo
 * los fields que el sidebar necesita renderar en la section "Previously".
 */
const TomoPreviousVerdictSchema = z.object({
  classification: z.enum(TRIAGE_CLASSIFICATIONS),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  providerLabel: z.string().min(1),
  createdAt: z.string().datetime(),
});

/** Veredicto previo (histórico) — subset render-only. */
export type TomoPreviousVerdict = z.infer<typeof TomoPreviousVerdictSchema>;

export const TomoFindingSchema = FindingSchema.extend({
  triage: TriageVerdictSchema.optional(),
  context: ContextExplanationSchema.optional(),
  remediation: RemediationSuggestionSchema.optional(),
  /**
   * DG-130 A Sub-A2: historia de veredictos previos ordenada DESC por
   * `createdAt` (el más reciente primero). El primer elemento (index 0) es
   * el veredicto ACTUAL (mismo que `triage`). El segundo (index 1) es el
   * PREVIO — usar para banner "Verdict changed since last scan". Presente
   * solo si el reporter cargó history. Aditivo backward-compat.
   */
  previouslyVerdicts: z.array(TomoPreviousVerdictSchema).optional(),
  /**
   * DG-131 A Sub-A2 (R20): id opaco del grupo triage. Presente si el finding
   * pertenece a un grupo triage-agregado (≥ 2 members compartiendo mismo
   * rule+package). Aditivo backward-compat.
   */
  groupId: z.string().min(1).optional(),
  /**
   * DG-131 A Sub-A2: `true` si este finding es el representative del grupo
   * (hizo la LLM call real). `false` si es un member propagado con confidence
   * downgrade. `undefined` para findings sin grupo. Aditivo backward-compat.
   */
  isGroupRepresentative: z.boolean().optional(),
});

/** Hallazgo del tomo (Finding + triage opcional). */
export type TomoFinding = z.infer<typeof TomoFindingSchema>;

/** Cuerpo del tomo: todo menos la firma de integridad. */
export const TomoBodySchema = z.object({
  metadata: TomoMetadataSchema,
  summary: TomoSummarySchema,
  findings: z.array(TomoFindingSchema),
  methodology: TomoMethodologySchema,
  /**
   * Grupos de findings SCA correlacionados por package family (DG-113 A
   * Step 4 — §4 #4 del SENTINEL-EVALUATION-REPORT). Cada grupo trae sus
   * findings hijos + remediation target unificado (MAX semver por major
   * track). Aditivo + backward-compatible: tomos legacy sin este field
   * siguen validando contra el schema.
   */
  groups: z.array(FindingGroupSchema).optional(),
});

/** Firma de integridad del tomo — SHA-256, en todos los tiers (v0.4 §4.2). */
const TomoIntegritySchema = z.object({
  algorithm: z.literal('sha256'),
  hash: z.string().length(64),
});

/** Tomo completo: una auditoria publicada (v0.4 §4.1). */
export const TomoSchema = TomoBodySchema.extend({ integrity: TomoIntegritySchema });

/** Cuerpo del tomo, sin la firma de integridad. */
export type TomoBody = z.infer<typeof TomoBodySchema>;

/** Tomo completo. */
export type Tomo = z.infer<typeof TomoSchema>;

/** Forma canonica de un valor: claves de objeto ordenadas recursivamente. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

/** Hash SHA-256 (hex) de la forma canonica de un valor — determinista. */
export function canonicalHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

/** Metadata de entrada para construir un tomo. */
export interface TomoMetadataInput {
  readonly rootPath: string;
  readonly sentinelVersion: string;
  readonly gitSha?: string;
}

/** Enriquecimiento del Brain Layer con que se construye el tomo. */
export interface TomoEnrichment {
  /** Veredictos de triage a unir con los hallazgos por `fingerprint`. */
  readonly triageVerdicts?: readonly TriageVerdictRecord[];
  /** Explicaciones de contexto a unir con los hallazgos por `fingerprint`. */
  readonly contextExplanations?: readonly ContextExplanationRecord[];
  /** Sugerencias de remediacion a unir con los hallazgos por `fingerprint`. */
  readonly remediationSuggestions?: readonly RemediationSuggestionRecord[];
  /**
   * DG-130 A Sub-A2: mapa `fingerprint → history DESC` con los últimos N
   * veredictos de la tabla `verdict_history`. Cuando presente, cada finding
   * emite `previouslyVerdicts` en el tomo (subset render-only). Aditivo.
   */
  readonly verdictHistoryByFingerprint?: ReadonlyMap<string, readonly TriageVerdictHistoryRecord[]>;
  /**
   * DG-130 A Sub-A2: diff-aware summary del scan actual vs previous triage.
   * Cuando presente, se emite en el summary del tomo como `scanDiff`.
   */
  readonly scanDiff?: TomoScanDiff;
}

/**
 * Construye un tomo a partir del resultado de un scan y sus hallazgos.
 *
 * Si se pasa `enrichment`, cada hallazgo se une por `fingerprint` con su
 * veredicto de triage y su explicacion de contexto (el registro mas reciente
 * gana). El resumen es determinista (conteos); incluye una firma SHA-256
 * sobre la forma canonica del cuerpo, como evidencia de no-manipulacion.
 */
export function buildTomo(
  outcome: ScanOutcome,
  findings: readonly Finding[],
  meta: TomoMetadataInput,
  enrichment: TomoEnrichment = {},
): Tomo {
  // Join por fingerprint (el registro mas reciente gana, orden de entrada).
  const triageByFingerprint = new Map<string, TriageVerdictRecord>();
  for (const verdict of enrichment.triageVerdicts ?? []) {
    triageByFingerprint.set(verdict.fingerprint, verdict);
  }
  const contextByFingerprint = new Map<string, ContextExplanationRecord>();
  for (const explanation of enrichment.contextExplanations ?? []) {
    contextByFingerprint.set(explanation.fingerprint, explanation);
  }
  const remediationByFingerprint = new Map<string, RemediationSuggestionRecord>();
  for (const suggestion of enrichment.remediationSuggestions ?? []) {
    remediationByFingerprint.set(suggestion.fingerprint, suggestion);
  }

  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byTriage: Record<string, number> = {};
  const tomoFindings = findings.map((finding) => {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
    byCategory[finding.category] = (byCategory[finding.category] ?? 0) + 1;
    const verdict = triageByFingerprint.get(finding.fingerprint);
    const explanation = contextByFingerprint.get(finding.fingerprint);
    const suggestion = remediationByFingerprint.get(finding.fingerprint);
    if (verdict !== undefined) {
      byTriage[verdict.classification] = (byTriage[verdict.classification] ?? 0) + 1;
    }
    // DG-118 A (Cycle 109): computa priorityScore deterministico desde
    // (severity, verdict.classification). Pure function — no side effects.
    // Si no hay verdict, classification = undefined → untriaged
    // pessimistic (severity directly mapped).
    const priorityScore = computePriorityScore(finding.severity, verdict?.classification);
    // DG-130 A Sub-A2: history subset render-only para el sidebar
    // "Previously (N prior verdicts)". El primer elemento del arreglo es el
    // veredicto ACTUAL (mismo que `triage`). El renderer del webview usa
    // index 1 para detectar cambios y emitir el banner "Verdict changed".
    const history = enrichment.verdictHistoryByFingerprint?.get(finding.fingerprint);
    const previouslyVerdicts = history?.map((h) => ({
      classification: h.classification,
      confidence: h.confidence,
      rationale: h.rationale,
      providerLabel: h.providerLabel,
      createdAt: h.createdAt,
    }));
    return {
      ...finding,
      priorityScore,
      ...(verdict !== undefined
        ? {
            triage: {
              classification: verdict.classification,
              confidence: verdict.confidence,
              rationale: verdict.rationale,
            },
          }
        : {}),
      ...(previouslyVerdicts !== undefined && previouslyVerdicts.length > 0
        ? { previouslyVerdicts }
        : {}),
      // DG-131 A Sub-A2 (R20): expone group metadata al tomo si el verdict
      // tiene groupId. El sidebar usa esto para renderear badge "[grouped]".
      ...(verdict?.groupId !== undefined ? { groupId: verdict.groupId } : {}),
      ...(verdict?.isGroupRepresentative !== undefined
        ? { isGroupRepresentative: verdict.isGroupRepresentative }
        : {}),
      ...(explanation !== undefined
        ? {
            context: {
              summary: explanation.summary,
              entryPoint: explanation.entryPoint,
              sink: explanation.sink,
              exposure: explanation.exposure,
            },
          }
        : {}),
      ...(suggestion !== undefined
        ? {
            remediation: {
              summary: suggestion.summary,
              recommendation: suggestion.recommendation,
              ...(suggestion.fixedSnippet !== undefined
                ? { fixedSnippet: suggestion.fixedSnippet }
                : {}),
            },
          }
        : {}),
    };
  });

  // DG-113 A Step 4: grupos SCA por package family (cross-lockfile +
  // intra-package). Solo emite el field si hay al menos 1 grupo (>= 1
  // finding SCA con sca metadata) — tomos sin SCA quedan sin `groups`.
  const groups = groupFindingsByCorrelation(findings);

  const body = TomoBodySchema.parse({
    metadata: {
      tomoId: randomUUID(),
      bibliotecaId: canonicalHash(meta.rootPath).slice(0, 16),
      sentinelVersion: meta.sentinelVersion,
      publishedAt: new Date().toISOString(),
      ...(meta.gitSha !== undefined ? { gitSha: meta.gitSha } : {}),
      scope: { rootPath: meta.rootPath },
    },
    summary: {
      scanId: outcome.scanId,
      status: outcome.status,
      totalFindings: findings.length,
      suppressedCount: outcome.suppressedCount,
      bySeverity,
      byCategory,
      byTriage,
      ...(enrichment.scanDiff !== undefined ? { scanDiff: enrichment.scanDiff } : {}),
    },
    findings: tomoFindings,
    methodology: {
      startedAt: outcome.startedAt,
      finishedAt: outcome.finishedAt,
      scouts: outcome.scouts.map((scout) => ({
        scoutId: scout.scoutId,
        status: scout.status,
        findings: scout.findings,
        ...(scout.error !== undefined ? { error: scout.error } : {}),
      })),
    },
    ...(groups.length > 0 ? { groups } : {}),
  });

  return TomoSchema.parse({
    ...body,
    integrity: { algorithm: 'sha256', hash: canonicalHash(body) },
  });
}

/** Verifica que la firma de integridad del tomo coincida con su contenido. */
export function verifyTomoIntegrity(tomo: Tomo): boolean {
  const { integrity, ...body } = tomo;
  return integrity.hash === canonicalHash(body);
}
