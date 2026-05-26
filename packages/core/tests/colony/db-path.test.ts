import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  COLONY_DB_DIRNAME,
  COLONY_DB_DIRNAME_LEGACY,
  COLONY_DB_FILENAME,
  resolveColonyDbPath,
} from '../../src/colony/db-path.js';

/** Crea un directorio temporal único y devuelve su path absoluto. */
function mkTempProject(): string {
  const projectRoot = join(tmpdir(), 'sentinel-dbpath-' + randomUUID());
  mkdirSync(projectRoot, { recursive: true });
  return projectRoot;
}

/** Crea un archivo vacío en `<projectRoot>/<dirname>/colony.db`. */
function touchDb(projectRoot: string, dirname: string): void {
  const dir = join(projectRoot, dirname);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, COLONY_DB_FILENAME), '');
}

describe('resolveColonyDbPath (DG-093 A)', () => {
  const cleanups: string[] = [];
  afterEach(() => {
    while (cleanups.length > 0) {
      const root = cleanups.pop();
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });

  it('cuando solo existe .sentinel/colony.db → lo usa, isLegacy=false', () => {
    const root = mkTempProject();
    cleanups.push(root);
    touchDb(root, COLONY_DB_DIRNAME);

    const res = resolveColonyDbPath(root);
    expect(res.path).toBe(join(root, COLONY_DB_DIRNAME, COLONY_DB_FILENAME));
    expect(res.dir).toBe(join(root, COLONY_DB_DIRNAME));
    expect(res.isLegacy).toBe(false);
  });

  it('cuando solo existe .synaptic-sentinel/colony.db legacy → lo usa, isLegacy=true', () => {
    const root = mkTempProject();
    cleanups.push(root);
    touchDb(root, COLONY_DB_DIRNAME_LEGACY);

    const res = resolveColonyDbPath(root);
    expect(res.path).toBe(join(root, COLONY_DB_DIRNAME_LEGACY, COLONY_DB_FILENAME));
    expect(res.dir).toBe(join(root, COLONY_DB_DIRNAME_LEGACY));
    expect(res.isLegacy).toBe(true);
  });

  it('cuando NINGUNO existe (workspace nuevo) → defaultea a .sentinel/, isLegacy=false', () => {
    const root = mkTempProject();
    cleanups.push(root);
    // No tocamos ningún colony.db.

    const res = resolveColonyDbPath(root);
    expect(res.path).toBe(join(root, COLONY_DB_DIRNAME, COLONY_DB_FILENAME));
    expect(res.dir).toBe(join(root, COLONY_DB_DIRNAME));
    expect(res.isLegacy).toBe(false);
  });

  it('cuando AMBOS existen (caso anómalo) → gana el nuevo .sentinel/, isLegacy=false', () => {
    // Caso defensivo: si por alguna razón un workspace tiene los dos paths
    // (ej. usuario manualmente copió archivos), preferimos el nuevo path
    // para que el comportamiento sea predecible y consistente con "nuevo
    // path tiene precedencia". El legacy queda sin leer — el usuario
    // consolida manualmente.
    const root = mkTempProject();
    cleanups.push(root);
    touchDb(root, COLONY_DB_DIRNAME);
    touchDb(root, COLONY_DB_DIRNAME_LEGACY);

    const res = resolveColonyDbPath(root);
    expect(res.path).toBe(join(root, COLONY_DB_DIRNAME, COLONY_DB_FILENAME));
    expect(res.isLegacy).toBe(false);
  });

  it('exports constants para que callers + tests no hardcodeen strings', () => {
    // Anti-regression: asegurar que los nombres exportados coincidan con
    // los paths reales usados por las versiones publicadas.
    expect(COLONY_DB_DIRNAME).toBe('.sentinel');
    expect(COLONY_DB_DIRNAME_LEGACY).toBe('.synaptic-sentinel');
    expect(COLONY_DB_FILENAME).toBe('colony.db');
  });
});
