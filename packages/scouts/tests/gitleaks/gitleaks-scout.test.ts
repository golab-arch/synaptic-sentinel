import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { GitleaksScout, buildGitleaksArgs } from '../../src/gitleaks/gitleaks-scout.js';
import type { ScanRequest } from '@synaptic-sentinel/core';

const baseRequest: ScanRequest = {
  scanId: 'scan-1',
  rootPath: '/proyecto',
  targetPaths: [],
  mode: 'full',
};

describe('buildGitleaksArgs', () => {
  it('construye los argumentos de "gitleaks dir" con salida JSON a stdout', () => {
    const args = buildGitleaksArgs(baseRequest);
    expect(args[0]).toBe('dir');
    expect(args[1]).toBe('.'); // sin targets -> directorio actual
    expect(args).toContain('--report-format');
    expect(args).toContain('json');
    expect(args).toContain('--report-path');
    expect(args).toContain('--redact'); // el secreto no se persiste
    expect(args).toContain('--no-banner');
  });

  it('usa el primer target cuando la peticion trae rutas', () => {
    const args = buildGitleaksArgs({ ...baseRequest, targetPaths: ['src'] });
    expect(args[1]).toBe('src');
  });
});

describe('GitleaksScout', () => {
  it('expone su identidad de scout', () => {
    const scout = new GitleaksScout({ binaryPath: '/x/gitleaks' });
    expect(scout.id).toBe('gitleaks');
    expect(scout.displayName).toBe('Gitleaks');
    expect(scout.category).toBe('Secrets');
  });

  it('isAvailable() es true si el binario existe', async () => {
    const scout = new GitleaksScout({ binaryPath: fileURLToPath(import.meta.url) });
    expect(await scout.isAvailable()).toBe(true);
  });

  it('isAvailable() es false si el binario no existe', async () => {
    const scout = new GitleaksScout({ binaryPath: '/ruta/que/no/existe/gitleaks-zzz' });
    expect(await scout.isAvailable()).toBe(false);
  });

  it('scan() devuelve un ScoutResult failed si el binario no esta disponible', async () => {
    const scout = new GitleaksScout({ binaryPath: '/ruta/que/no/existe/gitleaks-zzz' });
    const result = await scout.scan(baseRequest);
    expect(result.status).toBe('failed');
    expect(result.scoutId).toBe('gitleaks');
    expect(result.findings).toEqual([]);
    expect(result.error).toBeDefined();
  });
});
