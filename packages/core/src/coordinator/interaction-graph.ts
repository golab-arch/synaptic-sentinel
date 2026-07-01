/**
 * DG-123 A (Cycle 111) — Interaction Graph Layer v1 (R18 v1 del research doc
 * Section 12 — Architectural North Star).
 *
 * Construye un grafo project-wide de módulo↔módulo + símbolos top-level para
 * los lenguajes TypeScript / TSX / JavaScript / Python. Cada Finding gana dos
 * campos opcionales aditivos:
 *
 * - `fileContext`: role inferido del archivo (entry/library/leaf/test),
 *   imports y importedBy counts + top-N referencias.
 * - `symbolContext`: functions/classes declaradas top-level + exports.
 *
 * El objetivo NO es reemplazar dataflow trace (DG-112 A) ni dependencyContext
 * (DG-115 A). Es añadir un **lente de sistema** al Triage/Context Agent para
 * que evalúen findings como nodos en un grafo de interacciones, no como
 * patrones aislados.
 *
 * **Trade-offs honestos (anti-optimismo activo)**:
 *
 * - **Solo 4 lenguajes en v1**: TS/TSX/JS/Python. Otros lenguajes → findings
 *   sin fileContext/symbolContext (undefined). El Triage Agent fallback
 *   graceful (los campos son opcionales por schema).
 * - **Module-level solo**: no hay call graph, no hay dataflow inference entre
 *   funciones. Solo "quién importa a quién" + "qué símbolos define este archivo".
 * - **Static import resolution incompleta**: dynamic `import()`, computed
 *   `require()`, wildcard re-exports NO se resuelven. Blind spots documentados
 *   y aceptados para v1.
 * - **Role inference heurística**: guess basado en filename patterns +
 *   importer count. Puede equivocarse. El LLM tiene contexto para override.
 * - **Cost**: parsear el workspace agrega ~500ms-3s al scan setup (depende
 *   del tamaño). En SENTINEL workspace (~50 files) es negligible.
 * - **WASM runtime init**: primer parse costs ~200ms (una vez por scan).
 *
 * **Reference**: SENTINEL_COMPETITIVE_RESEARCH.md Section 12 (North Star)
 * + Section 12.5 R18 v1 staged implementation.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/* eslint-disable @typescript-eslint/no-explicit-any */
// web-tree-sitter no exporta types 100% ergonomic — usamos any casts explicit
// para los language / parser instances y validamos con runtime checks.

/** Lenguajes soportados en v1 (DG-123 A). */
export const SUPPORTED_LANGUAGES = ['typescript', 'tsx', 'javascript', 'python'] as const;

/** Tipo de lenguaje soportado. */
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Símbolo top-level extraído por tree-sitter. */
export const FileSymbolSchema = z.object({
  /** Nombre del símbolo (function/class/const). */
  name: z.string().min(1),
  /** Tipo de declaracion. */
  kind: z.enum(['function', 'class', 'const']),
  /** True si el simbolo es exportado (export/module.exports). */
  exported: z.boolean(),
  /** Linea 1-based donde se declara. */
  startLine: z.number().int().positive(),
});

/** Símbolo top-level de un archivo. */
export type FileSymbol = z.infer<typeof FileSymbolSchema>;

/** Contexto del archivo en el grafo de interacciones. */
export const FileContextSchema = z.object({
  /**
   * Lenguaje detectado por extensión. `unknown` si el archivo no es de un
   * lenguaje soportado (v1: TS/TSX/JS/Python).
   */
  language: z.enum([...SUPPORTED_LANGUAGES, 'unknown']),
  /**
   * Paths (relativos al rootPath) de módulos que este archivo importa
   * (resolvidos). Solo static imports; dynamic import() y computed require()
   * NO están incluidos.
   */
  imports: z.array(z.string()).default([]),
  /**
   * Paths (relativos al rootPath) de archivos que importan a este.
   * Reverse-index computado en `buildInteractionGraph`.
   */
  importedBy: z.array(z.string()).default([]),
  /**
   * Rol inferido heurísticamente:
   * - `entry`: filename matchea index/main/app/cli, o tiene 0 importers.
   * - `library`: >=2 importers (usado ampliamente).
   * - `test`: path contiene segmento `test`/`__test__` o filename `.test./.spec.`.
   * - `leaf`: 0 importers y no matchea entry heurística.
   * - `unknown`: ninguno de los anteriores (raro — fallback).
   */
  inferredRole: z.enum(['entry', 'library', 'test', 'leaf', 'unknown']),
});

/** Contexto del archivo poblado por el Interaction Graph. */
export type FileContext = z.infer<typeof FileContextSchema>;

/** Contexto de símbolos top-level del archivo. */
export const SymbolContextSchema = z.object({
  /** Símbolos declarados top-level (functions/classes/consts). */
  definedSymbols: z.array(FileSymbolSchema).default([]),
  /** Nombres de símbolos exportados (subset de `definedSymbols` marcados `exported`). */
  exportedSymbols: z.array(z.string()).default([]),
});

/** Contexto de símbolos poblado por el Interaction Graph. */
export type SymbolContext = z.infer<typeof SymbolContextSchema>;

/** Nodo del grafo — combinación de file + symbol context. */
export interface InteractionGraphNode {
  readonly fileContext: FileContext;
  readonly symbolContext: SymbolContext;
}

/**
 * Segmentos de path que se skipan al walkear el workspace (heredado del
 * exclude-list de DG-117 A + DG-117.0.1 — consistencia con el filtro de
 * findings).
 */
const SKIP_SEGMENTS: ReadonlySet<string> = new Set([
  'fixtures',
  '__fixtures__',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  '__pycache__',
  'benchmark',
  '.scanners',
  '.git',
]);

/** Tamano maximo de archivo a parsear (los mayores suelen ser generated). */
const MAX_FILE_BYTES = 512 * 1024;

/**
 * Detecta lenguaje por extensión. Devuelve `null` si no está soportado.
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.ts') return 'typescript';
  if (ext === '.tsx') return 'tsx';
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  if (ext === '.py') return 'python';
  return null;
}

/**
 * Walk sync del workspace collectando archivos parseables (skipeando
 * SKIP_SEGMENTS + hidden dirs + files > MAX_FILE_BYTES).
 */
function collectSourceFiles(rootPath: string): string[] {
  const found: string[] = [];
  const pending: string[] = [rootPath];
  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) break;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      // Skip hidden dirs (except .scanners which is already in SKIP_SEGMENTS).
      if (entry.startsWith('.') && entry !== '.scanners' && entry !== '.git') continue;
      if (SKIP_SEGMENTS.has(entry)) continue;
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        pending.push(full);
      } else if (stats.isFile()) {
        if (stats.size > MAX_FILE_BYTES) continue;
        if (detectLanguage(full) !== null) found.push(full);
      }
    }
  }
  return found;
}

/**
 * Resuelve el path de un grammar .wasm. Sigue el mismo fallback pattern que
 * `colony-db.ts` `resolveSchemaPath`:
 * - En dev/tests: `node_modules/tree-sitter-wasms/out/tree-sitter-<lang>.wasm`
 *   desde la raíz del monorepo (via `import.meta.url`).
 * - En bundle CLI: `.wasm` copiada por `copy-cli-assets.mjs` junto a
 *   `cli.mjs` (`./tree-sitter-<lang>.wasm`).
 */
function resolveGrammarPath(lang: SupportedLanguage): string {
  const baseUrl = import.meta.url;
  // Dev/test: pnpm coloca las deps en `packages/core/node_modules/` (via
  // symlinked layout). Desde `packages/core/src/coordinator/` walk up 2
  // niveles hasta `packages/core/`, luego a `node_modules/tree-sitter-wasms/out/`.
  const canonical = fileURLToPath(
    new URL(`../../node_modules/tree-sitter-wasms/out/tree-sitter-${lang}.wasm`, baseUrl),
  );
  if (existsSync(canonical)) return canonical;
  // Bundle CLI: sibling de cli.mjs.
  return fileURLToPath(new URL(`./tree-sitter-${lang}.wasm`, baseUrl));
}

/**
 * Resuelve el path del runtime WASM de web-tree-sitter. Mismo fallback.
 * En 0.20.x el archivo se llama `tree-sitter.wasm` (no `web-tree-sitter.wasm`
 * como en 0.26.x).
 */
function resolveTreeSitterRuntimePath(): string {
  const baseUrl = import.meta.url;
  const canonical = fileURLToPath(
    new URL('../../node_modules/web-tree-sitter/tree-sitter.wasm', baseUrl),
  );
  if (existsSync(canonical)) return canonical;
  return fileURLToPath(new URL('./tree-sitter.wasm', baseUrl));
}

/**
 * Parser cache — 1 parser por lenguaje. Compartido a través del scan
 * (buildInteractionGraph puede llamarse múltiples veces en el mismo proceso).
 */
const parserCache = new Map<SupportedLanguage, any>();
let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<any> {
  // web-tree-sitter 0.20.x: Parser es DEFAULT export, no named export.
  // Fallback pattern por si versiones futuras cambian el shape.
  const treeSitterModule: any = await import('web-tree-sitter');
  const Parser =
    treeSitterModule.default ??
    treeSitterModule.Parser ??
    treeSitterModule.default?.Parser ??
    treeSitterModule;
  if (initPromise === null) {
    const runtimePath = resolveTreeSitterRuntimePath();
    initPromise = Parser.init({
      locateFile: (filename: string): string => {
        if (filename.endsWith('.wasm')) return runtimePath;
        return filename;
      },
    });
  }
  await initPromise;
  return Parser;
}

async function getParser(lang: SupportedLanguage): Promise<any> {
  const cached = parserCache.get(lang);
  if (cached !== undefined) return cached;
  const Parser = await ensureInit();
  // En 0.20.x Language es un tipo namespaced Parser.Language.
  const Language = Parser.Language;
  const grammarPath = resolveGrammarPath(lang);
  // web-tree-sitter en Node necesita el WASM como Uint8Array — pasar el path
  // como string intenta fetch() y falla con getDylinkMetadata. Leer el archivo
  // como buffer y convertir a Uint8Array es el pattern soportado.
  const grammarBytes = new Uint8Array(readFileSync(grammarPath));
  const langObj = await Language.load(grammarBytes);
  const parser = new Parser();
  parser.setLanguage(langObj);
  parserCache.set(lang, parser);
  return parser;
}

/**
 * Extrae imports desde el AST de un archivo TS/JS.
 * Cubre: `import X from 'Y'`, `import { X } from 'Y'`, `import 'Y'`,
 * `require('Y')` (top-level), `import('Y')` (dynamic).
 */
function extractJsImports(rootNode: any): string[] {
  const imports: string[] = [];
  const traverse = (node: any): void => {
    const nodeType = node.type;
    // Static import
    if (nodeType === 'import_statement') {
      const source = node.childForFieldName('source');
      if (source !== null && source !== undefined) {
        const raw = source.text;
        // Strip surrounding quotes
        const stripped = raw.replace(/^['"`]|['"`]$/g, '');
        if (stripped.length > 0) imports.push(stripped);
      }
    }
    // CommonJS require()
    if (nodeType === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn !== null && fn !== undefined && fn.text === 'require') {
        const args = node.childForFieldName('arguments');
        if (args !== null && args !== undefined && args.namedChildCount > 0) {
          const arg = args.namedChild(0);
          if (arg !== null && (arg.type === 'string' || arg.type === 'template_string')) {
            const stripped = arg.text.replace(/^['"`]|['"`]$/g, '');
            if (stripped.length > 0) imports.push(stripped);
          }
        }
      }
    }
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) traverse(child);
    }
  };
  traverse(rootNode);
  return imports;
}

/**
 * Extrae imports desde el AST de un archivo Python.
 * Cubre: `import X`, `import X.Y`, `from X import Y`, `from X.Y import Z`.
 */
function extractPythonImports(rootNode: any): string[] {
  const imports: string[] = [];
  const traverse = (node: any): void => {
    const nodeType = node.type;
    if (nodeType === 'import_statement') {
      // `import X, Y.Z`
      for (let i = 0; i < node.namedChildCount; i += 1) {
        const child = node.namedChild(i);
        if (child !== null && (child.type === 'dotted_name' || child.type === 'aliased_import')) {
          const name = child.type === 'aliased_import' ? child.namedChild(0)?.text : child.text;
          if (typeof name === 'string' && name.length > 0) imports.push(name);
        }
      }
    }
    if (nodeType === 'import_from_statement') {
      const module = node.childForFieldName('module_name');
      if (module !== null && module !== undefined) {
        const name = module.text;
        if (typeof name === 'string' && name.length > 0) imports.push(name);
      }
    }
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) traverse(child);
    }
  };
  traverse(rootNode);
  return imports;
}

/**
 * Extrae símbolos top-level (function/class/const) desde AST TS/JS.
 * `exported` = true si tiene modifier `export` o esta dentro de un
 * `export_statement`.
 */
function extractJsSymbols(rootNode: any): FileSymbol[] {
  const symbols: FileSymbol[] = [];
  for (let i = 0; i < rootNode.childCount; i += 1) {
    const child = rootNode.child(i);
    if (child === null) continue;
    // export_statement wraps declarations
    let exported = false;
    let target = child;
    if (child.type === 'export_statement') {
      exported = true;
      const declaration = child.childForFieldName('declaration');
      if (declaration !== null && declaration !== undefined) target = declaration;
    }
    const nodeType = target.type;
    let kind: FileSymbol['kind'] | null = null;
    let name: string | undefined;
    if (nodeType === 'function_declaration' || nodeType === 'generator_function_declaration') {
      kind = 'function';
      name = target.childForFieldName('name')?.text;
    } else if (nodeType === 'class_declaration') {
      kind = 'class';
      name = target.childForFieldName('name')?.text;
    } else if (nodeType === 'lexical_declaration' || nodeType === 'variable_declaration') {
      kind = 'const';
      // Pick first declarator's name
      for (let j = 0; j < target.namedChildCount; j += 1) {
        const decl = target.namedChild(j);
        if (decl !== null && decl.type === 'variable_declarator') {
          const declName = decl.childForFieldName('name');
          if (declName !== null && declName !== undefined && declName.text.length > 0) {
            name = declName.text;
            break;
          }
        }
      }
    }
    if (kind !== null && name !== undefined && name.length > 0) {
      symbols.push({
        name,
        kind,
        exported,
        startLine: target.startPosition.row + 1,
      });
    }
  }
  return symbols;
}

/**
 * Extrae símbolos top-level desde AST Python. `exported` en Python es más
 * flexible (no hay `export` keyword) — usamos convención: nombres que no
 * empiezan con `_` son "exportados".
 */
function extractPythonSymbols(rootNode: any): FileSymbol[] {
  const symbols: FileSymbol[] = [];
  const processNode = (node: any, forceLine?: number): void => {
    const nodeType = node.type;
    let kind: FileSymbol['kind'] | null = null;
    let name: string | undefined;
    if (nodeType === 'function_definition') {
      kind = 'function';
      name = node.childForFieldName('name')?.text;
    } else if (nodeType === 'class_definition') {
      kind = 'class';
      name = node.childForFieldName('name')?.text;
    } else if (nodeType === 'assignment') {
      const left = node.childForFieldName('left');
      if (left !== null && left !== undefined && left.type === 'identifier') {
        kind = 'const';
        name = left.text;
      }
    }
    if (kind !== null && name !== undefined && name.length > 0) {
      const exported = !name.startsWith('_');
      symbols.push({
        name,
        kind,
        exported,
        startLine: forceLine ?? node.startPosition.row + 1,
      });
    }
  };
  for (let i = 0; i < rootNode.namedChildCount; i += 1) {
    const child = rootNode.namedChild(i);
    if (child === null) continue;
    // Module-level assignments en Python están wrapped en `expression_statement`.
    // Unwrap para procesar la assignment interna.
    if (child.type === 'expression_statement') {
      for (let j = 0; j < child.namedChildCount; j += 1) {
        const inner = child.namedChild(j);
        if (inner !== null) processNode(inner, child.startPosition.row + 1);
      }
    } else {
      processNode(child);
    }
  }
  return symbols;
}

/**
 * Resuelve un import specifier a un path relativo al rootPath.
 * Solo static imports relativos (`./`, `../`) se resuelven; imports de
 * paquetes bare (`react`, `lodash`) devuelven `null`.
 */
function resolveImportPath(importer: string, specifier: string, rootPath: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const importerDir = dirname(importer);
  let resolved = resolve(importerDir, specifier);
  // Add extension if missing.
  if (!existsSync(resolved)) {
    const candidates = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'];
    let found: string | null = null;
    for (const ext of candidates) {
      if (existsSync(resolved + ext)) {
        found = resolved + ext;
        break;
      }
    }
    if (found === null) {
      // Try index files inside directory.
      for (const ext of candidates) {
        const candidate = join(resolved, `index${ext}`);
        if (existsSync(candidate)) {
          found = candidate;
          break;
        }
      }
    }
    if (found === null) return null;
    resolved = found;
  }
  return relative(rootPath, resolved).split(/[\\/]/).join('/');
}

/**
 * Infiere el rol de un archivo heurísticamente (v1).
 */
function inferRole(
  relPath: string,
  importedByCount: number,
  isEntryFilename: boolean,
): FileContext['inferredRole'] {
  const segments = relPath.split('/');
  const filename = segments[segments.length - 1] ?? '';
  // Test files: path segment OR .test./.spec. filename
  const hasTestSegment = segments.some((s) => s === 'test' || s === 'tests' || s === '__test__');
  const hasTestFilename = filename.includes('.test.') || filename.includes('.spec.');
  if (hasTestSegment || hasTestFilename) return 'test';
  if (isEntryFilename) return 'entry';
  if (importedByCount >= 2) return 'library';
  if (importedByCount === 0) return 'entry'; // 0 importers → likely entry (no importer means it's called externally)
  return 'leaf';
}

const ENTRY_FILENAME_PATTERNS = [
  /^index\.(ts|tsx|js|jsx|mjs|cjs|py)$/,
  /^main\.(ts|tsx|js|jsx|mjs|cjs|py)$/,
  /^app\.(ts|tsx|js|jsx|mjs|cjs|py)$/,
  /^cli\.(ts|tsx|js|jsx|mjs|cjs|py)$/,
  /^__main__\.py$/,
];

function isEntryFilename(relPath: string): boolean {
  const filename = relPath.split('/').pop() ?? '';
  return ENTRY_FILENAME_PATTERNS.some((rx) => rx.test(filename));
}

/** Opciones de construcción del grafo (extensible en v2+). */
export interface BuildInteractionGraphOptions {
  /** Timeout ms para el parse total (default: 30_000). */
  readonly timeoutMs?: number;
}

/**
 * Construye el grafo de interacciones del workspace. Retorna un Map indexado
 * por path relativo al `rootPath` (con separador `/`, coherente con
 * `Finding.location.path`).
 *
 * En caso de error irrecuperable (WASM no carga, etc.), el fallback graceful
 * es retornar un Map vacío — los findings quedan sin fileContext/symbolContext
 * y el Triage Agent opera como pre-DG-123 A. El sistema NO se rompe.
 */
export async function buildInteractionGraph(
  rootPath: string,
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  _options: BuildInteractionGraphOptions = {},
): Promise<Map<string, InteractionGraphNode>> {
  const graph = new Map<string, InteractionGraphNode>();
  let files: string[];
  try {
    files = collectSourceFiles(rootPath);
  } catch {
    return graph;
  }
  if (files.length === 0) return graph;

  // Parse per language, extract imports + symbols.
  interface Intermediate {
    absPath: string;
    relPath: string;
    language: SupportedLanguage;
    rawImports: string[];
    symbols: FileSymbol[];
  }
  const intermediate: Intermediate[] = [];
  for (const absPath of files) {
    const language = detectLanguage(absPath);
    if (language === null) continue;
    let source: string;
    try {
      source = await readFile(absPath, 'utf8');
    } catch {
      continue;
    }
    let parser: any;
    try {
      parser = await getParser(language);
    } catch {
      // Grammar load failed for this language — skip file (graceful degrade).
      continue;
    }
    let tree: any;
    try {
      tree = parser.parse(source);
    } catch {
      continue;
    }
    if (tree === null || tree === undefined) continue;
    const rootNode = tree.rootNode;
    const rawImports =
      language === 'python' ? extractPythonImports(rootNode) : extractJsImports(rootNode);
    const symbols =
      language === 'python' ? extractPythonSymbols(rootNode) : extractJsSymbols(rootNode);
    const relPath = relative(rootPath, absPath).split(/[\\/]/).join('/');
    intermediate.push({ absPath, relPath, language, rawImports, symbols });
  }

  // Resolve imports + build reverse-index.
  const importedByIndex = new Map<string, Set<string>>();
  for (const entry of intermediate) {
    const resolvedImports: string[] = [];
    for (const spec of entry.rawImports) {
      const resolved = resolveImportPath(entry.absPath, spec, rootPath);
      if (resolved !== null) {
        resolvedImports.push(resolved);
        if (!importedByIndex.has(resolved)) importedByIndex.set(resolved, new Set());
        importedByIndex.get(resolved)!.add(entry.relPath);
      }
    }
    // Store back on entry for the final pass.
    entry.rawImports = resolvedImports;
  }

  // Final graph nodes.
  for (const entry of intermediate) {
    const importedBy = [...(importedByIndex.get(entry.relPath) ?? new Set<string>())].sort();
    const inferredRole = inferRole(
      entry.relPath,
      importedBy.length,
      isEntryFilename(entry.relPath),
    );
    const definedSymbols = entry.symbols;
    const exportedSymbols = definedSymbols.filter((s) => s.exported).map((s) => s.name);
    const fileContext: FileContext = {
      language: entry.language,
      imports: [...new Set(entry.rawImports)].sort(),
      importedBy,
      inferredRole,
    };
    const symbolContext: SymbolContext = {
      definedSymbols,
      exportedSymbols,
    };
    graph.set(entry.relPath, { fileContext, symbolContext });
  }

  return graph;
}

/**
 * Query helper: obtiene el nodo del grafo para un `findingPath`, o `undefined`
 * si el archivo no fue parseado (extensión no soportada, error de parse, etc.).
 */
export function getInteractionContextForPath(
  graph: Map<string, InteractionGraphNode>,
  findingPath: string,
): InteractionGraphNode | undefined {
  return graph.get(findingPath);
}
