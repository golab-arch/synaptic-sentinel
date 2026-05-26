# Changelog

All notable changes to the SYNAPTIC Sentinel extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.4] - 2026-05-26

**Six accumulated improvements** from sub-DGs `DG-083 A` through `DG-088 A`. No new features removed; six caveats from the v0.3.0 "Known Issues" section are now resolved (5 of 6 originals = **83% of the v0.3.0 backlog closed**). The remaining caveat (ground truth `ai-draft` review) requires a human AppSec engineer and is left documented and structured. The verify gate is now **cumulative with 2 release-blocker prevention steps** that retro-actively cover the 3 hotfixes that produced v0.3.1 / v0.3.2 / v0.3.3.

### Added

- **`scripts/verify-manifest.mjs` gate** (DG-083 A) — 18 assertions on `packages/vscode-extension/package.json` (publisher, name, license, main, semver version, engines.vscode minimum, icon field + file exists, displayName, description, categories, keywords, repository URL, homepage, bugs URL, activationEvents, contributes.commands ≥ 5). Wired into `pnpm verify` chain. Catches the class of bug that produced the `DG-082.1` hotfix (publisher mismatch rejected at Marketplace upload), retro-actively.
- **Ollama heavy-model warning + "Don't remind me again" toggle** (DG-087 A) — in the Settings panel ("Configure Brain Layer Providers"), each Ollama model now shows its disk size; models > 5 GB get a `⚠ heavy` badge and the panel shows a warning explaining the RAM-saturation caveat observed during the `DG-077` benchmark (Gemma 4 at 9.6 GB / `gpt-oss:20b` at 13 GB saturated user RAM after ~2 hours of sustained inference). The user can dismiss the warning with "Don't remind me again" — the flag persists cross-workspace in `vscode.globalState`. README updated with a table of recommended ≤3 GB models (`gemma3:4b`, `qwen2.5-coder:7b`, `llama3.2:3b`).
- **Real LLM usage propagation** (DG-085 A) — the `LlmClient` contract now has an optional `completeWithUsage(req): Promise<LlmCompletionResult>` method that returns `{ text, usage: TokenUsage | null }`. The three real adapters (Anthropic / OpenAI-compat / Ollama) extract `usage` from the provider response (`usage.input_tokens` + `usage.output_tokens` for Anthropic; `choices.usage.prompt_tokens` + `completion_tokens` for OpenAI-compat; `prompt_eval_count` + `eval_count` for Ollama native). `TokenTrackingLlmClient` prefers provider-reported counts when available and falls back to the `chars/4` proxy only when the provider doesn't expose usage. The CLI `triage` summary now shows `(provider-reported)` instead of `~estimated` when all calls reported real usage. **Backward-compat**: existing fake `LlmClient`s in tests (which only implement `complete`) keep working unchanged.
- **`QuotaExhaustedError` typed + benchmark provider skip + "Providers throttled this run" report section** (DG-088 A) — exported class in the `LlmClient` contract with `providerLabel` / `httpStatus` / `retryAfterSeconds` fields. The three adapters wrap HTTP 429 / rate-limit / quota-exhausted responses in this typed error (with permissive regex detection covering provider variations). The benchmark runner tracks consecutive quota errors; after 2 in a row, it sets `quotaExhausted = true` on the `ProviderResult` and skips the remaining runs for that provider. The report now distinguishes "quota exhausted (operational)" from "model broken" via a `⚠️ throttled` badge in the summary table and a dedicated `## Providers throttled this run` section.

### Changed

- **`gpt-5*` `max_completion_tokens` default 1024 → 8192** (DG-086 A) — only for the `gpt-5*` family. Empirical: in the `DG-077` 3rd benchmark run cloud-only, `gpt-5-nano` returned `content=null` 100% of the time because its internal reasoning tokens consumed the full `max_completion_tokens` budget at 1024 before emitting visible text. 8192 is the empirical-defensive sweet spot (4096 leaves too little margin; 16384 over-allocates). Non-`gpt-5*` models (`gpt-4o`, Llama, Mistral, DeepSeek, etc.) keep the cross-provider 1024 default. Caller overrides via `request.maxTokens` are always respected. **Cost implication**: the cap does NOT multiply the real cost — the provider charges for tokens _generated_, not for the cap configured. The cap only widens the worst case.
- **Benchmark synthetic findings now use anonymized paths** (DG-084 A) — `buildSyntheticFinding` no longer leaks the fixture path to the LLM. New helper `anonymizeFixturePath` strips the `packages/scouts/tests/.../fixtures/vulnerable/` prefix and renders the path as `src/<lang>/<file>` (or `src/<file>` when the parent isn't a language). Empirical: the `--verbose` probe in DG-077 revealed that Anthropic Haiku was meta-reasoning over `tests/.../fixtures/vulnerable/` and classifying as `inconclusive` instead of `true_positive` — root cause of the 1.3% Triage PASS persistently observed for Anthropic. The fix removes the meta-signal; empirical validation of the PASS rate improvement is deferred until the next real benchmark run.

### Known Issues

The Known Issues section is now **1 caveat** (down from 6 in v0.3.0):

1. **Ground truth dataset is AI-drafted** (DG-075 caveat heredado). The 26 entries in `tests/benchmark/ground-truth.json` are `reviewedBy: 'ai-draft'`. The schema supports `'human-confirmed' | 'human-corrected'` for entries that pass through an AppSec engineer review, but no entry has gone through review at this point. The benchmark report still ships with an explicit "internal-comparative only, do NOT cite externally" disclaimer for any session where all entries are `ai-draft`.

The other five caveats from v0.3.0 are **resolved** in this release: path leak (DG-084 A), tokens-as-proxy (DG-085 A), `gpt-5*` reasoning tokens (DG-086 A), Ollama RAM (DG-087 A), free-tier quotas (DG-088 A).

### Notes

- The verify gate is now **cumulative with 2 release-blocker prevention steps**: `scripts/verify-extension-activate.mjs` (DG-081 B, catches the `activate()` runtime class that produced DG-079.1 / DG-079.2) + `scripts/verify-manifest.mjs` (DG-083 A, catches the manifest-validity class that produced DG-082.1). The verify gate is **CUMULATIVE not PREVENTIVE complete** — each new class of release-blocker discovered by real human action adds a step; the gate doesn't and can't anticipate all classes.
- 502 unit tests pass + both verify gates pass + `vsce package` produces a valid `.vsix`. The remaining empirical validation (the real benchmark against providers with the user's API keys + the actual Marketplace upload) is deferred to the user side — same pattern as DG-080 B / DG-082 A.

## [0.3.3] - 2026-05-24

**Marketplace publish hotfix**: the v0.3.2 `.vsix` rejected by the Visual Studio Marketplace upload with `Publisher ID 'GoLab' provided in the extension manifest should match the publisher ID 'RealGoLab' under which you are trying to publish this extension.` Root cause: the publisher field in `package.json` was set to `"GoLab"` (a follow-up cosmetic change after `DG-065`), but the actual Azure DevOps publisher under the user's account is `RealGoLab` (URL: `marketplace.visualstudio.com/manage/publishers/realgolab`). v0.3.3 corrects the mismatch — no code or feature changes.

### Fixed

- **`packages/vscode-extension/package.json` `"publisher"`** changed from `"GoLab"` (never published anywhere; mismatch with the actual Marketplace publisher) to `"RealGoLab"` (the correct ID under the user's `golab.develop@gmail.com` Azure DevOps account, aligned with the sibling `RealGoLab.synaptic-vscode-extension` already published).
- **Extension marketplace identifier changes**: from `GoLab.synaptic-sentinel` (in v0.3.0 / v0.3.1 / v0.3.2 `.vsix` files — none of which were ever accepted by the Marketplace) to **`RealGoLab.synaptic-sentinel`** (v0.3.3+). The CLI to install from Marketplace is now `code --install-extension RealGoLab.synaptic-sentinel`.

### Notes

- v0.3.0, v0.3.1, and v0.3.2 `.vsix` files are all **GitHub-only release artifacts** that were installable locally via `code --install-extension <file.vsix>` (with the broken `GoLab.synaptic-sentinel` identifier in the metadata) but **never accepted by the Visual Studio Marketplace**. v0.3.3 is the **first version intended for Marketplace publication**.
- If you installed v0.3.2 (or earlier) locally via the `.vsix` from GitHub Release: that's `GoLab.synaptic-sentinel` in your VSCode. To upgrade to v0.3.3 from the Marketplace, you need to **uninstall the old identifier first** (`code --uninstall-extension GoLab.synaptic-sentinel`) and then install from Marketplace (`code --install-extension RealGoLab.synaptic-sentinel`). The IDs are different so VSCode does NOT auto-upgrade between them.
- Anti-optimismo lesson: the headless extension-host simulator added in `DG-081 B` validates `activate()` runtime but does NOT validate the manifest against the actual Marketplace publisher. The publisher mismatch was caught only when the user attempted the real upload. Future cycle: extend `scripts/verify-extension-activate.mjs` (or split into a separate `verify-manifest.mjs`) to assert the manifest's `publisher` matches a value documented somewhere reproducible.

## [0.3.2] - 2026-05-24

**Second hotfix**: v0.3.1 was insufficient. The bundle externals fix from `DG-079.1` reduced the bundle size and the inlined SDK refs from 178 → 2, but **`activate()` was still throwing silently** because of a different root cause inside `@synaptic-sentinel/core`: `colony-db.ts` used `createRequire(import.meta.url)` (an ESM pattern), which esbuild leaves as `createRequire(undefined)` when bundling to CJS — and `createRequire(undefined)` throws `TypeError: The argument 'filename' must be a file URL object, file URL string, or absolute path string. Received undefined`. The exception killed `activate()` at module-load time, before any command could register.

### Fixed

- **`packages/core/src/colony/colony-db.ts`** is now bundle-safe. New helper `bundleSafeModuleUrl()` tries `import.meta.url` first (ESM context), and falls back to reading `__filename` from the CJS module wrapper via `eval` when running inside a CJS bundle. Both `createRequire(...)` and `new URL('./schema.sql', ...)` now use this helper instead of `import.meta.url` directly. The headless test (`node -e "...mock vscode... require('dist/extension.cjs')"`) used to find this regression now reports `SUCCESS — activate completed`.

### Notes

- v0.3.0 and v0.3.1 are **both superseded by v0.3.2**. The v0.3.0 release had the externals bug (`DG-079.1`). The v0.3.1 release fixed that but had this second bug surfaced at runtime. v0.3.2 fixes both classes. Users should download v0.3.2.
- Anti-optimismo lesson: this is the second consecutive cycle where the verify gate (format + lint + build + 463 unit tests) and `vsce package` validation green-lit a `.vsix` that **cannot activate inside VSCode**. The fix this time was found by writing a **headless extension-host simulator** (mock `vscode` module + `require(dist/extension.cjs)` + invoke `activate()`) — a one-line diagnostic that reproduced the user's bug in seconds. This pattern is what a `vscode-test` integration would automate, and is now the highest-priority sub-DG for the next cycle.

## [0.3.1] - 2026-05-24

**Hotfix**: the v0.3.0 `.vsix` installed but **no extension command was reachable** (`Command 'synaptic-sentinel.installScanners' not found`). Root cause discovered during local validation of v0.3.0 (DG-079.1).

### Fixed

- **Bundle externals**: the extension bundle script in `package.json` only marked `vscode` as `--external`. The new dependency on `@synaptic-sentinel/agents` (added in DG-073 B / DG-074 B for the multi-provider Settings panel) transitively pulled `@anthropic-ai/sdk`, `openai` and `node-sqlite3-wasm` into the extension bundle. esbuild **inlined** those SDKs into `dist/extension.cjs`, but they contain dynamic `require()` patterns that throw when the VSCode extension host evaluates them. The exception killed `activate()` silently **before** any `vscode.commands.registerCommand(...)` ran — so the extension appeared "installed" but every command returned `Command not found`. The fix adds `--external:@anthropic-ai/sdk --external:openai --external:node-sqlite3-wasm` to the extension bundle script (same externals the CLI bundle already had); these packages are resolved at runtime from `dist/node_modules/` (already shipped in the `.vsix`).

### Notes

- v0.3.0 is **superseded by v0.3.1**. Anyone who downloaded the v0.3.0 `.vsix` from GitHub Release should upgrade.
- All v0.3.0 features (multi-provider Brain Layer, Settings panel, cost visibility, benchmark plumbing, the 6 Known Issues) are unchanged in v0.3.1 — this release is bundle-only.
- Anti-optimismo lesson: the `pnpm verify` gate (format + lint + build + unit tests) and `vsce package` validation are necessary but not sufficient for VSCode extensions. The extension activation in a real VSCode host is the only test that catches this class of bundling bug. Future cycles may add a `vscode-test` integration step to the verify gate.

## [0.3.0] - 2026-05-24

**Phase 11 closes: SYNAPTIC Sentinel is now provider-agnostic by design.** The Brain Layer no longer assumes Anthropic — every agent (Triage / Context / Remediation) can run against any of 14+ providers via a config file, a CLI flag, or the new in-IDE Settings panel. BYOK any provider you trust, switch between them per-agent, and see exactly how much each session costs.

### Added — Multi-provider Brain Layer

- **Three LLM adapters covering 14+ providers**: `AnthropicLlmClient` (native, with prompt caching/extended thinking preserved), `OpenAiCompatibleLlmClient` (generic adapter for OpenAI / Groq / DeepSeek / Mistral / Together / Fireworks / Perplexity / xAI / Gemini / Bedrock / Azure / LM Studio / vLLM), and `OllamaLlmClient` (Ollama-native `/api/chat` with XGrammar opt-in for `~99%` JSON validity on local models).
- **`.sentinel/agents.yaml`** — versionable per-agent config. Triage can run on DeepSeek v4-flash (cheap), Context on Anthropic Haiku (quality), Remediation on Ollama locally. Mix-and-match by cost / quality / privacy.
- **`SYNAPTIC Sentinel: Configure Brain Layer Providers`** — new in-IDE Settings panel with three sections: Active Configuration (which provider runs each agent), Managed Credentials (Save/Delete/Test for 12 providers, keys never cross to the webview in plain text), and Local Models with Ollama auto-discovery.
- **CLI flag `--agent-provider <agent>=<provider>/<model>`** — repeatable override for the `triage` command.
- **`vscode.SecretStorage` namespaced per provider** — `sentinel.anthropic.apiKey` / `sentinel.openai.apiKey` / ... with automatic migration from the legacy `synaptic-sentinel.anthropicApiKey` slot.

### Added — Cost visibility

- **Summary block at the end of every `triage` session** — tokens consumed + estimated USD + average latency, grouped by `(provider/model, agent)`. The 25x cost difference between Anthropic Haiku and DeepSeek v4-flash on your own findings becomes visible.
- **New sub-command `synaptic-sentinel cost-history [--limit N]`** — rollup of the last N triage sessions across provider+agent, total tokens, total estimated USD.
- **New `colony.db` table `triage_token_usage`** (schema v5, additive) persists every LLM call with `triage_session_id` + provider label + agent id + token counts + estimated USD + latency.

### Added — Cross-provider benchmark plumbing

- **`pnpm benchmark:run` CLI script** — runs the three Brain Layer agents against a ground truth dataset of 26 entries covering 13 deliberately-vulnerable fixtures (SAST / Secrets / IaC / Vibe-Coded), measures JSON validity, classification accuracy, latency, tokens (proxy), estimated USD and cross-run determinism.
- **Verbose / filter flags** — `--verbose` (one log line per LLM call with 200-char raw sample), `--entries <ruleIds>` (filter ground truth), `--providers <names>` (filter providers). Useful for manual single-call probes when debugging prompt failures.
- **AI-draft ground truth dataset** at `tests/benchmark/ground-truth.json`. Keywords support synonym arrays (`["code injection", "RCE", "remote code execution", "arbitrary code"]`) so the scorer matches what real LLMs actually say. **Caveat**: all 26 entries are `reviewedBy: "ai-draft"` — not authoritative for external claims until human-AppSec review.

### Changed

- **OpenAI-compatible adapter quirks for gpt-5\* family**: switches automatically to `max_completion_tokens` and omits `temperature` (gpt-5\* only accepts default=1). Sends `response_format: { type: "json_object" }` to every OpenAI-compat backend — dramatically improves Gemini JSON adherence without harming other providers.
- **DeepSeek default model `v3.2` → `v4-flash`** in the benchmark runner (`v3.2` is now deprecated by DeepSeek).
- **Pricing table** moved from `tests/benchmark/pricing.json` (deleted) to `packages/core/src/config/pricing.ts` as a TypeScript const — single source of truth between the benchmark and the cost visibility summary. Includes 16 cloud models and 3 local providers ($0).
- **Backward compatibility preserved**: users with only `ANTHROPIC_API_KEY` set continue to work identically (implicit fallback to Anthropic Haiku 4.5 for all three agents — the v0.2.0 behavior).

### Known Issues

The first real benchmark runs against five cloud providers + Ollama exposed several limitations. These are documented in `tests/benchmark/README.md` and tracked as sub-DGs for future cycles:

1. **Synthetic finding paths leak the fixture origin** — `buildSyntheticFinding` uses real paths like `tests/.../fixtures/vulnerable/eval.js`. LLMs read the path, notice the word "vulnerable" + "fixtures", and meta-reason "this looks like a test fixture, probably intentional" → classify as `inconclusive` instead of `true_positive`. The cost visibility and ranking by quality work; the Triage PASS rates in the benchmark report are an artifact of this path leak. Real user code is unaffected — only the synthetic benchmark.
2. **OpenAI gpt-5\* reasoning-token budget** — `max_completion_tokens=1024` is too small for gpt-5-nano's internal reasoning + visible JSON output; the model returns empty content. Raise the cap or wait for a future cycle that does so per-model.
3. **Local LLM batching can saturate RAM** — Gemma 4 (9.6 GB) and gpt-oss:20b (13 GB) on consumer hardware freeze after long sequential inference batches. Use models ≤3 GB (e.g. `gemma3:4b`, `qwen2.5:3b`, `llama3.2:3b`) for benchmark batches; for normal `triage` sessions on a handful of findings the larger models are fine.
4. **Free-tier quotas** — Groq's TPD limit (100K tokens/day) and Gemini's RPM limit get exhausted after one full benchmark + one recalibration run on the free tier. Not a code issue; for production benchmark runs use the paid tier or wait 24h.
5. **Tokens are proxies (`chars/4`)** — the contract `LlmClient.complete()` returns only text; the cost visibility summary estimates tokens with `Math.ceil(text.length / 4)` (±15-20% vs the provider's billed `usage`). Cost numbers are marked `~estimated` everywhere they appear.
6. **Ground truth is AI-draft** — all 26 entries were written by Claude based on reading the fixtures + the OpenGrep ruleset. Not authoritative for external claims. The benchmark report carries a strong disclaimer.

### Notes

- This release wraps **Phase 11 — Multi-Provider Brain Layer** (cycles 63 → 72, ten sub-increments DG-070 → DG-079). The product is now provider-agnostic at the architecture level, with three adapters, a config registry, an in-IDE Settings panel, an empirical benchmark and cost visibility, all shipped under Apache-2.0.
- BYOK any provider you trust. Keys never leave the user's machine — direct provider calls, no Synaptic backend.
- The marketplace listing `RealGoLab.synaptic-sentinel` is updated by Phase 12 (`vsce publish`); meanwhile, the `.vsix` is downloadable as a GitHub Release asset. (Note: the v0.3.0 / v0.3.1 / v0.3.2 `.vsix` files actually shipped with the placeholder `GoLab.synaptic-sentinel` identifier — fixed in v0.3.3, see that entry.)

## [0.2.0] - 2026-05-23

Strategic pivot: SYNAPTIC Sentinel is repositioned as **"the vibe-coding security sentinel"** and all capabilities are unified under a single open-source license. No more dual OSS / premium tiering.

### Changed

- **All packages are now Apache-2.0**, including `packages/agents` (the three LLM Brain Layer agents). The previous "Pro" framing is dropped: there is no premium tier, no proprietary gating, no separate commercial license. Source code is fully redistributable.
- **Positioning sharpened around vibe-coding security:** the README, the marketplace pitch, and the onboarding now lead with the vibe-coding lens — Vibe-Detect scout, taint analysis tuned for AI-assisted code, LLM-driven triage of AI-generated anti-patterns.

### Removed

- `LICENSE-PRO` (placeholder commercial EULA that was never finalized).
- `[PRO]` marker from `packages/agents/src/index.ts` JSDoc header.
- Mentions of "Brain Layer is proprietary" / "premium tier" / "Pro components" from public-facing documentation.

### Notes

- No code or feature changes in this release — every capability shipped in `v0.1.0` is preserved exactly. The change is **legal and editorial**: the same product, with the legal substrate aligned and the discourse honest about what the user gets.
- BYOK Anthropic remains the model: your API key goes directly to the model provider; there is no Synaptic backend.
- The Brain Layer's three agents (Triage / Context / Remediation) are unchanged and continue to run inside the `.vsix` bundle.

## [0.1.0] - 2026-05-22

First marketplace-ready release. SYNAPTIC Sentinel is the security companion of the SYNAPTIC family (sibling of SYNAPTIC Expert), focused on shipping AI-assisted code with traceable audits: deterministic scanners catch the syntactic problems, a Brain Layer (BYOK Anthropic) decides what really matters and how to fix it, and everything happens in the IDE — and over CI, via SARIF.

### Added

- **Five scouts running in parallel** — each best-in-class for its category, vendored binaries downloaded on-demand from official GitHub Releases with SHA-256 verification.
  - **OpenGrep** (SAST) with 17 curated rules: 11 pattern-based + 6 taint (CWE-22/78/79/89/95/327/502) covering JS/TS and Python; taint mode follows `request.*`/`req.*`/`sys.argv`/`os.environ` to dangerous sinks (`exec`, `innerHTML`, `cursor.execute`, `open`, …) with sanitizers known (`DOMPurify`, `escapeHtml`, `secure_filename`, `os.path.basename`).
  - **Gitleaks** (Secrets) — credentials/keys/tokens, redacted in output.
  - **Trivy** (SCA) — vulnerable dependencies.
  - **Checkov** (IaC) — Dockerfile / Terraform / k8s misconfigurations, runs as a standalone binary (no Python toolchain needed on the client).
  - **Vibe-Detect** (native TypeScript, no binary) — six heuristic detectors for AI-generated code anti-patterns.
- **Brain Layer (BYOK Anthropic):** three LLM agents wired into the scan flow — **Triage** (true / false positive / inconclusive + confidence + rationale), **Context** (entry point → propagation → sink → exposure), **Remediation** (proposed fix + code snippet).
- **Memory of the swarm:** a learning store (`learning_records` in `colony.db`) pre-classifies known patterns on subsequent scans without spending an LLM token (evidence threshold of 3, no self-feeding loop).
- **Living tome side panel:** findings grouped by severity, clickable to jump straight to the code.
- **Inline UX:** diagnostics in the editor, hover with the full Brain Layer detail, Code Actions for "mark false positive" and "copy suggested remediation".
- **Pseudoterminal:** the scan/triage CLI output streams to a native VSCode pseudoterminal — verbose feedback in real time.
- **Turnkey "Install Scanners" command:** downloads and verifies the five scout binaries to a per-user cache (`~/.synaptic-sentinel/scanners`) — one-time setup from the Command Palette, no shell required.
- **CI-native exports:** the CLI bundle (also runnable standalone) exports the tome to JSON, HTML (an audit report), and SARIF 2.1.0 (GitHub Code Scanning, Azure DevOps). `--fail-on <severity>` turns the scan into a CI gate (exit code 2).

### Architecture

- TypeScript strict monorepo (pnpm workspaces, 7 packages: shared, core, scouts, cli, reporters, vscode-extension, agents).
- **spawn-CLI architecture:** the extension stays a thin UX layer; the security pipeline runs in a child Node process via the bundled CLI (`process.execPath`, so the `.vsix` does not assume `node` in the user's PATH).
- **SQLite driver: `node-sqlite3-wasm` (WebAssembly, no native binary)** — the `.vsix` is ABI-independent; runs in any VS Code extension host without rebuild ceremony.
- **LLM client:** official `@anthropic-ai/sdk` behind a thin `LlmClient` contract — retries, rate-limiting and streaming handled by the SDK; agents stay testable with injected fakes.
- **Memory of the swarm:** `colony.db` (SQLite, schema v4) with five aditive tables — `scans`, `pheromones`, `triage_verdicts`, `context_explanations`, `remediation_suggestions`, `learning_records`.

### Privacy

- The deterministic scans run **entirely on the local machine**. The five scout binaries are downloaded from their official GitHub Releases, SHA-256 verified, and cached per-user.
- The Brain Layer (optional, BYOK) sends each finding's context **directly** to Anthropic. No proxy, no middleman. The API key is stored in `vscode.SecretStorage`, encrypted by the OS.
- The audit memory lives in your repo at `.synaptic-sentinel/colony.db`. You decide whether to commit it.

### Known constraints

- The Brain Layer requires an Anthropic API key (BYOK). Other providers are not supported in this release.
- The five scout binaries are downloaded over HTTPS from GitHub Releases. If your environment intercepts TLS (corporate proxy / antivirus), set `NODE_OPTIONS=--use-system-ca` in the integrated terminal before running "Install Scanners".

### Licenses

- The extension UI, the CLI, the Scout Layer, the deterministic pipeline, and the three Brain Layer agents (`packages/agents`) are all licensed under **Apache-2.0** as of v0.2.0 (see strategic pivot above). In v0.1.0 the Brain Layer was framed as a proprietary tier; that framing was retired in DG-066 B (2026-05-23).
