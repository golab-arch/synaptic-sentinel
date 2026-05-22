# BITACORA - SENTINEL

## Active Tome

**Tomo 001** — Cycles 1-50 — abierto 2026-05-20

## Current Cycle

- **Cycle:** 41 — pendiente DG-048 (próximo paso del roadmap)
- **Phase:** 7 — Brain Layer
- **Status:** Cycle 40 CERRADO; awaiting DG-048
- **Compliance:** 100%
- **Synaptic Strength:** 45

## Cycles cerrados

- **Cycle 1-13** — discovery → scaffolding → PASO 4 → colony.db → Coordinator → CLI → reporters → GitleaksScout ✅
- **Cycle 14-26** — extensión VSCode MVP, Brain Layer (Triage/Context/Remediation), scouts Trivy/Checkov/Vibe-Detect ✅
- **Cycle 27-29** — surface del Brain Layer en la extensión · `ONBOARDING.md` · kill-switch del Coordinator ✅
- **Cycle 30-32** — UX verbose: CLI (DG-037) → pseudoterminal (DG-038) → webview "tomo vivo" (DG-039) ✅
- **Cycle 33-34** — la colonia aprende: `learning_records` escritura (DG-040) + lectura/economía de tokens (DG-041) ✅
- **Cycle 35** — higiene del repo: Prettier + `format:check` en el gate (DG-042 A) — `09fe0ab` ✅
- **Cycle 36** — catálogo SAST de OpenGrep ampliado a 11 reglas (DG-043 B) — `fcf90a3` ✅
- **Cycle 37** — exportador SARIF 2.1.0 del tomo (DG-044 B) — `f12e2b6` ✅
- **Cycle 38** — política de exit code `--fail-on` para CI (DG-045 B) — `0e41fcf` ✅
- **Cycle 39** — separación `test:unit` / `test:integration` (DG-046 A) — `eef0d32` ✅
- **Cycle 40** — `ruleId` canónico de OpenGrep (DG-047 A) — `44118ca` ✅

## Estado del repo

- 58 commits en `main` · 7 paquetes pnpm
- **5 scouts**: OpenGrep (**11 reglas SAST**, `ruleId` canónico) + Gitleaks + Trivy + Checkov + Vibe-Detect + `colony.db` (v4) + `Coordinator` (stages 1-2, kill-switch) + `reporters`
- CLI: `scan` (export **JSON / HTML / SARIF**, **`--fail-on`** gate de CI) y `triage` con **salida verbose**, `mark-fp`
- Extensión VSCode: `Scan/Triage/Set API Key`, hover, Code Actions, status bar, **pseudoterminal verbose**, **webview "tomo vivo"**
- **Brain Layer (Pro) COMPLETO** · **UX verbose COMPLETA** · **memoria del enjambre COMPLETA** · **historia CI-native COMPLETA** (SARIF + `--fail-on`)
- Suite Vitest en 2 proyectos: **`unit`** (~7 s, gate por ciclo) e **`integration`**
- `verify` (format:check / lint / build / **test:unit**) verde · 310 tests + 3 gated (301 unit / 9+3 integration)

## Notas / deuda

- **FI-011 (NUEVO)** — toda la salida del producto debe migrar a **inglés**, por etapas (5 DGs futuros: CLI, reglas de scouts, reporters, extensión, prompts del Brain Layer). Principio inmediato: todo string de salida **nuevo** se escribe en inglés.
- **FI-003** — el catálogo SAST quedó en 11 reglas pattern-based; resta el **taint analysis**.
- Directorios extraños en `packages/vscode-extension/` gitignoreados (DG-038); siguen en disco — el usuario puede eliminarlos.
- FI abiertos: FI-001 (driver SQLite, diferido), FI-003 (taint), FI-004 (cache de scanners), FI-008 (.vsix), FI-009 (cliente LLM), FI-011 (salida en inglés).
- **Instrucción permanente del usuario** (desde DG-045): cada DG futuro debe incluir mi recomendación explícita sobre las opciones.

## Decision Gate abierto

- DG-048 — próximo paso del roadmap (a presentar)

## Last Entry

Entry #50 — FEATURE_IMPLEMENTED (DG-047 A) — 2026-05-22 — SUCCESS

---
