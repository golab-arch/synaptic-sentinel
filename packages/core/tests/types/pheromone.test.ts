import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PheromoneSchema, PHEROMONE_TYPES } from '../../src/types/pheromone.js';

/** Construye una feromona valida para usar de base en los tests. */
function validPheromone(): Record<string, unknown> {
  return {
    id: randomUUID(),
    type: 'finding',
    agentId: 'opengrep',
    scanId: 'scan-1',
    payload: { findingId: 'f-1' },
    createdAt: new Date().toISOString(),
  };
}

describe('PheromoneSchema', () => {
  it('parsea una feromona valida y aplica decayRate por defecto 0.1', () => {
    const p = PheromoneSchema.parse(validPheromone());
    expect(p.decayRate).toBe(0.1);
  });

  it('acepta los 5 tipos de feromona del v0.4 §3.5', () => {
    expect(PHEROMONE_TYPES).toEqual([
      'finding',
      'context',
      'hypothesis',
      'exploration_marker',
      'fp_known',
    ]);
    for (const t of PHEROMONE_TYPES) {
      expect(PheromoneSchema.safeParse({ ...validPheromone(), type: t }).success).toBe(true);
    }
  });

  it('rechaza un tipo de feromona invalido', () => {
    expect(PheromoneSchema.safeParse({ ...validPheromone(), type: 'rumor' }).success).toBe(false);
  });

  it('rechaza confidence fuera del rango 0..1', () => {
    expect(PheromoneSchema.safeParse({ ...validPheromone(), confidence: 1.5 }).success).toBe(false);
  });

  it('rechaza decayRate fuera del rango 0..1', () => {
    expect(PheromoneSchema.safeParse({ ...validPheromone(), decayRate: -0.2 }).success).toBe(false);
  });
});
