import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ColonyDb,
  Coordinator,
  FindingSchema,
  type Finding,
  type ScanOutcome,
} from '@synaptic-sentinel/core';
import { BASELINE_RULESET_PATH, OpenGrepScout } from '@synaptic-sentinel/scouts';

/** Opciones del comando `scan`. */
export interface ScanCommandOptions {
  /** Directorio a escanear. */
  readonly path: string;
  /** Ruta explicita al binario de OpenGrep, si se provee. */
  readonly opengrepBin?: string;
}

/**
 * Resuelve la ruta del binario de OpenGrep.
 *
 * Orden de resolucion: ruta explicita -> variable de entorno
 * `SENTINEL_OPENGREP_BIN` -> cache `.scanners/opengrep/<version>/` bajo
 * `searchRoot`. Devuelve `undefined` si no se encuentra.
 */
export function resolveOpenGrepBinary(
  explicit?: string,
  searchRoot: string = process.cwd(),
): string | undefined {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const fromEnv = process.env['SENTINEL_OPENGREP_BIN'];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;

  const opengrepDir = join(searchRoot, '.scanners', 'opengrep');
  if (!existsSync(opengrepDir)) return undefined;
  const binaryName = process.platform === 'win32' ? 'opengrep.exe' : 'opengrep';
  for (const version of readdirSync(opengrepDir).sort().reverse()) {
    const candidate = join(opengrepDir, version, binaryName);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Formatea el resultado de un scan para imprimir en consola. */
export function formatOutcome(outcome: ScanOutcome, findings: readonly Finding[]): string {
  const lines = [
    `Scan ${outcome.scanId} — ${outcome.status.toUpperCase()}`,
    `Hallazgos: ${String(outcome.findingsCount)}`,
  ];
  for (const scout of outcome.scouts) {
    const detail = scout.error !== undefined ? ` (${scout.error})` : '';
    lines.push(
      `  scout ${scout.scoutId}: ${scout.status} — ${String(scout.findings)} hallazgo(s)${detail}`,
    );
  }
  for (const finding of findings) {
    // Se muestra `title` (nombre limpio de la regla); `ruleId` crudo puede
    // traer el prefijo de ruta del --config de OpenGrep (ver FI-005).
    lines.push(
      `  [${finding.severity.toUpperCase()}] ${finding.title} ` +
        `— ${finding.location.path}:${String(finding.location.startLine)}`,
    );
  }
  return lines.join('\n');
}

/**
 * Ejecuta el comando `scan`: corre el Coordinator sobre `path`, persiste los
 * hallazgos en `colony.db` e imprime el resultado. Devuelve el codigo de
 * salida del proceso.
 */
export async function runScanCommand(options: ScanCommandOptions): Promise<number> {
  const projectRoot = resolve(options.path);
  const binaryPath = resolveOpenGrepBinary(options.opengrepBin);
  if (binaryPath === undefined) {
    console.error(
      'OpenGrep no encontrado. Instala los scanners con "pnpm scanners:install" ' +
        'o indica la ruta con --opengrep-bin.',
    );
    return 1;
  }

  const dbDir = join(projectRoot, '.synaptic-sentinel');
  mkdirSync(dbDir, { recursive: true });
  const db = ColonyDb.open(join(dbDir, 'colony.db'));
  try {
    const scout = new OpenGrepScout({
      binaryPath,
      configArgs: ['--config', BASELINE_RULESET_PATH],
    });
    const coordinator = new Coordinator(db, [scout]);
    console.log(`Escaneando ${projectRoot} ...`);
    const outcome = await coordinator.runScan({ rootPath: projectRoot, mode: 'full' });
    const findings = db
      .getPheromonesByScan(outcome.scanId)
      .map((pheromone) => FindingSchema.parse(pheromone.payload));
    console.log(formatOutcome(outcome, findings));
    return 0;
  } finally {
    db.close();
  }
}
