import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTomo } from '../src/tomo.js';

/** Carga un fixture JSON de la carpeta tests/fixtures. */
function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('parseTomo', () => {
  it('parsea un tomo real e ignora los campos fuera del contrato minimo', () => {
    const tomo = parseTomo(loadFixture('tomo.sample.json'));

    expect(tomo.summary.scanId).toBe('scan-xyz');
    expect(tomo.summary.status).toBe('ok');
    expect(tomo.findings).toHaveLength(2);

    const first = tomo.findings[0];
    if (!first) throw new Error('se esperaba un finding');
    expect(first.severity).toBe('high');
    expect(first.location.path).toBe('src/vuln.js');
    expect(first.location.startColumn).toBe(10);
    expect(first.lifecycleState).toBe('new');
    expect(tomo.findings[1]?.lifecycleState).toBe('known');

    // metadata/integrity quedan fuera del subconjunto que valida la extension.
    expect((tomo as Record<string, unknown>)['metadata']).toBeUndefined();
    expect((tomo as Record<string, unknown>)['integrity']).toBeUndefined();
  });

  it('aplica el default lifecycleState=new si el finding no lo trae', () => {
    const tomo = parseTomo({
      summary: { scanId: 's', status: 'ok', totalFindings: 1 },
      findings: [
        {
          severity: 'low',
          category: 'SAST',
          ruleId: 'r',
          title: 't',
          message: 'm',
          location: { path: 'a.js', startLine: 3 },
          fingerprint: 'fp-x',
        },
      ],
    });
    expect(tomo.findings[0]?.lifecycleState).toBe('new');
  });

  it('rechaza un finding sin fingerprint', () => {
    expect(() =>
      parseTomo({
        summary: { scanId: 's', status: 'ok', totalFindings: 1 },
        findings: [
          {
            severity: 'low',
            category: 'SAST',
            ruleId: 'r',
            title: 't',
            message: 'm',
            location: { path: 'a.js', startLine: 1 },
          },
        ],
      }),
    ).toThrow();
  });

  it('rechaza un tomo cuyo finding tiene una severidad invalida', () => {
    expect(() =>
      parseTomo({
        summary: { scanId: 's', status: 'ok', totalFindings: 1 },
        findings: [
          {
            severity: 'catastrofica',
            category: 'SAST',
            ruleId: 'r',
            title: 't',
            message: 'm',
            location: { path: 'a.js', startLine: 1 },
            fingerprint: 'fp-x',
          },
        ],
      }),
    ).toThrow();
  });

  it('rechaza un tomo sin summary', () => {
    expect(() => parseTomo({ findings: [] })).toThrow();
  });
});
