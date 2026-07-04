import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  deriveDowngradedConfidence,
  findingGroupKey,
  formatMemberRationaleTag,
  GROUP_MEMBER_CONFIDENCE_DOWNGRADE_FACTOR,
  groupPendingFindings,
  MAX_MEMBER_TAG_LEN,
  MIN_GROUP_SIZE,
} from '../../src/coordinator/triage-grouping.js';
import type { Finding } from '../../src/types/finding.js';

/**
 * Construye un Finding valido para testing con SCA metadata opcional.
 */
function makeFinding(
  ruleId: string,
  category: 'SCA' | 'SAST' = 'SAST',
  scaFields?: { packageName: string; installedVersion?: string },
): Finding {
  return {
    id: randomUUID(),
    scanId: 'scan-x',
    scoutId: 'test',
    severity: 'medium',
    category,
    ruleId,
    title: `${ruleId} title`,
    message: `${ruleId} message`,
    location: { path: `src/${ruleId}.ts`, startLine: 1 },
    complianceRefs: [],
    fingerprint: `fp-${ruleId}-${randomUUID()}`,
    lifecycleState: 'new',
    createdAt: '2026-07-04T00:00:00.000Z',
    ...(scaFields !== undefined
      ? {
          sca: {
            packageName: scaFields.packageName,
            ...(scaFields.installedVersion !== undefined
              ? { installedVersion: scaFields.installedVersion }
              : {}),
            fixVersions: [],
          },
        }
      : {}),
  } as Finding;
}

describe('findingGroupKey', () => {
  it('SCA con packageName + installedVersion → SCA:pkg@version:ruleId', () => {
    const finding = makeFinding('CVE-2026-41242', 'SCA', {
      packageName: 'protobufjs',
      installedVersion: '7.5.4',
    });
    expect(findingGroupKey(finding)).toBe('SCA:protobufjs@7.5.4:CVE-2026-41242');
  });

  it('SCA con packageName pero sin installedVersion → SCA:pkg:ruleId', () => {
    const finding = makeFinding('CVE-2026-41242', 'SCA', { packageName: 'protobufjs' });
    expect(findingGroupKey(finding)).toBe('SCA:protobufjs:CVE-2026-41242');
  });

  it('SAST sin sca metadata → category:ruleId', () => {
    const finding = makeFinding('js-taint-sql-injection', 'SAST');
    expect(findingGroupKey(finding)).toBe('SAST:js-taint-sql-injection');
  });

  it('finding sin ruleId retorna null (no agrupable)', () => {
    const finding = makeFinding('', 'SAST');
    expect(findingGroupKey(finding)).toBeNull();
  });
});

describe('groupPendingFindings', () => {
  it('agrupa findings con mismo ruleId+package (SCA protobufjs multi-finding)', () => {
    const findings = [
      makeFinding('CVE-1', 'SCA', { packageName: 'protobufjs', installedVersion: '7.5.4' }),
      makeFinding('CVE-1', 'SCA', { packageName: 'protobufjs', installedVersion: '7.5.4' }),
      makeFinding('CVE-1', 'SCA', { packageName: 'protobufjs', installedVersion: '7.5.4' }),
    ];
    const { groups, solitary } = groupPendingFindings(findings, () => randomUUID());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(3);
    expect(groups[0]?.groupKey).toBe('SCA:protobufjs@7.5.4:CVE-1');
    expect(solitary).toHaveLength(0);
  });

  it('separa findings de packages distintos aunque compartan ruleId', () => {
    const findings = [
      makeFinding('CVE-1', 'SCA', { packageName: 'protobufjs', installedVersion: '7.5.4' }),
      makeFinding('CVE-1', 'SCA', { packageName: 'protobufjs', installedVersion: '7.5.4' }),
      makeFinding('CVE-1', 'SCA', { packageName: 'grpc-js', installedVersion: '1.9.15' }),
      makeFinding('CVE-1', 'SCA', { packageName: 'grpc-js', installedVersion: '1.9.15' }),
    ];
    const { groups } = groupPendingFindings(findings, () => randomUUID());
    expect(groups).toHaveLength(2);
    const keys = groups.map((g) => g.groupKey).sort();
    expect(keys).toEqual(['SCA:grpc-js@1.9.15:CVE-1', 'SCA:protobufjs@7.5.4:CVE-1']);
  });

  it('finding solo (N=1 sub-MIN_GROUP_SIZE) va a solitary, no groups', () => {
    const findings = [
      makeFinding('CVE-1', 'SCA', { packageName: 'protobufjs', installedVersion: '7.5.4' }),
      makeFinding('CVE-2', 'SCA', { packageName: 'grpc-js', installedVersion: '1.9.15' }),
    ];
    const { groups, solitary } = groupPendingFindings(findings, () => randomUUID());
    expect(groups).toHaveLength(0);
    expect(solitary).toHaveLength(2);
  });

  it('mixed: 3 protobufjs + 1 solo grpc-js → 1 group + 1 solitary', () => {
    const findings = [
      makeFinding('CVE-1', 'SCA', { packageName: 'protobufjs', installedVersion: '7.5.4' }),
      makeFinding('CVE-1', 'SCA', { packageName: 'protobufjs', installedVersion: '7.5.4' }),
      makeFinding('CVE-1', 'SCA', { packageName: 'protobufjs', installedVersion: '7.5.4' }),
      makeFinding('CVE-2', 'SCA', { packageName: 'grpc-js', installedVersion: '1.9.15' }),
    ];
    const { groups, solitary } = groupPendingFindings(findings, () => randomUUID());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(3);
    expect(solitary).toHaveLength(1);
    expect(solitary[0]?.ruleId).toBe('CVE-2');
  });

  it('finding sin ruleId (return null en findingGroupKey) va a solitary', () => {
    const findings = [
      makeFinding('', 'SAST'),
      makeFinding('rule-x', 'SAST'),
      makeFinding('rule-x', 'SAST'),
    ];
    const { groups, solitary } = groupPendingFindings(findings, () => randomUUID());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(2);
    expect(solitary).toHaveLength(1);
    expect(solitary[0]?.ruleId).toBe('');
  });

  it('members preserva el orden de aparición en findings input', () => {
    const findings = [
      {
        ...makeFinding('CVE-1', 'SCA', { packageName: 'protobufjs', installedVersion: '7.5.4' }),
        fingerprint: 'fp-A',
      },
      {
        ...makeFinding('CVE-2', 'SCA', { packageName: 'grpc-js', installedVersion: '1.9.15' }),
        fingerprint: 'fp-X',
      },
      {
        ...makeFinding('CVE-1', 'SCA', { packageName: 'protobufjs', installedVersion: '7.5.4' }),
        fingerprint: 'fp-B',
      },
      {
        ...makeFinding('CVE-1', 'SCA', { packageName: 'protobufjs', installedVersion: '7.5.4' }),
        fingerprint: 'fp-C',
      },
    ] as Finding[];
    const { groups } = groupPendingFindings(findings, () => randomUUID());
    expect(groups[0]?.members.map((m) => m.fingerprint)).toEqual(['fp-A', 'fp-B', 'fp-C']);
  });

  it('MIN_GROUP_SIZE == 2 confirma diseño', () => {
    expect(MIN_GROUP_SIZE).toBe(2);
  });
});

describe('deriveDowngradedConfidence', () => {
  it('aplica downgrade factor 0.9', () => {
    expect(deriveDowngradedConfidence(0.9)).toBeCloseTo(0.81, 5);
    expect(deriveDowngradedConfidence(0.75)).toBeCloseTo(0.675, 5);
    expect(deriveDowngradedConfidence(1.0)).toBeCloseTo(0.9, 5);
  });

  it('clamp inferior 0 con input 0', () => {
    expect(deriveDowngradedConfidence(0)).toBe(0);
  });

  it('confirma GROUP_MEMBER_CONFIDENCE_DOWNGRADE_FACTOR = 0.9 (opinionated)', () => {
    expect(GROUP_MEMBER_CONFIDENCE_DOWNGRADE_FACTOR).toBe(0.9);
  });
});

describe('formatMemberRationaleTag', () => {
  it('genera tag para member normal (N of M)', () => {
    const tag = formatMemberRationaleTag('SCA:protobufjs@7.5.4:CVE-1', 2, 22);
    expect(tag).toBe(' [group SCA:protobufjs@7.5.4:CVE-1, member 3 of 22]');
  });

  it('trunca groupKey largo si excede MAX_MEMBER_TAG_LEN', () => {
    const longKey = 'SCA:very-very-long-package-name-that-exceeds:CVE-2026-45740-XYZ';
    const tag = formatMemberRationaleTag(longKey, 0, 5);
    expect(tag.length).toBeLessThanOrEqual(MAX_MEMBER_TAG_LEN);
    expect(tag).toContain(', member 1 of 5]');
  });
});
