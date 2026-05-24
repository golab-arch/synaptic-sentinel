import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BenchmarkGroundTruthSchema,
  countByReviewStatus,
  GROUND_TRUTH_PATH,
  type BenchmarkGroundTruth,
  type GroundTruthEntry,
} from '../../src/config/benchmark-ground-truth.js';

/** Carga el dataset real desde el repo (cross-package, via path absoluto). */
function loadRealGroundTruth(): BenchmarkGroundTruth {
  // El test corre desde packages/core/; el dataset vive en
  // <repo>/tests/benchmark/ground-truth.json.
  const repoRoot = join(__dirname, '..', '..', '..', '..');
  const raw = readFileSync(join(repoRoot, GROUND_TRUTH_PATH), 'utf8');
  return BenchmarkGroundTruthSchema.parse(JSON.parse(raw));
}

/** Construye una entry minima valida para tests aislados del schema. */
function makeEntry(overrides: Partial<GroundTruthEntry> = {}): GroundTruthEntry {
  return {
    fixturePath: 'packages/scouts/tests/x/fixture.js',
    line: 1,
    category: 'SAST',
    ruleId: 'sentinel-test-rule',
    severity: 'high',
    description: 'Test finding',
    triage: {
      classification: 'true_positive',
      minConfidence: 0.8,
      requiredKeywords: ['keyword'],
    },
    reviewedBy: 'ai-draft',
    ...overrides,
  };
}

describe('BenchmarkGroundTruthSchema (zod)', () => {
  it('valida un dataset minimo con 1 entry', () => {
    const data = {
      version: '1.0',
      generatedAt: '2026-05-23T00:00:00.000Z',
      reviewedAt: null,
      entries: [makeEntry()],
    };
    const parsed = BenchmarkGroundTruthSchema.parse(data);
    expect(parsed.entries).toHaveLength(1);
  });

  it('lanza si la version no es exactamente "1.0"', () => {
    const data = {
      version: '2.0',
      generatedAt: '2026-05-23T00:00:00.000Z',
      reviewedAt: null,
      entries: [makeEntry()],
    };
    expect(() => BenchmarkGroundTruthSchema.parse(data)).toThrow();
  });

  it('lanza si entries esta vacio', () => {
    const data = {
      version: '1.0',
      generatedAt: '2026-05-23T00:00:00.000Z',
      reviewedAt: null,
      entries: [],
    };
    expect(() => BenchmarkGroundTruthSchema.parse(data)).toThrow();
  });

  it('acepta reviewedAt null o string ISO', () => {
    const minimal = {
      version: '1.0' as const,
      generatedAt: '2026-05-23T00:00:00.000Z',
      reviewedAt: null,
      entries: [makeEntry()],
    };
    expect(() => BenchmarkGroundTruthSchema.parse(minimal)).not.toThrow();
    expect(() =>
      BenchmarkGroundTruthSchema.parse({ ...minimal, reviewedAt: '2026-05-24T00:00:00.000Z' }),
    ).not.toThrow();
  });
});

describe('GroundTruthEntry — Triage', () => {
  it('acepta los 3 valores de classification', () => {
    for (const classification of ['true_positive', 'false_positive', 'inconclusive'] as const) {
      const entry = makeEntry({
        triage: { classification, minConfidence: 0.5, requiredKeywords: ['k'] },
      });
      expect(BenchmarkGroundTruthSchema.shape.entries.element.parse(entry)).toBeDefined();
    }
  });

  it('lanza con classification desconocida', () => {
    const entry = {
      ...makeEntry(),
      triage: { classification: 'maybe', minConfidence: 0.5, requiredKeywords: ['k'] },
    };
    expect(() => BenchmarkGroundTruthSchema.shape.entries.element.parse(entry)).toThrow();
  });

  it('lanza si minConfidence esta fuera del rango [0, 1]', () => {
    const entry = {
      ...makeEntry(),
      triage: { classification: 'true_positive', minConfidence: 1.5, requiredKeywords: ['k'] },
    };
    expect(() => BenchmarkGroundTruthSchema.shape.entries.element.parse(entry)).toThrow();
  });

  it('lanza si requiredKeywords esta vacio', () => {
    const entry = {
      ...makeEntry(),
      triage: { classification: 'true_positive', minConfidence: 0.5, requiredKeywords: [] },
    };
    expect(() => BenchmarkGroundTruthSchema.shape.entries.element.parse(entry)).toThrow();
  });
});

describe('GroundTruthEntry — Context y Remediation opcionales', () => {
  it('acepta una entry sin context ni remediation (caso classification != TP)', () => {
    const entry = makeEntry({
      triage: {
        classification: 'false_positive',
        minConfidence: 0.5,
        requiredKeywords: ['ok'],
      },
    });
    expect(BenchmarkGroundTruthSchema.shape.entries.element.parse(entry)).toBeDefined();
  });

  it('valida una entry con context y remediation completos', () => {
    const entry: GroundTruthEntry = {
      ...makeEntry(),
      context: {
        summaryKeywords: ['s'],
        entryPointKeywords: ['e'],
        sinkKeywords: ['k'],
        exposureKeywords: ['x'],
      },
      remediation: {
        summaryKeywords: ['r'],
        recommendationKeywords: ['c'],
        forbiddenInSnippet: ['eval('],
      },
    };
    expect(BenchmarkGroundTruthSchema.shape.entries.element.parse(entry)).toBeDefined();
  });
});

describe('countByReviewStatus', () => {
  it('cuenta por status', () => {
    const ground: BenchmarkGroundTruth = {
      version: '1.0',
      generatedAt: '2026-05-23T00:00:00.000Z',
      reviewedAt: null,
      entries: [
        makeEntry({ reviewedBy: 'ai-draft' }),
        makeEntry({ reviewedBy: 'ai-draft' }),
        makeEntry({ reviewedBy: 'human-confirmed' }),
      ],
    };
    expect(countByReviewStatus(ground)).toEqual({
      'ai-draft': 2,
      'human-confirmed': 1,
      'human-corrected': 0,
    });
  });
});

describe('tests/benchmark/ground-truth.json — dataset real', () => {
  it('parsea contra el schema sin errores', () => {
    expect(() => loadRealGroundTruth()).not.toThrow();
  });

  it('contiene al menos 25 entries (cubre los 11+ fixtures vulnerables)', () => {
    const ground = loadRealGroundTruth();
    expect(ground.entries.length).toBeGreaterThanOrEqual(25);
  });

  it('todas las entries arrancan como ai-draft (DG-075 C deliverable)', () => {
    const ground = loadRealGroundTruth();
    const counts = countByReviewStatus(ground);
    expect(counts['ai-draft']).toBe(ground.entries.length);
    expect(counts['human-confirmed']).toBe(0);
    expect(counts['human-corrected']).toBe(0);
  });

  it('cubre las 5 categorias del producto (SAST, Secrets, IaC, VibeCoded — SCA pendiente)', () => {
    const ground = loadRealGroundTruth();
    const categories = new Set(ground.entries.map((e) => e.category));
    expect(categories.has('SAST')).toBe(true);
    expect(categories.has('Secrets')).toBe(true);
    expect(categories.has('IaC')).toBe(true);
    expect(categories.has('VibeCoded')).toBe(true);
    // SCA (Trivy) NO esta en la primera version del ground truth: el output
    // de Trivy enumera 1 finding por CVE, listas largas que el AI-draft no
    // pre-enumera (DG-076 las descubre dinamicamente y el reporte las marca
    // como "sin ground truth"). Documentado en tests/benchmark/README.md.
  });

  it('cada entry TP tiene context y remediation (los agentes downstream no se saltean)', () => {
    const ground = loadRealGroundTruth();
    for (const entry of ground.entries) {
      if (entry.triage.classification === 'true_positive') {
        expect(
          entry.context,
          `entry ${entry.fixturePath}:${entry.line} missing context`,
        ).toBeDefined();
        expect(
          entry.remediation,
          `entry ${entry.fixturePath}:${entry.line} missing remediation`,
        ).toBeDefined();
      }
    }
  });
});
