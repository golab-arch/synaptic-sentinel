-- Synaptic Sentinel - Colony DB schema
-- Memoria compartida del enjambre (feromonas digitales).
-- Vive en el proyecto del cliente: .synaptic-sentinel/colony.db
-- Ver docs/colony-db.md

-- journal_mode: DELETE (default) en vez de WAL. node-sqlite3-wasm (DG-062 B)
-- mantiene locks WASM-VFS sobre los archivos -shm/-wal entre instancias
-- secuenciales dentro del mismo proceso (rompe los tests de vitest que abren
-- y cierran la DB varias veces); con DELETE el journal se borra al COMMIT y
-- el siguiente open no encuentra lock. CLI es single-process -> WAL no
-- aportaba concurrencia real.
PRAGMA foreign_keys = ON;

-- Versionado de schema (habilita migraciones futuras).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '6');

CREATE TABLE IF NOT EXISTS scans (
  id            TEXT PRIMARY KEY,
  started_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at   TIMESTAMP,
  git_sha       TEXT,
  agent_summary TEXT                       -- JSON
);

CREATE TABLE IF NOT EXISTS pheromones (
  id          TEXT PRIMARY KEY,
  -- CHECK enum: defensa en profundidad anti Memory Poisoning (v0.4 9.6).
  type        TEXT NOT NULL CHECK (type IN
                ('finding', 'context', 'hypothesis', 'exploration_marker', 'fp_known')),
  agent_id    TEXT NOT NULL,               -- trazabilidad (OWASP ASI 2026)
  scan_id     TEXT NOT NULL REFERENCES scans(id),
  target_path TEXT,
  payload     TEXT NOT NULL,               -- JSON validado con zod antes de insertar
  confidence  REAL CHECK (confidence IS NULL OR confidence BETWEEN 0.0 AND 1.0),
  decay_rate  REAL NOT NULL DEFAULT 0.1 CHECK (decay_rate BETWEEN 0.0 AND 1.0),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pheromone_target ON pheromones(target_path, type);
CREATE INDEX IF NOT EXISTS idx_pheromone_scan   ON pheromones(scan_id);

CREATE TABLE IF NOT EXISTS learning_records (
  id                TEXT PRIMARY KEY,
  pattern_signature TEXT NOT NULL,
  classification    TEXT NOT NULL CHECK (classification IN
                       ('fp_pattern', 'real_pattern', 'project_specific')),
  evidence_count    INTEGER NOT NULL DEFAULT 1 CHECK (evidence_count >= 0),
  last_seen_scan    TEXT REFERENCES scans(id)
);

-- Veredictos de triage del Brain Layer (schema v2 — tabla aditiva).
-- Cada veredicto es un registro estructurado, no una feromona del enjambre.
CREATE TABLE IF NOT EXISTS triage_verdicts (
  id             TEXT PRIMARY KEY,
  scan_id        TEXT NOT NULL REFERENCES scans(id),
  fingerprint    TEXT NOT NULL,               -- Finding.fingerprint
  -- CHECK enum: defensa en profundidad anti Memory Poisoning (v0.4 9.6).
  classification TEXT NOT NULL CHECK (classification IN
                   ('true_positive', 'false_positive', 'inconclusive')),
  confidence     REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  rationale      TEXT NOT NULL,
  agent_id       TEXT NOT NULL,               -- trazabilidad (OWASP ASI 2026)
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_triage_fingerprint ON triage_verdicts(fingerprint);
CREATE INDEX IF NOT EXISTS idx_triage_scan        ON triage_verdicts(scan_id);

-- Explicaciones de contexto del Brain Layer (schema v3 — tabla aditiva).
CREATE TABLE IF NOT EXISTS context_explanations (
  id          TEXT PRIMARY KEY,
  scan_id     TEXT NOT NULL REFERENCES scans(id),
  fingerprint TEXT NOT NULL,               -- Finding.fingerprint
  summary     TEXT NOT NULL,
  entry_point TEXT NOT NULL,
  sink        TEXT NOT NULL,
  exposure    TEXT NOT NULL,
  agent_id    TEXT NOT NULL,               -- trazabilidad (OWASP ASI 2026)
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_context_fingerprint ON context_explanations(fingerprint);
CREATE INDEX IF NOT EXISTS idx_context_scan        ON context_explanations(scan_id);

-- Sugerencias de remediacion del Brain Layer (schema v4 — tabla aditiva).
CREATE TABLE IF NOT EXISTS remediation_suggestions (
  id             TEXT PRIMARY KEY,
  scan_id        TEXT NOT NULL REFERENCES scans(id),
  fingerprint    TEXT NOT NULL,               -- Finding.fingerprint
  summary        TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  fixed_snippet  TEXT,                        -- opcional (NULL si no aplica)
  agent_id       TEXT NOT NULL,               -- trazabilidad (OWASP ASI 2026)
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_remediation_fingerprint ON remediation_suggestions(fingerprint);
CREATE INDEX IF NOT EXISTS idx_remediation_scan        ON remediation_suggestions(scan_id);

-- Tokens y costo USD estimado por LLM call del Brain Layer (schema v5 — aditiva).
-- Tracking provider-agnostic del consumo: cada fila = una invocacion de un
-- agente (triage/context/remediation) contra un provider/model concreto sobre
-- un finding concreto. Las cifras de tokens son PROXIES (heuristica chars/4,
-- el contrato LlmClient no expone usage real — DG-073 B). DG-078 B.
CREATE TABLE IF NOT EXISTS triage_token_usage (
  id                  TEXT PRIMARY KEY,
  triage_session_id   TEXT NOT NULL,                -- UUID que agrupa toda una invocacion de `triage`
  scan_id             TEXT NOT NULL REFERENCES scans(id),
  fingerprint         TEXT NOT NULL,                -- Finding.fingerprint
  provider_label      TEXT NOT NULL,                -- "<provider>/<model>" (ej. anthropic/claude-haiku-4-5-20251001)
  -- CHECK enum: defensa en profundidad anti Memory Poisoning (v0.4 9.6).
  agent_id            TEXT NOT NULL CHECK (agent_id IN
                        ('triage', 'context', 'remediation')),
  input_tokens        INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens       INTEGER NOT NULL CHECK (output_tokens >= 0),
  estimated_cost_usd  REAL NOT NULL CHECK (estimated_cost_usd >= 0),
  latency_ms          INTEGER NOT NULL CHECK (latency_ms >= 0),
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_token_usage_session     ON triage_token_usage(triage_session_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_scan        ON triage_token_usage(scan_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_provider    ON triage_token_usage(provider_label);

-- Historial de veredictos cross-scan (schema v6 — DG-130 A, FASE III).
-- Sub-A2 Balanced: preserva TODOS los veredictos emitidos (incluso los
-- reemplazados por re-triage) para habilitar:
--   (a) mostrar "Previously (N prior verdicts)" en el sidebar
--   (b) banner "Verdict changed since last scan" cuando classification cambia
--   (c) diff-aware line post scan ("N reclassified, M unchanged")
--
-- DIFERENCIA con `triage_verdicts`: esa tabla se BORRA al re-triage
-- (clearTriageDataForFingerprints); `verdict_history` NUNCA se borra —
-- es append-only por diseño para preservar la cadena empírica cross-scan.
-- Incluye `provider_label` (que triage_verdicts NO tiene) para detectar
-- "same/different provider" en el banner de razón heurística.
CREATE TABLE IF NOT EXISTS verdict_history (
  id             TEXT PRIMARY KEY,
  scan_id        TEXT NOT NULL REFERENCES scans(id),
  fingerprint    TEXT NOT NULL,               -- Finding.fingerprint
  -- CHECK enum: defensa en profundidad anti Memory Poisoning (v0.4 9.6).
  classification TEXT NOT NULL CHECK (classification IN
                   ('true_positive', 'false_positive', 'inconclusive')),
  confidence     REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  rationale      TEXT NOT NULL,
  provider_label TEXT NOT NULL,               -- "<provider>/<model>" o "colony-memory"
  agent_id       TEXT NOT NULL,               -- trazabilidad (OWASP ASI 2026)
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_verdict_history_fingerprint ON verdict_history(fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verdict_history_scan        ON verdict_history(scan_id);
