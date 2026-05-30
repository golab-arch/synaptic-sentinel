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

describe('normalizeTrivyOutput — DG-115 A Step 5 (dependencyContext + packageManager)', () => {
  /**
   * Fixture sintetico replicando la forma real de la salida de Trivy
   * v0.70.0 con dep graph. Reproduce el caso prismjs (§4 #15 del reporte):
   * `prismjs@1.27.0` (UID `746a7e36`) nested bajo `refractor@3.6.0` (que lo
   * tiene en DependsOn) — mientras `prismjs@1.30.0` (UID `11666ac1`) ya
   * existe top-level. Un bump top-level NO resuelve la copia nested.
   */
  function buildPrismjsLikeFixture(): TrivyOutput {
    return TrivyOutputSchema.parse({
      Results: [
        {
          Target: 'pnpm-lock.yaml',
          Type: 'npm',
          Vulnerabilities: [
            {
              VulnerabilityID: 'CVE-2024-53382',
              PkgID: 'prismjs@1.27.0',
              PkgIdentifier: { UID: '746a7e36003b6e90' },
              PkgName: 'prismjs',
              InstalledVersion: '1.27.0',
              FixedVersion: '1.30.0',
              Severity: 'MEDIUM',
              Title: 'prismjs: DOM Clobbering vulnerability',
              CweIDs: ['CWE-79'],
            },
          ],
          Packages: [
            {
              ID: 'react-syntax-highlighter@15.6.6',
              Name: 'react-syntax-highlighter',
              Version: '15.6.6',
              Identifier: { UID: 'aaaaaaaaaaaaaaaa' },
              Relationship: 'direct',
              DependsOn: ['refractor@3.6.0'],
            },
            {
              ID: 'refractor@3.6.0',
              Name: 'refractor',
              Version: '3.6.0',
              Identifier: { UID: 'bbbbbbbbbbbbbbbb' },
              Relationship: 'indirect',
              DependsOn: ['prismjs@1.27.0'],
            },
            {
              ID: 'prismjs@1.27.0',
              Name: 'prismjs',
              Version: '1.27.0',
              Identifier: { UID: '746a7e36003b6e90' },
              Relationship: 'indirect',
            },
            {
              ID: 'prismjs@1.30.0',
              Name: 'prismjs',
              Version: '1.30.0',
              Identifier: { UID: '11666ac127d684af' },
              Relationship: 'direct',
            },
          ],
        },
      ],
    });
  }

  it('popula sca.packageManager desde Result.Type', () => {
    const findings = normalizeTrivyOutput(buildPrismjsLikeFixture(), {
      scanId: 'scan-prismjs',
      scoutId: 'trivy',
      rootPath: '/proyecto',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.sca?.packageManager).toBe('npm');
  });

  it('popula dependencyContext.directness=indirect via PkgIdentifier.UID match', () => {
    const findings = normalizeTrivyOutput(buildPrismjsLikeFixture(), {
      scanId: 'scan-prismjs',
      scoutId: 'trivy',
      rootPath: '/proyecto',
    });
    expect(findings[0]?.sca?.dependencyContext?.directness).toBe('indirect');
  });

  it('popula pinnedBy con el parent que incluye el package en DependsOn (refractor)', () => {
    const findings = normalizeTrivyOutput(buildPrismjsLikeFixture(), {
      scanId: 'scan-prismjs',
      scoutId: 'trivy',
      rootPath: '/proyecto',
    });
    expect(findings[0]?.sca?.dependencyContext?.pinnedBy).toEqual(['refractor@3.6.0']);
  });

  it('marca hasSiblingFixedCopy=true cuando existe otra copia con version >= fix', () => {
    const findings = normalizeTrivyOutput(buildPrismjsLikeFixture(), {
      scanId: 'scan-prismjs',
      scoutId: 'trivy',
      rootPath: '/proyecto',
    });
    // prismjs 1.27.0 (vulnerable) + prismjs 1.30.0 (fixed copy top-level) →
    // bump top-level no fixea la nested → caveat fuerte.
    expect(findings[0]?.sca?.dependencyContext?.hasSiblingFixedCopy).toBe(true);
  });

  it('hasSiblingFixedCopy=false cuando la unica copia es la vulnerable', () => {
    // Mismo fixture pero sin la copia 1.30.0 top-level.
    const fx = buildPrismjsLikeFixture();
    const result = fx.Results?.[0];
    if (result?.Packages !== undefined && result.Packages !== null) {
      result.Packages = result.Packages.filter((p) => p.Identifier?.UID !== '11666ac127d684af');
    }
    const findings = normalizeTrivyOutput(fx, {
      scanId: 'scan-prismjs',
      scoutId: 'trivy',
      rootPath: '/proyecto',
    });
    expect(findings[0]?.sca?.dependencyContext?.hasSiblingFixedCopy).toBe(false);
  });

  it('degrada gracefully (dependencyContext undefined) si Trivy no expone Packages', () => {
    const fx = TrivyOutputSchema.parse({
      Results: [
        {
          Target: 'pkg.json',
          Type: 'npm',
          Vulnerabilities: [
            {
              VulnerabilityID: 'CVE-X',
              PkgName: 'somepkg',
              InstalledVersion: '1.0.0',
              FixedVersion: '1.2.0',
              Severity: 'HIGH',
            },
          ],
          // Sin Packages.
        },
      ],
    });
    const findings = normalizeTrivyOutput(fx, {
      scanId: 'scan-x',
      scoutId: 'trivy',
      rootPath: '/proyecto',
    });
    // packageManager se sigue populando (de Result.Type) — degrada solo el ctx.
    expect(findings[0]?.sca?.packageManager).toBe('npm');
    expect(findings[0]?.sca?.dependencyContext).toBeUndefined();
  });
});
