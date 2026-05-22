import { describe, it, expect } from 'vitest';
import {
  deriveFromLearning,
  LearningClassificationSchema,
  LearningRecordSchema,
  patternSignature,
  triageClassificationToLearning,
  type LearningRecord,
} from '../../src/types/learning.js';

/** Construye un LearningRecord para un patron, clasificacion y evidencia. */
function record(
  signature: string,
  classification: LearningRecord['classification'],
  evidenceCount: number,
): LearningRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    patternSignature: signature,
    classification,
    evidenceCount,
    lastSeenScan: 'scan-1',
  };
}

describe('LearningClassificationSchema', () => {
  it('acepta las clasificaciones validas y rechaza el resto', () => {
    expect(LearningClassificationSchema.parse('fp_pattern')).toBe('fp_pattern');
    expect(LearningClassificationSchema.parse('real_pattern')).toBe('real_pattern');
    expect(LearningClassificationSchema.parse('project_specific')).toBe('project_specific');
    expect(() => LearningClassificationSchema.parse('otra')).toThrow();
  });
});

describe('LearningRecordSchema', () => {
  it('acepta un registro de aprendizaje valido', () => {
    const record = LearningRecordSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      patternSignature: 'SAST:sentinel-js-eval-usage',
      classification: 'real_pattern',
      evidenceCount: 3,
      lastSeenScan: 'scan-1',
    });
    expect(record.evidenceCount).toBe(3);
    expect(record.patternSignature).toBe('SAST:sentinel-js-eval-usage');
  });

  it('rechaza un evidenceCount no positivo', () => {
    expect(() =>
      LearningRecordSchema.parse({
        id: '00000000-0000-4000-8000-000000000001',
        patternSignature: 'SAST:x',
        classification: 'real_pattern',
        evidenceCount: 0,
        lastSeenScan: 'scan-1',
      }),
    ).toThrow();
  });
});

describe('patternSignature', () => {
  it('deriva ${category}:${ruleId} del hallazgo', () => {
    expect(patternSignature({ category: 'IaC', ruleId: 'CKV_DOCKER_2' })).toBe('IaC:CKV_DOCKER_2');
  });
});

describe('triageClassificationToLearning', () => {
  it('mapea false_positive a fp_pattern y true_positive a real_pattern', () => {
    expect(triageClassificationToLearning('false_positive')).toBe('fp_pattern');
    expect(triageClassificationToLearning('true_positive')).toBe('real_pattern');
  });

  it('no aprende de un veredicto inconclusive', () => {
    expect(triageClassificationToLearning('inconclusive')).toBeUndefined();
  });
});

describe('deriveFromLearning', () => {
  it('pre-clasifica como true_positive un patron real con evidencia fuerte', () => {
    const verdict = deriveFromLearning('SAST:eval', [record('SAST:eval', 'real_pattern', 5)]);
    expect(verdict?.classification).toBe('true_positive');
    expect(verdict?.evidenceCount).toBe(5);
    expect(verdict?.confidence).toBeGreaterThan(0.5);
    expect(verdict?.confidence).toBeLessThanOrEqual(0.95);
  });

  it('pre-clasifica como false_positive un patron fp con evidencia fuerte', () => {
    const verdict = deriveFromLearning('IaC:x', [record('IaC:x', 'fp_pattern', 4)]);
    expect(verdict?.classification).toBe('false_positive');
  });

  it('no pre-clasifica por debajo del umbral de evidencia', () => {
    expect(deriveFromLearning('IaC:x', [record('IaC:x', 'fp_pattern', 2)])).toBeUndefined();
  });

  it('no pre-clasifica un patron con evidencia contradictoria', () => {
    const verdict = deriveFromLearning('IaC:x', [
      record('IaC:x', 'fp_pattern', 5),
      record('IaC:x', 'real_pattern', 5),
    ]);
    expect(verdict).toBeUndefined();
  });

  it('no pre-clasifica un patron sin registros', () => {
    expect(deriveFromLearning('IaC:nada', [])).toBeUndefined();
  });
});
