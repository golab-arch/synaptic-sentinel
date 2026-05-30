import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  computeRemediationTarget,
  groupFindingsByCorrelation,
  packageFamilyKey,
  type Finding,
  type ScaMetadata,
} from '../../src/index.js';

/** Construye un Finding SCA bien-formado para tests. */
function makeScaFinding(args: {
  packageName: string;
  installedVersion: string;
  fixVersions: string[];
  ruleId?: string;
  lockfile?: string;
}): Finding {
  const sca: ScaMetadata = {
    packageName: args.packageName,
    installedVersion: args.installedVersion,
    fixVersions: args.fixVersions,
  };
  const lockfile = args.lockfile ?? 'package-lock.json';
  return {
    id: randomUUID(),
    scanId: 'scan-1',
    scoutId: 'trivy',
    severity: 'high',
    category: 'SCA',
    ruleId: args.ruleId ?? 'CVE-2026-44288',
    title: `${args.packageName}: ${args.ruleId ?? 'CVE-2026-44288'}`,
    message: `${args.packageName} ${args.installedVersion} is vulnerable.`,
    location: { path: lockfile, startLine: 1 },
    complianceRefs: [],
    fingerprint: `${lockfile}:${args.packageName}:${args.ruleId ?? 'CVE-2026-44288'}`,
    lifecycleState: 'new',
    createdAt: '2026-05-30T00:00:00.000Z',
    sca,
  } as Finding;
}

describe('packageFamilyKey — DG-113 A Step 4 / §4 #4', () => {
  it('devuelve el nombre exacto del package (NO hace scope-stripping)', () => {
    expect(packageFamilyKey('protobufjs')).toBe('protobufjs');
    expect(packageFamilyKey('@protobufjs/utf8')).toBe('@protobufjs/utf8');
    expect(packageFamilyKey('fastify')).toBe('fastify');
  });

  it('NO over-mergea @types/X distintos en una "types family" (G2 ajuste del usuario)', () => {
    // CRITICAL: scope-stripping ingenuo agruparia @types/node con @types/lodash
    // en una "types" family con UNA remediation = grupo falso peligroso. La
    // heuristica de exact-match evita esto.
    expect(packageFamilyKey('@types/node')).toBe('@types/node');
    expect(packageFamilyKey('@types/lodash')).toBe('@types/lodash');
    expect(packageFamilyKey('@types/node')).not.toBe(packageFamilyKey('@types/lodash'));
  });
});

describe('computeRemediationTarget — DG-113 A Step 4', () => {
  it('devuelve noFixAvailable cuando no hay fix versions', () => {
    const t = computeRemediationTarget([[]]);
    expect(t.noFixAvailable).toBe(true);
    expect(t.display).toBe('no fix available');
    expect(t.heterogeneous).toBe(false);
  });

  it('devuelve noFixAvailable cuando los arrays estan todos vacios', () => {
    const t = computeRemediationTarget([[], [], []]);
    expect(t.noFixAvailable).toBe(true);
  });

  it('single major track: MAX simple', () => {
    const t = computeRemediationTarget([['7.5.6'], ['7.5.4'], ['7.5.8']]);
    expect(t.recommendedFixes).toEqual({ '7': '7.5.8' });
    expect(t.display).toBe('7.5.8');
    expect(t.heterogeneous).toBe(false);
    expect(t.noFixAvailable).toBe(false);
  });

  it('multiple major tracks: MAX por track (caso protobufjs del reporte)', () => {
    // Caso del reporte §4 #4: protobufjs CVE-2026-45740 necesita 7.5.8,
    // otros CVEs en 7.5.6/8.0.2 → MAX por track = 7.5.8 + 8.0.2.
    const t = computeRemediationTarget([['7.5.6', '8.0.2'], ['7.5.8', '8.0.2'], ['7.5.6']]);
    expect(t.recommendedFixes).toEqual({ '7': '7.5.8', '8': '8.0.2' });
    expect(t.display).toBe('7.5.8 / 8.0.2');
    expect(t.heterogeneous).toBe(true);
    expect(t.noFixAvailable).toBe(false);
  });

  it('skipea versions inparseables y usa solo las validas', () => {
    const t = computeRemediationTarget([['latest', '7.5.6', 'nightly']]);
    expect(t.recommendedFixes).toEqual({ '7': '7.5.6' });
    expect(t.noFixAvailable).toBe(false);
  });

  it('todas inparseables → noFixAvailable', () => {
    const t = computeRemediationTarget([['latest', 'nightly', 'main']]);
    expect(t.noFixAvailable).toBe(true);
    expect(t.display).toBe('fix versions could not be parsed');
  });

  it('maneja pre-release versions correctamente con semver.coerce', () => {
    // semver.coerce("7.5.8-rc.1") → "7.5.8" — el reporte semver MAX usa
    // forma coerced; pre-release dropped (decision: usuario probablemente
    // quiere stable, no rc).
    const t = computeRemediationTarget([['7.5.8-rc.1'], ['7.5.7']]);
    expect(t.recommendedFixes['7']).toBe('7.5.8');
  });

  it('sorts tracks por major asc en el display (estable cross-runs)', () => {
    const t = computeRemediationTarget([['10.2.0', '8.1.0', '7.5.8']]);
    expect(t.display).toBe('7.5.8 / 8.1.0 / 10.2.0');
  });

  it('DG-113.1 A: filtra downgrade track (caso fast-xml-parser instalado 5.5.6, fix {4.5.5, 5.7.0})', () => {
    // Caso empirico de Baseline-4: fast-xml-parser 5.5.6 con fixes en 4.5.5
    // OR 5.7.0. Naive output recomendaba ambas tracks (incluyendo downgrade
    // a major 4). Post-fix solo debe quedar la track 5.
    const t = computeRemediationTarget([['4.5.5', '5.7.0']], ['5.5.6']);
    expect(t.recommendedFixes).toEqual({ '5': '5.7.0' });
    expect(t.display).toBe('5.7.0');
    expect(t.heterogeneous).toBe(false);
    expect(t.noFixAvailable).toBe(false);
  });

  it('DG-113.1 A: preserva tracks de same-major y upgrades', () => {
    // installed 7.5.4 + fix set distribuido en 7.x y 8.x. Ningún track es
    // downgrade (7 = same major, 8 = upgrade). Ambos preservados.
    const t = computeRemediationTarget(
      [
        ['7.5.6', '7.5.8'],
        ['8.0.2', '8.2.0'],
      ],
      ['7.5.4'],
    );
    expect(t.recommendedFixes).toEqual({ '7': '7.5.8', '8': '8.2.0' });
    expect(t.heterogeneous).toBe(true);
  });

  it('DG-113.1 A: multi-install group usa MIN installed major (safer)', () => {
    // Group con installs [4.1.0, 5.5.0] + fixes en [3.x, 4.x, 5.x, 6.x].
    // MIN installed major = 4. Track 3 se filtra (downgrade para ambos).
    // Tracks 4, 5, 6 se preservan (sirven a al menos un miembro).
    const t = computeRemediationTarget(
      [['3.9.9'], ['4.2.0'], ['5.6.0'], ['6.0.0']],
      ['4.1.0', '5.5.0'],
    );
    expect(Object.keys(t.recommendedFixes).sort()).toEqual(['4', '5', '6']);
    expect(t.recommendedFixes['3']).toBeUndefined();
  });

  it('DG-113.1 A: si TODAS las fix tracks son downgrades → noFixAvailable con mensaje informativo', () => {
    // installed 10.0.0 + fixes solo en 5.x → todo es downgrade.
    const t = computeRemediationTarget([['5.6.0', '5.7.0']], ['10.0.0']);
    expect(t.noFixAvailable).toBe(true);
    expect(t.display).toBe('no upgrade path available (all known fixes are downgrades)');
  });

  it('DG-113.1 A: backward compat — sin installedVersions el filter NO aplica', () => {
    // Sin segundo arg, el comportamiento pre-DG-113.1 A se preserva.
    const t = computeRemediationTarget([['4.5.5', '5.7.0']]);
    expect(t.recommendedFixes).toEqual({ '4': '4.5.5', '5': '5.7.0' });
    expect(t.heterogeneous).toBe(true);
  });

  it('DG-113.1 A: installedVersions con strings vacios o inparseables son ignorados', () => {
    // Si pasamos installs malformadas, el filter no aplica (no hay
    // installedMajors válidas → no se computa MIN).
    const t = computeRemediationTarget([['4.5.5', '5.7.0']], ['', 'latest', 'main']);
    expect(t.recommendedFixes).toEqual({ '4': '4.5.5', '5': '5.7.0' });
  });
});

describe('groupFindingsByCorrelation — DG-113 A Step 4 / §4 #4', () => {
  it('agrupa el caso protobufjs (intra-package con N CVEs distintos)', () => {
    const findings = [
      makeScaFinding({
        packageName: 'protobufjs',
        installedVersion: '7.5.4',
        fixVersions: ['7.5.6', '8.0.2'],
        ruleId: 'CVE-2026-44288',
      }),
      makeScaFinding({
        packageName: 'protobufjs',
        installedVersion: '7.5.4',
        fixVersions: ['7.5.8', '8.2.0'],
        ruleId: 'CVE-2026-45740',
      }),
      makeScaFinding({
        packageName: 'protobufjs',
        installedVersion: '7.5.4',
        fixVersions: ['7.5.6'],
        ruleId: 'CVE-2026-41242',
      }),
    ];
    const groups = groupFindingsByCorrelation(findings);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.familyKey).toBe('protobufjs');
    expect(groups[0]?.findings).toHaveLength(3);
    // MAX heterogeneo: 7.x → 7.5.8 (max de [7.5.6, 7.5.8, 7.5.6]); 8.x → 8.2.0.
    expect(groups[0]?.remediation.recommendedFixes).toEqual({ '7': '7.5.8', '8': '8.2.0' });
    expect(groups[0]?.remediation.heterogeneous).toBe(true);
  });

  it('agrupa cross-lockfile: mismo pkg en root + web', () => {
    const findings = [
      makeScaFinding({
        packageName: 'protobufjs',
        installedVersion: '7.5.4',
        fixVersions: ['7.5.6'],
        lockfile: 'package-lock.json',
      }),
      makeScaFinding({
        packageName: 'protobufjs',
        installedVersion: '7.5.4',
        fixVersions: ['7.5.6'],
        lockfile: 'web/package-lock.json',
      }),
    ];
    const groups = groupFindingsByCorrelation(findings);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.findings).toHaveLength(2);
  });

  it('TEST CRITICO ANTI-OVER-MERGE (G2): packages distintos NO se mergean', () => {
    // Smoke test del case que motivo el G2 ajuste del usuario. Cada paquete
    // debe quedar en SU PROPIO grupo — sin "types family" falsa, sin
    // "scope family" falsa.
    const findings = [
      makeScaFinding({ packageName: 'fastify', installedVersion: '5.0.0', fixVersions: ['5.8.5'] }),
      makeScaFinding({
        packageName: 'node-forge',
        installedVersion: '1.3.1',
        fixVersions: ['1.3.2'],
      }),
      makeScaFinding({
        packageName: 'fast-uri',
        installedVersion: '2.0.0',
        fixVersions: ['2.4.0'],
      }),
      makeScaFinding({
        packageName: 'uuid',
        installedVersion: '11.1.0',
        fixVersions: ['11.1.1'],
      }),
      makeScaFinding({
        packageName: '@tootallnate/once',
        installedVersion: '1.0.0',
        fixVersions: [],
      }),
      makeScaFinding({
        packageName: '@types/node',
        installedVersion: '20.0.0',
        fixVersions: ['20.10.0'],
      }),
      makeScaFinding({
        packageName: '@types/lodash',
        installedVersion: '4.0.0',
        fixVersions: ['4.17.0'],
      }),
    ];
    const groups = groupFindingsByCorrelation(findings);
    expect(groups).toHaveLength(7);
    const familyKeys = groups.map((g) => g.familyKey).sort();
    expect(familyKeys).toEqual([
      '@tootallnate/once',
      '@types/lodash',
      '@types/node',
      'fast-uri',
      'fastify',
      'node-forge',
      'uuid',
    ]);
    // Confirma que @types/node y @types/lodash quedaron como grupos
    // SEPARADOS (NO en una "types family" falsa).
    const typesNode = groups.find((g) => g.familyKey === '@types/node');
    const typesLodash = groups.find((g) => g.familyKey === '@types/lodash');
    expect(typesNode?.findings).toHaveLength(1);
    expect(typesLodash?.findings).toHaveLength(1);
    expect(typesNode?.remediation.display).toBe('20.10.0');
    expect(typesLodash?.remediation.display).toBe('4.17.0');
  });

  it('NO incluye findings non-SCA en grupos', () => {
    const scaFinding = makeScaFinding({
      packageName: 'protobufjs',
      installedVersion: '7.5.4',
      fixVersions: ['7.5.6'],
    });
    const sastFinding = {
      ...scaFinding,
      id: randomUUID(),
      category: 'SAST' as const,
      ruleId: 'sentinel-js-eval-usage',
      sca: undefined,
    };
    const groups = groupFindingsByCorrelation([scaFinding, sastFinding] as Finding[]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.familyKey).toBe('protobufjs');
    expect(groups[0]?.findings).toHaveLength(1);
  });

  it('NO incluye findings SCA sin sca metadata', () => {
    const scaWithoutMeta = {
      ...makeScaFinding({
        packageName: 'protobufjs',
        installedVersion: '7.5.4',
        fixVersions: ['7.5.6'],
      }),
      sca: undefined,
    };
    expect(groupFindingsByCorrelation([scaWithoutMeta] as Finding[])).toEqual([]);
  });

  it('ordena: mas findings primero, tiebreaker alfabetico', () => {
    const findings = [
      makeScaFinding({ packageName: 'zzz', installedVersion: '1.0.0', fixVersions: ['1.0.1'] }),
      makeScaFinding({ packageName: 'aaa', installedVersion: '1.0.0', fixVersions: ['1.0.1'] }),
      // 'bbb' tiene 3 findings — debe ir primero.
      makeScaFinding({
        packageName: 'bbb',
        installedVersion: '1.0.0',
        fixVersions: ['1.0.1'],
        ruleId: 'CVE-1',
      }),
      makeScaFinding({
        packageName: 'bbb',
        installedVersion: '1.0.0',
        fixVersions: ['1.0.1'],
        ruleId: 'CVE-2',
      }),
      makeScaFinding({
        packageName: 'bbb',
        installedVersion: '1.0.0',
        fixVersions: ['1.0.1'],
        ruleId: 'CVE-3',
      }),
    ];
    const groups = groupFindingsByCorrelation(findings);
    expect(groups.map((g) => g.familyKey)).toEqual(['bbb', 'aaa', 'zzz']);
  });

  it('DG-113.1 A: groupFindingsByCorrelation pasa installedVersions al remediation target (e2e wiring)', () => {
    // E2E del caso fast-xml-parser: el grupo con installed 5.5.6 + fixes
    // {4.5.5, 5.7.0} debe emitir target solo en track 5 (no recomienda
    // downgrade a 4.5.5).
    const findings = [
      makeScaFinding({
        packageName: 'fast-xml-parser',
        installedVersion: '5.5.6',
        fixVersions: ['4.5.5', '5.7.0'],
        ruleId: 'CVE-Y',
      }),
    ];
    const groups = groupFindingsByCorrelation(findings);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.familyKey).toBe('fast-xml-parser');
    expect(groups[0]?.remediation.recommendedFixes).toEqual({ '5': '5.7.0' });
    expect(groups[0]?.remediation.display).toBe('5.7.0');
    expect(groups[0]?.remediation.heterogeneous).toBe(false);
  });

  it('grupo con noFixAvailable: todos los findings sin fixVersions', () => {
    const findings = [
      makeScaFinding({
        packageName: 'orphan-pkg',
        installedVersion: '1.0.0',
        fixVersions: [],
        ruleId: 'CVE-X',
      }),
    ];
    const groups = groupFindingsByCorrelation(findings);
    expect(groups[0]?.remediation.noFixAvailable).toBe(true);
  });
});
