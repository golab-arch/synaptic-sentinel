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

---

## Mejoras Futuras / Deuda Técnica

Items identificados para mejorar más adelante. No bloquean el MVP.

| ID | Tema | Detalle |
|----|------|---------|
| FI-001 | Driver SQLite | `node:sqlite` es un módulo `experimental` de Node. Si su estatus genera fricción (cambios de API en un Node mayor futuro, o un extension host de VSCode con Node < 22.5), migrar a `better-sqlite3`. La persistencia ya está aislada detrás de la clase `ColonyDb`, así que el cambio sería local. |
| FI-002 | Suite de tests | Los tests de integración de OpenGrep suman ~46s a `pnpm test`. Separar en `test:unit` (rápido) y `test:integration`. |
| FI-003 | Catálogo de reglas | `sentinel-baseline.yaml` tiene 4 reglas pattern-based. Ampliar el catálogo SAST (taint analysis, más CWEs, cobertura por lenguaje). |

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
- **Phase**: Cycle 9 / Phase 4 — DG-012 B completo (scan end-to-end con persistencia); siguiente paso a definir (DG-015)

---

*Created: 2026-05-20T19:09:00.816Z*
*Last Updated: 2026-05-21T11:05:00.000Z*
*SYNAPTIC Protocol v3.0*
