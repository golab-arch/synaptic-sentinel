import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenGrepScout } from '../../src/opengrep/opengrep-scout.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const fixturesRoot = fileURLToPath(new URL('./fixtures/vulnerable', import.meta.url));
const rulesetPath = join(
  repoRoot,
  'packages',
  'scouts',
  'src',
  'opengrep',
  'rules',
  'sentinel-baseline.yaml',
);

/** Resuelve la ruta del binario OpenGrep instalado segun el manifest. */
function resolveBinaryPath(): string {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'scripts', 'scanners.manifest.json'), 'utf8'),
  ) as { scanners: { opengrep: { version: string } } };
  const version = manifest.scanners.opengrep.version;
  const binaryName = process.platform === 'win32' ? 'opengrep.exe' : 'opengrep';
  return join(repoRoot, '.scanners', 'opengrep', version, binaryName);
}

const binaryPath = resolveBinaryPath();

// Los tests de integracion requieren el binario (`pnpm scanners:install`).
// Si no esta presente -ej. un CI sin instalar- se omiten en vez de fallar.
const suite = existsSync(binaryPath) ? describe : describe.skip;

suite('OpenGrepScout - integracion con el binario real de OpenGrep', () => {
  const scout = new OpenGrepScout({
    binaryPath,
    configArgs: ['--config', rulesetPath],
  });

  it('detecta eval() en una fixture JavaScript', async () => {
    const result = await scout.scan({
      scanId: 'it-js',
      rootPath: fixturesRoot,
      targetPaths: ['javascript'],
      mode: 'full',
    });
    expect(result.status).toBe('ok');
    expect(result.findings.length).toBeGreaterThan(0);
    const finding = result.findings.find((f) => f.ruleId.includes('eval'));
    expect(finding).toBeDefined();
    expect(finding?.category).toBe('SAST');
    expect(finding?.severity).toBe('high');
    expect(finding?.location.path).toContain('eval-injection.js');
  }, 60_000);

  it('detecta new Function() en una fixture TypeScript', async () => {
    const result = await scout.scan({
      scanId: 'it-ts',
      rootPath: fixturesRoot,
      targetPaths: ['typescript'],
      mode: 'full',
    });
    expect(result.status).toBe('ok');
    expect(result.findings.some((f) => f.ruleId.includes('new-function'))).toBe(true);
  }, 60_000);

  it('detecta exec() y subprocess shell=True en una fixture Python', async () => {
    const result = await scout.scan({
      scanId: 'it-py',
      rootPath: fixturesRoot,
      targetPaths: ['python'],
      mode: 'full',
    });
    expect(result.status).toBe('ok');
    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds.some((r) => r.includes('exec'))).toBe(true);
    expect(ruleIds.some((r) => r.includes('subprocess'))).toBe(true);
  }, 60_000);

  it('detecta XSS e inyeccion de codigo en una fixture JavaScript', async () => {
    const result = await scout.scan({
      scanId: 'it-js-xss',
      rootPath: fixturesRoot,
      targetPaths: ['javascript'],
      mode: 'full',
    });
    expect(result.status).toBe('ok');
    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds.some((r) => r.includes('document-write'))).toBe(true);
    expect(ruleIds.some((r) => r.includes('innerhtml'))).toBe(true);
    expect(ruleIds.some((r) => r.includes('settimeout-string'))).toBe(true);
  }, 60_000);

  it('detecta APIs inseguras (comandos, deserializacion, MD5) en Python', async () => {
    const result = await scout.scan({
      scanId: 'it-py-unsafe',
      rootPath: fixturesRoot,
      targetPaths: ['python'],
      mode: 'full',
    });
    expect(result.status).toBe('ok');
    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds.some((r) => r.includes('os-system'))).toBe(true);
    expect(ruleIds.some((r) => r.includes('yaml-load'))).toBe(true);
    expect(ruleIds.some((r) => r.includes('pickle-load'))).toBe(true);
    expect(ruleIds.some((r) => r.includes('md5'))).toBe(true);
    // os.system() es ERROR -> high; hashlib.md5() es WARNING -> medium.
    expect(result.findings.find((f) => f.ruleId.includes('os-system'))?.severity).toBe('high');
    expect(result.findings.find((f) => f.ruleId.includes('md5'))?.severity).toBe('medium');
  }, 60_000);
});
