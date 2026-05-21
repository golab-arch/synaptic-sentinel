import type { Dirent, Stats } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type {
  Finding,
  FindingCategory,
  ScanRequest,
  ScoutAgent,
  ScoutResult,
} from '@synaptic-sentinel/core';
import { runVibeDetectors } from './detect.js';

/** Extensiones de archivo de texto que el scout inspecciona. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.go', '.rb', '.java',
  '.php', '.cs', '.rs', '.c', '.cpp', '.h', '.hpp', '.sh', '.yaml', '.yml',
  '.json', '.tf', '.env', '.cfg', '.ini', '.toml',
]);

/** Directorios que el scout nunca recorre (ruido o artefactos de build). */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', '__pycache__',
]);

/** Tamano maximo de archivo a inspeccionar (los mayores suelen ser generados). */
const MAX_FILE_BYTES = 512 * 1024;

/** Devuelve la extension en minusculas de un nombre de archivo (incluye el punto). */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/**
 * Recorre `baseDir` recursivamente y devuelve las rutas absolutas de los
 * archivos de texto inspeccionables. Omite directorios ocultos (`.`), de
 * build y de dependencias; no sigue enlaces simbolicos (evita ciclos). Un
 * directorio ilegible se omite en silencio: degrada, no aborta.
 */
async function collectTextFiles(
  baseDir: string,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const found: string[] = [];
  const pending: string[] = [baseDir];
  while (pending.length > 0) {
    if (signal?.aborted === true) throw new Error('Escaneo cancelado.');
    const dir = pending.pop();
    if (dir === undefined) break;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        pending.push(full);
      } else if (entry.isFile()) {
        if (TEXT_EXTENSIONS.has(extensionOf(entry.name)) && !entry.name.includes('.min.')) {
          found.push(full);
        }
      }
    }
  }
  return found;
}

/**
 * Scout heuristico que detecta anti-patrones de "codigo vibe-coded": codigo
 * generado por IA y aceptado sin revision (secretos placeholder, controles de
 * seguridad silenciados, stubs TODO de seguridad, CORS abierto, verificacion
 * TLS deshabilitada, modo debug fijo). Emite `Finding` de categoria
 * `VibeCoded` — es el scout firma del producto vibe-coding-native.
 *
 * A diferencia de los demas scouts, no envuelve un binario OSS: la deteccion
 * es nativa (TypeScript puro, regex linea a linea), por lo que siempre esta
 * disponible y es 100% determinista y verificable sin dependencias externas.
 * Un fallo se reporta como `ScoutResult` `failed`; nunca lanza desde `scan()`.
 */
export class VibeDetectScout implements ScoutAgent {
  readonly id = 'vibe-detect';
  readonly displayName = 'Vibe-Detect';
  readonly category: FindingCategory = 'VibeCoded';

  /** Siempre disponible: no depende de ningun binario externo. */
  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async scan(request: ScanRequest): Promise<ScoutResult> {
    const startedAt = new Date().toISOString();
    try {
      const base =
        request.targetPaths[0] !== undefined
          ? resolve(request.rootPath, request.targetPaths[0])
          : request.rootPath;
      const files = await collectTextFiles(base, request.signal);
      const findings: Finding[] = [];

      for (const file of files) {
        if (request.signal?.aborted === true) throw new Error('Escaneo cancelado.');
        let info: Stats;
        try {
          info = await stat(file);
        } catch {
          continue;
        }
        if (info.size > MAX_FILE_BYTES) continue;
        let content: string;
        try {
          content = await readFile(file, 'utf8');
        } catch {
          continue;
        }
        const relativePath = relative(request.rootPath, file).split(sep).join('/');
        findings.push(
          ...runVibeDetectors(content, {
            scanId: request.scanId,
            scoutId: this.id,
            filePath: relativePath,
          }),
        );
      }

      return {
        scoutId: this.id,
        scanId: request.scanId,
        findings,
        status: 'ok',
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        scoutId: this.id,
        scanId: request.scanId,
        findings: [],
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
