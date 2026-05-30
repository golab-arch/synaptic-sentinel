import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { OpenGrepOutputSchema, type OpenGrepOutput } from '../../src/opengrep/opengrep-output.js';
import {
  normalizeOpenGrepOutput,
  normalizeDataflowTrace,
  mapSeverity,
  extractComplianceRefs,
  relativizePath,
  canonicalRuleId,
} from '../../src/opengrep/normalizer.js';
import type { DataflowTraceRaw } from '../../src/opengrep/opengrep-output.js';

/** Carga la salida JSON real de OpenGrep capturada como fixture. */
async function loadFixture(): Promise<OpenGrepOutput> {
  const path = fileURLToPath(new URL('./fixtures/opengrep-output.sample.json', import.meta.url));
  return OpenGrepOutputSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

describe('normalizeOpenGrepOutput', () => {
  it('normaliza la salida real de OpenGrep a Finding[]', async () => {
    const output = await loadFixture();
    const findings = normalizeOpenGrepOutput(output, {
      scanId: 'scan-1',
      scoutId: 'opengrep',
      rootPath: 'd:\\tmp\\opengrep-probe',
      now: () => '2026-05-20T12:00:00.000Z',
      newId: () => '00000000-0000-4000-8000-000000000001',
    });

    expect(findings).toHaveLength(1);
    const finding = findings[0];
    if (!finding) throw new Error('se esperaba un finding');

    expect(finding.scoutId).toBe('opengrep');
    expect(finding.scanId).toBe('scan-1');
    expect(finding.severity).toBe('high'); // ERROR -> high
    expect(finding.category).toBe('SAST');
    expect(finding.ruleId).toBe('js-eval-usage'); // ruleId canonico (FI-005)
    expect(finding.title).toBe('js-eval-usage');
    expect(finding.location.path).toBe('vuln.js'); // ruta relativizada
    expect(finding.location.startLine).toBe(2);
    expect(finding.location.snippet).toBe('return eval(userInput);');
    expect(finding.complianceRefs).toEqual(['CWE-95', 'OWASP-A03']);
    expect(finding.fingerprint).toMatch(/^6cb1659b/);
    expect(finding.lifecycleState).toBe('new');
    expect(finding.createdAt).toBe('2026-05-20T12:00:00.000Z');
  });
});

describe('mapSeverity', () => {
  it('mapea las severidades de OpenGrep a las de Sentinel', () => {
    expect(mapSeverity('ERROR')).toBe('high');
    expect(mapSeverity('WARNING')).toBe('medium');
    expect(mapSeverity('INFO')).toBe('info');
    expect(mapSeverity('CRITICAL')).toBe('critical');
    expect(mapSeverity('error')).toBe('high'); // sin distinguir mayusculas
  });

  it('cae a info ante una severidad desconocida', () => {
    expect(mapSeverity('WHATEVER')).toBe('info');
  });
});

describe('extractComplianceRefs', () => {
  it('extrae codigos CWE y OWASP de la metadata', () => {
    expect(
      extractComplianceRefs({
        cwe: ['CWE-89: SQL Injection'],
        owasp: ['A03:2021 - Injection'],
      }),
    ).toEqual(['CWE-89', 'OWASP-A03']);
  });

  it('acepta cwe como string suelto', () => {
    expect(extractComplianceRefs({ cwe: 'CWE-79: XSS' })).toEqual(['CWE-79']);
  });

  it('devuelve un array vacio sin metadata', () => {
    expect(extractComplianceRefs(undefined)).toEqual([]);
  });
});

describe('relativizePath', () => {
  it('relativiza una ruta Windows respecto a la raiz', () => {
    expect(relativizePath('d:\\proj\\src\\a.ts', 'd:\\proj')).toBe('src/a.ts');
  });

  it('relativiza una ruta POSIX respecto a la raiz', () => {
    expect(relativizePath('/repo/src/b.ts', '/repo')).toBe('src/b.ts');
  });

  it('devuelve la ruta normalizada si esta fuera de la raiz', () => {
    expect(relativizePath('/otro/c.ts', '/repo')).toBe('/otro/c.ts');
  });
});

describe('canonicalRuleId', () => {
  it('toma el ultimo segmento del check_id (descarta el prefijo de ruta)', () => {
    expect(canonicalRuleId('d.tmp.probe.js-eval-usage')).toBe('js-eval-usage');
  });

  it('es idempotente sobre un id ya canonico', () => {
    expect(canonicalRuleId('sentinel-js-eval-usage')).toBe('sentinel-js-eval-usage');
  });
});

describe('normalizeDataflowTrace — DG-112 A Step 3 / §4 #3', () => {
  /** Helper: construye un location de OpenGrep para tests. */
  function loc(
    path: string,
    line: number,
    col = 1,
  ): { path: string; start: { line: number; col: number }; end: { line: number; col: number } } {
    return {
      path,
      start: { line, col },
      end: { line, col: col + 5 },
    };
  }

  it('canoniza un trace tipico (1 intermediate var) con paths relativizados + separator /', () => {
    const raw: DataflowTraceRaw = {
      taint_source: ['CliLoc', [loc('C:\\repo\\src\\api.js', 17, 15), 'req.query']],
      intermediate_vars: [{ location: loc('C:\\repo\\src\\api.js', 17, 9), content: 'dir' }],
      taint_sink: ['CliLoc', [loc('C:\\repo\\src\\api.js', 18, 3), "exec('ls ' + dir, ...)"]],
    };
    const trace = normalizeDataflowTrace(raw, 'C:\\repo');
    expect(trace).toBeDefined();
    expect(trace?.source).toEqual({ path: 'src/api.js', startLine: 17, content: 'req.query' });
    expect(trace?.intermediateSteps).toEqual([
      { path: 'src/api.js', startLine: 17, content: 'dir' },
    ]);
    expect(trace?.sink).toEqual({
      path: 'src/api.js',
      startLine: 18,
      content: "exec('ls ' + dir, ...)",
    });
    // Confirma normalizacion de separator backslash → slash en TODOS los paths.
    expect(trace?.source.path).not.toContain('\\');
    expect(trace?.intermediateSteps[0]?.path).not.toContain('\\');
    expect(trace?.sink.path).not.toContain('\\');
  });

  it('canoniza un trace SIN intermediate_vars (intermediateSteps queda [])', () => {
    const raw: DataflowTraceRaw = {
      taint_source: ['CliLoc', [loc('a.js', 1), 'tainted']],
      taint_sink: ['CliLoc', [loc('a.js', 2), 'sink(tainted)']],
    };
    const trace = normalizeDataflowTrace(raw, '/root');
    expect(trace).toBeDefined();
    expect(trace?.intermediateSteps).toEqual([]);
  });

  it('canoniza un trace con intermediate_vars: [] vacio explicito', () => {
    const raw: DataflowTraceRaw = {
      taint_source: ['CliLoc', [loc('a.js', 1), 'src']],
      intermediate_vars: [],
      taint_sink: ['CliLoc', [loc('a.js', 2), 'sink(src)']],
    };
    expect(normalizeDataflowTrace(raw, '/root')?.intermediateSteps).toEqual([]);
  });

  it('devuelve undefined si falta el taint_source (trace incompleto NO se canoniza)', () => {
    const raw: DataflowTraceRaw = {
      taint_sink: ['CliLoc', [loc('a.js', 2), 'sink']],
    };
    expect(normalizeDataflowTrace(raw, '/root')).toBeUndefined();
  });

  it('devuelve undefined si falta el taint_sink (trace incompleto NO se canoniza)', () => {
    const raw: DataflowTraceRaw = {
      taint_source: ['CliLoc', [loc('a.js', 1), 'src']],
    };
    expect(normalizeDataflowTrace(raw, '/root')).toBeUndefined();
  });

  it('preserva multi-step intermediate_vars en orden', () => {
    const raw: DataflowTraceRaw = {
      taint_source: ['CliLoc', [loc('a.js', 1), 'src']],
      intermediate_vars: [
        { location: loc('a.js', 2), content: 'step1' },
        { location: loc('a.js', 3), content: 'step2' },
        { location: loc('a.js', 4), content: 'step3' },
      ],
      taint_sink: ['CliLoc', [loc('a.js', 5), 'sink']],
    };
    const trace = normalizeDataflowTrace(raw, '/root');
    expect(trace?.intermediateSteps).toHaveLength(3);
    expect(trace?.intermediateSteps.map((s) => s.content)).toEqual(['step1', 'step2', 'step3']);
  });

  it('los Finding generados por normalizeOpenGrepOutput NO traen dataflowTrace cuando el result no lo tiene', async () => {
    // El fixture sample.json (sin dataflow_trace; regla pattern-based) NO debe
    // generar el field en el Finding (DG-112 A: solo poblado para mode:taint).
    const output = await loadFixture();
    const findings = normalizeOpenGrepOutput(output, {
      scanId: 'scan-1',
      scoutId: 'opengrep',
      rootPath: 'd:\\tmp\\opengrep-probe',
      now: () => '2026-05-20T12:00:00.000Z',
      newId: () => '00000000-0000-4000-8000-000000000001',
    });
    expect(findings[0]?.dataflowTrace).toBeUndefined();
  });
});
