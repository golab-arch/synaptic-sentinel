# SYNAPTIC Sentinel

> **The vibe-coding security sentinel.** An Apache-2.0 agentic security toolkit for projects where most of the code is written by AI. Five deterministic scouts catch the syntactic problems; a Brain Layer (BYOK Anthropic) decides what really matters and how to fix it — all inside the IDE.

**SYNAPTIC Sentinel** audits a project **inside the client's perimeter** — your code never leaves your machine — and produces inline findings for the developer plus an audit _tome_ (evidence package) for compliance and CI.

Third product in the SYNAPTIC family, sibling of [SYNAPTIC Expert](https://marketplace.visualstudio.com/items?itemName=GoLab.synaptic-expert).

## Status

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/RealGoLab.synaptic-sentinel?label=marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=RealGoLab.synaptic-sentinel)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/RealGoLab.synaptic-sentinel)](https://marketplace.visualstudio.com/items?itemName=RealGoLab.synaptic-sentinel)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

🚀 **Live on the Visual Studio Marketplace** — [`RealGoLab.synaptic-sentinel`](https://marketplace.visualstudio.com/items?itemName=RealGoLab.synaptic-sentinel) (v0.3.3, Apache-2.0).

🚧 **Active development (pre-1.0).** Operational: the Scout Layer (5 scanners), the Coordinator, the reporters (JSON/HTML/SARIF tome), the CLI, and the VSCode extension; the Brain Layer with 3 agents (Triage / Context / Remediation, BYOK multi-provider). **All packages under Apache-2.0** — no premium tier, no proprietary gating.

Install in VSCode:

```sh
code --install-extension RealGoLab.synaptic-sentinel
```

## How it works

- **Scout Layer (deterministic, parallel)** — five auditors that run as local processes and normalize their findings: **OpenGrep** (SAST, 17 curated rules with taint-flow), **Gitleaks** (secrets), **Trivy** (SCA), **Checkov** (IaC), and **Vibe-Detect** (anti-patterns specific to AI-generated code).
- **Coordinator** — orchestrates the scouts with a per-scout kill-switch, deduplicates findings, and persists them in `colony.db`.
- **Brain Layer (LLM, BYOK Anthropic)** — agents that triage, contextualize, and propose remediation for findings. Your Anthropic API key goes **directly** to the model; there is no Synaptic backend.
- **Memory of the swarm** — patterns the Brain Layer has classified with strong evidence are pre-resolved on subsequent scans without spending an LLM token.
- **Surfaces** — a CLI and a VSCode extension (primary surface).

## What makes it the vibe-coding security sentinel

- **Vibe-Detect scout** — a built-in scout dedicated to anti-patterns specific to AI-generated code: hallucinated APIs, plausible-looking but broken control flow, sycophantic comments, unbounded eval-of-user-input patterns. Native TypeScript, runs offline, no binary required.
- **Taint analysis tuned for AI-assisted code** — `request.*` / `req.*` / `sys.argv` / `os.environ` followed to dangerous sinks (`exec`, `innerHTML`, `cursor.execute`, `open`), with the sanitizers an LLM-coded project will _actually_ use (`DOMPurify`, `escapeHtml`, `secure_filename`, `os.path.basename`).
- **LLM-driven triage** — when a scout fires, the Brain Layer decides if the finding is a true positive in this codebase, not just a textbook pattern match. Three agents, three perspectives: **Triage** (true / false / inconclusive), **Context** (entry → propagation → sink → exposure), **Remediation** (concrete fix + code snippet).
- **CI-native** — SARIF 2.1.0 export for GitHub Code Scanning / Azure DevOps; `scan --fail-on <severity>` turns the scan into a CI gate (exit code 2 above threshold).

## Monorepo structure

| Package                     | License    | Description                                               |
| --------------------------- | ---------- | --------------------------------------------------------- |
| `packages/shared`           | Apache-2.0 | Common utilities                                          |
| `packages/core`             | Apache-2.0 | Coordinator, `colony.db`, types (zod)                     |
| `packages/scouts`           | Apache-2.0 | `ScoutAgent` contract + the 5 scouts                      |
| `packages/reporters`        | Apache-2.0 | Tome model + JSON/HTML/SARIF export                       |
| `packages/cli`              | Apache-2.0 | The `synaptic-sentinel` CLI                               |
| `packages/vscode-extension` | Apache-2.0 | VSCode extension (thin shell, spawn-CLI architecture)     |
| `packages/agents`           | Apache-2.0 | Brain Layer — LLM agents (Triage / Context / Remediation) |

## Requirements

- Node.js ≥ 20
- pnpm ≥ 10

## Quickstart

```bash
pnpm install              # install dependencies and link workspaces
pnpm scanners:install     # download the OSS scanner binaries
pnpm build                # build packages + bundle the extension
node packages/cli/dist/index.js scan --path /path/to/your/project
```

**Full installation and usage guide: [ONBOARDING.md](ONBOARDING.md).**

## Development

```bash
pnpm build       # tsc -b (project references) + extension bundle
pnpm test        # full Vitest suite (unit + integration)
pnpm test:unit   # unit tests only (fast)
pnpm lint        # ESLint (flat config + typescript-eslint)
pnpm typecheck   # type check
pnpm format      # Prettier
pnpm verify      # per-cycle gate: format:check + lint + build + test:unit
```

## Privacy and data flow

- **Your code never leaves your machine for the deterministic scans.** The 5 scouts run locally as child processes.
- **For the Brain Layer (optional), each finding's snippet goes directly to Anthropic** — no proxy, no middleman, no Synaptic backend. BYOK.
- **The audit memory (`colony.db`) lives in your repo's `.synaptic-sentinel/` directory.** You decide whether to commit it.

## Documentation

- [ONBOARDING.md](ONBOARDING.md) — installation, CLI and extension usage
- [docs/colony-db.md](docs/colony-db.md) — the pheromone database
- [.synaptic/DESIGN_DOC.md](.synaptic/DESIGN_DOC.md) — design and decisions log
- `context/Synaptic_Sentinel_v0.4.md` — master design document

## License

All packages are licensed under **Apache License 2.0** — see [LICENSE](LICENSE).

© 2026 GoLab SpA.
