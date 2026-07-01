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

/*
 * DG-123 A (Cycle 111) — Interaction Graph WASM assets.
 *
 * `packages/core/src/coordinator/interaction-graph.ts` carga los grammars de
 * tree-sitter y el runtime de web-tree-sitter via `import.meta.url` con
 * fallback a sibling paths — igual patrón que `colony-db.ts` con schema.sql.
 *
 * En modo bundleado (cli.mjs), copiamos los 5 `.wasm` como flat assets junto
 * a `cli.mjs`. En modo dev/tests el fallback canónico via node_modules aplica.
 *
 * Selective bundling: solo 4 language grammars (TS/TSX/JS/Python) + el runtime
 * — NO todo el paquete tree-sitter-wasms (51.8 MB con 36 grammars). Con
 * los 4 elegidos: ~5.9 MB. Justificado en la Sub-decisión de packaging
 * (v0.3.16 + DG-123 A + Sub-B2 user-approved).
 */
const wasmAssets = [
  {
    src: join(
      packagesDir,
      '..',
      'node_modules',
      '.pnpm',
      'web-tree-sitter@0.20.8',
      'node_modules',
      'web-tree-sitter',
      'tree-sitter.wasm',
    ),
    destName: 'tree-sitter.wasm',
  },
  {
    src: join(
      packagesDir,
      '..',
      'node_modules',
      '.pnpm',
      'tree-sitter-wasms@0.1.13',
      'node_modules',
      'tree-sitter-wasms',
      'out',
      'tree-sitter-typescript.wasm',
    ),
    destName: 'tree-sitter-typescript.wasm',
  },
  {
    src: join(
      packagesDir,
      '..',
      'node_modules',
      '.pnpm',
      'tree-sitter-wasms@0.1.13',
      'node_modules',
      'tree-sitter-wasms',
      'out',
      'tree-sitter-tsx.wasm',
    ),
    destName: 'tree-sitter-tsx.wasm',
  },
  {
    src: join(
      packagesDir,
      '..',
      'node_modules',
      '.pnpm',
      'tree-sitter-wasms@0.1.13',
      'node_modules',
      'tree-sitter-wasms',
      'out',
      'tree-sitter-javascript.wasm',
    ),
    destName: 'tree-sitter-javascript.wasm',
  },
  {
    src: join(
      packagesDir,
      '..',
      'node_modules',
      '.pnpm',
      'tree-sitter-wasms@0.1.13',
      'node_modules',
      'tree-sitter-wasms',
      'out',
      'tree-sitter-python.wasm',
    ),
    destName: 'tree-sitter-python.wasm',
  },
];

for (const wasm of wasmAssets) {
  if (existsSync(wasm.src)) {
    copyFileSync(wasm.src, join(distDir, wasm.destName));
  } else {
    // Fatal: sin los grammars el interaction graph no funciona en el bundle.
    // Falla loud para atrapar el error de packaging.
    throw new Error(
      `[copy-cli-assets] DG-123 A required WASM asset missing: ${wasm.src}\n` +
        `Reinstall dependencies (pnpm install) and retry.`,
    );
  }
}

// External CJS deps: cada paquete + clausura transitiva, layout plano en
// dist/node_modules/. La resolucion arranca desde este script y sigue los
// `dependencies` de cada package.json via createRequire chains (necesario
// bajo la aislacion estricta de pnpm).
const distNodeModules = join(distDir, 'node_modules');
rmSync(distNodeModules, { recursive: true, force: true });
mkdirSync(distNodeModules, { recursive: true });

const externalDeps = ['node-sqlite3-wasm', '@anthropic-ai/sdk', 'openai', 'web-tree-sitter'];
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
