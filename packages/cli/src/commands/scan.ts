import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ColonyDb,
  Coordinator,
  FindingSchema,
  type Finding,
  type ScanOutcome,
  type ScoutAgent,
} from '@synaptic-sentinel/core';
import { BASELINE_RULESET_PATH, GitleaksScout, OpenGrepScout } from '@synaptic-sentinel/scouts';
import { buildTomo, renderTomoJson } from '@synaptic-sentinel/reporters';

/** Version reportada en los tomos exportados. */
const SENTINEL_VERSION = '0.0.0';

/** Opciones del comando `scan`. */
export interface ScanCommandOptions {
  /** Directorio a escanear. */
  readonly path: string;
  /** Ruta explicita al binario de OpenGrep, si se provee. */
  readonly opengrepBin?: string;
  /** Ruta explicita al binario de Gitleaks, si se provee. */
  readonly gitleaksBin?: string;
  /** Ruta donde exportar el tomo en JSON, si se provee. */
  readonly exportPath?: string;
}

/** Nombre del ejecutable de un scanner segun la plataforma actual. */
export function platformBinary(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base;
}

/**
 * Resuelve la ruta del binario de un scanner.
 *
 * Orden de resolucion: ruta explicita -> variable de entorno `envVar` ->
 * cache `.scanners/<scanner>/<version>/<binaryName>` bajo `searchRoot`
 * (se elige la version mas alta lexicograficamente). Devuelve `undefined`
 * si no se encuentra.
 */
export function resolveScannerBinary(
  scanner: string,
  binaryName: string,
  envVar: string,
  explicit?: string,
  searchRoot: string = process.cwd(),
): string | undefined {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const fromEnv = process.env[envVar];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;

  const scannerDir = join(searchRoot, '.scanners', scanner);
  if (!existsSync(scannerDir)) return undefined;
  for (const version of readdirSync(scannerDir).sort().reverse()) {
    const candidate = join(scannerDir, version, binaryName);
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
  if (outcome.suppressedCount > 0) {
    // Stage 2: duplicados intra-scan + falsos positivos confirmados (fp_known).
    lines.push(
      `Suprimidos: ${String(outcome.suppressedCount)} (duplicados o falsos positivos conocidos)`,
    );
  }
  for (const scout of outcome.scouts) {
    const detail = scout.error !== undefined ? ` (${scout.error})` : '';
    lines.push(
      `  scout ${scout.scoutId}: ${scout.status} — ${String(scout.findings)} hallazgo(s)${detail}`,
    );
  }
  for (const finding of findings) {
    // Se anota el ciclo de vida salvo `new`: p.ej. `(known)` = hallazgo ya
    // visto en un scan anterior (stage 2 del Coordinator).
    const lifecycle = finding.lifecycleState === 'new' ? '' : ` (${finding.lifecycleState})`;
    // Se muestra `title` (nombre limpio de la regla); `ruleId` crudo puede
    // traer el prefijo de ruta del --config de OpenGrep (ver FI-005).
    lines.push(
      `  [${finding.severity.toUpperCase()}] ${finding.title}${lifecycle} ` +
        `— ${finding.location.path}:${String(finding.location.startLine)}`,
    );
  }
  return lines.join('\n');
}

/**
 * Encuentra el directorio que contiene una carpeta `.scanners/`, subiendo
 * desde `start`. Devuelve `undefined` si no hay ninguno hasta la raiz.
 */
export function findScannersRoot(start: string): string | undefined {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, '.scanners'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Resuelve el directorio raiz donde buscar la cache `.scanners/`.
 *
 * Sube primero desde el `cwd` (CLI invocada dentro del repo) y, si ahi no
 * hay nada, desde la propia ubicacion de la CLI (caso en que se la invoca
 * desde otro proyecto, p.ej. la extension VSCode con `cwd` en el workspace
 * del cliente). Cae al `cwd` si ninguna ruta da resultado.
 */
export function resolveScannersSearchRoot(): string {
  const fromCwd = findScannersRoot(process.cwd());
  if (fromCwd !== undefined) return fromCwd;
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return findScannersRoot(moduleDir) ?? process.cwd();
}

/**
 * Construye los scouts disponibles para una corrida de `scan`.
 *
 * Solo se incluye un scout si su binario se resuelve: un scanner ausente se
 * omite en silencio para que la CLI siga siendo util con instalacion parcial.
 */
export function buildScouts(options: ScanCommandOptions): ScoutAgent[] {
  const scouts: ScoutAgent[] = [];
  const searchRoot = resolveScannersSearchRoot();

  const opengrepBin = resolveScannerBinary(
    'opengrep',
    platformBinary('opengrep'),
    'SENTINEL_OPENGREP_BIN',
    options.opengrepBin,
    searchRoot,
  );
  if (opengrepBin !== undefined) {
    scouts.push(
      new OpenGrepScout({
        binaryPath: opengrepBin,
        configArgs: ['--config', BASELINE_RULESET_PATH],
      }),
    );
  }

  const gitleaksBin = resolveScannerBinary(
    'gitleaks',
    platformBinary('gitleaks'),
    'SENTINEL_GITLEAKS_BIN',
    options.gitleaksBin,
    searchRoot,
  );
  if (gitleaksBin !== undefined) {
    scouts.push(new GitleaksScout({ binaryPath: gitleaksBin }));
  }

  return scouts;
}

/**
 * Ejecuta el comando `scan`: corre el Coordinator sobre `path` con todos los
 * scouts disponibles (OpenGrep + Gitleaks), persiste los hallazgos en
 * `colony.db`, imprime el resultado y -si se pidio- exporta el tomo en JSON.
 * Devuelve el codigo de salida del proceso.
 */
export async function runScanCommand(options: ScanCommandOptions): Promise<number> {
  const projectRoot = resolve(options.path);
  const scouts = buildScouts(options);
  if (scouts.length === 0) {
    console.error(
      'No se encontro ningun scanner. Instala los scanners con "pnpm scanners:install" ' +
        'o indica las rutas con --opengrep-bin / --gitleaks-bin.',
    );
    return 1;
  }

  const dbDir = join(projectRoot, '.synaptic-sentinel');
  mkdirSync(dbDir, { recursive: true });
  const db = ColonyDb.open(join(dbDir, 'colony.db'));
  try {
    const coordinator = new Coordinator(db, scouts);
    console.log(
      `Escaneando ${projectRoot} con ${String(scouts.length)} scout(s): ` +
        `${scouts.map((scout) => scout.id).join(', ')} ...`,
    );
    const outcome = await coordinator.runScan({ rootPath: projectRoot, mode: 'full' });
    const findings = db
      .getPheromonesByScan(outcome.scanId)
      .map((pheromone) => FindingSchema.parse(pheromone.payload));
    console.log(formatOutcome(outcome, findings));

    if (options.exportPath !== undefined) {
      const tomo = buildTomo(outcome, findings, {
        rootPath: projectRoot,
        sentinelVersion: SENTINEL_VERSION,
      });
      const exportTarget = resolve(options.exportPath);
      writeFileSync(exportTarget, renderTomoJson(tomo));
      console.log(`Tomo exportado: ${exportTarget}`);
    }
    return 0;
  } finally {
    db.close();
  }
}
