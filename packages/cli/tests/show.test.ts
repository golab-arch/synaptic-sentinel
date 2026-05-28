import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ColonyDb } from '@synaptic-sentinel/core';
import { runShowCommand } from '../src/commands/show.js';

/**
 * Crea un colony.db con un scan + N findings + opcionalmente verdictos
 * de triage / explicaciones / remediaciones para testear que `show`
 * reconstruye el tomo completo.
 */
function seedDb(
  projectRoot: string,
  opts: {
    findings?: Array<{ fingerprint: string; ruleId?: string; severity?: string }>;
    triage?: Array<{ fingerprint: string; classification: string; confidence: number }>;
    context?: Array<{ fingerprint: string; summary: string }>;
    remediation?: Array<{ fingerprint: string; summary: string; recommendation: string }>;
    legacy?: boolean;
  } = {},
): string {
  const dirname = opts.legacy === true ? '.synaptic-sentinel' : '.sentinel';
  mkdirSync(join(projectRoot, dirname), { recursive: true });
  const db = ColonyDb.open(join(projectRoot, dirname, 'colony.db'));
  const scanId = randomUUID();
  db.insertScan({ id: scanId, startedAt: '2026-05-28T10:00:00.000Z' });
  for (const f of opts.findings ?? []) {
    db.insertPheromone({
      id: randomUUID(),
      type: 'finding',
      agentId: 'opengrep',
      scanId,
      payload: {
        id: randomUUID(),
        scanId,
        scoutId: 'opengrep',
        category: 'SAST',
        ruleId: f.ruleId ?? 'sentinel-test-rule',
        title: 'Test finding',
        message: 'a test finding',
        severity: f.severity ?? 'high',
        location: { path: 'src/foo.js', startLine: 1 },
        fingerprint: f.fingerprint,
        complianceRefs: [],
        lifecycleState: 'new',
        createdAt: '2026-05-28T10:00:00.000Z',
      },
      createdAt: new Date().toISOString(),
    });
  }
  if (opts.triage !== undefined) {
    db.insertTriageVerdicts(
      opts.triage.map((t) => ({
        id: randomUUID(),
        scanId,
        fingerprint: t.fingerprint,
        classification: t.classification,
        confidence: t.confidence,
        rationale: 'test',
        agentId: 'triage',
        createdAt: new Date().toISOString(),
      })),
    );
  }
  if (opts.context !== undefined) {
    db.insertContextExplanations(
      opts.context.map((c) => ({
        id: randomUUID(),
        scanId,
        fingerprint: c.fingerprint,
        summary: c.summary,
        entryPoint: 'req.body',
        sink: 'eval()',
        exposure: 'remote',
        agentId: 'context',
        createdAt: new Date().toISOString(),
      })),
    );
  }
  if (opts.remediation !== undefined) {
    db.insertRemediationSuggestions(
      opts.remediation.map((r) => ({
        id: randomUUID(),
        scanId,
        fingerprint: r.fingerprint,
        summary: r.summary,
        recommendation: r.recommendation,
        agentId: 'remediation',
        createdAt: new Date().toISOString(),
      })),
    );
  }
  db.close();
  return scanId;
}

describe('runShowCommand — DG-103 A', () => {
  let root = '';
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('devuelve exit 1 si no hay colony.db en el workspace', () => {
    root = join(tmpdir(), `show-noinit-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    expect(runShowCommand({ path: root })).toBe(1);
  });

  it('devuelve exit 1 si colony.db existe pero no tiene scans', () => {
    root = join(tmpdir(), `show-emptydb-${randomUUID()}`);
    mkdirSync(join(root, '.sentinel'), { recursive: true });
    const db = ColonyDb.open(join(root, '.sentinel', 'colony.db'));
    db.close();
    expect(runShowCommand({ path: root })).toBe(1);
  });

  it('exporta el tomo del scan mas reciente con findings pero sin triage', () => {
    root = join(tmpdir(), `show-noeval-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    seedDb(root, {
      findings: [{ fingerprint: 'fp-1' }, { fingerprint: 'fp-2' }],
    });
    const target = join(root, 'tomo.json');
    expect(runShowCommand({ path: root, exportPath: target })).toBe(0);
    const raw = JSON.parse(readFileSync(target, 'utf8'));
    expect(raw.findings).toHaveLength(2);
    expect(raw.findings[0].fingerprint).toBeTypeOf('string');
    expect(raw.findings[0].triage).toBeUndefined();
  });

  it('enriquece el tomo con triage + context + remediation cuando estan en colony.db', () => {
    root = join(tmpdir(), `show-enriched-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    seedDb(root, {
      findings: [{ fingerprint: 'fp-1' }],
      triage: [{ fingerprint: 'fp-1', classification: 'true_positive', confidence: 0.95 }],
      context: [{ fingerprint: 'fp-1', summary: 'attack chain X' }],
      remediation: [
        { fingerprint: 'fp-1', summary: 'fix Y', recommendation: 'use parameterized queries' },
      ],
    });
    const target = join(root, 'tomo.json');
    expect(runShowCommand({ path: root, exportPath: target })).toBe(0);
    const raw = JSON.parse(readFileSync(target, 'utf8'));
    expect(raw.findings).toHaveLength(1);
    expect(raw.findings[0].triage.classification).toBe('true_positive');
    expect(raw.findings[0].context.summary).toBe('attack chain X');
    expect(raw.findings[0].remediation.summary).toBe('fix Y');
  });

  it('lee del legacy .synaptic-sentinel/colony.db si es el unico presente (DG-093 A)', () => {
    root = join(tmpdir(), `show-legacy-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    seedDb(root, { findings: [{ fingerprint: 'fp-legacy' }], legacy: true });
    const target = join(root, 'tomo.json');
    expect(runShowCommand({ path: root, exportPath: target })).toBe(0);
    const raw = JSON.parse(readFileSync(target, 'utf8'));
    expect(raw.findings).toHaveLength(1);
    expect(raw.findings[0].fingerprint).toBe('fp-legacy');
  });
});
