import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultCliEntry, runCliMarkFp, runCliScan, runCliTriage } from '../src/cli-runner.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('defaultCliEntry', () => {
  it('resuelve la CLI bundleada (ESM) en dist/ de la extension', () => {
    const entry = defaultCliEntry(join('repo', 'packages', 'vscode-extension'));
    expect(entry).toBe(join('repo', 'packages', 'vscode-extension', 'dist', 'cli.mjs'));
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

describe('runCliMarkFp (manejo de error)', () => {
  it('rechaza si el entry de la CLI no existe', async () => {
    await expect(
      runCliMarkFp({
        cliEntry: join(repoRoot, 'no', 'existe', 'cli.js'),
        workspacePath: repoRoot,
        fingerprint: 'fp-x',
      }),
    ).rejects.toThrow();
  });
});

describe('runCliTriage (manejo de error)', () => {
  it('rechaza si el entry de la CLI no existe', async () => {
    await expect(
      runCliTriage({
        cliEntry: join(repoRoot, 'no', 'existe', 'cli.js'),
        workspacePath: repoRoot,
        apiKey: 'sk-fake',
      }),
    ).rejects.toThrow();
  });
});
