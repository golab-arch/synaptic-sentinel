import { describe, it, expect } from 'vitest';
import {
  ContextExplanationRecordSchema,
  ContextExplanationSchema,
} from '../../src/types/context.js';

describe('ContextExplanationSchema', () => {
  it('acepta una explicacion completa', () => {
    const explanation = ContextExplanationSchema.parse({
      summary: 'eval() sobre entrada del usuario',
      entryPoint: 'req.query.expr',
      sink: 'eval()',
      exposure: 'ejecucion de codigo arbitrario',
    });
    expect(explanation.sink).toBe('eval()');
    expect(explanation.entryPoint).toBe('req.query.expr');
  });

  it('rechaza una explicacion con un campo vacio', () => {
    expect(() =>
      ContextExplanationSchema.parse({
        summary: 's',
        entryPoint: 'e',
        sink: '',
        exposure: 'x',
      }),
    ).toThrow();
  });

  it('rechaza una explicacion sin el campo exposure', () => {
    expect(() =>
      ContextExplanationSchema.parse({ summary: 's', entryPoint: 'e', sink: 'k' }),
    ).toThrow();
  });
});

describe('ContextExplanationRecordSchema', () => {
  it('acepta un registro de explicacion completo', () => {
    const record = ContextExplanationRecordSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      scanId: 'scan-1',
      fingerprint: 'fp-1',
      summary: 's',
      entryPoint: 'e',
      sink: 'k',
      exposure: 'x',
      agentId: 'context',
      createdAt: '2026-05-21T00:00:00.000Z',
    });
    expect(record.fingerprint).toBe('fp-1');
  });

  it('rechaza un registro sin fingerprint', () => {
    expect(() =>
      ContextExplanationRecordSchema.parse({
        id: '00000000-0000-4000-8000-000000000001',
        scanId: 'scan-1',
        summary: 's',
        entryPoint: 'e',
        sink: 'k',
        exposure: 'x',
        agentId: 'context',
        createdAt: '2026-05-21T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
