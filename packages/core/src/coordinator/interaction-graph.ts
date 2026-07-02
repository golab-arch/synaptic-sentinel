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
  /**
   * DG-127 A (Cycle 113 FASE II): signature = primera línea del declaration
   * (function signature completa hasta `{` o const initializer preview
   * truncado a ~150 chars). Habilita cross-file signature attachment en el
   * prompt del Triage Agent — el LLM ve `execute(req: OrchestrationRequest):
   * Promise<Result>` para el sink cross-file en vez de solo saber que existe.
   * Opcional para backward-compat con schemas legacy pre-DG-127 A.
   */
  signature: z.string().optional(),
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
   * DG-126 A (Cycle 112 FASE I R1): bare imports informacionales — paquetes
   * npm (`react`, `zod`, `express`, `@synaptic-sentinel/core`) y builtins de
   * Node (`node:fs`, `node:path`). No se resuelven a nodos del graph (no
   * corresponden a archivos del workspace) pero SÍ dan contexto de tecnología
   * al LLM: "este archivo usa express+zod" → probablemente un handler web;
   * "este archivo usa @google-cloud/firestore" → probablemente storage layer.
   *
   * Antes de R1 (DG-123 A original), estos imports desaparecían silenciosa-
   * mente porque resolveImportPath devolvía null. Empíricamente en Baseline-9b:
   * colony-db.ts mostraba imports=1 pero tiene ~8 bare deps (zod,
   * node-sqlite3-wasm, node:*, etc.) — el LLM veía "1 module" cuando el file
   * tiene MUY diverse tech surface. Aditivo backward-compat: findings de
   * pre-DG-126 A siguen valid con bareImports undefined.
   */
  bareImports: z.array(z.string()).default([]),
  /**
   * DG-127 A (Cycle 113 FASE II): mapping de symbol name importado → archivo
   * source (resuelto). Ejemplo: para `import { execute } from '../services/agent-loop.js'`
   * → `{ name: 'execute', fromFile: 'src/services/agent-loop.ts' }`. Habilita
   * el prompt formatter a cruzar identifiers del snippet con el archivo donde
   * están definidos, y adjuntar la signature desde ese archivo. Cubre named
   * imports (`{ X, Y }`), default imports (`import D from '...'` → name='D'),
   * y namespace imports (`import * as N from '...'` → name='N').
   * Aditivo opcional para backward-compat con schemas legacy pre-DG-127 A.
   */
  importedSymbols: z
    .array(
      z.object({
        /** Nombre local del symbol en el archivo del importer. */
        name: z.string().min(1),
        /**
         * Path relativo al rootPath del archivo donde el symbol está definido.
         * Solo se emite cuando el import resuelve a un archivo del workspace
         * (imports bare de npm/node builtins NO se incluyen aquí — van a bareImports).
         */
        fromFile: z.string().min(1),
      }),
    )
    .default([]),
  /**
   * Rol inferido heurísticamente (DG-126 A R2 — semantics fix):
   * - `entry`: filename matchea index/main/app/cli (typical entry point).
   * - `library`: >=1 importer (usado por al menos un consumidor del workspace).
   * - `test`: path contiene segmento `test`/`__test__` o filename `.test./.spec.`.
   * - `leaf`: 0 importers y no matchea entry heurística — orphan/dead-code
   *   candidate O standalone script sin filename convencional.
   * - `unknown`: ninguno de los anteriores (raro — fallback).
   *
   * PRE-R2 (DG-123 A original): 'library' requería >=2 importers; el caso
   * `importedByCount === 1` caía por fallthrough a 'leaf', que es semantics
   * incorrecto (leaf en graph theory = 0 importers, NO 1). Empíricamente en
   * Baseline-9b: detectors.ts mostraba role=leaf importedBy=1, confundente.
   * Post-R2: >=1 → 'library'; solo 0 importers no-entry-filename → 'leaf'.
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

/**
 * DG-127 A (Cycle 113 FASE II) — R18 v2 symbol-level cross-file resolution.
 *
 * Signatures resueltas per-finding para los identifiers referenciados en el
 * snippet del finding que corresponden a imports cross-file. Precomputadas
 * en Coordinator Stage 1.5b desde `finding.location.snippet` +
 * `fileContext.importedSymbols` + `graph[fromFile].symbolContext.definedSymbols`.
 *
 * Ejemplo del North Star case (SYNAPTIC_SAAS):
 * - Finding: `sentinel-js-taint-sql-injection` en `agent.ts:62`
 * - Snippet: `agentLoop.execute(orchestrationRequest)`
 * - fileContext.importedSymbols contains `{ name: 'agentLoop', fromFile:
 *   'src/services/agent-loop.ts' }`
 * - graph.get('src/services/agent-loop.ts').symbolContext.definedSymbols
 *   contains `{ name: 'agentLoop', signature: 'export class AgentLoop {' }`
 *   y separately `{ name: 'execute', signature: 'async execute(req:
 *   OrchestrationRequest): Promise<Result> {' }` (si es method o si el file
 *   exporta también la function directamente)
 * - crossFileContext.signatures = [{
 *     symbolName: 'agentLoop', sourceFile: 'src/services/agent-loop.ts',
 *     sourceLine: 42, signature: 'export class AgentLoop {'
 *   }]
 *
 * El prompt del Triage Agent muestra el LLM esta info como
 * "`agentLoop` defined at `src/services/agent-loop.ts:42` with signature
 * `export class AgentLoop {...}`". El LLM puede razonar cross-file sin
 * pedir "internals" al usuario.
 *
 * Cap defensivo: `MAX_CROSS_FILE_SIGNATURES_PER_FINDING = 3` (aplicado en
 * la extracción — evita prompt bloat en snippets con muchos identifiers).
 */
export const CrossFileContextSchema = z.object({
  /**
   * Signatures cross-file resueltas por identifier extraído del snippet.
   * Ordenadas por aparición en el snippet + capadas a
   * MAX_CROSS_FILE_SIGNATURES_PER_FINDING = 3.
   */
  signatures: z
    .array(
      z.object({
        /** Nombre del symbol tal como aparece en el snippet del finding. */
        symbolName: z.string().min(1),
        /** Path relativo al rootPath del archivo donde está definido. */
        sourceFile: z.string().min(1),
        /** Línea 1-based del startPosition del symbol en el sourceFile. */
        sourceLine: z.number().int().positive(),
        /**
         * Primera línea de la declaration (function signature completa hasta
         * `{` o const initializer preview truncado a ~150 chars).
         */
        signature: z.string().min(1),
      }),
    )
    .default([]),
});

/** Cross-file context DG-127 A poblado en Coordinator Stage 1.5b. */
export type CrossFileContext = z.infer<typeof CrossFileContextSchema>;

/** DG-127 A: cap defensivo — top-N signatures cross-file por finding. */
export const MAX_CROSS_FILE_SIGNATURES_PER_FINDING = 3;

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
 * DG-127 A (Cycle 113 FASE II): import enriquecido con la lista de local names
 * importados (named specifiers + default + namespace). Habilita la
 * construcción de importedSymbols en fileContext para cross-file lookup.
 */
interface JsImportSpec {
  /** Source path o package name (e.g. './foo.js', 'react', 'node:fs'). */
  source: string;
  /**
   * Nombres LOCALES importados. Cubre:
   * - `import { X, Y as Z } from 'A'` → ['X', 'Z']
   * - `import D from 'A'` → ['D']
   * - `import * as N from 'A'` → ['N']
   * - `import 'A'` (side-effect only) → []
   * - `require('A')` → []
   */
  localNames: string[];
}

/**
 * DG-127 A: versión rich de extractJsImports que retorna cada import con
 * su lista de local names extraídos del import_clause.
 *
 * Para el North Star case: `import { execute } from '../services/agent-loop.js'`
 * retorna `{ source: '../services/agent-loop.js', localNames: ['execute'] }`.
 * Combinado con resolveImportPath + graph lookup, habilita cross-file
 * signature attachment.
 */
function extractJsImportsRich(rootNode: any): JsImportSpec[] {
  const specs: JsImportSpec[] = [];
  const traverse = (node: any): void => {
    const nodeType = node.type;
    // Static import — extraer source + local names
    if (nodeType === 'import_statement') {
      const source = node.childForFieldName('source');
      if (source !== null && source !== undefined) {
        const raw = source.text;
        const stripped = raw.replace(/^['"`]|['"`]$/g, '');
        if (stripped.length > 0) {
          const localNames = extractJsImportClauseNames(node);
          specs.push({ source: stripped, localNames });
        }
      }
    }
    // CommonJS require() — sin local names (side-effect only en top-level)
    if (nodeType === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn !== null && fn !== undefined && fn.text === 'require') {
        const args = node.childForFieldName('arguments');
        if (args !== null && args !== undefined && args.namedChildCount > 0) {
          const arg = args.namedChild(0);
          if (arg !== null && (arg.type === 'string' || arg.type === 'template_string')) {
            const stripped = arg.text.replace(/^['"`]|['"`]$/g, '');
            if (stripped.length > 0) {
              specs.push({ source: stripped, localNames: [] });
            }
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
  return specs;
}

/**
 * DG-127 A helper: extrae los local names del import_clause de un
 * `import_statement`. Cubre named, default, namespace, y mezclas.
 * Retorna array de strings — vacío si el import es side-effect (`import 'X'`).
 *
 * Implementación con recursión defensiva porque diferentes versiones de
 * tree-sitter-typescript wrapean named_imports/namespace_import en
 * `import_clause` o los ponen como direct children del import_statement.
 */
function extractJsImportClauseNames(importStatement: any): string[] {
  const names: string[] = [];

  // Recursive helper: busca import_specifier (named), namespace_import
  // (namespace), o import_clause (wrapper con default identifier + posibles
  // named/namespace inside). Extrae el identifier apropiado según nodeType.
  const findSpecifiers = (node: any): void => {
    const type = node.type;
    if (type === 'import_specifier') {
      // import_specifier: preferir field `alias` (si tiene `as`), sino `name`.
      // Fallback: último identifier del subtree (para versiones sin fields).
      const alias = node.childForFieldName('alias');
      const nameNode = node.childForFieldName('name');
      const target = alias ?? nameNode;
      if (target !== null && target !== undefined && target.text.length > 0) {
        names.push(target.text);
      } else {
        let last: string | undefined;
        for (let i = 0; i < node.namedChildCount; i += 1) {
          const inner = node.namedChild(i);
          if (inner !== null && inner.type === 'identifier') {
            last = inner.text;
          }
        }
        if (last !== undefined) names.push(last);
      }
      return;
    }
    if (type === 'namespace_import') {
      for (let i = 0; i < node.namedChildCount; i += 1) {
        const inner = node.namedChild(i);
        if (inner !== null && inner.type === 'identifier') {
          names.push(inner.text);
        }
      }
      return;
    }
    if (type === 'import_clause') {
      // import_clause wrapper — direct children pueden ser:
      // - identifier: default binding (`import D from 'X'` → 'D')
      // - namespace_import: `* as N`
      // - named_imports: `{ X, Y }`
      for (let i = 0; i < node.namedChildCount; i += 1) {
        const inner = node.namedChild(i);
        if (inner === null) continue;
        if (inner.type === 'identifier') {
          names.push(inner.text);
        } else {
          findSpecifiers(inner);
        }
      }
      return;
    }
    // Continue recursion en el resto (nested wrappers)
    for (let i = 0; i < node.namedChildCount; i += 1) {
      const inner = node.namedChild(i);
      if (inner !== null) findSpecifiers(inner);
    }
  };

  // Direct children del import_statement:
  // - identifier: default import cuando NO hay import_clause wrapper
  //   (`import D from 'X'` → D en versiones antiguas de la grammar)
  // - namespace_import, named_imports, import_clause: recursión
  for (let i = 0; i < importStatement.namedChildCount; i += 1) {
    const child = importStatement.namedChild(i);
    if (child === null) continue;
    if (child.type === 'identifier') {
      // Default import — direct child del import_statement (grammar antigua)
      names.push(child.text);
      continue;
    }
    findSpecifiers(child);
  }
  return names;
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
 * DG-127 A helper — extrae la signature "primera línea" del text del node.
 * Para functions: extrae hasta el primer `{` o EOL (lo que llegue primero).
 * Para classes: idem.
 * Para consts: primera línea del initializer preview truncado a
 * MAX_SIGNATURE_CHARS.
 * Cross-file value: el LLM ve `execute(req: OrchestrationRequest):
 * Promise<Result>` en vez de solo saber que existe.
 */
const MAX_SIGNATURE_CHARS = 150;

function extractSignatureFromNode(
  targetNode: any,
  isExported: boolean,
  kind: FileSymbol['kind'],
): string {
  const raw = typeof targetNode.text === 'string' ? targetNode.text : '';
  if (raw.length === 0) return '';
  // Estrategia: cortar en el primer `{` o en la primera línea con `=`
  // seguido de expression complex. Prepend `export` si aplica para full
  // signature UX.
  const prefix = isExported ? 'export ' : '';
  if (kind === 'function' || kind === 'class') {
    // Cortar en el primer `{` (body opening) — el signature es todo antes.
    const braceIdx = raw.indexOf('{');
    const untilBrace = braceIdx >= 0 ? raw.slice(0, braceIdx).trimEnd() : raw;
    // Colapsar whitespace multi-line
    const collapsed = untilBrace.replace(/\s+/g, ' ').trim();
    const withPrefix = prefix + collapsed;
    return withPrefix.length > MAX_SIGNATURE_CHARS
      ? `${withPrefix.slice(0, MAX_SIGNATURE_CHARS - 1)}…`
      : withPrefix;
  }
  // const: primera línea del text, truncado
  const firstLine = raw.split('\n', 1)[0] ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  const withPrefix = prefix + collapsed;
  return withPrefix.length > MAX_SIGNATURE_CHARS
    ? `${withPrefix.slice(0, MAX_SIGNATURE_CHARS - 1)}…`
    : withPrefix;
}

/**
 * Extrae símbolos top-level (function/class/const) desde AST TS/JS.
 * `exported` = true si tiene modifier `export` o esta dentro de un
 * `export_statement`.
 *
 * DG-127 A (Cycle 113 FASE II): también extrae `signature` — primera línea
 * de la declaration (function signature hasta `{` o const preview).
 * Habilita cross-file signature attachment en el prompt del Triage Agent.
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
      // DG-127 A: capturar signature del target node (primera línea).
      const signature = extractSignatureFromNode(target, exported, kind);
      symbols.push({
        name,
        kind,
        exported,
        startLine: target.startPosition.row + 1,
        ...(signature.length > 0 ? { signature } : {}),
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
 * DG-123.0.2 (Cycle 111): tabla de sustitucion de extensiones para el idioma
 * TypeScript ESM en Node — un import `from './foo.js'` en el source resuelve
 * al archivo `foo.ts`/`.tsx`/`.jsx` en disco (el `.js` es lo que existe
 * post-build en `dist/`, no en el arbol de src). Sin esta tabla, el resolver
 * pre-DG-123.0.2 devolvia null para ~100% de los imports en proyectos
 * TypeScript ESM (Baseline-8c en SENTINEL: 4/4 findings con imports=0
 * importedBy=0 porque coordinator.ts importa `../colony/colony-db.js` y en
 * disco solo existe `colony-db.ts`).
 *
 * Semantica: cuando el specifier trae extension explicita (comun en ESM),
 * probamos primero el archivo tal cual, y si no existe, probamos los
 * sustitutos por convencion TypeScript. Fallback final: tratar las
 * extensiones como sufijos aditivos (el behavior pre-fix, para specifiers
 * sin extension tipo `import './foo'`).
 */
const EXTENSION_SUBSTITUTES: Record<string, readonly string[]> = {
  '.js': ['.ts', '.tsx', '.jsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
  '.jsx': ['.tsx'],
};

/** Extensiones que probamos como sufijo aditivo cuando el specifier NO trae extension. */
const ADDITIVE_EXTENSION_CANDIDATES = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
] as const;

/**
 * Resuelve un import specifier a un path relativo al rootPath.
 * Solo static imports relativos (`./`, `../`) se resuelven; imports de
 * paquetes bare (`react`, `lodash`) devuelven `null`.
 *
 * DG-123.0.2: soporte para specifiers TypeScript ESM con extension `.js`
 * mapeada a source `.ts`. Ver EXTENSION_SUBSTITUTES arriba para la tabla.
 */
function resolveImportPath(importer: string, specifier: string, rootPath: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const importerDir = dirname(importer);
  const resolved = resolve(importerDir, specifier);

  // Case 1: el path resuelto existe tal cual (raro en TS ESM porque el
  // specifier suele traer .js explicito, y `.js` no existe en src/).
  if (existsSync(resolved)) {
    return relative(rootPath, resolved).split(/[\\/]/).join('/');
  }

  // Case 2 (DG-123.0.2): sustitucion de extension segun tabla
  // EXTENSION_SUBSTITUTES. Aplica cuando el specifier trae extension
  // conocida del ecosistema JS/TS pero el archivo en disco tiene la
  // extension source correspondiente.
  const dotIdx = specifier.lastIndexOf('.');
  const slashIdx = specifier.lastIndexOf('/');
  if (dotIdx > slashIdx) {
    const specifierExt = specifier.slice(dotIdx);
    const substitutes = EXTENSION_SUBSTITUTES[specifierExt];
    if (substitutes !== undefined) {
      const withoutExt = resolved.slice(0, resolved.length - specifierExt.length);
      for (const subExt of substitutes) {
        const candidate = withoutExt + subExt;
        if (existsSync(candidate)) {
          return relative(rootPath, candidate).split(/[\\/]/).join('/');
        }
      }
    }
  }

  // Case 3: aditivo — el specifier no trae extension (`import './foo'`).
  // Prueba cada extension como sufijo hasta encontrar match.
  for (const ext of ADDITIVE_EXTENSION_CANDIDATES) {
    if (existsSync(resolved + ext)) {
      return relative(rootPath, resolved + ext)
        .split(/[\\/]/)
        .join('/');
    }
  }

  // Case 4: index-inside-directory (`import './foo'` cuando foo/ es dir con index.*).
  for (const ext of ADDITIVE_EXTENSION_CANDIDATES) {
    const candidate = join(resolved, `index${ext}`);
    if (existsSync(candidate)) {
      return relative(rootPath, candidate).split(/[\\/]/).join('/');
    }
  }

  return null;
}

/**
 * Infiere el rol de un archivo heurísticamente.
 *
 * DG-126 A R2 (Cycle 112 FASE I): fix semantics de 'leaf'/'library' — antes el
 * caso `importedByCount === 1` caía por fallthrough a 'leaf', semantics
 * incorrecto (graph theory leaf = 0 importers). Empíricamente en Baseline-9b:
 * detectors.ts mostraba role=leaf importedBy=1 confundente. Post-R2: >=1 →
 * 'library'; solo 0 importers no-entry-filename → 'leaf'.
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
  // R2 fix: >=1 importer → library (relajado desde >=2). Elimina el
  // fallthrough incorrecto a leaf para importedByCount === 1.
  if (importedByCount >= 1) return 'library';
  // R2 fix: 0 importers no-entry-filename → leaf (semantics correcto —
  // orphan/dead-code candidate o standalone script sin filename convencional).
  // Antes devolvía 'entry' aquí, misleading porque el archivo puede ser
  // dead-code y no realmente entry.
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
    /** DG-127 A: rich imports con local names capturados del import_clause. */
    richImports: JsImportSpec[];
    /**
     * DG-126 A R1: bare imports (npm packages / node builtins) — populados en
     * el pass resolve más abajo.
     */
    bareImports: string[];
    /**
     * DG-127 A (Cycle 113 FASE II): symbols locales → archivo source resuelto
     * poblado en el pass resolve. Habilita cross-file signature lookup.
     */
    importedSymbols: { name: string; fromFile: string }[];
    /** Paths relativos resueltos (mismos que fileContext.imports). */
    resolvedImports: string[];
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
    // DG-127 A: rich imports para JS/TS (local names capturados). Para Python
    // v1.1 usamos wrapper compatible con sources-only (deferrable a v2.1).
    const richImports: JsImportSpec[] =
      language === 'python'
        ? extractPythonImports(rootNode).map((source) => ({ source, localNames: [] }))
        : extractJsImportsRich(rootNode);
    const symbols =
      language === 'python' ? extractPythonSymbols(rootNode) : extractJsSymbols(rootNode);
    const relPath = relative(rootPath, absPath).split(/[\\/]/).join('/');
    intermediate.push({
      absPath,
      relPath,
      language,
      richImports,
      bareImports: [],
      importedSymbols: [],
      resolvedImports: [],
      symbols,
    });
  }

  // Resolve imports + build reverse-index.
  // DG-126 A R1: separa bare imports (npm packages / node builtins) de los
  // relativos. Bare imports NO se resuelven a nodos del graph pero SÍ se
  // capturan como metadata informacional.
  // DG-127 A: adicionalmente, para cada spec resuelto, poblar
  // importedSymbols[{name, fromFile}] con los local names del import_clause
  // mapeados al fromFile resuelto. Habilita cross-file signature lookup.
  const importedByIndex = new Map<string, Set<string>>();
  for (const entry of intermediate) {
    const resolvedImports: string[] = [];
    const bareImports: string[] = [];
    const importedSymbols: { name: string; fromFile: string }[] = [];
    for (const spec of entry.richImports) {
      if (!spec.source.startsWith('.')) {
        // Bare import — captura como informational metadata.
        bareImports.push(spec.source);
        continue;
      }
      const resolved = resolveImportPath(entry.absPath, spec.source, rootPath);
      if (resolved !== null) {
        resolvedImports.push(resolved);
        if (!importedByIndex.has(resolved)) importedByIndex.set(resolved, new Set());
        importedByIndex.get(resolved)!.add(entry.relPath);
        // DG-127 A: poblar importedSymbols per local name del clause.
        for (const localName of spec.localNames) {
          importedSymbols.push({ name: localName, fromFile: resolved });
        }
      }
    }
    entry.resolvedImports = resolvedImports;
    entry.bareImports = bareImports;
    entry.importedSymbols = importedSymbols;
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
      imports: [...new Set(entry.resolvedImports)].sort(),
      importedBy,
      // DG-126 A R1: bareImports dedupeados + sorted para determinism.
      bareImports: [...new Set(entry.bareImports)].sort(),
      // DG-127 A: importedSymbols preservados en orden de aparición
      // (importantes para cross-file lookup — el prompt formatter puede
      // priorizar por orden en el snippet).
      importedSymbols: entry.importedSymbols,
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

/**
 * DG-127 A helper (Cycle 113 FASE II): extrae identifier tokens de un snippet.
 * Simple regex-based scanner (no AST) — captura secuencias de identifier chars
 * separadas por non-identifier chars. Suficiente para el use case (cruzar
 * identifiers del snippet vs importedSymbols mapping).
 *
 * Filtra keywords JS/TS + Python que nunca serían symbols importados. Preserve
 * orden de aparición para priorizar en el prompt formatter.
 */
const JS_TS_PY_KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'class',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'this',
  'super',
  'await',
  'async',
  'yield',
  'true',
  'false',
  'null',
  'undefined',
  'void',
  'typeof',
  'instanceof',
  'in',
  'of',
  'import',
  'export',
  'from',
  'as',
  'default',
  'type',
  'interface',
  'enum',
  'namespace',
  'public',
  'private',
  'protected',
  'readonly',
  'static',
  'abstract',
  'implements',
  'extends',
  'and',
  'or',
  'not',
  'is',
  'lambda',
  'pass',
  'raise',
  'with',
  'yield',
  'None',
  'True',
  'False',
]);

export function extractIdentifiersFromSnippet(snippet: string): string[] {
  const found = new Set<string>();
  const ordered: string[] = [];
  const identifierRegex = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let match: RegExpExecArray | null;
  while ((match = identifierRegex.exec(snippet)) !== null) {
    const token = match[0];
    if (JS_TS_PY_KEYWORDS.has(token)) continue;
    if (!found.has(token)) {
      found.add(token);
      ordered.push(token);
    }
  }
  return ordered;
}

/**
 * DG-127 A (Cycle 113 FASE II): resuelve cross-file signatures per-finding.
 * Toma el snippet del finding, extrae identifiers, matches contra
 * fileContext.importedSymbols para saber de qué archivo viene cada uno,
 * y busca la signature en el graph node del archivo target.
 *
 * Cap defensivo aplicado: `MAX_CROSS_FILE_SIGNATURES_PER_FINDING = 3`.
 * Preserve orden de aparición en el snippet — LLM ve los symbols en el
 * mismo orden que aparecen en el codigo.
 *
 * Retorna array vacío si el finding no tiene snippet, o si ninguno de los
 * identifiers match con importedSymbols, o si el fromFile del import NO
 * está en el graph (edge case: import a un archivo excluido).
 */
export function resolveCrossFileSignatures(
  snippet: string | undefined,
  importedSymbols: readonly { name: string; fromFile: string }[],
  graph: Map<string, InteractionGraphNode>,
): CrossFileContext['signatures'] {
  if (snippet === undefined || snippet.length === 0) return [];
  const identifiers = extractIdentifiersFromSnippet(snippet);
  if (identifiers.length === 0) return [];
  const importsByName = new Map<string, string>();
  for (const spec of importedSymbols) {
    if (!importsByName.has(spec.name)) importsByName.set(spec.name, spec.fromFile);
  }
  const result: CrossFileContext['signatures'] = [];
  for (const identifier of identifiers) {
    if (result.length >= MAX_CROSS_FILE_SIGNATURES_PER_FINDING) break;
    const fromFile = importsByName.get(identifier);
    if (fromFile === undefined) continue;
    const targetNode = graph.get(fromFile);
    if (targetNode === undefined) continue;
    // Busca symbol con name idéntico en el target file's definedSymbols.
    const targetSymbol = targetNode.symbolContext.definedSymbols.find((s) => s.name === identifier);
    if (targetSymbol === undefined) continue;
    if (targetSymbol.signature === undefined || targetSymbol.signature.length === 0) continue;
    result.push({
      symbolName: identifier,
      sourceFile: fromFile,
      sourceLine: targetSymbol.startLine,
      signature: targetSymbol.signature,
    });
  }
  return result;
}
