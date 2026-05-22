import { describe, it, expect } from 'vitest';
import {
  RemediationSuggestionRecordSchema,
  RemediationSuggestionSchema,
} from '../../src/types/remediation.js';

describe('RemediationSuggestionSchema', () => {
  it('acepta una sugerencia completa con snippet', () => {
    const suggestion = RemediationSuggestionSchema.parse({
      summary: 'parametrizar la consulta',
      recommendation: 'usar consultas preparadas en vez de concatenar el input',
      fixedSnippet: 'db.query("SELECT * FROM u WHERE id = ?", [id])',
    });
    expect(suggestion.fixedSnippet).toContain('?');
  });

  it('acepta una sugerencia sin snippet (campo opcional)', () => {
    const suggestion = RemediationSuggestionSchema.parse({
      summary: 'rotar el secreto',
      recommendation: 'revocar la credencial expuesta y emitir una nueva',
    });
    expect(suggestion.fixedSnippet).toBeUndefined();
  });

  it('rechaza una sugerencia con un campo requerido vacio', () => {
    expect(() => RemediationSuggestionSchema.parse({ summary: 's', recommendation: '' })).toThrow();
  });

  it('rechaza un fixedSnippet vacio (si la clave esta, debe tener contenido)', () => {
    expect(() =>
      RemediationSuggestionSchema.parse({ summary: 's', recommendation: 'r', fixedSnippet: '' }),
    ).toThrow();
  });
});

describe('RemediationSuggestionRecordSchema', () => {
  it('acepta un registro de remediacion completo', () => {
    const record = RemediationSuggestionRecordSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      scanId: 'scan-1',
      fingerprint: 'fp-1',
      summary: 's',
      recommendation: 'r',
      agentId: 'remediation',
      createdAt: '2026-05-21T00:00:00.000Z',
    });
    expect(record.fingerprint).toBe('fp-1');
    expect(record.fixedSnippet).toBeUndefined();
  });

  it('rechaza un registro sin fingerprint', () => {
    expect(() =>
      RemediationSuggestionRecordSchema.parse({
        id: '00000000-0000-4000-8000-000000000001',
        scanId: 'scan-1',
        summary: 's',
        recommendation: 'r',
        agentId: 'remediation',
        createdAt: '2026-05-21T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
