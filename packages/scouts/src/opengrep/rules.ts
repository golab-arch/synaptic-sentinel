import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Ruta absoluta al ruleset baseline de OpenGrep que usa el OpenGrepScout.
 *
 * En ejecucion normal (build `tsc`) `../../src/opengrep/rules/...` resuelve
 * desde `dist/opengrep/` a la raiz del paquete + `src/...`.
 *
 * Cuando la CLI se bundlea dentro de la extension VSCode (FI-008) ese path
 * deja de existir: el script de copia post-bundle deja el YAML junto al
 * `cli.mjs`, asi que caemos al fallback `./sentinel-baseline.yaml`.
 */
function resolveBaselineRuleset(): string {
  const canonical = fileURLToPath(
    new URL('../../src/opengrep/rules/sentinel-baseline.yaml', import.meta.url),
  );
  if (existsSync(canonical)) return canonical;
  return fileURLToPath(new URL('./sentinel-baseline.yaml', import.meta.url));
}

export const BASELINE_RULESET_PATH = resolveBaselineRuleset();
