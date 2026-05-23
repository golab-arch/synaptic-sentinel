import { cpSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/*
 * Post-bundle asset copy (FI-008).
 *
 * The bundled CLI (`dist/cli.mjs`) resolves its runtime assets relative to its
 * own location via `new URL(..., import.meta.url)`. esbuild does NOT process
 * that pattern, so the assets are not emitted by the bundle. We copy them next
 * to `cli.mjs`; `colony-db.ts` and `rules.ts` fall back to that sibling path
 * when the canonical `src/` path does not exist (i.e. when bundled).
 *
 * SQLite driver (FI-001, DG-062 B): `node-sqlite3-wasm` is `--external` in
 * the esbuild bundle because the package loads its own `.wasm` blob via
 * `fs.readFile` (esbuild can't bundle that). It has NO transitive runtime
 * deps -> one cp into `dist/node_modules/`. WASM is ABI-stable across Node
 * versions and Electron, so no rebuild ceremony for the .vsix.
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

// Native-via-WASM SQLite driver: ship the resolved package (no deps).
const distNodeModules = join(distDir, 'node_modules');
rmSync(distNodeModules, { recursive: true, force: true });
mkdirSync(distNodeModules, { recursive: true });

const requireFromHere = createRequire(import.meta.url);
const sqliteEntry = requireFromHere.resolve('node-sqlite3-wasm/package.json');
const sqliteSource = dirname(sqliteEntry);
cpSync(sqliteSource, join(distNodeModules, 'node-sqlite3-wasm'), {
  recursive: true,
  dereference: true,
});
