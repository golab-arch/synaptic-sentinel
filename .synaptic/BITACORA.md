# BITACORA.md - SENTINEL

## SYNAPTIC Protocol v3.0 - Chronological Activity Log

---

## FORMAT: JSON Entries

Each entry follows this structure:
```json
{
  "timestamp": "ISO-8601",
  "cycle": number,
  "phase": number,
  "action": "ACTION_TYPE",
  "details": { ... },
  "outcome": "SUCCESS|FAILURE|PENDING",
  "synapticStrength": number,
  "complianceScore": number
}
```

---

## LOG ENTRIES

### Entry #0 - Project Initialization
```json
{
  "timestamp": "2026-05-20T19:09:00.816Z",
  "cycle": 0,
  "phase": 0,
  "action": "PROJECT_INITIALIZED",
  "details": {
    "projectName": "SENTINEL",
    "description": "Project SENTINEL",
    "enforcementMode": "STRICT",
    "synapticVersion": "3.0"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 0,
  "complianceScore": 100
}
```

### Entry #1 - Kickoff: Context Load + Technical Discovery
```json
{
  "timestamp": "2026-05-20T20:15:00.000Z",
  "cycle": 1,
  "phase": 1,
  "action": "TECH_DISCOVERY",
  "details": {
    "paso1_context": "Leídos documento maestro Synaptic_Sentinel_v0.4.md (31 decisiones, varias LOCKED), Synaptic_Sentinel_Estructura_Repo.md, Kickoff Prompt y todos los archivos directores (MANTRA, RULES, DESIGN_DOC, BITACORA, session.json, INTELLIGENCE.json, bitacora/INDEX.json, CURRENT.md)",
    "paso2_environment": {
      "node": "v24.11.1 (OK, requiere >=20)",
      "npm": "11.6.2",
      "pnpm": "10.33.0 (disponible)",
      "yarn": "no instalado",
      "git": "2.51.0.windows.1",
      "python": "3.14.0 via py launcher (python.exe es el stub de Microsoft Store)",
      "docker": "28.4.0",
      "wsl": "v2.7.3.0 (WSL2 disponible)",
      "scanners": "OpenGrep / Gitleaks / Trivy / Checkov AUSENTES — estrategia de instalación pendiente",
      "sentinelRepo": "git NO inicializado"
    },
    "enforcementPackage": "@synaptic-sre/enforcement ubicado en D:/GoLAB/PROYECTOS/SYNAPTIC_VSC_EXTENSION/packages/enforcement — ESM TypeScript zero-dep (ComplianceScorer, ResponseValidator, TemplateChecker, RegenerationEngine, decision-gate-utils)",
    "decisionGateOpen": "DG-001 — estructura física del monorepo OSS/Pro (3 opciones presentadas)"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 1,
  "complianceScore": 100
}
```

### Entry #2 - Discovery Decisions: DG-002 + Q1 + git init
```json
{
  "timestamp": "2026-05-20T20:45:00.000Z",
  "cycle": 1,
  "phase": 1,
  "action": "DECISION_RECORDED",
  "details": {
    "DG-002": {
      "title": "Estructura del repositorio GitHub",
      "selected": "Option A",
      "effect": "git init local ejecutado en D:/GoLAB/PROYECTOS/SENTINEL (branch main); repo remoto GitHub diferido al PASO 3"
    },
    "Q1": {
      "title": "Package manager",
      "selected": "pnpm workspaces (v10.33.0)"
    },
    "gitInit": "SUCCESS - repo vacio, branch main, identidad global golab-arch/golab.develop@gmail.com presente; sin commit (primer commit en PASO 3 con .gitignore)",
    "stillOpen": [
      "DG-001 - estructura fisica del monorepo OSS/Pro - NO respondido por el usuario - BLOQUEA scaffolding",
      "DG-003 - estrategia de binarios de scanners (ex-Q2) - presentado en este ciclo",
      "DG-004 - reuso de @synaptic-sre/enforcement (ex-Q3) - presentado en este ciclo"
    ]
  },
  "outcome": "SUCCESS",
  "synapticStrength": 2,
  "complianceScore": 100
}
```

### Entry #3 - Discovery Closed: DG-001 + DG-003 + DG-004
```json
{
  "timestamp": "2026-05-20T21:10:00.000Z",
  "cycle": 1,
  "phase": 1,
  "action": "DECISION_RECORDED",
  "details": {
    "DG-001": {
      "title": "Estructura fisica del monorepo OSS/Pro",
      "selected": "Option B",
      "effect": "Monorepo unico con workspaces marcados OSS/Pro + script publish-oss.ts allowlist-based"
    },
    "DG-003": {
      "title": "Estrategia de binarios de scanners",
      "selected": "Option A",
      "effect": "Binarios nativos pinneados, descarga on-demand via scripts/install-scanners.ts; mismo mecanismo dev y producto"
    },
    "DG-004": {
      "title": "Reuso de @synaptic-sre/enforcement",
      "selected": "Option A",
      "effect": "Referencia conceptual de patrones; reimplementacion idiomatica; cero dependencia cross-repo"
    },
    "discoveryStatus": "CERRADO - las 5 decisiones de arranque resueltas (DG-001 B, DG-002 A, DG-003 A, DG-004 A, Q1 pnpm)",
    "nextStep": "PASO 3 - propuesta de scaffolding presentada para aprobacion; NO se genero ningun archivo de scaffolding aun"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 3,
  "complianceScore": 100
}
```

### Entry #4 - Scaffolding Scope Approved: DG-005
```json
{
  "timestamp": "2026-05-20T21:40:00.000Z",
  "cycle": 2,
  "phase": 2,
  "action": "DECISION_RECORDED",
  "details": {
    "DG-005": {
      "title": "Alcance de la generacion de scaffolding",
      "selected": "Option B",
      "effect": "Esqueleto completo del workspace: 7 paquetes declarados con package.json/tsconfig/header de licencia/index.ts stub; codigo real solo en shared, core, scouts"
    },
    "colonyDbSchema": "Aprobadas las 2 mejoras propuestas: tabla meta (schema_version) + CHECK constraints en type, classification, confidence, decay_rate, evidence_count",
    "scaffoldingAdjustments": "Usuario delega criterio. Se propone DG-006 (linter/formatter, decision no cubierta por v0.4) + auto-includes: .gitattributes (LF), docs/colony-db.md (requerido por kickoff), LICENSE-PRO stub",
    "nextStep": "DG-006 abierto; tras resolverlo se genera el scaffolding completo + primer commit atomico"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 4,
  "complianceScore": 100
}
```

### Entry #5 - Scaffolding Generated & Verified (DG-006 + DG-005 ejecutado)
```json
{
  "timestamp": "2026-05-20T22:30:00.000Z",
  "cycle": 2,
  "phase": 2,
  "action": "SCAFFOLDING_GENERATED",
  "details": {
    "DG-006": {
      "title": "Linter / formatter",
      "selected": "Option B",
      "effect": "ESLint flat config (typescript-eslint) + Prettier configurados en el scaffolding"
    },
    "scope": "DG-005 B ejecutado - esqueleto completo del monorepo pnpm",
    "rootFiles": "package.json, pnpm-workspace.yaml, .npmrc, tsconfig.base.json, tsconfig.json, vitest.config.ts, eslint.config.mjs, .prettierrc.json, .prettierignore, .gitignore, .gitattributes, .editorconfig, LICENSE (Apache-2.0 oficial), LICENSE-PRO (stub), README.md, docs/colony-db.md",
    "packages": "7 declarados (shared, core, scouts, cli, reporters, vscode-extension, agents) con package.json + tsconfig.json + src/index.ts; core incluye src/colony/schema.sql con las 2 mejoras aprobadas",
    "tests": "3 smoke tests (shared, core, scouts) - Vitest",
    "verification": {
      "pnpm_install": "OK - 204 paquetes",
      "pnpm_build": "OK - tsc -b exit 0",
      "pnpm_lint": "OK - eslint exit 0",
      "pnpm_test": "OK - vitest 3/3 passed"
    },
    "adjustments": "build raiz via 'tsc -b' (project references) en vez de 'pnpm -r build'; esbuild declarado en pnpm.onlyBuiltDependencies (postura supply-chain)",
    "blocker_resuelto": "pnpm install fallaba con TLS UNABLE_TO_VERIFY_LEAF_SIGNATURE - entorno con inspeccion TLS (proxy/AV); workaround NODE_OPTIONS=--use-system-ca",
    "incidente": "Filtro de contenido corto la generacion inicial en Batch 2; LICENSE Apache-2.0 se obtuvo por descarga oficial",
    "commit": "primer commit atomico en branch main incluye este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 5,
  "complianceScore": 100
}
```

### Entry #6 - Commit inicial BLOQUEADO (correccion de Entry #5)
```json
{
  "timestamp": "2026-05-20T22:45:00.000Z",
  "cycle": 2,
  "phase": 2,
  "action": "COMMIT_BLOCKED",
  "details": {
    "correccion": "Entry #5 anticipo el commit como realizado; NO se concreto. El scaffolding SI esta generado y verificado (pnpm install/build/lint/test verdes), pero el commit inicial esta BLOQUEADO.",
    "causa": "git add/commit fallan con 'Permission denied' al escribir objetos en .git/objects/. Diagnostico: la ACL permite escritura, PowerShell escribe OK, Controlled Folder Access OFF, sandbox del harness descartado (fallo igual con sandbox off). Causa: antivirus / endpoint protection con real-time scanning bloqueando los objetos git recien creados.",
    "intentos": "3 intentos de git add fallaron, en objetos distintos cada vez (no transitorio)",
    "aclaracion": "El bloqueo es 100% LOCAL (.git/objects). NO tiene relacion con GitHub ni con tokens: git commit es una operacion local y no requiere autenticacion.",
    "decisionAbierta": "DG-007 - resolucion del bloqueo (exclusion de AV vs bucle de reintentos)"
  },
  "outcome": "PENDING",
  "synapticStrength": 5,
  "complianceScore": 100
}
```

### Entry #7 - DG-007 resuelto (A) + antivirus identificado: Norton 360
```json
{
  "timestamp": "2026-05-20T23:00:00.000Z",
  "cycle": 2,
  "phase": 2,
  "action": "DECISION_RECORDED",
  "details": {
    "DG-007": {
      "title": "Desbloquear el commit inicial (interferencia de antivirus)",
      "selected": "Option A",
      "effect": "Exclusion de la carpeta del proyecto en el antivirus; luego se reintenta el commit"
    },
    "av_identificado": "El antivirus activo es Norton 360 (real-time Auto-Protect/SONAR), NO Windows Defender (en modo pasivo). Norton 360 en C:/Program Files/Norton/Suite. Las instrucciones de exclusion son las de Norton, no las de Defender.",
    "pendiente": "El usuario debe agregar D:/GoLAB/PROYECTOS/SENTINEL a las exclusiones de Auto-Protect/SONAR de Norton 360; luego se reintenta el commit (1 intento limpio).",
    "tls": "La inspeccion TLS (L-001) tambien es de Norton; se mantiene el workaround NODE_OPTIONS=--use-system-ca para operaciones de red."
  },
  "outcome": "PENDING",
  "synapticStrength": 6,
  "complianceScore": 100
}
```

### Entry #8 - Primer commit realizado - Cycle 2 CERRADO
```json
{
  "timestamp": "2026-05-20T23:20:00.000Z",
  "cycle": 2,
  "phase": 2,
  "action": "SCAFFOLDING_COMMITTED",
  "details": {
    "commit": "f0b5202 (root-commit) en branch main",
    "stats": "54 archivos, 2563 inserciones, working tree limpio",
    "blocker_resuelto": "DG-007 A ejecutado - el usuario agrego la exclusion de la carpeta en Norton 360; git add/commit corrieron limpios",
    "cycleClosure": "Cycle 2 (scaffolding) CERRADO con exito. Discovery + scaffolding completos, verificados y en control de versiones.",
    "nextStep": "Cycle 3 / PASO 4 - primer hito implementable: interfaz ScoutAgent + wrapper OpenGrep + fixtures JS/TS+Python"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 7,
  "complianceScore": 100
}
```

### Entry #9 - PASO 4 Increment 1: contrato ScoutAgent + tipos compartidos
```json
{
  "timestamp": "2026-05-20T23:40:00.000Z",
  "cycle": 3,
  "phase": 3,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-008": {
      "title": "Alcance del primer increment de PASO 4",
      "selected": "Option A",
      "effect": "Contrato primero - interfaz ScoutAgent + tipos compartidos antes del wrapper OpenGrep"
    },
    "core_types": "packages/core/src/types/: severity, finding (Finding + FindingLocation + categorias + lifecycle), pheromone (matchea la tabla pheromones de colony.db), scan (Scan + ScanMode). Cada tipo = schema zod como fuente unica de verdad; el tipo TS se infiere con z.infer.",
    "scouts": "packages/scouts/src/scout-agent.ts: interfaz ScoutAgent + ScanRequest (con AbortSignal como kill-switch, v0.4 9.6) + ScoutResult validado con zod (estados ok/partial/failed)",
    "deps": "zod ^3.24 agregado a core y scouts",
    "adjustments": "vitest.config.ts: aliases que resuelven los paquetes internos @synaptic-sentinel/* a su codigo fuente (tests corren sin build previo)",
    "tests": "25 tests nuevos (severity 4, finding 7, pheromone 5, scan 5, scout-agent 4) + 3 smoke = 28 total",
    "verification": "pnpm install / build (tsc -b) / lint (eslint) / test (vitest 28/28) - todos en verde",
    "commit": "commit atomico feat(scouts,core) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 8,
  "complianceScore": 100
}
```

### Entry #10 - PASO 4 Increment 2: install-scanners (OpenGrep)
```json
{
  "timestamp": "2026-05-20T23:55:00.000Z",
  "cycle": 4,
  "phase": 3,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-009": {
      "title": "Alcance del segundo increment de PASO 4",
      "selected": "Option A",
      "effect": "Solo scripts/install-scanners.ts - adquisicion del binario primero"
    },
    "files": "scripts/scanners.manifest.json (OpenGrep v1.22.0, 5 plataformas, checksums SHA-256 oficiales obtenidos de la GitHub API), scripts/install-scanners.ts (descarga + verificacion de checksum + idempotencia + cross-platform), scripts/install-scanners.test.ts, scripts/tsconfig.json",
    "config": "vitest.config.ts incluye scripts/; package.json: script scanners:install (node --use-system-ca) y typecheck extendido a scripts",
    "verification_real": "pnpm scanners:install descargo opengrep_windows_x86.exe (47123456 bytes); checksum SHA-256 verificado = f4f91b0a6268318df1dbb63e11f0ba2e9fdc355fa27d1de8fe9abf6c8a8e9efa; opengrep --version => 1.22.0",
    "tests": "4 tests nuevos (install-scanners) - total 32 verdes",
    "checks": "build / typecheck (incl. scripts) / lint / test - todos en verde",
    "commit": "commit atomico feat(scripts) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 9,
  "complianceScore": 100
}
```

### Entry #11 - PASO 4 Increment 3: OpenGrepScout + normalizer
```json
{
  "timestamp": "2026-05-21T00:15:00.000Z",
  "cycle": 5,
  "phase": 3,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-010": {
      "title": "Alcance del tercer increment de PASO 4",
      "selected": "Option A",
      "effect": "OpenGrepScout + normalizer, testeados unitariamente contra salida JSON real capturada de OpenGrep"
    },
    "discovery": "Capturada la CLI y el schema JSON real de OpenGrep ejecutando el binario sobre un snippet vulnerable con una regla minima",
    "files": "packages/scouts/src/opengrep/: opengrep-output.ts (schema zod de la salida de OpenGrep), normalizer.ts (normalizeOpenGrepOutput + mapSeverity/extractComplianceRefs/relativizePath/deriveTitle), opengrep-scout.ts (OpenGrepScout implements ScoutAgent: isAvailable + scan via child process con soporte de AbortSignal). Fixture: tests/opengrep/fixtures/opengrep-output.sample.json (salida real capturada).",
    "tests": "16 nuevos (normalizer 10, opengrep-scout 6) - total 48 verdes",
    "type_fix": "tsc -b atrapo un error real de exactOptionalPropertyTypes en el tipo de extractComplianceRefs; corregido usando el tipo OpenGrepMetadata inferido por zod",
    "checks": "build / typecheck / lint / test - todos en verde",
    "scope_note": "scan() esta implementado; su test de integracion en vivo (OpenGrep sobre fixtures curadas) es el Increment 4 segun DG-010 A",
    "commit": "commit atomico feat(scouts) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 10,
  "complianceScore": 100
}
```

### Entry #12 - PASO 4 Increment 4: fixtures + integracion - PASO 4 COMPLETO
```json
{
  "timestamp": "2026-05-21T09:45:00.000Z",
  "cycle": 6,
  "phase": 3,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-011": {
      "title": "Cuarto increment de PASO 4",
      "selected": "Option B",
      "effect": "Ruleset OpenGrep curado + fixtures vulnerables JS/TS/Python + tests de integracion con el binario real"
    },
    "ruleset": "packages/scouts/src/opengrep/rules/sentinel-baseline.yaml - 4 reglas SAST (eval, new Function, exec, subprocess shell=True) con metadata CWE/OWASP",
    "fixtures": "packages/scouts/tests/opengrep/fixtures/vulnerable/{javascript,typescript,python}/ - codigo deliberadamente vulnerable",
    "integration_tests": "3 tests que ejecutan OpenGrep real sobre las fixtures; usan describe.skip si el binario no esta instalado (CI sin binario no falla)",
    "verification_real": "OpenGrep detecta: eval() en JS (severity high), new Function() en TS, exec() + subprocess shell=True en Python. 51 tests verdes (build/typecheck/lint/test)",
    "config": "fixtures excluidas de ESLint/Prettier; ruleset incluido en files de @synaptic-sentinel/scouts",
    "milestone": "PASO 4 del kickoff COMPLETO - primer scout funcional end-to-end (OpenGrep) detectando vulnerabilidades reales en los dos lenguajes LOCKED del MVP (JS/TS + Python)",
    "observacion": "los tests de integracion suman ~46s a pnpm test; a futuro conviene separar test:unit / test:integration",
    "commit": "commit atomico feat(scouts) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 11,
  "complianceScore": 100
}
```

### Entry #13 - DG-012 resuelto (B) + DG-013 abierto (driver SQLite)
```json
{
  "timestamp": "2026-05-21T10:05:00.000Z",
  "cycle": 7,
  "phase": 4,
  "action": "DECISION_RECORDED",
  "details": {
    "DG-012": {
      "title": "Proximo paso del roadmap",
      "selected": "Option B",
      "effect": "Coordinator stage 1 + persistencia en colony.db"
    },
    "plan": "B se ejecutara en dos increments: B.1 = capa colony.db (driver SQLite + creacion desde schema.sql + repositorio de pheromones/scans), B.2 = Coordinator stage 1 (orquesta scouts -> findings -> feromonas en colony.db)",
    "decisionAbierta": "DG-013 - driver SQLite (node:sqlite vs better-sqlite3 vs WASM). Decision arquitectonica no cerrada por el v0.4 (sugirio better-sqlite3 pero indico 'validar en discovery'); B.1 depende de esto",
    "phase": "Phase 4 - Coordinator + colony.db"
  },
  "outcome": "PENDING",
  "synapticStrength": 11,
  "complianceScore": 100
}
```

### Entry #14 - DG-013 (A) + B.1: capa colony.db
```json
{
  "timestamp": "2026-05-21T10:35:00.000Z",
  "cycle": 7,
  "phase": 4,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-013": {
      "title": "Driver SQLite para colony.db",
      "selected": "Option A",
      "effect": "node:sqlite - modulo SQLite integrado de Node, sin dependencias nativas ni problema de ABI"
    },
    "increment": "B.1 - capa colony.db",
    "files": "packages/core/src/colony/colony-db.ts (clase ColonyDb sobre node:sqlite: open + aplicacion idempotente del schema, repositorios de scans y pheromones, transacciones, validacion zod en cada insert). core/src/index.ts exporta ColonyDb.",
    "node_sqlite": "verificado funcional en Node 24 sin flag (emite un ExperimentalWarning inofensivo)",
    "tests": "8 nuevos (7 en memoria + 1 de persistencia en disco) - total 59 verdes",
    "checks": "build / typecheck / lint / test - todos en verde",
    "futureImprovement": "FI-001 registrado en DESIGN_DOC (seccion Mejoras Futuras): node:sqlite es experimental; si genera friccion, migrar a better-sqlite3 detras de la clase ColonyDb, que ya aisla la persistencia",
    "commit": "commit atomico feat(core) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 12,
  "complianceScore": 100
}
```

### Entry #15 - DG-014 (A) + B.2: Coordinator stage 1 - DG-012 B COMPLETO
```json
{
  "timestamp": "2026-05-21T11:05:00.000Z",
  "cycle": 8,
  "phase": 4,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-014": {
      "title": "Alcance del Coordinator stage 1",
      "selected": "Option A",
      "effect": "Coordinator stage 1 estricto + refactor del contrato ScoutAgent a core"
    },
    "refactor": "Contrato ScoutAgent/ScanRequest/ScoutResult/ScoutStatus movido de scouts a core/src/types/scout-agent.ts - evita la dependencia circular core<->scouts. scouts importa el contrato desde @synaptic-sentinel/core. Desviacion informada del andamio de Estructura_Repo.",
    "coordinator": "packages/core/src/coordinator/coordinator.ts - clase Coordinator: runScan() registra el Scan, corre los scouts inyectados en paralelo (Least Agency, v0.4 §9.6), persiste cada Finding como feromona finding en colony.db, marca el scan completo. Un scout que falla degrada el scan, no lo aborta (v0.4 §3.7).",
    "tests": "4 nuevos (Coordinator); scout-agent.test movido a core - total 63 verdes",
    "checks": "build / typecheck / lint / test - todos en verde",
    "milestone": "DG-012 B COMPLETO (B.1 capa colony.db + B.2 Coordinator). El sistema corre un scan end-to-end: scout -> findings -> persistencia de feromonas en la colony DB.",
    "commit": "commit atomico feat(core) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 13,
  "complianceScore": 100
}
```

### Entry #16 - DG-015 (A): CLI synaptic-sentinel scan
```json
{
  "timestamp": "2026-05-21T11:30:00.000Z",
  "cycle": 9,
  "phase": 4,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-015": {
      "title": "Proximo paso del roadmap",
      "selected": "Option A",
      "effect": "CLI synaptic-sentinel scan"
    },
    "files": "packages/cli/src/index.ts (entry point con parseArgs de node:util, comando scan), packages/cli/src/commands/scan.ts (runScanCommand + resolveOpenGrepBinary + formatOutcome), bin synaptic-sentinel. packages/scouts/src/opengrep/rules.ts exporta BASELINE_RULESET_PATH.",
    "verification_real": "synaptic-sentinel scan sobre las fixtures vulnerables: 4 hallazgos detectados (eval JS [HIGH], exec Python [HIGH], subprocess shell=True Python [HIGH], new Function TS [MEDIUM]); colony.db persistida; exit 0. --help OK.",
    "tests": "4 nuevos (CLI) - total 67 verdes",
    "checks": "build / typecheck / lint / test - todos en verde",
    "futureImprovement": "FI-005 registrado: el check_id de OpenGrep trae el prefijo de ruta cuando --config es un archivo; ruleId lo hereda. El CLI muestra title (nombre limpio de regla); evaluar normalizar ruleId en el normalizer.",
    "commit": "commit atomico feat(cli) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 14,
  "complianceScore": 100
}
```

### Entry #17 - DG-016 (B): reporters - tomo JSON
```json
{
  "timestamp": "2026-05-21T12:00:00.000Z",
  "cycle": 10,
  "phase": 5,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-016": {
      "title": "Proximo paso del roadmap",
      "selected": "Option B",
      "effect": "Paquete reporters - modelo del tomo + export JSON"
    },
    "files": "packages/reporters/src/tomo.ts (modelo Tomo con zod: metadata, summary, findings, methodology, integrity; buildTomo + verifyTomoIntegrity + canonicalHash). json-reporter.ts (renderTomoJson). CLI gana synaptic-sentinel scan --export <archivo>.",
    "integrity": "Firma SHA-256 sobre la forma canonica del cuerpo del tomo (v0.4 §4.2 - en todos los tiers); verifyTomoIntegrity detecta manipulacion del contenido",
    "verification_real": "synaptic-sentinel scan --export sobre las fixtures: tomo JSON exportado (4921 bytes) - 4 findings, summary bySeverity {high:3,medium:1} byCategory {SAST:4}, integrity sha256",
    "tests": "6 nuevos (tomo + json-reporter) - total 73 verdes",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "commit atomico feat(reporters,cli) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 15,
  "complianceScore": 100
}
```

### Entry #18 - DG-017 (A) + A.1: install-scanners soporta archivos; Gitleaks instalable
```json
{
  "timestamp": "2026-05-21T12:25:00.000Z",
  "cycle": 11,
  "phase": 5,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-017": {
      "title": "Proximo paso del roadmap",
      "selected": "Option A",
      "effect": "GitleaksScout - se ejecuta en 2 increments: A.1 (install-scanners con soporte de comprimidos + Gitleaks instalable), A.2 (el scout)"
    },
    "discovery": "Gitleaks v8.30.1 publica archivos comprimidos (.zip en Windows, .tar.gz en mac/linux), no binarios sueltos como OpenGrep. install-scanners necesitaba extraccion - hallazgo que agrando el alcance de DG-017 A.",
    "files": "scripts/install-scanners.ts: PlatformTarget.archive opcional; installScanner ramifica binario-suelto vs comprimido; extractArchive via tar (cross-platform: Windows 10+, macOS, Linux). scripts/scanners.manifest.json: entrada gitleaks v8.30.1 (5 plataformas, checksums SHA-256 oficiales del archivo).",
    "verification_real": "pnpm scanners:install descargo gitleaks_8.30.1_windows_x64.zip, verifico el checksum y extrajo con tar; gitleaks version => 8.30.1",
    "tests": "1 test nuevo (resolvePlatformTarget con archive)",
    "checks": "build / typecheck / lint / test (scripts) - verdes",
    "commit": "commit atomico feat(scripts) incluye este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 16,
  "complianceScore": 100
}
```

### Entry #19 - DG-018 (B) + A.2: GitleaksScout de punta a punta
```json
{
  "timestamp": "2026-05-21T12:40:00.000Z",
  "cycle": 12,
  "phase": 5,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-018": {
      "title": "Enfoque del GitleaksScout (DG-017 A.2)",
      "selected": "Option B",
      "effect": "GitleaksScout completo de punta a punta: scout + normalizer + fixture con un secreto real + test de integracion con Gitleaks real + wiring en el CLI (el Coordinator corre OpenGrep Y Gitleaks)"
    },
    "files": "packages/scouts/src/run-process.ts (NUEVO - runProcess compartido, extraido del scout de OpenGrep para evitar duplicacion). gitleaks/gitleaks-output.ts (schema zod de la salida JSON real de Gitleaks). gitleaks/normalizer.ts (Gitleaks -> Finding: severity high, category Secrets, complianceRefs CWE-798). gitleaks/gitleaks-scout.ts (GitleaksScout implements ScoutAgent, corre 'gitleaks dir' con --redact). opengrep-scout.ts (reutiliza runProcess compartido). cli/commands/scan.ts (resolveOpenGrepBinary -> resolveScannerBinary generico + buildScouts; el Coordinator recibe [OpenGrep, Gitleaks]). cli/index.ts (flag --gitleaks-bin).",
    "security": "Gitleaks se ejecuta con --redact: el valor del secreto NUNCA se persiste en colony.db ni en el tomo. Verificado en el tomo exportado: el snippet muestra 'awsAccessKey: REDACTED' y el valor real (AKIA...) no aparece en el archivo.",
    "verification_real": "synaptic-sentinel scan sobre un probe dir con vuln.js (eval()) + secrets.js (AWS key): 2 scout(s) corrieron - opengrep ok 1 hallazgo [HIGH] sentinel-js-eval-usage vuln.js:1, gitleaks ok 1 hallazgo [HIGH] generic-api-key secrets.js:2. Tomo exportado (5 keys); verifyTomoIntegrity => true; secreto filtrado en el tomo => false.",
    "tests": "12 nuevos (gitleaks normalizer 2, gitleaks-scout 6, integracion Gitleaks real 1, CLI resolveScannerBinary/buildScouts/platformBinary 3) - total 86 verdes (74 -> 86)",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "commit atomico feat(scouts,cli) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 17,
  "complianceScore": 100
}
```

### Entry #20 - DG-019 (A): Coordinator stage 2 - dedup + fp_known + ciclo de vida
```json
{
  "timestamp": "2026-05-21T13:05:00.000Z",
  "cycle": 13,
  "phase": 5,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-019": {
      "title": "Proximo paso del roadmap",
      "selected": "Option A",
      "effect": "Coordinator stage 2: deduplicacion por fingerprint, supresion de falsos positivos confirmados (fp_known) y clasificacion de ciclo de vida (new/known) en re-scans"
    },
    "files": "packages/core/src/types/fp-known.ts (NUEVO - FpKnownPayloadSchema zod + buildFpKnownPheromone, via canonica y validada para registrar un falso positivo). colony-db.ts (getKnownFingerprints(type) - lee payload.fingerprint via json_extract). coordinator.ts (metodo privado applyStage2: 1. fp_known => suprime, 2. duplicado intra-scan => suprime, 3. visto en scan anterior => lifecycle 'known'; ScanOutcome gana suppressedCount). cli/commands/scan.ts (formatOutcome muestra 'Suprimidos: N' y anota el ciclo de vida no-new).",
    "design": "El Coordinator CONSUME feromonas fp_known; la CREACION por el usuario (comando CLI / Brain Triage Agent) queda como FI-007. El tomo aun no declara suppressedCount => FI-006.",
    "verification_real": "synaptic-sentinel scan x3 sobre un probe (eval() + AWS key): scan 1 => 2 hallazgos 'new'; scan 2 (re-scan) => 2 hallazgos '(known)'; tras insertar un fp_known via buildFpKnownPheromone, scan 4 => 'Hallazgos: 1, Suprimidos: 1' (el secreto se suprime, el eval() persiste como known).",
    "tests": "8 nuevos (colony-db getKnownFingerprints 3, coordinator stage 2 4, CLI formatOutcome suprimidos/known 1) - total 94 verdes (86 -> 94)",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "commit atomico feat(core,cli) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 18,
  "complianceScore": 100
}
```

### Entry #21 - DG-020 (B): descubrimiento tecnico de la extension VSCode
```json
{
  "timestamp": "2026-05-21T13:30:00.000Z",
  "cycle": 14,
  "phase": 6,
  "action": "TECHNICAL_DISCOVERY",
  "details": {
    "context": "DG-020 B (extension VSCode MVP) elegido. Descubrimiento tecnico antes de implementar, para no asumir el riesgo node:sqlite del extension host (FI-001) - no optimismo ilusorio.",
    "findings": "1. Node del sistema v24.11.1 => node:sqlite disponible; la CLI corre standalone sin friccion. 2. packages/vscode-extension es solo scaffolding: src/index.ts es un stub de una linea; package.json con contributes vacio, sin @types/vscode ni bundler. 3. La CLI ya expone 'synaptic-sentinel scan --export <tomo.json>' - un camino de ejecucion completo y reutilizable. 4. La version de Node del extension host NO se pudo confirmar de forma fiable; engines.vscode ^1.95.0 admite hosts con Node 20.x (sin node:sqlite).",
    "conclusion": "La arquitectura de la extension no debe depender del Node del extension host. Se abre DG-021 - arquitectura de la extension MVP (spawn-CLI vs in-process vs in-process reactivo).",
    "phase_transition": "Phase 5 -> 6 (Inline UX)."
  },
  "outcome": "SUCCESS",
  "synapticStrength": 18,
  "complianceScore": 100
}
```

### Entry #22 - DG-021 (A): extension VSCode MVP (arquitectura spawn-CLI)
```json
{
  "timestamp": "2026-05-21T14:00:00.000Z",
  "cycle": 14,
  "phase": 6,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-021": {
      "title": "Arquitectura de la extension VSCode MVP",
      "selected": "Option A",
      "effect": "Extension VSCode MVP con arquitectura spawn-CLI: la extension lanza la CLI como child process, lee el tomo exportado y pinta los hallazgos como diagnostics inline. Completa el objetivo de DG-020 B."
    },
    "files": "packages/vscode-extension: package.json (manifest real - comando synaptic-sentinel.scanWorkspace, setting cliPath, script de bundle esbuild). src/index.ts (activate + comando + render de vscode.Diagnostic; unica capa que toca la API vscode). src/tomo.ts (schema zod minimo del tomo). src/cli-runner.ts (spawn de la CLI, kill-switch via AbortSignal). src/diagnostics.ts (mapeo puro Finding->DiagnosticInput). esbuild bundlea a dist/extension.cjs (CJS, vscode external). Root package.json: build = tsc -b && bundle.",
    "cli_fix": "Bug real hallado por el test de integracion (no optimismo ilusorio): la CLI resolvia .scanners/ relativo a process.cwd(), asi que al lanzarla con cwd en el proyecto escaneado no encontraba los scanners. Fix en cli/commands/scan.ts: findScannersRoot + resolveScannersSearchRoot suben desde el cwd y desde la propia ubicacion de la CLI.",
    "decoupling": "Verificado en el bundle: NO contiene node:sqlite ni @synaptic-sentinel/* - la extension es una capa UX delgada; el motor corre en el proceso de la CLI (Node del sistema). Esto neutraliza el riesgo FI-001 del extension host.",
    "verification_real": "build + lint + 110 tests verdes (94 -> 110, +16). Test de integracion: runCliScan lanza la CLI real contra un probe vulnerable y devuelve findings parseados -> DiagnosticInput. Bundle: 130KB, CJS valido, require('vscode') external.",
    "verification_gap": "La conducta en vivo del extension host (activate/comando/render de diagnostics) NO se verifica de forma automatizada: requiere ejecutar la extension en un Extension Development Host (F5). El codigo glue se valida por compilacion + bundle.",
    "tests": "16 nuevos (vscode-extension: tomo 4, diagnostics 7, cli-runner 2 + 1 integracion; cli findScannersRoot 2) - total 110 verdes",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "commit atomico feat(vscode-extension,cli) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 19,
  "complianceScore": 100
}
```

### Entry #23 - DG-022 (B): cierre del lazo Inline UX (mark-fp + Code Action)
```json
{
  "timestamp": "2026-05-21T14:30:00.000Z",
  "cycle": 15,
  "phase": 6,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-022": {
      "title": "Proximo paso del roadmap",
      "selected": "Option B",
      "effect": "Cierra el lazo Inline UX: comando CLI mark-fp + Code Action 'marcar falso positivo' en la extension + status bar. Cierra FI-007 (via de creacion de feromonas fp_known)."
    },
    "files": "cli: commands/mark-fp.ts (NUEVO - runMarkFpCommand: valida que exista el hallazgo, idempotente, registra fp_known via buildFpKnownPheromone). index.ts (dispatch del comando mark-fp). core: ColonyDb.getPheromonesByFingerprint (json_extract). vscode-extension: tomo.ts (+fingerprint en el schema), diagnostics.ts (+findingsInRange, +fingerprint en DiagnosticInput), cli-runner.ts (refactor a spawnCli generico + runCliMarkFp), index.ts (CodeActionProvider 'marcar falso positivo' + comando interno markFalsePositive + status bar).",
    "loop": "El Code Action de la extension dispara runCliMarkFp -> CLI mark-fp -> feromona fp_known -> el Coordinator (stage 2, DG-019) la suprime en el proximo scan. Cierra el lazo que DG-019 dejo abierto (consumia fp_known pero no habia forma de crearlos).",
    "verification_real": "End-to-end con la CLI real: scan (2 hallazgos) -> mark-fp del secreto -> mark-fp de nuevo ('ya estaba marcado', idempotencia OK) -> re-scan: 'Hallazgos: 1, Suprimidos: 1' (secreto suprimido, eval persiste como known). Bundle: 134KB, sin node:sqlite ni @synaptic-sentinel, vscode external.",
    "verification_gap": "El Code Action y el status bar en vivo requieren un Extension Development Host (F5); se validan por compilacion + bundle + unit tests de la logica pura (findingsInRange).",
    "tests": "9 nuevos (cli mark-fp 4, core getPheromonesByFingerprint 1, vscode-extension findingsInRange 2 + tomo/cli-runner 2) - total 119 verdes (110 -> 119)",
    "checks": "build / typecheck / lint / test - todos en verde",
    "resolves": "FI-007 (creacion de fp_known) queda cerrado.",
    "commit": "commit atomico feat(cli,vscode-extension,core) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 20,
  "complianceScore": 100
}
```

### Entry #24 - DG-023 (A): tomo HTML + suppressedCount (FI-006)
```json
{
  "timestamp": "2026-05-21T15:00:00.000Z",
  "cycle": 16,
  "phase": 6,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-023": {
      "title": "Proximo paso del roadmap",
      "selected": "Option A",
      "effect": "Reporter HTML del tomo (auditoria legible y compartible, v0.4 §4.3) + suppressedCount en el resumen del tomo (FI-006)."
    },
    "files": "reporters/src/html-reporter.ts (NUEVO - renderTomoHtml + escapeHtml; HTML autocontenido, sin recursos externos; todo el contenido dinamico se escapa). tomo.ts (TomoSummary gana suppressedCount, tomado de outcome.suppressedCount - FI-006). reporters/index.ts (export). cli/commands/scan.ts (opcion exportHtmlPath; el tomo se construye una vez y se exporta a JSON y/o HTML). cli/index.ts (flag --export-html).",
    "scope_note": "MVP: HTML legible para mostrar a un stakeholder/CISO (v0.4 linea 489). El HTML 'elaborado' (navegacion, links, copy-paste de patches) queda como Pro (v0.4 linea 616).",
    "security": "El reporte de una herramienta de seguridad no debe poder inyectar HTML a partir de los hallazgos: todo el contenido dinamico pasa por escapeHtml. Verificado: un message con <script> se renderiza escapado.",
    "verification_real": "synaptic-sentinel scan --export-html sobre un probe (eval + AWS key): HTML de 4643 bytes, empieza con <!doctype html>, autocontenido (sin <link> ni src externo), con los 2 hallazgos + el hash de integridad; el valor del secreto (AKIA...) NO aparece en el HTML.",
    "tests": "4 nuevos (html-reporter: escapeHtml 1 + renderTomoHtml 3; tomo: assercion de suppressedCount) - total 123 verdes (119 -> 123)",
    "checks": "build / typecheck / lint / test - todos en verde",
    "resolves": "FI-006 (suppressedCount en el tomo) queda cerrado.",
    "commit": "commit atomico feat(reporters,cli) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 21,
  "complianceScore": 100
}
```

### Entry #25 - DG-024 (B): Brain Layer increment 1 (paquete agents + Triage Agent)
```json
{
  "timestamp": "2026-05-21T15:30:00.000Z",
  "cycle": 17,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-024": {
      "title": "Proximo paso del roadmap",
      "selected": "Option B",
      "effect": "Brain Layer increment 1: paquete agents (capa Cerebro) - contrato BrainAgent + frontera LlmClient + AnthropicLlmClient (BYOK) + un Triage Agent minimo."
    },
    "files": "packages/agents/src: llm-client.ts (interfaz LlmClient - frontera no-determinista). anthropic-client.ts (AnthropicLlmClient via fetch; buildAnthropicRequest + parseAnthropicResponse son funciones puras). brain-agent.ts (contrato BrainAgent = prompt + parser, NO microservicio; runAgent es la unica funcion que cruza la frontera). triage-agent.ts (TriageAgent implements BrainAgent<Finding,TriageVerdict>; TriageVerdictSchema zod; extractJsonObject tolerante a fences/prosa). package.json (+zod).",
    "design": "Agentes = prompts especializados + parser, no microservicios (v0.4 §137). La respuesta del LLM es entrada no confiable: se valida con zod antes de usarse (Memory Poisoning, OWASP ASI 2026). BYOK: la API key la provee el cliente y va directo a Anthropic, sin backend de Synaptic - respeta el invariante de perimetro.",
    "deviation": "DESVIACION INFORMADA del v0.4 (linea 695, @anthropic-ai/sdk): cliente Anthropic propio via fetch. Razon: testabilidad total (request/response como funciones puras) + cero dependencias de red, consistente con DG-013. El contrato LlmClient aisla un cambio futuro al SDK -> FI-009.",
    "verification_real": "22 tests con LlmClient/fetch falsos (deterministas, sin red): buildAnthropicRequest, parseAnthropicResponse, AnthropicLlmClient.complete, runAgent, extractJsonObject, TriageAgent buildPrompt/parseResponse. Demo manual: el USER PROMPT generado y un triage de punta a punta con un LLM simulado (veredicto parseado + validado).",
    "verification_gap": "La llamada REAL a la API de Anthropic NO se verifica aqui: no hay ANTHROPIC_API_KEY en el entorno. Test de integracion gated, omitido (1 skipped). El wiring a CLI/Coordinator (stage 3 de triage) queda como increment 2.",
    "tests": "22 nuevos (anthropic-client 8, brain-agent 2, triage-agent 12) - total 145 verdes + 1 skipped",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "commit atomico feat(agents) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 22,
  "complianceScore": 100
}
```

### Entry #26 - DG-025 (A): Brain Layer increment 2 (comando CLI triage)
```json
{
  "timestamp": "2026-05-21T16:00:00.000Z",
  "cycle": 18,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-025": {
      "title": "Proximo paso del roadmap",
      "selected": "Option A",
      "effect": "Brain Layer increment 2: comando CLI triage - corre el Triage Agent sobre los hallazgos del ultimo scan (BYOK), pheromone-aware, y persiste los veredictos en colony.db."
    },
    "design_decision": "Persistencia de veredictos en una tabla dedicada triage_verdicts (schema v2). Cambio ADITIVO via CREATE TABLE IF NOT EXISTS - cero riesgo de migracion. Se descarto agregar un tipo de feromona 'triage' porque exigiria reconstruir el CHECK de la tabla pheromones (SQLite no permite ALTER de un CHECK). Pequena desviacion informada del v0.4 linea 215 (pheromone[triage_result]).",
    "files": "core/types/triage.ts (NUEVO - TriageVerdict/TriageVerdictRecord schemas; movidos desde agents porque se persisten en colony.db). schema.sql (tabla triage_verdicts + indices, schema_version 2). colony-db.ts (open() sincroniza la version; insertTriageVerdicts, getTriagedFingerprints, getLatestScanId). agents/triage-agent.ts (importa los tipos de triage desde core y los reexporta; zod removido de agents). cli/commands/triage.ts (NUEVO - runTriageCommand con LlmClient inyectable). cli/index.ts (dispatch triage + --limit). El paquete cli ahora depende de agents (Pro); el split OSS/Pro en publish lo maneja publish-oss.ts (DG-001).",
    "token_economy": "Pheromone-aware (v0.4 §187): salta los hallazgos con fp_known y los ya triados. Limite por defecto de 25 hallazgos por corrida (proteccion de costo/tokens), ampliable con --limit.",
    "verification_real": "16 tests con un LlmClient falso (flujo completo: lee findings, salta fp_known/ya-triados, corre el agente, persiste). End-to-end: scan crea colony.db v2; migracion v1->v2 verificada (base degradada a v1 y reabierta -> v2 + tabla recreada); triage sin ANTHROPIC_API_KEY -> error limpio + exit 1.",
    "verification_gap": "La llamada REAL a la API de Anthropic (triage con una API key valida) no se verifica aqui - no hay ANTHROPIC_API_KEY en el entorno.",
    "tests": "16 nuevos (core/types/triage 7, colony-db triage 4, cli/triage 5) - total 161 verdes + 1 skipped",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "commit atomico feat(cli,core,agents) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 23,
  "complianceScore": 100
}
```

### Entry #27 - DG-026 (A): surface del triage en el tomo
```json
{
  "timestamp": "2026-05-21T16:30:00.000Z",
  "cycle": 19,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-026": {
      "title": "Proximo paso del roadmap",
      "selected": "Option A",
      "effect": "Surface del triage en el tomo: cada hallazgo del tomo (JSON + HTML) lleva su veredicto de triage, mas un conteo byTriage en el resumen."
    },
    "files": "core/colony-db.ts (getTriageVerdicts + rowToTriageVerdict). reporters/tomo.ts (TomoFindingSchema = Finding + triage opcional; TomoSummary gana byTriage; buildTomo acepta triageVerdicts y hace join por fingerprint). reporters/html-reporter.ts (renderTriage: badge + rationale por hallazgo; seccion 'Por triage' en el resumen). cli/commands/scan.ts (scan --export pasa db.getTriageVerdicts() a buildTomo).",
    "flow": "El triage corre como comando aparte y persiste los veredictos; el siguiente scan --export los adjunta al tomo via join por fingerprint (estable entre scans). El v0.4 §4.3: el HTML es para el stakeholder/CISO - ver un hallazgo triado (TP/FP) es lo que necesita.",
    "verification_real": "4 tests nuevos. End-to-end: scan -> sembrar un veredicto de triage en colony.db -> scan --export/--export-html: el tomo JSON lleva findings[].triage (true_positive/0.93) + summary.byTriage; el HTML muestra 'Triage: verdadero positivo', el rationale y la seccion 'Por triage'.",
    "ancillary_fix": "Corregido un flake del test de integracion de OpenGrep: timeout 30s -> 60s. El binario es lento y bajo la concurrencia del suite completo excedia 30s (aislado tardo 22-24s). Es FI-002 (separar test:unit / test:integration); el bump del timeout estabiliza el suite mientras tanto.",
    "tests": "4 nuevos (colony-db getTriageVerdicts 1, tomo triage 2, html-reporter triage 1) - total 165 verdes + 1 skipped",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "commit atomico feat(reporters,core,cli) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 24,
  "complianceScore": 100
}
```

### Entry #28 - DG-027 (B): triage en la extension VSCode (BYOK + SecretStorage)
```json
{
  "timestamp": "2026-05-21T17:00:00.000Z",
  "cycle": 20,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-027": {
      "title": "Proximo paso del roadmap",
      "selected": "Option B",
      "effect": "Triage en la extension VSCode: comando 'Triage Findings' (BYOK via SecretStorage), comando 'Set Anthropic API Key', y los veredictos de triage anotados en los diagnostics del IDE."
    },
    "files": "vscode-extension: cli-runner.ts (runCliTriage; spawnCli gana soporte de env). tomo.ts (ExtensionFinding gana triage opcional). diagnostics.ts (findingToDiagnosticInput anota el veredicto en el mensaje; triageLabel). index.ts (comandos triageWorkspace + setAnthropicApiKey; BYOK via context.secrets/SecretStorage; status bar 'triando'). package.json (2 comandos contribuidos).",
    "flow": "setAnthropicApiKey guarda la key en el almacen de secretos de VSCode (cifrado por el SO). triageWorkspace: lee la key, lanza la CLI 'triage' y re-escanea para refrescar los diagnostics con los veredictos (el tomo los incluye desde DG-026). Cubre el v0.4 §487: 'BYOK configurable via VSCode SecretStorage'.",
    "security": "La API key se guarda en SecretStorage (cifrada por el SO), nunca en la configuracion ni en texto plano. Se pasa al child process por ENTORNO (ANTHROPIC_API_KEY), nunca por argumentos - no debe aparecer en la lista de procesos.",
    "verification_real": "6 tests nuevos. Bundle verificado: sin node:sqlite ni @synaptic-sentinel, vscode external, triageWorkspace/secrets/ANTHROPIC_API_KEY presentes. Contrato BYOK verificado end-to-end: la CLI triage sin la env var -> exit 1; con ANTHROPIC_API_KEY -> pasa el chequeo de key e intenta el triage.",
    "verification_gap": "La conducta en vivo de la extension (comandos, UI de SecretStorage, withProgress) requiere un Extension Development Host (F5). El triage real con una API key valida de Anthropic no se verifica aqui.",
    "tests": "6 nuevos (cli-runner runCliTriage 1, tomo triage 2, diagnostics triage/triageLabel 3) - total 171 verdes + 1 skipped",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "commit atomico feat(vscode-extension) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 25,
  "complianceScore": 100
}
```

### Entry #29 - DG-028 (B): Context Agent (2.o agente del Brain Layer)
```json
{
  "timestamp": "2026-05-21T17:30:00.000Z",
  "cycle": 21,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-028": {
      "title": "Proximo paso del roadmap",
      "selected": "Option B",
      "effect": "Context Agent: 2.o agente del Brain Layer - explica la cadena de explotabilidad (entrada -> sink -> exposicion) de un hallazgo confirmado (v0.4 §3.6)."
    },
    "files": "core/types/context.ts (NUEVO - ContextExplanationSchema, junto a TriageVerdict). agents/brain-agent.ts (extractJsonObject movido aqui - util compartido por los agentes). agents/triage-agent.ts (usa el extractJsonObject compartido). agents/context-agent.ts (NUEVO - ContextAgent implements BrainAgent<Finding,ContextExplanation>). agents/index.ts (export).",
    "design": "2.o agente reusando el contrato BrainAgent/LlmClient/runAgent ya de-riskeado en DG-024. La salida del LLM se valida con zod (anti Memory Poisoning). Sin wiring al pipeline todavia (mismo patron que DG-024 increment 1: el agente primero, el wiring despues).",
    "verification_real": "9 tests nuevos con LlmClient falso (buildPrompt, parseResponse, runAgent; ContextExplanationSchema). Demo del artefacto: el system prompt generado y una explicacion de punta a punta con un LLM simulado (4 campos: summary/entryPoint/sink/exposure parseados + validados).",
    "verification_gap": "La llamada REAL a la API de Anthropic no se verifica aqui - no hay ANTHROPIC_API_KEY. Test de integracion gated, omitido (2 skipped en total con el de triage). El wiring del Context Agent al pipeline queda pendiente.",
    "tests": "9 nuevos (core context 3, agents context-agent 6; extractJsonObject reubicado de triage a brain-agent) - total 180 verdes + 2 skipped",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "commit atomico feat(agents,core) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 26,
  "complianceScore": 100
}
```

### Entry #30 - DG-029 (A): wire del Context Agent al pipeline
```json
{
  "timestamp": "2026-05-21T18:00:00.000Z",
  "cycle": 22,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-029": {
      "title": "Proximo paso del roadmap",
      "selected": "Option A",
      "effect": "Wire del Context Agent: el comando triage corre el Context Agent sobre los true positives; las explicaciones se persisten (schema v3) y se surfacean en el tomo (JSON + HTML)."
    },
    "files": "core/types/context.ts (ContextExplanationRecordSchema). schema.sql (tabla context_explanations, schema v3 - cambio aditivo). colony-db.ts (insertContextExplanations, getContextExplanations; open() sincroniza v3). cli/commands/triage.ts (corre el Context Agent sobre los TP del triage, persiste). reporters/tomo.ts (buildTomo refactorizado: el 4.o parametro pasa de un array a un objeto TomoEnrichment {triageVerdicts?, contextExplanations?}; TomoFinding gana context; join por fingerprint). reporters/html-reporter.ts (renderContext). cli/scan.ts (pasa contextExplanations a buildTomo).",
    "design": "El Context Agent corre solo sobre los verdaderos positivos del triage (v0.4 §3.6 stage 4). Un fallo de contexto no descarta el veredicto de triage (catch interno). buildTomo pasa a un objeto enrichment - extensible para futuros agentes sin mas parametros posicionales. Schema v3: tabla dedicada, cambio aditivo (cero riesgo de migracion, igual que v2).",
    "verification_real": "7 tests nuevos. End-to-end: scan -> triage corre triage+context (1 veredicto, 1 explicacion persistidos) -> scan --export: el tomo JSON lleva findings[].context (sink + exposure) y findings[].triage; el HTML muestra 'Contexto:' y la cadena entrada/sink/exposicion.",
    "verification_gap": "La llamada REAL a Anthropic (triage+context con API key) no se verifica aqui. Tests de integracion gated, omitidos (2 skipped).",
    "tests": "7 nuevos (colony-db context 3, core ContextExplanationRecord 2, tomo context 1, html-reporter context 1) - total 187 verdes + 2 skipped",
    "checks": "build / typecheck / lint / test - todos en verde",
    "housekeeping": ".claude/ (directorio de la herramienta) agregado a .gitignore.",
    "commit": "commit atomico feat(core,cli,reporters) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 27,
  "complianceScore": 100
}
```

### Entry #31 - DG-030 (A): TrivyScout (cuarto scout, cobertura SCA)
```json
{
  "timestamp": "2026-05-21T18:30:00.000Z",
  "cycle": 23,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-030": {
      "title": "Proximo paso del roadmap",
      "selected": "Option A",
      "effect": "Cuarto scout: Trivy (SCA - dependencias vulnerables). El Coordinator corre 3 scouts; el Brain Layer (Triage/Context) aplica gratis a los hallazgos SCA."
    },
    "files": "scouts/src/trivy: trivy-output.ts (schema zod de la salida JSON de Trivy), normalizer.ts (Trivy -> Finding categoria SCA; severidad mapeada, complianceRefs con CVE + CWE), trivy-scout.ts (TrivyScout implements ScoutAgent). scouts/index.ts. scanners.manifest.json (Trivy v0.70.0, 5 plataformas, checksums SHA-256 oficiales de GitHub Releases). cli/scan.ts (buildScouts agrega TrivyScout; ScanCommandOptions.trivyBin) + index.ts (flag --trivy-bin).",
    "fix_colateral": "install-scanners.ts: extractArchive corregido. El `tar` de Windows resuelve de forma inconsistente (GNU tar de Git interpreta `D:\\...` como un host remoto -> 'Cannot connect to D:'). Ahora la extraccion de .zip en Windows usa PowerShell Expand-Archive; .tar.gz (Unix) sigue con tar. Surgido al instalar Trivy - no optimismo ilusorio.",
    "design": "Trivy gestiona su propia base de datos de vulnerabilidades: la descarga en la primera corrida y la cachea (~/.cache/trivy). Bajo Norton 360, la descarga de la DB funciono (el cliente HTTP de Go usa el almacen de certificados de Windows nativamente).",
    "verification_real": "Trivy v0.70.0 instalado (extraccion corregida verificada). Test de integracion con Trivy real: detecta lodash 4.17.20 vulnerable en un package-lock.json. End-to-end: synaptic-sentinel scan corre 3 scout(s) -> opengrep 1, gitleaks 0, trivy 5 hallazgos SCA (CVEs reales de lodash). 10 tests nuevos.",
    "tests": "10 nuevos (trivy normalizer 3, trivy-scout 6, integracion 1) - total 197 verdes + 2 skipped",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "commit atomico feat(scouts,cli,scripts) incluye codigo, tests y este registro"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 28,
  "complianceScore": 100
}
```

### Entry #32 - DG-031 (A): CheckovScout (quinto scout, cobertura IaC)
```json
{
  "timestamp": "2026-05-21T19:00:00.000Z",
  "cycle": 24,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-031": {
      "title": "Proximo paso del roadmap",
      "selected": "Option A",
      "effect": "Quinto scout: Checkov (IaC - misconfiguraciones en Dockerfile / Terraform / Kubernetes). El Coordinator corre 4 scouts; el Brain Layer (Triage/Context) aplica gratis a los hallazgos IaC."
    },
    "files": "scouts/src/checkov: checkov-output.ts (schema zod de la salida JSON de Checkov - union objeto|array de reportes por framework), normalizer.ts (normalizeCheckovOutput -> Finding categoria IaC; la severidad null de Checkov OSS se asume medium), checkov-scout.ts (CheckovScout implements ScoutAgent; `checkov -d -o json --compact --quiet --soft-fail`). scouts/index.ts (export). cli/scan.ts (buildScouts agrega CheckovScout; ScanCommandOptions.checkovBin) + index.ts (flag --checkov-bin). scanners.manifest.json (Checkov 3.2.529, 4 plataformas, checksums SHA-256 oficiales de GitHub Releases, archiveDir 'dist').",
    "fix_colateral": "install-scanners.ts: extractArchive ampliado - extraccion de .zip en Unix con `unzip` (GNU tar no extrae .zip); nuevo campo ScannerSpec.archiveDir que aplana el binario empaquetado bajo un subdirectorio (Checkov empaqueta checkov.exe bajo dist/). Surgido al instalar Checkov - no optimismo ilusorio.",
    "design": "Checkov OSS no asigna severidad (emite severity:null): el normalizer asume `medium` como criticidad por defecto de una misconfiguracion de IaC; el Brain Layer la afina. `--soft-fail` fuerza exit 0 aun con checks fallidos (un scan con hallazgos no es un fallo del scout). El binario standalone (PyInstaller onefile) sortea la observacion 'Python 3.14 vs Checkov' del contextNotes: no requiere un interprete de Python en el cliente.",
    "verification_real": "Checkov 3.2.529 instalado (extraccion .zip + aplanado de dist/ verificados). Fixture Dockerfile vulnerable + captura JSON real del binario. Test de integracion con Checkov real: detecta CKV_DOCKER_2 (sin HEALTHCHECK) y CKV_DOCKER_3 (corre como root). End-to-end: synaptic-sentinel scan corre 4 scout(s) -> opengrep 0, gitleaks 0, trivy 0, checkov 2 hallazgos IaC (MEDIUM).",
    "tests": "11 nuevos (checkov normalizer 4, checkov-scout 6, integracion 1; scan.test buildScouts actualizado a 4 scouts) - total 208 verdes + 2 skipped",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "codigo + tests en el commit 883c7ee feat(scouts,cli,scripts); el registro SYNAPTIC de cierre del Cycle 24 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 29,
  "complianceScore": 100
}
```

### Entry #33 - DG-032 (B): VibeDetectScout (quinto scout, deteccion de codigo vibe-coded)
```json
{
  "timestamp": "2026-05-21T19:45:00.000Z",
  "cycle": 25,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-032": {
      "title": "Proximo paso del roadmap",
      "selected": "Option B",
      "effect": "Quinto scout: Vibe-Detect (categoria VibeCoded - anti-patrones de codigo generado por IA aceptado sin revision). Es el scout firma del producto vibe-coding-native. El Coordinator corre 5 scouts."
    },
    "files": "scouts/src/vibe-detect: detectors.ts (catalogo curado de 6 detectores heuristicos regex), detect.ts (runVibeDetectors -> Finding[] categoria VibeCoded, funcion pura testeable contra strings), vibe-detect-scout.ts (VibeDetectScout implements ScoutAgent + recorrido propio del arbol de archivos). scouts/index.ts (export). cli/scan.ts (buildScouts incluye SIEMPRE VibeDetectScout; un aviso de 'sin scanner externo' reemplaza al antiguo error 'sin scanner', ahora inalcanzable). cli/tests/scan.test.ts (buildScouts -> 5 scouts).",
    "design": "A diferencia de los 4 scouts previos, Vibe-Detect NO envuelve un binario OSS: es deteccion nativa en TypeScript (regex linea a linea sobre un walker propio). Desviacion informada del doc del paquete ('wrappers de scanners OSS'): el contrato ScoutAgent no obliga a spawnear un proceso. Ventaja: siempre disponible, 100% determinista y verificable sin dependencias externas ni API key. Catalogo deliberadamente conservador (6 detectores de alta confianza: secreto placeholder, control de seguridad suprimido, TODO de seguridad, CORS abierto, verificacion TLS deshabilitada, modo debug fijo) para minimizar falsos positivos. La categoria VibeCoded ya existia en el schema sin uso.",
    "verification_real": "End-to-end: synaptic-sentinel scan corre 5 scout(s) sobre el fixture vibe-coded -> vibe-detect detecta los 7 anti-patrones esperados con sus lineas exactas (config.py:6,7,11,12 y server.js:9,13,15); los otros 4 scouts 0. 12 tests nuevos (deteccion pura + scan sobre un arbol real de archivos).",
    "fix_colateral": "cli-runner.test.ts: el test de integracion arranca en frio 4 binarios externos via la CLI; con Checkov (onefile de PyInstaller) la corrida llega a ~45-58s y bajo la suite completa excedia el timeout de 60s. Subido a 120s (en linea con FI-002: separar test:unit/test:integration). No optimismo ilusorio: se verifico en aislamiento que el test pasa (45s) antes de atribuirlo a contencion de CPU.",
    "tests": "12 nuevos (vibe-detect detect 8, vibe-detect-scout 4; +1 buildScouts) - total 221 verdes + 2 gated",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "codigo + tests en el commit b346142 feat(scouts,cli); el registro SYNAPTIC de cierre del Cycle 25 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 30,
  "complianceScore": 100
}
```

### Entry #34 - VERIFICATION: cierre del gap historico de la llamada LLM real
```json
{
  "timestamp": "2026-05-21T19:50:00.000Z",
  "cycle": 25,
  "phase": 7,
  "action": "VERIFICATION",
  "details": {
    "subject": "Cierre del gap historico: llamada REAL a la API de Anthropic (Brain Layer)",
    "context": "Desde DG-024 (Entry #25) cada entrada del Brain Layer declaro honestamente el mismo gap: las llamadas reales a Anthropic no se verificaban por falta de ANTHROPIC_API_KEY; los 2 tests de integracion quedaban gated/skipped. El usuario proporciono una API key (BYOK) para cerrarlo.",
    "procedure": "La key se uso de forma transitoria como variable de entorno ANTHROPIC_API_KEY: nunca en un archivo, nunca commiteada, no persistida en memoria. Se corrieron los 2 tests gated (triage-agent.integration, context-agent.integration). La llamada de red requirio deshabilitar el sandbox de red del entorno de ejecucion: el primer intento fallo con UND_ERR_CONNECT_TIMEOUT (timeout de conexion TCP, no un error de auth ni de credito).",
    "result": "AMBOS tests PASARON contra la API real de Anthropic (modelo Haiku 4.5): TriageAgent devolvio un veredicto valido (1716ms), ContextAgent una explicacion valida (2539ms). El round-trip completo (AnthropicLlmClient -> Messages API -> parseo -> validacion zod) queda verificado. Costo aproximado USD 0.01 (2 llamadas Haiku).",
    "recomendacion": "La API key quedo expuesta en el historial del chat; se recomendo al usuario revocarla/rotarla al cerrar la sesion.",
    "gap_status": "CERRADO. El gap de 'llamada LLM real' deja de declararse en las entradas del Brain Layer. Persiste el gap de la extension VSCode en vivo (F5)."
  },
  "outcome": "SUCCESS",
  "synapticStrength": 30,
  "complianceScore": 100
}
```

### Entry #35 - DG-033 (A): Remediation Agent (3.er agente del Brain Layer)
```json
{
  "timestamp": "2026-05-21T20:15:00.000Z",
  "cycle": 26,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-033": {
      "title": "Proximo paso del roadmap",
      "selected": "Option A",
      "effect": "Tercer y ultimo agente de la capa Cerebro: Remediation Agent. Propone como corregir un hallazgo confirmado como verdadero positivo. Completa el trio Triage -> Context -> Remediation (v0.4 §3.6)."
    },
    "files": "core/types/remediation.ts (NUEVO - RemediationSuggestion + RemediationSuggestionRecord). core/types/index.ts (export). core/colony/schema.sql (tabla aditiva remediation_suggestions, schema v4). core/colony/colony-db.ts (insert/getRemediationSuggestions, rowToRemediationSuggestion, migracion v4 idempotente). agents/remediation-agent.ts (NUEVO - RemediationAgent implements BrainAgent<Finding,RemediationSuggestion>). agents/index.ts (export). cli/commands/triage.ts (corre el Remediation Agent sobre los TP, persiste). cli/commands/scan.ts (pasa remediationSuggestions a buildTomo). reporters/tomo.ts (TomoFinding gana remediation; join por fingerprint). reporters/html-reporter.ts (renderRemediation + CSS).",
    "design": "3.er agente reusando el contrato BrainAgent/LlmClient/runAgent ya probado x2. fixedSnippet es opcional: muchas remediaciones son de configuracion o de proceso, sin snippet de codigo. dropEmptySnippet normaliza el 'fixedSnippet':'' que el LLM devuelve a veces. Schema v4: tabla dedicada aditiva, cero riesgo de migracion (mismo patron que v2/v3). Un fallo de remediacion no descarta el veredicto de triage (degraded > failed).",
    "verification_real": "RemediationAgent probado contra la API REAL de Anthropic (Haiku 4.5, test de integracion gated, corrido con la API key del usuario). E2E: scan del probe -> triage --limit 1 (eval-vuln.js clasificado true_positive 0.95; corrieron Context y Remediation) -> scan --export-html: el tomo HTML incluye el bloque de remediacion con su snippet. 21 tests nuevos.",
    "tests": "21 nuevos (core remediation 6, agents remediation-agent 8 + integracion 1 gated, colony-db 4, tomo 1, html-reporter 1) - total 241 verdes + 3 gated",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "codigo + tests en el commit bf98624 feat(core,agents,cli,reporters); el registro SYNAPTIC de cierre del Cycle 26 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 31,
  "complianceScore": 100
}
```

### Entry #36 - DG-034 (B): surface del Brain Layer completo en la extension VSCode
```json
{
  "timestamp": "2026-05-21T20:30:00.000Z",
  "cycle": 27,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-034": {
      "title": "Proximo paso del roadmap",
      "selected": "Option B",
      "effect": "Surface del Brain Layer completo en la extension VSCode: contexto + remediacion visibles en el hover de los diagnostics, mas una Code Action de remediacion. La extension queda F5-testeable."
    },
    "files": "vscode-extension/src/tomo.ts (ExtensionFinding gana context + remediation, forma minima). vscode-extension/src/diagnostics.ts (findingHoverMarkdown + remediationClipboardText, funciones puras). vscode-extension/src/index.ts (HoverProvider + comando interno copyRemediation + Code Action de remediacion). .vscode/launch.json (NUEVO - configuracion Extension Development Host).",
    "design": "El hover usa un HoverProvider dedicado (Markdown rico) en vez de alargar el mensaje del diagnostic. La Code Action COPIA la remediacion al portapapeles en lugar de insertarla en el buffer: la salida del Remediation Agent es orientativa, no un patch verificado; volcarla al codigo (como codigo o como comentario) seria inseguro o ruido. Decision honesta documentada (no optimismo ilusorio).",
    "verification_real": "build / typecheck / lint / test verdes. 9 tests nuevos (logica pura del hover, del texto de portapapeles, y captura de context/remediation en parseTomo - el contrato CLI->extension). .vscode/launch.json creado: la extension ya es F5-testeable, cerrando el blocker senalado al usuario.",
    "verification_gap": "La UI en vivo (HoverProvider y Code Action disparandose en el IDE) no se ejecuto aqui - requiere F5 / Extension Development Host. Ahora desbloqueado por launch.json: el usuario puede probarla.",
    "tests": "9 nuevos (findingHoverMarkdown 4, remediationClipboardText 3, parseTomo context/remediation 2) - total 250 verdes + 3 gated",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "codigo + tests en el commit ee59c74 feat(vscode-extension); el registro SYNAPTIC de cierre del Cycle 27 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 32,
  "complianceScore": 100
}
```

### Entry #37 - DG-035 (A): documento de onboarding
```json
{
  "timestamp": "2026-05-21T20:45:00.000Z",
  "cycle": 28,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-035": {
      "title": "Proximo paso del roadmap",
      "selected": "Option A",
      "effect": "Documento de onboarding - deliverable del roadmap 'Output & Polish'. El producto queda usable sin leer el codigo fuente."
    },
    "files": "ONBOARDING.md (NUEVO - guia completa: que es, requisitos, instalacion pnpm install/scanners:install/build, uso de la CLI scan/mark-fp/triage, la extension VSCode F5, el tomo, la arquitectura, desarrollo y troubleshooting). README.md (actualizado al estado real: 5 scouts, Brain Layer con 3 agentes, quickstart con scanners:install, tabla de paquetes con las licencias reales - 6 OSS Apache-2.0 + agents Pro). docs/colony-db.md (tabla de tablas al dia: triage_verdicts v2, context_explanations v3, remediation_suggestions v4).",
    "design": "Documentacion: solo hechos verificados contra el repo (comandos, rutas, flags, los 5 scouts, los 3 agentes, F5). No se reclama lo no hecho (.vsix pendiente = FI-008; se documenta el modo desarrollo via F5).",
    "verification_real": "Los 3 archivos quedan Prettier-clean (prettier --check verde sobre ellos). DG-035 no toca codigo: build/lint/test sin cambios respecto del ultimo verde (250/250, DG-034).",
    "hallazgo": "format:check (que NO estaba en el gate de verificacion por ciclo - el gate era build+lint+test) revela drift de Prettier preexistente en ~41 archivos mas, acumulado en ciclos previos. Registrado como FI-010; no se corrige aqui (fuera del alcance de un ciclo de docs - seria un commit no-atomico de 41 archivos). No optimismo ilusorio: se reporta el drift en vez de ocultarlo.",
    "observacion": "Aparecieron directorios extranos en packages/vscode-extension/ (.synaptic/, .vscode/synaptic/, context/) - una re-inicializacion del tooling SYNAPTIC al abrir la subcarpeta de la extension en VSCode. NO se commitearon (git add con rutas explicitas). A limpiar / gitignorar.",
    "tests": "sin tests nuevos (ciclo de documentacion) - total 250 verdes + 3 gated, sin cambios",
    "checks": "format:check de los 3 archivos verde; build/lint/test sin cambios (no se toco codigo)",
    "commit": "los 3 documentos en el commit 7a33d6f docs; el registro SYNAPTIC de cierre del Cycle 28 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 33,
  "complianceScore": 100
}
```

### Entry #38 - DG-036 (B): kill-switch del Coordinator (presupuesto de tiempo por scout)
```json
{
  "timestamp": "2026-05-21T21:10:00.000Z",
  "cycle": 29,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-036": {
      "title": "Proximo paso del roadmap",
      "selected": "Option B",
      "effect": "Kill-switch del Coordinator: presupuesto de tiempo por scout (v0.4 §9.6 'Rogue Agents'). Un scout que se cuelga se cancela y se reporta failed; el scan sigue con los demas."
    },
    "files": "core/coordinator/coordinator.ts (constante DEFAULT_SCOUT_TIMEOUT_MS = 5 min; ScanOptions.scoutTimeoutMs; runScan pasa el presupuesto a cada scout; #runScout reescrito).",
    "design": "Cada scout recibe una AbortSignal propia, enlazada al signal del llamante, que se dispara por (a) expiracion del presupuesto o (b) aborto del llamante. La ejecucion del scout compite (Promise.race) contra esa senal: si el scout se cuelga e ignora su signal, gana la cancelacion y no cuelga el scan. Un scout cancelado se reporta `failed` (no `partial`: no produjo nada usable). Default 5 min: kill-switch holgado, no un SLA. Sin cambios en el CLI (usa el presupuesto por defecto).",
    "verification_real": "build / typecheck / lint / test verdes. 3 tests nuevos: scout colgado cancelado + scan degradado (el scout sano persiste igual); scout rapido intacto dentro del presupuesto; el signal del llamante cancela un scout colgado aunque el presupuesto sea amplio. El test de integracion cli-runner (CLI real -> Coordinator real, presupuesto default) confirma que el camino normal no regresiona.",
    "tests": "3 nuevos (coordinator kill-switch) - total 253 verdes + 3 gated",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "codigo + tests en el commit 0be9ffd feat(core); el registro SYNAPTIC de cierre del Cycle 29 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 34,
  "complianceScore": 100
}
```

### Entry #39 - VERIFICATION: prueba en vivo de la extension (F5) + nuevo requerimiento de UX
```json
{
  "timestamp": "2026-05-21T21:30:00.000Z",
  "cycle": 30,
  "phase": 7,
  "action": "VERIFICATION",
  "details": {
    "subject": "Prueba en vivo de la extension VSCode (F5) por el usuario — cierre del gap historico + nuevo requerimiento de UX.",
    "context": "Desde DG-021 cada entrada de la extension declaro el gap 'la extension en vivo (F5) no se ejecuto aqui'. El usuario abrio el Extension Development Host (F5), cargo un proyecto real (Simulador Hidraulico Parametrico) y corrio los 3 comandos: Scan Workspace, Set Anthropic API Key, Triage Findings.",
    "result": "La extension FUNCIONA end-to-end: el toast de progreso aparece durante el scan y al terminar. Gap F5 CERRADO. Hallazgo de UX: fuera del toast y los squiggles inline (que solo se ven con un archivo del proyecto abierto), no hay feedback visible del proceso — la experiencia 'durante el scan' es pobre.",
    "nuevo_requerimiento": "El usuario pide una salida verbose y dinamica del proceso, de estetica techie/hacker, atractiva durante la ejecucion y a la vez intuitiva al entregar los resultados. Comparado con lo planificado: v0.4 §4.3 planeo un webview 'tomo vivo' + tree view (NO construidos) y la Decision #23 prefiere APIs nativas sobre UI custom; el plan NO cubria el feedback dinamico 'durante el proceso' (solo el toast, Decision #25). Es un gap real del diseno.",
    "decision_pendiente": "DG-037 se reorienta a esta propuesta: como construir la salida verbose dinamica. Investigacion web realizada (Pseudoterminal de VSCode soporta ANSI nativo; el Output Channel no; feedback >1s sin senal = sensacion de 'colgado'; la estetica hacker conecta con devs).",
    "gap_status": "Gap 'extension en vivo / F5' CERRADO. El gap de UX dinamica del proceso queda abierto; lo atiende DG-037."
  },
  "outcome": "SUCCESS",
  "synapticStrength": 34,
  "complianceScore": 100
}
```

### Entry #40 - DG-037 (B) increment 1: salida verbose y dinamica de la CLI
```json
{
  "timestamp": "2026-05-21T21:45:00.000Z",
  "cycle": 30,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-037": {
      "title": "Salida verbose dinamica del scan (estetica techie/hacker)",
      "selected": "Option B — increment 1 de 3",
      "effect": "La CLI emite una salida verbose, coloreada y con feedback en vivo: banner + drip por scout + reveal agrupado por severidad. Es el motor del 'show'; los increments 2 (pseudoterminal en la extension) y 3 (webview 'tomo vivo') lo reusaran."
    },
    "files": "reporters/console-reporter.ts (NUEVO - renderizado de consola puro y testeable: banner, glifos/colores por severidad segun v0.4 §4.3, renderScoutLine, renderScanReveal). reporters/index.ts (export). core/coordinator/coordinator.ts (ScanOptions.onScoutSettled - callback best-effort de progreso, invocado al terminar cada scout; un callback que lanza no rompe el scan). cli/spinner.ts (NUEVO - spinner braille; anima en TTY/color, degrada a texto plano en pipe/CI). cli/commands/scan.ts (banner -> drip en vivo -> reveal; shouldUseColor; reemplaza formatOutcome). cli/index.ts (flag --no-color).",
    "design": "'Un solo show, dos superficies' (discusion de DG-037): el render rico vive en la CLI; la extension VSCode (increment 2) lo pipeara a un pseudoterminal nativo. El color se decide con shouldUseColor: --no-color y NO_COLOR lo apagan, FORCE_COLOR lo fuerza (lo usara la extension). console-reporter es puro; el spinner (timer + stdout) es la unica pieza con estado. Cero dependencias nuevas: ANSI y spinner hand-rolled, coherente con el patron del proyecto (cliente LLM hand-rolled).",
    "verification_real": "build / typecheck / lint / test verdes. E2E: scan real del fixture vibe-coded muestra banner + drip por scout (✓ a medida que terminan, en orden de finalizacion) + reveal con los 7 hallazgos agrupados por severidad. Precedencia de color verificada: --no-color anula FORCE_COLOR (0 secuencias ANSI); FORCE_COLOR emite color (20 lineas ANSI).",
    "verification_gap": "El spinner animado (carrera de frames con retorno de carro) no tiene unit test del temporizador: se verifica en la corrida real de la CLI. La animacion fluida en un TTY interactivo real no se ejecuto aqui (el entorno de captura no es TTY).",
    "tests": "14 nuevos/ajustados (console-reporter 12, coordinator onScoutSettled 2; scan.test reemplaza los tests de formatOutcome por shouldUseColor) - total 267 verdes + 3 gated",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "codigo + tests en el commit 1705e8c feat(reporters,cli,core); el registro SYNAPTIC de cierre del Cycle 30 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 35,
  "complianceScore": 100
}
```

### Entry #41 - DG-038 (B): pseudoterminal verbose en la extension (UX verbose increment 2)
```json
{
  "timestamp": "2026-05-21T22:00:00.000Z",
  "cycle": 31,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-038": {
      "title": "UX verbose increment 2: pseudoterminal en la extension",
      "selected": "Option B",
      "effect": "El 'show' de la CLI (banner + drip + reveal, con color y animacion) se transmite a un Pseudoterminal nativo de VSCode. Los comandos Scan y Triage de la extension abren la terminal 'Synaptic Sentinel' y transmiten ahi la salida en vivo."
    },
    "files": "vscode-extension/terminal.ts (NUEVO - SentinelTerminal: wrapper de un Pseudoterminal de solo-lectura, reutilizable, con buffer pre-open). vscode-extension/terminal-format.ts (NUEVO - toCrlf, normaliza LF->CRLF preservando el CR del spinner). vscode-extension/cli-runner.ts (spawnCli transmite stdout/stderr via onOutput; runCliScan/runCliTriage corren la CLI con FORCE_COLOR=1 cuando hay onOutput). vscode-extension/index.ts (Scan y Triage abren la terminal y transmiten; el re-scan del triage no transmite). cli/triage.ts (banner + renderTriageTag coloreado + --no-color). reporters/console-reporter.ts (renderTriageTag).",
    "design": "Cierra la arquitectura 'un show, dos superficies': el motor (increment 1) emite ANSI; la extension lo pipea a un Pseudoterminal nativo — API nativa, sin webview (respeta Decision #23). El Pseudoterminal exige CRLF; toCrlf lo normaliza sin tocar el CR suelto de la animacion del spinner. FORCE_COLOR=1 se pasa solo cuando hay onOutput (la terminal renderiza ANSI). El re-scan silencioso del triage no transmite, para no duplicar un 'show' de scan.",
    "verification_real": "build / typecheck / lint / test verdes. El test de integracion cli-runner (CLI real) verifica el streaming: el callback onOutput recibe el banner. E2E: el comando triage imprime el banner. 6 tests nuevos (renderTriageTag 2, toCrlf 4).",
    "verification_gap": "El Pseudoterminal en si (SentinelTerminal, API de VSCode) no es testeable headless: se verifica con F5 / Extension Development Host. toCrlf y el streaming de cli-runner SI tienen cobertura de tests.",
    "housekeeping": ".gitignore: se ignoran packages/*/.synaptic|.vscode|context — re-inicializacion del tooling SYNAPTIC al abrir la subcarpeta de la extension en VSCode; no son del proyecto y rompian git add. Los directorios siguen en disco (gitignore no borra); se recomienda al usuario eliminarlos.",
    "tests": "6 nuevos - total 273 verdes + 3 gated",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "codigo + tests en el commit 84180b4 feat(vscode-extension,cli); el registro SYNAPTIC de cierre del Cycle 31 (con el fix de .gitignore) se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 36,
  "complianceScore": 100
}
```

### Entry #42 - DG-039 (B): webview "tomo vivo" (UX verbose increment 3/3)
```json
{
  "timestamp": "2026-05-21T22:15:00.000Z",
  "cycle": 32,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-039": {
      "title": "UX verbose increment 3/3: webview 'tomo vivo'",
      "selected": "Option B",
      "effect": "Panel lateral webview con los hallazgos del ultimo scan, agrupados por severidad y clickeables para saltar al codigo (v0.4 §4.3). Cierra DG-037 B — la trilogia de UX verbose queda completa (CLI -> pseudoterminal -> webview)."
    },
    "files": "vscode-extension/webview-content.ts (NUEVO - renderTomoWebviewHtml, funcion pura: tarjetas por hallazgo con severidad/ubicacion/detalle del Brain Layer; CSP con nonce; escapeHtml). vscode-extension/tomo-view.ts (NUEVO - SentinelTomoViewProvider: WebviewViewProvider, update(), el click 'reveal' abre el archivo en el editor). vscode-extension/index.ts (registra el provider; Scan/Triage/mark-fp actualizan el panel). vscode-extension/package.json (contributes.views - panel webview en el contenedor explorer).",
    "design": "API nativa de webview, sancionada explicitamente por v0.4 §4.3 ('panel lateral con el tomo vivo'). Arquitectura spawn-CLI intacta (DG-021): el panel solo consume los ExtensionFinding que la extension ya tiene; escapeHtml propio, no se importa el motor. El re-render setea webview.html completo (los datos van horneados; el unico script, autorizado por nonce, solo maneja el click -> postMessage).",
    "verification_real": "build / typecheck / lint / test verdes. 6 tests nuevos del render puro: escapeHtml, CSP/nonce, estado vacio, tarjetas agrupadas por severidad, escapado anti-inyeccion HTML, detalle del Brain Layer.",
    "verification_gap": "El WebviewViewProvider y la contribucion de la vista (API de VSCode) no son testeables headless: se verifican con F5. El render del HTML (la logica con riesgo, incluido el escapado anti-inyeccion) SI tiene tests.",
    "tests": "6 nuevos (webview-content) - total 279 verdes + 3 gated",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "codigo + tests en el commit 90c7452 feat(vscode-extension); el registro SYNAPTIC de cierre del Cycle 32 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 37,
  "complianceScore": 100
}
```

### Entry #43 - DG-040 (B): la colonia aprende — learning_records (increment 1)
```json
{
  "timestamp": "2026-05-21T22:30:00.000Z",
  "cycle": 33,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-040": {
      "title": "Proximo paso del roadmap (la colonia aprende)",
      "selected": "Option B",
      "effect": "Increment 1 (lado escritura) de la memoria del enjambre (v0.4 §3.5): el comando triage alimenta la tabla learning_records, inerte desde v1. Cada clasificacion decisiva del triage registra un patron generalizado."
    },
    "files": "core/types/learning.ts (NUEVO - LearningClassification, LearningRecord schema; patternSignature -> ${category}:${ruleId}; triageClassificationToLearning). core/types/index.ts (export). core/colony/colony-db.ts (recordLearningBatch - upsert transaccional por (pattern_signature, classification); getLearningRecords). cli/commands/triage.ts (recolecta learning entries de los veredictos decisivos y los persiste; el resumen reporta 'patrones aprendidos: N').",
    "design": "learning_records generaliza por patron (${category}:${ruleId}), distinto de triage_verdicts que es por fingerprint exacto (path:rule:line): asi la tabla NO es redundante — triage_verdicts = 'este hallazgo exacto', learning_records = 'este tipo de hallazgo' (memoria cross-scan / cross-ubicacion). Clave logica (pattern_signature, classification): registros separados por clasificacion capturan la distribucion via evidence_count, sin conflicto de sobre-escritura. Un veredicto inconclusive no produce aprendizaje. Sin cambio de schema: la tabla existe desde v1. El lado lectura (economia de tokens / pre-clasificacion) es el increment 2.",
    "verification_real": "build / typecheck / lint / test verdes. 10 tests nuevos (learning 6, colony-db recordLearningBatch/getLearningRecords 4). E2E con la API key del usuario: triage de 2 hallazgos -> 'patrones aprendidos: 2'; filas confirmadas en colony.db (VibeCoded:vibe-placeholder-secret -> fp_pattern, VibeCoded:vibe-debug-mode-enabled -> real_pattern, evidence_count 1, last_seen_scan correcto).",
    "tests": "10 nuevos - total 289 verdes + 3 gated",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "codigo + tests en el commit aec45ea feat(core,cli); el registro SYNAPTIC de cierre del Cycle 33 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 38,
  "complianceScore": 100
}
```

### Entry #44 - DG-041 (B): la colonia aprende — lado lectura (increment 2)
```json
{
  "timestamp": "2026-05-21T22:45:00.000Z",
  "cycle": 34,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-041": {
      "title": "Proximo paso del roadmap (la colonia aprende - lado lectura)",
      "selected": "Option B",
      "effect": "Increment 2 (lado lectura) de la memoria del enjambre: el triage consulta learning_records y pre-clasifica los patrones conocidos sin gastar una llamada LLM (economia de tokens, v0.4 §187). Cierra 'la colonia aprende'."
    },
    "files": "core/types/learning.ts (LEARNING_CONFIDENCE_THRESHOLD = 3; LearnedVerdict; deriveFromLearning - devuelve un veredicto derivado solo con evidencia fuerte y consistente; confianza creciente con la evidencia, tope 0.95). cli/commands/triage.ts (antes del LLM consulta deriveFromLearning; si la colonia conoce el patron deriva el veredicto -agentId 'colony-learning', rationale explicito- y salta la llamada LLM; el resumen reporta 'pre-clasificados por la memoria: N').",
    "design": "Pre-clasifica solo con evidencia FUERTE (>= umbral) y CONSISTENTE (una unica direccion; evidencia en ambas = patron ambiguo -> decide el LLM). Un veredicto derivado se persiste con agentId 'colony-learning' (trazabilidad) y NUNCA se realimenta a learning_records — evita un bucle en el que la colonia aprenda de su propia memoria. Para un FP-pattern conocido el ahorro es total (FP no dispara Context/Remediation); para un real-pattern se ahorra la llamada de triage y siguen Context+Remediation (artefactos por hallazgo). El --limit sigue contando ambos tipos (refinamiento menor, diferido).",
    "verification_real": "build / typecheck / lint / test verdes. 5 tests nuevos de deriveFromLearning (fp/real fuerte, bajo umbral, contradiccion, sin registros). E2E SIN costo de API: sembrando learning_records (6 patrones fp, evidence 5), un triage de 7 hallazgos los pre-clasifico TODOS desde la memoria — 0 llamadas LLM (con ANTHROPIC_API_KEY dummy) — y 'patrones aprendidos: 0' confirma que no hay realimentacion.",
    "tests": "5 nuevos - total 294 verdes + 3 gated",
    "checks": "build / typecheck / lint / test - todos en verde",
    "commit": "codigo + tests en el commit 6f28445 feat(core,cli); el registro SYNAPTIC de cierre del Cycle 34 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 39,
  "complianceScore": 100
}
```

### Entry #45 - DG-042 (A): higiene del repo — Prettier + format:check en el gate
```json
{
  "timestamp": "2026-05-21T23:15:00.000Z",
  "cycle": 35,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-042": {
      "title": "Proximo paso del roadmap (higiene del repo)",
      "selected": "Option A",
      "effect": "Cierra FI-010: drift de formato de Prettier acumulado porque format:check nunca estuvo en el gate de verificacion por ciclo."
    },
    "files": "package.json (nuevo script raiz 'verify': format:check && lint && build && test — codifica el gate por ciclo como un unico comando). 44 archivos reformateados por 'pnpm format' (cambios puramente de estilo). packages/vscode-extension/tests/cli-runner.test.ts (correccion de fondo de un comentario inestable).",
    "design": "El gate por ciclo era build+lint+test; se le suma format:check y se materializa en el script 'verify' para que el drift no vuelva a acumularse en silencio. Orden de 'verify': falla barato primero — format:check, lint, build, test.",
    "inestabilidad": "Un comentario de cli-runner.test.ts habia quedado colapsado en una sola linea con '//' embebidos y en posicion colgante entre los argumentos de it(...). Prettier no podia estabilizarlo: prettier(input) !== prettier(prettier(input)) verificado con --debug-check. Se reescribio como un bloque de lineas de comentario independientes movido ANTES de la llamada it(...); el timeout 120_000 queda como argumento simple. --debug-check ahora estable.",
    "verification_real": "pnpm verify completo en verde: format:check ('All matched files use Prettier code style!'), lint, build, test.",
    "tests": "sin tests nuevos (ciclo de higiene) — total 294 verdes + 3 gated",
    "checks": "format:check / lint / build / test — todos en verde via el nuevo script 'verify'",
    "commit": "codigo en el commit 09fe0ab style(repo); el registro SYNAPTIC de cierre del Cycle 35 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 40,
  "complianceScore": 100
}
```

### Entry #46 - DG-043 (B): amplia el catalogo SAST de 4 a 11 reglas
```json
{
  "timestamp": "2026-05-22T12:30:00.000Z",
  "cycle": 36,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-043": {
      "title": "Proximo paso del roadmap (ampliar el catalogo SAST)",
      "selected": "Option B",
      "effect": "Atiende FI-003: el ruleset baseline de OpenGrep pasa de 4 a 11 reglas pattern-based deterministas y de alta confianza."
    },
    "files": "scouts/src/opengrep/rules/sentinel-baseline.yaml (7 reglas nuevas). 2 fixtures deliberadamente vulnerables: tests/opengrep/fixtures/vulnerable/javascript/xss-and-injection.js y .../python/unsafe-apis.py. scouts/tests/opengrep/integration.test.ts (2 tests de integracion nuevos).",
    "rules": "JS/TS: setTimeout/setInterval con string literal (CWE-95), document.write/writeln (CWE-79), asignacion dinamica a innerHTML (CWE-79, excluye literales con pattern-not). Python: os.system (CWE-78), yaml.load sin SafeLoader (CWE-502, excluye Loader=SafeLoader/CSafeLoader), pickle.load/loads (CWE-502), hashlib.md5 (CWE-327). Todas con refs CWE + OWASP 2021.",
    "design": "Solo patrones sintacticos deterministas y de alta confianza; el taint analysis queda explicitamente para una fase posterior (FI-003 sigue abierto, acotado a taint). Las reglas con riesgo de FP (innerHTML, yaml.load) usan pattern-not para excluir las formas seguras; las de FP tolerable (md5, document.write) van como WARNING.",
    "verification_real": "El test de integracion corre OpenGrep real: las 7 reglas nuevas detectan sus patrones en los fixtures; severidad verificada (os.system ERROR->high, md5 WARNING->medium). pnpm verify completo en verde.",
    "tests": "2 nuevos de integracion — total 296 verdes + 3 gated",
    "checks": "format:check / lint / build / test — todos en verde via 'verify'",
    "commit": "codigo + tests + fixtures en el commit fcf90a3 feat(scouts); el registro SYNAPTIC de cierre del Cycle 36 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 41,
  "complianceScore": 100
}
```

### Entry #47 - DG-044 (B): exportador SARIF 2.1.0 del tomo
```json
{
  "timestamp": "2026-05-22T13:00:00.000Z",
  "cycle": 37,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-044": {
      "title": "Proximo paso del roadmap (reporter SARIF)",
      "selected": "Option B",
      "effect": "Reporter SARIF 2.1.0 del tomo: la salida de Sentinel es ahora consumible por GitHub Code Scanning, Azure DevOps y otras herramientas de CI. SARIF ya estaba previsto como formato OSS en el index.ts del paquete reporters."
    },
    "files": "reporters/src/sarif-reporter.ts (NUEVO, renderTomoSarif - reporter puro y determinista). reporters/src/index.ts (export). reporters/tests/sarif-reporter.test.ts (NUEVO, 8 tests). cli/src/commands/scan.ts y cli/src/index.ts (flag --export-sarif).",
    "design": "Reglas (reportingDescriptor) deduplicadas por ruleId; cada result las referencia por ruleIndex. Severidad -> level SARIF (critical/high=error, medium=warning, low/info=note) y -> security-severity (0-10) que GitHub lee de la regla. El fingerprint estable de cada hallazgo se publica como partialFingerprints, para que el consumidor rastree el mismo hallazgo entre corridas. La region omite los campos ausentes (endLine/columns/snippet opcionales).",
    "verification_real": "8 tests unitarios que parsean la salida y verifican el esqueleto SARIF 2.1.0, el mapeo severidad->level, la deduplicacion de reglas, la region, security-severity, partialFingerprints y el caso sin hallazgos. pnpm verify completo en verde.",
    "tests": "8 nuevos — total 304 verdes + 3 gated",
    "checks": "format:check / lint / build / test — todos en verde via 'verify'",
    "observacion": "pnpm verify tardo ~152s, dominado por los tests de integracion: FI-002 (separar test:unit/test:integration) sigue creciendo en relevancia.",
    "commit": "codigo + tests en el commit f12e2b6 feat(reporters,cli); el registro SYNAPTIC de cierre del Cycle 37 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 42,
  "complianceScore": 100
}
```

### Entry #48 - DG-045 (B): politica de exit code --fail-on para CI
```json
{
  "timestamp": "2026-05-22T13:45:00.000Z",
  "cycle": 38,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-045": {
      "title": "Proximo paso del roadmap (politica de exit code para CI)",
      "selected": "Option B",
      "effect": "Flag scan --fail-on <severidad>: el comando scan termina con exit code 2 si hay hallazgos de severidad >= umbral. Completa la historia CI-native que abrio el reporter SARIF (DG-044): SARIF reporta y el exit code bloquea el pipeline."
    },
    "files": "cli/src/commands/scan.ts (FAIL_ON_EXIT_CODE=2; ScanCommandOptions.failOn; countBlockingFindings - helper puro y exportado; logica de exit code en runScanCommand). cli/src/index.ts (flag --fail-on + validacion de la severidad). cli/tests/scan.test.ts (5 tests de countBlockingFindings).",
    "design": "Exit code 2 para 'hallazgos bloqueantes', distinto del exit 1 'error de ejecucion': un consumidor de CI los distingue. --fail-on es OPT-IN: sin el flag, scan sigue en exit code 0. Reusa severityAtLeast del core. countBlockingFindings se extrajo como funcion pura para verificarla sin correr un scan.",
    "riesgo_verificado": "El riesgo senalado en el DG (la extension VSCode trata exit != 0 como fallo via assertCliOk) se verifico de fondo: cli-runner NUNCA pasa --fail-on, asi que el scan de la extension sigue en exit 0. El e2e 'sin --fail-on -> exit 0' lo confirma.",
    "verification_real": "5 tests unitarios de countBlockingFindings + E2E real con la CLI construida contra el probe vulnerable: --fail-on high -> exit 2, --fail-on critical -> exit 0, sin flag -> exit 0, --fail-on foo (invalido) -> exit 1. Los 4 exit codes exactos. pnpm verify completo en verde.",
    "instruccion_usuario": "El usuario pidio que en lo sucesivo cada DG incluya mi recomendacion explicita y razonada sobre las opciones (seccion 6 del MANTRA). Registrado en memoria persistente y como contextNote de INTELLIGENCE.json.",
    "tests": "5 nuevos — total 309 verdes + 3 gated",
    "checks": "format:check / lint / build / test — todos en verde via 'verify'",
    "commit": "codigo + tests en el commit 0e41fcf feat(cli); el registro SYNAPTIC de cierre del Cycle 38 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 43,
  "complianceScore": 100
}
```

### Entry #49 - DG-046 (A): separa test:unit / test:integration
```json
{
  "timestamp": "2026-05-22T14:30:00.000Z",
  "cycle": 39,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-046": {
      "title": "Proximo paso del roadmap (separar test:unit / test:integration)",
      "selected": "Option A",
      "effect": "Cierra FI-002: la suite Vitest se divide en dos proyectos (unit / integration). El gate por ciclo (verify) pasa a correr solo test:unit; los tests de integracion lentos se invocan explicitamente."
    },
    "files": "vitest.config.ts (test.projects: proyectos 'unit' e 'integration'). package.json (scripts test:unit/test:integration; verify pasa de 'test' a 'test:unit'). cli-runner.test.ts era mixto -> separado en cli-runner.test.ts (unit) y cli-runner.integration.test.ts (NUEVO, scan con la CLI real). ONBOARDING.md / README.md (workflow documentado).",
    "design": "Split por proyecto Vitest (no por glob en los scripts): 'vitest run --project <name>' es robusto cross-platform, sin problemas de quoting de globs entre cmd y bash. Los tests de integracion se reconocen por el sufijo *integration.test.ts. El gate por ciclo usa test:unit; test:integration se corre explicito ante un commit de feature o un release.",
    "verification_real": "Verificado SIN perdida de tests: test:unit 42 archivos/300 passed; test:integration 8 archivos/9 passed + 3 gated; total 309 + 3, identico al pre-split. test:unit corre en ~7s (antes el gate completo pesaba ~50-150s segun contencion). pnpm verify (ahora con test:unit) completo en verde.",
    "tests": "sin tests nuevos (reorganizacion) — total 309 verdes + 3 gated, repartidos 300 unit / 9+3 integration",
    "checks": "format:check / lint / build / test:unit — todos en verde via 'verify'; test:integration verificado por separado",
    "commit": "codigo en el commit eef0d32 test(repo); el registro SYNAPTIC de cierre del Cycle 39 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 44,
  "complianceScore": 100
}
```

### Entry #50 - DG-047 (A): normaliza el ruleId de OpenGrep a su id canonico
```json
{
  "timestamp": "2026-05-22T15:15:00.000Z",
  "cycle": 40,
  "phase": 7,
  "action": "FEATURE_IMPLEMENTED",
  "details": {
    "DG-047": {
      "title": "Proximo paso del roadmap (normalizar el ruleId de OpenGrep)",
      "selected": "Option A",
      "effect": "Cierra FI-005: el Finding.ruleId de OpenGrep pasa a ser el id canonico de la regla (ultimo segmento del check_id), sin el prefijo de ruta que OpenGrep agrega cuando --config es un archivo."
    },
    "files": "scouts/src/opengrep/normalizer.ts (deriveTitle renombrada a canonicalRuleId; ruleId y title del Finding usan el id canonico). scouts/tests/opengrep/normalizer.test.ts y integration.test.ts (aserciones del id canonico).",
    "design": "El id canonico es el ultimo segmento del check_id (las reglas del baseline usan ids planos en kebab-case). Beneficio: ruleId estable independiente de la ubicacion del archivo de reglas; patternSignature de la memoria del enjambre y rule.id del SARIF quedan limpios.",
    "verification_real": "Test unitario del normalizer (canonicalRuleId + idempotencia) + e2e contra OpenGrep real: el test de integracion asierta ruleId === 'sentinel-js-eval-usage' (sin prefijo). pnpm verify verde (test:unit 301); test:integration verde (9 + 3 gated).",
    "tests": "1 nuevo (idempotencia) — total 310 verdes + 3 gated (301 unit / 9+3 integration)",
    "checks": "format:check / lint / build / test:unit + test:integration — todos en verde",
    "requisito_nuevo": "El usuario pidio que TODA la salida del producto al usuario final sea en ingles (usuario objetivo angloparlante; el ecosistema de desarrollo es en ingles). Delego en el asistente definir la estrategia. Registrado como FI-011 con 5 etapas (1 CLI, 2 mensajes de reglas de scouts, 3 reporters del tomo, 4 extension VSCode, 5 prompts del Brain Layer); se abordara en DGs futuros. Principio inmediato: todo string de salida NUEVO se escribe en ingles. Fuera de alcance: bookkeeping de .synaptic/, comentarios de codigo y mensajes de commit.",
    "commit": "codigo + tests en el commit 44118ca fix(scouts); el registro SYNAPTIC de cierre del Cycle 40 se asienta en el commit docs siguiente"
  },
  "outcome": "SUCCESS",
  "synapticStrength": 45,
  "complianceScore": 100
}
```

---

*SYNAPTIC Protocol v3.0 - Continuous Logging Active*
*Last Updated: 2026-05-22T15:15:00.000Z*
