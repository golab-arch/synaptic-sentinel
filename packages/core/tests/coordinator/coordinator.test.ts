import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ColonyDb } from '../../src/colony/colony-db.js';
import { Coordinator } from '../../src/coordinator/coordinator.js';
import { buildFpKnownPheromone } from '../../src/types/fp-known.js';
import type { ScanRequest, ScoutAgent, ScoutResult, ScoutStatus } from '../../src/types/scout-agent.js';

/** Construye un Finding valido; con `fingerprint` fijo si se provee. */
function makeFinding(
  scanId: string,
  scoutId: string,
  fingerprint?: string,
): Record<string, unknown> {
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
    fingerprint: fingerprint ?? `fp-${randomUUID()}`,
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
  /** Si es `true`, el scout nunca resuelve e ignora su signal (scout colgado). */
  readonly hangs?: boolean;
  /** Si se provee, el scout emite un finding por cada fingerprint dado. */
  readonly fingerprints?: readonly string[];
}

/** Scout de prueba parametrizable, sin scanner real. */
function fakeScout(opts: FakeOptions): ScoutAgent {
  return {
    id: opts.id,
    displayName: opts.id,
    category: 'SAST',
    isAvailable: (): Promise<boolean> => Promise.resolve(opts.available ?? true),
    scan: (request: ScanRequest): Promise<ScoutResult> => {
      // Scout colgado: nunca resuelve e ignora la signal de cancelacion.
      if (opts.hangs === true) return new Promise<ScoutResult>(() => undefined);
      if (opts.throws === true) return Promise.reject(new Error('scout roto'));
      const now = new Date().toISOString();
      const findings =
        opts.fingerprints !== undefined
          ? opts.fingerprints.map((fp) => makeFinding(request.scanId, opts.id, fp))
          : Array.from({ length: opts.findingCount ?? 0 }, () =>
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

/** Lee el `lifecycleState` del payload de una feromona finding. */
function lifecycleOf(payload: Record<string, unknown>): unknown {
  return payload['lifecycleState'];
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
    expect(outcome.suppressedCount).toBe(0);
    db.close();
  });
});

describe('Coordinator (stage 2 - dedup, fp_known, ciclo de vida)', () => {
  it('un hallazgo nuevo se persiste como "new" en el primer scan', async () => {
    const db = ColonyDb.open(':memory:');
    const coordinator = new Coordinator(db, [
      fakeScout({ id: 's', fingerprints: ['fp-recurrente'] }),
    ]);

    const outcome = await coordinator.runScan({ rootPath: '/p', mode: 'full' });

    const pheromones = db.getPheromonesByScan(outcome.scanId);
    expect(pheromones).toHaveLength(1);
    expect(lifecycleOf(pheromones[0]!.payload)).toBe('new');
    db.close();
  });

  it('marca como "known" un hallazgo ya visto en un scan anterior', async () => {
    const db = ColonyDb.open(':memory:');
    const coordinator = new Coordinator(db, [
      fakeScout({ id: 's', fingerprints: ['fp-recurrente'] }),
    ]);

    await coordinator.runScan({ rootPath: '/p', mode: 'full' });
    const second = await coordinator.runScan({ rootPath: '/p', mode: 'full' });

    const pheromones = db.getPheromonesByScan(second.scanId);
    expect(pheromones).toHaveLength(1);
    expect(lifecycleOf(pheromones[0]!.payload)).toBe('known');
    expect(second.suppressedCount).toBe(0);
    db.close();
  });

  it('deduplica hallazgos con el mismo fingerprint dentro de un mismo scan', async () => {
    const db = ColonyDb.open(':memory:');
    const coordinator = new Coordinator(db, [
      fakeScout({ id: 'a', fingerprints: ['fp-dup'] }),
      fakeScout({ id: 'b', fingerprints: ['fp-dup'] }),
    ]);

    const outcome = await coordinator.runScan({ rootPath: '/p', mode: 'full' });

    expect(outcome.findingsCount).toBe(1);
    expect(outcome.suppressedCount).toBe(1);
    expect(db.getPheromonesByScan(outcome.scanId)).toHaveLength(1);
    db.close();
  });

  it('suprime un hallazgo cuyo fingerprint es un falso positivo conocido', async () => {
    const db = ColonyDb.open(':memory:');
    const coordinator = new Coordinator(db, [
      fakeScout({ id: 's', fingerprints: ['fp-falso', 'fp-real'] }),
    ]);

    // Scan inicial: ambos hallazgos se reportan.
    const first = await coordinator.runScan({ rootPath: '/p', mode: 'full' });
    expect(first.findingsCount).toBe(2);

    // Se confirma 'fp-falso' como falso positivo.
    db.insertPheromone(
      buildFpKnownPheromone({ scanId: first.scanId, agentId: 'tester', fingerprint: 'fp-falso' }),
    );

    // Re-scan: 'fp-falso' se suprime; 'fp-real' persiste (y ahora es 'known').
    const second = await coordinator.runScan({ rootPath: '/p', mode: 'full' });
    expect(second.findingsCount).toBe(1);
    expect(second.suppressedCount).toBe(1);

    const persisted = db.getPheromonesByScan(second.scanId).filter((p) => p.type === 'finding');
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.payload['fingerprint']).toBe('fp-real');
    expect(lifecycleOf(persisted[0]!.payload)).toBe('known');
    db.close();
  });
});

describe('Coordinator (onScoutSettled — progreso en vivo)', () => {
  it('invoca onScoutSettled una vez por cada scout disponible', async () => {
    const db = ColonyDb.open(':memory:');
    const coordinator = new Coordinator(db, [
      fakeScout({ id: 'a', findingCount: 1 }),
      fakeScout({ id: 'b', findingCount: 2 }),
      fakeScout({ id: 'c', available: false }),
    ]);

    const settled: string[] = [];
    await coordinator.runScan({
      rootPath: '/p',
      mode: 'full',
      onScoutSettled: (outcome) => settled.push(outcome.scoutId),
    });

    // 'c' no esta disponible: no corre, no notifica.
    expect(settled.sort()).toEqual(['a', 'b']);
    db.close();
  });

  it('un onScoutSettled que lanza no rompe el scan', async () => {
    const db = ColonyDb.open(':memory:');
    const coordinator = new Coordinator(db, [fakeScout({ id: 'a', findingCount: 1 })]);

    const outcome = await coordinator.runScan({
      rootPath: '/p',
      mode: 'full',
      onScoutSettled: () => {
        throw new Error('callback roto');
      },
    });

    expect(outcome.status).toBe('ok');
    expect(outcome.findingsCount).toBe(1);
    db.close();
  });
});

describe('Coordinator (kill-switch — presupuesto de tiempo, v0.4 §9.6)', () => {
  it('cancela un scout que excede su presupuesto y degrada el scan', async () => {
    const db = ColonyDb.open(':memory:');
    const coordinator = new Coordinator(db, [
      fakeScout({ id: 'sano', findingCount: 1 }),
      fakeScout({ id: 'colgado', hangs: true }),
    ]);

    const outcome = await coordinator.runScan({
      rootPath: '/p',
      mode: 'full',
      scoutTimeoutMs: 50,
    });

    expect(outcome.status).toBe('degraded');
    // El scout sano persiste sus hallazgos pese al scout colgado.
    expect(outcome.findingsCount).toBe(1);
    const hung = outcome.scouts.find((s) => s.scoutId === 'colgado');
    expect(hung?.status).toBe('failed');
    expect(hung?.error).toContain('presupuesto');
    expect(db.getPheromonesByScan(outcome.scanId)).toHaveLength(1);
    db.close();
  });

  it('un scout que termina dentro del presupuesto no se ve afectado', async () => {
    const db = ColonyDb.open(':memory:');
    const coordinator = new Coordinator(db, [fakeScout({ id: 'rapido', findingCount: 2 })]);

    const outcome = await coordinator.runScan({
      rootPath: '/p',
      mode: 'full',
      scoutTimeoutMs: 5000,
    });

    expect(outcome.status).toBe('ok');
    expect(outcome.findingsCount).toBe(2);
    db.close();
  });

  it('el signal del llamante cancela un scout colgado aunque el presupuesto sea amplio', async () => {
    const db = ColonyDb.open(':memory:');
    const coordinator = new Coordinator(db, [fakeScout({ id: 'colgado', hangs: true })]);
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 30);

    const outcome = await coordinator.runScan({
      rootPath: '/p',
      mode: 'full',
      signal: controller.signal,
      scoutTimeoutMs: 60_000,
    });

    expect(outcome.status).toBe('degraded');
    expect(outcome.scouts[0]?.status).toBe('failed');
    expect(outcome.scouts[0]?.error).toContain('llamante');
    db.close();
  });
});
