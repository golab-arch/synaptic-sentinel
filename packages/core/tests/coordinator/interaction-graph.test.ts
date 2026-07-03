import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_CROSS_FILE_SIGNATURES_PER_FINDING,
  SUPPORTED_LANGUAGES,
  TAINT_PATTERN_LABELS,
  buildInteractionGraph,
  detectLanguage,
  detectTaintPatternsInBody,
  extractIdentifiersFromSnippet,
  resolveCrossFileSignatures,
} from '../../src/coordinator/interaction-graph.js';

/**
 * DG-123 A (Cycle 111) — R18 v1 Interaction Graph Layer.
 *
 * Tests unitarios del graph builder. Usa fixture temporal en filesystem para
 * ejercitar parsing real de web-tree-sitter con las 4 grammars soportadas.
 * Los tests son async (WASM init es async).
 */

describe('detectLanguage — DG-123 A', () => {
  it('reconoce las 4 extensiones soportadas', () => {
    expect(detectLanguage('src/foo.ts')).toBe('typescript');
    expect(detectLanguage('src/foo.tsx')).toBe('tsx');
    expect(detectLanguage('src/foo.js')).toBe('javascript');
    expect(detectLanguage('src/foo.jsx')).toBe('javascript');
    expect(detectLanguage('src/foo.mjs')).toBe('javascript');
    expect(detectLanguage('src/foo.cjs')).toBe('javascript');
    expect(detectLanguage('src/foo.py')).toBe('python');
  });

  it('devuelve null para lenguajes no soportados en v1', () => {
    expect(detectLanguage('src/foo.rs')).toBeNull();
    expect(detectLanguage('src/foo.go')).toBeNull();
    expect(detectLanguage('README.md')).toBeNull();
    expect(detectLanguage('config.json')).toBeNull();
    expect(detectLanguage('no-extension')).toBeNull();
  });

  it('es case-insensitive por extension', () => {
    expect(detectLanguage('Foo.TS')).toBe('typescript');
    expect(detectLanguage('Foo.PY')).toBe('python');
  });

  it('exporta las 4 languages en SUPPORTED_LANGUAGES', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['typescript', 'tsx', 'javascript', 'python']);
  });
});

describe('buildInteractionGraph — TypeScript fixtures', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'sentinel-graph-ts-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('extrae imports estáticos + reverse-index de un proyecto TS', async () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(
      join(workspace, 'src', 'index.ts'),
      "import { helper } from './helper';\nimport { util } from './util';\nexport function main() { return helper() + util(); }\n",
    );
    writeFileSync(join(workspace, 'src', 'helper.ts'), 'export function helper() { return 1; }\n');
    writeFileSync(join(workspace, 'src', 'util.ts'), 'export function util() { return 2; }\n');

    const graph = await buildInteractionGraph(workspace);

    expect(graph.size).toBe(3);
    const indexNode = graph.get('src/index.ts');
    expect(indexNode).toBeDefined();
    expect(indexNode?.fileContext.language).toBe('typescript');
    expect(indexNode?.fileContext.imports).toContain('src/helper.ts');
    expect(indexNode?.fileContext.imports).toContain('src/util.ts');
    // index.ts es un entry filename
    expect(indexNode?.fileContext.inferredRole).toBe('entry');

    const helperNode = graph.get('src/helper.ts');
    expect(helperNode?.fileContext.importedBy).toContain('src/index.ts');
    expect(helperNode?.symbolContext.definedSymbols.some((s) => s.name === 'helper')).toBe(true);
    expect(helperNode?.symbolContext.exportedSymbols).toContain('helper');
  });

  it('detecta rol "test" para archivos *.test.ts', async () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, 'src', 'thing.ts'), 'export const thing = 1;\n');
    writeFileSync(
      join(workspace, 'src', 'thing.test.ts'),
      "import { thing } from './thing';\nconst x = thing;\n",
    );

    const graph = await buildInteractionGraph(workspace);
    // El .test.ts se skipeará por el exclude-list (segmento no aplica pero filename
    // pattern .test. sí aplica en DG-117.0.1) → depende de si buildInteractionGraph
    // respeta el exclude. Nuestro walk skipea SKIP_SEGMENTS, pero NO filename
    // patterns. Es decir, el .test.ts sí se parsea aquí (el filtro por filename
    // aplica al Coordinator finding-level, no al graph builder). Test lo confirma.
    const testNode = graph.get('src/thing.test.ts');
    expect(testNode).toBeDefined();
    expect(testNode?.fileContext.inferredRole).toBe('test');
  });

  it('extrae symbols top-level (function + class + const) con exported flag', async () => {
    writeFileSync(
      join(workspace, 'lib.ts'),
      [
        'export function foo() { return 1; }',
        'function bar() { return 2; }',
        'export class Baz {}',
        'export const CONST_X = 42;',
        'const privateY = 100;',
      ].join('\n') + '\n',
    );

    const graph = await buildInteractionGraph(workspace);
    const node = graph.get('lib.ts');
    expect(node).toBeDefined();
    const names = node!.symbolContext.definedSymbols.map((s) => s.name).sort();
    expect(names).toContain('foo');
    expect(names).toContain('bar');
    expect(names).toContain('Baz');
    expect(names).toContain('CONST_X');
    expect(names).toContain('privateY');

    const exported = node!.symbolContext.exportedSymbols;
    expect(exported).toContain('foo');
    expect(exported).toContain('Baz');
    expect(exported).toContain('CONST_X');
    expect(exported).not.toContain('bar');
    expect(exported).not.toContain('privateY');
  });

  it('skipea directorios del exclude-list (node_modules, dist, fixtures)', async () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    mkdirSync(join(workspace, 'node_modules', 'foo'), { recursive: true });
    mkdirSync(join(workspace, 'dist'), { recursive: true });
    mkdirSync(join(workspace, 'fixtures'), { recursive: true });
    writeFileSync(join(workspace, 'src', 'real.ts'), 'export const real = 1;\n');
    writeFileSync(join(workspace, 'node_modules', 'foo', 'index.ts'), 'export const dep = 1;\n');
    writeFileSync(join(workspace, 'dist', 'built.ts'), 'export const built = 1;\n');
    writeFileSync(join(workspace, 'fixtures', 'fx.ts'), 'export const fx = 1;\n');

    const graph = await buildInteractionGraph(workspace);
    expect(graph.has('src/real.ts')).toBe(true);
    expect(graph.has('node_modules/foo/index.ts')).toBe(false);
    expect(graph.has('dist/built.ts')).toBe(false);
    expect(graph.has('fixtures/fx.ts')).toBe(false);
  });

  it('resuelve bare imports (paquete npm) como no-op — solo relative imports se resuelven, bare van a bareImports', async () => {
    writeFileSync(
      join(workspace, 'app.ts'),
      "import react from 'react';\nimport { z } from 'zod';\nexport const app = react;\n",
    );
    const graph = await buildInteractionGraph(workspace);
    const node = graph.get('app.ts');
    expect(node).toBeDefined();
    // Bare imports NO se agregan al imports resolved list (relative-only)
    expect(node?.fileContext.imports).toEqual([]);
    // DG-126 A R1: pero SÍ se capturan como bareImports para prompt informacional
    expect(node?.fileContext.bareImports).toContain('react');
    expect(node?.fileContext.bareImports).toContain('zod');
  });

  // DG-126 A R1 (Cycle 112 FASE I): bare imports como metadata informacional.
  // Cubren npm packages + node builtins + scoped packages.
  it('DG-126 A R1 — captura bare imports mixed (npm + node builtins + scoped)', async () => {
    writeFileSync(
      join(workspace, 'handler.ts'),
      [
        "import express from 'express';",
        "import { readFileSync } from 'node:fs';",
        "import { z } from 'zod';",
        "import type { Finding } from '@synaptic-sentinel/core';",
        'export function handle() { return express(); }',
      ].join('\n') + '\n',
    );
    const graph = await buildInteractionGraph(workspace);
    const node = graph.get('handler.ts');
    expect(node).toBeDefined();
    expect(node?.fileContext.bareImports).toContain('express');
    expect(node?.fileContext.bareImports).toContain('node:fs');
    expect(node?.fileContext.bareImports).toContain('zod');
    expect(node?.fileContext.bareImports).toContain('@synaptic-sentinel/core');
    // Verify sort + dedup (Set semantics)
    const bare = node!.fileContext.bareImports;
    const sorted = [...bare].sort();
    expect(bare).toEqual(sorted);
    expect(new Set(bare).size).toBe(bare.length);
  });

  it('DG-126 A R1 — bareImports vacío cuando el archivo solo tiene relative imports', async () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(
      join(workspace, 'src', 'a.ts'),
      "import { b } from './b';\nexport const a = b;\n",
    );
    writeFileSync(join(workspace, 'src', 'b.ts'), 'export const b = 42;\n');
    const graph = await buildInteractionGraph(workspace);
    const node = graph.get('src/a.ts');
    expect(node).toBeDefined();
    expect(node?.fileContext.imports).toContain('src/b.ts');
    expect(node?.fileContext.bareImports).toEqual([]);
  });

  // DG-126 A R2 (Cycle 112 FASE I): inferRole semantics fix — importedByCount === 1
  // ahora es 'library' (antes fallthrough incorrecto a 'leaf').
  it('DG-126 A R2 — role=library para archivo con importedByCount === 1 (antes bug: leaf)', async () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, 'src', 'util.ts'), 'export const util = () => 1;\n');
    writeFileSync(
      join(workspace, 'src', 'consumer.ts'),
      "import { util } from './util';\nexport const app = util();\n",
    );
    const graph = await buildInteractionGraph(workspace);
    const utilNode = graph.get('src/util.ts');
    expect(utilNode).toBeDefined();
    // Post-R2: importedBy=1 (consumer) → library (antes: leaf por fallthrough)
    expect(utilNode?.fileContext.importedBy.length).toBe(1);
    expect(utilNode?.fileContext.inferredRole).toBe('library');
  });

  it('DG-126 A R2 — role=leaf para archivo con importedByCount === 0 no-entry-filename (antes: entry)', async () => {
    // Archivo standalone que NO es entry filename (no index/main/app/cli)
    // y nadie lo importa. Semantics correcto: leaf (orphan/dead-code candidate).
    writeFileSync(join(workspace, 'orphan.ts'), 'export const dead = 1;\n');
    const graph = await buildInteractionGraph(workspace);
    const node = graph.get('orphan.ts');
    expect(node).toBeDefined();
    // Post-R2: importedBy=0 + no entry filename → leaf
    expect(node?.fileContext.importedBy.length).toBe(0);
    expect(node?.fileContext.inferredRole).toBe('leaf');
  });

  it('DG-126 A R2 — role=entry para index.ts aunque tenga importedByCount === 0 (entry-filename precedence)', async () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, 'src', 'index.ts'), "export * from './internal';\n");
    writeFileSync(join(workspace, 'src', 'internal.ts'), 'export const x = 1;\n');
    const graph = await buildInteractionGraph(workspace);
    const indexNode = graph.get('src/index.ts');
    expect(indexNode).toBeDefined();
    // Nadie importa a index.ts en este mini-workspace, pero es filename entry
    expect(indexNode?.fileContext.importedBy.length).toBe(0);
    expect(indexNode?.fileContext.inferredRole).toBe('entry');
  });

  // DG-123.0.2 (Cycle 111): fix del bug detectado en Baseline-8c (SENTINEL
  // workspace) donde imports de TypeScript ESM con extension `.js` explicito
  // (idioma estandar del ecosistema Node ESM + TS) devolvian null porque el
  // resolver trataba las extensiones como sufijos aditivos en vez de
  // sustitutos. Los 3 tests siguientes fijan la tabla EXTENSION_SUBSTITUTES.

  it('DG-123.0.2 — resuelve `./foo.js` cuando en disco existe `foo.ts` (idioma TS ESM)', async () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(
      join(workspace, 'src', 'consumer.ts'),
      "import { helper } from './helper.js';\nexport const c = helper;\n",
    );
    writeFileSync(join(workspace, 'src', 'helper.ts'), 'export const helper = 1;\n');

    const graph = await buildInteractionGraph(workspace);
    const consumerNode = graph.get('src/consumer.ts');
    expect(consumerNode).toBeDefined();
    // El fix: `./helper.js` en el import se resuelve a `src/helper.ts` en disco.
    expect(consumerNode?.fileContext.imports).toContain('src/helper.ts');

    // Reverse index: helper.ts es importado por consumer.ts.
    const helperNode = graph.get('src/helper.ts');
    expect(helperNode?.fileContext.importedBy).toContain('src/consumer.ts');
    // Cascada: importedByCount = 1 → inferRole podria ser 'entry' (regla <2)
    // o 'library'; NO 'leaf'. Lo importante es que el reverse index NO este
    // vacio (regresion del bug pre-DG-123.0.2).
    expect(helperNode?.fileContext.importedBy.length).toBeGreaterThan(0);
  });

  it('DG-123.0.2 — resuelve `./foo.mjs` cuando en disco existe `foo.mts`', async () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(
      join(workspace, 'src', 'consumer.ts'),
      "import { m } from './mod.mjs';\nexport const c = m;\n",
    );
    writeFileSync(join(workspace, 'src', 'mod.mts'), 'export const m = 1;\n');

    const graph = await buildInteractionGraph(workspace);
    // mod.mts NO esta en SUPPORTED_LANGUAGES (`.mts` no esta soportado en v1),
    // asi que NO tendra su propio nodo en el graph. Pero SI debe aparecer en
    // el imports del consumer si el resolver hizo su trabajo. En v1 solo
    // parseamos .ts/.tsx/.js/.jsx/.mjs/.cjs/.py como nodos — sin embargo el
    // resolver se ejecuta ANTES del filtro de nodos: verifica que el path
    // resuelva, no que el destino sea un nodo.
    const consumerNode = graph.get('src/consumer.ts');
    expect(consumerNode).toBeDefined();
    expect(consumerNode?.fileContext.imports).toContain('src/mod.mts');
  });

  it('DG-123.0.2 — negativo: `./foo.js` sin `foo.js` ni `foo.ts` en disco NO se resuelve', async () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(
      join(workspace, 'src', 'consumer.ts'),
      "import { x } from './nonexistent.js';\nexport const c = x;\n",
    );
    // NO se crea nonexistent.ts ni nonexistent.js.

    const graph = await buildInteractionGraph(workspace);
    const consumerNode = graph.get('src/consumer.ts');
    expect(consumerNode).toBeDefined();
    // Bare + no-fs-match → imports vacio (regresion negativa: el fix NO
    // debe inventar paths inexistentes).
    expect(consumerNode?.fileContext.imports).toEqual([]);
  });
});

describe('buildInteractionGraph — Python fixtures', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'sentinel-graph-py-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('parsea import statements Python + extrae symbols', async () => {
    writeFileSync(
      join(workspace, '__main__.py'),
      [
        'import helper',
        'from utils import util_func',
        '',
        'def main():',
        '    return helper.foo() + util_func()',
        '',
        'class App:',
        '    pass',
        '',
        '_private_thing = 1',
        'public_thing = 2',
      ].join('\n') + '\n',
    );

    const graph = await buildInteractionGraph(workspace);
    const node = graph.get('__main__.py');
    expect(node).toBeDefined();
    expect(node?.fileContext.language).toBe('python');
    // __main__.py is entry
    expect(node?.fileContext.inferredRole).toBe('entry');
    const symbolNames = node!.symbolContext.definedSymbols.map((s) => s.name).sort();
    expect(symbolNames).toContain('main');
    expect(symbolNames).toContain('App');
    expect(symbolNames).toContain('public_thing');
    expect(symbolNames).toContain('_private_thing');
    // Underscore-prefixed no son exportados por convencion
    expect(node?.symbolContext.exportedSymbols).toContain('main');
    expect(node?.symbolContext.exportedSymbols).toContain('App');
    expect(node?.symbolContext.exportedSymbols).toContain('public_thing');
    expect(node?.symbolContext.exportedSymbols).not.toContain('_private_thing');
  });
});

describe('buildInteractionGraph — fallback graceful', () => {
  it('workspace inexistente devuelve Map vacio', async () => {
    const graph = await buildInteractionGraph('/does/not/exist/xyz');
    expect(graph.size).toBe(0);
  });

  it('workspace vacio devuelve Map vacio', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'sentinel-graph-empty-'));
    try {
      const graph = await buildInteractionGraph(workspace);
      expect(graph.size).toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('workspace con solo archivos no-soportados devuelve Map vacio', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'sentinel-graph-only-md-'));
    try {
      writeFileSync(join(workspace, 'README.md'), '# Not code\n');
      writeFileSync(join(workspace, 'go-file.go'), 'package main\n');
      const graph = await buildInteractionGraph(workspace);
      expect(graph.size).toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// DG-127 A (Cycle 113 FASE II) — R18 v2 symbol-level cross-file resolution
// ============================================================================

describe('DG-127 A — extractIdentifiersFromSnippet', () => {
  it('captura identifiers básicos preservando orden de aparición', () => {
    const snippet = 'agentLoop.execute(orchestrationRequest)';
    const ids = extractIdentifiersFromSnippet(snippet);
    expect(ids).toEqual(['agentLoop', 'execute', 'orchestrationRequest']);
  });

  it('filtra JS/TS keywords (const, function, return, etc.)', () => {
    const snippet = 'const result = await agentLoop.execute(req);\nreturn result;';
    const ids = extractIdentifiersFromSnippet(snippet);
    expect(ids).toContain('agentLoop');
    expect(ids).toContain('execute');
    expect(ids).toContain('req');
    expect(ids).toContain('result');
    expect(ids).not.toContain('const');
    expect(ids).not.toContain('await');
    expect(ids).not.toContain('return');
  });

  it('dedupe — cada identifier aparece solo una vez aunque se repita en el snippet', () => {
    const snippet = 'x.foo(x, y, x)';
    const ids = extractIdentifiersFromSnippet(snippet);
    expect(ids).toEqual(['x', 'foo', 'y']);
  });

  it('devuelve array vacío para snippet vacío o solo símbolos', () => {
    expect(extractIdentifiersFromSnippet('')).toEqual([]);
    expect(extractIdentifiersFromSnippet('()[]{};')).toEqual([]);
  });
});

describe('DG-127 A — buildInteractionGraph populates fileContext.importedSymbols + FileSymbol.signature', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'sentinel-graph-dg127-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('captura importedSymbols con local names → fromFile resuelto', async () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(
      join(workspace, 'src', 'consumer.ts'),
      "import { execute, helper } from './services/agent-loop.js';\nimport def from './default-thing.js';\nexport const run = () => execute(helper()) + def();\n",
    );
    mkdirSync(join(workspace, 'src', 'services'), { recursive: true });
    writeFileSync(
      join(workspace, 'src', 'services', 'agent-loop.ts'),
      'export function execute(x) { return x; }\nexport function helper() { return 1; }\n',
    );
    writeFileSync(join(workspace, 'src', 'default-thing.ts'), 'export default function d() {}\n');

    const graph = await buildInteractionGraph(workspace);
    const consumer = graph.get('src/consumer.ts');
    expect(consumer).toBeDefined();
    const imported = consumer!.fileContext.importedSymbols;
    // Named imports: execute + helper mapeados a agent-loop.ts
    expect(imported).toContainEqual({
      name: 'execute',
      fromFile: 'src/services/agent-loop.ts',
    });
    expect(imported).toContainEqual({
      name: 'helper',
      fromFile: 'src/services/agent-loop.ts',
    });
    // Default import: def mapeado a default-thing.ts
    expect(imported).toContainEqual({
      name: 'def',
      fromFile: 'src/default-thing.ts',
    });
  });

  it('captura signature de function/class exports en definedSymbols', async () => {
    writeFileSync(
      join(workspace, 'lib.ts'),
      [
        'export function execute(req: OrchestrationRequest): Promise<Result> {',
        '  return db.query(req);',
        '}',
        'export class AgentLoop {',
        '  private state: State;',
        '}',
        'export const CAP = 100;',
      ].join('\n') + '\n',
    );
    const graph = await buildInteractionGraph(workspace);
    const node = graph.get('lib.ts');
    expect(node).toBeDefined();
    const symbols = node!.symbolContext.definedSymbols;

    const executeFn = symbols.find((s) => s.name === 'execute');
    expect(executeFn).toBeDefined();
    expect(executeFn!.signature).toContain('export function execute(');
    expect(executeFn!.signature).toContain('OrchestrationRequest');
    // Signature termina antes del brace de apertura
    expect(executeFn!.signature).not.toContain('{');

    const classAgent = symbols.find((s) => s.name === 'AgentLoop');
    expect(classAgent).toBeDefined();
    expect(classAgent!.signature).toContain('export class AgentLoop');
    expect(classAgent!.signature).not.toContain('{');

    const constCap = symbols.find((s) => s.name === 'CAP');
    expect(constCap).toBeDefined();
    expect(constCap!.signature).toContain('CAP');
  });
});

describe('DG-127 A — resolveCrossFileSignatures (North Star use case)', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'sentinel-graph-dg127-nstar-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('resuelve signature cross-file para el finding SQL injection (SYNAPTIC_SAAS-like)', async () => {
    // Fixture del North Star case: agent.ts importa execute de agent-loop.ts
    // y llama execute() en el snippet del finding. Post-DG-127 A el LLM ve la
    // signature real desde agent-loop.ts.
    mkdirSync(join(workspace, 'src', 'services'), { recursive: true });
    writeFileSync(
      join(workspace, 'src', 'agent.ts'),
      "import { agentLoop } from './services/agent-loop.js';\nexport function route(req) { return agentLoop.execute(req); }\n",
    );
    writeFileSync(
      join(workspace, 'src', 'services', 'agent-loop.ts'),
      'export class agentLoop {\n  static execute(req) { return db.query(req); }\n}\n',
    );

    const graph = await buildInteractionGraph(workspace);
    const agentNode = graph.get('src/agent.ts');
    expect(agentNode).toBeDefined();

    // El snippet del finding menciona agentLoop.execute — resolver debe
    // devolver la signature de agentLoop (que es lo importado).
    const snippet = 'agentLoop.execute(req)';
    const sigs = resolveCrossFileSignatures(snippet, agentNode!.fileContext.importedSymbols, graph);
    expect(sigs.length).toBeGreaterThan(0);
    const agentLoopSig = sigs.find((s) => s.symbolName === 'agentLoop');
    expect(agentLoopSig).toBeDefined();
    expect(agentLoopSig!.sourceFile).toBe('src/services/agent-loop.ts');
    expect(agentLoopSig!.signature).toContain('export class agentLoop');
  });

  it('cap defensivo — máximo MAX_CROSS_FILE_SIGNATURES_PER_FINDING signatures', async () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(
      join(workspace, 'src', 'consumer.ts'),
      "import { a, b, c, d, e, f } from './many.js';\nexport const use = () => a() + b() + c() + d() + e() + f();\n",
    );
    writeFileSync(
      join(workspace, 'src', 'many.ts'),
      [
        'export function a() {}',
        'export function b() {}',
        'export function c() {}',
        'export function d() {}',
        'export function e() {}',
        'export function f() {}',
      ].join('\n') + '\n',
    );
    const graph = await buildInteractionGraph(workspace);
    const consumer = graph.get('src/consumer.ts');
    const snippet = 'a() + b() + c() + d() + e() + f()';
    const sigs = resolveCrossFileSignatures(snippet, consumer!.fileContext.importedSymbols, graph);
    // Cap defensivo enforcement
    expect(sigs.length).toBeLessThanOrEqual(MAX_CROSS_FILE_SIGNATURES_PER_FINDING);
    expect(sigs.length).toBe(3);
    // Preserva orden de aparición en el snippet
    expect(sigs[0]!.symbolName).toBe('a');
    expect(sigs[1]!.symbolName).toBe('b');
    expect(sigs[2]!.symbolName).toBe('c');
  });

  it('devuelve vacío cuando snippet undefined o no matches con importedSymbols', async () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(
      join(workspace, 'src', 'a.ts'),
      "import { x } from './b.js';\nexport const use = () => x();\n",
    );
    writeFileSync(join(workspace, 'src', 'b.ts'), 'export function x() {}\n');
    const graph = await buildInteractionGraph(workspace);
    const nodeA = graph.get('src/a.ts');

    // snippet undefined
    expect(
      resolveCrossFileSignatures(undefined, nodeA!.fileContext.importedSymbols, graph),
    ).toEqual([]);
    // snippet sin identifiers importados
    expect(
      resolveCrossFileSignatures('const foo = 1;', nodeA!.fileContext.importedSymbols, graph),
    ).toEqual([]);
    // importedSymbols vacío
    expect(resolveCrossFileSignatures('x()', [], graph)).toEqual([]);
  });
});

// ============================================================================
// DG-128 A (Cycle 113 FASE II) — cross-file taint propagation via body scan
// ============================================================================

describe('DG-128 A — detectTaintPatternsInBody', () => {
  it('detecta sql-query-with-interpolation en template literal con ${}', () => {
    const body =
      'function execute(req) { return db.query(`SELECT * FROM x WHERE id = ${req.id}`); }';
    const patterns = detectTaintPatternsInBody(body);
    expect(patterns).toContain('sql-query-with-interpolation');
  });

  it('detecta sql-query-with-concat en string concatenation', () => {
    const body = 'function run(name) { return conn.query("SELECT * FROM u WHERE n = " + name); }';
    const patterns = detectTaintPatternsInBody(body);
    expect(patterns).toContain('sql-query-with-concat');
  });

  it('detecta command-exec-with-concat (spawn/exec con template o +)', () => {
    const body = 'function run(cmd) { return exec(`ls ${cmd}`); }';
    const patterns = detectTaintPatternsInBody(body);
    expect(patterns).toContain('command-exec-with-concat');
  });

  it('detecta code-injection-eval con argumento no-literal', () => {
    const body = 'function danger(x) { return eval(x); }';
    const patterns = detectTaintPatternsInBody(body);
    expect(patterns).toContain('code-injection-eval');
  });

  it('detecta code-injection-new-function con argumento no-literal', () => {
    const body = 'function danger(code) { return new Function(code); }';
    const patterns = detectTaintPatternsInBody(body);
    expect(patterns).toContain('code-injection-new-function');
  });

  it('detecta file-write-with-concat', () => {
    const body = 'function saveFile(name, data) { writeFileSync(`./out/${name}.txt`, data); }';
    const patterns = detectTaintPatternsInBody(body);
    expect(patterns).toContain('file-write-with-concat');
  });

  it('NO false-positive cuando el sink pattern está DENTRO de comment', () => {
    const body =
      '// This is fine because we use eval(safe) somewhere\n' +
      'function safeOnly() {\n' +
      '  return 42; // db.query("SELECT" + name) — used to be dangerous\n' +
      '}\n';
    const patterns = detectTaintPatternsInBody(body);
    // Los patterns dentro de comments deben ser strippeados
    expect(patterns).toEqual([]);
  });

  it('NO false-positive con eval sobre string literal (safe usage)', () => {
    const body = 'function safe() { return eval("2 + 2"); }';
    const patterns = detectTaintPatternsInBody(body);
    // eval("literal") → safe
    expect(patterns).not.toContain('code-injection-eval');
  });

  it('multi-pattern: detecta múltiples labels en un body con varios sinks', () => {
    const body = `
      function chaotic(req) {
        db.query(\`SELECT * FROM x WHERE id = \${req.id}\`);
        eval(req.payload);
        exec(\`echo \${req.msg}\`);
      }
    `;
    const patterns = detectTaintPatternsInBody(body);
    expect(patterns).toContain('sql-query-with-interpolation');
    expect(patterns).toContain('code-injection-eval');
    expect(patterns).toContain('command-exec-with-concat');
  });

  it('TAINT_PATTERN_LABELS export incluye todos los labels usados', () => {
    // Sanity check: los labels retornados por detect deben estar en el
    // constants export para evitar drift.
    const body = `
      db.query(\`SELECT \${x}\`);
      new Function(x);
      writeFileSync(\`\${x}.txt\`, data);
    `;
    const patterns = detectTaintPatternsInBody(body);
    for (const label of patterns) {
      expect(TAINT_PATTERN_LABELS).toContain(label);
    }
  });
});

describe('DG-128 A — buildInteractionGraph populates FileSymbol.bodyTaintPatterns', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'sentinel-graph-dg128-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('populates bodyTaintPatterns en el target function del North Star case', async () => {
    // Fixture del North Star case: agent.ts importa agentLoop de agent-loop.ts.
    // agent-loop.ts contiene la function con SQL sink en el body.
    mkdirSync(join(workspace, 'src', 'services'), { recursive: true });
    writeFileSync(
      join(workspace, 'src', 'agent.ts'),
      "import { agentLoop } from './services/agent-loop.js';\nexport function route(req) { return agentLoop.execute(req); }\n",
    );
    writeFileSync(
      join(workspace, 'src', 'services', 'agent-loop.ts'),
      [
        'export function agentLoop(req) {',
        '  return db.query(`SELECT * FROM x WHERE id = ${req.id}`);',
        '}',
      ].join('\n') + '\n',
    );
    const graph = await buildInteractionGraph(workspace);
    const targetNode = graph.get('src/services/agent-loop.ts');
    expect(targetNode).toBeDefined();
    const agentLoopSymbol = targetNode!.symbolContext.definedSymbols.find(
      (s) => s.name === 'agentLoop',
    );
    expect(agentLoopSymbol).toBeDefined();
    expect(agentLoopSymbol!.bodyTaintPatterns).toContain('sql-query-with-interpolation');
  });

  it('NO populates bodyTaintPatterns cuando body es safe', async () => {
    writeFileSync(join(workspace, 'safe.ts'), 'export function add(a, b) { return a + b; }\n');
    const graph = await buildInteractionGraph(workspace);
    const node = graph.get('safe.ts');
    const addSymbol = node!.symbolContext.definedSymbols.find((s) => s.name === 'add');
    expect(addSymbol).toBeDefined();
    // Con body safe, bodyTaintPatterns debe ser undefined (no emit)
    expect(addSymbol!.bodyTaintPatterns).toBeUndefined();
  });
});

describe('DG-128 A — resolveCrossFileSignatures propagates taintPatterns', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'sentinel-graph-dg128-cross-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('el snippet del North Star SQL injection ahora incluye taintPatterns del target', async () => {
    mkdirSync(join(workspace, 'src', 'services'), { recursive: true });
    writeFileSync(
      join(workspace, 'src', 'agent.ts'),
      "import { agentLoop } from './services/agent-loop.js';\nexport function route(req) { return agentLoop(req); }\n",
    );
    writeFileSync(
      join(workspace, 'src', 'services', 'agent-loop.ts'),
      'export function agentLoop(req) {\n  return db.query(`SELECT * FROM x WHERE id = ${req.id}`);\n}\n',
    );
    const graph = await buildInteractionGraph(workspace);
    const agentNode = graph.get('src/agent.ts');
    const snippet = 'agentLoop(req)';
    const sigs = resolveCrossFileSignatures(snippet, agentNode!.fileContext.importedSymbols, graph);
    expect(sigs.length).toBeGreaterThan(0);
    const agentLoopSig = sigs.find((s) => s.symbolName === 'agentLoop');
    expect(agentLoopSig).toBeDefined();
    expect(agentLoopSig!.taintPatterns).toBeDefined();
    expect(agentLoopSig!.taintPatterns).toContain('sql-query-with-interpolation');
  });

  it('cuando target NO tiene sink patterns, taintPatterns es undefined en el output', async () => {
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(
      join(workspace, 'src', 'consumer.ts'),
      "import { greeter } from './greeter.js';\nexport const use = () => greeter('hola');\n",
    );
    writeFileSync(
      join(workspace, 'src', 'greeter.ts'),
      'export function greeter(name) { return `Hola ${name}`; }\n',
    );
    const graph = await buildInteractionGraph(workspace);
    const consumer = graph.get('src/consumer.ts');
    const sigs = resolveCrossFileSignatures(
      "greeter('hola')",
      consumer!.fileContext.importedSymbols,
      graph,
    );
    const greeterSig = sigs.find((s) => s.symbolName === 'greeter');
    expect(greeterSig).toBeDefined();
    // Sin sink patterns detectados, taintPatterns es undefined (not emitted)
    expect(greeterSig!.taintPatterns).toBeUndefined();
  });
});
