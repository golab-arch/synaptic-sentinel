/**
 * DG-117 A — Filtro de paths estructuralmente ruidosos (Cycle 108).
 *
 * Aplicado por el `Coordinator` antes del stage 2 (dedup + supresion de
 * FPs conocidos). Descarta findings cuya ruta (relativa al rootPath,
 * normalizada con `/` por `relativizePath`) contenga al menos un
 * **segmento exacto** del set de excludes.
 *
 * Rationale del enfoque "segment-exact match" en vez de globs:
 * - Determinista, sin dependencias nuevas (no `micromatch`).
 * - Mismo patron que `vibe-detect-scout` ya usa internamente
 *   (SKIP_DIRS) — consistencia.
 * - Cubre exactamente el caso empirico medido en Cycle 107: 5 findings
 *   de Trivy en `packages/scouts/tests/trivy/fixtures/...` (segmento
 *   `fixtures`) + el caso adicional de vibe-detect en
 *   `packages/scouts/tests/vibe-detect/fixtures/...` (mismo segmento).
 *
 * Trade-off honesto (anti-optimismo ilusorio):
 * - **NO matchea** directorios con nombres alternativos no listados
 *   (e.g. `examples/`, `playground/`, `samples/`). Si emerge demanda
 *   empirica, se extiende el set en hotfix decimal DG-117.0.1.
 * - **Silencia findings reales** si un proyecto del usuario tiene un
 *   directorio legitimo llamado `fixtures` que SI quiere scannear.
 *   Mitigation: nombres del set son convencionalmente de testing/build,
 *   no de codigo de produccion. User-configurable queda diferido a
 *   sub-DG futuro (no scope creep aqui).
 * - **NO ahorra CPU del scout**: el scout sigue corriendo sobre la
 *   fixture; descarte ocurre post-hoc. Si emerge demanda empirica de
 *   ahorro (proyectos con fixtures masivas), DG-117.0.2 puede pushear
 *   exclude flags al binario (`trivy --skip-dirs`, etc.).
 */

/**
 * Set por defecto de segmentos de path estructuralmente ruidosos (DG-117 A).
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
]);

/**
 * Devuelve `true` si la ruta `path` (normalizada con separador `/`,
 * relativa al rootPath) contiene al menos un segmento exacto del set
 * `excluded`. Use `DEFAULT_EXCLUDED_PATH_SEGMENTS` por defecto si no
 * pasa el segundo argumento.
 *
 * Casos:
 * - `packages/scouts/tests/trivy/fixtures/vulnerable-deps/package-lock.json`
 *   con default → `true` (segmento `fixtures` presente).
 * - `package-lock.json` (root del proyecto) → `false`.
 * - `src/mything/distro/file.js` → `false` (`distro` no es match exacto
 *   de `dist`).
 * - `node_modules/foo/index.js` → `true`.
 */
export function isPathExcluded(
  path: string,
  excluded: ReadonlySet<string> = DEFAULT_EXCLUDED_PATH_SEGMENTS,
): boolean {
  // Defensa: paths vacios no se filtran (preserva comportamiento pre-DG-117 A
  // para findings con location degenerada — el normalizer ya garantiza
  // separador `/`).
  if (path === '') return false;
  const segments = path.split('/');
  for (const segment of segments) {
    if (excluded.has(segment)) return true;
  }
  return false;
}
