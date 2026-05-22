/**
 * Installs the OSS scanner binaries used by the Scout Layer (FI-008, DG-059).
 *
 * Logic that used to live in `scripts/install-scanners.ts` — moved into the
 * CLI package so it ships inside the bundled extension and can be invoked as
 * the `synaptic-sentinel scanners install [--global]` sub-command. The same
 * lib is what `pnpm scanners:install` exercises in dev.
 *
 * Each scanner is downloaded from its pinned GitHub Release, the SHA-256 of
 * the asset is verified against the manifest, compressed assets are extracted
 * and binaries are chmod-ed on Unix. Idempotent: a cached loose binary is
 * re-verified, a cached extracted binary is assumed (the manifest checksum
 * is of the archive, not the extracted binary).
 *
 * License: Apache-2.0 (OSS).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { SCANNERS_MANIFEST } from './scanners.manifest.js';

/** A scanner's destination on a specific platform. */
export interface PlatformTarget {
  /** Asset name in the GitHub Release. */
  readonly asset: string;
  /** Official SHA-256 of the asset, hex. */
  readonly sha256: string;
  /** Final name of the installed binary. */
  readonly binary: string;
  /** Compressed-asset format; absent = loose binary. */
  readonly archive?: 'zip' | 'tar.gz';
}

/** A scanner's pinned version and per-platform targets. */
export interface ScannerSpec {
  /** Release tag (e.g. `v1.22.0`). */
  readonly version: string;
  /** GitHub `owner/name`. */
  readonly repo: string;
  /**
   * Subdirectory inside the archive where the binary lives, if not at the
   * root. The binary is flattened to the destination root after extraction.
   */
  readonly archiveDir?: string;
  /** Targets indexed by `${platform}-${arch}`. */
  readonly platforms: Readonly<Record<string, PlatformTarget>>;
}

/** Top-level manifest of pinned scanners. */
export interface ScannersManifest {
  /** Install directory relative to the cwd in dev mode (`.scanners`). */
  readonly installDir: string;
  /** Scanners indexed by name. */
  readonly scanners: Readonly<Record<string, ScannerSpec>>;
}

/** Result of installing a single scanner. */
export interface InstallOutcome {
  readonly scanner: string;
  readonly version: string;
  readonly path: string;
  /** `cached` = already installed, no download. */
  readonly action: 'installed' | 'cached';
}

/** Progress logger; called once per relevant line. */
export type InstallLogger = (line: string) => void;

/** Builds the manifest platform key: `${platform}-${arch}`. */
export function platformKey(platform: string, arch: string): string {
  return `${platform}-${arch}`;
}

/** Resolves the target of a scanner on a given platform; throws on unsupported. */
export function resolvePlatformTarget(
  scanner: ScannerSpec,
  platform: string,
  arch: string,
): PlatformTarget {
  const key = platformKey(platform, arch);
  const target = scanner.platforms[key];
  if (!target) {
    const supported = Object.keys(scanner.platforms).sort().join(', ');
    throw new Error(`Unsupported platform: ${key}. Available: ${supported}.`);
  }
  return target;
}

/** Builds the download URL of a GitHub Release asset. */
export function downloadUrl(repo: string, version: string, asset: string): string {
  return `https://github.com/${repo}/releases/download/${version}/${asset}`;
}

/** Hex SHA-256 of a buffer. */
function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `true` if a path exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Downloads an asset and verifies its checksum before returning the bytes. */
async function downloadVerified(url: string, expectedSha256: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Download failed (HTTP ${String(res.status)} ${res.statusText}): ${url}`);
  }
  const data = Buffer.from(await res.arrayBuffer());
  const actual = sha256(data);
  if (actual !== expectedSha256) {
    throw new Error(`Invalid checksum.\n  expected: ${expectedSha256}\n  actual: ${actual}`);
  }
  return data;
}

/** Spawns an extractor and rejects with its stderr on non-zero exit. */
function spawnExtract(command: string, args: readonly string[]): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, [...args]);
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} failed (exit ${String(code)}): ${stderr.trim()}`));
    });
  });
}

/**
 * Extracts a compressed asset into `destDir`.
 *
 * On Windows, `.zip` extraction uses PowerShell `Expand-Archive`: the bundled
 * `tar` interprets `D:\...` as a remote host. On Unix, `.zip` uses `unzip`
 * (GNU tar does not extract zip); `.tar.gz` always uses `tar`.
 */
function extractArchive(
  archivePath: string,
  destDir: string,
  format: 'zip' | 'tar.gz',
): Promise<void> {
  if (format === 'zip') {
    if (process.platform === 'win32') {
      return spawnExtract('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destDir}' -Force`,
      ]);
    }
    return spawnExtract('unzip', ['-o', '-q', archivePath, '-d', destDir]);
  }
  return spawnExtract('tar', ['-xf', archivePath, '-C', destDir]);
}

/**
 * Installs (or verifies from cache) a single scanner.
 *
 * `installDir` is the cache root; the binary ends up at
 * `<installDir>/<name>/<version>/<binary>`.
 */
export async function installScanner(
  name: string,
  scanner: ScannerSpec,
  installDir: string,
  log: InstallLogger = () => {
    // no-op default; callers usually pass a real logger.
  },
): Promise<InstallOutcome> {
  const target = resolvePlatformTarget(scanner, process.platform, process.arch);
  const destDir = join(installDir, name, scanner.version);
  const destPath = join(destDir, target.binary);
  const url = downloadUrl(scanner.repo, scanner.version, target.asset);

  if (target.archive === undefined) {
    // Loose binary: the manifest checksum is of the binary itself.
    if (await exists(destPath)) {
      if (sha256(await readFile(destPath)) === target.sha256) {
        return { scanner: name, version: scanner.version, path: destPath, action: 'cached' };
      }
    }
    log(`  downloading ${name} ${scanner.version} (${target.asset})...`);
    const data = await downloadVerified(url, target.sha256);
    await mkdir(destDir, { recursive: true });
    await writeFile(destPath, data);
  } else {
    // Compressed: checksum is of the archive; idempotency by existence post-extract.
    if (await exists(destPath)) {
      return { scanner: name, version: scanner.version, path: destPath, action: 'cached' };
    }
    log(`  downloading ${name} ${scanner.version} (${target.asset})...`);
    const data = await downloadVerified(url, target.sha256);
    await mkdir(destDir, { recursive: true });
    const archivePath = join(destDir, target.asset);
    await writeFile(archivePath, data);
    await extractArchive(archivePath, destDir, target.archive);
    await rm(archivePath, { force: true });
    if (scanner.archiveDir !== undefined) {
      const nested = join(destDir, scanner.archiveDir, target.binary);
      if (await exists(nested)) {
        await rename(nested, destPath);
        await rm(join(destDir, scanner.archiveDir), { recursive: true, force: true });
      }
    }
    if (!(await exists(destPath))) {
      throw new Error(
        `The "${target.binary}" binary did not appear after extracting ${target.asset}.`,
      );
    }
  }

  if (process.platform !== 'win32') {
    await chmod(destPath, 0o755);
  }
  return { scanner: name, version: scanner.version, path: destPath, action: 'installed' };
}

/**
 * Per-user global scanner cache (FI-004): `~/.synaptic-sentinel/scanners`.
 * Mirrors the canonical definition in `cli/src/commands/scan.ts`.
 */
export function globalScannerCacheDir(): string {
  return join(homedir(), '.synaptic-sentinel', 'scanners');
}

/** Options for {@link runScannersInstall}. */
export interface RunScannersInstallOptions {
  /** When `true`, install to the global per-user cache; otherwise `<cwd>/.scanners`. */
  readonly global: boolean;
  /** Progress logger; defaults to `console.log` (one line per event). */
  readonly log?: InstallLogger;
  /** Override for the dev cache root; defaults to `process.cwd()`. */
  readonly cwd?: string;
}

/**
 * Installs every scanner pinned in the manifest. The destination is the
 * global per-user cache when `global` is `true`, otherwise `<cwd>/.scanners`
 * (the repo cache used in dev).
 */
export async function runScannersInstall(
  options: RunScannersInstallOptions,
): Promise<readonly InstallOutcome[]> {
  const log =
    options.log ??
    ((line) => {
      console.log(line);
    });
  const cwd = options.cwd ?? process.cwd();
  const installDir = options.global
    ? globalScannerCacheDir()
    : join(cwd, SCANNERS_MANIFEST.installDir);

  log('Synaptic Sentinel - OSS scanner installation');
  log(`  target: ${installDir} ${options.global ? '(global cache)' : '(repo cache)'}`);

  const outcomes: InstallOutcome[] = [];
  for (const [name, spec] of Object.entries(SCANNERS_MANIFEST.scanners)) {
    const outcome = await installScanner(name, spec, installDir, log);
    log(`  ${name} ${outcome.version}: ${outcome.action === 'cached' ? 'cache OK' : 'installed'}`);
    log(`    ${outcome.path}`);
    outcomes.push(outcome);
  }
  log('Done.');
  return outcomes;
}
