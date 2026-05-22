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
| DG-026 | Próximo paso del roadmap | **Option A** — surface del triage en el tomo (cada hallazgo lleva su veredicto; `byTriage` en el resumen) | 2026-05-21 | Los veredictos se persistían pero eran invisibles fuera de la consola; surfacearlos en el deliverable (tomo JSON+HTML) completa el valor del Brain Layer |
| DG-027 | Próximo paso del roadmap | **Option B** — triage en la extensión VSCode: BYOK vía `SecretStorage` + comando de triage + veredictos en los diagnostics | 2026-05-21 | El producto es VSCode-primary y el triage solo era alcanzable por CLI; el v0.4 §487 incluye "BYOK configurable vía VSCode SecretStorage" en la definición de "Done" del MVP |
| DG-028 | Próximo paso del roadmap | **Option B** — Context Agent: 2.º agente del Brain Layer (explicación contextualizada de los true positives) | 2026-05-21 | El Brain Layer con un solo agente era delgado; el Context Agent reutiliza el contrato `BrainAgent` ya de-riskeado (DG-024) y profundiza el diferenciador premium |
| DG-029 | Próximo paso del roadmap | **Option A** — wire del Context Agent: el comando `triage` lo corre sobre los TP; explicaciones persistidas (schema v3) y surfaceadas en el tomo | 2026-05-21 | El Context Agent estaba construido sin consumidor; el wiring completa DG-028 reutilizando los patrones probados de DG-025 y DG-026 |
| DG-030 | Próximo paso del roadmap | **Option A** — `TrivyScout` (cuarto scout, cobertura SCA — dependencias vulnerables) | 2026-05-21 | El Scout Layer cubría SAST y Secrets pero no SCA; Trivy es bajo riesgo (patrón de scout probado ×2) y el Brain Layer aplica gratis a sus hallazgos |
| DG-031 | Próximo paso del roadmap | **Option A** — `CheckovScout` (quinto scout, cobertura IaC — misconfiguraciones en Dockerfile/Terraform/k8s) | 2026-05-21 | El Scout Layer cubría SAST, Secrets y SCA pero no IaC; patrón de scout probado ×4 y el binario standalone de Checkov sortea la observación "Python 3.14" |
| DG-032 | Próximo paso del roadmap | **Option B** — `VibeDetectScout` (detección de código *vibe-coded* — anti-patrones de código generado por IA, categoría `VibeCoded`) | 2026-05-21 | El Scout Layer cubría SAST/Secrets/SCA/IaC pero no el diferenciador del producto; detección determinista nativa (sin binario OSS) = 100% verificable sin API key; la categoría `VibeCoded` ya existía en el schema sin uso |
| DG-033 | Próximo paso del roadmap | **Option A** — Remediation Agent (3.er agente del Brain Layer — propone cómo corregir un verdadero positivo) | 2026-05-21 | El Brain Layer tenía 2 de 3 agentes; el Remediation Agent reusa el contrato `BrainAgent` probado ×2 y con la llamada LLM verificada → riesgo bajo; completa el trío Triage→Context→Remediation |
| DG-034 | Próximo paso del roadmap | **Option B** — surface del Brain Layer completo en la extensión VSCode (hover con triage/contexto/remediación + Code Action de remediación + `.vscode/launch.json`) | 2026-05-21 | El Brain Layer completo solo era visible en el tomo/CLI; surfacearlo en el IDE (superficie primaria) y desbloquear el F5 era el paso natural de riesgo medio |
| DG-035 | Próximo paso del roadmap | **Option A** — documento de onboarding (`ONBOARDING.md` + README al día + `docs/colony-db.md` v4) | 2026-05-21 | Con la extensión F5-testeable, documentar el uso es un deliverable real del roadmap "Output & Polish" con riesgo mínimo; vuelve el producto usable sin leer el código |
| DG-036 | Próximo paso del roadmap | **Option B** — kill-switch del Coordinator: presupuesto de tiempo por scout (v0.4 §9.6) | 2026-05-21 | Un scanner colgado bloqueaba el scan entero; el kill-switch es un requisito del threat model ("Rogue Agents") y la inversión correcta en robustez antes del beta |
| DG-037 | Salida verbose dinámica del scan (UX techie/hacker) | **Option B** — increment 1/3: la CLI emite el "show" (banner + drip por scout + reveal coloreado); increments 2-3 (pseudoterminal en la extensión, webview "tomo vivo") pendientes | 2026-05-21 | La prueba F5 reveló que la extensión no daba feedback del proceso (gap no cubierto por v0.4 §4.3); la CLI como motor del show beneficia también al público OSS/terminal con un solo esfuerzo |
| DG-038 | UX verbose increment 2/3 | **Option B** — la extensión transmite el "show" de la CLI a un Pseudoterminal nativo (Scan + Triage); el comando `triage` de la CLI se enriquece | 2026-05-21 | Cierra la arquitectura "un show, dos superficies" con una API nativa (Pseudoterminal, sin webview — respeta Decisión #23); el feedback del proceso pasa a verse en el IDE |
| DG-039 | UX verbose increment 3/3 | **Option B** — webview "tomo vivo": panel lateral con los hallazgos agrupados por severidad, clickeables para saltar al código (v0.4 §4.3) | 2026-05-21 | Cierra DG-037 B con la superficie de exploración de resultados que pedía v0.4 §4.3; el webview está sancionado por §4.3 pese a la preferencia general por APIs nativas |
| DG-040 | Próximo paso del roadmap (la colonia aprende) | **Option B** — `learning_records` increment 1 (lado escritura): el triage registra el patrón generalizado de cada veredicto decisivo | 2026-05-21 | Activa el corazón conceptual del producto (la memoria del enjambre, v0.4 §3.5), dormido desde el inicio; increment de escritura acotado y verificable de-riskea el lado lectura |
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
- ✅ Observación resuelta (DG-031 A): Python 3.14 vs Checkov — Checkov se integró vía su binario standalone (PyInstaller onefile); no requiere un intérprete de Python en el cliente.
- ✅ Verificado (DG-032, BITACORA Entry #34): la llamada LLM real a Anthropic — los 2 tests de integración del Brain Layer (Triage/Context) pasaron contra la Messages API (Haiku 4.5) con una API key BYOK provista por el usuario. El round-trip `AnthropicLlmClient`→API→parseo→validación `zod` queda verificado.
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
- 2026-05-21 — Cycle 19: surface del triage en el tomo (DG-026 A) — `TomoFinding` = `Finding` + `triage` opcional; `buildTomo` hace join por `fingerprint` con los veredictos de `colony.db`; el resumen gana `byTriage` y el HTML muestra el veredicto por hallazgo. El tomo pasa de "hallazgos crudos" a "hallazgos triados". 165 tests verdes + 1 skipped.
- 2026-05-21 — Cycle 20: triage en la extensión VSCode (DG-027 B) — comandos `Triage Findings` y `Set Anthropic API Key`; **BYOK vía `vscode.SecretStorage`** (key cifrada por el SO, pasada al child process por entorno, nunca por argumentos); los veredictos se anotan en los diagnostics del IDE. El Brain Layer es alcanzable desde la superficie primaria. 171 tests verdes + 1 skipped.
- 2026-05-21 — Cycle 21: Context Agent (DG-028 B) — 2.º agente del Brain Layer: `ContextAgent` (`BrainAgent<Finding, ContextExplanation>`) explica la cadena de explotabilidad (entrada → sink → exposición) de un hallazgo confirmado. `ContextExplanation` en `core`; `extractJsonObject` reubicado a `brain-agent.ts` (util compartido). Sin wiring al pipeline aún. 180 tests verdes + 2 skipped.
- 2026-05-21 — Cycle 22: wire del Context Agent (DG-029 A) — el comando `triage` corre el Context Agent sobre los true positives; las explicaciones se persisten (**schema v3**, tabla `context_explanations`) y se surfacean en el tomo (JSON + HTML). `buildTomo` refactorizado a un objeto `TomoEnrichment` (extensible para futuros agentes). 187 tests verdes + 2 skipped.
- 2026-05-21 — Cycle 23: `TrivyScout` (DG-030 A) — cuarto scout: **Trivy v0.70.0** (SCA, dependencias vulnerables). `scouts/trivy/` (output schema + normalizer Trivy→`Finding` categoría `SCA` + `TrivyScout`); el CLI corre 3 scouts. Fix de `install-scanners`: extracción de `.zip` en Windows vía PowerShell `Expand-Archive` (el `tar` de Windows interpretaba `D:\...` como host remoto). 197 tests verdes + 2 skipped.
- 2026-05-21 — Cycle 24: `CheckovScout` (DG-031 A) — quinto scout: **Checkov 3.2.529** (IaC, misconfiguraciones en Dockerfile/Terraform/k8s). `scouts/checkov/` (output schema unión objeto|array + normalizer Checkov→`Finding` categoría `IaC`, severidad `null` de Checkov OSS → `medium` + `CheckovScout`); el CLI corre 4 scouts. Fix de `install-scanners`: extracción de `.zip` en Unix vía `unzip` + campo `archiveDir` que aplana el binario empaquetado bajo `dist/`. Checkov se integra como binario standalone (sin intérprete Python). 208 tests verdes + 2 skipped.
- 2026-05-21 — Cycle 25: `VibeDetectScout` (DG-032 B) — scout de detección de código *vibe-coded* (categoría `VibeCoded`), el scout firma del producto vibe-coding-native. `scouts/vibe-detect/` (`detectors.ts` — catálogo curado de 6 detectores heurísticos regex; `detect.ts` — `runVibeDetectors` función pura; `vibe-detect-scout.ts` — `VibeDetectScout` con walker propio del árbol de archivos). Detección **nativa en TypeScript, sin binario OSS**: siempre disponible, 100% determinista. El CLI corre 5 scouts. Además — gap histórico cerrado: los 2 tests de integración del Brain Layer (Triage/Context) se corrieron con una API key BYOK del usuario y **pasaron contra la API real de Anthropic** (Haiku 4.5). `cli-runner.test` timeout 60s→120s (FI-002). 221 tests verdes + 2 gated.
- 2026-05-21 — Cycle 26: `Remediation Agent` (DG-033 A) — 3.er y último agente del Brain Layer: propone cómo corregir un verdadero positivo. `core/types/remediation.ts` (`RemediationSuggestion` + `Record`); **colony.db schema v4** (tabla aditiva `remediation_suggestions`); `agents/remediation-agent.ts` (`RemediationAgent` — `BrainAgent<Finding, RemediationSuggestion>`); wiring en el comando `triage` (corre sobre los TP junto a Context) y surface en el tomo JSON/HTML. Completa el trío Triage→Context→Remediation. RemediationAgent verificado contra la API real de Anthropic; E2E scan→triage→export con el bloque de remediación en el HTML. 241 tests verdes + 3 gated.
- 2026-05-21 — Cycle 27: surface del Brain Layer en la extensión (DG-034 B) — la extensión VSCode muestra el Brain Layer completo: `HoverProvider` con triage + cadena de contexto + remediación sobre los hallazgos bajo el cursor, y una Code Action "copiar remediación sugerida". `vscode-extension/` (`tomo.ts` — `ExtensionFinding` gana context/remediation; `diagnostics.ts` — `findingHoverMarkdown` + `remediationClipboardText` puras; `index.ts` — HoverProvider + comando + Code Action). **`.vscode/launch.json`** creado: la extensión ya es F5-testeable. Decisión honesta: la Code Action copia al portapapeles, no inserta en el buffer (la remediación es orientativa, no un patch). 250 tests verdes + 3 gated.
- 2026-05-21 — Cycle 28: documento de onboarding (DG-035 A) — `ONBOARDING.md` (guía completa: instalación, uso de la CLI y la extensión, arquitectura, troubleshooting); `README.md` al día (5 scouts, Brain Layer con 3 agentes, licencias reales); `docs/colony-db.md` con las tablas v2-v4. Hallazgo honesto: `format:check` —fuera del gate de verificación por ciclo— revela drift de Prettier preexistente en ~41 archivos → **FI-010**. Ciclo de documentación, sin cambios de código: 250 tests verdes + 3 gated.
- 2026-05-21 — Cycle 29: kill-switch del Coordinator (DG-036 B) — presupuesto de tiempo por scout (v0.4 §9.6 "Rogue Agents"). `ScanOptions.scoutTimeoutMs` (default 5 min); cada scout corre con una `AbortSignal` propia —enlazada al `signal` del llamante— y su ejecución compite (`Promise.race`) contra la cancelación: un scout colgado que ignora su signal se cancela igual y se reporta `failed`, sin colgar el scan. Sin cambios en el CLI (usa el presupuesto por defecto). 253 tests verdes + 3 gated.
- 2026-05-21 — Cycle 30: salida verbose y dinámica de la CLI (DG-037 B, increment 1/3) — tras la prueba F5 del usuario (Entry #39, gap "extensión en vivo" cerrado). `reporters/console-reporter.ts` (render puro: banner, glifos/colores por severidad v0.4 §4.3, `renderScanReveal`); `Coordinator.onScoutSettled` (callback de progreso); `cli/spinner.ts` (spinner braille); el comando `scan` imprime banner → drip en vivo por scout → reveal coloreado, con `--no-color` / `shouldUseColor`. Arquitectura "un show, dos superficies": el motor vive en la CLI, la extensión lo reusará (increment 2). 267 tests verdes + 3 gated.
- 2026-05-21 — Cycle 31: pseudoterminal verbose en la extensión (DG-038 B, increment 2/3) — la extensión transmite el "show" de la CLI a un Pseudoterminal nativo de VSCode. `vscode-extension/terminal.ts` (`SentinelTerminal`), `terminal-format.ts` (`toCrlf`), `cli-runner.ts` (streaming vía `onOutput` + `FORCE_COLOR=1`); los comandos Scan y Triage abren la terminal "Synaptic Sentinel". `cli/triage.ts` enriquecido (banner + `renderTriageTag`). `.gitignore` ignora los dirs extraños de subpaquetes. Cierra "un show, dos superficies" con API nativa (sin webview). 273 tests verdes + 3 gated.
- 2026-05-21 — Cycle 32: webview "tomo vivo" (DG-039 B, increment 3/3 — cierra DG-037 B) — panel lateral con los hallazgos del último scan, agrupados por severidad y clickeables para saltar al código (v0.4 §4.3). `vscode-extension/webview-content.ts` (`renderTomoWebviewHtml`, render puro con CSP+nonce y `escapeHtml`), `tomo-view.ts` (`SentinelTomoViewProvider`), `package.json` (`contributes.views`). Arquitectura spawn-CLI intacta (`escapeHtml` propio, no se importa el motor). **UX verbose completa**: CLI → pseudoterminal → webview. 279 tests verdes + 3 gated.
- 2026-05-21 — Cycle 33: la colonia aprende — `learning_records` increment 1 (DG-040 B) — activa la tabla `learning_records`, inerte desde v1 (v0.4 §3.5). `core/types/learning.ts` (`LearningRecord`, `patternSignature` = `${category}:${ruleId}`, `triageClassificationToLearning`); `colony-db.ts` (`recordLearningBatch` — upsert por `(pattern_signature, classification)`; `getLearningRecords`); `cli/triage.ts` alimenta `learning_records` con los veredictos decisivos. `learning_records` generaliza por patrón (cross-scan/cross-ubicación), distinto de `triage_verdicts` (por `fingerprint` exacto). Sin cambio de schema. E2E verificado. 289 tests verdes + 3 gated.

---

## Mejoras Futuras / Deuda Técnica

Items identificados para mejorar más adelante. No bloquean el MVP.

| ID | Tema | Detalle |
|----|------|---------|
| FI-001 | Driver SQLite | `node:sqlite` es un módulo `experimental` de Node. Si su estatus genera fricción (cambios de API en un Node mayor futuro, o un extension host de VSCode con Node < 22.5), migrar a `better-sqlite3`. La persistencia ya está aislada detrás de la clase `ColonyDb`, así que el cambio sería local. |
| FI-002 | Suite de tests | Los tests de integración (OpenGrep, Trivy, Checkov, `cli-runner`) dominan el tiempo de `pnpm test` y rozan sus timeouts bajo contención de CPU (`cli-runner` subido a 120s en DG-032). Separar en `test:unit` (rápido) y `test:integration`. |
| FI-003 | Catálogo de reglas | `sentinel-baseline.yaml` tiene 4 reglas pattern-based. Ampliar el catálogo SAST (taint analysis, más CWEs, cobertura por lenguaje). |
| FI-004 | Cache de scanners del producto | El CLI resuelve los binarios desde `.scanners/` relativo al `cwd`. El producto enviado necesita una cache de scanners propia (global por usuario) y auto-instalación. |
| FI-005 | `ruleId` de OpenGrep | Cuando `--config` es la ruta de un archivo, OpenGrep prefija el `check_id` con los segmentos de esa ruta; el `Finding.ruleId` lo hereda. El CLI muestra `title` (segmento final, limpio). Evaluar normalizar `ruleId` a un id canónico en el normalizer. |
| FI-006 | `suppressedCount` en el tomo | ✅ **Resuelto (DG-023 A)** — `TomoSummary` incluye `suppressedCount`, tomado de `outcome.suppressedCount`. |
| FI-007 | Creación de `fp_known` | ✅ **Resuelto (DG-022 B)** — el comando CLI `mark-fp` y el Code Action "marcar falso positivo" de la extensión crean feromonas `fp_known`. |
| FI-008 | Empaquetado de la extensión (`.vsix`) | El MVP de la extensión asume el layout del monorepo en dev: la CLI en el paquete hermano (`cli/dist`) y `node` en el `PATH`. Empaquetar como `.vsix` requiere bundlear/instalar la CLI y resolver un runtime de Node y la cache de scanners (ver FI-004). |
| FI-009 | Cliente LLM | `AnthropicLlmClient` es un cliente mínimo vía `fetch` (desviación informada del v0.4 línea 695). Cuando se necesiten retries, streaming o rate-limiting (v0.4 §rate-limiting LLM), evaluar migrar a `@anthropic-ai/sdk` detrás del contrato `LlmClient`. |
| FI-010 | Drift de Prettier | `pnpm format:check` falla en ~41 archivos: drift de formato acumulado en ciclos previos porque `format:check` no estaba en el gate de verificación (el gate era `build` + `lint` + `test`). Correr `pnpm format` en un ciclo dedicado y agregar `format:check` al gate por ciclo. Detectado en DG-035. |

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
- **Phase**: Cycle 34 / Phase 7 — Brain Layer COMPLETO; 5 scouts + Coordinator con kill-switch + 3 agentes; UX verbose COMPLETA; memoria del enjambre activa (`learning_records`, lado escritura); siguiente: DG-041

---

*Created: 2026-05-20T19:09:00.816Z*
*Last Updated: 2026-05-21T22:30:00.000Z*
*SYNAPTIC Protocol v3.0*
