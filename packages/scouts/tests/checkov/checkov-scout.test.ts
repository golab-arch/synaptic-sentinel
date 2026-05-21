import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { CheckovScout, buildCheckovArgs } from '../../src/checkov/checkov-scout.js';
import type { ScanRequest } from '@synaptic-sentinel/core';

const baseRequest: ScanRequest = {
  scanId: 'scan-1',
  rootPath: '/proyecto',
  targetPaths: [],
  mode: 'full',
};

describe('buildCheckovArgs', () => {
  it('construye los argumentos de "checkov -d" con salida JSON y soft-fail', () => {
    const args = buildCheckovArgs(baseRequest);
    expect(args[0]).toBe('-d');
    expect(args[1]).toBe('.'); // sin targets -> directorio actual
    expect(args).toContain('-o');
    expect(args).toContain('json');
    expect(args).toContain('--compact');
    expect(args).toContain('--quiet');
    expect(args).toContain('--soft-fail');
  });

  it('usa el primer target cuando la peticion trae rutas', () => {
    const args = buildCheckovArgs({ ...baseRequest, targetPaths: ['infra'] });
    expect(args[1]).toBe('infra');
  });
});

describe('CheckovScout', () => {
  it('expone su identidad de scout', () => {
    const scout = new CheckovScout({ binaryPath: '/x/checkov' });
    expect(scout.id).toBe('checkov');
    expect(scout.displayName).toBe('Checkov');
    expect(scout.category).toBe('IaC');
  });

  it('isAvailable() es true si el binario existe', async () => {
    const scout = new CheckovScout({ binaryPath: fileURLToPath(import.meta.url) });
    expect(await scout.isAvailable()).toBe(true);
  });

  it('isAvailable() es false si el binario no existe', async () => {
    const scout = new CheckovScout({ binaryPath: '/ruta/que/no/existe/checkov-zzz' });
    expect(await scout.isAvailable()).toBe(false);
  });

  it('scan() devuelve un ScoutResult failed si el binario no esta disponible', async () => {
    const scout = new CheckovScout({ binaryPath: '/ruta/que/no/existe/checkov-zzz' });
    const result = await scout.scan(baseRequest);
    expect(result.status).toBe('failed');
    expect(result.scoutId).toBe('checkov');
    expect(result.findings).toEqual([]);
    expect(result.error).toBeDefined();
  });
});
