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
    expect(db.getSchemaVersion()).toBe('4');
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

describe('ColonyDb - triage verdicts (schema v2)', () => {
  /** Construye un veredicto de triage valido de base. */
  function makeVerdict(
    scanId: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: randomUUID(),
      scanId,
      fingerprint: 'fp-1',
      classification: 'true_positive',
      confidence: 0.9,
      rationale: 'riesgo real',
      agentId: 'triage',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('inserta veredictos de triage y expone sus fingerprints', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    const scanId = String(scan['id']);
    db.insertTriageVerdicts([
      makeVerdict(scanId, { fingerprint: 'fp-a' }),
      makeVerdict(scanId, { fingerprint: 'fp-b', classification: 'false_positive' }),
    ]);
    expect([...db.getTriagedFingerprints()].sort()).toEqual(['fp-a', 'fp-b']);
    db.close();
  });

  it('getTriagedFingerprints es vacio sin veredictos', () => {
    const db = ColonyDb.open(':memory:');
    expect(db.getTriagedFingerprints().size).toBe(0);
    db.close();
  });

  it('getLatestScanId devuelve el scan mas reciente', () => {
    const db = ColonyDb.open(':memory:');
    expect(db.getLatestScanId()).toBeUndefined();
    const older = randomUUID();
    const newer = randomUUID();
    db.insertScan(makeScan({ id: older, startedAt: '2026-05-21T10:00:00.000Z' }));
    db.insertScan(makeScan({ id: newer, startedAt: '2026-05-21T12:00:00.000Z' }));
    expect(db.getLatestScanId()).toBe(newer);
    db.close();
  });

  it('rechaza un veredicto con confianza fuera de rango (validacion zod)', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    expect(() =>
      db.insertTriageVerdicts([makeVerdict(String(scan['id']), { confidence: 5 })]),
    ).toThrow();
    db.close();
  });

  it('getTriageVerdicts devuelve los registros insertados', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    db.insertTriageVerdicts([
      makeVerdict(String(scan['id']), { fingerprint: 'fp-a', rationale: 'motivo a' }),
    ]);
    const verdicts = db.getTriageVerdicts();
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.fingerprint).toBe('fp-a');
    expect(verdicts[0]?.rationale).toBe('motivo a');
    db.close();
  });
});

describe('ColonyDb - context explanations (schema v3)', () => {
  /** Construye una explicacion de contexto valida de base. */
  function makeExplanation(
    scanId: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: randomUUID(),
      scanId,
      fingerprint: 'fp-1',
      summary: 'eval sobre entrada del usuario',
      entryPoint: 'req.query.expr',
      sink: 'eval()',
      exposure: 'ejecucion de codigo arbitrario',
      agentId: 'context',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('inserta explicaciones de contexto y las recupera', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    db.insertContextExplanations([
      makeExplanation(String(scan['id']), { fingerprint: 'fp-a', sink: 'exec()' }),
    ]);
    const explanations = db.getContextExplanations();
    expect(explanations).toHaveLength(1);
    expect(explanations[0]?.fingerprint).toBe('fp-a');
    expect(explanations[0]?.sink).toBe('exec()');
    db.close();
  });

  it('getContextExplanations es vacio sin explicaciones', () => {
    const db = ColonyDb.open(':memory:');
    expect(db.getContextExplanations()).toHaveLength(0);
    db.close();
  });

  it('rechaza una explicacion con un campo vacio (validacion zod)', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    expect(() =>
      db.insertContextExplanations([makeExplanation(String(scan['id']), { sink: '' })]),
    ).toThrow();
    db.close();
  });
});

describe('ColonyDb - remediation suggestions (schema v4)', () => {
  /** Construye una sugerencia de remediacion valida de base. */
  function makeSuggestion(
    scanId: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: randomUUID(),
      scanId,
      fingerprint: 'fp-1',
      summary: 'parametrizar la consulta',
      recommendation: 'usar consultas preparadas en vez de concatenar el input',
      agentId: 'remediation',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('inserta sugerencias de remediacion y las recupera', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    db.insertRemediationSuggestions([
      makeSuggestion(String(scan['id']), { fingerprint: 'fp-a', fixedSnippet: 'q(sql, [id])' }),
    ]);
    const suggestions = db.getRemediationSuggestions();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.fingerprint).toBe('fp-a');
    expect(suggestions[0]?.fixedSnippet).toBe('q(sql, [id])');
    db.close();
  });

  it('persiste una sugerencia sin fixedSnippet (columna opcional)', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    db.insertRemediationSuggestions([makeSuggestion(String(scan['id']))]);
    expect(db.getRemediationSuggestions()[0]?.fixedSnippet).toBeUndefined();
    db.close();
  });

  it('getRemediationSuggestions es vacio sin sugerencias', () => {
    const db = ColonyDb.open(':memory:');
    expect(db.getRemediationSuggestions()).toHaveLength(0);
    db.close();
  });

  it('rechaza una sugerencia con un campo requerido vacio (validacion zod)', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    expect(() =>
      db.insertRemediationSuggestions([makeSuggestion(String(scan['id']), { recommendation: '' })]),
    ).toThrow();
    db.close();
  });
});

describe('ColonyDb - learning records (v0.4 §3.5)', () => {
  it('registra un patron nuevo con evidenceCount 1', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    db.recordLearningBatch(
      [{ signature: 'SAST:eval', classification: 'real_pattern' }],
      String(scan['id']),
    );
    const records = db.getLearningRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.patternSignature).toBe('SAST:eval');
    expect(records[0]?.classification).toBe('real_pattern');
    expect(records[0]?.evidenceCount).toBe(1);
    db.close();
  });

  it('acumula evidenceCount al repetir el mismo patron y clasificacion', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    const scanId = String(scan['id']);
    db.recordLearningBatch(
      [
        { signature: 'SAST:eval', classification: 'real_pattern' },
        { signature: 'SAST:eval', classification: 'real_pattern' },
      ],
      scanId,
    );
    // Segundo lote, como en una corrida de triage posterior.
    db.recordLearningBatch([{ signature: 'SAST:eval', classification: 'real_pattern' }], scanId);
    const records = db.getLearningRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.evidenceCount).toBe(3);
    db.close();
  });

  it('mantiene registros separados por clasificacion del mismo patron', () => {
    const db = ColonyDb.open(':memory:');
    const scan = makeScan();
    db.insertScan(scan);
    db.recordLearningBatch(
      [
        { signature: 'SAST:eval', classification: 'real_pattern' },
        { signature: 'SAST:eval', classification: 'fp_pattern' },
      ],
      String(scan['id']),
    );
    expect(db.getLearningRecords()).toHaveLength(2);
    db.close();
  });

  it('un lote vacio es un no-op y getLearningRecords arranca vacio', () => {
    const db = ColonyDb.open(':memory:');
    db.recordLearningBatch([], 'scan-x');
    expect(db.getLearningRecords()).toHaveLength(0);
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

  describe('ColonyDb.open — diagnóstico defensivo (DG-092 A)', () => {
    it('lanza un error accionable cuando el directorio parent no existe', () => {
      const fakePath = join(tmpdir(), 'does-not-exist-' + randomUUID(), 'colony.db');
      expect(() => ColonyDb.open(fakePath)).toThrow(/parent directory.*does not exist/);
    });

    it('el mensaje de error incluye el path absoluto solicitado', () => {
      const fakePath = join(tmpdir(), 'does-not-exist-' + randomUUID(), 'colony.db');
      const err = (() => {
        try {
          ColonyDb.open(fakePath);
          return null;
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      })();
      expect(err).not.toBeNull();
      // El path completo aparece textual en el mensaje.
      expect(err).toContain(fakePath);
    });

    it(':memory: sigue funcionando sin pre-flight de directorio (legacy contract)', () => {
      // El path-mágico ':memory:' es el contrato de sqlite para una DB en RAM.
      // Pre-flight de directorio NO debe disparar para este caso.
      const db = ColonyDb.open(':memory:');
      expect(db.getSchemaVersion()).toBe('4');
      db.close();
    });
  });

  describe('clearTriageDataForFingerprints + getLatestTriageSessionTimestamp — DG-107 A', () => {
    function seedFullTriageSession(
      db: ColonyDb,
      fingerprints: readonly string[],
    ): {
      scanId: string;
      sessionId: string;
    } {
      const scanId = randomUUID();
      db.insertScan({ id: scanId, startedAt: '2026-05-28T10:00:00.000Z' });
      const sessionId = randomUUID();
      const now = '2026-05-28T11:00:00.000Z';
      db.insertTriageVerdicts(
        fingerprints.map((fp) => ({
          id: randomUUID(),
          scanId,
          fingerprint: fp,
          classification: 'true_positive',
          confidence: 0.9,
          rationale: 'r',
          agentId: 'triage',
          createdAt: now,
        })),
      );
      db.insertContextExplanations(
        fingerprints.map((fp) => ({
          id: randomUUID(),
          scanId,
          fingerprint: fp,
          summary: 's',
          entryPoint: 'e',
          sink: 'k',
          exposure: 'x',
          agentId: 'context',
          createdAt: now,
        })),
      );
      db.insertRemediationSuggestions(
        fingerprints.map((fp) => ({
          id: randomUUID(),
          scanId,
          fingerprint: fp,
          summary: 's',
          recommendation: 'r',
          agentId: 'remediation',
          createdAt: now,
        })),
      );
      db.insertTokenUsages(
        fingerprints.map((fp) => ({
          id: randomUUID(),
          triageSessionId: sessionId,
          scanId,
          fingerprint: fp,
          providerLabel: 'anthropic/claude-haiku',
          agentId: 'triage' as const,
          inputTokens: 100,
          outputTokens: 50,
          estimatedCostUsd: 0.01,
          latencyMs: 1000,
          createdAt: now,
        })),
      );
      return { scanId, sessionId };
    }

    it('borra verdicts + contexts + remediations para los fingerprints dados; preserva fp_known + token_usage', () => {
      const db = ColonyDb.open(':memory:');
      const { scanId } = seedFullTriageSession(db, ['fp-1', 'fp-2', 'fp-3']);
      // mark-fp manual para fp-1 (NO debe perderse)
      db.insertPheromone(buildFpKnownPheromone({ scanId, agentId: 'user', fingerprint: 'fp-1' }));

      const deleted = db.clearTriageDataForFingerprints(['fp-1', 'fp-2', 'fp-3']);

      // 3 verdicts + 3 contexts + 3 remediations = 9 rows
      expect(deleted).toBe(9);
      expect(db.getTriagedFingerprints().size).toBe(0);
      expect(db.getContextExplanations()).toHaveLength(0);
      expect(db.getRemediationSuggestions()).toHaveLength(0);
      // PRESERVADOS:
      expect([...db.getKnownFingerprints('fp_known')]).toContain('fp-1');
      expect(db.getCostHistory(10)).toHaveLength(1); // token_usage rollup intacto
      db.close();
    });

    it('no borra verdicts de fingerprints que NO estan en la lista', () => {
      const db = ColonyDb.open(':memory:');
      seedFullTriageSession(db, ['fp-keep-1', 'fp-clear', 'fp-keep-2']);

      const deleted = db.clearTriageDataForFingerprints(['fp-clear']);

      expect(deleted).toBe(3); // 1 verdict + 1 context + 1 remediation
      expect([...db.getTriagedFingerprints()].sort()).toEqual(['fp-keep-1', 'fp-keep-2']);
      db.close();
    });

    it('devuelve 0 cuando la lista de fingerprints esta vacia (no-op)', () => {
      const db = ColonyDb.open(':memory:');
      seedFullTriageSession(db, ['fp-1']);
      expect(db.clearTriageDataForFingerprints([])).toBe(0);
      expect(db.getTriagedFingerprints().size).toBe(1);
      db.close();
    });

    it('getLatestTriageSessionTimestamp devuelve undefined sin token_usage', () => {
      const db = ColonyDb.open(':memory:');
      expect(db.getLatestTriageSessionTimestamp()).toBeUndefined();
      db.close();
    });

    it('getLatestTriageSessionTimestamp devuelve el created_at mas reciente', () => {
      const db = ColonyDb.open(':memory:');
      const scanId = randomUUID();
      db.insertScan({ id: scanId, startedAt: '2026-05-28T10:00:00.000Z' });
      const sessionId = randomUUID();
      db.insertTokenUsages([
        {
          id: randomUUID(),
          triageSessionId: sessionId,
          scanId,
          fingerprint: 'fp-1',
          providerLabel: 'anthropic/claude-haiku',
          agentId: 'triage',
          inputTokens: 100,
          outputTokens: 50,
          estimatedCostUsd: 0.01,
          latencyMs: 1000,
          createdAt: '2026-05-28T11:00:00.000Z',
        },
        {
          id: randomUUID(),
          triageSessionId: sessionId,
          scanId,
          fingerprint: 'fp-2',
          providerLabel: 'anthropic/claude-haiku',
          agentId: 'triage',
          inputTokens: 100,
          outputTokens: 50,
          estimatedCostUsd: 0.01,
          latencyMs: 1000,
          createdAt: '2026-05-28T14:35:00.000Z', // mas reciente
        },
      ]);
      expect(db.getLatestTriageSessionTimestamp()).toBe('2026-05-28T14:35:00.000Z');
      db.close();
    });
  });

  describe('getCostHistory order — DG-105 A', () => {
    it('ordena por workflow del Brain Layer: triage → context → remediation', () => {
      const db = ColonyDb.open(':memory:');
      const scanId = randomUUID();
      db.insertScan({ id: scanId, startedAt: new Date().toISOString() });
      const sessionId = randomUUID();
      const baseRecord = {
        triageSessionId: sessionId,
        scanId,
        fingerprint: 'fp-test',
        providerLabel: 'anthropic/claude-haiku-4-5-20251001',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 1000,
        createdAt: new Date().toISOString(),
      };
      // Inserto en orden REMEDIATION → TRIAGE → CONTEXT a propósito,
      // con distintos cost USD, para garantizar que el orden de salida NO
      // dependa del orden de insercion ni del cost (la SQL antigua los
      // ordenaba por estimated_cost_usd DESC, que producia ordenes
      // contraintuitivos observados empíricamente en captura v0.3.9).
      db.insertTokenUsages([
        {
          id: randomUUID(),
          ...baseRecord,
          agentId: 'remediation',
          estimatedCostUsd: 0.05, // El mas alto — al usar cost DESC seria el primero.
        },
        {
          id: randomUUID(),
          ...baseRecord,
          agentId: 'triage',
          estimatedCostUsd: 0.01,
        },
        {
          id: randomUUID(),
          ...baseRecord,
          agentId: 'context',
          estimatedCostUsd: 0.03,
        },
      ]);
      const rows = db.getCostHistory(10);
      expect(rows.map((r) => r.agentId)).toEqual(['triage', 'context', 'remediation']);
      db.close();
    });

    it('dentro de cada agente, ordena por provider_label estable (multi-provider)', () => {
      const db = ColonyDb.open(':memory:');
      const scanId = randomUUID();
      db.insertScan({ id: scanId, startedAt: new Date().toISOString() });
      const sessionId = randomUUID();
      const baseRecord = {
        triageSessionId: sessionId,
        scanId,
        fingerprint: 'fp-test',
        agentId: 'triage' as const,
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.01,
        latencyMs: 1000,
        createdAt: new Date().toISOString(),
      };
      db.insertTokenUsages([
        { id: randomUUID(), ...baseRecord, providerLabel: 'zzz/last' },
        { id: randomUUID(), ...baseRecord, providerLabel: 'aaa/first' },
        { id: randomUUID(), ...baseRecord, providerLabel: 'mmm/middle' },
      ]);
      const rows = db.getCostHistory(10);
      expect(rows.map((r) => r.providerLabel)).toEqual(['aaa/first', 'mmm/middle', 'zzz/last']);
      db.close();
    });
  });
});
