import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { FindingSchema, FindingLocationSchema } from '../../src/types/finding.js';

/** Construye un hallazgo valido para usar de base en los tests. */
function validFinding(): Record<string, unknown> {
  return {
    id: randomUUID(),
    scanId: 'scan-1',
    scoutId: 'opengrep',
    severity: 'high',
    category: 'SAST',
    ruleId: 'js.sqli.injection',
    title: 'Posible inyeccion SQL',
    message: 'Entrada sin sanitizar alcanza una query SQL.',
    location: { path: 'src/db.ts', startLine: 42 },
    fingerprint: 'fp-abc123',
    createdAt: new Date().toISOString(),
  };
}

describe('FindingSchema', () => {
  it('parsea un hallazgo valido y aplica los defaults', () => {
    const parsed = FindingSchema.parse(validFinding());
    expect(parsed.complianceRefs).toEqual([]);
    expect(parsed.lifecycleState).toBe('new');
    expect(parsed.location.endLine).toBeUndefined();
  });

  it('rechaza un hallazgo sin id', () => {
    const bad = validFinding();
    delete bad.id;
    expect(FindingSchema.safeParse(bad).success).toBe(false);
  });

  it('rechaza un id que no es UUID', () => {
    expect(FindingSchema.safeParse({ ...validFinding(), id: 'no-uuid' }).success).toBe(false);
  });

  it('rechaza una severidad invalida', () => {
    expect(FindingSchema.safeParse({ ...validFinding(), severity: 'urgent' }).success).toBe(false);
  });

  it('rechaza una categoria invalida', () => {
    expect(FindingSchema.safeParse({ ...validFinding(), category: 'XSS' }).success).toBe(false);
  });
});

describe('FindingLocationSchema', () => {
  it('exige una startLine entera y positiva', () => {
    expect(FindingLocationSchema.safeParse({ path: 'a.ts', startLine: 0 }).success).toBe(false);
    expect(FindingLocationSchema.safeParse({ path: 'a.ts', startLine: 1.5 }).success).toBe(false);
    expect(FindingLocationSchema.safeParse({ path: 'a.ts', startLine: 1 }).success).toBe(true);
  });

  it('rechaza una ruta vacia', () => {
    expect(FindingLocationSchema.safeParse({ path: '', startLine: 1 }).success).toBe(false);
  });
});
