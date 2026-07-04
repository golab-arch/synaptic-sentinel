import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ColonyDb, buildFpKnownPheromone } from '@synaptic-sentinel/core';
import type { LlmClient } from '@synaptic-sentinel/agents';
import { runTriageCommand } from '../src/commands/triage.js';

/**
 * LlmClient falso: responde segun el agente que pregunta. El Context Agent
 * pide la "exploitability chain" en su system prompt; el Triage no.
 */
function fakeLlm(): LlmClient {
  return {
    complete: (request) =>
      Promise.resolve(
        request.system.includes('exploitability chain')
          ? '{"summary":"s","entryPoint":"e","sink":"k","exposure":"x"}'
          : '{"classification":"true_positive","confidence":0.8,"rationale":"motivo de prueba"}',
      ),
  };
}

/** Crea un colony.db con un scan y un finding pheromone por fingerprint. */
function seedDb(projectRoot: string, fingerprints: readonly string[]): string {
  // DG-093 A: tests siembran en el nuevo path .sentinel/ (preferred).
  mkdirSync(join(projectRoot, '.sentinel'), { recursive: true });
  const db = ColonyDb.open(join(projectRoot, '.sentinel', 'colony.db'));
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
  return ColonyDb.open(join(projectRoot, '.sentinel', 'colony.db'));
}

describe('runTriageCommand', () => {
  let root = '';
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('tria los hallazgos del ultimo scan y persiste los veredictos', async () => {
    root = join(tmpdir(), `triage-${randomUUID()}`);
    seedDb(root, ['fp-1', 'fp-2']);

    // DG-131 A Sub-A2: noGroup=true preserva la semántica pre-grouping
    // (cada finding → 1 context call). Sin noGroup, los 2 findings con
    // mismo ruleId 'r' se agrupan y solo el representative obtiene context.
    expect(await runTriageCommand({ path: root, llmClient: fakeLlm(), noGroup: true })).toBe(0);

    const db = openDb(root);
    expect([...db.getTriagedFingerprints()].sort()).toEqual(['fp-1', 'fp-2']);
    // Ambos hallazgos clasificados true_positive => el Context Agent corrio.
    expect(db.getContextExplanations()).toHaveLength(2);
    db.close();
  });

  /**
   * DG-131 A Sub-A2 (Cycle 117 FASE III R20): sin noGroup, findings con
   * mismo ruleId + package se agrupan. Solo el representative obtiene
   * context explanation. Los members reciben verdict propagado con
   * confidence downgrade + rationale suffix.
   */
  it('agrupa findings con mismo ruleId + representative obtiene 1 context call', async () => {
    root = join(tmpdir(), `triage-group-${randomUUID()}`);
    seedDb(root, ['fp-grouped-1', 'fp-grouped-2', 'fp-grouped-3']);

    expect(await runTriageCommand({ path: root, llmClient: fakeLlm() })).toBe(0);

    const db = openDb(root);
    expect([...db.getTriagedFingerprints()].sort()).toEqual([
      'fp-grouped-1',
      'fp-grouped-2',
      'fp-grouped-3',
    ]);
    // Solo el representative obtiene context (no propagado a members).
    expect(db.getContextExplanations()).toHaveLength(1);
    const verdicts = db.getTriageVerdicts();
    expect(verdicts).toHaveLength(3);
    // Todos deben compartir groupId + tener el mismo classification.
    const groupIds = new Set(verdicts.map((v) => v.groupId));
    expect(groupIds.size).toBe(1);
    expect([...groupIds][0]).toBeDefined();
    // Exactly 1 representative + 2 members.
    const reps = verdicts.filter((v) => v.isGroupRepresentative === true);
    const members = verdicts.filter((v) => v.isGroupRepresentative === false);
    expect(reps).toHaveLength(1);
    expect(members).toHaveLength(2);
    // Members tienen confidence downgraded (< representative).
    const repConf = reps[0]?.confidence ?? 0;
    for (const m of members) {
      expect(m.confidence).toBeLessThan(repConf);
    }
    // Members incluyen tag "member N of M" en el rationale.
    for (const m of members) {
      expect(m.rationale).toContain('group');
      expect(m.rationale).toMatch(/member \d+ of 3/);
    }
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
        // Veredicto false_positive: no dispara el Context Agent, asi el
        // contador refleja solo las llamadas de triage.
        return Promise.resolve(
          '{"classification":"false_positive","confidence":0.5,"rationale":"r"}',
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
        // Veredicto false_positive: no dispara el Context Agent, asi el
        // contador refleja solo las llamadas de triage.
        return Promise.resolve(
          '{"classification":"false_positive","confidence":0.5,"rationale":"r"}',
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
