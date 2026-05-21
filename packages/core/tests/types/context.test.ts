import { describe, it, expect } from 'vitest';
import { ContextExplanationSchema } from '../../src/types/context.js';

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
