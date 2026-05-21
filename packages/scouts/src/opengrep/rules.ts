import { fileURLToPath } from 'node:url';

/**
 * Ruta absoluta al ruleset baseline de OpenGrep que se empaqueta con
 * `@synaptic-sentinel/scouts`. La expresion resuelve igual desde `src/` y
 * desde `dist/`: `../../src/opengrep/rules/...` apunta a la raiz del paquete
 * + el archivo de reglas (incluido en `files` de package.json).
 */
export const BASELINE_RULESET_PATH = fileURLToPath(
  new URL('../../src/opengrep/rules/sentinel-baseline.yaml', import.meta.url),
);
