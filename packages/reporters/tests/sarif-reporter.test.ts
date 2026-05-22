import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildTomo } from '../src/tomo.js';
import { renderTomoSarif } from '../src/sarif-reporter.js';

/** Vista tipada del subconjunto de SARIF que emite el reporter. */
interface ParsedSarif {
  $schema: string;
  version: string;
  runs: ReadonlyArray<{
    tool: {
      driver: {
        name: string;
        version: string;
        rules: ReadonlyArray<{
          id: string;
          name: string;
          shortDescription: { text: string };
          properties: { tags: string[]; 'security-severity': string };
        }>;
      };
    };
    results: ReadonlyArray<{
      ruleId: string;
      ruleIndex: number;
      level: string;
      message: { text: string };
      locations: ReadonlyArray<{
        physicalLocation: {
          artifactLocation: { uri: string };
          region: {
            startLine: number;
            endLine?: number;
            startColumn?: number;
            endColumn?: number;
            snippet?: { text: string };
          };
        };
      }>;
      partialFingerprints: Record<string, string>;
      properties: Record<string, string>;
    }>;
  }>;
}

/** Construye un Finding valido de base. */
function makeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    scanId: 'scan-1',
    scoutId: 'opengrep',
    severity: 'high',
    category: 'SAST',
    ruleId: 'sentinel-js-eval-usage',
    title: 'sentinel-js-eval-usage',
    message: 'Uso de eval(): ejecuta codigo arbitrario.',
    location: { path: 'src/x.ts', startLine: 3 },
    complianceRefs: ['CWE-95', 'OWASP-A03'],
    fingerprint: `fp-${randomUUID()}`,
    lifecycleState: 'new',
    createdAt: '2026-05-22T00:00:00.000Z',
    ...overrides,
  };
}

/** Construye un ScanOutcome valido de base. */
function makeOutcome(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scanId: 'scan-1',
    status: 'ok',
    findingsCount: 1,
    suppressedCount: 0,
    scouts: [{ scoutId: 'opengrep', status: 'ok', findings: 1 }],
    startedAt: '2026-05-22T00:00:00.000Z',
    finishedAt: '2026-05-22T00:00:05.000Z',
    ...overrides,
  };
}

const meta = { rootPath: '/proyecto', sentinelVersion: '0.0.0' };

/** Parsea la salida del reporter a la vista tipada. */
function parse(sarif: string): ParsedSarif {
  return JSON.parse(sarif) as ParsedSarif;
}

describe('renderTomoSarif', () => {
  it('emite un log SARIF 2.1.0 valido con el driver de Sentinel', () => {
    const sarif = renderTomoSarif(buildTomo(makeOutcome(), [makeFinding()], meta));
    const log = parse(sarif);

    expect(log.version).toBe('2.1.0');
    expect(log.$schema).toContain('sarif-schema-2.1.0');
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]?.tool.driver.name).toBe('Synaptic Sentinel');
    expect(log.runs[0]?.tool.driver.version).toBe('0.0.0');
  });

  it('mapea un hallazgo a un result con ruleId, level, mensaje y ubicacion', () => {
    const finding = makeFinding({
      location: {
        path: 'src/x.ts',
        startLine: 3,
        endLine: 4,
        startColumn: 5,
        endColumn: 9,
        snippet: 'eval(userInput)',
      },
    });
    const log = parse(renderTomoSarif(buildTomo(makeOutcome(), [finding], meta)));
    const result = log.runs[0]?.results[0];

    expect(result?.ruleId).toBe('sentinel-js-eval-usage');
    expect(result?.level).toBe('error');
    expect(result?.message.text).toContain('eval()');
    const region = result?.locations[0]?.physicalLocation.region;
    expect(result?.locations[0]?.physicalLocation.artifactLocation.uri).toBe('src/x.ts');
    expect(region?.startLine).toBe(3);
    expect(region?.endLine).toBe(4);
    expect(region?.startColumn).toBe(5);
    expect(region?.endColumn).toBe(9);
    expect(region?.snippet?.text).toBe('eval(userInput)');
  });

  it('omite los campos de region ausentes en el hallazgo', () => {
    const log = parse(renderTomoSarif(buildTomo(makeOutcome(), [makeFinding()], meta)));
    const region = log.runs[0]?.results[0]?.locations[0]?.physicalLocation.region;

    expect(region?.startLine).toBe(3);
    expect(region?.endLine).toBeUndefined();
    expect(region?.startColumn).toBeUndefined();
    expect(region?.snippet).toBeUndefined();
  });

  it('mapea cada severidad a su nivel SARIF', () => {
    const cases: ReadonlyArray<[string, string]> = [
      ['critical', 'error'],
      ['high', 'error'],
      ['medium', 'warning'],
      ['low', 'note'],
      ['info', 'note'],
    ];
    for (const [severity, level] of cases) {
      const finding = makeFinding({ severity, fingerprint: `fp-${severity}` });
      const log = parse(renderTomoSarif(buildTomo(makeOutcome(), [finding], meta)));
      expect(log.runs[0]?.results[0]?.level).toBe(level);
    }
  });

  it('deduplica las reglas: dos hallazgos del mismo ruleId comparten una regla', () => {
    const a = makeFinding({ fingerprint: 'fp-a' });
    const b = makeFinding({ fingerprint: 'fp-b' });
    const log = parse(renderTomoSarif(buildTomo(makeOutcome(), [a, b], meta)));

    expect(log.runs[0]?.tool.driver.rules).toHaveLength(1);
    expect(log.runs[0]?.results[0]?.ruleIndex).toBe(0);
    expect(log.runs[0]?.results[1]?.ruleIndex).toBe(0);
  });

  it('publica security-severity y tags en la regla', () => {
    const log = parse(renderTomoSarif(buildTomo(makeOutcome(), [makeFinding()], meta)));
    const rule = log.runs[0]?.tool.driver.rules[0];

    expect(rule?.id).toBe('sentinel-js-eval-usage');
    expect(rule?.properties['security-severity']).toBe('8.0');
    expect(rule?.properties.tags).toContain('CWE-95');
    expect(rule?.properties.tags).toContain('security');
  });

  it('publica el fingerprint estable del hallazgo como partialFingerprints', () => {
    const finding = makeFinding({ fingerprint: 'fp-estable-123' });
    const log = parse(renderTomoSarif(buildTomo(makeOutcome(), [finding], meta)));

    expect(log.runs[0]?.results[0]?.partialFingerprints['sentinelFingerprint/v1']).toBe(
      'fp-estable-123',
    );
  });

  it('emite un run sin results ni rules cuando el tomo no tiene hallazgos', () => {
    const log = parse(renderTomoSarif(buildTomo(makeOutcome({ findingsCount: 0 }), [], meta)));

    expect(log.runs[0]?.results).toHaveLength(0);
    expect(log.runs[0]?.tool.driver.rules).toHaveLength(0);
  });
});
