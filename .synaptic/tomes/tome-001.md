# Tomo 001 — SENTINEL (Synaptic Sentinel)

**Cycles 1-50** · 2026-05-20 → 2026-05-22 · **CERRADO** 2026-05-22T23:30:00.000Z

| Métrica | Valor |
|---------|-------|
| Ciclos | 50 (50 SUCCESS, 0 FAILURE) |
| Tasa de éxito | 100% |
| Compliance promedio | 100% |
| Synaptic Strength al cierre | 55 |
| Decisiones | 58 (DG-001…DG-057 + Q1) — A: 33 · B: 24 · C: 1 |

## Qué se construyó

De discovery a un producto funcionalmente completo, íntegramente en inglés y en Phase 8 (Distribución):

- **Scout Layer** — 5 scouts: OpenGrep (SAST, 11 reglas pattern-based deterministas, CWE-95/78/79/502/327, `ruleId` canónico), Gitleaks (Secrets), Trivy (SCA), Checkov (IaC, binario standalone), Vibe-Detect (VibeCoded, detección nativa TypeScript).
- **Coordinator** — pipeline stages 1-2: scan → dedup por `fingerprint` → persistencia; supresión de `fp_known`; ciclo de vida `new`/`known` en re-scans; kill-switch por scout (presupuesto de tiempo + `AbortSignal`).
- **colony.db** — `node:sqlite`, schema v4 (`pheromones`, `scans`, `triage_verdicts`, `context_explanations`, `remediation_suggestions`, `learning_records`); memoria del enjambre completa (escritura + lectura, economía de tokens).
- **Brain Layer (Pro)** — 3 agentes wired al comando `triage`: Triage, Context, Remediation; contrato `BrainAgent`, frontera `LlmClient`, `AnthropicLlmClient` BYOK; llamada LLM real verificada.
- **CLI** — `scan` (export JSON / HTML / SARIF 2.1.0, política `--fail-on` con exit code 2), `triage`, `mark-fp`; salida verbose y dinámica.
- **Extensión VSCode** — arquitectura spawn-CLI; diagnostics inline, hover con el Brain Layer, Code Actions, status bar, pseudoterminal verbose, webview "tomo vivo"; BYOK vía `SecretStorage`; empaqueta su propia CLI bundleada (`dist/cli.mjs`).
- **Reporters** — modelo del tomo + export JSON (firma SHA-256), HTML, SARIF, consola.
- **Infra** — monorepo pnpm (7 paquetes OSS/Pro), `tsc -b`, ESLint 9 flat + Prettier, Vitest 3 (proyectos `unit`/`integration`), gate por ciclo `verify`, remoto git privado, `ONBOARDING.md`.

## Hitos por bloque de ciclos

- **Cycle 1-13** — discovery → scaffolding → PASO 4 (Scout Layer base) → colony.db → Coordinator → CLI → reporters → GitleaksScout.
- **Cycle 14-26** — extensión VSCode MVP; Brain Layer (Triage/Context/Remediation); scouts Trivy/Checkov/Vibe-Detect.
- **Cycle 27-29** — surface del Brain Layer en la extensión; `ONBOARDING.md`; kill-switch del Coordinator.
- **Cycle 30-32** — UX verbose: CLI → pseudoterminal → webview "tomo vivo".
- **Cycle 33-34** — la colonia aprende: `learning_records` (escritura + lectura).
- **Cycle 35-41** — higiene/Prettier, catálogo SAST a 11 reglas, reporter SARIF, `--fail-on`, split de tests, `ruleId` canónico, CLI en inglés.
- **Cycle 42-45** — migración a inglés (FI-011): mensajes de scouts, reporter HTML, extensión, prompts del Brain Layer.
- **Cycle 46-47** — Phase 8: cache de scanners global por usuario (resolución + `install-scanners --global`).
- **Cycle 48-50** — FI-008: Node del extension host (DG-055), manifest para `vsce` (DG-056), CLI bundleada dentro de la extensión (DG-057).

## Mejoras / deuda técnica

**Resueltas en el Tomo 001:** FI-002 (suite de tests, DG-046) · FI-004 (cache de scanners, DG-053+DG-054) · FI-005 (`ruleId` de OpenGrep, DG-047) · FI-006 (`suppressedCount`, DG-023) · FI-007 (creación de `fp_known`, DG-022) · FI-010 (drift de Prettier, DG-042) · FI-011 (producto en inglés, DG-048…DG-052).

**Abiertas al cierre:** FI-001 (driver SQLite — `node:sqlite` experimental; relevante para la CLI bundleada bajo el Node del extension host) · FI-003 (taint analysis) · FI-008 (empaquetado `.vsix` — resta producir el `.vsix` con `@vscode/vsce`) · FI-009 (cliente LLM — migración a `@anthropic-ai/sdk`).

## Aprendizajes de entorno

- **L-001** — Norton 360 intercepta TLS; `pnpm`/Node fallan con `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Workaround permanente: `NODE_OPTIONS=--use-system-ca`.
- **L-002** — Norton 360 bloquea escrituras en `.git/objects/`. Fix raíz: excluir la carpeta del proyecto de Auto-Protect/SONAR.

## Fuentes

El detalle completo vive en `../BITACORA.md` (Entries #0–#61), `INDEX.json` (índice de decisiones), `../DESIGN_DOC.md` (tabla de decisiones + historia de arquitectura) y `../INTELLIGENCE.json`.

---

*SYNAPTIC Protocol v3.0 — Tomo 001 archivado. Tomo 002 abierto desde el Cycle 51.*
