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
 * Native modules (FI-001, DG-060 B): `better-sqlite3` is `--external` in the
 * esbuild bundle because esbuild cannot bundle `.node` binaries. We copy the
 * resolved package plus its runtime dep chain into `dist/node_modules/` so
 * Node's resolver walks up from `dist/cli.mjs` and finds them when the .vsix
 * runs. pnpm's strict isolation requires resolving each dep from its parent
 * package's context (`bindings` only resolves from `better-sqlite3`, not from
 * vscode-extension). Install-only deps like `prebuild-install` are skipped.
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

// Native package + its runtime dep chain. Each entry resolves from its
// parent's require() context to navigate pnpm's strict-isolated layout.
const distNodeModules = join(distDir, 'node_modules');
rmSync(distNodeModules, { recursive: true, force: true });
mkdirSync(distNodeModules, { recursive: true });

const requireFromExt = createRequire(import.meta.url);
const bsqlEntry = requireFromExt.resolve('better-sqlite3/package.json');
const requireFromBsql = createRequire(bsqlEntry);
const bindingsEntry = requireFromBsql.resolve('bindings/package.json');
const requireFromBindings = createRequire(bindingsEntry);
const fileUriEntry = requireFromBindings.resolve('file-uri-to-path/package.json');

const runtimeDeps = [
  ['better-sqlite3', dirname(bsqlEntry)],
  ['bindings', dirname(bindingsEntry)],
  ['file-uri-to-path', dirname(fileUriEntry)],
];

for (const [name, source] of runtimeDeps) {
  cpSync(source, join(distNodeModules, name), { recursive: true, dereference: true });
}
