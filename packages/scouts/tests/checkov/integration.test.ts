import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CheckovScout } from '../../src/checkov/checkov-scout.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const fixturesRoot = fileURLToPath(new URL('./fixtures/iac', import.meta.url));

/** Resuelve la ruta del binario Checkov instalado segun el manifest. */
function resolveBinaryPath(): string {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'scripts', 'scanners.manifest.json'), 'utf8'),
  ) as { scanners: { checkov: { version: string } } };
  const version = manifest.scanners.checkov.version;
  const binaryName = process.platform === 'win32' ? 'checkov.exe' : 'checkov';
  return join(repoRoot, '.scanners', 'checkov', version, binaryName);
}

const binaryPath = resolveBinaryPath();

// Los tests de integracion requieren el binario (`pnpm scanners:install`).
// Si no esta presente se omiten en vez de fallar.
const suite = existsSync(binaryPath) ? describe : describe.skip;

suite('CheckovScout - integracion con el binario real de Checkov', () => {
  const scout = new CheckovScout({ binaryPath });

  it('detecta misconfiguraciones en un Dockerfile vulnerable', async () => {
    const result = await scout.scan({
      scanId: 'it-iac',
      rootPath: fixturesRoot,
      targetPaths: [],
      mode: 'full',
    });
    expect(result.status).toBe('ok');
    expect(result.findings.length).toBeGreaterThan(0);
    const finding = result.findings[0];
    if (!finding) throw new Error('se esperaba un finding');
    expect(finding.category).toBe('IaC');
    expect(finding.location.path).toContain('Dockerfile');
    expect(finding.ruleId).toMatch(/^CKV_/);
  }, 120_000);
});
