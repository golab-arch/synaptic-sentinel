import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

/** Resuelve un workspace `@synaptic-sentinel/<name>` a su codigo fuente. */
const workspaceSrc = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/** Globs de todos los archivos de test del monorepo. */
const ALL_TESTS = ['packages/*/tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'];

/**
 * Tests de integracion: requieren binarios de scanners, red o la CLI
 * construida. Son lentos y dominan el tiempo de la suite (FI-002), por eso
 * viven en un proyecto Vitest aparte ('integration') que NO corre en el gate
 * por ciclo (`verify` -> `test:unit`). Se identifican por el sufijo
 * `*integration.test.ts` y se invocan con `pnpm test:integration`.
 */
const INTEGRATION_GLOB = 'packages/*/tests/**/*integration.test.ts';

export default defineConfig({
  resolve: {
    // Los tests resuelven los paquetes internos a su fuente, sin requerir build previo.
    alias: {
      '@synaptic-sentinel/core': workspaceSrc('core'),
      '@synaptic-sentinel/scouts': workspaceSrc('scouts'),
      '@synaptic-sentinel/reporters': workspaceSrc('reporters'),
      '@synaptic-sentinel/shared': workspaceSrc('shared'),
      '@synaptic-sentinel/agents': workspaceSrc('agents'),
    },
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
    // Dos proyectos: `vitest run` (sin filtro) corre ambos; `--project unit`
    // o `--project integration` selecciona uno. El gate por ciclo usa 'unit'.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ALL_TESTS,
          exclude: [...configDefaults.exclude, INTEGRATION_GLOB],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: [INTEGRATION_GLOB],
        },
      },
    ],
  },
});
