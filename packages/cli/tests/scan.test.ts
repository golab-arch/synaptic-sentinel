import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildScouts,
  findScannersRoot,
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

describe('findScannersRoot', () => {
  const root = join(tmpdir(), `cli-scanroot-${randomUUID()}`);
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('encuentra el ancestro que contiene una carpeta .scanners/', () => {
    const nested = join(root, 'a', 'b', 'c');
    mkdirSync(join(root, '.scanners'), { recursive: true });
    mkdirSync(nested, { recursive: true });
    expect(findScannersRoot(nested)).toBe(root);
  });

  it('devuelve undefined si ningun ancestro tiene .scanners/', () => {
    const nested = join(root, 'x', 'y');
    mkdirSync(nested, { recursive: true });
    expect(findScannersRoot(nested)).toBeUndefined();
  });
});

describe('buildScouts', () => {
  it('construye un scout por cada ruta de binario explicita + Vibe-Detect', () => {
    const scouts = buildScouts({
      path: '.',
      opengrepBin: '/x/opengrep',
      gitleaksBin: '/x/gitleaks',
      trivyBin: '/x/trivy',
      checkovBin: '/x/checkov',
    });
    expect(scouts.map((scout) => scout.id).sort()).toEqual([
      'checkov',
      'gitleaks',
      'opengrep',
      'trivy',
      'vibe-detect',
    ]);
  });

  it('siempre incluye el Vibe-Detect Scout (no depende de ningun binario)', () => {
    const scouts = buildScouts({ path: '.' });
    expect(scouts.map((scout) => scout.id)).toContain('vibe-detect');
  });
});

describe('formatOutcome', () => {
  it('formatea el resumen del scan, los scouts y los hallazgos', () => {
    const outcome = {
      scanId: 'scan-1',
      status: 'ok' as const,
      findingsCount: 1,
      suppressedCount: 0,
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
    expect(text).not.toContain('Suprimidos'); // sin supresiones no se imprime la linea
  });

  it('reporta los hallazgos suprimidos y anota el ciclo de vida no-new', () => {
    const outcome = {
      scanId: 'scan-2',
      status: 'ok' as const,
      findingsCount: 1,
      suppressedCount: 2,
      scouts: [{ scoutId: 'opengrep', status: 'ok' as const, findings: 3 }],
      startedAt: '2026-05-21T00:00:00.000Z',
      finishedAt: '2026-05-21T00:00:05.000Z',
    };
    const findings = [
      {
        id: 'f-2',
        scanId: 'scan-2',
        scoutId: 'opengrep',
        severity: 'medium' as const,
        category: 'SAST' as const,
        ruleId: 'rule-y',
        title: 'rule-y',
        message: 'Hallazgo recurrente',
        location: { path: 'src/y.js', startLine: 5 },
        complianceRefs: [],
        fingerprint: 'fp-2',
        lifecycleState: 'known' as const,
        createdAt: '2026-05-21T00:00:00.000Z',
      },
    ];

    const text = formatOutcome(outcome, findings);
    expect(text).toContain('Suprimidos: 2');
    expect(text).toContain('[MEDIUM] rule-y (known)');
  });
});
