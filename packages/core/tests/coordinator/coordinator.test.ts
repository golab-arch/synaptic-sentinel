import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ColonyDb } from '../../src/colony/colony-db.js';
import { Coordinator } from '../../src/coordinator/coordinator.js';
import type { ScanRequest, ScoutAgent, ScoutResult, ScoutStatus } from '../../src/types/scout-agent.js';

/** Construye un Finding valido. */
function makeFinding(scanId: string, scoutId: string): Record<string, unknown> {
  return {
    id: randomUUID(),
    scanId,
    scoutId,
    severity: 'high',
    category: 'SAST',
    ruleId: 'test-rule',
    title: 'Hallazgo de prueba',
    message: 'Mensaje del hallazgo de prueba.',
    location: { path: 'src/x.ts', startLine: 1 },
    complianceRefs: [],
    fingerprint: `fp-${randomUUID()}`,
    lifecycleState: 'new',
    createdAt: new Date().toISOString(),
  };
}

interface FakeOptions {
  readonly id: string;
  readonly available?: boolean;
  readonly status?: ScoutStatus;
  readonly findingCount?: number;
  readonly throws?: boolean;
}

/** Scout de prueba parametrizable, sin scanner real. */
function fakeScout(opts: FakeOptions): ScoutAgent {
  return {
    id: opts.id,
    displayName: opts.id,
    category: 'SAST',
    isAvailable: (): Promise<boolean> => Promise.resolve(opts.available ?? true),
    scan: (request: ScanRequest): Promise<ScoutResult> => {
      if (opts.throws === true) return Promise.reject(new Error('scout roto'));
      const now = new Date().toISOString();
      const findings = Array.from({ length: opts.findingCount ?? 0 }, () =>
        makeFinding(request.scanId, opts.id),
      );
      return Promise.resolve({
        scoutId: opts.id,
        scanId: request.scanId,
        findings: findings as unknown as ScoutResult['findings'],
        status: opts.status ?? 'ok',
        startedAt: now,
        finishedAt: now,
      });
    },
  };
}

describe('Coordinator (stage 1)', () => {
  it('corre un scan, registra el Scan y persiste las feromonas finding', async () => {
    const db = ColonyDb.open(':memory:');
    const coordinator = new Coordinator(db, [fakeScout({ id: 'fake-a', findingCount: 2 })]);

    const outcome = await coordinator.runScan({ rootPath: '/proyecto', mode: 'full' });

    expect(outcome.status).toBe('ok');
    expect(outcome.findingsCount).toBe(2);
    expect(db.getScan(outcome.scanId)?.finishedAt).toBeDefined();

    const pheromones = db.getPheromonesByScan(outcome.scanId);
    expect(pheromones).toHaveLength(2);
    expect(pheromones.every((p) => p.type === 'finding')).toBe(true);
    db.close();
  });

  it('degrada el scan si un scout reporta failed', async () => {
    const db = ColonyDb.open(':memory:');
    const coordinator = new Coordinator(db, [
      fakeScout({ id: 'ok-scout', findingCount: 1 }),
      fakeScout({ id: 'bad-scout', status: 'failed' }),
    ]);

    const outcome = await coordinator.runScan({ rootPath: '/proyecto', mode: 'full' });

    expect(outcome.status).toBe('degraded');
    expect(outcome.findingsCount).toBe(1);
    db.close();
  });

  it('captura la excepcion de un scout y continua con los demas', async () => {
    const db = ColonyDb.open(':memory:');
    const coordinator = new Coordinator(db, [
      fakeScout({ id: 'ok-scout', findingCount: 1 }),
      fakeScout({ id: 'throwing-scout', throws: true }),
    ]);

    const outcome = await coordinator.runScan({ rootPath: '/proyecto', mode: 'full' });

    expect(outcome.status).toBe('degraded');
    expect(outcome.findingsCount).toBe(1);
    expect(outcome.scouts.find((s) => s.scoutId === 'throwing-scout')?.status).toBe('failed');
    db.close();
  });

  it('omite los scouts cuyo scanner no esta disponible', async () => {
    const db = ColonyDb.open(':memory:');
    const coordinator = new Coordinator(db, [
      fakeScout({ id: 'present', findingCount: 1 }),
      fakeScout({ id: 'absent', available: false, findingCount: 5 }),
    ]);

    const outcome = await coordinator.runScan({ rootPath: '/proyecto', mode: 'full' });

    expect(outcome.scouts.map((s) => s.scoutId)).toEqual(['present']);
    expect(outcome.findingsCount).toBe(1);
    db.close();
  });
});
