import { describe, it, expect } from 'vitest';
import {
  PRIORITY_SCORES,
  PriorityScoreSchema,
  computePriorityScore,
  type PriorityScore,
} from '../../src/coordinator/priority-score.js';
import type { Severity } from '../../src/types/severity.js';

describe('PRIORITY_SCORES + PriorityScoreSchema — DG-118 A', () => {
  it('contiene los 5 niveles canonicos en orden de urgencia', () => {
    expect(PRIORITY_SCORES).toEqual(['urgent', 'high', 'medium', 'low', 'noise']);
  });

  it('valida correctamente cada nivel via Zod', () => {
    for (const score of PRIORITY_SCORES) {
      expect(PriorityScoreSchema.parse(score)).toBe(score);
    }
  });

  it('rechaza valores fuera del enum', () => {
    expect(() => PriorityScoreSchema.parse('critical')).toThrow();
    expect(() => PriorityScoreSchema.parse('unknown')).toThrow();
    expect(() => PriorityScoreSchema.parse('')).toThrow();
  });
});

/**
 * DG-118 A Sub-option B (Cycle 109) — matriz 5 severities × 4 triage states =
 * **20 casos exhaustivos**. Cada caso documentado y testeado individualmente
 * para que cualquier futura modificacion del algoritmo rompa el test fix.
 */
describe('computePriorityScore — DG-118 A Sub-option B (matriz 20 casos)', () => {
  // Helper for matrix tests
  const cases: ReadonlyArray<{
    severity: Severity;
    classification: 'true_positive' | 'false_positive' | 'inconclusive' | undefined;
    expected: PriorityScore;
    note: string;
  }> = [
    // === TRUE POSITIVE × 5 severities → severity directly ===
    {
      severity: 'critical',
      classification: 'true_positive',
      expected: 'urgent',
      note: 'critical TP → urgent (confirmed real bug at top severity)',
    },
    {
      severity: 'high',
      classification: 'true_positive',
      expected: 'high',
      note: 'high TP → high',
    },
    {
      severity: 'medium',
      classification: 'true_positive',
      expected: 'medium',
      note: 'medium TP → medium',
    },
    {
      severity: 'low',
      classification: 'true_positive',
      expected: 'low',
      note: 'low TP → low',
    },
    {
      severity: 'info',
      classification: 'true_positive',
      expected: 'low',
      note: 'info TP → low (floor — info nunca es urgent)',
    },

    // === INCONCLUSIVE × 5 severities → severity demoted one step ===
    {
      severity: 'critical',
      classification: 'inconclusive',
      expected: 'high',
      note: 'critical INC → high (urgent demote one step)',
    },
    {
      severity: 'high',
      classification: 'inconclusive',
      expected: 'medium',
      note: 'high INC → medium',
    },
    {
      severity: 'medium',
      classification: 'inconclusive',
      expected: 'low',
      note: 'medium INC → low',
    },
    {
      severity: 'low',
      classification: 'inconclusive',
      expected: 'low',
      note: 'low INC → low (floor — no se demota por debajo)',
    },
    {
      severity: 'info',
      classification: 'inconclusive',
      expected: 'low',
      note: 'info INC → low (floor — info base ya es low)',
    },

    // === UNTRIAGED × 5 severities → severity directly (pessimistic) ===
    {
      severity: 'critical',
      classification: undefined,
      expected: 'urgent',
      note: 'critical untriaged → urgent (pessimistic: could-be-TP)',
    },
    {
      severity: 'high',
      classification: undefined,
      expected: 'high',
      note: 'high untriaged → high',
    },
    {
      severity: 'medium',
      classification: undefined,
      expected: 'medium',
      note: 'medium untriaged → medium',
    },
    {
      severity: 'low',
      classification: undefined,
      expected: 'low',
      note: 'low untriaged → low',
    },
    {
      severity: 'info',
      classification: undefined,
      expected: 'low',
      note: 'info untriaged → low (floor)',
    },

    // === FALSE POSITIVE × 5 severities → noise (always) ===
    {
      severity: 'critical',
      classification: 'false_positive',
      expected: 'noise',
      note: 'critical FP → noise (LLM dismissed; no es prioridad de action)',
    },
    {
      severity: 'high',
      classification: 'false_positive',
      expected: 'noise',
      note: 'high FP → noise',
    },
    {
      severity: 'medium',
      classification: 'false_positive',
      expected: 'noise',
      note: 'medium FP → noise',
    },
    {
      severity: 'low',
      classification: 'false_positive',
      expected: 'noise',
      note: 'low FP → noise',
    },
    {
      severity: 'info',
      classification: 'false_positive',
      expected: 'noise',
      note: 'info FP → noise',
    },
  ];

  for (const { severity, classification, expected, note } of cases) {
    const classLabel = classification ?? 'untriaged';
    it(`(${severity}, ${classLabel}) → ${expected} — ${note}`, () => {
      expect(computePriorityScore(severity, classification)).toBe(expected);
    });
  }

  it('NO usa confidence como input (separated from TP% per DG-118 A spec)', () => {
    // Mismo resultado independientemente de cualquier confidence (no es un
    // parametro de la funcion — la firma lo prohibe estructuralmente).
    expect(computePriorityScore('high', 'true_positive')).toBe('high');
    expect(computePriorityScore('high', 'inconclusive')).toBe('medium');
  });

  it('cubre exhaustivamente la matriz 5 × 4 = 20 casos', () => {
    expect(cases).toHaveLength(20);
    const seen = new Set<string>();
    for (const { severity, classification } of cases) {
      const key = `${severity}|${classification ?? 'untriaged'}`;
      expect(seen.has(key)).toBe(false); // sin duplicados
      seen.add(key);
    }
    expect(seen.size).toBe(20);
  });
});
