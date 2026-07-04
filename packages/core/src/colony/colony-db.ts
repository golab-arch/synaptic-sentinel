import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// node-sqlite3-wasm es CJS. Bajo Node ESM, `import * as ... from` puede no
// extraer los named exports si cjs-module-lexer no los detecta (verificado
// en el bundle: `sqliteWasm.Database` quedaba undefined). Usamos createRequire
// para forzar resolucion CJS limpia, y un type-only import para las firmas.
import type * as sqliteWasmTypes from 'node-sqlite3-wasm';

/**
 * Bundle-safe URL para esta unidad de codigo (DG-079.2 hotfix).
 *
 * En ejecucion ESM nativa (cli.mjs, vitest, tests), `import.meta.url` es
 * un `file://...` valido. Pero cuando este modulo se bundlea como parte
 * de un bundle CJS (`extension.cjs` que importa `@synaptic-sentinel/core`
 * vía el barrel desde `settings-view.ts`), esbuild deja `import.meta.url`
 * como `undefined` — y `createRequire(undefined)` lanza, matando
 * `activate()` antes de registrar comandos (root cause descubierto en
 * DG-079.2 al validar el .vsix v0.3.1 localmente).
 *
 * Estrategia: si `import.meta.url` esta disponible, usarlo (ESM path).
 * Si no, leer `__filename` desde el scope local del CJS module wrapper
 * via `eval` (la unica forma de acceder a variables del wrapper desde
 * codigo bundleado — `globalThis.__filename` no esta seteado).
 */
function bundleSafeModuleUrl(): string {
  // ESM path: import.meta.url existe y es valido
  try {
    const url = (import.meta as { url?: string }).url;
    if (typeof url === 'string' && url.length > 0) return url;
  } catch {
    // import.meta no soportado en este contexto — caer al CJS path
  }
  // CJS bundle path: __filename existe en el scope local del wrapper
  try {
    // eval es el unico camino al __filename del wrapper CJS desde codigo bundleado;
    // ESLint no flagea por default. Reduce surface a un literal estatico inocuo.
    const filename = eval('typeof __filename === "string" ? __filename : null') as string | null;
    if (typeof filename === 'string' && filename.length > 0) {
      return `file://${filename.replace(/\\/g, '/')}`;
    }
  } catch {
    /* fall through */
  }
  throw new Error(
    'colony-db: cannot resolve module URL — neither ESM import.meta.url nor CJS __filename available.',
  );
}

const __moduleUrl = bundleSafeModuleUrl();
const requireCjs = createRequire(__moduleUrl);
const sqliteWasm = requireCjs('node-sqlite3-wasm') as typeof sqliteWasmTypes;
type Database = InstanceType<typeof sqliteWasm.Database>;
type Statement = ReturnType<Database['prepare']>;
import {
  ContextExplanationRecordSchema,
  LearningRecordSchema,
  PheromoneSchema,
  RemediationSuggestionRecordSchema,
  ScanSchema,
  TokenUsageRecordSchema,
  TriageVerdictHistoryRecordSchema,
  TriageVerdictRecordSchema,
  type ContextExplanationRecord,
  type CostHistoryRow,
  type LearningClassification,
  type LearningRecord,
  type Pheromone,
  type PheromoneType,
  type RemediationSuggestionRecord,
  type Scan,
  type TokenUsageRecord,
  type TriageClassification,
  type TriageVerdictHistoryRecord,
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
  // Reusa el bundle-safe URL para los dos casos (igual que requireCjs arriba).
  const canonical = fileURLToPath(new URL('../../src/colony/schema.sql', __moduleUrl));
  if (existsSync(canonical)) return canonical;
  return fileURLToPath(new URL('./schema.sql', __moduleUrl));
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
    ...(typeof r['group_id'] === 'string' ? { groupId: r['group_id'] } : {}),
    ...(r['is_group_representative'] !== undefined && r['is_group_representative'] !== null
      ? { isGroupRepresentative: r['is_group_representative'] === 1 }
      : {}),
    createdAt: r['created_at'],
  });
}

/** Convierte una fila de `verdict_history` en un `TriageVerdictHistoryRecord` validado. */
function rowToVerdictHistory(row: unknown): TriageVerdictHistoryRecord {
  const r = row as Record<string, unknown>;
  return TriageVerdictHistoryRecordSchema.parse({
    id: r['id'],
    scanId: r['scan_id'],
    fingerprint: r['fingerprint'],
    classification: r['classification'],
    confidence: r['confidence'],
    rationale: r['rationale'],
    providerLabel: r['provider_label'],
    agentId: r['agent_id'],
    ...(typeof r['group_id'] === 'string' ? { groupId: r['group_id'] } : {}),
    ...(r['is_group_representative'] !== undefined && r['is_group_representative'] !== null
      ? { isGroupRepresentative: r['is_group_representative'] === 1 }
      : {}),
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
   *
   * **Diagnóstico defensivo (DG-092 A)**: el `unable to open database file`
   * de SQLite WASM es opaco — solo dice "no pude abrir" sin causa. Antes
   * de delegar al driver, hacemos un pre-flight chequeando el caso más
   * común (dir parent inexistente). Si el driver igual falla por otro
   * motivo (Norton AV lockeando, lockfile residual de un proceso muerto,
   * permisos, path inválido), envolvemos el error con un mensaje que
   * lista las 3 causas concretas observadas + el error SQLite original.
   *
   * No intentamos "auto-fix" (mkdir, retry, delete lockfile) porque cada
   * causa requiere acción del usuario distinta — el mensaje accionable
   * es el contrato. El caller (CLI commands) ya hace `mkdirSync(...,
   * { recursive: true })` antes de open, así que el dir-inexistente solo
   * se ve si el caller no hizo eso (e.g., tests con paths inválidos).
   */
  static open(path: string): ColonyDb {
    if (path !== ':memory:') {
      const dir = dirname(path);
      if (!existsSync(dir)) {
        throw new Error(
          `Could not open colony.db at "${path}": parent directory "${dir}" ` +
            `does not exist. Make sure the workspace path is correct and the ` +
            `caller created the directory before opening the database.`,
        );
      }
    }
    let db: Database;
    try {
      db = new sqliteWasm.Database(path);
    } catch (err) {
      const original = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not open colony.db at "${path}". This usually means one of:\n` +
          `  (a) the file is locked by another Sentinel CLI run still in flight ` +
          `(close other VS Code windows / kill stale node processes, then retry).\n` +
          `  (b) Norton / Defender / corporate antivirus blocked the write — try ` +
          `adding the workspace path to your AV exclusions.\n` +
          `  (c) the workspace path is read-only or your user lacks write permissions.\n` +
          `Original SQLite error: ${original}`,
      );
    }
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    // Migraciones aditivas (v2: triage_verdicts, v3: context_explanations,
    // v4: remediation_suggestions): las tablas se crean via CREATE TABLE IF
    // NOT EXISTS en el schema, sin reconstruir nada; aqui se sincroniza la
    // version de una base preexistente.
    // DG-131 A Sub-A2 + DG-131.0.1 HOTFIX (schema v7): migración idempotente
    // segura via PRAGMA table_info explicit check en lugar de try-catch
    // swallowing. La versión anterior con try-catch enmascaraba fallas
    // legítimas del ALTER — empíricamente observado en Baseline-15 SYNAPTIC_SAAS
    // DB v6 preexistente: ALTER falló silente (razón WASM/lock), CREATE INDEX
    // subsequent falló con "no such column: group_id" abortando el scan.
    // PRAGMA table_info es explícito + defensive: si la column NO existe, ALTER
    // ejecuta y errores reales bubblean up (no silent). Si existe, skip clean.
    const columnsToAdd: readonly [string, string, string][] = [
      ['triage_verdicts', 'group_id', 'TEXT'],
      ['triage_verdicts', 'is_group_representative', 'INTEGER'],
      ['verdict_history', 'group_id', 'TEXT'],
      ['verdict_history', 'is_group_representative', 'INTEGER'],
    ];
    const hasColumn = (table: string, column: string): boolean => {
      const rows = db.all(`PRAGMA table_info(${table})`) as { name?: unknown }[];
      return rows.some((row) => typeof row.name === 'string' && row.name === column);
    };
    for (const [table, column, spec] of columnsToAdd) {
      if (!hasColumn(table, column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec}`);
      }
    }
    // Índices sobre las columns nuevas (CREATE INDEX IF NOT EXISTS es idempotente).
    db.exec('CREATE INDEX IF NOT EXISTS idx_triage_verdicts_group_id ON triage_verdicts(group_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_verdict_history_group_id ON verdict_history(group_id)');
    db.exec("UPDATE meta SET value = '7' WHERE key = 'schema_version'");
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
        '(id, scan_id, fingerprint, classification, confidence, rationale, ' +
        ' agent_id, group_id, is_group_representative, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
              r.groupId ?? null,
              r.isGroupRepresentative === undefined ? null : r.isGroupRepresentative ? 1 : 0,
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

  /**
   * Inserta un lote de registros de historia de veredictos (DG-130 A, FASE III)
   * en una unica transaccion.
   *
   * A DIFERENCIA de {@link insertTriageVerdicts}, esta tabla es APPEND-ONLY:
   * cada re-triage añade nuevos registros SIN borrar los anteriores. Esto
   * habilita el sidebar "Previously (N prior verdicts)" y el banner
   * "Verdict changed since last scan". Ver JSDoc de la tabla en schema.sql.
   */
  insertVerdictHistoryBatch(records: readonly TriageVerdictHistoryRecord[]): void {
    if (records.length === 0) return;
    withStmt(
      this.#db,
      'INSERT INTO verdict_history ' +
        '(id, scan_id, fingerprint, classification, confidence, rationale, ' +
        ' provider_label, agent_id, group_id, is_group_representative, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      (stmt) => {
        this.#db.exec('BEGIN');
        try {
          for (const raw of records) {
            const r = TriageVerdictHistoryRecordSchema.parse(raw);
            stmt.run([
              r.id,
              r.scanId,
              r.fingerprint,
              r.classification,
              r.confidence,
              r.rationale,
              r.providerLabel,
              r.agentId,
              r.groupId ?? null,
              r.isGroupRepresentative === undefined ? null : r.isGroupRepresentative ? 1 : 0,
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
   * Devuelve los últimos `limit` veredictos históricos para un fingerprint,
   * ordenados por `created_at` DESC (el más reciente primero).
   *
   * El primer elemento (índice 0) corresponde al veredicto actual
   * post-último-triage. El segundo (índice 1) es el veredicto previo —
   * usar para detección de cambio en el banner del sidebar.
   */
  getVerdictHistoryForFingerprint(
    fingerprint: string,
    limit: number = 5,
  ): TriageVerdictHistoryRecord[] {
    return this.#db
      .all('SELECT * FROM verdict_history WHERE fingerprint = ? ORDER BY created_at DESC LIMIT ?', [
        fingerprint,
        limit,
      ])
      .map(rowToVerdictHistory);
  }

  /**
   * Devuelve un mapa `{ fingerprint → últimos N history records DESC }` para
   * el conjunto de fingerprints dado.
   *
   * Optimización batch — evita N queries independientes cuando se hidrata
   * el tomo para el sidebar. Los history records vienen ordenados DESC dentro
   * de cada arreglo del map.
   */
  getVerdictHistoryByFingerprints(
    fingerprints: readonly string[],
    limitPerFingerprint: number = 5,
  ): Map<string, TriageVerdictHistoryRecord[]> {
    const result = new Map<string, TriageVerdictHistoryRecord[]>();
    if (fingerprints.length === 0) return result;
    // SQLite max host parameters ~999 — batch 500 por seguridad.
    const BATCH_SIZE = 500;
    for (let i = 0; i < fingerprints.length; i += BATCH_SIZE) {
      const batch = fingerprints.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(', ');
      // Query TODO el history y luego cap per-fingerprint en JS — más simple
      // que ROW_NUMBER (SQLite requiere versión reciente para window funcs).
      const rows = this.#db.all(
        `SELECT * FROM verdict_history WHERE fingerprint IN (${placeholders}) ` +
          `ORDER BY fingerprint, created_at DESC`,
        [...batch],
      );
      for (const raw of rows) {
        const record = rowToVerdictHistory(raw);
        const arr = result.get(record.fingerprint) ?? [];
        if (arr.length < limitPerFingerprint) {
          arr.push(record);
          result.set(record.fingerprint, arr);
        }
      }
    }
    return result;
  }

  /**
   * Diff-aware summary (DG-130 A): para el conjunto de fingerprints del scan
   * actual, compara el veredicto ACTUAL (row DESC[0]) contra el ANTERIOR
   * (row DESC[1]) del `verdict_history`. Devuelve buckets:
   *  - `newFindings`: fingerprints sin veredicto previo (primera vez triaged)
   *  - `reclassified`: fingerprints cuya classification cambió
   *  - `unchanged`: fingerprints con la misma classification cross-scan
   *
   * NOTA: solo cuenta findings que EFECTIVAMENTE tienen un veredicto en
   * el history. Un fingerprint del scan actual SIN veredicto en history
   * queda fuera del diff (no aparece en ningún bucket) — típicamente
   * porque nunca se corrió triage sobre él (skip por known-FP o por
   * limit cap).
   */
  getVerdictDiffAgainstPrevious(fingerprints: readonly string[]): {
    newFindings: string[];
    reclassified: { fingerprint: string; from: TriageClassification; to: TriageClassification }[];
    unchanged: string[];
  } {
    const newFindings: string[] = [];
    const reclassified: {
      fingerprint: string;
      from: TriageClassification;
      to: TriageClassification;
    }[] = [];
    const unchanged: string[] = [];
    const historyMap = this.getVerdictHistoryByFingerprints(fingerprints, 2);
    for (const fingerprint of fingerprints) {
      const history = historyMap.get(fingerprint) ?? [];
      if (history.length === 0) continue; // sin history → no clasificado
      if (history.length === 1) {
        // Solo un veredicto → primera vez triaged
        newFindings.push(fingerprint);
        continue;
      }
      const current = history[0];
      const previous = history[1];
      if (current === undefined || previous === undefined) continue;
      if (current.classification !== previous.classification) {
        reclassified.push({
          fingerprint,
          from: previous.classification,
          to: current.classification,
        });
      } else {
        unchanged.push(fingerprint);
      }
    }
    return { newFindings, reclassified, unchanged };
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
   * Borra todos los `triage_verdicts`, `context_explanations` y
   * `remediation_suggestions` para el conjunto de fingerprints dado
   * (DG-107 A).
   *
   * Operacion destructiva controlada, ejecutada en una unica transaccion
   * para que un fallo intermedio no deje datos parciales. Sirve al flow
   * de re-triage: el usuario cambia de provider y quiere re-evaluar las
   * mismas findings sin tener que tocar `colony.db` manualmente.
   *
   * **NO toca** `fp_known` (los falsos positivos marcados por el usuario
   * via `mark-fp` son acciones manuales y no deben perderse) ni
   * `triage_token_usage` (la historia de costo del rollup `cost-history`
   * debe persistir aunque se re-corra el triage).
   *
   * Devuelve el numero total de filas borradas en las 3 tablas.
   */
  clearTriageDataForFingerprints(fingerprints: readonly string[]): number {
    if (fingerprints.length === 0) return 0;
    // SQLite tiene un limite de host parameters (~999). Para el caso de
    // un workspace con miles de findings hacemos batches de 500.
    const BATCH_SIZE = 500;
    let totalDeleted = 0;
    this.#db.exec('BEGIN');
    try {
      for (let i = 0; i < fingerprints.length; i += BATCH_SIZE) {
        const batch = fingerprints.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map(() => '?').join(', ');
        const r1 = this.#db.run(
          `DELETE FROM triage_verdicts WHERE fingerprint IN (${placeholders})`,
          [...batch],
        );
        const r2 = this.#db.run(
          `DELETE FROM context_explanations WHERE fingerprint IN (${placeholders})`,
          [...batch],
        );
        const r3 = this.#db.run(
          `DELETE FROM remediation_suggestions WHERE fingerprint IN (${placeholders})`,
          [...batch],
        );
        // node-sqlite3-wasm RunResult expone changes; tipos defensivos.
        const c1 = typeof r1?.changes === 'number' ? r1.changes : 0;
        const c2 = typeof r2?.changes === 'number' ? r2.changes : 0;
        const c3 = typeof r3?.changes === 'number' ? r3.changes : 0;
        totalDeleted += c1 + c2 + c3;
      }
      this.#db.exec('COMMIT');
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
    return totalDeleted;
  }

  /**
   * Devuelve el timestamp (ISO 8601) del registro mas reciente en
   * `triage_token_usage`, o `undefined` si la tabla esta vacia (DG-107 A).
   *
   * Usado por `cost-history --json` para que la extension pueda mostrar
   * "hace cuanto" fue el ultimo triage con LLM calls reales — clave para
   * que el sidebar no parezca mostrar datos stale cuando una corrida
   * reciente hizo 0 calls (caso clasico del flow cambiar-de-provider).
   */
  getLatestTriageSessionTimestamp(): string | undefined {
    const row = this.#db.get(
      'SELECT created_at FROM triage_token_usage ORDER BY created_at DESC LIMIT 1',
    ) as { created_at?: string } | null | undefined;
    if (row === undefined || row === null) return undefined;
    return typeof row.created_at === 'string' ? row.created_at : undefined;
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

  /**
   * Inserta un lote de registros de uso de tokens (DG-078 B, schema v5)
   * en una unica transaccion. Las cifras de tokens son PROXIES heuristicos
   * (`chars/4`) — el contrato LlmClient no expone usage real. El estimate
   * de costo USD se calcula caller-side con `estimateCostUsd` de
   * `@synaptic-sentinel/core` antes de pasar el record.
   */
  insertTokenUsages(records: readonly TokenUsageRecord[]): void {
    if (records.length === 0) return;
    withStmt(
      this.#db,
      'INSERT INTO triage_token_usage ' +
        '(id, triage_session_id, scan_id, fingerprint, provider_label, agent_id, ' +
        ' input_tokens, output_tokens, estimated_cost_usd, latency_ms, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      (stmt) => {
        this.#db.exec('BEGIN');
        try {
          for (const raw of records) {
            const r = TokenUsageRecordSchema.parse(raw);
            stmt.run([
              r.id,
              r.triageSessionId,
              r.scanId,
              r.fingerprint,
              r.providerLabel,
              r.agentId,
              r.inputTokens,
              r.outputTokens,
              r.estimatedCostUsd,
              r.latencyMs,
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
   * Devuelve un rollup de las ultimas `limit` sesiones de triage agrupado
   * por `(provider_label, agent_id)`. Default `limit = 10` sesiones. Cada
   * fila acumula calls, tokens y costo USD sobre todas las invocaciones
   * dentro de esas sesiones.
   *
   * Order DESDE DG-105 A: workflow del Brain Layer — triage → context →
   * remediation (1, 2, 3) y secundariamente por `provider_label` para
   * estabilidad cuando hay multi-provider. Antes era `ORDER BY
   * estimated_cost_usd DESC` lo que producia ordenes contraintuitivos
   * (ej: `triage → remediation → context` en lugar del flujo natural)
   * observados empiricamente por el usuario en la captura de v0.3.9.
   */
  getCostHistory(limit: number = 10): CostHistoryRow[] {
    // Subquery: ultimas `limit` sesiones (por created_at MAX).
    const recentSessions = this.#db.all(
      'SELECT triage_session_id FROM triage_token_usage ' +
        'GROUP BY triage_session_id ' +
        'ORDER BY MAX(created_at) DESC ' +
        'LIMIT ?',
      [limit],
    ) as unknown as { triage_session_id: string }[];
    if (recentSessions.length === 0) return [];
    const sessionIds = recentSessions.map((r) => r.triage_session_id);
    // Placeholders dinamicos (?, ?, ?...) — sessionIds es controlado por nosotros, no por usuario.
    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = this.#db.all(
      'SELECT provider_label, agent_id, ' +
        '       COUNT(*) AS calls, ' +
        '       SUM(input_tokens) AS input_tokens, ' +
        '       SUM(output_tokens) AS output_tokens, ' +
        '       SUM(estimated_cost_usd) AS estimated_cost_usd, ' +
        '       AVG(latency_ms) AS avg_latency_ms ' +
        'FROM triage_token_usage ' +
        `WHERE triage_session_id IN (${placeholders}) ` +
        'GROUP BY provider_label, agent_id ' +
        'ORDER BY CASE agent_id ' +
        "  WHEN 'triage' THEN 1 " +
        "  WHEN 'context' THEN 2 " +
        "  WHEN 'remediation' THEN 3 " +
        '  ELSE 99 ' +
        'END, provider_label',
      sessionIds,
    ) as unknown as readonly {
      provider_label: string;
      agent_id: 'triage' | 'context' | 'remediation';
      calls: number;
      input_tokens: number;
      output_tokens: number;
      estimated_cost_usd: number;
      avg_latency_ms: number;
    }[];
    return rows.map((row) => ({
      providerLabel: row.provider_label,
      agentId: row.agent_id,
      calls: row.calls,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      estimatedCostUsd: row.estimated_cost_usd,
      avgLatencyMs: row.avg_latency_ms,
    }));
  }

  /** Cierra la conexion con la base de datos. */
  close(): void {
    this.#db.close();
  }
}
