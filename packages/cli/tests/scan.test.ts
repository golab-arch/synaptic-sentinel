import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveOpenGrepBinary, formatOutcome } from '../src/commands/scan.js';

describe('resolveOpenGrepBinary', () => {
  it('devuelve la ruta explicita cuando se provee', () => {
    expect(resolveOpenGrepBinary('/ruta/explicita/opengrep')).toBe('/ruta/explicita/opengrep');
  });

  it('devuelve undefined si no existe una cache .scanners/', () => {
    const root = join(tmpdir(), `cli-noscan-${randomUUID()}`);
    expect(resolveOpenGrepBinary(undefined, root)).toBeUndefined();
  });

  describe('busqueda en la cache .scanners/', () => {
    const root = join(tmpdir(), `cli-test-${randomUUID()}`);
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('encuentra el binario instalado bajo .scanners/opengrep/<version>/', () => {
      const binaryName = process.platform === 'win32' ? 'opengrep.exe' : 'opengrep';
      const versionDir = join(root, '.scanners', 'opengrep', 'v1.22.0');
      mkdirSync(versionDir, { recursive: true });
      writeFileSync(join(versionDir, binaryName), 'binario falso');
      expect(resolveOpenGrepBinary(undefined, root)).toBe(join(versionDir, binaryName));
    });
  });
});

describe('formatOutcome', () => {
  it('formatea el resumen del scan, los scouts y los hallazgos', () => {
    const outcome = {
      scanId: 'scan-1',
      status: 'ok' as const,
      findingsCount: 1,
      scouts: [{ scoutId: 'opengrep', status: 'ok' as const, findings: 1 }],
      startedAt: '2026-05-21T00:00:00.000Z',
      finishedAt: '2026-05-21T00:00:05.000Z',
    };
    const findings = [
      {
        id: 'f-1',
        scanId: 'scan-1',
        scoutId: 'opengrep',
        severity: 'high' as const,
        category: 'SAST' as const,
        ruleId: 'd.proj.sentinel-js-eval-usage',
        title: 'sentinel-js-eval-usage',
        message: 'Uso de eval()',
        location: { path: 'src/x.js', startLine: 2 },
        complianceRefs: [],
        fingerprint: 'fp-1',
        lifecycleState: 'new' as const,
        createdAt: '2026-05-21T00:00:00.000Z',
      },
    ];

    const text = formatOutcome(outcome, findings);
    expect(text).toContain('scan-1');
    expect(text).toContain('OK');
    expect(text).toContain('scout opengrep: ok');
    expect(text).toContain('[HIGH] sentinel-js-eval-usage');
    expect(text).toContain('src/x.js:2');
  });
});
