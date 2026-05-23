import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  diagnosticLevelForSeverity,
  findingHoverMarkdown,
  findingToDiagnosticInput,
  findingsInRange,
  groupDiagnosticsByPath,
  remediationClipboardText,
  triageLabel,
} from '../src/diagnostics.js';
import type { ExtensionFinding } from '../src/tomo.js';

/** Construye un ExtensionFinding valido de base. */
function makeFinding(overrides: Partial<ExtensionFinding> = {}): ExtensionFinding {
  return {
    severity: 'high',
    category: 'SAST',
    ruleId: 'rule-x',
    title: 'rule-x',
    message: 'Hallazgo de prueba',
    location: { path: 'src/a.js', startLine: 4 },
    fingerprint: 'fp-base',
    lifecycleState: 'new',
    ...overrides,
  };
}

describe('diagnosticLevelForSeverity', () => {
  it('mapea critical/high a error, medium a warning, low/info a info', () => {
    expect(diagnosticLevelForSeverity('critical')).toBe('error');
    expect(diagnosticLevelForSeverity('high')).toBe('error');
    expect(diagnosticLevelForSeverity('medium')).toBe('warning');
    expect(diagnosticLevelForSeverity('low')).toBe('info');
    expect(diagnosticLevelForSeverity('info')).toBe('info');
  });

  it('usa warning para una severidad desconocida', () => {
    expect(diagnosticLevelForSeverity('xyz')).toBe('warning');
  });
});

describe('findingToDiagnosticInput', () => {
  it('mapea un finding y rellena columnas/lineas ausentes', () => {
    const input = findingToDiagnosticInput(makeFinding());
    expect(input.path).toBe('src/a.js');
    expect(input.startLine).toBe(4);
    expect(input.startColumn).toBe(1); // default
    expect(input.endLine).toBe(4); // = startLine
    expect(input.endColumn).toBe(1); // = startColumn
    expect(input.level).toBe('error');
    expect(input.message).toBe('rule-x: Hallazgo de prueba');
    expect(input.fingerprint).toBe('fp-base');
  });

  it('respeta las columnas/lineas explicitas del finding', () => {
    const input = findingToDiagnosticInput(
      makeFinding({
        location: { path: 'b.ts', startLine: 2, endLine: 5, startColumn: 3, endColumn: 9 },
      }),
    );
    expect(input.startLine).toBe(2);
    expect(input.endLine).toBe(5);
    expect(input.startColumn).toBe(3);
    expect(input.endColumn).toBe(9);
  });

  it('anota el ciclo de vida no-new en el mensaje', () => {
    const input = findingToDiagnosticInput(makeFinding({ lifecycleState: 'known' }));
    expect(input.message).toBe('rule-x (known): Hallazgo de prueba');
  });

  it('anota el veredicto de triage en el mensaje', () => {
    const input = findingToDiagnosticInput(
      makeFinding({
        triage: { classification: 'false_positive', confidence: 0.9, rationale: 'sin riesgo' },
      }),
    );
    expect(input.message).toContain('[triage: false positive]');
  });
});

describe('findingHoverMarkdown', () => {
  it('incluye titulo, severidad, categoria y regla del hallazgo', () => {
    const md = findingHoverMarkdown(makeFinding());
    expect(md).toContain('SYNAPTIC Sentinel');
    expect(md).toContain('rule-x');
    expect(md).toContain('high');
    expect(md).toContain('SAST');
  });

  it('no incluye secciones del Brain Layer si el hallazgo no fue procesado', () => {
    const md = findingHoverMarkdown(makeFinding());
    expect(md).not.toContain('Triage:');
    expect(md).not.toContain('Context:');
    expect(md).not.toContain('Remediation:');
  });

  it('incluye triage, contexto y remediacion cuando estan presentes', () => {
    const md = findingHoverMarkdown(
      makeFinding({
        triage: { classification: 'true_positive', confidence: 0.95, rationale: 'riesgo real' },
        context: {
          summary: 'eval sobre entrada del usuario',
          entryPoint: 'req.query.expr',
          sink: 'eval()',
          exposure: 'ejecucion de codigo arbitrario',
        },
        remediation: {
          summary: 'reemplazar eval por un parser seguro',
          recommendation: 'usar JSON.parse',
          fixedSnippet: 'JSON.parse(req.query.expr)',
        },
      }),
    );
    expect(md).toContain('**Triage:** true positive');
    expect(md).toContain('riesgo real');
    expect(md).toContain('**Context:** eval sobre entrada del usuario');
    expect(md).toContain('Sink: eval()');
    expect(md).toContain('**Remediation:** reemplazar eval por un parser seguro');
    expect(md).toContain('JSON.parse(req.query.expr)');
  });

  it('omite el bloque de snippet cuando la remediacion no lo trae', () => {
    const md = findingHoverMarkdown(
      makeFinding({
        remediation: {
          summary: 'rotar el secreto',
          recommendation: 'revocar y emitir uno nuevo',
        },
      }),
    );
    expect(md).toContain('**Remediation:** rotar el secreto');
    expect(md).not.toContain('```');
  });
});

describe('remediationClipboardText', () => {
  it('devuelve undefined si el hallazgo no tiene remediacion', () => {
    expect(remediationClipboardText(makeFinding())).toBeUndefined();
  });

  it('arma el texto de la remediacion con el hallazgo, los pasos y el snippet', () => {
    const text = remediationClipboardText(
      makeFinding({
        location: { path: 'src/a.js', startLine: 7 },
        remediation: {
          summary: 'reemplazar eval por un parser seguro',
          recommendation: 'usar JSON.parse en vez de eval',
          fixedSnippet: 'JSON.parse(input)',
        },
      }),
    );
    expect(text).toBeDefined();
    expect(text).toContain('src/a.js:7');
    expect(text).toContain('reemplazar eval por un parser seguro');
    expect(text).toContain('usar JSON.parse en vez de eval');
    expect(text).toContain('Suggested code:');
    expect(text).toContain('JSON.parse(input)');
  });

  it('omite la seccion de codigo cuando no hay snippet', () => {
    const text = remediationClipboardText(
      makeFinding({
        remediation: { summary: 'rotar el secreto', recommendation: 'revocar la credencial' },
      }),
    );
    expect(text).toContain('rotar el secreto');
    expect(text).not.toContain('Suggested code:');
  });
});

describe('triageLabel', () => {
  it('traduce las clasificaciones de triage', () => {
    expect(triageLabel('true_positive')).toBe('true positive');
    expect(triageLabel('false_positive')).toBe('false positive');
    expect(triageLabel('inconclusive')).toBe('inconclusive');
  });

  it('devuelve la clasificacion cruda si es desconocida', () => {
    expect(triageLabel('otra')).toBe('otra');
  });
});

describe('groupDiagnosticsByPath', () => {
  it('agrupa los inputs por ruta de archivo', () => {
    const inputs = [
      findingToDiagnosticInput(makeFinding({ location: { path: 'a.js', startLine: 1 } })),
      findingToDiagnosticInput(makeFinding({ location: { path: 'a.js', startLine: 9 } })),
      findingToDiagnosticInput(makeFinding({ location: { path: 'b.js', startLine: 2 } })),
    ];
    const grouped = groupDiagnosticsByPath(inputs);
    expect(grouped.size).toBe(2);
    expect(grouped.get('a.js')).toHaveLength(2);
    expect(grouped.get('b.js')).toHaveLength(1);
  });

  it('devuelve un mapa vacio para una lista vacia', () => {
    expect(groupDiagnosticsByPath([]).size).toBe(0);
  });
});

describe('findingsInRange', () => {
  const workspacePath = join('repo', 'proyecto');

  it('encuentra los hallazgos del documento dentro del rango de lineas', () => {
    const findings = [
      makeFinding({ location: { path: 'src/a.js', startLine: 5 }, fingerprint: 'fp-1' }),
      makeFinding({ location: { path: 'src/a.js', startLine: 99 }, fingerprint: 'fp-2' }),
      makeFinding({ location: { path: 'src/b.js', startLine: 5 }, fingerprint: 'fp-3' }),
    ];
    const docPath = join(workspacePath, 'src', 'a.js');
    // La linea 5 (1-based) es la 4 (0-based) en vscode.Range.
    const matches = findingsInRange(findings, workspacePath, docPath, 4, 4);
    expect(matches.map((finding) => finding.fingerprint)).toEqual(['fp-1']);
  });

  it('devuelve vacio si el documento no coincide con ningun hallazgo', () => {
    const findings = [makeFinding({ location: { path: 'src/a.js', startLine: 5 } })];
    const otherDoc = join(workspacePath, 'src', 'otro.js');
    expect(findingsInRange(findings, workspacePath, otherDoc, 0, 100)).toEqual([]);
  });
});
