import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ColonyDb } from '@synaptic-sentinel/core';
import { runDiffCommand } from '../src/commands/diff.js';

/**
 * DG-132 A Sub-A2 (Cycle 118 FASE III R22): tests para el CLI `diff` command.
 * Verifica structured JSON output + reason breakdown + threshold config.
 */

function seedDbWithHistory(
  projectRoot: string,
  history: Array<{
    fingerprint: string;
    classification: 'true_positive' | 'false_positive' | 'inconclusive';
    confidence: number;
    providerLabel: string;
    createdAt: string;
    ruleId?: string;
    severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  }>,
): void {
  mkdirSync(join(projectRoot, '.sentinel'), { recursive: true });
  const db = ColonyDb.open(join(projectRoot, '.sentinel', 'colony.db'));
  const scanId = randomUUID();
  db.insertScan({ id: scanId, startedAt: '2026-07-01T00:00:00.000Z' });
  // Insert pheromones (findings) — one per unique fingerprint
  const uniqueFps = new Set(history.map((h) => h.fingerprint));
  for (const fp of uniqueFps) {
    const entry = history.find((h) => h.fingerprint === fp);
    if (!entry) continue;
    db.insertPheromone({
      id: randomUUID(),
      type: 'finding',
      agentId: 'test',
      scanId,
      payload: {
        id: randomUUID(),
        scanId,
        scoutId: 'test',
        category: 'SAST',
        ruleId: entry.ruleId ?? 'test-rule',
        title: 'Test finding',
        message: 'test',
        severity: entry.severity ?? 'high',
        location: { path: 'src/test.ts', startLine: 1 },
        complianceRefs: [],
        fingerprint: fp,
        lifecycleState: 'new',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      createdAt: '2026-07-01T00:00:00.000Z',
    });
  }
  db.insertVerdictHistoryBatch(
    history.map((h) => ({
      id: randomUUID(),
      scanId,
      fingerprint: h.fingerprint,
      classification: h.classification,
      confidence: h.confidence,
      rationale: 'test rationale',
      providerLabel: h.providerLabel,
      agentId: 'triage',
      createdAt: h.createdAt,
    })),
  );
  db.close();
}

describe('runDiffCommand — DG-132 A Sub-A2', () => {
  let root = '';
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    logSpy?.mockRestore();
    errorSpy?.mockRestore();
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('emite JSON structured con summary + reason breakdown', () => {
    root = join(tmpdir(), `diff-${randomUUID()}`);
    seedDbWithHistory(root, [
      // fp-class: TP → FP (class changed)
      {
        fingerprint: 'fp-class',
        classification: 'true_positive',
        confidence: 0.9,
        providerLabel: 'deepseek/x',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        fingerprint: 'fp-class',
        classification: 'false_positive',
        confidence: 0.9,
        providerLabel: 'deepseek/x',
        createdAt: '2026-07-02T00:00:00.000Z',
      },
      // fp-conf: INC → INC with confidence delta 0.30
      {
        fingerprint: 'fp-conf',
        classification: 'inconclusive',
        confidence: 0.9,
        providerLabel: 'deepseek/x',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        fingerprint: 'fp-conf',
        classification: 'inconclusive',
        confidence: 0.6,
        providerLabel: 'deepseek/x',
        createdAt: '2026-07-02T00:00:00.000Z',
      },
    ]);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitCode = runDiffCommand({ path: root });
    expect(exitCode).toBe(0);
    const output = String(logSpy.mock.calls[0]?.[0]);
    const parsed = JSON.parse(output);
    expect(parsed.summary).toEqual({
      newFindings: 0,
      reclassified: 2,
      unchanged: 0,
    });
    expect(parsed.reclassifiedByReason).toEqual({
      classChanged: 1,
      confidenceDelta: 1,
      providerChanged: 0,
    });
    expect(parsed.reclassified).toHaveLength(2);
    const byFp = new Map(
      parsed.reclassified.map((r: { fingerprint: string }) => [r.fingerprint, r]),
    );
    expect(byFp.get('fp-class')).toMatchObject({
      reason: 'class-changed',
      from: 'true_positive',
      to: 'false_positive',
    });
    expect(byFp.get('fp-conf')).toMatchObject({
      reason: 'confidence-delta',
      confidenceDelta: expect.any(Number),
    });
  });

  it('confidence-delta-threshold custom cambia la clasificación', () => {
    root = join(tmpdir(), `diff-thresh-${randomUUID()}`);
    seedDbWithHistory(root, [
      {
        fingerprint: 'fp-small',
        classification: 'inconclusive',
        confidence: 0.9,
        providerLabel: 'deepseek/x',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        fingerprint: 'fp-small',
        classification: 'inconclusive',
        confidence: 0.85, // delta 0.05
        providerLabel: 'deepseek/x',
        createdAt: '2026-07-02T00:00:00.000Z',
      },
    ]);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // default threshold 0.15 — 0.05 delta stays unchanged
    runDiffCommand({ path: root });
    let output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
    expect(output.summary.reclassified).toBe(0);
    expect(output.summary.unchanged).toBe(1);
    logSpy.mockClear();
    // custom threshold 0.03 — 0.05 delta triggers reclassified
    runDiffCommand({ path: root, confidenceDeltaThreshold: 0.03 });
    output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
    expect(output.summary.reclassified).toBe(1);
    expect(output.reclassifiedByReason.confidenceDelta).toBe(1);
  });

  it('exit code 1 si no hay colony.db', () => {
    root = join(tmpdir(), `diff-empty-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitCode = runDiffCommand({ path: root });
    expect(exitCode).toBe(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain('No colony.db');
  });
});
