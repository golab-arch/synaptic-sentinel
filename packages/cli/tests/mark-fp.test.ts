import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ColonyDb } from '@synaptic-sentinel/core';
import { runMarkFpCommand } from '../src/commands/mark-fp.js';

/** Crea un colony.db con un scan y un finding pheromone con el fingerprint dado. */
function seedDb(projectRoot: string, fingerprint: string): void {
  mkdirSync(join(projectRoot, '.synaptic-sentinel'), { recursive: true });
  const db = ColonyDb.open(join(projectRoot, '.synaptic-sentinel', 'colony.db'));
  const scanId = randomUUID();
  db.insertScan({ id: scanId, startedAt: new Date().toISOString() });
  db.insertPheromone({
    id: randomUUID(),
    type: 'finding',
    agentId: 'opengrep',
    scanId,
    payload: { fingerprint },
    createdAt: new Date().toISOString(),
  });
  db.close();
}

describe('runMarkFpCommand', () => {
  let root = '';
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('marca un hallazgo existente como falso positivo', () => {
    root = join(tmpdir(), `markfp-${randomUUID()}`);
    seedDb(root, 'fp-objetivo');

    expect(runMarkFpCommand({ path: root, fingerprint: 'fp-objetivo' })).toBe(0);

    const db = ColonyDb.open(join(root, '.synaptic-sentinel', 'colony.db'));
    expect([...db.getKnownFingerprints('fp_known')]).toContain('fp-objetivo');
    db.close();
  });

  it('es idempotente: marcar dos veces no duplica la feromona fp_known', () => {
    root = join(tmpdir(), `markfp-${randomUUID()}`);
    seedDb(root, 'fp-objetivo');

    expect(runMarkFpCommand({ path: root, fingerprint: 'fp-objetivo' })).toBe(0);
    expect(runMarkFpCommand({ path: root, fingerprint: 'fp-objetivo' })).toBe(0);

    const db = ColonyDb.open(join(root, '.synaptic-sentinel', 'colony.db'));
    const fpKnown = db
      .getPheromonesByFingerprint('fp-objetivo')
      .filter((pheromone) => pheromone.type === 'fp_known');
    expect(fpKnown).toHaveLength(1);
    db.close();
  });

  it('falla si no existe un hallazgo con ese fingerprint', () => {
    root = join(tmpdir(), `markfp-${randomUUID()}`);
    seedDb(root, 'fp-objetivo');
    expect(runMarkFpCommand({ path: root, fingerprint: 'fp-inexistente' })).toBe(1);
  });

  it('falla si no hay colony.db en el proyecto', () => {
    root = join(tmpdir(), `markfp-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    expect(runMarkFpCommand({ path: root, fingerprint: 'x' })).toBe(1);
  });
});
