import type { Severity } from '@synaptic-sentinel/core';
import type { FindingLocation } from '@synaptic-sentinel/core';
import type { Tomo } from './tomo.js';

/**
 * Reporter SARIF 2.1.0 del tomo (OASIS Static Analysis Results Interchange
 * Format). SARIF es el formato estandar de intercambio de hallazgos de
 * seguridad: este export vuelve a Sentinel CI-native — su salida la consumen
 * GitHub Code Scanning, Azure DevOps y otras herramientas, sin trabajo extra.
 *
 * El reporter es puro y determinista: toma un `Tomo` ya construido y no toca
 * el sistema de archivos ni el reloj.
 */

/** Version del esquema SARIF que emite el reporter. */
const SARIF_VERSION = '2.1.0';

/** URL del esquema SARIF 2.1.0, para que los validadores lo resuelvan. */
const SARIF_SCHEMA_URI =
  'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json';

/** Nivel SARIF (`result.level`) de cada severidad de Sentinel. */
function sarifLevel(severity: Severity): 'error' | 'warning' | 'note' {
  if (severity === 'critical' || severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  return 'note';
}

/**
 * Puntaje `security-severity` (0.0-10.0) que GitHub Code Scanning lee de las
 * propiedades de la regla para clasificar el hallazgo en su UI.
 */
const SECURITY_SEVERITY: Readonly<Record<Severity, string>> = {
  critical: '9.5',
  high: '8.0',
  medium: '5.5',
  low: '3.0',
  info: '0.0',
};

/** Region SARIF de un hallazgo dentro de un artefacto. */
interface SarifRegion {
  startLine: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  snippet?: { text: string };
}

/** Definicion de regla SARIF (`reportingDescriptor`). */
interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  properties: { tags: readonly string[]; 'security-severity': string };
}

/** Resultado SARIF: un hallazgo individual. */
interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations: ReadonlyArray<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region: SarifRegion;
    };
  }>;
  partialFingerprints: Readonly<Record<string, string>>;
  properties: Readonly<Record<string, string>>;
}

/** Construye la region SARIF desde la ubicacion de un hallazgo. */
function buildRegion(location: FindingLocation): SarifRegion {
  return {
    startLine: location.startLine,
    ...(location.endLine !== undefined ? { endLine: location.endLine } : {}),
    ...(location.startColumn !== undefined ? { startColumn: location.startColumn } : {}),
    ...(location.endColumn !== undefined ? { endColumn: location.endColumn } : {}),
    ...(location.snippet !== undefined ? { snippet: { text: location.snippet } } : {}),
  };
}

/**
 * Serializa un tomo al formato SARIF 2.1.0.
 *
 * Las reglas (`tool.driver.rules`) se deduplican por `ruleId`: cada resultado
 * referencia su regla por `ruleIndex`. El `fingerprint` estable de cada
 * hallazgo se publica como `partialFingerprints`, para que el consumidor
 * (p.ej. GitHub) rastree el mismo hallazgo entre corridas.
 */
export function renderTomoSarif(tomo: Tomo): string {
  const rules: SarifRule[] = [];
  const ruleIndexById = new Map<string, number>();

  const results: SarifResult[] = tomo.findings.map((finding): SarifResult => {
    let ruleIndex = ruleIndexById.get(finding.ruleId);
    if (ruleIndex === undefined) {
      ruleIndex = rules.length;
      ruleIndexById.set(finding.ruleId, ruleIndex);
      rules.push({
        id: finding.ruleId,
        name: finding.title,
        shortDescription: { text: finding.message },
        properties: {
          tags: ['security', finding.category, ...finding.complianceRefs],
          'security-severity': SECURITY_SEVERITY[finding.severity],
        },
      });
    }
    return {
      ruleId: finding.ruleId,
      ruleIndex,
      level: sarifLevel(finding.severity),
      message: { text: finding.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: finding.location.path },
            region: buildRegion(finding.location),
          },
        },
      ],
      partialFingerprints: { 'sentinelFingerprint/v1': finding.fingerprint },
      properties: {
        severity: finding.severity,
        category: finding.category,
        scoutId: finding.scoutId,
        lifecycleState: finding.lifecycleState,
      },
    };
  });

  const log = {
    $schema: SARIF_SCHEMA_URI,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: 'SYNAPTIC Sentinel',
            version: tomo.metadata.sentinelVersion,
            rules,
          },
        },
        results,
      },
    ],
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}
