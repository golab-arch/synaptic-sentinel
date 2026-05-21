# DESIGN_DOC.md - SENTINEL

## Architecture Decisions

| ID | Decision | Option Selected | Date | Rationale |
|----|----------|-----------------|------|-----------|
| DG-001 | Estructura física del monorepo OSS/Pro | **Option B** — monorepo único con workspaces marcados OSS/Pro + `publish-oss.ts` allowlist | 2026-05-20 | Velocidad de solo founder; refactors triviales; anti-filtración en un script auditable |
| DG-002 | Creación del repositorio GitHub | **Option A** — `git init` local ahora; repo remoto GitHub diferido | 2026-05-20 | Evita infra remota prematura; respeta v0.4 §8.4 LOCKED (privado hasta MVP) |
| DG-003 | Estrategia de binarios de scanners | **Option A** — binarios nativos pinneados, descarga on-demand | 2026-05-20 | El producto debe correr sin Docker en el cliente; dev espeja prod |
| DG-004 | Reuso de `@synaptic-sre/enforcement` | **Option A** — referencia conceptual; reimplementación idiomática | 2026-05-20 | Reuso literal bajo; Sentinel autónomo y sin deuda de licencia |
| DG-005 | Alcance de la generación de scaffolding | **Option B** — esqueleto completo: 7 paquetes declarados con headers OSS/Pro | 2026-05-20 | Hace explícito y auditable el split OSS/Pro desde el día uno |
| DG-006 | Linter / formatter | **Option B** — ESLint flat (typescript-eslint) + Prettier en el scaffolding | 2026-05-20 | Un producto de calidad/seguridad de código debe tener linter real desde el primer commit |
| DG-007 | Desbloqueo del commit (interferencia de antivirus) | **Option A** — exclusión de la carpeta del proyecto en el antivirus (Norton 360) | 2026-05-20 | Ataca la causa raíz; desbloquea commit, `pnpm install` y descarga futura de scanners |
| DG-008 | Alcance del primer increment de PASO 4 | **Option A** — contrato primero: interfaz `ScoutAgent` + tipos compartidos antes del wrapper | 2026-05-20 | El contrato es el cimiento de core/scouts/agents/reporters; fijarlo y testearlo primero de-risk-ea el resto |
| DG-009 | Alcance del segundo increment de PASO 4 | **Option A** — adquisición del binario primero (`scripts/install-scanners.ts`) | 2026-05-20 | La descarga bajo Norton (TLS, checksums, cross-platform) es la pieza de mayor riesgo de entorno; aislarla deja el wrapper como lógica pura |
| DG-010 | Alcance del tercer increment de PASO 4 | **Option A** — `OpenGrepScout` + normalizer, unit-tested contra salida JSON real | 2026-05-20 | Aísla el último unknown (CLI/JSON de OpenGrep); normalizer testeado contra output real capturado |
| DG-011 | Cuarto increment de PASO 4 | **Option B** — ruleset curado + fixtures JS/TS+Python + tests de integración | 2026-05-21 | Cierra PASO 4 completo con detección real en los dos lenguajes LOCKED del MVP |
| DG-012 | Próximo paso del roadmap | **Option B** — Coordinator stage 1 + persistencia en `colony.db` | 2026-05-21 | La columna vertebral: scan → dedup → persiste; activa el schema de feromonas inerte |
| DG-013 | Driver SQLite para `colony.db` | **Option A** — `node:sqlite` (módulo integrado de Node) | 2026-05-21 | Cero dependencias y cero ABI nativa (elimina la fricción del módulo nativo en la extensión VSCode); síncrono + WAL. Desviación informada del v0.4 §9.4, que dijo "validar" |
| DG-014 | Alcance del Coordinator stage 1 | **Option A** — Coordinator stage 1 estricto + refactor `ScoutAgent`→`core` | 2026-05-21 | Alcance literal de DG-012 B; el refactor del contrato a `core` evita la dependencia circular `core`↔`scouts` |
| DG-015 | Próximo paso del roadmap | **Option A** — CLI `synaptic-sentinel scan` | 2026-05-21 | Convierte el pipeline interno en algo invocable por una persona; integra core+scouts+colony en un punto de entrada real |
| DG-016 | Próximo paso del roadmap | **Option B** — reporters: modelo del tomo + export JSON | 2026-05-21 | Cierra el ciclo scan → artefacto entregable; en el camino crítico de la definición de "Done" del MVP (§8.1) |
| DG-017 | Próximo paso del roadmap | **Option A** — `GitleaksScout` (en 2 increments: A.1 install-scanners + comprimidos, A.2 el scout) | 2026-05-21 | Cobertura de secrets, riesgo bajo (patrón probado); Gitleaks ships archivos → A.1 agrega extracción a `install-scanners` |
| DG-018 | Enfoque del `GitleaksScout` (DG-017 A.2) | **Option B** — scout completo de punta a punta + fixture con un secreto + test de integración (Gitleaks real) + wiring en el CLI | 2026-05-21 | Cierra la cobertura de secrets dejándola operativa: el `Coordinator` corre OpenGrep **y** Gitleaks, validado contra el binario real |
| DG-019 | Próximo paso del roadmap | **Option A** — `Coordinator` stage 2: dedup + `fp_known` + `lifecycleState` en re-scans | 2026-05-21 | Endurece el pipeline antes de sumar scouts o brain layer; un re-scan ya no duplica feromonas y respeta los falsos positivos confirmados |
| DG-020 | Próximo paso del roadmap | **Option B** — extensión VSCode MVP (comando Scan + diagnostics inline) | 2026-05-21 | El producto es VSCode-primary y solo existía como CLI; surfacea el pipeline determinista donde el dev trabaja |
| DG-021 | Arquitectura de la extensión VSCode MVP | **Option A** — spawn-CLI: la extensión lanza la CLI como child process, lee el tomo y pinta diagnostics | 2026-05-21 | Vuelve irrelevante el Node del extension host (FI-001); la CLI es la única fuente de verdad de ejecución; extensión delgada |
| DG-022 | Próximo paso del roadmap | **Option B** — cierre del lazo Inline UX: comando CLI `mark-fp` + Code Action "marcar falso positivo" + status bar | 2026-05-21 | DG-019 dejó el consumo de `fp_known` sin vía de creación; B cierra ese lazo end-to-end (cierra FI-007) |
| DG-023 | Próximo paso del roadmap | **Option A** — reporter HTML del tomo + `suppressedCount` en el resumen | 2026-05-21 | El tomo es el deliverable del producto pero solo existía en JSON; HTML lo vuelve un informe real (cierra FI-006) |
| DG-024 | Próximo paso del roadmap | **Option B** — Brain Layer increment 1: paquete `agents` (contrato `BrainAgent` + `LlmClient` + `AnthropicLlmClient` BYOK + Triage Agent mínimo) | 2026-05-21 | El Brain Layer es el diferenciador premium; el increment 1 lo arranca con cimientos verificables. Desviación informada del v0.4 línea 695: cliente Anthropic propio vía `fetch` por testabilidad total (ver FI-009) |
| DG-025 | Próximo paso del roadmap | **Option A** — Brain Layer increment 2: comando CLI `triage` (corre el Triage Agent, pheromone-aware, persiste veredictos) | 2026-05-21 | El paquete `agents` no tenía consumidor; el wiring lo vuelve usable. Tabla dedicada `triage_verdicts` (schema v2 aditivo) en vez de un tipo de feromona — cero riesgo de migración. Desviación informada del v0.4 línea 215 |
| Q1 | Package manager / tooling de monorepo | **pnpm workspaces** (v10.33.0) | 2026-05-20 | Ya instalado; preferencia v0.4 §9.5; sin overhead |

**Discovery cerrado. Scaffolding generado, verificado y commiteado** (`f0b5202`, 54 archivos). **Cycle 2 CERRADO.** Siguiente: PASO 4 — Scout Layer.

---

## Technical Notes

- Entorno verificado (2026-05-20): Node v24.11.1, npm 11.6.2, pnpm 10.33.0, git 2.51.0, Python 3.14.0, Docker 28.4.0, WSL2 v2.7.3.0, `gh` CLI v2.88.1 (cuenta `golab-arch`).
- **Antivirus activo: Norton 360** (real-time Auto-Protect/SONAR). Windows Defender está en modo pasivo.
- Scaffolding generado: monorepo pnpm con 7 paquetes; build via `tsc -b` (project references); ESLint 9 flat + Prettier; Vitest 3. Verificado: `pnpm install/build/lint/test` todos en verde.
- Schema `colony.db` incluye 2 mejoras sobre v0.4 §3.5: tabla `meta` (`schema_version`) + `CHECK` constraints (defensa anti Memory Poisoning, §9.6).
- ⚠️ **Hallazgo de entorno — Norton 360 interfiere con el desarrollo**. Dos síntomas:
  - **L-001 — Inspección TLS**: `pnpm install` falla con `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Workaround permanente: `NODE_OPTIONS=--use-system-ca`.
  - **L-002 — Bloqueo de escritura git**: `git add`/`commit` fallan con `Permission denied` en `.git/objects/` (Auto-Protect de Norton). Fix raíz (DG-007 A): excluir `D:\GoLAB\PROYECTOS\SENTINEL` de Auto-Protect/SONAR en Norton 360.
  - Impacto futuro: `scripts/install-scanners.ts` (DG-003 A) sufriría lo mismo — la exclusión lo previene.
- ⚠️ Observación: Python 3.14 vs Checkov — se resuelve cuando toque el wrapper Checkov.
- ⚠️ Observación: `better-sqlite3` es módulo nativo — evaluar `node:sqlite` por ABI con Electron de VSCode.
- ⚠️ Observación: `exactOptionalPropertyTypes` (tsconfig) es muy estricto — relajable puntualmente si genera fricción.

---

## Architecture Changes

- 2026-05-20 — Cycle 1: arquitectura física fijada como monorepo único pnpm (DG-001 B), split OSS/Pro por workspace marcado.
- 2026-05-20 — Cycle 2: scaffolding generado — 7 paquetes (shared, core, scouts, cli, reporters, vscode-extension, agents). Build con `tsc -b` project references. Primer commit atómico `f0b5202` en `main` (54 archivos) tras resolver el bloqueo de Norton 360 (DG-007 A).
- 2026-05-20 — Cycle 3: PASO 4 Increment 1 — tipos compartidos (`Finding`, `Pheromone`, `Scan`, severidades) con `zod`, e interfaz `ScoutAgent`. 28 tests verdes.
- 2026-05-20 — Cycle 4: PASO 4 Increment 2 — `scripts/install-scanners.ts` con manifest pinneado y checksums SHA-256. OpenGrep v1.22.0 descargado y verificado. 32 tests verdes.
- 2026-05-21 — Cycle 5: PASO 4 Increment 3 — `OpenGrepScout` (implementa `ScoutAgent`) + normalizer (OpenGrep JSON → `Finding`). 48 tests verdes.
- 2026-05-21 — Cycle 6: PASO 4 Increment 4 — ruleset baseline + fixtures vulnerables + tests de integración con OpenGrep real. **PASO 4 COMPLETO.** 51 tests verdes.
- 2026-05-21 — Cycle 7: capa `colony.db` (clase `ColonyDb` sobre `node:sqlite`) — DG-012 B.1. 59 tests verdes.
- 2026-05-21 — Cycle 8: contrato `ScoutAgent` movido a `core`; `Coordinator` stage 1 (orquesta scouts → feromonas en `colony.db`) — DG-012 B.2. **DG-012 B COMPLETO.** 63 tests verdes.
- 2026-05-21 — Cycle 9: CLI `synaptic-sentinel scan` (DG-015 A) — primer comando ejecutable; scan end-to-end desde terminal. 67 tests verdes.
- 2026-05-21 — Cycle 10: paquete `reporters` — modelo del tomo + export JSON con firma SHA-256 (DG-016 B); `scan --export`. 73 tests verdes.
- 2026-05-21 — Cycle 11: `install-scanners` soporta assets comprimidos (extracción via `tar`); Gitleaks v8.30.1 instalable (DG-017 A.1).
- 2026-05-21 — Cycle 12: `GitleaksScout` de punta a punta (DG-018 B) — wrapper de Gitleaks (categoría Secrets, `--redact`) + normalizer + integración real; `runProcess` extraído a módulo compartido; el CLI `scan` corre OpenGrep **y** Gitleaks. 86 tests verdes. **Cobertura de secrets operativa.**
- 2026-05-21 — Cycle 13: `Coordinator` stage 2 (DG-019 A) — dedup por `fingerprint`, supresión de falsos positivos confirmados (`fp_known`) y clasificación de ciclo de vida (`new`/`known`) en re-scans. Nuevo contrato `FpKnownPayload` + `buildFpKnownPheromone`; `ColonyDb.getKnownFingerprints`; `ScanOutcome.suppressedCount`. 94 tests verdes.
- 2026-05-21 — Cycle 14: extensión VSCode MVP (DG-020 B / DG-021 A) — **arquitectura spawn-CLI**: la extensión lanza la CLI como child process, lee el tomo exportado y pinta los hallazgos como diagnostics inline. Capa UX delgada (módulos puros desacoplados de la API `vscode`); bundle `esbuild` → `dist/extension.cjs`, **sin `node:sqlite`** en el extension host. Fix de la CLI: `findScannersRoot` resuelve `.scanners/` sin depender del `cwd`. **Inicio de la fase Inline UX.** 110 tests verdes.
- 2026-05-21 — Cycle 15: cierre del lazo Inline UX (DG-022 B) — comando CLI `mark-fp` (registra una feromona `fp_known`, idempotente) + Code Action "marcar falso positivo" en la extensión + status bar. El Code Action dispara `mark-fp` → `fp_known` → el `Coordinator` stage 2 lo suprime en el próximo scan. Cierra FI-007. 119 tests verdes.
- 2026-05-21 — Cycle 16: reporter HTML del tomo (DG-023 A) — `renderTomoHtml` produce un informe HTML autocontenido (todo el contenido dinámico escapado); `TomoSummary` gana `suppressedCount` (FI-006); el CLI gana `--export-html`. El tomo es exportable a JSON **y** HTML. Cierra FI-006. 123 tests verdes.
- 2026-05-21 — Cycle 17: Brain Layer increment 1 (DG-024 B) — paquete `agents` (capa Cerebro, Pro): contrato `BrainAgent` (prompt + parser, **no microservicio**), frontera `LlmClient`, `AnthropicLlmClient` (BYOK, cliente `fetch` propio) y un **Triage Agent** mínimo (`Finding` → `TriageVerdict`, validado con zod). La respuesta del LLM se valida como entrada no confiable (Memory Poisoning). **Inicio de la fase Brain Layer.** 145 tests verdes + 1 skipped.
- 2026-05-21 — Cycle 18: Brain Layer increment 2 (DG-025 A) — comando CLI `triage` que corre el Triage Agent sobre los hallazgos del último scan (BYOK), salta `fp_known` y los ya triados (economía de tokens, v0.4 §187) y persiste los veredictos. **Schema v2**: nueva tabla `triage_verdicts` (cambio aditivo via `CREATE TABLE IF NOT EXISTS`); los tipos de triage se movieron a `core`. El paquete `cli` ahora depende de `agents` (Pro). 161 tests verdes + 1 skipped.

---

## Mejoras Futuras / Deuda Técnica

Items identificados para mejorar más adelante. No bloquean el MVP.

| ID | Tema | Detalle |
|----|------|---------|
| FI-001 | Driver SQLite | `node:sqlite` es un módulo `experimental` de Node. Si su estatus genera fricción (cambios de API en un Node mayor futuro, o un extension host de VSCode con Node < 22.5), migrar a `better-sqlite3`. La persistencia ya está aislada detrás de la clase `ColonyDb`, así que el cambio sería local. |
| FI-002 | Suite de tests | Los tests de integración de OpenGrep suman ~46s a `pnpm test`. Separar en `test:unit` (rápido) y `test:integration`. |
| FI-003 | Catálogo de reglas | `sentinel-baseline.yaml` tiene 4 reglas pattern-based. Ampliar el catálogo SAST (taint analysis, más CWEs, cobertura por lenguaje). |
| FI-004 | Cache de scanners del producto | El CLI resuelve los binarios desde `.scanners/` relativo al `cwd`. El producto enviado necesita una cache de scanners propia (global por usuario) y auto-instalación. |
| FI-005 | `ruleId` de OpenGrep | Cuando `--config` es la ruta de un archivo, OpenGrep prefija el `check_id` con los segmentos de esa ruta; el `Finding.ruleId` lo hereda. El CLI muestra `title` (segmento final, limpio). Evaluar normalizar `ruleId` a un id canónico en el normalizer. |
| FI-006 | `suppressedCount` en el tomo | ✅ **Resuelto (DG-023 A)** — `TomoSummary` incluye `suppressedCount`, tomado de `outcome.suppressedCount`. |
| FI-007 | Creación de `fp_known` | ✅ **Resuelto (DG-022 B)** — el comando CLI `mark-fp` y el Code Action "marcar falso positivo" de la extensión crean feromonas `fp_known`. |
| FI-008 | Empaquetado de la extensión (`.vsix`) | El MVP de la extensión asume el layout del monorepo en dev: la CLI en el paquete hermano (`cli/dist`) y `node` en el `PATH`. Empaquetar como `.vsix` requiere bundlear/instalar la CLI y resolver un runtime de Node y la cache de scanners (ver FI-004). |
| FI-009 | Cliente LLM | `AnthropicLlmClient` es un cliente mínimo vía `fetch` (desviación informada del v0.4 línea 695). Cuando se necesiten retries, streaming o rate-limiting (v0.4 §rate-limiting LLM), evaluar migrar a `@anthropic-ai/sdk` detrás del contrato `LlmClient`. |

---

## Technology Stack

- **Lenguaje**: TypeScript 5.9 estricto — LOCKED (v0.4 §9)
- **Runtime**: Node.js 20+ — verificado v24.11.1
- **Package manager**: pnpm workspaces v10.33.0 — DECIDIDO (Q1)
- **Estructura**: monorepo único OSS/Pro — DECIDIDO (DG-001 B)
- **Build**: `tsc -b` con project references
- **Tests**: Vitest 3
- **Linter/formatter**: ESLint 9 flat (typescript-eslint 8) + Prettier 3 — DECIDIDO (DG-006 B)
- **Superficie**: VSCode Extension API — LOCKED
- **DB local**: SQLite (`colony.db`, WAL mode) — driver `node:sqlite` (DG-013 A); capa `ColonyDb`
- **LLM**: `@anthropic-ai/sdk` con BYOK — LOCKED
- **Scanners**: binarios nativos pinneados descargados on-demand — DECIDIDO (DG-003 A)

---

## Project Overview

- **Name**: SENTINEL (Synaptic Sentinel)
- **Description**: Toolkit OSS de auditoría agéntica de seguridad + capa premium LLM, vibe-coding-native.
- **Phase**: Cycle 12 / Phase 5 — Gitleaks instalable (A.1); siguiente: `GitleaksScout` (A.2)

---

*Created: 2026-05-20T19:09:00.816Z*
*Last Updated: 2026-05-21T12:25:00.000Z*
*SYNAPTIC Protocol v3.0*
