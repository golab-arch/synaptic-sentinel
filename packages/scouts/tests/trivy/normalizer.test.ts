import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TrivyOutputSchema, type TrivyOutput } from '../../src/trivy/trivy-output.js';
import { normalizeTrivyOutput, parseTrivyFixedVersion } from '../../src/trivy/normalizer.js';

/** Carga la salida JSON de Trivy capturada como fixture (curada de una corrida real). */
async function loadFixture(): Promise<TrivyOutput> {
  const path = fileURLToPath(new URL('./fixtures/trivy-output.sample.json', import.meta.url));
  return TrivyOutputSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

describe('normalizeTrivyOutput', () => {
  it('normaliza la salida de Trivy a Finding[]', async () => {
    const output = await loadFixture();
    const findings = normalizeTrivyOutput(output, {
      scanId: 'scan-1',
      scoutId: 'trivy',
      rootPath: 'd:\\proyecto',
      now: () => '2026-05-21T12:00:00.000Z',
      newId: () => '00000000-0000-4000-8000-000000000001',
    });

    expect(findings).toHaveLength(2);
    const high = findings.find((f) => f.ruleId === 'CVE-2021-23337');
    if (!high) throw new Error('se esperaba CVE-2021-23337');

    expect(high.scoutId).toBe('trivy');
    expect(high.severity).toBe('high');
    expect(high.category).toBe('SCA');
    expect(high.location.path).toBe('package-lock.json');
    expect(high.location.startLine).toBe(1);
    expect(high.message).toContain('lodash');
    expect(high.message).toContain('4.17.21'); // version corregida
    expect(high.complianceRefs).toContain('CVE-2021-23337');
    expect(high.complianceRefs).toContain('CWE-94');
    expect(high.fingerprint).toContain('CVE-2021-23337');
    expect(high.createdAt).toBe('2026-05-21T12:00:00.000Z');
  });

  it('mapea la severidad MEDIUM de Trivy a medium', async () => {
    const output = await loadFixture();
    const findings = normalizeTrivyOutput(output, {
      scanId: 'scan-1',
      scoutId: 'trivy',
      rootPath: '/proyecto',
    });
    expect(findings.find((f) => f.ruleId === 'CVE-2020-28500')?.severity).toBe('medium');
  });

  it('normaliza una salida sin Results a una lista vacia', () => {
    const findings = normalizeTrivyOutput(TrivyOutputSchema.parse({}), {
      scanId: 'scan-1',
      scoutId: 'trivy',
      rootPath: '/proyecto',
    });
    expect(findings).toEqual([]);
  });

  it('popula sca.{packageName, installedVersion, fixVersions} (DG-113 A Step 4)', async () => {
    const output = await loadFixture();
    const findings = normalizeTrivyOutput(output, {
      scanId: 'scan-1',
      scoutId: 'trivy',
      rootPath: '/proyecto',
    });
    const lodash = findings.find((f) => f.ruleId === 'CVE-2021-23337');
    expect(lodash?.sca).toBeDefined();
    expect(lodash?.sca?.packageName).toBe('lodash');
    expect(lodash?.sca?.installedVersion).toMatch(/^\d/);
    expect(Array.isArray(lodash?.sca?.fixVersions)).toBe(true);
    expect(lodash?.sca?.fixVersions.length).toBeGreaterThan(0);
  });
});

describe('parseTrivyFixedVersion — DG-113 A Step 4', () => {
  it('devuelve [] para undefined o vacio', () => {
    expect(parseTrivyFixedVersion(undefined)).toEqual([]);
    expect(parseTrivyFixedVersion('')).toEqual([]);
  });

  it('parsea version unica', () => {
    expect(parseTrivyFixedVersion('7.5.6')).toEqual(['7.5.6']);
  });

  it('parsea comma-separated con trim (caso real protobufjs)', () => {
    expect(parseTrivyFixedVersion('7.5.6, 8.0.2')).toEqual(['7.5.6', '8.0.2']);
    expect(parseTrivyFixedVersion(' 7.5.8 ,  8.2.0 ')).toEqual(['7.5.8', '8.2.0']);
  });

  it('filtra strings vacios entre commas', () => {
    expect(parseTrivyFixedVersion('7.5.6,,8.0.2')).toEqual(['7.5.6', '8.0.2']);
  });
});
