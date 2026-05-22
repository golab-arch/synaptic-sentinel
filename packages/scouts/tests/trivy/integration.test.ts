import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrivyScout } from '../../src/trivy/trivy-scout.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const fixturesRoot = fileURLToPath(new URL('./fixtures/vulnerable-deps', import.meta.url));

/** Resuelve la ruta del binario Trivy instalado segun el manifest. */
function resolveBinaryPath(): string {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'scripts', 'scanners.manifest.json'), 'utf8'),
  ) as { scanners: { trivy: { version: string } } };
  const version = manifest.scanners.trivy.version;
  const binaryName = process.platform === 'win32' ? 'trivy.exe' : 'trivy';
  return join(repoRoot, '.scanners', 'trivy', version, binaryName);
}

const binaryPath = resolveBinaryPath();

// Los tests de integracion requieren el binario (`pnpm scanners:install`).
// Si no esta presente se omiten en vez de fallar.
const suite = existsSync(binaryPath) ? describe : describe.skip;

suite('TrivyScout - integracion con el binario real de Trivy', () => {
  const scout = new TrivyScout({ binaryPath });

  it('detecta una dependencia vulnerable (lodash) en un package-lock.json', async () => {
    const result = await scout.scan({
      scanId: 'it-sca',
      rootPath: fixturesRoot,
      targetPaths: [],
      mode: 'full',
    });
    expect(result.status).toBe('ok');
    expect(result.findings.length).toBeGreaterThan(0);
    const finding = result.findings[0];
    if (!finding) throw new Error('se esperaba un finding');
    expect(finding.category).toBe('SCA');
    expect(finding.location.path).toContain('package-lock.json');
    expect(finding.ruleId).toMatch(/^(CVE|GHSA)-/);
  }, 120_000);
});
