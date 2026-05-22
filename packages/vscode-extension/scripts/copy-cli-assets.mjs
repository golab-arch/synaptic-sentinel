import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Post-bundle asset copy (FI-008).
 *
 * The bundled CLI (`dist/cli.mjs`) resolves its runtime assets relative to its
 * own location via `new URL(..., import.meta.url)`. esbuild does NOT process
 * that pattern, so the assets are not emitted by the bundle. We copy them next
 * to `cli.mjs`; `colony-db.ts` and `rules.ts` fall back to that sibling path
 * when the canonical `src/` path does not exist (i.e. when bundled).
 */
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(scriptDir);
const packagesDir = dirname(packageDir);
const distDir = join(packageDir, 'dist');

mkdirSync(distDir, { recursive: true });

const assets = [
  join(packagesDir, 'core', 'src', 'colony', 'schema.sql'),
  join(packagesDir, 'scouts', 'src', 'opengrep', 'rules', 'sentinel-baseline.yaml'),
];

for (const asset of assets) {
  copyFileSync(asset, join(distDir, basename(asset)));
}
