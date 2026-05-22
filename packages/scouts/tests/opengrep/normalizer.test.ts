import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { OpenGrepOutputSchema, type OpenGrepOutput } from '../../src/opengrep/opengrep-output.js';
import {
  normalizeOpenGrepOutput,
  mapSeverity,
  extractComplianceRefs,
  relativizePath,
  canonicalRuleId,
} from '../../src/opengrep/normalizer.js';

/** Carga la salida JSON real de OpenGrep capturada como fixture. */
async function loadFixture(): Promise<OpenGrepOutput> {
  const path = fileURLToPath(new URL('./fixtures/opengrep-output.sample.json', import.meta.url));
  return OpenGrepOutputSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

describe('normalizeOpenGrepOutput', () => {
  it('normaliza la salida real de OpenGrep a Finding[]', async () => {
    const output = await loadFixture();
    const findings = normalizeOpenGrepOutput(output, {
      scanId: 'scan-1',
      scoutId: 'opengrep',
      rootPath: 'd:\\tmp\\opengrep-probe',
      now: () => '2026-05-20T12:00:00.000Z',
      newId: () => '00000000-0000-4000-8000-000000000001',
    });

    expect(findings).toHaveLength(1);
    const finding = findings[0];
    if (!finding) throw new Error('se esperaba un finding');

    expect(finding.scoutId).toBe('opengrep');
    expect(finding.scanId).toBe('scan-1');
    expect(finding.severity).toBe('high'); // ERROR -> high
    expect(finding.category).toBe('SAST');
    expect(finding.ruleId).toBe('js-eval-usage'); // ruleId canonico (FI-005)
    expect(finding.title).toBe('js-eval-usage');
    expect(finding.location.path).toBe('vuln.js'); // ruta relativizada
    expect(finding.location.startLine).toBe(2);
    expect(finding.location.snippet).toBe('return eval(userInput);');
    expect(finding.complianceRefs).toEqual(['CWE-95', 'OWASP-A03']);
    expect(finding.fingerprint).toMatch(/^6cb1659b/);
    expect(finding.lifecycleState).toBe('new');
    expect(finding.createdAt).toBe('2026-05-20T12:00:00.000Z');
  });
});

describe('mapSeverity', () => {
  it('mapea las severidades de OpenGrep a las de Sentinel', () => {
    expect(mapSeverity('ERROR')).toBe('high');
    expect(mapSeverity('WARNING')).toBe('medium');
    expect(mapSeverity('INFO')).toBe('info');
    expect(mapSeverity('CRITICAL')).toBe('critical');
    expect(mapSeverity('error')).toBe('high'); // sin distinguir mayusculas
  });

  it('cae a info ante una severidad desconocida', () => {
    expect(mapSeverity('WHATEVER')).toBe('info');
  });
});

describe('extractComplianceRefs', () => {
  it('extrae codigos CWE y OWASP de la metadata', () => {
    expect(
      extractComplianceRefs({
        cwe: ['CWE-89: SQL Injection'],
        owasp: ['A03:2021 - Injection'],
      }),
    ).toEqual(['CWE-89', 'OWASP-A03']);
  });

  it('acepta cwe como string suelto', () => {
    expect(extractComplianceRefs({ cwe: 'CWE-79: XSS' })).toEqual(['CWE-79']);
  });

  it('devuelve un array vacio sin metadata', () => {
    expect(extractComplianceRefs(undefined)).toEqual([]);
  });
});

describe('relativizePath', () => {
  it('relativiza una ruta Windows respecto a la raiz', () => {
    expect(relativizePath('d:\\proj\\src\\a.ts', 'd:\\proj')).toBe('src/a.ts');
  });

  it('relativiza una ruta POSIX respecto a la raiz', () => {
    expect(relativizePath('/repo/src/b.ts', '/repo')).toBe('src/b.ts');
  });

  it('devuelve la ruta normalizada si esta fuera de la raiz', () => {
    expect(relativizePath('/otro/c.ts', '/repo')).toBe('/otro/c.ts');
  });
});

describe('canonicalRuleId', () => {
  it('toma el ultimo segmento del check_id (descarta el prefijo de ruta)', () => {
    expect(canonicalRuleId('d.tmp.probe.js-eval-usage')).toBe('js-eval-usage');
  });

  it('es idempotente sobre un id ya canonico', () => {
    expect(canonicalRuleId('sentinel-js-eval-usage')).toBe('sentinel-js-eval-usage');
  });
});
