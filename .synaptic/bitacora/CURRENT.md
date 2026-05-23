# BITACORA - SENTINEL

## Active Tome

**Tomo 002** — Cycles 51-100 — abierto 2026-05-22 · Tomo 001 (Cycles 1-50) CERRADO, archivado en `tomes/tome-001.{json,md}`

## Current Cycle

- **Cycle:** 63 — pendiente DG-070 (apertura de Phase 10 — `vsce publish` runbook al marketplace)
- **Phase:** **9 CERRADA** → **Phase 10 — Launch v0.2.0** (a abrir con DG-070) · Phase 8 sigue COMPLETA funcionalmente · 🏁 **Cero deuda OPEN** · **Apache-2.0 + "The vibe-coding security sentinel" + repo PÚBLICO + release v0.2.0 publicado**
- **Status:** Cycle 62 CERRADO (DG-069 B — release v0.2.0 + GitHub Release público con `.vsix` descargable, SHA-256 expuesto); **Phase 9 (Strategic Pivot) CERRADA en 4 sub-increments balanceados (DG-066..DG-069)**; awaiting DG-070
- **Compliance:** 100%
- **Synaptic Strength:** 67

## Cycles cerrados

- **Cycle 1-13** — discovery → scaffolding → PASO 4 → colony.db → Coordinator → CLI → reporters → GitleaksScout ✅
- **Cycle 14-26** — extensión VSCode MVP, Brain Layer (Triage/Context/Remediation), scouts Trivy/Checkov/Vibe-Detect ✅
- **Cycle 27-29** — surface del Brain Layer en la extensión · `ONBOARDING.md` · kill-switch del Coordinator ✅
- **Cycle 30-32** — UX verbose: CLI (DG-037) → pseudoterminal (DG-038) → webview "tomo vivo" (DG-039) ✅
- **Cycle 33-34** — la colonia aprende: `learning_records` escritura (DG-040) + lectura (DG-041) ✅
- **Cycle 35-41** — higiene/Prettier, SAST 11 reglas, SARIF, `--fail-on`, test split, `ruleId` canónico, CLI en inglés ✅
- **Cycle 42-45** — migración a inglés FI-011 (cerrado): scouts · reporter HTML · extensión · prompts del Brain Layer ✅
- **Cycle 46-47** — Phase 8 abierta: cache de scanners global por usuario (FI-004 cerrado) ✅
- **Cycle 48-50** — FI-008: Node del extension host (DG-055) · manifest vsce (DG-056) · CLI bundleada (DG-057) ✅
- **Cycle 51-52** — FI-008 cerrado: `.vsix` producido (DG-058) + sub-comando turnkey "Install Scanners" (DG-059) → **Phase 8 COMPLETA** ✅
- **Cycle 53** — FI-001 migración inicial a `better-sqlite3` NAPI (DG-060 B) — corregida en Cycle 55 ✅
- **Cycle 54** — FI-003 etapa 1 (JS/TS): 3 reglas `mode: taint` (DG-061 B) ✅
- **Cycle 55** — Pivot a `node-sqlite3-wasm` + fix FP SQL (DG-062 B): cierra FI-001 de raíz tras la prueba del usuario ✅
- **Cycle 56** — FI-003 etapa 2 (Python): 3 reglas `mode: taint` (DG-063 B) → **FI-003 cerrado entero** ✅
- **Cycle 57** — FI-009: `AnthropicLlmClient` → `@anthropic-ai/sdk` oficial (DG-064 A) → 🏁 **`futureImprovements` vacía por primera vez** ✅
- **Cycle 58** — Marketplace polish v0.1.0 alineado con la familia SYNAPTIC (DG-065 A): publisher, icono, galleryBanner, CHANGELOG, README marketplace-ready ✅ · _follow-up Entry #70 (commit `9f44a82`): tras feedback visual del usuario — logo OFICIAL de la familia GoLab (sustituye al Sentinel-específico, removidos `icon.svg` + `render-icon.mjs`), publisher `RealGoLab`→`GoLab` (id `golab.synaptic-sentinel`), casing `Synaptic Sentinel`→`SYNAPTIC Sentinel` en toda la superficie user-visible_
- **Cycle 59** — 🔀 **Apertura de Phase 9 — Strategic Pivot** (DG-066 B): giro estratégico ratificado por el usuario a **OSS full Apache-2.0** ("lanzar full capabilities como el mejor sentinela del mundo enfocado en vibe-coding"). Sub-increment atómico de sustrato legal: `LICENSE-PRO` eliminado, `packages/agents` re-licenciado a `Apache-2.0`, header `[PRO]` retirado. DG-001 B **amendado** (`publish-oss.ts` allowlist obsoleto bajo el giro) ✅
- **Cycle 60** — **Phase 9 sub-increment 2: re-positioning textual** (DG-067 B): tagline elegida por el usuario "**The vibe-coding security sentinel**" (tone conservador — no "world's best"). 5 archivos user-visible reescritos: `README.md` raíz, `packages/vscode-extension/README.md`, `CHANGELOG.md` (nueva entrada `[0.2.0] - _Unreleased — to be cut in DG-069_`), `ONBOARDING.md`, `packages/vscode-extension/package.json` (description + keywords `ai-generated-code`/`llm-security`). Apache-2.0 declarado en todas las superficies user-visible; Brain Layer sin "Pro/proprietary" ✅
- **Cycle 61** — 🌐 **Phase 9 sub-increment 3: repo PÚBLICO** (DG-068 B): primera acción outward-facing real del proyecto. Pre-flight `gitleaks` sobre historia completa PASS (único hit en fixture deliberadamente vulnerable de `tests/.../fixtures/secrets/`, excluido por guardrail). Metadata refresh (description + homepage al marketplace listing + 10 topics: `vibe-coding`/`security`/`sast`/`taint-analysis`/`ai-coding`/`ai-generated-code`/`llm-security`/`byok`/`vscode-extension`/`synaptic`). `gh repo edit --visibility public --accept-visibility-change-consequences` ejecutado; `gh repo view` confirma `visibility: PUBLIC` + `licenseInfo: Apache-2.0` (detectado automáticamente por GitHub desde `LICENSE` en raíz) ✅
- **Cycle 62** — 🚀 **Phase 9 sub-increment 4 (cierra Phase 9): release `v0.2.0`** (DG-069 B): bump `package.json` `0.1.0` → `0.2.0`; cut CHANGELOG date `[0.2.0] - 2026-05-23`; `pnpm verify` verde; `vsce package` → `synaptic-sentinel-0.2.0.vsix` (429 archivos, 1.27 MB, manifest validado). Annotated tag `v0.2.0` push. `gh release create v0.2.0` con asset `.vsix` descargable: [github.com/golab-arch/synaptic-sentinel/releases/tag/v0.2.0](https://github.com/golab-arch/synaptic-sentinel/releases/tag/v0.2.0) · `isDraft=false` · SHA-256 expuesto por GitHub vía `digest` ✅ — **Phase 9 CERRADA**

## Tomo 001 — CERRADO

- **Cycles 1-50** · 2026-05-20 → 2026-05-22 · 50 ciclos, 100% de éxito · 58 decisiones (DG-001…DG-057 + Q1)
- Archivo: `tomes/tome-001.json` + `tomes/tome-001.md`

## Estado del repo

- 102 commits + tag `v0.2.0` · `origin` → `github.com/golab-arch/synaptic-sentinel` 🌐 **PÚBLICO** (DG-068 B · Apache-2.0 detectado por GitHub · 10 topics) · 🚀 **GitHub Release `v0.2.0`** con `.vsix` descargable (DG-069 B) · push por ciclo activo
- **Licencia unificada Apache-2.0** (DG-066 B — `LICENSE-PRO` eliminado, `packages/agents` re-licenciado) · **Producto íntegramente en inglés** (FI-011 cerrado) · **cache de scanners global operativa** (FI-004 cerrado)
- **5 scouts**: OpenGrep (**17 reglas SAST** — 11 pattern-based + 6 taint, JS/TS + Python) + Gitleaks + Trivy + Checkov + Vibe-Detect + `colony.db` (v4, **node-sqlite3-wasm**) + `Coordinator` + `reporters`
- CLI: `scan` (export **JSON / HTML / SARIF**, **`--fail-on`**) · `triage` · `mark-fp` · `scanners install [--global]`
- **Brain Layer (Apache-2.0)**: 3 agentes via **`@anthropic-ai/sdk` oficial** detrás del contrato `LlmClient` · BYOK Anthropic (clave del usuario en `vscode.SecretStorage`)
- Extensión VSCode: comandos/hover/Code Actions/status bar/pseudoterminal/webview + comando "SYNAPTIC Sentinel: Install Scanners" turnkey; **`.vsix v0.1.0` marketplace-ready** (`synaptic-sentinel-0.1.0.vsix`, 1.27 MB, id `golab.synaptic-sentinel`, logo OFICIAL GoLab + galleryBanner alineados con la familia SYNAPTIC) · bump a v0.2.0 + regenerado en DG-069
- **Brain Layer COMPLETO** · **UX verbose COMPLETA** · **memoria del enjambre COMPLETA** · **CI-native COMPLETA** · **Distribución COMPLETA** · **Detección con taint COMPLETA** · **Cliente LLM oficial COMPLETO** · **Marketplace polish COMPLETO** · **Sustrato legal unificado COMPLETO**
- `verify` (format:check / lint / build / **test:unit**) verde · 313 tests + 3 gated (302 unit / 11+3 integration)

## Notas / deuda

- 🔀 **Phase 9 abierta** — pivot estratégico a **OSS full Apache-2.0** ratificado por el usuario (DG-066 B). El producto se reposiciona como **"the world's best security sentinel for vibe-coded projects"** con todas las capacidades en un solo SKU bajo Apache-2.0 (la "capa premium" deja de existir como tier diferenciado). Monetización **diferida** (sponsors / consulting / hosted version a posteriori).
- 🏁 **`futureImprovements` sigue vacía** — cero deuda técnica registrada.
- **DG-001 B amendado** — `publish-oss.ts` allowlist obsoleto bajo el giro (no hay código Pro que filtrar). La decisión arquitectónica fue correcta para la estrategia de entonces; el cambio es estratégico, no arquitectónico.
- 🏁 **Phase 9 (Strategic Pivot) CERRADA** en 4 sub-increments balanceados (DG-066..DG-069). El producto unificado bajo Apache-2.0 con posicionamiento "The vibe-coding security sentinel" es ahora **real, público, descargable e instalable** desde el repo público (independiente del marketplace).
- **Próxima Phase 10 — Launch v0.2.0 al marketplace**: DG-070 abre con `docs/PUBLISHING.md` runbook + script alias `publish:marketplace` + verificación post-publish. El `vsce publish` efectivo lo dispara el usuario con su PAT de Azure DevOps Marketplace.
- **Anti-optimismo ilusorio activo**: el `v0.2.0` publicado es funcionalmente IDÉNTICO al `v0.1.0` (cero cambios de código en Phase 9); cambian licencia + posicionamiento + visibilidad + distribución. NO promete features nuevas; el marketplace `GoLab.synaptic-sentinel` sigue retornando 404 hasta Phase 10.
- **Instrucciones permanentes**: cada DG incluye mi recomendación explícita (DG-045); commit + push por ciclo (DG-055).

## Decision Gate abierto

- DG-070 — apertura de Phase 10 (Launch v0.2.0): publication runbook + script alias `publish:marketplace` (a presentar)

## Last Entry

Entry #74 — RELEASE_CUT (DG-069 B) — 2026-05-23 — SUCCESS · release `v0.2.0` cortado + GitHub Release público con asset `.vsix` descargable · **Phase 9 CERRADA**

---
