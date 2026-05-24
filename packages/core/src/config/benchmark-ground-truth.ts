import { z } from 'zod';

/**
 * Schema y carga del dataset de ground truth para el benchmark empirico
 * cross-provider (Phase 11 DG-075 C → consumido por DG-076).
 *
 * El dataset documenta QUE RESULTADO se ESPERA del Brain Layer para cada
 * finding generado por los fixtures vulnerables. DG-076 va a correr los
 * 3 agentes (Triage / Context / Remediation) contra N providers sobre
 * estos fixtures + comparar la salida real contra el ground truth para
 * calcular metricas objetivas (JSON validity rate, classification
 * accuracy, keyword presence en summary/remediation, etc.).
 *
 * **Caveat de autoridad**: este dataset arranca como un BORRADOR AI
 * (Claude) basado en lectura de los fixtures + el ruleset. NO es
 * autoritativo. Cada entrada lleva `reviewedBy` (`ai-draft` /
 * `human-confirmed` / `human-corrected`) que el AppSec engineer del
 * usuario va a actualizar al revisar. Para claims externos del benchmark
 * (blog post, marketplace listing) se filtra a `human-confirmed`
 * solamente.
 */

/** Estados de revision de una entrada del ground truth. */
export const REVIEW_STATUSES = ['ai-draft', 'human-confirmed', 'human-corrected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Criterio objetivo de PASS para el Triage Agent. */
export const TriageGroundTruthSchema = z.object({
  /** Veredicto esperado (los fixtures vulnerables son TP by design). */
  classification: z.enum(['true_positive', 'false_positive', 'inconclusive']),
  /**
   * Tope minimo de confidence esperado. Para fixtures "obvios" tipicos
   * (eval de req.body, AWS keys), confidence >= 0.8 razonable. Para
   * fixtures vibe-coded sutiles, 0.5-0.6.
   */
  minConfidence: z.number().min(0).max(1),
  /**
   * Lista de keywords que el `rationale` del LLM debe contener (todos).
   * El benchmark lo valida como string contains, case-insensitive.
   * Diseñado para ser tolerante: 2-3 keywords core, no parafrasis literales.
   */
  requiredKeywords: z.array(z.string().min(1)).min(1),
});

/** Criterio objetivo de PASS para el Context Agent (solo aplica si Triage = TP). */
export const ContextGroundTruthSchema = z.object({
  /** Keywords requeridos en `summary` (case-insensitive contains). */
  summaryKeywords: z.array(z.string().min(1)).min(1),
  /** Keywords requeridos en `entryPoint`. */
  entryPointKeywords: z.array(z.string().min(1)).min(1),
  /** Keywords requeridos en `sink`. */
  sinkKeywords: z.array(z.string().min(1)).min(1),
  /** Keywords requeridos en `exposure`. */
  exposureKeywords: z.array(z.string().min(1)).min(1),
});

/** Criterio objetivo de PASS para el Remediation Agent (solo aplica si Triage = TP). */
export const RemediationGroundTruthSchema = z.object({
  /** Keywords requeridos en `summary` (case-insensitive contains). */
  summaryKeywords: z.array(z.string().min(1)).min(1),
  /** Keywords requeridos en `recommendation`. */
  recommendationKeywords: z.array(z.string().min(1)).min(1),
  /**
   * Si la remediation incluye `fixedSnippet`, este NO debe contener
   * ninguno de estos patrones (el sink original o llamadas vulnerables
   * equivalentes). Validacion por NEGATIVA — un buen fix elimina la
   * llamada peligrosa.
   *
   * Si la remediation NO trae `fixedSnippet` (recommendation es de
   * proceso/config), este check se ignora.
   */
  forbiddenInSnippet: z.array(z.string().min(1)),
});

/** Entrada del ground truth: un finding esperado en un fixture. */
export const GroundTruthEntrySchema = z.object({
  /** Path relativo al root del repo. */
  fixturePath: z.string().min(1),
  /** Linea (1-based) donde se espera el finding. */
  line: z.number().int().positive(),
  /** Categoria del scout que lo genera (SAST/Secrets/SCA/IaC/VibeCoded). */
  category: z.enum(['SAST', 'Secrets', 'SCA', 'IaC', 'VibeCoded']),
  /** Identificador estable de la regla (canonical ruleId). */
  ruleId: z.string().min(1),
  /** Severidad esperada del scout. */
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  /** Descripcion breve del finding (humano-readable, no es input del LLM). */
  description: z.string().min(1),
  /** Ground truth para el Triage Agent. */
  triage: TriageGroundTruthSchema,
  /**
   * Ground truth para Context + Remediation. Solo aplica si triage.classification
   * === 'true_positive' (los otros casos no disparan estos agentes).
   */
  context: ContextGroundTruthSchema.optional(),
  remediation: RemediationGroundTruthSchema.optional(),
  /** Estado de revision de esta entrada. */
  reviewedBy: z.enum(REVIEW_STATUSES),
  /** Notas opcionales del revisor humano. */
  humanNotes: z.string().optional(),
});

export type GroundTruthEntry = z.infer<typeof GroundTruthEntrySchema>;
export type TriageGroundTruth = z.infer<typeof TriageGroundTruthSchema>;
export type ContextGroundTruth = z.infer<typeof ContextGroundTruthSchema>;
export type RemediationGroundTruth = z.infer<typeof RemediationGroundTruthSchema>;

/** Top-level del dataset. */
export const BenchmarkGroundTruthSchema = z.object({
  /** Version del schema (semver-like). */
  version: z.literal('1.0'),
  /** Fecha de generacion del borrador (ISO 8601). */
  generatedAt: z.string().min(1),
  /** Fecha de la ultima revision humana (ISO 8601), o `null` si nunca. */
  reviewedAt: z.string().nullable(),
  /** Lista de findings esperados. */
  entries: z.array(GroundTruthEntrySchema).min(1),
});

export type BenchmarkGroundTruth = z.infer<typeof BenchmarkGroundTruthSchema>;

/** Filename canonico del ground truth dataset (relativo al root del repo). */
export const GROUND_TRUTH_PATH = 'tests/benchmark/ground-truth.json';

/** Cuenta entries por reviewedBy status — para reportes del benchmark. */
export function countByReviewStatus(
  ground: BenchmarkGroundTruth,
): Readonly<Record<ReviewStatus, number>> {
  const counts: Record<ReviewStatus, number> = {
    'ai-draft': 0,
    'human-confirmed': 0,
    'human-corrected': 0,
  };
  for (const entry of ground.entries) {
    counts[entry.reviewedBy] += 1;
  }
  return counts;
}
