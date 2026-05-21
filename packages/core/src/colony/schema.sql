-- Synaptic Sentinel - Colony DB schema
-- Memoria compartida del enjambre (feromonas digitales).
-- Vive en el proyecto del cliente: .synaptic-sentinel/colony.db
-- Ver docs/colony-db.md

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Versionado de schema (habilita migraciones futuras).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '2');

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
