import { describe, it, expect } from 'vitest';
import {
  LearningClassificationSchema,
  LearningRecordSchema,
  patternSignature,
  triageClassificationToLearning,
} from '../../src/types/learning.js';

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
