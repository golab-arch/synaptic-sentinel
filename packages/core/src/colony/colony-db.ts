import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// node-sqlite3-wasm es CJS. Bajo Node ESM, `import * as ... from` puede no
// extraer los named exports si cjs-module-lexer no los detecta (verificado
// en el bundle: `sqliteWasm.Database` quedaba undefined). Usamos createRequire
// para forzar resolucion CJS limpia, y un type-only import para las firmas.
import type * as sqliteWasmTypes from 'node-sqlite3-wasm';
const requireCjs = createRequire(import.meta.url);
const sqliteWasm = requireCjs('node-sqlite3-wasm') as typeof sqliteWasmTypes;
type Database = InstanceType<typeof sqliteWasm.Database>;
type Statement = ReturnType<Database['prepare']>;
import {
  ContextExplanationRecordSchema,
  LearningRecordSchema,
  PheromoneSchema,
  RemediationSuggestionRecordSchema,
  ScanSchema,
  TriageVerdictRecordSchema,
  type ContextExplanationRecord,
  type LearningClassification,
  type LearningRecord,
  type Pheromone,
  type PheromoneType,
  type RemediationSuggestionRecord,
  type Scan,
  type TriageVerdictRecord,
} from '../types/index.js';

/**
 * Ruta al schema SQL.
 *
 * En ejecucion normal `../../src/colony/...` resuelve igual desde el codigo
 * fuente (src/) y desde el build (dist/): apunta a la raiz del paquete +
 * src/colony/schema.sql.
 *
 * Cuando la CLI se bundlea dentro de la extension VSCode (FI-008) ese path
 * deja de existir: el script de copia post-bundle deja el `.sql` junto al
 * `cli.mjs`, asi que caemos al fallback `./schema.sql`.
 */
function resolveSchemaPath(): string {
  const canonical = fileURLToPath(new URL('../../src/colony/schema.sql', import.meta.url));
  if (existsSync(canonical)) return canonical;
  return fileURLToPath(new URL('./schema.sql', import.meta.url));
}

const SCHEMA_PATH = resolveSchemaPath();

/**
 * Helper: prepara un statement, lo usa, y lo finaliza en `finally`.
 *
 * `node-sqlite3-wasm` NO finaliza statements automaticamente al cerrar la DB
 * (a diferencia de node:sqlite/better-sqlite3): hay que llamar `.finalize()`
 * explicitamente o el handle queda colgando en el WASM heap y el siguiente
 * `Database.open` sobre el mismo archivo falla con "database is locked".
 * Este helper centraliza el patron try/finally para los inserts en lote
 * (donde reusamos un mismo statement preparado en un loop).
 */
function withStmt<T>(db: Database, sql: string, fn: (stmt: Statement) => T): T {
  const stmt = db.prepare(sql);
  try {
    return fn(stmt);
  } finally {
    stmt.finalize();
  }
}

/** Convierte una fila de la tabla `scans` en un objeto `Scan` validado. */
function rowToScan(row: unknown): Scan {
  const r = row as Record<string, unknown>;
  return ScanSchema.parse({
    id: r['id'],
    startedAt: r['started_at'],
    finishedAt: r['finished_at'] ?? undefined,
    gitSha: r['git_sha'] ?? undefined,
    agentSummary: r['agent_summary'] != null ? JSON.parse(String(r['agent_summary'])) : undefined,
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

/** Convierte una fila de `triage_verdicts` en un `TriageVerdictRecord` validado. */
function rowToTriageVerdict(row: unknown): TriageVerdictRecord {
  const r = row as Record<string, unknown>;
  return TriageVerdictRecordSchema.parse({
    id: r['id'],
    scanId: r['scan_id'],
    fingerprint: r['fingerprint'],
    classification: r['classification'],
    confidence: r['confidence'],
    rationale: r['rationale'],
    agentId: r['agent_id'],
    createdAt: r['created_at'],
  });
}

/** Convierte una fila de `context_explanations` en un registro validado. */
function rowToContextExplanation(row: unknown): ContextExplanationRecord {
  const r = row as Record<string, unknown>;
  return ContextExplanationRecordSchema.parse({
    id: r['id'],
    scanId: r['scan_id'],
    fingerprint: r['fingerprint'],
    summary: r['summary'],
    entryPoint: r['entry_point'],
    sink: r['sink'],
    exposure: r['exposure'],
    agentId: r['agent_id'],
    createdAt: r['created_at'],
  });
}

/** Convierte una fila de `learning_records` en un registro validado. */
function rowToLearningRecord(row: unknown): LearningRecord {
  const r = row as Record<string, unknown>;
  return LearningRecordSchema.parse({
    id: r['id'],
    patternSignature: r['pattern_signature'],
    classification: r['classification'],
    evidenceCount: r['evidence_count'],
    lastSeenScan: r['last_seen_scan'],
  });
}

/** Convierte una fila de `remediation_suggestions` en un registro validado. */
function rowToRemediationSuggestion(row: unknown): RemediationSuggestionRecord {
  const r = row as Record<string, unknown>;
  return RemediationSuggestionRecordSchema.parse({
    id: r['id'],
    scanId: r['scan_id'],
    fingerprint: r['fingerprint'],
    summary: r['summary'],
    recommendation: r['recommendation'],
    fixedSnippet: r['fixed_snippet'] ?? undefined,
    agentId: r['agent_id'],
    createdAt: r['created_at'],
  });
}

/**
 * Memoria compartida del enjambre — wrapper de la colony DB (SQLite local).
 *
 * Usa `node-sqlite3-wasm` (DG-062 B, FI-001 *re*-cerrado): port WASM puro de
 * SQLite3. La opcion previa fue `better-sqlite3` (DG-060 B), pero la prueba
 * del usuario en el .vsix revelo el problema clasico de ABI con Electron
 * (NODE_MODULE_VERSION mismatch). WASM no tiene ABI -> el .vsix corre en
 * cualquier runtime Node-compatible. Toda la persistencia pasa por esta
 * clase para poder cambiar de driver sin tocar el resto del sistema.
 *
 * API notes (diferencias importantes vs los drivers previos):
 *  - Binds: un solo argumento ARRAY (o objeto nombrado), no spread positional.
 *  - Statements: `prepare()` requiere `finalize()` EXPLICITO (no hay GC
 *    automatica). Para evitar leaks y "database is locked" en reopens, los
 *    one-shots usan `db.run/get/all` (que finalizan internamente) y los
 *    batches reusan un stmt envuelto en {@link withStmt}.
 *
 * Las escrituras validan su entrada con los schemas `zod` antes de tocar la
 * base de datos: defensa en profundidad contra Memory Poisoning (v0.4 §9.6).
 */
export class ColonyDb {
  readonly #db: Database;

  private constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Abre (o crea) la colony DB en `path` y aplica el schema de forma
   * idempotente. Usar `:memory:` para una base efimera en tests.
   */
  static open(path: string): ColonyDb {
    const db = new sqliteWasm.Database(path);
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    // Migraciones aditivas (v2: triage_verdicts, v3: context_explanations,
    // v4: remediation_suggestions): las tablas se crean via CREATE TABLE IF
    // NOT EXISTS en el schema, sin reconstruir nada; aqui se sincroniza la
    // version de una base preexistente.
    db.exec("UPDATE meta SET value = '4' WHERE key = 'schema_version'");
    return new ColonyDb(db);
  }

  /** Version del schema registrada en la tabla `meta`. */
  getSchemaVersion(): string | undefined {
    const row = this.#db.get('SELECT value FROM meta WHERE key = ?', ['schema_version']);
    return row ? String((row as { value: unknown }).value) : undefined;
  }

  /** Inserta un nuevo scan. */
  insertScan(scan: Scan): void {
    const valid = ScanSchema.parse(scan);
    this.#db.run(
      'INSERT INTO scans (id, started_at, finished_at, git_sha, agent_summary) ' +
        'VALUES (?, ?, ?, ?, ?)',
      [
        valid.id,
        valid.startedAt,
        valid.finishedAt ?? null,
        valid.gitSha ?? null,
        valid.agentSummary != null ? JSON.stringify(valid.agentSummary) : null,
      ],
    );
  }

  /** Marca un scan como finalizado y guarda su resumen por agente. */
  completeScan(id: string, finishedAt: string, agentSummary?: Record<string, unknown>): void {
    this.#db.run('UPDATE scans SET finished_at = ?, agent_summary = ? WHERE id = ?', [
      finishedAt,
      agentSummary != null ? JSON.stringify(agentSummary) : null,
      id,
    ]);
  }

  /** Devuelve un scan por id, o `undefined` si no existe. */
  getScan(id: string): Scan | undefined {
    const row = this.#db.get('SELECT * FROM scans WHERE id = ?', [id]);
    return row ? rowToScan(row) : undefined;
  }

  /** Inserta una feromona. Valida la entrada contra `PheromoneSchema`. */
  insertPheromone(pheromone: Pheromone): void {
    this.insertPheromones([pheromone]);
  }

  /** Inserta un lote de feromonas dentro de una unica transaccion. */
  insertPheromones(pheromones: readonly Pheromone[]): void {
    if (pheromones.length === 0) return;
    withStmt(
      this.#db,
      'INSERT INTO pheromones ' +
        '(id, type, agent_id, scan_id, target_path, payload, confidence, decay_rate, created_at, expires_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      (stmt) => {
        this.#db.exec('BEGIN');
        try {
          for (const raw of pheromones) {
            const p = PheromoneSchema.parse(raw);
            stmt.run([
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
            ]);
          }
          this.#db.exec('COMMIT');
        } catch (err) {
          this.#db.exec('ROLLBACK');
          throw err;
        }
      },
    );
  }

  /** Feromonas de un scan, ordenadas por fecha de creacion. */
  getPheromonesByScan(scanId: string): Pheromone[] {
    return this.#db
      .all('SELECT * FROM pheromones WHERE scan_id = ? ORDER BY created_at', [scanId])
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
    const rows = this.#db.all(
      "SELECT DISTINCT json_extract(payload, '$.fingerprint') AS fingerprint " +
        'FROM pheromones WHERE type = ?',
      [type],
    );
    const fingerprints = new Set<string>();
    for (const row of rows) {
      const value = (row as { fingerprint: unknown }).fingerprint;
      if (typeof value === 'string' && value.length > 0) fingerprints.add(value);
    }
    return fingerprints;
  }

  /**
   * Feromonas cuyo `payload.fingerprint` coincide con `fingerprint`,
   * cualquiera sea su tipo. Habilita marcar y consultar falsos positivos
   * por hallazgo (comando `mark-fp`).
   */
  getPheromonesByFingerprint(fingerprint: string): Pheromone[] {
    return this.#db
      .all("SELECT * FROM pheromones WHERE json_extract(payload, '$.fingerprint') = ?", [
        fingerprint,
      ])
      .map(rowToPheromone);
  }

  /** Feromonas asociadas a un archivo, opcionalmente filtradas por tipo. */
  getPheromonesByTarget(targetPath: string, type?: PheromoneType): Pheromone[] {
    const rows =
      type === undefined
        ? this.#db.all('SELECT * FROM pheromones WHERE target_path = ?', [targetPath])
        : this.#db.all('SELECT * FROM pheromones WHERE target_path = ? AND type = ?', [
            targetPath,
            type,
          ]);
    return rows.map(rowToPheromone);
  }

  /** Id del scan mas reciente, o `undefined` si no hay ninguno. */
  getLatestScanId(): string | undefined {
    const row = this.#db.get('SELECT id FROM scans ORDER BY started_at DESC LIMIT 1');
    return row ? String((row as { id: unknown }).id) : undefined;
  }

  /** Inserta un lote de veredictos de triage en una unica transaccion. */
  insertTriageVerdicts(records: readonly TriageVerdictRecord[]): void {
    if (records.length === 0) return;
    withStmt(
      this.#db,
      'INSERT INTO triage_verdicts ' +
        '(id, scan_id, fingerprint, classification, confidence, rationale, agent_id, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      (stmt) => {
        this.#db.exec('BEGIN');
        try {
          for (const raw of records) {
            const r = TriageVerdictRecordSchema.parse(raw);
            stmt.run([
              r.id,
              r.scanId,
              r.fingerprint,
              r.classification,
              r.confidence,
              r.rationale,
              r.agentId,
              r.createdAt,
            ]);
          }
          this.#db.exec('COMMIT');
        } catch (err) {
          this.#db.exec('ROLLBACK');
          throw err;
        }
      },
    );
  }

  /**
   * Fingerprints de los hallazgos que ya tienen un veredicto de triage.
   *
   * Habilita la economia de tokens (v0.4 §187): el comando `triage` no
   * vuelve a gastar tokens en hallazgos ya triados.
   */
  getTriagedFingerprints(): Set<string> {
    const rows = this.#db.all('SELECT DISTINCT fingerprint FROM triage_verdicts');
    const fingerprints = new Set<string>();
    for (const row of rows) {
      const value = (row as { fingerprint: unknown }).fingerprint;
      if (typeof value === 'string' && value.length > 0) fingerprints.add(value);
    }
    return fingerprints;
  }

  /** Todos los veredictos de triage, ordenados por fecha de creacion. */
  getTriageVerdicts(): TriageVerdictRecord[] {
    return this.#db
      .all('SELECT * FROM triage_verdicts ORDER BY created_at')
      .map(rowToTriageVerdict);
  }

  /** Inserta un lote de explicaciones de contexto en una unica transaccion. */
  insertContextExplanations(records: readonly ContextExplanationRecord[]): void {
    if (records.length === 0) return;
    withStmt(
      this.#db,
      'INSERT INTO context_explanations ' +
        '(id, scan_id, fingerprint, summary, entry_point, sink, exposure, agent_id, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      (stmt) => {
        this.#db.exec('BEGIN');
        try {
          for (const raw of records) {
            const r = ContextExplanationRecordSchema.parse(raw);
            stmt.run([
              r.id,
              r.scanId,
              r.fingerprint,
              r.summary,
              r.entryPoint,
              r.sink,
              r.exposure,
              r.agentId,
              r.createdAt,
            ]);
          }
          this.#db.exec('COMMIT');
        } catch (err) {
          this.#db.exec('ROLLBACK');
          throw err;
        }
      },
    );
  }

  /** Todas las explicaciones de contexto, ordenadas por fecha de creacion. */
  getContextExplanations(): ContextExplanationRecord[] {
    return this.#db
      .all('SELECT * FROM context_explanations ORDER BY created_at')
      .map(rowToContextExplanation);
  }

  /** Inserta un lote de sugerencias de remediacion en una unica transaccion. */
  insertRemediationSuggestions(records: readonly RemediationSuggestionRecord[]): void {
    if (records.length === 0) return;
    withStmt(
      this.#db,
      'INSERT INTO remediation_suggestions ' +
        '(id, scan_id, fingerprint, summary, recommendation, fixed_snippet, agent_id, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      (stmt) => {
        this.#db.exec('BEGIN');
        try {
          for (const raw of records) {
            const r = RemediationSuggestionRecordSchema.parse(raw);
            stmt.run([
              r.id,
              r.scanId,
              r.fingerprint,
              r.summary,
              r.recommendation,
              r.fixedSnippet ?? null,
              r.agentId,
              r.createdAt,
            ]);
          }
          this.#db.exec('COMMIT');
        } catch (err) {
          this.#db.exec('ROLLBACK');
          throw err;
        }
      },
    );
  }

  /** Todas las sugerencias de remediacion, ordenadas por fecha de creacion. */
  getRemediationSuggestions(): RemediationSuggestionRecord[] {
    return this.#db
      .all('SELECT * FROM remediation_suggestions ORDER BY created_at')
      .map(rowToRemediationSuggestion);
  }

  /**
   * Registra un lote de observaciones de aprendizaje (`learning_records`,
   * v0.4 §3.5), en una unica transaccion. Cada entrada es un upsert por
   * `(pattern_signature, classification)`: si el patron ya fue clasificado
   * asi, incrementa `evidence_count`; si no, crea el registro. Repetir el
   * mismo par en el lote acumula correctamente (cada upsert ve el anterior).
   */
  recordLearningBatch(
    entries: readonly { signature: string; classification: LearningClassification }[],
    scanId: string,
  ): void {
    if (entries.length === 0) return;
    // Tres statements reusados en el loop: prepare + finalize via withStmt
    // anidados para garantizar el cleanup incluso si una run() falla.
    withStmt(
      this.#db,
      'SELECT id FROM learning_records WHERE pattern_signature = ? AND classification = ?',
      (selectStmt) => {
        withStmt(
          this.#db,
          'UPDATE learning_records SET evidence_count = evidence_count + 1, ' +
            'last_seen_scan = ? WHERE id = ?',
          (updateStmt) => {
            withStmt(
              this.#db,
              'INSERT INTO learning_records ' +
                '(id, pattern_signature, classification, evidence_count, last_seen_scan) ' +
                'VALUES (?, ?, ?, 1, ?)',
              (insertStmt) => {
                this.#db.exec('BEGIN');
                try {
                  for (const entry of entries) {
                    const existing = selectStmt.get([entry.signature, entry.classification]);
                    if (existing) {
                      updateStmt.run([scanId, String((existing as { id: unknown }).id)]);
                    } else {
                      insertStmt.run([randomUUID(), entry.signature, entry.classification, scanId]);
                    }
                  }
                  this.#db.exec('COMMIT');
                } catch (err) {
                  this.#db.exec('ROLLBACK');
                  throw err;
                }
              },
            );
          },
        );
      },
    );
  }

  /** Todos los learning records, ordenados por patron. */
  getLearningRecords(): LearningRecord[] {
    return this.#db
      .all('SELECT * FROM learning_records ORDER BY pattern_signature')
      .map(rowToLearningRecord);
  }

  /** Cierra la conexion con la base de datos. */
  close(): void {
    this.#db.close();
  }
}
