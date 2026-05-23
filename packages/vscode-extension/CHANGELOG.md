# Changelog

All notable changes to the SYNAPTIC Sentinel extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - _Unreleased — to be cut in DG-069_

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
