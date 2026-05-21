import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GitleaksOutputSchema, type GitleaksOutput } from '../../src/gitleaks/gitleaks-output.js';
import { normalizeGitleaksOutput } from '../../src/gitleaks/normalizer.js';

/** Carga la salida JSON real de Gitleaks capturada como fixture. */
async function loadFixture(): Promise<GitleaksOutput> {
  const path = fileURLToPath(new URL('./fixtures/gitleaks-output.sample.json', import.meta.url));
  return GitleaksOutputSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

describe('normalizeGitleaksOutput', () => {
  it('normaliza la salida real de Gitleaks a Finding[]', async () => {
    const output = await loadFixture();
    const findings = normalizeGitleaksOutput(output, {
      scanId: 'scan-1',
      scoutId: 'gitleaks',
      rootPath: 'd:\\tmp\\gitleaks-probe',
      now: () => '2026-05-21T12:00:00.000Z',
      newId: () => '00000000-0000-4000-8000-000000000001',
    });

    expect(findings).toHaveLength(1);
    const finding = findings[0];
    if (!finding) throw new Error('se esperaba un finding');

    expect(finding.scoutId).toBe('gitleaks');
    expect(finding.severity).toBe('high');
    expect(finding.category).toBe('Secrets');
    expect(finding.ruleId).toBe('generic-api-key');
    expect(finding.location.path).toBe('config.js'); // ruta relativizada
    expect(finding.location.startLine).toBe(1);
    expect(finding.location.snippet).toContain('REDACTED');
    expect(finding.complianceRefs).toEqual(['CWE-798']);
    expect(finding.fingerprint).toContain('generic-api-key');
    expect(finding.createdAt).toBe('2026-05-21T12:00:00.000Z');
  });

  it('normaliza una salida vacia de Gitleaks a una lista vacia', () => {
    const findings = normalizeGitleaksOutput(GitleaksOutputSchema.parse([]), {
      scanId: 'scan-1',
      scoutId: 'gitleaks',
      rootPath: '/proyecto',
    });
    expect(findings).toEqual([]);
  });
});
