import { describe, it, expect } from 'vitest';
import {
  TRIAGE_CLASSIFICATIONS,
  TriageVerdictRecordSchema,
  TriageVerdictSchema,
} from '../../src/types/triage.js';

describe('TriageVerdictSchema', () => {
  it('acepta un veredicto valido', () => {
    const verdict = TriageVerdictSchema.parse({
      classification: 'true_positive',
      confidence: 0.8,
      rationale: 'riesgo real',
    });
    expect(verdict.classification).toBe('true_positive');
  });

  it('rechaza una clasificacion fuera del enum', () => {
    expect(() =>
      TriageVerdictSchema.parse({ classification: 'quizas', confidence: 0.5, rationale: 'r' }),
    ).toThrow();
  });

  it('rechaza una confianza fuera del rango 0..1', () => {
    expect(() =>
      TriageVerdictSchema.parse({
        classification: 'inconclusive',
        confidence: 2,
        rationale: 'r',
      }),
    ).toThrow();
  });

  it('rechaza un rationale vacio', () => {
    expect(() =>
      TriageVerdictSchema.parse({
        classification: 'false_positive',
        confidence: 0.5,
        rationale: '',
      }),
    ).toThrow();
  });
});

describe('TriageVerdictRecordSchema', () => {
  it('acepta un registro de veredicto completo', () => {
    const record = TriageVerdictRecordSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      scanId: 'scan-1',
      fingerprint: 'fp-1',
      classification: 'true_positive',
      confidence: 0.9,
      rationale: 'r',
      agentId: 'triage',
      createdAt: '2026-05-21T00:00:00.000Z',
    });
    expect(record.fingerprint).toBe('fp-1');
  });

  it('rechaza un registro sin fingerprint', () => {
    expect(() =>
      TriageVerdictRecordSchema.parse({
        id: '00000000-0000-4000-8000-000000000001',
        scanId: 'scan-1',
        classification: 'true_positive',
        confidence: 0.9,
        rationale: 'r',
        agentId: 'triage',
        createdAt: '2026-05-21T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('TRIAGE_CLASSIFICATIONS', () => {
  it('tiene las tres clasificaciones de v0.4 (TP / FP / inconcluso)', () => {
    expect(TRIAGE_CLASSIFICATIONS).toEqual(['true_positive', 'false_positive', 'inconclusive']);
  });
});
