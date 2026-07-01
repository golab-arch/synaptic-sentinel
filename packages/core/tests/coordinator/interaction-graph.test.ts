import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  buildInteractionGraph,
  detectLanguage,
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

  it('resuelve bare imports (paquete npm) como no-op — solo relative imports se resuelven', async () => {
    writeFileSync(
      join(workspace, 'app.ts'),
      "import react from 'react';\nimport { z } from 'zod';\nexport const app = react;\n",
    );
    const graph = await buildInteractionGraph(workspace);
    const node = graph.get('app.ts');
    expect(node).toBeDefined();
    // Bare imports NO se agregan al imports resolved list
    expect(node?.fileContext.imports).toEqual([]);
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
