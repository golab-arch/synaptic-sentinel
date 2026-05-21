/**
 * scripts/install-scanners.ts
 *
 * Descarga e instala los binarios de los scanners OSS pinneados en
 * scripts/scanners.manifest.json, verificando su checksum SHA-256 contra
 * el valor oficial publicado en GitHub Releases (DG-003 A).
 *
 * Soporta binarios sueltos y assets comprimidos (.zip / .tar.gz): estos
 * ultimos se extraen con `tar` (disponible en Windows 10+, macOS y Linux).
 *
 * Uso:  pnpm scanners:install
 *
 * Requiere Node >= 22.6 (type stripping nativo). El comando `pnpm` agrega
 * el flag --use-system-ca, necesario en entornos con inspeccion TLS
 * (proxy corporativo / antivirus); ver .synaptic learning L-001.
 *
 * Licencia: Apache-2.0 (OSS).
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Destino de un scanner para una plataforma concreta. */
export interface PlatformTarget {
  /** Nombre del asset en el GitHub Release. */
  readonly asset: string;
  /** Checksum SHA-256 oficial del asset (hex). */
  readonly sha256: string;
  /** Nombre con el que queda el binario instalado. */
  readonly binary: string;
  /** Formato del asset si es un comprimido; ausente = binario suelto. */
  readonly archive?: 'zip' | 'tar.gz';
}

/** Especificacion de un scanner: version pinneada y targets por plataforma. */
export interface ScannerSpec {
  /** Tag de la release (ej. `v1.22.0`). */
  readonly version: string;
  /** Repositorio GitHub `owner/name`. */
  readonly repo: string;
  /** Targets indexados por `${platform}-${arch}`. */
  readonly platforms: Readonly<Record<string, PlatformTarget>>;
}

/** Manifest completo de scanners. */
export interface ScannersManifest {
  /** Directorio de instalacion, relativo a la raiz del repo. */
  readonly installDir: string;
  /** Scanners indexados por nombre. */
  readonly scanners: Readonly<Record<string, ScannerSpec>>;
}

/** Resultado de instalar un scanner. */
export interface InstallOutcome {
  readonly scanner: string;
  readonly version: string;
  readonly path: string;
  /** `cached` = ya estaba instalado. */
  readonly action: 'installed' | 'cached';
}

/** Clave de plataforma del manifest: `${platform}-${arch}`. */
export function platformKey(platform: string, arch: string): string {
  return `${platform}-${arch}`;
}

/**
 * Resuelve el target de un scanner para una plataforma dada.
 * Lanza un error claro si la plataforma no esta soportada.
 */
export function resolvePlatformTarget(
  scanner: ScannerSpec,
  platform: string,
  arch: string,
): PlatformTarget {
  const key = platformKey(platform, arch);
  const target = scanner.platforms[key];
  if (!target) {
    const supported = Object.keys(scanner.platforms).sort().join(', ');
    throw new Error(`Plataforma no soportada: ${key}. Disponibles: ${supported}.`);
  }
  return target;
}

/** Construye la URL de descarga de un asset de un GitHub Release. */
export function downloadUrl(repo: string, version: string, asset: string): string {
  return `https://github.com/${repo}/releases/download/${version}/${asset}`;
}

/** Calcula el SHA-256 (hex) de un buffer. */
function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Indica si una ruta existe. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Descarga un asset y verifica su checksum antes de devolver los bytes. */
async function downloadVerified(url: string, expectedSha256: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Descarga fallida (HTTP ${res.status} ${res.statusText}): ${url}`);
  }
  const data = Buffer.from(await res.arrayBuffer());
  const actual = sha256(data);
  if (actual !== expectedSha256) {
    throw new Error(`Checksum invalido.\n  esperado: ${expectedSha256}\n  obtenido: ${actual}`);
  }
  return data;
}

/** Extrae un archivo comprimido (.zip / .tar.gz) con `tar` (cross-platform). */
function extractArchive(archivePath: string, destDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-xf', archivePath, '-C', destDir]);
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar fallo (exit ${String(code)}): ${stderr.trim()}`));
    });
  });
}

/** Instala (o verifica desde cache) un scanner segun su especificacion. */
export async function installScanner(
  name: string,
  scanner: ScannerSpec,
  installDir: string,
): Promise<InstallOutcome> {
  const target = resolvePlatformTarget(scanner, process.platform, process.arch);
  const destDir = join(installDir, name, scanner.version);
  const destPath = join(destDir, target.binary);
  const url = downloadUrl(scanner.repo, scanner.version, target.asset);

  if (target.archive === undefined) {
    // Binario suelto: el sha256 del manifest es del propio binario.
    if (await exists(destPath)) {
      if (sha256(await readFile(destPath)) === target.sha256) {
        return { scanner: name, version: scanner.version, path: destPath, action: 'cached' };
      }
    }
    console.log(`  descargando ${name} ${scanner.version} (${target.asset})...`);
    const data = await downloadVerified(url, target.sha256);
    await mkdir(destDir, { recursive: true });
    await writeFile(destPath, data);
  } else {
    // Comprimido: el sha256 del manifest es del archivo. Tras extraer no se
    // puede re-verificar el binario, asi que la idempotencia es por existencia.
    if (await exists(destPath)) {
      return { scanner: name, version: scanner.version, path: destPath, action: 'cached' };
    }
    console.log(`  descargando ${name} ${scanner.version} (${target.asset})...`);
    const data = await downloadVerified(url, target.sha256);
    await mkdir(destDir, { recursive: true });
    const archivePath = join(destDir, target.asset);
    await writeFile(archivePath, data);
    await extractArchive(archivePath, destDir);
    await rm(archivePath, { force: true });
    if (!(await exists(destPath))) {
      throw new Error(
        `El binario "${target.binary}" no aparecio tras extraer ${target.asset}.`,
      );
    }
  }

  if (process.platform !== 'win32') {
    await chmod(destPath, 0o755);
  }
  return { scanner: name, version: scanner.version, path: destPath, action: 'installed' };
}

/** Raiz del repositorio (scripts/ esta un nivel por debajo). */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Carga y parsea el manifest de scanners. */
async function loadManifest(): Promise<ScannersManifest> {
  const path = join(REPO_ROOT, 'scripts', 'scanners.manifest.json');
  return JSON.parse(await readFile(path, 'utf8')) as ScannersManifest;
}

/** Describe un error incluyendo su causa (util para fallos de fetch/TLS). */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  return cause instanceof Error ? `${err.message} (${cause.message})` : err.message;
}

/** Punto de entrada: instala todos los scanners del manifest. */
async function main(): Promise<void> {
  console.log('Synaptic Sentinel - instalacion de scanners OSS');
  const manifest = await loadManifest();
  const installDir = join(REPO_ROOT, manifest.installDir);

  for (const [name, spec] of Object.entries(manifest.scanners)) {
    const outcome = await installScanner(name, spec, installDir);
    console.log(`  ${name} ${outcome.version}: ${outcome.action === 'cached' ? 'cache OK' : 'instalado'}`);
    console.log(`    ${outcome.path}`);
  }
  console.log('Listo.');
}

// Ejecuta main() solo cuando el script se invoca directamente (no al importarlo).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    const msg = describeError(err);
    console.error(`ERROR: ${msg}`);
    if (/certificate|UNABLE_TO_VERIFY/i.test(msg)) {
      console.error(
        'El entorno tiene inspeccion TLS. Ejecuta "pnpm scanners:install" (agrega --use-system-ca).',
      );
    }
    process.exitCode = 1;
  });
}
