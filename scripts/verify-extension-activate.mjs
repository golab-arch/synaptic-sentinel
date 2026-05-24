#!/usr/bin/env node
/**
 * Headless extension-host simulator (DG-081 B).
 *
 * Carga `packages/vscode-extension/dist/extension.cjs` en un proceso de Node
 * con un mock del modulo `vscode` (instalado vía `Module._resolveFilename`
 * hook), invoca `activate(fakeContext)` y verifica que:
 *
 *   1. El modulo se carga sin lanzar (no hay errores de bundling como
 *      `createRequire(undefined)` o inlined-SDKs con `require()` dinamicos).
 *   2. `activate` esta exportado como funcion.
 *   3. `activate(fakeContext)` completa sin lanzar.
 *   4. Los 7 comandos esperados (`synaptic-sentinel.*`) quedan registrados.
 *   5. `fakeContext.subscriptions.length === 13` — 7 commands + 6 disposables
 *      (diagnostics, statusBar, terminal, webview provider, code actions,
 *      hover provider).
 *
 * Este script es el destilado del headless one-liner que descubrio
 * empiricamente los bugs de v0.3.0 (inlined SDKs) y v0.3.1 (createRequire
 * con import.meta.url undefined en CJS bundle). Despues de DG-079.1 +
 * DG-079.2 + Entry #88 quedo claro que el verify gate del proyecto
 * necesitaba un step que ejerciera el extension host real — los unit
 * tests + `vsce package` no atajan esta clase de bugs.
 *
 * Anti-optimismo ilusorio activo: este script NO sustituye a la
 * validacion humana real en VSCode (instalar el .vsix, abrir un proyecto,
 * ejecutar comandos). Lo que SI garantiza es que `activate()` no lanza
 * silenciosamente al cargar el bundle CJS — la clase de bug que dos veces
 * casi rompe el marketplace publish en una semana. Para gates futuros mas
 * exhaustivos, hay un sub-DG abierto para `@vscode/test-electron`.
 *
 * Salida:
 *   - exit 0 + log "OK" + lista de comandos registrados si todo pasa.
 *   - exit 1 + log "FAIL" + stack trace + diagnostico accionable si algo falla.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Module from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const extensionBundle = resolve(repoRoot, 'packages/vscode-extension/dist/extension.cjs');

// ── 7 comandos esperados (los que index.ts registra via vscode.commands.registerCommand).
const EXPECTED_COMMANDS = [
  'synaptic-sentinel.scanWorkspace',
  'synaptic-sentinel.markFalsePositive',
  'synaptic-sentinel.copyRemediation',
  'synaptic-sentinel.triageWorkspace',
  'synaptic-sentinel.setAnthropicApiKey',
  'synaptic-sentinel.installScanners',
  'synaptic-sentinel.configureProviders',
];

// ── Cantidad total esperada de `context.subscriptions.push(...)`.
// Empirico de DG-079.2: 7 commands + diagnostics + statusBar + terminal +
// webviewView (tomo) + codeActions + hover = 13.
const EXPECTED_SUBSCRIPTIONS_COUNT = 13;

/**
 * Construye un fake del modulo `vscode` con la API minima que `activate()`
 * y los modulos importados (`settings-view`, `tomo-view`, `terminal`,
 * `diagnostics`, etc.) usan. Solo stubs de signatures — los handlers
 * registrados nunca se invocan (no se simula interaccion del usuario).
 */
function buildFakeVscode() {
  return {
    StatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: { Active: 1, Beside: -2 },
    CodeActionKind: { QuickFix: 'quickfix' },
    Uri: {
      file: (p) => ({ fsPath: p, toString: () => `file://${p}` }),
      parse: (s) => ({ fsPath: s, toString: () => s }),
    },
    EventEmitter: class {
      constructor() {
        this.event = () => ({ dispose: () => {} });
      }
      fire() {}
      dispose() {}
    },
    languages: {
      createDiagnosticCollection: () => ({
        clear: () => {},
        delete: () => {},
        set: () => {},
        dispose: () => {},
      }),
      registerCodeActionsProvider: () => ({ dispose: () => {} }),
      registerHoverProvider: () => ({ dispose: () => {} }),
    },
    window: {
      createStatusBarItem: () => ({
        show: () => {},
        hide: () => {},
        dispose: () => {},
        text: '',
        tooltip: '',
        command: '',
      }),
      createWebviewPanel: () => ({
        webview: {
          html: '',
          onDidReceiveMessage: () => ({ dispose: () => {} }),
          postMessage: () => {},
        },
        onDidDispose: () => ({ dispose: () => {} }),
        reveal: () => {},
        dispose: () => {},
      }),
      registerWebviewViewProvider: () => ({ dispose: () => {} }),
      showInformationMessage: () => Promise.resolve(undefined),
      showWarningMessage: () => Promise.resolve(undefined),
      showErrorMessage: () => Promise.resolve(undefined),
      showInputBox: () => Promise.resolve(undefined),
      createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
    },
    commands: {
      registerCommand: (id) => {
        registeredCommands.push(id);
        return { dispose: () => {} };
      },
      executeCommand: () => Promise.resolve(undefined),
    },
    workspace: {
      workspaceFolders: undefined,
      getConfiguration: () => ({ get: () => undefined, update: () => Promise.resolve() }),
      onDidChangeConfiguration: () => ({ dispose: () => {} }),
      openTextDocument: () => Promise.resolve({}),
    },
    Range: class {
      constructor(s, e) {
        this.start = s;
        this.end = e;
      }
    },
    Position: class {
      constructor(l, c) {
        this.line = l;
        this.character = c;
      }
    },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    MarkdownString: class {
      constructor(value) {
        this.value = value || '';
        this.isTrusted = false;
      }
      appendMarkdown(s) {
        this.value += s;
        return this;
      }
      appendCodeblock(s, lang) {
        this.value += `\n\`\`\`${lang || ''}\n${s}\n\`\`\``;
        return this;
      }
    },
  };
}

const registeredCommands = [];

/** Instala el hook que redirige `require('vscode')` al fake. */
function installVscodeMock(fake) {
  const fakeModulePath = resolve(__dirname, '__fake-vscode__');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'vscode') return fakeModulePath;
    return originalResolve.call(this, request, ...rest);
  };
  // Sembrar require.cache con el modulo fake.
  const require_ = createRequire(import.meta.url);
  require_.cache[fakeModulePath] = {
    id: fakeModulePath,
    filename: fakeModulePath,
    loaded: true,
    exports: fake,
  };
}

/** Crea un `ExtensionContext` minimo para pasar a `activate()`. */
function buildFakeContext() {
  return {
    extensionPath: repoRoot,
    extensionUri: { fsPath: repoRoot },
    subscriptions: [],
    secrets: {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      onDidChange: () => ({ dispose: () => {} }),
    },
    globalState: {
      get: () => undefined,
      update: () => Promise.resolve(),
      keys: () => [],
    },
    workspaceState: {
      get: () => undefined,
      update: () => Promise.resolve(),
      keys: () => [],
    },
  };
}

/** Pretty-print de un assertion error con stack para diagnostico. */
function fail(message, cause) {
  console.error(`\n❌ verify-extension-activate FAIL: ${message}`);
  if (cause !== undefined) {
    console.error(cause instanceof Error ? cause.stack || cause.message : String(cause));
  }
  console.error(
    '\nClase de bug que este gate cubre: bundling de deps con require() dinamicos\n' +
      'o import.meta.url undefined en CJS target. Ver DG-079.1 + DG-079.2 en BITACORA.md.\n',
  );
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────
// Main flow
// ────────────────────────────────────────────────────────────────────
console.log('verify-extension-activate: loading bundle ...');
console.log(`  ${extensionBundle}`);

const fake = buildFakeVscode();
installVscodeMock(fake);

const requireCjs = createRequire(import.meta.url);
let ext;
try {
  ext = requireCjs(extensionBundle);
} catch (err) {
  fail(
    'extension.cjs failed to LOAD (require threw) — typical sign of an inlined SDK with dynamic require() or createRequire(undefined). Run "pnpm -F synaptic-sentinel bundle" and inspect dist/extension.cjs around the line in the stack.',
    err,
  );
}

if (typeof ext?.activate !== 'function') {
  fail(
    `extension.cjs loaded but did not export an "activate" function. Got: ${typeof ext?.activate}`,
  );
}

const ctx = buildFakeContext();
console.log('verify-extension-activate: invoking activate(fakeContext) ...');
try {
  ext.activate(ctx);
} catch (err) {
  fail(
    'activate() threw an exception. This would prevent VSCode from registering any extension command.',
    err,
  );
}

// ── Assertions ───────────────────────────────────────────────────────
const missing = EXPECTED_COMMANDS.filter((cmd) => !registeredCommands.includes(cmd));
if (missing.length > 0) {
  fail(
    `activate() completed but ${missing.length} expected command(s) were not registered:\n  - ${missing.join('\n  - ')}\n\nRegistered (${registeredCommands.length}):\n  - ${registeredCommands.join('\n  - ')}`,
  );
}

if (ctx.subscriptions.length !== EXPECTED_SUBSCRIPTIONS_COUNT) {
  fail(
    `activate() registered ${ctx.subscriptions.length} subscriptions, expected ${EXPECTED_SUBSCRIPTIONS_COUNT}. ` +
      `If the extension intentionally added/removed disposables, update EXPECTED_SUBSCRIPTIONS_COUNT in scripts/verify-extension-activate.mjs.`,
  );
}

console.log(`\n✅ verify-extension-activate OK`);
console.log(`   - ${registeredCommands.length} commands registered:`);
for (const c of registeredCommands) console.log(`       ${c}`);
console.log(`   - ${ctx.subscriptions.length} subscriptions wired`);
console.log(`   - activate() completed without throwing`);
console.log(
  `\nGate covers: extension activation in CJS bundle (catches the class of bug ` +
    `that produced DG-079.1 and DG-079.2 hotfixes).`,
);
process.exit(0);
