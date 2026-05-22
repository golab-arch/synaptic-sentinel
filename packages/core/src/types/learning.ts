import { z } from 'zod';
import type { Finding } from './finding.js';
import type { TriageClassification } from './triage.js';

/**
 * Clasificaciones de un patron aprendido (`learning_records`, v0.4 §3.5):
 * un patron que tiende a ser falso positivo, uno que tiende a ser una
 * vulnerabilidad real, o uno especifico de este proyecto.
 */
export const LEARNING_CLASSIFICATIONS = [
  'fp_pattern',
  'real_pattern',
  'project_specific',
] as const;

/** Schema de validacion de la clasificacion de un learning record. */
export const LearningClassificationSchema = z.enum(LEARNING_CLASSIFICATIONS);

/** Clasificacion de un patron aprendido. */
export type LearningClassification = z.infer<typeof LearningClassificationSchema>;

/**
 * Registro de aprendizaje del enjambre (v0.4 §3.5): un patron de hallazgo y
 * cuantas veces se lo clasifico de una forma dada, acumulado entre scans.
 *
 * A diferencia de `triage_verdicts` —un veredicto por hallazgo exacto
 * (`fingerprint` = path:rule:line)— un learning record generaliza por patron:
 * es la memoria cross-scan, cross-ubicacion del enjambre. La respuesta del
 * LLM que lo origina se valida con este schema (anti Memory Poisoning §9.6).
 */
export const LearningRecordSchema = z.object({
  /** Identificador unico del registro (UUID). */
  id: z.string().uuid(),
  /** Patron generalizado del hallazgo (`${category}:${ruleId}`). */
  patternSignature: z.string().min(1),
  /** Como se clasifico el patron. */
  classification: LearningClassificationSchema,
  /** Cuantos hallazgos de este patron recibieron esta clasificacion. */
  evidenceCount: z.number().int().positive(),
  /** Ultimo scan en el que se observo el patron. */
  lastSeenScan: z.string().min(1),
});

/** Registro de aprendizaje del enjambre. */
export type LearningRecord = z.infer<typeof LearningRecordSchema>;

/**
 * Deriva el `pattern_signature` de un hallazgo: `${category}:${ruleId}`.
 *
 * Generaliza por regla, no por ubicacion: el learning record captura "este
 * tipo de hallazgo" — distinto de `triage_verdicts`, que es por `fingerprint`
 * exacto. El `fingerprint` (path:rule:line) alimenta el patron via su `ruleId`.
 */
export function patternSignature(finding: Pick<Finding, 'category' | 'ruleId'>): string {
  return `${finding.category}:${finding.ruleId}`;
}

/**
 * Mapea una clasificacion de triage a la de un learning record. Un veredicto
 * `inconclusive` no produce aprendizaje (devuelve `undefined`): solo se
 * aprende de las clasificaciones decisivas.
 */
export function triageClassificationToLearning(
  classification: TriageClassification,
): LearningClassification | undefined {
  if (classification === 'false_positive') return 'fp_pattern';
  if (classification === 'true_positive') return 'real_pattern';
  return undefined;
}

/**
 * Umbral de evidencia para que la colonia pre-clasifique un hallazgo sin
 * gastar una llamada LLM: el patron necesita al menos esta cantidad de
 * observaciones consistentes. Conservador por diseno (v0.4 §187).
 */
export const LEARNING_CONFIDENCE_THRESHOLD = 3;

/** Veredicto derivado de la memoria del enjambre, sin llamada LLM. */
export interface LearnedVerdict {
  /** Clasificacion derivada (siempre decisiva: TP o FP). */
  readonly classification: TriageClassification;
  /** Confianza, creciente con la evidencia (tope 0.95). */
  readonly confidence: number;
  /** Cantidad de observaciones previas que respaldan el veredicto. */
  readonly evidenceCount: number;
}

/** Confianza de un veredicto derivado: crece con la evidencia, tope 0.95. */
function learnedConfidence(evidenceCount: number): number {
  return Math.min(0.95, 0.6 + 0.05 * evidenceCount);
}

/**
 * Decide si la memoria del enjambre puede pre-clasificar un hallazgo sin
 * gastar una llamada LLM (economia de tokens, v0.4 §187).
 *
 * Devuelve un veredicto derivado solo si el patron tiene evidencia FUERTE y
 * CONSISTENTE: al menos `threshold` observaciones en una unica direccion
 * (`fp_pattern` o `real_pattern`, no ambas). Si hay evidencia en ambas
 * direcciones el patron es dependiente del contexto y devuelve `undefined`:
 * el LLM debe decidir. Un veredicto derivado NUNCA se realimenta a
 * `learning_records` — el llamante solo aprende de las decisiones del LLM.
 */
export function deriveFromLearning(
  signature: string,
  records: readonly LearningRecord[],
  threshold: number = LEARNING_CONFIDENCE_THRESHOLD,
): LearnedVerdict | undefined {
  const forSignature = records.filter((r) => r.patternSignature === signature);
  const fpCount =
    forSignature.find((r) => r.classification === 'fp_pattern')?.evidenceCount ?? 0;
  const realCount =
    forSignature.find((r) => r.classification === 'real_pattern')?.evidenceCount ?? 0;
  // Evidencia contradictoria: el patron es ambiguo, debe decidir el LLM.
  if (fpCount > 0 && realCount > 0) return undefined;
  if (fpCount >= threshold) {
    return {
      classification: 'false_positive',
      confidence: learnedConfidence(fpCount),
      evidenceCount: fpCount,
    };
  }
  if (realCount >= threshold) {
    return {
      classification: 'true_positive',
      confidence: learnedConfidence(realCount),
      evidenceCount: realCount,
    };
  }
  return undefined;
}
