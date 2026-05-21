import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultCliEntry, runCliScan } from '../src/cli-runner.js';
import { findingToDiagnosticInput } from '../src/diagnostics.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('defaultCliEntry', () => {
  it('resuelve la CLI como paquete hermano de la extension', () => {
    const entry = defaultCliEntry(join('repo', 'packages', 'vscode-extension'));
    expect(entry).toBe(join('repo', 'packages', 'cli', 'dist', 'index.js'));
  });
});

describe('runCliScan (manejo de error)', () => {
  it('rechaza si el entry de la CLI no existe', async () => {
    await expect(
      runCliScan({
        cliEntry: join(repoRoot, 'no', 'existe', 'cli.js'),
        workspacePath: repoRoot,
      }),
    ).rejects.toThrow();
  });
});

// Integracion: requiere la CLI construida (`pnpm build`) y OpenGrep instalado.
const cliEntry = join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
const opengrepInstalled = existsSync(join(repoRoot, '.scanners', 'opengrep'));
const integrationSuite = existsSync(cliEntry) && opengrepInstalled ? describe : describe.skip;

integrationSuite('runCliScan - integracion con la CLI real', () => {
  const probeDir = fileURLToPath(new URL('./fixtures/probe', import.meta.url));

  afterAll(() => {
    // La CLI crea .synaptic-sentinel/colony.db en el dir escaneado.
    rmSync(join(probeDir, '.synaptic-sentinel'), { recursive: true, force: true });
  });

  it(
    'escanea un probe vulnerable y devuelve findings parseados',
    async () => {
      const tomo = await runCliScan({ cliEntry, workspacePath: probeDir });
      expect(tomo.findings.length).toBeGreaterThan(0);

      const finding = tomo.findings[0];
      if (!finding) throw new Error('se esperaba un finding');
      const input = findingToDiagnosticInput(finding);
      expect(input.path).toContain('eval-vuln.js');
      expect(input.level).toBe('error');
    },
    60_000,
  );
});
