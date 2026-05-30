import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXCLUDED_PATH_SEGMENTS,
  isPathExcluded,
} from '../../src/coordinator/excluded-paths.js';

describe('DEFAULT_EXCLUDED_PATH_SEGMENTS — DG-117 A', () => {
  it('contiene los segmentos canonicos (fixtures + build artifacts + deps)', () => {
    const expected = [
      'fixtures',
      '__fixtures__',
      'node_modules',
      'dist',
      'build',
      'out',
      'coverage',
      'vendor',
      '__pycache__',
    ];
    for (const seg of expected) {
      expect(DEFAULT_EXCLUDED_PATH_SEGMENTS.has(seg)).toBe(true);
    }
    expect(DEFAULT_EXCLUDED_PATH_SEGMENTS.size).toBe(expected.length);
  });
});

describe('isPathExcluded — DG-117 A', () => {
  it('descarta paths con segmento "fixtures" (caso empirico prismjs/lodash)', () => {
    expect(
      isPathExcluded('packages/scouts/tests/trivy/fixtures/vulnerable-deps/package-lock.json'),
    ).toBe(true);
  });

  it('descarta paths con segmento "__fixtures__"', () => {
    expect(isPathExcluded('app/__fixtures__/test.json')).toBe(true);
  });

  it('descarta paths con segmento "node_modules"', () => {
    expect(isPathExcluded('node_modules/foo/index.js')).toBe(true);
    expect(isPathExcluded('packages/foo/node_modules/dep/lib.js')).toBe(true);
  });

  it('descarta paths con segmentos build (dist, build, out, coverage, vendor, __pycache__)', () => {
    expect(isPathExcluded('dist/bundle.js')).toBe(true);
    expect(isPathExcluded('build/output/file.ts')).toBe(true);
    expect(isPathExcluded('packages/foo/out/file.cjs')).toBe(true);
    expect(isPathExcluded('coverage/lcov.info')).toBe(true);
    expect(isPathExcluded('vendor/lib.go')).toBe(true);
    expect(isPathExcluded('src/__pycache__/cache.pyc')).toBe(true);
  });

  it('NO descarta paths de codigo real (sin segmentos del set)', () => {
    expect(isPathExcluded('src/app.ts')).toBe(false);
    expect(isPathExcluded('package.json')).toBe(false);
    expect(isPathExcluded('lib/utils/helper.js')).toBe(false);
    expect(isPathExcluded('packages/core/src/coordinator/coordinator.ts')).toBe(false);
  });

  it('match es segmento EXACTO — "distro" no matchea "dist"', () => {
    expect(isPathExcluded('mything/distro/file.ts')).toBe(false);
    expect(isPathExcluded('node_modules_backup/file.js')).toBe(false);
    expect(isPathExcluded('fixtured/file.json')).toBe(false);
  });

  it('match es case-sensitive — "Dist" no matchea "dist"', () => {
    expect(isPathExcluded('Dist/file.js')).toBe(false);
    expect(isPathExcluded('Build/output.js')).toBe(false);
  });

  it('path vacio NO se descarta (defensa — preserva comportamiento pre-DG-117 A)', () => {
    expect(isPathExcluded('')).toBe(false);
  });

  it('acepta un set custom como segundo argumento', () => {
    const custom = new Set(['samples', 'examples']);
    expect(isPathExcluded('samples/foo.ts', custom)).toBe(true);
    expect(isPathExcluded('examples/bar.js', custom)).toBe(true);
    // Con custom set, los defaults NO aplican
    expect(isPathExcluded('node_modules/foo.js', custom)).toBe(false);
    expect(isPathExcluded('src/x.ts', custom)).toBe(false);
  });

  it('matchea cuando el segmento aparece al inicio, medio, o final del path', () => {
    expect(isPathExcluded('fixtures/file.json')).toBe(true);
    expect(isPathExcluded('packages/x/fixtures/file.json')).toBe(true);
    expect(isPathExcluded('packages/x/fixtures')).toBe(true);
  });
});
