import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  DataflowStepSchema,
  DataflowTraceSchema,
  FindingSchema,
  FindingLocationSchema,
} from '../../src/types/finding.js';

/** Construye un hallazgo valido para usar de base en los tests. */
function validFinding(): Record<string, unknown> {
  return {
    id: randomUUID(),
    scanId: 'scan-1',
    scoutId: 'opengrep',
    severity: 'high',
    category: 'SAST',
    ruleId: 'js.sqli.injection',
    title: 'Posible inyeccion SQL',
    message: 'Entrada sin sanitizar alcanza una query SQL.',
    location: { path: 'src/db.ts', startLine: 42 },
    fingerprint: 'fp-abc123',
    createdAt: new Date().toISOString(),
  };
}

describe('FindingSchema', () => {
  it('parsea un hallazgo valido y aplica los defaults', () => {
    const parsed = FindingSchema.parse(validFinding());
    expect(parsed.complianceRefs).toEqual([]);
    expect(parsed.lifecycleState).toBe('new');
    expect(parsed.location.endLine).toBeUndefined();
  });

  it('rechaza un hallazgo sin id', () => {
    const bad = validFinding();
    delete bad.id;
    expect(FindingSchema.safeParse(bad).success).toBe(false);
  });

  it('rechaza un id que no es UUID', () => {
    expect(FindingSchema.safeParse({ ...validFinding(), id: 'no-uuid' }).success).toBe(false);
  });

  it('rechaza una severidad invalida', () => {
    expect(FindingSchema.safeParse({ ...validFinding(), severity: 'urgent' }).success).toBe(false);
  });

  it('rechaza una categoria invalida', () => {
    expect(FindingSchema.safeParse({ ...validFinding(), category: 'XSS' }).success).toBe(false);
  });
});

describe('FindingLocationSchema', () => {
  it('exige una startLine entera y positiva', () => {
    expect(FindingLocationSchema.safeParse({ path: 'a.ts', startLine: 0 }).success).toBe(false);
    expect(FindingLocationSchema.safeParse({ path: 'a.ts', startLine: 1.5 }).success).toBe(false);
    expect(FindingLocationSchema.safeParse({ path: 'a.ts', startLine: 1 }).success).toBe(true);
  });

  it('rechaza una ruta vacia', () => {
    expect(FindingLocationSchema.safeParse({ path: '', startLine: 1 }).success).toBe(false);
  });
});

describe('DataflowStepSchema — DG-112 A Step 3 / §4 #3', () => {
  it('parsea un step valido', () => {
    const step = { path: 'src/a.js', startLine: 17, content: 'req.query' };
    expect(DataflowStepSchema.parse(step)).toEqual(step);
  });

  it('rechaza path vacio', () => {
    expect(DataflowStepSchema.safeParse({ path: '', startLine: 1, content: 'x' }).success).toBe(
      false,
    );
  });

  it('rechaza startLine no positiva', () => {
    expect(DataflowStepSchema.safeParse({ path: 'a.js', startLine: 0, content: 'x' }).success).toBe(
      false,
    );
  });

  it('rechaza content vacio', () => {
    expect(DataflowStepSchema.safeParse({ path: 'a.js', startLine: 1, content: '' }).success).toBe(
      false,
    );
  });
});

describe('DataflowTraceSchema — DG-112 A Step 3 / §4 #3', () => {
  it('parsea un trace con source + intermediate + sink', () => {
    const trace = {
      source: { path: 'a.js', startLine: 1, content: 'src' },
      intermediateSteps: [{ path: 'a.js', startLine: 2, content: 'mid' }],
      sink: { path: 'a.js', startLine: 3, content: 'sink' },
    };
    const parsed = DataflowTraceSchema.parse(trace);
    expect(parsed.intermediateSteps).toHaveLength(1);
  });

  it('aplica default intermediateSteps: [] cuando esta ausente', () => {
    const trace = {
      source: { path: 'a.js', startLine: 1, content: 'src' },
      sink: { path: 'a.js', startLine: 2, content: 'sink' },
    };
    expect(DataflowTraceSchema.parse(trace).intermediateSteps).toEqual([]);
  });

  it('rechaza un trace sin source', () => {
    expect(
      DataflowTraceSchema.safeParse({
        sink: { path: 'a.js', startLine: 2, content: 'sink' },
      }).success,
    ).toBe(false);
  });

  it('rechaza un trace sin sink', () => {
    expect(
      DataflowTraceSchema.safeParse({
        source: { path: 'a.js', startLine: 1, content: 'src' },
      }).success,
    ).toBe(false);
  });
});

describe('FindingSchema — dataflowTrace integration (DG-112 A)', () => {
  it('acepta un Finding sin dataflowTrace (backward compat)', () => {
    expect(FindingSchema.parse(validFinding()).dataflowTrace).toBeUndefined();
  });

  it('acepta un Finding con dataflowTrace valido', () => {
    const finding = {
      ...validFinding(),
      dataflowTrace: {
        source: { path: 'src/a.js', startLine: 1, content: 'req.body.id' },
        intermediateSteps: [{ path: 'src/a.js', startLine: 5, content: 'id' }],
        sink: { path: 'src/a.js', startLine: 10, content: 'db.query(id)' },
      },
    };
    const parsed = FindingSchema.parse(finding);
    expect(parsed.dataflowTrace?.source.content).toBe('req.body.id');
    expect(parsed.dataflowTrace?.intermediateSteps).toHaveLength(1);
    expect(parsed.dataflowTrace?.sink.path).toBe('src/a.js');
  });

  it('rechaza un Finding con dataflowTrace mal-formado (source vacio)', () => {
    const bad = {
      ...validFinding(),
      dataflowTrace: {
        source: { path: '', startLine: 1, content: 'x' },
        sink: { path: 'a.js', startLine: 2, content: 'y' },
      },
    };
    expect(FindingSchema.safeParse(bad).success).toBe(false);
  });
});
