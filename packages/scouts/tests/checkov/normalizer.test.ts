import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CheckovOutputSchema, type CheckovOutput } from '../../src/checkov/checkov-output.js';
import { normalizeCheckovOutput } from '../../src/checkov/normalizer.js';

/** Carga la salida JSON de Checkov capturada como fixture (corrida real). */
async function loadFixture(): Promise<CheckovOutput> {
  const path = fileURLToPath(new URL('./fixtures/checkov-output.sample.json', import.meta.url));
  return CheckovOutputSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

describe('normalizeCheckovOutput', () => {
  it('normaliza la salida de Checkov a Finding[]', async () => {
    const output = await loadFixture();
    const findings = normalizeCheckovOutput(output, {
      scanId: 'scan-1',
      scoutId: 'checkov',
      rootPath: 'd:\\proyecto',
      now: () => '2026-05-21T12:00:00.000Z',
      newId: () => '00000000-0000-4000-8000-000000000001',
    });

    expect(findings).toHaveLength(2);
    const healthcheck = findings.find((f) => f.ruleId === 'CKV_DOCKER_2');
    if (!healthcheck) throw new Error('se esperaba CKV_DOCKER_2');

    expect(healthcheck.scoutId).toBe('checkov');
    expect(healthcheck.category).toBe('IaC');
    expect(healthcheck.location.path).toBe('Dockerfile');
    expect(healthcheck.location.startLine).toBe(1);
    expect(healthcheck.location.endLine).toBe(7);
    expect(healthcheck.title).toContain('HEALTHCHECK');
    expect(healthcheck.message).toContain('CKV_DOCKER_2');
    expect(healthcheck.message).toContain('Guia:');
    expect(healthcheck.fingerprint).toBe('Dockerfile:CKV_DOCKER_2:/Dockerfile.:1');
    expect(healthcheck.createdAt).toBe('2026-05-21T12:00:00.000Z');
  });

  it('mapea la severidad null de Checkov OSS a medium', async () => {
    const output = await loadFixture();
    const findings = normalizeCheckovOutput(output, {
      scanId: 'scan-1',
      scoutId: 'checkov',
      rootPath: '/proyecto',
    });
    expect(findings.every((f) => f.severity === 'medium')).toBe(true);
  });

  it('acepta tambien la forma de array (varios frameworks)', () => {
    const findings = normalizeCheckovOutput(
      CheckovOutputSchema.parse([
        {
          check_type: 'terraform',
          results: {
            failed_checks: [
              {
                check_id: 'CKV_AWS_18',
                check_name: 'Ensure the S3 bucket has access logging enabled',
                file_path: '/main.tf',
                file_line_range: [10, 14],
                resource: 'aws_s3_bucket.data',
                severity: 'HIGH',
              },
            ],
          },
        },
        { check_type: 'dockerfile', results: { failed_checks: null } },
      ]),
      { scanId: 'scan-1', scoutId: 'checkov', rootPath: '/proyecto' },
    );
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    if (!finding) throw new Error('se esperaba un finding');
    expect(finding.severity).toBe('high');
    expect(finding.location.path).toBe('main.tf');
    expect(finding.fingerprint).toBe('main.tf:CKV_AWS_18:aws_s3_bucket.data:10');
  });

  it('normaliza una salida sin checks fallidos a una lista vacia', () => {
    const findings = normalizeCheckovOutput(CheckovOutputSchema.parse({}), {
      scanId: 'scan-1',
      scoutId: 'checkov',
      rootPath: '/proyecto',
    });
    expect(findings).toEqual([]);
  });
});
