import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ColonyDb,
  Coordinator,
  FindingSchema,
  severityAtLeast,
  type Finding,
  type ScoutAgent,
  type Severity,
} from '@synaptic-sentinel/core';
import {
  BASELINE_RULESET_PATH,
  CheckovScout,
  GitleaksScout,
  OpenGrepScout,
  TrivyScout,
  VibeDetectScout,
} from '@synaptic-sentinel/scouts';
import {
  buildTomo,
  renderBanner,
  renderScanReveal,
  renderScoutLine,
  renderTomoHtml,
  renderTomoJson,
  renderTomoSarif,
} from '@synaptic-sentinel/reporters';
import { Spinner } from '../spinner.js';

/** Version reportada en los tomos exportados. */
const SENTINEL_VERSION = '0.0.0';

/**
 * Exit code del comando `scan` cuando la politica `--fail-on` encuentra
 * hallazgos por encima del umbral. Es distinto del exit code 1 (error de
 * ejecucion): un consumidor de CI puede asi distinguir "hubo hallazgos
 * bloqueantes" de "el scan fallo".
 */
const FAIL_ON_EXIT_CODE = 2;

/** Opciones del comando `scan`. */
export interface ScanCommandOptions {
  /** Directorio a escanear. */
  readonly path: string;
  /** Ruta explicita al binario de OpenGrep, si se provee. */
  readonly opengrepBin?: string;
  /** Ruta explicita al binario de Gitleaks, si se provee. */
  readonly gitleaksBin?: string;
  /** Ruta explicita al binario de Trivy, si se provee. */
  readonly trivyBin?: string;
  /** Ruta explicita al binario de Checkov, si se provee. */
  readonly checkovBin?: string;
  /** Ruta donde exportar el tomo en JSON, si se provee. */
  readonly exportPath?: string;
  /** Ruta donde exportar el tomo en HTML, si se provee. */
  readonly exportHtmlPath?: string;
  /** Ruta donde exportar el tomo en SARIF 2.1.0, si se provee. */
  readonly exportSarifPath?: string;
  /**
   * Umbral de severidad para la politica de exit code de CI: si se provee y
   * hay hallazgos de severidad mayor o igual, `scan` termina con exit code 2.
   */
  readonly failOn?: Severity;
  /** Desactiva el color ANSI (tambien lo desactivan `NO_COLOR` y un stdout no-TTY). */
  readonly noColor?: boolean;
}

/** Nombre del ejecutable de un scanner segun la plataforma actual. */
export function platformBinary(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base;
}

/**
 * Directorio de la cache de scanners global por usuario (FI-004, Phase 8).
 *
 * El layout en dev es `<repo>/.scanners/<scanner>/<version>/<binario>`; un
 * producto enviado no tiene ese repo, asi que necesita una cache propia,
 * global y por usuario. Esta funcion devuelve su raiz (que contiene
 * directamente los directorios `<scanner>/`, sin el nivel `.scanners/`).
 */
export function globalScannerCacheDir(): string {
  return join(homedir(), '.synaptic-sentinel', 'scanners');
}

/**
 * Busca el binario `binaryName` de `scanner` dentro de un directorio cache
 * con layout `<cacheRoot>/<scanner>/<version>/<binaryName>`. Elige la version
 * mas alta lexicograficamente. Devuelve `undefined` si no esta.
 */
function findBinaryInCache(
  cacheRoot: string,
  scanner: string,
  binaryName: string,
): string | undefined {
  const scannerDir = join(cacheRoot, scanner);
  if (!existsSync(scannerDir)) return undefined;
  for (const version of readdirSync(scannerDir).sort().reverse()) {
    const candidate = join(scannerDir, version, binaryName);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Resuelve la ruta del binario de un scanner.
 *
 * Orden de resolucion: ruta explicita -> variable de entorno `envVar` ->
 * cache `.scanners/` del repo bajo `searchRoot` (modo dev) -> cache global
 * por usuario `globalCacheDir` (producto enviado, FI-004). En cada cache se
 * elige la version mas alta lexicograficamente. Devuelve `undefined` si no
 * se encuentra en ninguna.
 */
export function resolveScannerBinary(
  scanner: string,
  binaryName: string,
  envVar: string,
  explicit?: string,
  searchRoot: string = process.cwd(),
  globalCacheDir: string = globalScannerCacheDir(),
): string | undefined {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const fromEnv = process.env[envVar];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;

  // 1) Cache del repo en dev (`.scanners/` relativo al `searchRoot`).
  const fromRepo = findBinaryInCache(join(searchRoot, '.scanners'), scanner, binaryName);
  if (fromRepo !== undefined) return fromRepo;
  // 2) Cache global por usuario (producto enviado).
  return findBinaryInCache(globalCacheDir, scanner, binaryName);
}

/**
 * Decide si la salida usa color ANSI: lo desactiva `--no-color` o la variable
 * `NO_COLOR`; lo fuerza `FORCE_COLOR` (lo usara la extension VSCode al pipear
 * la CLI a un pseudoterminal); por defecto, solo si `stdout` es una TTY.
 */
export function shouldUseColor(noColorFlag: boolean): boolean {
  if (noColorFlag) return false;
  if ((process.env['NO_COLOR'] ?? '') !== '') return false;
  if ((process.env['FORCE_COLOR'] ?? '') !== '') return true;
  return process.stdout.isTTY === true;
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

  const trivyBin = resolveScannerBinary(
    'trivy',
    platformBinary('trivy'),
    'SENTINEL_TRIVY_BIN',
    options.trivyBin,
    searchRoot,
  );
  if (trivyBin !== undefined) {
    scouts.push(new TrivyScout({ binaryPath: trivyBin }));
  }

  const checkovBin = resolveScannerBinary(
    'checkov',
    platformBinary('checkov'),
    'SENTINEL_CHECKOV_BIN',
    options.checkovBin,
    searchRoot,
  );
  if (checkovBin !== undefined) {
    scouts.push(new CheckovScout({ binaryPath: checkovBin }));
  }

  // Vibe-Detect es un scout nativo (sin binario externo): siempre se incluye.
  scouts.push(new VibeDetectScout());

  return scouts;
}

/**
 * Cuenta los hallazgos cuya severidad alcanza o supera el umbral `--fail-on`.
 * Es la base de la politica de exit code para CI (DG-045 B): funcion pura,
 * para poder verificarla sin correr un scan.
 */
export function countBlockingFindings(findings: readonly Finding[], failOn: Severity): number {
  return findings.filter((finding) => severityAtLeast(finding.severity, failOn)).length;
}

/**
 * Ejecuta el comando `scan`: corre el Coordinator sobre `path` con todos los
 * scouts disponibles (OpenGrep, Gitleaks, Trivy, Checkov y Vibe-Detect),
 * persiste los hallazgos en `colony.db`, imprime el resultado y -si se pidio-
 * exporta el tomo en JSON/HTML/SARIF.
 *
 * Devuelve el codigo de salida: 0 si todo fue bien; 2 si se paso `--fail-on`
 * y hay hallazgos por encima del umbral (politica de CI).
 */
export async function runScanCommand(options: ScanCommandOptions): Promise<number> {
  const projectRoot = resolve(options.path);
  const color = shouldUseColor(options.noColor === true);
  console.log(renderBanner(color));

  const scouts = buildScouts(options);
  // Vibe-Detect siempre esta presente; si es el unico scout, los scanners
  // externos no se resolvieron: el scan corre igual pero degradado.
  if (scouts.every((scout) => scout.id === 'vibe-detect')) {
    console.warn(
      'Warning: no external scanner found (OpenGrep / Gitleaks / Trivy / ' +
        'Checkov). Only Vibe-Detect will run. Install the scanners with ' +
        '"synaptic-sentinel scanners install --global" (or the VS Code command ' +
        '"Synaptic Sentinel: Install Scanners"), or pass the paths with ' +
        '--opengrep-bin / --gitleaks-bin / --trivy-bin / --checkov-bin.',
    );
  }

  const dbDir = join(projectRoot, '.synaptic-sentinel');
  mkdirSync(dbDir, { recursive: true });
  const db = ColonyDb.open(join(dbDir, 'colony.db'));
  try {
    const coordinator = new Coordinator(db, scouts);
    console.log(`  target  ${projectRoot}`);
    console.log(`  scouts  ${scouts.map((scout) => scout.id).join(', ')}`);
    console.log('');

    // Feedback en vivo: un spinner mientras el enjambre trabaja y una linea
    // permanente por cada scout a medida que termina (Coordinator.onScoutSettled).
    const spinner = new Spinner(color);
    spinner.start('the scout swarm is scanning...');
    const outcome = await coordinator.runScan({
      rootPath: projectRoot,
      mode: 'full',
      onScoutSettled: (scoutOutcome) => {
        spinner.log(renderScoutLine(scoutOutcome, color));
      },
    });
    spinner.stop();

    const findings = db
      .getPheromonesByScan(outcome.scanId)
      .map((pheromone) => FindingSchema.parse(pheromone.payload));
    console.log(renderScanReveal(outcome, findings, color));

    if (
      options.exportPath !== undefined ||
      options.exportHtmlPath !== undefined ||
      options.exportSarifPath !== undefined
    ) {
      // El tomo se enriquece con los veredictos de triage, las explicaciones
      // de contexto y las sugerencias de remediacion ya persistidas (de una
      // corrida previa de `triage`).
      const tomo = buildTomo(
        outcome,
        findings,
        { rootPath: projectRoot, sentinelVersion: SENTINEL_VERSION },
        {
          triageVerdicts: db.getTriageVerdicts(),
          contextExplanations: db.getContextExplanations(),
          remediationSuggestions: db.getRemediationSuggestions(),
        },
      );
      if (options.exportPath !== undefined) {
        const target = resolve(options.exportPath);
        writeFileSync(target, renderTomoJson(tomo));
        console.log(`Tome exported (JSON): ${target}`);
      }
      if (options.exportHtmlPath !== undefined) {
        const target = resolve(options.exportHtmlPath);
        writeFileSync(target, renderTomoHtml(tomo));
        console.log(`Tome exported (HTML): ${target}`);
      }
      if (options.exportSarifPath !== undefined) {
        const target = resolve(options.exportSarifPath);
        writeFileSync(target, renderTomoSarif(tomo));
        console.log(`Tome exported (SARIF): ${target}`);
      }
    }

    // Politica de exit code para CI (--fail-on): un exit distinto de 0 deja
    // que el scan haga fallar un pipeline. Solo aplica si se pidio el flag.
    const failOn = options.failOn;
    if (failOn !== undefined) {
      const blocking = countBlockingFindings(findings, failOn);
      if (blocking > 0) {
        console.error(
          `\n--fail-on policy: ${String(blocking)} finding(s) at severity ` +
            `>= ${failOn}. Scan exits with code ${String(FAIL_ON_EXIT_CODE)}.`,
        );
        return FAIL_ON_EXIT_CODE;
      }
      console.log(`--fail-on policy: no findings at severity >= ${failOn}. ✓`);
    }
    return 0;
  } finally {
    db.close();
  }
}
