# Changelog

All notable changes to the SYNAPTIC Sentinel extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- The marketplace listing `GoLab.synaptic-sentinel` is updated by Phase 12 (`vsce publish`); meanwhile, the `.vsix` is downloadable as a GitHub Release asset.

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
