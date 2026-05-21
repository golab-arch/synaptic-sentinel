import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildScouts,
  formatOutcome,
  platformBinary,
  resolveScannerBinary,
} from '../src/commands/scan.js';

describe('platformBinary', () => {
  it('agrega .exe en win32 y deja el nombre crudo en el resto', () => {
    const expected = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
    expect(platformBinary('gitleaks')).toBe(expected);
  });
});

describe('resolveScannerBinary', () => {
  it('devuelve la ruta explicita cuando se provee', () => {
    expect(
      resolveScannerBinary(
        'opengrep',
        'opengrep',
        'SENTINEL_OPENGREP_BIN',
        '/ruta/explicita/opengrep',
      ),
    ).toBe('/ruta/explicita/opengrep');
  });

  it('devuelve undefined si no existe una cache .scanners/', () => {
    const root = join(tmpdir(), `cli-noscan-${randomUUID()}`);
    expect(
      resolveScannerBinary('gitleaks', 'gitleaks', 'SENTINEL_GITLEAKS_BIN', undefined, root),
    ).toBeUndefined();
  });

  describe('busqueda en la cache .scanners/', () => {
    const root = join(tmpdir(), `cli-test-${randomUUID()}`);
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('encuentra el binario instalado bajo .scanners/<scanner>/<version>/', () => {
      const versionDir = join(root, '.scanners', 'gitleaks', 'v8.30.1');
      mkdirSync(versionDir, { recursive: true });
      writeFileSync(join(versionDir, 'gitleaks'), 'binario falso');
      expect(
        resolveScannerBinary('gitleaks', 'gitleaks', 'SENTINEL_GITLEAKS_BIN', undefined, root),
      ).toBe(join(versionDir, 'gitleaks'));
    });

    it('elige la version mas alta cuando hay varias instaladas', () => {
      const binaryName = 'opengrep';
      for (const version of ['v1.20.0', 'v1.22.0', 'v1.21.0']) {
        const versionDir = join(root, '.scanners', 'opengrep', version);
        mkdirSync(versionDir, { recursive: true });
        writeFileSync(join(versionDir, binaryName), 'binario falso');
      }
      expect(
        resolveScannerBinary('opengrep', binaryName, 'SENTINEL_OPENGREP_BIN', undefined, root),
      ).toBe(join(root, '.scanners', 'opengrep', 'v1.22.0', binaryName));
    });
  });
});

describe('buildScouts', () => {
  it('construye OpenGrep y Gitleaks cuando se dan ambas rutas explicitas', () => {
    const scouts = buildScouts({
      path: '.',
      opengrepBin: '/x/opengrep',
      gitleaksBin: '/x/gitleaks',
    });
    expect(scouts.map((scout) => scout.id).sort()).toEqual(['gitleaks', 'opengrep']);
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
