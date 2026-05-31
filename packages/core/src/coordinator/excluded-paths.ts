/**
 * DG-117 A — Filtro de paths estructuralmente ruidosos (Cycle 108).
 * DG-117.0.1 — Hotfix decimal: extiende segmentos + agrega filename pattern
 * match para casos empiricos descubiertos en Baseline-6.
 *
 * Aplicado por el `Coordinator` antes del stage 2 (dedup + supresion de
 * FPs conocidos). Descarta findings cuya ruta (relativa al rootPath,
 * normalizada con `/` por `relativizePath`) contenga al menos un
 * **segmento exacto** del set de excludes, o cuyo filename (ultimo
 * segmento) contenga uno de los substrings del filename-pattern list
 * (DG-117.0.1).
 *
 * Rationale del enfoque "segment-exact match" + "filename-substring match":
 * - Determinista, sin dependencias nuevas (no `micromatch`).
 * - Segment match: mismo patron que `vibe-detect-scout` ya usa
 *   internamente (SKIP_DIRS) — consistencia.
 * - Filename-substring match (DG-117.0.1): captura el patron `*.test.*`
 *   y `*.spec.*` que el segment match NO puede (no son segmentos sino
 *   sufijos antes del extension). Empirica de Baseline-6: 8 findings
 *   sobrevivientes en `packages/scouts/tests/vibe-detect/detect.test.ts`
 *   que el filtro original (solo segment match) no capturo porque
 *   `tests` NO esta en el set (decisin deliberada: agregarlo seria
 *   overreach que silenciaria tests legitimos de seguridad).
 *
 * Trade-off honesto (anti-optimismo ilusorio):
 * - **NO matchea** directorios con nombres alternativos no listados
 *   (e.g. `examples/`, `playground/`, `samples/`). Si emerge demanda
 *   empirica, se extiende el set en hotfix decimal futuro.
 * - **Silencia findings reales** si un proyecto del usuario tiene un
 *   archivo legitimo con `.test.` en el nombre que SI quiere scannear
 *   (raro — convencionalmente `.test.*` es test code).
 * - **NO ahorra CPU del scout**: el scout sigue corriendo sobre la
 *   fixture; descarte ocurre post-hoc.
 * - **NO cubre meta-noise**: el scanner que matchea su propia
 *   definicion regex (e.g. `packages/scouts/src/vibe-detect/
 *   detectors.ts`) NO se descarta — es codigo real de produccion. Fix
 *   correcto seria a nivel SAST rule (semgrep nosec / inline marker).
 */

/**
 * Set por defecto de segmentos de path estructuralmente ruidosos
 * (DG-117 A + DG-117.0.1 extensions).
 *
 * Un finding cuya `location.path` contiene EXACTAMENTE uno de estos
 * segmentos se descarta antes del stage 2. La comparacion es
 * case-sensitive y segmento-exacto (e.g. `dist` matchea pero `distro`
 * no).
 *
 * Origen de los segmentos:
 * - `fixtures` + `__fixtures__`: test fixtures (Cycle 107 caso empirico:
 *   `packages/scouts/tests/{trivy,vibe-detect}/fixtures/...`).
 * - `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`,
 *   `__pycache__`: convencionalmente artefactos de build / dependencias
 *   externas (ya estaban en `vibe-detect-scout` SKIP_DIRS; ahora se
 *   aplican a TODOS los scouts via Coordinator).
 * - `benchmark` (DG-117.0.1): benchmark/ground-truth data files (Cycle 108
 *   caso empirico: `tests/benchmark/ground-truth.json:683/688/698/704/714`
 *   con 5 findings de VibeCoded patterns intencionales para benchmark).
 * - `.scanners` (DG-117.0.1): directorio donde el CLI instala los
 *   binarios y assets de scanners OSS (Cycle 108 caso empirico:
 *   `.scanners/gitleaks/v8.30.1/README.md:47/574` con 2 findings de
 *   gitleaks matcheando ejemplos REDACTED en su propia documentacion).
 */
export const DEFAULT_EXCLUDED_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  'fixtures',
  '__fixtures__',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  '__pycache__',
  // DG-117.0.1 (Cycle 108 hotfix) — Baseline-6 empirica:
  'benchmark',
  '.scanners',
]);

/**
 * Filename-substring patterns por defecto (DG-117.0.1).
 *
 * Un finding cuyo filename (ultimo segmento del path) contiene EXACTAMENTE
 * uno de estos substrings se descarta. Captura el patron `*.test.*` y
 * `*.spec.*` que el segment match NO puede expresar (no son segmentos
 * sino sufijos antes del extension).
 *
 * Empirica Baseline-6: 8 findings en
 * `packages/scouts/tests/vibe-detect/detect.test.ts` con VibeCoded
 * patterns intencionales (placeholder secrets, disabled TLS, CORS open,
 * TODO/FIXME) como test data del scanner mismo.
 *
 * Decision deliberada (anti-overreach): NO agregamos `tests` como
 * segmento porque silenciaria tests legitimos de seguridad (auth/
 * validation/etc.). El filename pattern es semanticamente mas preciso:
 * solo silencia archivos con sufijo `.test.` o `.spec.`, no todo el
 * directorio.
 */
export const DEFAULT_EXCLUDED_FILENAME_SUBSTRINGS: readonly string[] = ['.test.', '.spec.'];

/**
 * Devuelve `true` si la ruta `path` (normalizada con separador `/`,
 * relativa al rootPath) contiene al menos un segmento exacto del set
 * `excluded`, O cuyo filename (ultimo segmento) contiene un substring
 * del `filenameSubstrings`.
 *
 * Backward compat: signature de 2 args sigue valida (DG-117 A original).
 * El 3er arg `filenameSubstrings` se introduce en DG-117.0.1 con default
 * a `DEFAULT_EXCLUDED_FILENAME_SUBSTRINGS`. Override pasando array vacio
 * para desactivar el filename match.
 *
 * Casos (con defaults):
 * - `packages/scouts/tests/trivy/fixtures/vulnerable-deps/package-lock.json`
 *   → `true` (segmento `fixtures` presente).
 * - `tests/benchmark/ground-truth.json` → `true` (segmento `benchmark`).
 * - `.scanners/gitleaks/v8.30.1/README.md` → `true` (segmento `.scanners`).
 * - `packages/scouts/tests/vibe-detect/detect.test.ts` → `true` (filename
 *   `detect.test.ts` contiene `.test.`).
 * - `packages/foo/bar.spec.tsx` → `true` (filename contiene `.spec.`).
 * - `package-lock.json` (root del proyecto) → `false`.
 * - `src/mything/distro/file.js` → `false` (`distro` no es match exacto
 *   de `dist`).
 * - `src/test.ts` → `false` (filename `test.ts` NO contiene `.test.` —
 *   no hay prefijo antes del `.test`).
 * - `src/mything.tester.ts` → `false` (filename contiene `.tester.` que
 *   NO es `.test.`).
 */
export function isPathExcluded(
  path: string,
  excluded: ReadonlySet<string> = DEFAULT_EXCLUDED_PATH_SEGMENTS,
  filenameSubstrings: readonly string[] = DEFAULT_EXCLUDED_FILENAME_SUBSTRINGS,
): boolean {
  // Defensa: paths vacios no se filtran (preserva comportamiento pre-DG-117 A
  // para findings con location degenerada — el normalizer ya garantiza
  // separador `/`).
  if (path === '') return false;
  const segments = path.split('/');
  // Segment match (DG-117 A original).
  for (const segment of segments) {
    if (excluded.has(segment)) return true;
  }
  // Filename-substring match (DG-117.0.1).
  const filename = segments[segments.length - 1];
  if (filename !== undefined && filename !== '') {
    for (const substr of filenameSubstrings) {
      if (filename.includes(substr)) return true;
    }
  }
  return false;
}
