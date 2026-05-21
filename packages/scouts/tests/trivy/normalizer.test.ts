import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TrivyOutputSchema, type TrivyOutput } from '../../src/trivy/trivy-output.js';
import { normalizeTrivyOutput } from '../../src/trivy/normalizer.js';

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
});
