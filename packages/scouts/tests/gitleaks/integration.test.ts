import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitleaksScout } from '../../src/gitleaks/gitleaks-scout.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const fixturesRoot = fileURLToPath(new URL('./fixtures/secrets', import.meta.url));

/** Resuelve la ruta del binario Gitleaks instalado segun el manifest. */
function resolveBinaryPath(): string {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'scripts', 'scanners.manifest.json'), 'utf8'),
  ) as { scanners: { gitleaks: { version: string } } };
  const version = manifest.scanners.gitleaks.version;
  const binaryName = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
  return join(repoRoot, '.scanners', 'gitleaks', version, binaryName);
}

const binaryPath = resolveBinaryPath();

// Los tests de integracion requieren el binario (`pnpm scanners:install`).
// Si no esta presente se omiten en vez de fallar.
const suite = existsSync(binaryPath) ? describe : describe.skip;

suite('GitleaksScout - integracion con el binario real de Gitleaks', () => {
  const scout = new GitleaksScout({ binaryPath });

  it(
    'detecta una credencial en una fixture de secretos',
    async () => {
      const result = await scout.scan({
        scanId: 'it-secrets',
        rootPath: fixturesRoot,
        targetPaths: [],
        mode: 'full',
      });
      expect(result.status).toBe('ok');
      expect(result.findings.length).toBeGreaterThan(0);
      const finding = result.findings[0];
      if (!finding) throw new Error('se esperaba un finding');
      expect(finding.category).toBe('Secrets');
      expect(finding.severity).toBe('high');
      expect(finding.location.path).toContain('leaked-config.js');
      // El secreto no debe filtrarse al Finding: se corre con --redact.
      expect(finding.location.snippet ?? '').not.toContain('AKIAZ7Q2KL9XW3RV8TYB');
    },
    30_000,
  );
});
