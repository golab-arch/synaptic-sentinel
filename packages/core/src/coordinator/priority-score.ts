import { z } from 'zod';
import type { Severity } from '../types/severity.js';

/**
 * DG-118 A (Cycle 109) — Priority score: separa "prioridad/riesgo" de la
 * "confianza del LLM" (TP%).
 *
 * Problema empirico del user-handoff post-DG-115.1: el sidebar mostraba
 * `[SEVERITY] title [STATE_LABEL CONFIDENCE%]` (e.g. `[HIGH] foo [FP 95%]`)
 * y usuarios novatos leian el `95%` como prioridad de fix → confusion entre
 * "que tan seguro esta el LLM de su veredicto" vs "que tan urgente es
 * atender este finding".
 *
 * Solucion: introducir un campo `priorityScore` SEPARADO del `confidence`,
 * computado deterministicamente desde (severity, triageClassification).
 * El triage state aporta semantica: TP = arreglar ahora; INC = revisar pero
 * incertidumbre demota; Untriaged = pessimistic (could-be-TP); FP = noise
 * (ya manejado, deemphasis).
 *
 * Sub-option B (Balanced) user-approved en DG-118 A:
 * - TP × severity → severity directly mapped to priority.
 * - INC × severity → severity DEMOTED one step (incertidumbre).
 * - Untriaged × severity → severity directly (pessimistic: could-be-TP).
 * - FP × any → 'noise' (always).
 *
 * Trade-offs honestos (anti-optimismo ilusorio):
 * - **"Demote one step" para INC es calibracion arbitraria** — podria
 *   debatirse "no demote" (INC critical sigue urgent) o "demote two steps"
 *   (mas conservador). Mi eleccion es balance: INC tiene info parcial pero
 *   ambigua → demote moderado. Documentado.
 * - **NO usa `confidence` como input** (deliberate per DG-118 A spec). Si
 *   futuros usuarios pidieran weighting por confidence, abre sub-DG.
 * - **`low` + `info` colapsan a `low` priority** en todos los triage states
 *   (no urgent, no demote-below-low). Intencional.
 * - **Algoritmo es pure function** — sin side effects, sin dependencias.
 *   Cubrible exhaustivamente en tests con matriz 5 severities × 4 states =
 *   20 casos.
 */

/** Niveles de priority/risk score, de mayor a menor urgencia (DG-118 A). */
export const PRIORITY_SCORES = ['urgent', 'high', 'medium', 'low', 'noise'] as const;

/** Schema de validacion para priority score. */
export const PriorityScoreSchema = z.enum(PRIORITY_SCORES);

/** Priority/risk score derivado de severity + triage classification. */
export type PriorityScore = z.infer<typeof PriorityScoreSchema>;

/**
 * Mapping base: severity → priority cuando NO hay demote.
 * Usado por TP (confirmed real) y Untriaged (pessimistic — could-be-TP).
 */
const PRIORITY_BY_SEVERITY: Readonly<Record<Severity, PriorityScore>> = {
  critical: 'urgent',
  high: 'high',
  medium: 'medium',
  low: 'low',
  info: 'low', // floor — info findings nunca son urgent
};

/**
 * Operador "demote one step" sobre priority (no severity).
 * Usado por INC (incertidumbre del LLM → reducir un nivel).
 * `low` es floor — no se demota por debajo. `noise` solo se alcanza
 * por FP explícit, NO por demote.
 */
const DEMOTE_ONE_STEP: Readonly<Record<PriorityScore, PriorityScore>> = {
  urgent: 'high',
  high: 'medium',
  medium: 'low',
  low: 'low', // floor
  noise: 'noise', // no aplica — noise solo viene de FP
};

/**
 * Classification del verdict del Triage Agent (Brain Layer). Subset string
 * literal usado por el algoritmo — la classification real viene del
 * `TriageVerdict.classification` persistido en colony.db.
 */
export type TriageClassificationInput =
  | 'true_positive'
  | 'false_positive'
  | 'inconclusive'
  | undefined;

/**
 * Computa el `priorityScore` deterministicamente desde (severity,
 * classification). Pure function — testeable exhaustivamente con matriz
 * 5 × 4 = 20 casos.
 *
 * Reglas (Sub-option B user-approved):
 * - `classification === 'false_positive'` → SIEMPRE `'noise'`. El LLM ya
 *   descarto el finding; visualmente deemphasized.
 * - `classification === 'true_positive'` → `PRIORITY_BY_SEVERITY[severity]`.
 *   Confirmed real bug → severity directly mapeada (critical→urgent, etc.).
 * - `classification === 'inconclusive'` → `DEMOTE_ONE_STEP[PRIORITY_BY_SEVERITY[severity]]`.
 *   LLM vio evidencia pero no pudo decidir → demote moderado.
 * - `classification === undefined` (untriaged) → `PRIORITY_BY_SEVERITY[severity]`.
 *   Aun no procesado → pessimistic: tratar como could-be-TP.
 *
 * Ejemplos clave:
 * - `(critical, 'true_positive')` → `'urgent'`
 * - `(critical, 'inconclusive')` → `'high'` (demote desde urgent)
 * - `(critical, undefined)` → `'urgent'` (untriaged pessimistic)
 * - `(critical, 'false_positive')` → `'noise'`
 * - `(high, 'inconclusive')` → `'medium'`
 * - `(low, 'inconclusive')` → `'low'` (floor — no se demota debajo)
 * - `(info, 'true_positive')` → `'low'` (info severity floor)
 */
export function computePriorityScore(
  severity: Severity,
  classification: TriageClassificationInput,
): PriorityScore {
  if (classification === 'false_positive') return 'noise';
  const base = PRIORITY_BY_SEVERITY[severity];
  if (classification === 'inconclusive') return DEMOTE_ONE_STEP[base];
  // TP and untriaged: severity directly (pessimistic for untriaged).
  return base;
}
