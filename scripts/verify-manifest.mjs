#!/usr/bin/env node
/**
 * Manifest validity gate (DG-083 A).
 *
 * Valida `packages/vscode-extension/package.json` contra los valores
 * esperados para un release del marketplace. Catches la clase de bug que
 * produjo el hotfix DG-082.1 (`publisher: 'GoLab'` que el marketplace
 * rechazo con "Publisher ID 'GoLab' should match 'RealGoLab'"), y previene
 * regresiones de cualquier otro field critico (name, license, main,
 * engines.vscode, icon).
 *
 * Este gate complementa a `verify-extension-activate.mjs` (DG-081 B):
 *
 *   verify-extension-activate.mjs → cubre la clase activate() runtime
 *     (DG-079.1 inlined SDKs + DG-079.2 createRequire undefined).
 *
 *   verify-manifest.mjs           → cubre la clase manifest validity
 *     (DG-082.1 publisher mismatch + cualquier otra regresion del
 *     manifest que el marketplace rechazaria al hacer vsce publish).
 *
 * Patron destilado de la lesson v3 capturada en Entry #92: el verify
 * gate es CUMULATIVO, cada clase de bug descubierta agrega un step.
 *
 * Validacion sobre el SOURCE `package.json`, no sobre el `.vsix`
 * empaquetado, porque vsce no muta el manifest principal — solo lo
 * copia tal cual al .vsix. Validar el source es suficiente para esta
 * clase de bug, y evita el overhead de `vsce package` en cada verify.
 *
 * Salida:
 *   - exit 0 + lista de todos los checks que pasaron.
 *   - exit 1 + lista de failures con diagnostico accionable.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const extensionDir = join(repoRoot, 'packages/vscode-extension');
const manifestPath = join(extensionDir, 'package.json');

/**
 * Valores esperados del manifest del extension (source-of-truth de release).
 * Si alguno necesita cambiar legitimamente (ej. bump de engines.vscode
 * minimum, cambio de license tras un re-licensing event), modificar aqui
 * conscientemente — el commit hace el cambio auditable.
 */
const EXPECTED = {
  publisher: 'RealGoLab',
  name: 'synaptic-sentinel',
  license: 'Apache-2.0',
  main: './dist/extension.cjs',
  enginesVscodeMinimum: '^1.95.0',
  repositoryUrlContains: 'github.com/golab-arch/synaptic-sentinel',
};

const failures = [];
const passed = [];

function check(label, predicate, details) {
  if (predicate) {
    passed.push(label);
  } else {
    failures.push({ label, details });
  }
}

// ── Load manifest ──────────────────────────────────────────────────
if (!existsSync(manifestPath)) {
  console.error(`❌ verify-manifest FAIL: ${manifestPath} not found.`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (err) {
  console.error(`❌ verify-manifest FAIL: ${manifestPath} is not valid JSON.`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// ── Identity fields ─────────────────────────────────────────────────
check(
  `publisher = '${EXPECTED.publisher}'`,
  manifest.publisher === EXPECTED.publisher,
  `Got '${manifest.publisher}'. The marketplace rejects upload if this does not match the Azure DevOps publisher ID. DG-082.1 captured this exact bug (v0.3.2 was rejected because publisher was 'GoLab' instead of 'RealGoLab').`,
);

check(
  `name = '${EXPECTED.name}'`,
  manifest.name === EXPECTED.name,
  `Got '${manifest.name}'. Changing the name produces a different marketplace identifier and breaks any existing install.`,
);

check(
  `license = '${EXPECTED.license}'`,
  manifest.license === EXPECTED.license,
  `Got '${manifest.license}'. The project is committed to Apache-2.0 (DG-066 B strategic pivot); changes must be deliberate.`,
);

// ── Bundle / entrypoint ─────────────────────────────────────────────
check(
  `main = '${EXPECTED.main}'`,
  manifest.main === EXPECTED.main,
  `Got '${manifest.main}'. VSCode loads the extension from this path; changing it without updating the bundle script breaks activation.`,
);

// ── Versioning ──────────────────────────────────────────────────────
const semverRegex = /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/;
check(
  `version matches semver (\\d+.\\d+.\\d+)`,
  typeof manifest.version === 'string' && semverRegex.test(manifest.version),
  `Got '${manifest.version}'. The marketplace and vsce require strict semver.`,
);

const rangeRegex = /^\^?\d+\.\d+\.\d+$/;
check(
  `engines.vscode is a semver range`,
  typeof manifest.engines?.vscode === 'string' && rangeRegex.test(manifest.engines.vscode),
  `Got '${manifest.engines?.vscode}'. Should be a range like '^1.95.0'.`,
);

check(
  `engines.vscode >= '${EXPECTED.enginesVscodeMinimum}'`,
  manifest.engines?.vscode === EXPECTED.enginesVscodeMinimum,
  `Got '${manifest.engines?.vscode}'. If you intentionally bumped the minimum, update EXPECTED.enginesVscodeMinimum in scripts/verify-manifest.mjs.`,
);

// ── Icon present + file exists ──────────────────────────────────────
check(
  `icon field is set`,
  typeof manifest.icon === 'string' && manifest.icon.length > 0,
  `Got '${manifest.icon}'. The marketplace listing requires an icon.`,
);

if (typeof manifest.icon === 'string' && manifest.icon.length > 0) {
  const iconPath = join(extensionDir, manifest.icon);
  check(
    `icon file exists at '${manifest.icon}'`,
    existsSync(iconPath),
    `Looked for ${iconPath} — not found. Either the icon was removed or the path is wrong.`,
  );
}

// ── Marketplace metadata (required for healthy listing) ─────────────
check(
  `displayName is set`,
  typeof manifest.displayName === 'string' && manifest.displayName.length > 0,
  `Got '${manifest.displayName}'. Marketplace listings show displayName as the title.`,
);

check(
  `description is non-empty`,
  typeof manifest.description === 'string' && manifest.description.length > 10,
  `Got '${manifest.description}'. Marketplace listings show description below the title.`,
);

check(
  `categories is a non-empty array`,
  Array.isArray(manifest.categories) && manifest.categories.length > 0,
  `Got ${JSON.stringify(manifest.categories)}. Marketplace requires at least one category for filtering.`,
);

check(
  `keywords is a non-empty array`,
  Array.isArray(manifest.keywords) && manifest.keywords.length > 0,
  `Got ${JSON.stringify(manifest.keywords)}. Keywords improve marketplace discoverability.`,
);

// ── Repository + homepage + bugs (required for trust + linkbacks) ───
check(
  `repository.url contains '${EXPECTED.repositoryUrlContains}'`,
  typeof manifest.repository?.url === 'string' &&
    manifest.repository.url.includes(EXPECTED.repositoryUrlContains),
  `Got '${manifest.repository?.url}'. The marketplace links to repository.url for source review.`,
);

check(
  `homepage is a URL`,
  typeof manifest.homepage === 'string' && manifest.homepage.startsWith('http'),
  `Got '${manifest.homepage}'. Marketplace listings link to homepage.`,
);

check(
  `bugs.url is a URL`,
  typeof manifest.bugs?.url === 'string' && manifest.bugs.url.startsWith('http'),
  `Got '${manifest.bugs?.url}'. Marketplace listings link to bugs.url for user reports.`,
);

// ── activationEvents present ────────────────────────────────────────
check(
  `activationEvents is a non-empty array`,
  Array.isArray(manifest.activationEvents) && manifest.activationEvents.length > 0,
  `Got ${JSON.stringify(manifest.activationEvents)}. Extension would never activate without at least one event.`,
);

// ── contributes.commands present ────────────────────────────────────
check(
  `contributes.commands has at least 5 entries`,
  Array.isArray(manifest.contributes?.commands) && manifest.contributes.commands.length >= 5,
  `Got ${manifest.contributes?.commands?.length ?? 'undefined'}. Expected the 5 SYNAPTIC Sentinel commands (Scan / Triage / Set API Key / Install Scanners / Configure Providers).`,
);

// ── Output ──────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n❌ verify-manifest FAIL (${failures.length} check(s) failed):\n`);
  for (const { label, details } of failures) {
    console.error(`  ✗ ${label}`);
    console.error(`      ${details}`);
    console.error('');
  }
  console.error(
    `Gate covers: extension manifest validity (catches the class of bug ` +
      `that produced DG-082.1 — publisher mismatch with the marketplace publisher).`,
  );
  process.exit(1);
}

console.log(`\n✅ verify-manifest OK (${passed.length} checks passed)`);
for (const label of passed) console.log(`   ✓ ${label}`);
console.log(
  `\nGate covers: extension manifest validity (would catch publisher ` +
    `mismatch, missing icon, broken engines.vscode range, missing repository URL, etc.).`,
);
process.exit(0);
