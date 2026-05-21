import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ColonyDb, buildFpKnownPheromone } from '@synaptic-sentinel/core';
import type { LlmClient } from '@synaptic-sentinel/agents';
import { runTriageCommand } from '../src/commands/triage.js';

/** LlmClient falso: devuelve siempre un veredicto JSON valido. */
function fakeLlm(): LlmClient {
  return {
    complete: () =>
      Promise.resolve(
        '{"classification":"true_positive","confidence":0.8,"rationale":"motivo de prueba"}',
      ),
  };
}

/** Crea un colony.db con un scan y un finding pheromone por fingerprint. */
function seedDb(projectRoot: string, fingerprints: readonly string[]): string {
  mkdirSync(join(projectRoot, '.synaptic-sentinel'), { recursive: true });
  const db = ColonyDb.open(join(projectRoot, '.synaptic-sentinel', 'colony.db'));
  const scanId = randomUUID();
  db.insertScan({ id: scanId, startedAt: new Date().toISOString() });
  db.insertPheromones(
    fingerprints.map((fingerprint, i) => ({
      id: randomUUID(),
      type: 'finding',
      agentId: 'opengrep',
      scanId,
      payload: {
        id: randomUUID(),
        scanId,
        scoutId: 'opengrep',
        severity: 'high',
        category: 'SAST',
        ruleId: 'r',
        title: `hallazgo-${String(i)}`,
        message: 'mensaje',
        location: { path: `src/f${String(i)}.js`, startLine: 1 },
        complianceRefs: [],
        fingerprint,
        lifecycleState: 'new',
        createdAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    })),
  );
  db.close();
  return scanId;
}

/** Abre el colony.db de un proyecto sembrado. */
function openDb(projectRoot: string): ColonyDb {
  return ColonyDb.open(join(projectRoot, '.synaptic-sentinel', 'colony.db'));
}

describe('runTriageCommand', () => {
  let root = '';
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('tria los hallazgos del ultimo scan y persiste los veredictos', async () => {
    root = join(tmpdir(), `triage-${randomUUID()}`);
    seedDb(root, ['fp-1', 'fp-2']);

    expect(await runTriageCommand({ path: root, llmClient: fakeLlm() })).toBe(0);

    const db = openDb(root);
    expect([...db.getTriagedFingerprints()].sort()).toEqual(['fp-1', 'fp-2']);
    db.close();
  });

  it('salta los hallazgos con fp_known (economia de tokens)', async () => {
    root = join(tmpdir(), `triage-${randomUUID()}`);
    const scanId = seedDb(root, ['fp-keep', 'fp-skip']);
    const seeded = openDb(root);
    seeded.insertPheromone(
      buildFpKnownPheromone({ scanId, agentId: 'tester', fingerprint: 'fp-skip' }),
    );
    seeded.close();

    let calls = 0;
    const countingLlm: LlmClient = {
      complete: () => {
        calls += 1;
        return Promise.resolve(
          '{"classification":"true_positive","confidence":0.5,"rationale":"r"}',
        );
      },
    };
    await runTriageCommand({ path: root, llmClient: countingLlm });

    expect(calls).toBe(1); // solo fp-keep
    const db = openDb(root);
    expect([...db.getTriagedFingerprints()]).toEqual(['fp-keep']);
    db.close();
  });

  it('no vuelve a triar un hallazgo ya triado', async () => {
    root = join(tmpdir(), `triage-${randomUUID()}`);
    seedDb(root, ['fp-1']);
    await runTriageCommand({ path: root, llmClient: fakeLlm() });

    let calls = 0;
    const countingLlm: LlmClient = {
      complete: () => {
        calls += 1;
        return Promise.resolve(
          '{"classification":"true_positive","confidence":0.5,"rationale":"r"}',
        );
      },
    };
    await runTriageCommand({ path: root, llmClient: countingLlm });
    expect(calls).toBe(0);
  });

  it('respeta el --limit', async () => {
    root = join(tmpdir(), `triage-${randomUUID()}`);
    seedDb(root, ['fp-1', 'fp-2', 'fp-3']);
    await runTriageCommand({ path: root, llmClient: fakeLlm(), limit: 2 });

    const db = openDb(root);
    expect(db.getTriagedFingerprints().size).toBe(2);
    db.close();
  });

  it('falla si no hay colony.db en el proyecto', async () => {
    root = join(tmpdir(), `triage-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    expect(await runTriageCommand({ path: root, llmClient: fakeLlm() })).toBe(1);
  });
});
