import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCliScan } from '../src/cli-runner.js';
import { findingToDiagnosticInput } from '../src/diagnostics.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Integracion: requiere la extension construida (`pnpm bundle` bundlea la CLI
// a dist/cli.mjs) y OpenGrep instalado.
const cliEntry = join(repoRoot, 'packages', 'vscode-extension', 'dist', 'cli.mjs');
const opengrepInstalled = existsSync(join(repoRoot, '.scanners', 'opengrep'));
const integrationSuite = existsSync(cliEntry) && opengrepInstalled ? describe : describe.skip;

integrationSuite('runCliScan - integracion con la CLI real', () => {
  const probeDir = fileURLToPath(new URL('./fixtures/probe', import.meta.url));

  afterAll(() => {
    // DG-093 A: la CLI ahora crea .sentinel/colony.db (no .synaptic-sentinel/).
    // Limpiamos ambos por si el probe quedó con el legacy de una corrida anterior.
    rmSync(join(probeDir, '.sentinel'), { recursive: true, force: true });
    rmSync(join(probeDir, '.synaptic-sentinel'), { recursive: true, force: true });
  });

  // Timeout de 120s: la CLI arranca en frio varios binarios externos
  // (Checkov, onefile de PyInstaller, es el mas lento) y 60s no alcanzan.
  it('escanea un probe vulnerable, transmite la salida y devuelve findings parseados', async () => {
    let streamed = '';
    const tomo = await runCliScan({
      cliEntry,
      workspacePath: probeDir,
      onOutput: (chunk) => {
        streamed += chunk;
      },
    });
    expect(tomo.findings.length).toBeGreaterThan(0);
    // El stream de la CLI llego al callback (banner verbose, DG-038 B).
    expect(streamed).toContain('SYNAPTIC SENTINEL');

    const finding = tomo.findings[0];
    if (!finding) throw new Error('se esperaba un finding');
    const input = findingToDiagnosticInput(finding);
    expect(input.path).toContain('eval-vuln.js');
    expect(input.level).toBe('error');
  }, 120_000);
});
