import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { TrivyScout, buildTrivyArgs } from '../../src/trivy/trivy-scout.js';
import type { ScanRequest } from '@synaptic-sentinel/core';

const baseRequest: ScanRequest = {
  scanId: 'scan-1',
  rootPath: '/proyecto',
  targetPaths: [],
  mode: 'full',
};

describe('buildTrivyArgs', () => {
  it('construye los argumentos de "trivy fs --scanners vuln" con salida JSON', () => {
    const args = buildTrivyArgs(baseRequest);
    expect(args[0]).toBe('fs');
    expect(args).toContain('--scanners');
    expect(args).toContain('vuln');
    expect(args).toContain('--format');
    expect(args).toContain('json');
    expect(args).toContain('--quiet');
    expect(args[args.length - 1]).toBe('.'); // sin targets -> directorio actual
  });

  it('usa el primer target cuando la peticion trae rutas', () => {
    const args = buildTrivyArgs({ ...baseRequest, targetPaths: ['pkg'] });
    expect(args[args.length - 1]).toBe('pkg');
  });
});

describe('TrivyScout', () => {
  it('expone su identidad de scout', () => {
    const scout = new TrivyScout({ binaryPath: '/x/trivy' });
    expect(scout.id).toBe('trivy');
    expect(scout.displayName).toBe('Trivy');
    expect(scout.category).toBe('SCA');
  });

  it('isAvailable() es true si el binario existe', async () => {
    const scout = new TrivyScout({ binaryPath: fileURLToPath(import.meta.url) });
    expect(await scout.isAvailable()).toBe(true);
  });

  it('isAvailable() es false si el binario no existe', async () => {
    const scout = new TrivyScout({ binaryPath: '/ruta/que/no/existe/trivy-zzz' });
    expect(await scout.isAvailable()).toBe(false);
  });

  it('scan() devuelve un ScoutResult failed si el binario no esta disponible', async () => {
    const scout = new TrivyScout({ binaryPath: '/ruta/que/no/existe/trivy-zzz' });
    const result = await scout.scan(baseRequest);
    expect(result.status).toBe('failed');
    expect(result.scoutId).toBe('trivy');
    expect(result.findings).toEqual([]);
    expect(result.error).toBeDefined();
  });
});
