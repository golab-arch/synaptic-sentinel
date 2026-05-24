// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '.scanners/**',
      '.synaptic/**',
      'context/**',
      // Fixtures deliberadamente vulnerables: no se lintean.
      '**/tests/**/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // scripts/ (Node ESM standalone): habilitar globals Node (console, process,
  // Buffer, ...) que ESLint 9 flat config no infiere de tipo .mjs.
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
  prettier,
);
