import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXCLUDED_FILENAME_SUBSTRINGS,
  DEFAULT_EXCLUDED_PATH_SEGMENTS,
  isPathExcluded,
} from '../../src/coordinator/excluded-paths.js';

describe('DEFAULT_EXCLUDED_PATH_SEGMENTS — DG-117 A + DG-117.0.1', () => {
  it('contiene los segmentos canonicos (fixtures + build artifacts + deps + benchmark + .scanners)', () => {
    const expected = [
      // DG-117 A original
      'fixtures',
      '__fixtures__',
      'node_modules',
      'dist',
      'build',
      'out',
      'coverage',
      'vendor',
      '__pycache__',
      // DG-117.0.1 hotfix (Baseline-6 empirica)
      'benchmark',
      '.scanners',
    ];
    for (const seg of expected) {
      expect(DEFAULT_EXCLUDED_PATH_SEGMENTS.has(seg)).toBe(true);
    }
    expect(DEFAULT_EXCLUDED_PATH_SEGMENTS.size).toBe(expected.length);
  });
});

describe('DEFAULT_EXCLUDED_FILENAME_SUBSTRINGS — DG-117.0.1', () => {
  it('contiene .test. y .spec. (test file conventions)', () => {
    expect(DEFAULT_EXCLUDED_FILENAME_SUBSTRINGS).toContain('.test.');
    expect(DEFAULT_EXCLUDED_FILENAME_SUBSTRINGS).toContain('.spec.');
    expect(DEFAULT_EXCLUDED_FILENAME_SUBSTRINGS).toHaveLength(2);
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

describe('isPathExcluded — DG-117.0.1 (Baseline-6 hotfix)', () => {
  it('descarta paths con segmento "benchmark" (caso empirico tests/benchmark/ground-truth.json)', () => {
    expect(isPathExcluded('tests/benchmark/ground-truth.json')).toBe(true);
    expect(isPathExcluded('packages/cli/tests/benchmark/data.json')).toBe(true);
  });

  it('descarta paths con segmento ".scanners" (caso empirico .scanners/gitleaks/README.md)', () => {
    expect(isPathExcluded('.scanners/gitleaks/v8.30.1/README.md')).toBe(true);
    expect(isPathExcluded('.scanners/trivy/cache/db.bin')).toBe(true);
  });

  it('descarta filenames con substring ".test." (caso empirico detect.test.ts)', () => {
    expect(isPathExcluded('packages/scouts/tests/vibe-detect/detect.test.ts')).toBe(true);
    expect(isPathExcluded('src/foo.test.ts')).toBe(true);
    expect(isPathExcluded('lib/bar.test.js')).toBe(true);
    expect(isPathExcluded('app/component.test.tsx')).toBe(true);
  });

  it('descarta filenames con substring ".spec." (Jest/RSpec convention)', () => {
    expect(isPathExcluded('src/foo.spec.ts')).toBe(true);
    expect(isPathExcluded('lib/bar.spec.js')).toBe(true);
    expect(isPathExcluded('app/component.spec.tsx')).toBe(true);
  });

  it('NO descarta filenames sin substring exacto ".test." o ".spec."', () => {
    // 'test.ts' standalone NO matchea (no prefix antes del .test)
    expect(isPathExcluded('src/test.ts')).toBe(false);
    // '.tester.' NO matchea '.test.'
    expect(isPathExcluded('src/mything.tester.ts')).toBe(false);
    // '.specs.' NO matchea '.spec.'
    expect(isPathExcluded('src/specs.json')).toBe(false);
    // 'testing.ts' NO matchea
    expect(isPathExcluded('src/testing.ts')).toBe(false);
  });

  it('NO descarta path con "test" como segmento (deliberado: anti-overreach)', () => {
    // Decision deliberada: 'test' NO esta en DEFAULT_EXCLUDED_PATH_SEGMENTS
    // porque silenciaria tests legitimos de seguridad (auth/validation).
    // Solo el filename pattern '.test.' se aplica.
    expect(isPathExcluded('test/foo.ts')).toBe(false);
    expect(isPathExcluded('packages/foo/test/bar.js')).toBe(false);
  });

  it('NO descarta path con "tests" como segmento si el filename NO matchea', () => {
    // Mismo razonamiento — 'tests' tampoco silencia entire dir.
    expect(isPathExcluded('tests/auth/login.ts')).toBe(false);
    expect(isPathExcluded('packages/x/tests/security.ts')).toBe(false);
  });

  it('combina segment + filename match (path con AMBOS dispara una sola vez)', () => {
    // 'fixtures' (segment) + '.test.' (filename) en mismo path.
    // El return es el mismo `true` — short-circuit en segment match.
    expect(isPathExcluded('app/fixtures/data.test.json')).toBe(true);
  });

  it('acepta filenameSubstrings custom como 3er argumento', () => {
    const customFilenames = ['.draft.'];
    // Con custom filename substrings, '.test.' default NO aplica
    expect(isPathExcluded('src/foo.test.ts', DEFAULT_EXCLUDED_PATH_SEGMENTS, customFilenames)).toBe(
      false,
    );
    // Pero el custom SI aplica
    expect(
      isPathExcluded('src/foo.draft.ts', DEFAULT_EXCLUDED_PATH_SEGMENTS, customFilenames),
    ).toBe(true);
  });

  it('array vacio como 3er argumento desactiva filename match', () => {
    expect(isPathExcluded('src/foo.test.ts', DEFAULT_EXCLUDED_PATH_SEGMENTS, [])).toBe(false);
    // Segment match sigue funcionando normalmente
    expect(isPathExcluded('node_modules/foo/bar.test.js', DEFAULT_EXCLUDED_PATH_SEGMENTS, [])).toBe(
      true,
    );
  });

  it('preserva backward compat: 2-arg signature original sigue valida', () => {
    // Llamada de 2 args con custom segments — defaults de filename siguen aplicando
    const custom = new Set(['samples']);
    expect(isPathExcluded('samples/foo.ts', custom)).toBe(true); // segment custom
    expect(isPathExcluded('src/foo.test.ts', custom)).toBe(true); // filename default
    expect(isPathExcluded('src/x.ts', custom)).toBe(false); // ninguno matchea
  });
});
