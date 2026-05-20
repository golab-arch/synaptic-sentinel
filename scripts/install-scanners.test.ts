import { describe, it, expect } from 'vitest';
import {
  platformKey,
  resolvePlatformTarget,
  downloadUrl,
  type ScannerSpec,
} from './install-scanners.js';

const opengrep: ScannerSpec = {
  version: 'v1.22.0',
  repo: 'opengrep/opengrep',
  platforms: {
    'win32-x64': {
      asset: 'opengrep_windows_x86.exe',
      sha256: 'f4f91b0a6268318df1dbb63e11f0ba2e9fdc355fa27d1de8fe9abf6c8a8e9efa',
      binary: 'opengrep.exe',
    },
    'linux-x64': {
      asset: 'opengrep_manylinux_x86',
      sha256: '45bcd58440e397ed52c50e953ccf5948909ea77087c9186fc7d277216f62e319',
      binary: 'opengrep',
    },
  },
};

describe('platformKey', () => {
  it('combina plataforma y arquitectura', () => {
    expect(platformKey('win32', 'x64')).toBe('win32-x64');
  });
});

describe('resolvePlatformTarget', () => {
  it('resuelve el target de una plataforma soportada', () => {
    const target = resolvePlatformTarget(opengrep, 'win32', 'x64');
    expect(target.asset).toBe('opengrep_windows_x86.exe');
    expect(target.binary).toBe('opengrep.exe');
  });

  it('lanza un error claro en una plataforma no soportada', () => {
    expect(() => resolvePlatformTarget(opengrep, 'sunos', 'sparc')).toThrow(/no soportada/);
  });
});

describe('downloadUrl', () => {
  it('construye la URL del asset del GitHub Release', () => {
    expect(downloadUrl('opengrep/opengrep', 'v1.22.0', 'opengrep_windows_x86.exe')).toBe(
      'https://github.com/opengrep/opengrep/releases/download/v1.22.0/opengrep_windows_x86.exe',
    );
  });
});
