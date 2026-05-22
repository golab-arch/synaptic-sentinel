# BITACORA - SENTINEL

## Active Tome

**Tomo 001** — Cycles 1-50 — abierto 2026-05-20

## Current Cycle

- **Cycle:** 49 — pendiente DG-056 (próximo paso del roadmap)
- **Phase:** 8 — Distribución
- **Status:** Cycle 48 CERRADO; remoto git configurado; awaiting DG-056
- **Compliance:** 100%
- **Synaptic Strength:** 53

## Cycles cerrados

- **Cycle 1-13** — discovery → scaffolding → PASO 4 → colony.db → Coordinator → CLI → reporters → GitleaksScout ✅
- **Cycle 14-26** — extensión VSCode MVP, Brain Layer (Triage/Context/Remediation), scouts Trivy/Checkov/Vibe-Detect ✅
- **Cycle 27-29** — surface del Brain Layer en la extensión · `ONBOARDING.md` · kill-switch del Coordinator ✅
- **Cycle 30-32** — UX verbose: CLI (DG-037) → pseudoterminal (DG-038) → webview "tomo vivo" (DG-039) ✅
- **Cycle 33-34** — la colonia aprende: `learning_records` escritura (DG-040) + lectura (DG-041) ✅
- **Cycle 35-41** — higiene/Prettier, SAST 11 reglas, SARIF, `--fail-on`, test split, `ruleId` canónico, CLI en inglés ✅
- **Cycle 42-45** — migración a inglés FI-011 (cerrado): scouts · reporter HTML · extensión · prompts del Brain Layer ✅
- **Cycle 46-47** — Phase 8: resolución (DG-053) + instalación `--global` (DG-054) de la cache de scanners (FI-004 cerrado) ✅
- **Cycle 48** — la CLI corre con el Node del extension host, FI-008 sub-increment 1 (DG-055 A) — `277651c` ✅

## Estado del repo

- 74 commits en `main` · **remoto:** `origin` → `github.com/golab-arch/synaptic-sentinel` (**privado**, en sync)
- **Push por ciclo activo** — cada cierre de ciclo hace `git push` (instrucción del usuario, DG-055)
- **Producto íntegramente en inglés** (FI-011 cerrado) · **cache de scanners global operativa** (FI-004 cerrado)
- **5 scouts**: OpenGrep (**11 reglas SAST**) + Gitleaks + Trivy + Checkov + Vibe-Detect + `colony.db` (v4) + `Coordinator` + `reporters`
- CLI: `scan` (export **JSON / HTML / SARIF**, **`--fail-on`**) y `triage`, `mark-fp`
- Extensión VSCode: `Scan/Triage/Set API Key`, hover, Code Actions, status bar, pseudoterminal verbose, webview "tomo vivo"; lanza la CLI con `process.execPath`
- **Brain Layer (Pro) COMPLETO** · **UX verbose COMPLETA** · **memoria del enjambre COMPLETA** · **CI-native COMPLETA**
- `verify` (format:check / lint / build / **test:unit**) verde · 313 tests + 3 gated (304 unit / 9+3 integration)

## Notas / deuda

- **Remoto privado configurado** (Entry #59) — cierra el diferimiento de DG-002 A. La publicación de la parte OSS (allowlist `publish-oss.ts`) es un proceso aparte y futuro.
- **Phase 8** — resta **FI-008**: bundlear la CLI dentro de la extensión, producir el `.vsix`, auto-instalación on-demand de scanners.
- **FI-003** — resta el **taint analysis**.
- Directorios extraños en `packages/vscode-extension/` gitignoreados (DG-038); siguen en disco.
- FI abiertos: FI-001 (driver SQLite, diferido), FI-003 (taint), FI-008 (.vsix), FI-009 (cliente LLM).
- **Instrucciones permanentes del usuario**: cada DG incluye mi recomendación explícita (DG-045); commit + push por ciclo (DG-055).

## Decision Gate abierto

- DG-056 — próximo paso del roadmap (a presentar)

## Last Entry

Entry #59 — INFRASTRUCTURE (remoto git + primer push) — 2026-05-22 — SUCCESS

---
