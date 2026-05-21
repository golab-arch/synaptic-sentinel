import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { VibeDetectScout } from '../../src/vibe-detect/vibe-detect-scout.js';
import type { ScanRequest } from '@synaptic-sentinel/core';

const fixturesRoot = fileURLToPath(new URL('./fixtures/vibe-coded', import.meta.url));

describe('VibeDetectScout', () => {
  it('expone su identidad de scout', () => {
    const scout = new VibeDetectScout();
    expect(scout.id).toBe('vibe-detect');
    expect(scout.displayName).toBe('Vibe-Detect');
    expect(scout.category).toBe('VibeCoded');
  });

  it('isAvailable() es siempre true (no depende de un binario externo)', async () => {
    expect(await new VibeDetectScout().isAvailable()).toBe(true);
  });

  it('escanea un arbol de archivos y detecta anti-patrones vibe-coded', async () => {
    const scout = new VibeDetectScout();
    const request: ScanRequest = {
      scanId: 'scan-vibe',
      rootPath: fixturesRoot,
      targetPaths: [],
      mode: 'full',
    };
    const result = await scout.scan(request);

    expect(result.status).toBe('ok');
    expect(result.scoutId).toBe('vibe-detect');
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.category === 'VibeCoded')).toBe(true);

    const ruleIds = new Set(result.findings.map((f) => f.ruleId));
    expect(ruleIds.has('vibe-placeholder-secret')).toBe(true);
    expect(ruleIds.has('vibe-permissive-cors')).toBe(true);
    expect(ruleIds.has('vibe-disabled-tls-verification')).toBe(true);

    const paths = result.findings.map((f) => f.location.path);
    expect(paths.some((p) => p.endsWith('config.py'))).toBe(true);
    expect(paths.some((p) => p.endsWith('server.js'))).toBe(true);
  });

  it('devuelve un resultado ok y vacio sobre un directorio inexistente', async () => {
    const scout = new VibeDetectScout();
    const result = await scout.scan({
      scanId: 'scan-empty',
      rootPath: fileURLToPath(new URL('./fixtures/no-existe-zzz', import.meta.url)),
      targetPaths: [],
      mode: 'full',
    });
    expect(result.status).toBe('ok');
    expect(result.findings).toEqual([]);
  });
});
