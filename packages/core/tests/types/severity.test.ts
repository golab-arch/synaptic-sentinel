import { describe, it, expect } from 'vitest';
import {
  SEVERITIES,
  SeveritySchema,
  SEVERITY_RANK,
  severityAtLeast,
} from '../../src/types/severity.js';

describe('Severity', () => {
  it('acepta las 5 severidades validas del v0.4', () => {
    expect(SEVERITIES).toEqual(['critical', 'high', 'medium', 'low', 'info']);
    for (const s of SEVERITIES) {
      expect(SeveritySchema.safeParse(s).success).toBe(true);
    }
  });

  it('rechaza una severidad invalida', () => {
    expect(SeveritySchema.safeParse('fatal').success).toBe(false);
  });

  it('ordena critical por encima de info', () => {
    expect(SEVERITY_RANK.critical).toBeGreaterThan(SEVERITY_RANK.info);
  });

  it('severityAtLeast compara contra un umbral', () => {
    expect(severityAtLeast('high', 'medium')).toBe(true);
    expect(severityAtLeast('low', 'high')).toBe(false);
    expect(severityAtLeast('critical', 'critical')).toBe(true);
  });
});
