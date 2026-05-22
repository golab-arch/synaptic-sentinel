# BITACORA - SENTINEL

## Active Tome

**Tomo 001** — Cycles 1-50 — abierto 2026-05-20

## Current Cycle

- **Cycle:** 47 — pendiente DG-054 (próximo paso del roadmap)
- **Phase:** 8 — Distribución
- **Status:** Cycle 46 CERRADO; awaiting DG-054
- **Compliance:** 100%
- **Synaptic Strength:** 51

## Cycles cerrados

- **Cycle 1-13** — discovery → scaffolding → PASO 4 → colony.db → Coordinator → CLI → reporters → GitleaksScout ✅
- **Cycle 14-26** — extensión VSCode MVP, Brain Layer (Triage/Context/Remediation), scouts Trivy/Checkov/Vibe-Detect ✅
- **Cycle 27-29** — surface del Brain Layer en la extensión · `ONBOARDING.md` · kill-switch del Coordinator ✅
- **Cycle 30-32** — UX verbose: CLI (DG-037) → pseudoterminal (DG-038) → webview "tomo vivo" (DG-039) ✅
- **Cycle 33-34** — la colonia aprende: `learning_records` escritura (DG-040) + lectura (DG-041) ✅
- **Cycle 35-41** — higiene/Prettier, SAST 11 reglas, SARIF, `--fail-on`, test split, `ruleId` canónico, CLI en inglés ✅
- **Cycle 42-45** — migración a inglés FI-011: scouts · reporter HTML · extensión · prompts del Brain Layer (FI-011 cerrado) ✅
- **Cycle 46** — **abre Phase 8**: cache de scanners global por usuario (DG-053 C) — `8a1e045` ✅

## Estado del repo

- 70 commits en `main` · 7 paquetes pnpm
- **Producto íntegramente en inglés** (FI-011 cerrado)
- **5 scouts**: OpenGrep (**11 reglas SAST**, `ruleId` canónico) + Gitleaks + Trivy + Checkov + Vibe-Detect + `colony.db` (v4) + `Coordinator` (stages 1-2, kill-switch) + `reporters`
- CLI: `scan` (export **JSON / HTML / SARIF**, **`--fail-on`**, resolución desde **cache global** `~/.synaptic-sentinel/scanners`) y `triage`, `mark-fp`
- Extensión VSCode: `Scan/Triage/Set API Key`, hover, Code Actions, status bar, **pseudoterminal verbose**, **webview "tomo vivo"**
- **Brain Layer (Pro) COMPLETO** · **UX verbose COMPLETA** · **memoria del enjambre COMPLETA** · **CI-native COMPLETA**
- Suite Vitest en 2 proyectos: **`unit`** (~7 s, gate por ciclo) e **`integration`**
- `verify` (format:check / lint / build / **test:unit**) verde · 313 tests + 3 gated (304 unit / 9+3 integration)

## Notas / deuda

- **Phase 8 (Distribución) abierta** — FI-004 sub-increment 1 (resolución desde la cache global) hecho; restan: **FI-004 sub-increment 2 (auto-instalación)** y **FI-008 (.vsix)**.
- **FI-003** — el catálogo SAST quedó en 11 reglas pattern-based; resta el **taint analysis**.
- Directorios extraños en `packages/vscode-extension/` gitignoreados (DG-038); siguen en disco — el usuario puede eliminarlos.
- FI abiertos: FI-001 (driver SQLite, diferido), FI-003 (taint), FI-004 (auto-instalación), FI-008 (.vsix), FI-009 (cliente LLM).
- **Instrucción permanente del usuario** (desde DG-045): cada DG futuro debe incluir mi recomendación explícita sobre las opciones.

## Decision Gate abierto

- DG-054 — próximo paso del roadmap (a presentar)

## Last Entry

Entry #56 — FEATURE_IMPLEMENTED (DG-053 C) — 2026-05-22 — SUCCESS

---
