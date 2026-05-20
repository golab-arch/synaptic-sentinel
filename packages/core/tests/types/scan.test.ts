import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ScanSchema, ScanModeSchema, SCAN_MODES } from '../../src/types/scan.js';

describe('ScanSchema', () => {
  it('parsea un scan valido en curso (sin finishedAt)', () => {
    const s = ScanSchema.parse({ id: randomUUID(), startedAt: new Date().toISOString() });
    expect(s.finishedAt).toBeUndefined();
  });

  it('rechaza un id que no es UUID', () => {
    expect(
      ScanSchema.safeParse({ id: 'no-uuid', startedAt: new Date().toISOString() }).success,
    ).toBe(false);
  });

  it('rechaza un startedAt que no es ISO-8601', () => {
    expect(ScanSchema.safeParse({ id: randomUUID(), startedAt: '20/05/2026' }).success).toBe(false);
  });
});

describe('ScanMode', () => {
  it('acepta on-save, on-commit y full', () => {
    expect(SCAN_MODES).toEqual(['on-save', 'on-commit', 'full']);
    for (const m of SCAN_MODES) {
      expect(ScanModeSchema.safeParse(m).success).toBe(true);
    }
  });

  it('rechaza un modo de escaneo invalido', () => {
    expect(ScanModeSchema.safeParse('background-continuous').success).toBe(false);
  });
});
