import { describe, it, expect } from 'vitest';
import { runVibeDetectors, type VibeDetectContext } from '../../src/vibe-detect/detect.js';

const ctx: VibeDetectContext = {
  scanId: 'scan-1',
  scoutId: 'vibe-detect',
  filePath: 'src/app.js',
  now: () => '2026-05-21T12:00:00.000Z',
  newId: () => '00000000-0000-4000-8000-000000000001',
};

describe('runVibeDetectors', () => {
  it('detecta un secreto placeholder y normaliza el Finding', () => {
    const findings = runVibeDetectors('const apiKey = "your-api-key-here";', ctx);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error('se esperaba un finding');
    expect(f.ruleId).toBe('vibe-placeholder-secret');
    expect(f.category).toBe('VibeCoded');
    expect(f.severity).toBe('high');
    expect(f.scoutId).toBe('vibe-detect');
    expect(f.location.path).toBe('src/app.js');
    expect(f.location.startLine).toBe(1);
    expect(f.location.snippet).toContain('your-api-key-here');
    expect(f.complianceRefs).toContain('CWE-798');
    expect(f.fingerprint).toBe('src/app.js:vibe-placeholder-secret:1');
    expect(f.createdAt).toBe('2026-05-21T12:00:00.000Z');
  });

  it('detecta verificacion TLS deshabilitada (verify=False)', () => {
    const findings = runVibeDetectors('    r = requests.get(u, verify=False)', ctx);
    expect(findings.map((f) => f.ruleId)).toContain('vibe-disabled-tls-verification');
  });

  it('detecta CORS abierto a cualquier origen', () => {
    const findings = runVibeDetectors("res.header('Access-Control-Allow-Origin', '*');", ctx);
    expect(findings.map((f) => f.ruleId)).toContain('vibe-permissive-cors');
  });

  it('detecta un control de seguridad suprimido en linea', () => {
    const findings = runVibeDetectors('// eslint-disable-next-line security/detect-eval', ctx);
    expect(findings.map((f) => f.ruleId)).toContain('vibe-suppressed-security-check');
  });

  it('detecta un TODO de seguridad pendiente', () => {
    const findings = runVibeDetectors('# TODO: add authentication before shipping', ctx);
    expect(findings.map((f) => f.ruleId)).toContain('vibe-security-todo-stub');
  });

  it('detecta el modo debug activado de forma fija', () => {
    const findings = runVibeDetectors('app.run(host="0.0.0.0", debug=True)', ctx);
    expect(findings.map((f) => f.ruleId)).toContain('vibe-debug-mode-enabled');
  });

  it('reporta la linea correcta en contenido multilinea', () => {
    const content = ['const a = 1;', 'const b = 2;', 'const token = "changeme";'].join('\n');
    const findings = runVibeDetectors(content, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('vibe-placeholder-secret');
    expect(findings[0]?.location.startLine).toBe(3);
  });

  it('no marca codigo limpio (sin falsos positivos)', () => {
    const content = [
      'const apiKey = process.env.API_KEY;',
      'const debug = isDevelopment();',
      '// TODO: refactor this helper',
    ].join('\n');
    expect(runVibeDetectors(content, ctx)).toEqual([]);
  });
});
