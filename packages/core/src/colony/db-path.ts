import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolución del path donde vive `colony.db` para un proyecto dado
 * (DG-093 A: unificación de naming).
 *
 * Historia del naming:
 *   - Hasta v0.3.5 la CLI escribía `colony.db` en `<projectRoot>/.synaptic-sentinel/`.
 *   - DG-073 B (Cycle 66) introdujo `<projectRoot>/.sentinel/agents.yaml` con
 *     un naming distinto al directorio de `colony.db`. Esa inconsistencia
 *     UX la reportó el usuario en DG-092 A.
 *   - DG-093 A unifica a `<projectRoot>/.sentinel/` para todos los artefactos
 *     workspace-level (db + agents.yaml). El cache global PER-USER
 *     `~/.synaptic-sentinel/scanners/` queda intacto (decisión user-side).
 *
 * Backward-compat (también decisión user-side en DG-093 A):
 *   "Dual-read sin migrar archivo" — preserva data existente de v0.3.x,
 *   cero riesgo de data loss. El usuario decide cuándo mover el archivo
 *   manualmente. La CLI emite un log informativo cuando usa el legacy.
 */

/** Directorio nuevo (DG-093 A): mismo namespace que `.sentinel/agents.yaml`. */
export const COLONY_DB_DIRNAME = '.sentinel';

/** Directorio legacy (pre-DG-093 A). Soportado en lectura, no en escritura nueva. */
export const COLONY_DB_DIRNAME_LEGACY = '.synaptic-sentinel';

/** Nombre del archivo en ambos directorios. */
export const COLONY_DB_FILENAME = 'colony.db';

/** Resultado de resolver el path de `colony.db` para un workspace. */
export interface ColonyDbPathResolution {
  /** Path absoluto al `colony.db` que debe abrirse. */
  readonly path: string;
  /** Directorio que contiene al `colony.db` (para `mkdirSync(...,{recursive:true})`). */
  readonly dir: string;
  /**
   * `true` si se está abriendo el legacy `.synaptic-sentinel/colony.db`
   * (presente en workspaces preexistentes de v0.3.x). El caller debería
   * emitir un log informativo sugiriéndole al usuario mover el archivo
   * a `.sentinel/` cuando le quede cómodo — pero la CLI no lo mueve
   * automáticamente (preserva data y cero riesgo de migración corrupta).
   */
  readonly isLegacy: boolean;
}

/**
 * Resuelve el path de `colony.db` para `projectRoot` con la siguiente preferencia:
 *
 *   1. Si `<projectRoot>/.sentinel/colony.db` existe → se usa (`isLegacy: false`).
 *   2. Si SOLO `<projectRoot>/.synaptic-sentinel/colony.db` existe → se usa el
 *      legacy (`isLegacy: true`). El caller emite el log informativo.
 *   3. Ninguno existe (workspace nuevo) → defaulteamos al nuevo path
 *      `.sentinel/colony.db` (`isLegacy: false`).
 *
 * Defensiva contra el caso raro de que AMBOS paths existan: gana el nuevo
 * (`.sentinel/colony.db`). El legacy queda sin leer — el usuario debe
 * consolidar manualmente (caso anómalo: cero riesgo de data loss porque
 * los dos archivos son independientes).
 */
export function resolveColonyDbPath(projectRoot: string): ColonyDbPathResolution {
  const newDir = join(projectRoot, COLONY_DB_DIRNAME);
  const newPath = join(newDir, COLONY_DB_FILENAME);
  if (existsSync(newPath)) {
    return { path: newPath, dir: newDir, isLegacy: false };
  }
  const legacyDir = join(projectRoot, COLONY_DB_DIRNAME_LEGACY);
  const legacyPath = join(legacyDir, COLONY_DB_FILENAME);
  if (existsSync(legacyPath)) {
    return { path: legacyPath, dir: legacyDir, isLegacy: true };
  }
  return { path: newPath, dir: newDir, isLegacy: false };
}
