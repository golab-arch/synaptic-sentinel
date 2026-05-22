import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FindingSchema, type Finding, type Severity } from '@synaptic-sentinel/core';
import {
  buildScouts,
  countBlockingFindings,
  findScannersRoot,
  platformBinary,
  resolveScannerBinary,
  shouldUseColor,
} from '../src/commands/scan.js';

/** Construye un Finding valido con la severidad indicada. */
function findingWith(severity: Severity): Finding {
  return FindingSchema.parse({
    id: randomUUID(),
    scanId: 'scan-1',
    scoutId: 'opengrep',
    severity,
    category: 'SAST',
    ruleId: 'r',
    title: 'r',
    message: 'm',
    location: { path: 'x.ts', startLine: 1 },
    complianceRefs: [],
    fingerprint: `fp-${randomUUID()}`,
    lifecycleState: 'new',
    createdAt: '2026-05-22T00:00:00.000Z',
  });
}

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

describe('shouldUseColor', () => {
  it('--no-color desactiva el color', () => {
    expect(shouldUseColor(true)).toBe(false);
  });

  it('la variable NO_COLOR desactiva el color', () => {
    const previous = process.env['NO_COLOR'];
    process.env['NO_COLOR'] = '1';
    try {
      expect(shouldUseColor(false)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env['NO_COLOR'];
      else process.env['NO_COLOR'] = previous;
    }
  });
});

describe('countBlockingFindings', () => {
  const findings = [
    findingWith('critical'),
    findingWith('high'),
    findingWith('medium'),
    findingWith('low'),
    findingWith('info'),
  ];

  it('cuenta los hallazgos cuya severidad alcanza o supera el umbral', () => {
    expect(countBlockingFindings(findings, 'high')).toBe(2); // critical + high
  });

  it('con umbral "critical" solo cuenta los hallazgos critical', () => {
    expect(countBlockingFindings(findings, 'critical')).toBe(1);
  });

  it('con umbral "info" cuenta todos los hallazgos', () => {
    expect(countBlockingFindings(findings, 'info')).toBe(5);
  });

  it('devuelve 0 cuando ningun hallazgo alcanza el umbral', () => {
    const leves = [findingWith('low'), findingWith('info')];
    expect(countBlockingFindings(leves, 'high')).toBe(0);
  });

  it('devuelve 0 con una lista de hallazgos vacia', () => {
    expect(countBlockingFindings([], 'info')).toBe(0);
  });
});
