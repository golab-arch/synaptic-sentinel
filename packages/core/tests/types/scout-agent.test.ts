import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ScoutResultSchema,
  SCOUT_STATUSES,
  type ScoutAgent,
  type ScanRequest,
  type ScoutResult,
} from '../../src/types/scout-agent.js';

/** Scout de prueba: implementa el contrato `ScoutAgent` sin scanner real. */
const fakeScout: ScoutAgent = {
  id: 'fake',
  displayName: 'Fake Scout',
  category: 'SAST',
  isAvailable: (): Promise<boolean> => Promise.resolve(true),
  scan: (request: ScanRequest): Promise<ScoutResult> => {
    const now = new Date().toISOString();
    return Promise.resolve({
      scoutId: 'fake',
      scanId: request.scanId,
      findings: [],
      status: 'ok',
      startedAt: now,
      finishedAt: now,
    });
  },
};

describe('ScoutAgent (contrato)', () => {
  it('una implementacion del contrato reporta disponibilidad', async () => {
    expect(await fakeScout.isAvailable()).toBe(true);
  });

  it('scan() devuelve un ScoutResult valido contra el schema', async () => {
    const result = await fakeScout.scan({
      scanId: randomUUID(),
      rootPath: '/proyecto',
      targetPaths: [],
      mode: 'full',
    });
    expect(ScoutResultSchema.safeParse(result).success).toBe(true);
    expect(result.findings).toEqual([]);
  });
});

describe('ScoutResultSchema', () => {
  it('expone los 3 estados de scout (ok, partial, failed)', () => {
    expect(SCOUT_STATUSES).toEqual(['ok', 'partial', 'failed']);
  });

  it('rechaza un status invalido', () => {
    const now = new Date().toISOString();
    const bad = {
      scoutId: 'fake',
      scanId: 'scan-1',
      findings: [],
      status: 'crashed',
      startedAt: now,
      finishedAt: now,
    };
    expect(ScoutResultSchema.safeParse(bad).success).toBe(false);
  });
});
