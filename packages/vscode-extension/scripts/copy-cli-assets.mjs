import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/*
 * Post-bundle asset copy (FI-008 + Phase 11 DG-073 B).
 *
 * The bundled CLI (`dist/cli.mjs`) resolves its runtime assets relative to its
 * own location via `new URL(..., import.meta.url)`. esbuild does NOT process
 * that pattern, so the assets are not emitted by the bundle. We copy them next
 * to `cli.mjs`; `colony-db.ts` and `rules.ts` fall back to that sibling path
 * when the canonical `src/` path does not exist (i.e. when bundled).
 *
 * External CJS deps (FI-001 + FI-009 + DG-073 B): `node-sqlite3-wasm` (WASM
 * SQLite driver, DG-062 B), `@anthropic-ai/sdk` (Anthropic SDK, DG-064 A) and
 * `openai` (OpenAI-compatible adapter, DG-071 A wired in DG-073 B) are marked
 * as `--external` en el bundle esbuild porque la interop CJS de esbuild con
 * sus deps transitivas (node-fetch, form-data, etc.) falla en runtime.
 * Recolectamos cada paquete + toda su clausura transitiva de deps de runtime
 * y los volcamos en un layout PLANO en `dist/node_modules/` — cuando la CLI
 * bundleada hace `require(<pkg>)`, Node camina hacia arriba desde
 * `dist/cli.mjs` y los encuentra ahi.
 *
 * `node-sqlite3-wasm` y `js-yaml` quedan inlineados (no en externalDeps):
 * el primero ya esta external por defecto (lo declaramos arriba); el
 * segundo es pure JS chico (~50KB) y esbuild lo inlinea sin problemas.
 * `ollama` NO esta en externalDeps porque el OllamaLlmClient usa fetch
 * global de Node — no requiere SDK.
 */
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(scriptDir);
const packagesDir = dirname(packageDir);
const distDir = join(packageDir, 'dist');

mkdirSync(distDir, { recursive: true });

// Flat assets that live next to cli.mjs.
const flatAssets = [
  join(packagesDir, 'core', 'src', 'colony', 'schema.sql'),
  join(packagesDir, 'scouts', 'src', 'opengrep', 'rules', 'sentinel-baseline.yaml'),
];

for (const asset of flatAssets) {
  copyFileSync(asset, join(distDir, basename(asset)));
}

// External CJS deps: cada paquete + clausura transitiva, layout plano en
// dist/node_modules/. La resolucion arranca desde este script y sigue los
// `dependencies` de cada package.json via createRequire chains (necesario
// bajo la aislacion estricta de pnpm).
const distNodeModules = join(distDir, 'node_modules');
rmSync(distNodeModules, { recursive: true, force: true });
mkdirSync(distNodeModules, { recursive: true });

const externalDeps = ['node-sqlite3-wasm', '@anthropic-ai/sdk', 'openai'];
const visited = new Set();

/**
 * Resuelve el directorio raiz de un paquete + su package.json.
 *
 * `require.resolve(`${pkg}/package.json`)` no funciona para paquetes que
 * bloquean el sub-path en su campo `exports` (p. ej. `@anthropic-ai/sdk`),
 * asi que resolvemos el main entry y caminamos hacia arriba buscando
 * `package.json` cuyo `name` coincida.
 */
function findPackageRoot(requireFn, pkg) {
  const mainPath = requireFn.resolve(pkg);
  let dir = dirname(mainPath);
  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const meta = JSON.parse(readFileSync(candidate, 'utf8'));
      if (meta.name === pkg) return { dir, meta, jsonPath: candidate };
    }
    dir = dirname(dir);
  }
  throw new Error(`No se pudo localizar el package.json de "${pkg}"`);
}

/** Resuelve+copia `pkg` y recursivamente todas sus deps de runtime. */
function copyPackageClosure(pkg, requireFromUrl) {
  if (visited.has(pkg)) return;
  visited.add(pkg);
  const requireFn = createRequire(requireFromUrl);
  let root;
  try {
    root = findPackageRoot(requireFn, pkg);
  } catch {
    // Deps opcionales/dev no presentes: ignorar.
    return;
  }
  const destDir = join(distNodeModules, pkg);
  mkdirSync(dirname(destDir), { recursive: true });
  cpSync(root.dir, destDir, { recursive: true, dereference: true });

  const deps = Object.keys(root.meta.dependencies ?? {});
  // Importante: usamos root.jsonPath como base de createRequire para que las
  // deps transitivas resuelvan desde la perspectiva del paquete dueño (clave
  // bajo la aislacion estricta de pnpm).
  for (const dep of deps) {
    copyPackageClosure(dep, root.jsonPath);
  }
}

for (const dep of externalDeps) {
  copyPackageClosure(dep, import.meta.url);
}
