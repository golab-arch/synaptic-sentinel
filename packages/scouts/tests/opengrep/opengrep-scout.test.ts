import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { OpenGrepScout, buildOpenGrepArgs } from '../../src/opengrep/opengrep-scout.js';
import type { ScanRequest } from '@synaptic-sentinel/core';

const baseRequest: ScanRequest = {
  scanId: 'scan-1',
  rootPath: '/proyecto',
  targetPaths: [],
  mode: 'full',
};

describe('buildOpenGrepArgs', () => {
  it('incluye los flags base, la config y los targets', () => {
    const args = buildOpenGrepArgs(['--config', 'auto'], {
      ...baseRequest,
      targetPaths: ['src/a.ts', 'src/b.ts'],
    });
    expect(args).toEqual([
      'scan',
      '--json',
      '--quiet',
      '--disable-version-check',
      '--config',
      'auto',
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('usa "." como target cuando la peticion no trae rutas', () => {
    const args = buildOpenGrepArgs([], baseRequest);
    expect(args[args.length - 1]).toBe('.');
  });
});

describe('OpenGrepScout', () => {
  it('expone su identidad de scout', () => {
    const scout = new OpenGrepScout({ binaryPath: '/x/opengrep', configArgs: [] });
    expect(scout.id).toBe('opengrep');
    expect(scout.displayName).toBe('OpenGrep');
    expect(scout.category).toBe('SAST');
  });

  it('isAvailable() es true si el binario existe', async () => {
    const scout = new OpenGrepScout({
      binaryPath: fileURLToPath(import.meta.url), // este archivo de test existe
      configArgs: [],
    });
    expect(await scout.isAvailable()).toBe(true);
  });

  it('isAvailable() es false si el binario no existe', async () => {
    const scout = new OpenGrepScout({
      binaryPath: '/ruta/que/no/existe/opengrep-zzz',
      configArgs: [],
    });
    expect(await scout.isAvailable()).toBe(false);
  });

  it('scan() devuelve un ScoutResult failed si el binario no esta disponible', async () => {
    const scout = new OpenGrepScout({
      binaryPath: '/ruta/que/no/existe/opengrep-zzz',
      configArgs: [],
    });
    const result = await scout.scan(baseRequest);
    expect(result.status).toBe('failed');
    expect(result.scoutId).toBe('opengrep');
    expect(result.findings).toEqual([]);
    expect(result.error).toBeDefined();
  });
});
