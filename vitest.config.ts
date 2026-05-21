import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Resuelve un workspace `@synaptic-sentinel/<name>` a su codigo fuente. */
const workspaceSrc = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

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
    include: [
      'packages/*/tests/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts', 'scripts/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
