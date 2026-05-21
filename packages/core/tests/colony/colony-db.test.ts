import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { ColonyDb } from '../../src/colony/colony-db.js';
import { buildFpKnownPheromone } from '../../src/types/fp-known.js';

/** Construye un scan valido de base. */
function makeScan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: randomUUID(), startedAt: new Date().toISOString(), ...overrides };
}

/** Construye una feromona valida de base, asociada a `scanId`. */
function makePheromone(
  scanId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: randomUUID(),
    type: 'finding',
    agentId: 'opengrep',
    scanId,
    payload: { findingId: 'f-1' },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ColonyDb (base en memoria)', () => {
  it('aplica el schema y expone la version', () => {
    const db = ColonyDb.open(':memory:');
    expect(db.getSchemaVersion()).toBe('1');
    db.close();
  });

  it('inserta y recupera un scan', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    const fetched = db.getScan(String(scan['id']));
    expect(fetched?.id).toBe(scan['id']);
    expect(fetched?.finishedAt).toBeUndefined();
    db.close();
  });

  it('completeScan marca el scan como finalizado', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    const finishedAt = new Date().toISOString();
    db.completeScan(String(scan['id']), finishedAt, { scoutsRun: 1 });
    expect(db.getScan(String(scan['id']))?.finishedAt).toBe(finishedAt);
    db.close();
  });

  it('inserta un lote de feromonas y las recupera por scan', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    const scanId = String(scan['id']);
    db.insertPheromones([
      makePheromone(scanId, { payload: { findingId: 'f-1' } }),
      makePheromone(scanId, { payload: { findingId: 'f-2' } }),
    ]);
    const rows = db.getPheromonesByScan(scanId);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.decayRate).toBe(0.1); // default del schema
    expect(rows[0]?.payload).toEqual({ findingId: 'f-1' });
    db.close();
  });

  it('filtra feromonas por target y por tipo', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    const scanId = String(scan['id']);
    db.insertPheromone(makePheromone(scanId, { targetPath: 'src/a.ts', type: 'finding' }));
    db.insertPheromone(makePheromone(scanId, { targetPath: 'src/a.ts', type: 'fp_known' }));
    expect(db.getPheromonesByTarget('src/a.ts')).toHaveLength(2);
    expect(db.getPheromonesByTarget('src/a.ts', 'fp_known')).toHaveLength(1);
    db.close();
  });

  it('rechaza una feromona con un tipo invalido (validacion zod)', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    expect(() =>
      db.insertPheromone(makePheromone(String(scan['id']), { type: 'rumor' })),
    ).toThrow();
    db.close();
  });

  it('rechaza una feromona cuyo scan no existe (foreign key)', () => {
    const db = ColonyDb.open(':memory:');
    expect(() => db.insertPheromone(makePheromone(randomUUID()))).toThrow();
    db.close();
  });
});

describe('ColonyDb.getKnownFingerprints', () => {
  it('devuelve un set vacio cuando no hay feromonas', () => {
    const db = ColonyDb.open(':memory:');
    expect(db.getKnownFingerprints('finding').size).toBe(0);
    db.close();
  });

  it('extrae payload.fingerprint solo de las feromonas del tipo pedido', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    const scanId = String(scan['id']);
    db.insertPheromones([
      makePheromone(scanId, { payload: { fingerprint: 'fp-a' } }),
      makePheromone(scanId, { payload: { fingerprint: 'fp-b' } }),
    ]);
    db.insertPheromone(
      buildFpKnownPheromone({ scanId, agentId: 'tester', fingerprint: 'fp-falso' }),
    );

    expect([...db.getKnownFingerprints('finding')].sort()).toEqual(['fp-a', 'fp-b']);
    expect([...db.getKnownFingerprints('fp_known')]).toEqual(['fp-falso']);
    db.close();
  });

  it('ignora las feromonas sin fingerprint en el payload', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    // payload sin `fingerprint` (forma valida de un Pheromone, payload libre).
    db.insertPheromone(makePheromone(String(scan['id']), { payload: { findingId: 'f-1' } }));
    expect(db.getKnownFingerprints('finding').size).toBe(0);
    db.close();
  });
});

describe('ColonyDb.getPheromonesByFingerprint', () => {
  it('devuelve las feromonas de cualquier tipo con ese fingerprint', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    const scanId = String(scan['id']);
    db.insertPheromone(makePheromone(scanId, { payload: { fingerprint: 'fp-1' } }));
    db.insertPheromone(makePheromone(scanId, { payload: { fingerprint: 'fp-2' } }));
    db.insertPheromone(buildFpKnownPheromone({ scanId, agentId: 't', fingerprint: 'fp-1' }));

    const forFp1 = db.getPheromonesByFingerprint('fp-1');
    expect(forFp1.map((pheromone) => pheromone.type).sort()).toEqual(['finding', 'fp_known']);
    expect(db.getPheromonesByFingerprint('fp-2')).toHaveLength(1);
    expect(db.getPheromonesByFingerprint('fp-ausente')).toHaveLength(0);
    db.close();
  });
});

describe('ColonyDb (base en disco)', () => {
  const dbPath = join(tmpdir(), `colony-test-${randomUUID()}.db`);

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${dbPath}${suffix}`, { force: true });
    }
  });

  it('persiste los datos entre aperturas sucesivas', () => {
    const scanId = randomUUID();
    const first = ColonyDb.open(dbPath);
    first.insertScan(makeScan({ id: scanId }));
    first.close();

    const second = ColonyDb.open(dbPath);
    expect(second.getScan(scanId)?.id).toBe(scanId);
    second.close();
  });
});
