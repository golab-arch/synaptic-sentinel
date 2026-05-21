import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  PheromoneSchema,
  ScanSchema,
  type Pheromone,
  type PheromoneType,
  type Scan,
} from '../types/index.js';

/**
 * Ruta al schema SQL. La expresion resuelve igual desde el codigo fuente
 * (src/) y desde el build (dist/): en ambos casos `../../src/colony/...`
 * apunta a la raiz del paquete + src/colony/schema.sql.
 */
const SCHEMA_PATH = fileURLToPath(new URL('../../src/colony/schema.sql', import.meta.url));

/** Convierte una fila de la tabla `scans` en un objeto `Scan` validado. */
function rowToScan(row: unknown): Scan {
  const r = row as Record<string, unknown>;
  return ScanSchema.parse({
    id: r['id'],
    startedAt: r['started_at'],
    finishedAt: r['finished_at'] ?? undefined,
    gitSha: r['git_sha'] ?? undefined,
    agentSummary:
      r['agent_summary'] != null ? JSON.parse(String(r['agent_summary'])) : undefined,
  });
}

/** Convierte una fila de la tabla `pheromones` en un objeto `Pheromone` validado. */
function rowToPheromone(row: unknown): Pheromone {
  const r = row as Record<string, unknown>;
  return PheromoneSchema.parse({
    id: r['id'],
    type: r['type'],
    agentId: r['agent_id'],
    scanId: r['scan_id'],
    targetPath: r['target_path'] ?? undefined,
    payload: JSON.parse(String(r['payload'])),
    confidence: r['confidence'] ?? undefined,
    decayRate: r['decay_rate'],
    createdAt: r['created_at'],
    expiresAt: r['expires_at'] ?? undefined,
  });
}

/**
 * Memoria compartida del enjambre — wrapper de la colony DB (SQLite local).
 *
 * Usa `node:sqlite`, el modulo SQLite integrado de Node (sin dependencias
 * nativas; DG-013 A). Toda la persistencia pasa por esta clase para poder
 * cambiar de driver sin tocar el resto del sistema (ver DESIGN_DOC, Mejoras
 * Futuras FI-001).
 *
 * Las escrituras validan su entrada con los schemas `zod` antes de tocar la
 * base de datos: defensa en profundidad contra Memory Poisoning (v0.4 §9.6).
 */
export class ColonyDb {
  readonly #db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /**
   * Abre (o crea) la colony DB en `path` y aplica el schema de forma
   * idempotente. Usar `:memory:` para una base efimera en tests.
   */
  static open(path: string): ColonyDb {
    const db = new DatabaseSync(path);
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    return new ColonyDb(db);
  }

  /** Version del schema registrada en la tabla `meta`. */
  getSchemaVersion(): string | undefined {
    const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
    return row ? String((row as { value: unknown }).value) : undefined;
  }

  /** Inserta un nuevo scan. */
  insertScan(scan: Scan): void {
    const valid = ScanSchema.parse(scan);
    this.#db
      .prepare(
        'INSERT INTO scans (id, started_at, finished_at, git_sha, agent_summary) ' +
          'VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        valid.id,
        valid.startedAt,
        valid.finishedAt ?? null,
        valid.gitSha ?? null,
        valid.agentSummary != null ? JSON.stringify(valid.agentSummary) : null,
      );
  }

  /** Marca un scan como finalizado y guarda su resumen por agente. */
  completeScan(id: string, finishedAt: string, agentSummary?: Record<string, unknown>): void {
    this.#db
      .prepare('UPDATE scans SET finished_at = ?, agent_summary = ? WHERE id = ?')
      .run(finishedAt, agentSummary != null ? JSON.stringify(agentSummary) : null, id);
  }

  /** Devuelve un scan por id, o `undefined` si no existe. */
  getScan(id: string): Scan | undefined {
    const row = this.#db.prepare('SELECT * FROM scans WHERE id = ?').get(id);
    return row ? rowToScan(row) : undefined;
  }

  /** Inserta una feromona. Valida la entrada contra `PheromoneSchema`. */
  insertPheromone(pheromone: Pheromone): void {
    this.insertPheromones([pheromone]);
  }

  /** Inserta un lote de feromonas dentro de una unica transaccion. */
  insertPheromones(pheromones: readonly Pheromone[]): void {
    if (pheromones.length === 0) return;
    const stmt = this.#db.prepare(
      'INSERT INTO pheromones ' +
        '(id, type, agent_id, scan_id, target_path, payload, confidence, decay_rate, created_at, expires_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.#db.exec('BEGIN');
    try {
      for (const raw of pheromones) {
        const p = PheromoneSchema.parse(raw);
        stmt.run(
          p.id,
          p.type,
          p.agentId,
          p.scanId,
          p.targetPath ?? null,
          JSON.stringify(p.payload),
          p.confidence ?? null,
          p.decayRate,
          p.createdAt,
          p.expiresAt ?? null,
        );
      }
      this.#db.exec('COMMIT');
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Feromonas de un scan, ordenadas por fecha de creacion. */
  getPheromonesByScan(scanId: string): Pheromone[] {
    return this.#db
      .prepare('SELECT * FROM pheromones WHERE scan_id = ? ORDER BY created_at')
      .all(scanId)
      .map(rowToPheromone);
  }

  /**
   * Devuelve el conjunto de `fingerprint` presentes en las feromonas de `type`.
   *
   * Lee `payload.fingerprint` con `json_extract`. Habilita la deduplicacion
   * entre scans del Coordinator (stage 2): el tipo `finding` da los hallazgos
   * ya vistos en scans anteriores; `fp_known`, los falsos positivos
   * confirmados. Una feromona sin `fingerprint` en su payload se ignora.
   */
  getKnownFingerprints(type: PheromoneType): Set<string> {
    const rows = this.#db
      .prepare(
        "SELECT DISTINCT json_extract(payload, '$.fingerprint') AS fingerprint " +
          'FROM pheromones WHERE type = ?',
      )
      .all(type);
    const fingerprints = new Set<string>();
    for (const row of rows) {
      const value = (row as { fingerprint: unknown }).fingerprint;
      if (typeof value === 'string' && value.length > 0) fingerprints.add(value);
    }
    return fingerprints;
  }

  /** Feromonas asociadas a un archivo, opcionalmente filtradas por tipo. */
  getPheromonesByTarget(targetPath: string, type?: PheromoneType): Pheromone[] {
    const rows =
      type === undefined
        ? this.#db.prepare('SELECT * FROM pheromones WHERE target_path = ?').all(targetPath)
        : this.#db
            .prepare('SELECT * FROM pheromones WHERE target_path = ? AND type = ?')
            .all(targetPath, type);
    return rows.map(rowToPheromone);
  }

  /** Cierra la conexion con la base de datos. */
  close(): void {
    this.#db.close();
  }
}
