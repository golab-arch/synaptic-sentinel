# SYNAPTIC Sentinel

**The vibe-coding security sentinel. Apache-2.0. Five deterministic scouts scan your repo; a multi-provider Brain Layer decides what really matters and how to fix it — all in the IDE, with cost visibility per session.**

SYNAPTIC Sentinel is the security companion of the SYNAPTIC family (sibling of [SYNAPTIC Expert](https://marketplace.visualstudio.com/items?itemName=GoLab.synaptic-expert)). Where Expert helps you _write_ AI-assisted code with traceability, Sentinel audits _what gets written_ — your own code, your AI's code, your dependencies, your config — and explains why it matters. **All capabilities are open under Apache-2.0; there is no premium tier, no proprietary gating, and the Brain Layer runs against any LLM provider you choose.**

Built for three kinds of users:

- **Developers** shipping AI-assisted code who want to catch the classic mistakes (eval-of-user-input, SQL injection by concatenation, secrets in commits, vulnerable deps) before the PR.
- **Tech leads** who want SARIF in CI as a quality gate, a "living tome" of audited findings to ship as evidence, and **per-session cost visibility** to pick the cheapest LLM that still gives quality triage.
- **AppSec engineers** who want taint analysis + secrets + SCA + IaC + AI-anti-patterns in one place, with a Brain Layer that explains exploitability instead of just listing CVEs.

---

## What it does

### Five scouts, deterministic and parallel

The Scout Layer runs five auditors in parallel, each best-in-class for its category. Binaries are downloaded on-demand from their official GitHub releases with SHA-256 verification — no Docker, no Python toolchain on the client.

| Scout           | Category  | Source                                                          | What it catches                                                                                                                                                                                                                                                                                |
| --------------- | --------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenGrep**    | SAST      | [opengrep/opengrep](https://github.com/opengrep/opengrep)       | 17 curated rules (11 pattern-based + 6 taint) covering CWE-22 (path traversal), CWE-78 (command injection), CWE-79 (XSS), CWE-89 (SQL injection), CWE-95 (eval-family), CWE-327 (weak crypto), CWE-502 (deserialization). Taint mode follows `request.*` → dangerous sink in JS/TS and Python. |
| **Gitleaks**    | Secrets   | [gitleaks/gitleaks](https://github.com/gitleaks/gitleaks)       | Credentials, API keys, tokens checked in by accident — redacted in the output by default.                                                                                                                                                                                                      |
| **Trivy**       | SCA       | [aquasecurity/trivy](https://github.com/aquasecurity/trivy)     | Vulnerable dependencies (CVE database), severity-mapped, with fixed-in info.                                                                                                                                                                                                                   |
| **Checkov**     | IaC       | [bridgecrewio/checkov](https://github.com/bridgecrewio/checkov) | Misconfigurations in Dockerfiles, Terraform, Kubernetes manifests.                                                                                                                                                                                                                             |
| **Vibe-Detect** | VibeCoded | (native, no binary)                                             | Anti-patterns specific to AI-generated code — 6 heuristic detectors, runs offline.                                                                                                                                                                                                             |

### Multi-provider Brain Layer (BYOK any provider)

Three LLM agents wired into the scan flow:

- **Triage Agent** — for each finding, decides _true positive_ / _false positive_ / _inconclusive_ with a confidence score and a one-sentence rationale.
- **Context Agent** — for confirmed true positives, explains the exploitability chain: `entry point → propagation → sink → exposure`.
- **Remediation Agent** — proposes a concrete fix, with a code snippet you can copy.

**Pick a different provider per agent.** Run Triage on DeepSeek v4-flash (cheap), Context on Anthropic Haiku (quality), Remediation on Ollama locally (free / private). Or use one provider for everything. Mix-and-match by cost / quality / privacy.

| Provider                                              | Models supported                             | Notes                                                                                        |
| ----------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Anthropic** (native adapter)                        | Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.7     | Prompt caching + extended thinking preserved. Default if `ANTHROPIC_API_KEY` is set.         |
| **OpenAI**                                            | gpt-5-nano / gpt-5-mini / gpt-5              | gpt-5\* has reasoning-token quirks — see Known Limitations.                                  |
| **DeepSeek**                                          | v4-flash / v4-pro / R1                       | v4-flash is the empirical cost/performance winner of our cross-provider benchmark.           |
| **Groq**                                              | Llama 3.3 70B / Llama 4 Scout 17B            | Speed king (sub-second latency typical). Free tier has a 100K-token/day cap.                 |
| **Gemini**                                            | gemini-2.5-flash / gemini-2.5-pro            | Via Google's OpenAI-compat layer.                                                            |
| **Mistral / Together / Fireworks / Perplexity / xAI** | All OpenAI-compatible chat-completion models | Just set the API key — the generic adapter handles the rest.                                 |
| **AWS Bedrock / Azure OpenAI**                        | Any chat-completion model                    | Requires explicit `baseUrl` in `agents.yaml` (region/instance varies).                       |
| **Ollama** (local) + **LM Studio** + **vLLM**         | Whatever you have pulled locally             | Ollama native API with XGrammar opt-in for ~99% JSON validity. Free. Private. Caveats below. |

### Cost visibility — see what each session actually costs you

At the end of every triage session you get a summary block:

```text
Cost summary (~estimated — tokens are chars/4 proxy, ±15-20% vs provider usage):
  provider/model                           agent              calls      input     output   cost USD  latency
  anthropic/claude-haiku-4-5-20251001      triage         3 calls      450 in     180 out    $0.0014      1842ms avg
  anthropic/claude-haiku-4-5-20251001      context        2 calls      890 in     420 out    $0.0030      2104ms avg
  anthropic/claude-haiku-4-5-20251001      remediation    2 calls      870 in     510 out    $0.0034      2851ms avg
  Total: 2210 input tokens · 1110 output tokens · $0.0078 (~estimated USD)
```

The `synaptic-sentinel cost-history [--limit N]` sub-command shows a rollup across the last N sessions, grouped by provider+agent — useful to compare empirically (on _your_ findings, not synthetic benchmarks) which provider gives you the best cost/quality trade-off.

Token counts are proxies (`Math.ceil(text.length / 4)`) — ±15-20% vs the provider's billed usage. Surfaced as `~estimated` everywhere.

### Configuring providers (three equivalent paths)

**A. From the IDE** — Command Palette → **`SYNAPTIC Sentinel: Configure Brain Layer Providers`** opens a Settings panel:

- **Active Configuration** — pick a provider + model for each agent (Triage / Context / Remediation) from a dropdown, then click **Apply**. The dropdown only lists providers whose API key is configured (plus Ollama if its daemon is reachable). Clicking Apply writes `.sentinel/agents.yaml` in your workspace — same file format the CLI reads (path B below).
- **Managed Credentials** — Save / Delete / Test API keys for 12 providers. Keys never cross to the webview in plain text (state is `configured: boolean`, real value lives in `vscode.SecretStorage`).
- **Local Models** — auto-discovers your Ollama daemon at `localhost:11434` and lists models you've pulled. Models above 5 GB get a `⚠ heavy` badge and the panel shows a one-time warning about RAM saturation (with a "Don't remind me again" toggle that persists cross-workspace).

**B. From `.sentinel/agents.yaml`** in your project root (versionable):

```yaml
agents:
  triage:
    provider: deepseek
    model: deepseek-v4-flash
  context:
    provider: anthropic
    model: claude-haiku-4-5-20251001
  remediation:
    provider: ollama
    model: gemma3:4b
```

**C. From the CLI** — repeatable `--agent-provider <agent>=<provider>/<model>` flag:

```sh
synaptic-sentinel triage \
  --agent-provider triage=deepseek/deepseek-v4-flash \
  --agent-provider context=anthropic/claude-haiku-4-5-20251001 \
  --agent-provider remediation=ollama/gemma3:4b
```

API keys come from `SENTINEL_<PROVIDER>_API_KEY` environment variables (`SENTINEL_ANTHROPIC_API_KEY`, `SENTINEL_OPENAI_API_KEY`, `SENTINEL_DEEPSEEK_API_KEY`, etc). The legacy `ANTHROPIC_API_KEY` is also accepted for backward compatibility with `v0.2.0`. **Keys never appear in command-line arguments; they always travel via environment variables or `vscode.SecretStorage`.**

**Backward-compatible**: users on `v0.2.0` with only `ANTHROPIC_API_KEY` set continue to work identically — Anthropic Haiku 4.5 runs all three agents (the implicit fallback).

### Memory of the swarm

The three agents share a learning store on disk in your repo (`.sentinel/colony.db` — same `.sentinel/` directory that holds `agents.yaml`): a triage pattern seen with strong evidence is pre-classified on the next scan **without spending an LLM token**. _Backward-compat:_ if your repo still has the legacy `.synaptic-sentinel/colony.db` from v0.3.5 or earlier, the CLI keeps reading it and emits a log suggesting you move it; no automatic migration to avoid data loss.

### Trust cross-session (new in v0.3.22 — FASE III)

Cross-provider triage is inherently noisy: the same finding can come back TP one day and INC the next after you swap providers. Instead of hiding this variance, Sentinel makes it **visible**:

- **Previously (N prior verdicts)** — a collapsible section under every finding card in the sidebar showing the full triage history for that fingerprint (timestamp + `providerLabel` + full rationale). The verdict trajectory across every scan you've ever run is one click away.
- **⚠ Verdict changed since last scan** banner — when the current verdict differs from the previous, the sidebar shows a warning banner with a reason heuristic: `Different provider (X → Y) — cross-provider agreement is not guaranteed.` / `Verdict reclassified — likely new context signals available.` / `Confidence changed significantly (Δ 0.XX).`
- **Scan diff line** — both the terminal and the sidebar summary card show `Scan diff vs previous triage: N new · M re-classified (X class, Y confidence, Z provider) · K unchanged` with reason breakdown. The empirical validation of FASE III collected a dramatic reproducibility case (`fast-xml-parser CVE-2026-41650` oscillated between 0.0 and 1.0 confidence across 5 scans with 2 providers) — now nothing about that shift is hidden from the user.
- **Cross-finding correlation (grouping)** — when N ≥ 2 findings share the same rule + package + version, only the group representative pays the LLM token cost; members inherit the verdict with a 0.9× confidence downgrade (epistemic honesty: high confidence on the group, medium on each member individually). The sidebar shows `GROUPED REP` (purple) on the representative and `GROUPED` (lighter purple) on members, plus a `[group SCA:pkg@ver:CVE, member N of M]` rationale suffix. Empirically saved 12 LLM calls in a single re-triage of SYNAPTIC_SAAS (44 findings → 8 calls + 24 colony-memory + 12 propagated).
- **`--no-group` CLI flag** — global escape hatch if you want per-finding autonomy over the cost savings.

### Turnkey from install to first scan

1. Install the extension.
2. **Command Palette → "SYNAPTIC Sentinel: Install Scanners"** — downloads and verifies the five scout binaries to a per-user cache (`~/.synaptic-sentinel/scanners`). Once.
3. **Command Palette → "SYNAPTIC Sentinel: Scan Workspace"** — findings appear as inline diagnostics, in the _Problems_ panel, and in the **living tome** side view.
4. _(Optional, BYOK)_ **Configure Brain Layer Providers** → **Triage Findings (Brain Layer)** to enrich findings with classification + context + remediation.

---

## Commands

| Command                                              | What                                                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `SYNAPTIC Sentinel: Scan Workspace`                  | Runs the five scouts and paints findings as diagnostics.                                                             |
| `SYNAPTIC Sentinel: Triage Findings (Brain Layer)`   | Runs the three Brain Layer agents over the last scan. Requires BYOK.                                                 |
| `SYNAPTIC Sentinel: Configure Brain Layer Providers` | Opens the multi-provider Settings panel.                                                                             |
| `SYNAPTIC Sentinel: Install Scanners`                | One-time download of the scout binaries to the per-user cache.                                                       |
| `SYNAPTIC Sentinel: Re-triage all`                   | Clears existing verdicts + re-runs the Brain Layer on the last scan (useful after a provider swap in `agents.yaml`). |

Plus Code Actions on each finding: **mark as false positive** (suppressed in future scans), and **copy suggested remediation**.

---

## CI-native

Sentinel's CLI bundle ships with the extension and is also runnable standalone. The CLI exports the audit tome to **JSON**, **HTML** (an audit report you can hand to a reviewer), and **SARIF 2.1.0** (GitHub Code Scanning, Azure DevOps). The `--fail-on <severity>` flag turns the scan into a CI gate (exit code 2 if there are findings at or above the threshold).

**Diff-aware CI (new in v0.3.22 — DG-132 A)**:

- `synaptic-sentinel diff --json [--path <dir>] [--confidence-delta-threshold <n>]` — structured JSON output comparing the latest triage against the previous one. Shape: `{ scanId, summary, reclassifiedByReason, newFindings[], reclassified[], unchanged[] }`. Feed to a dashboard, gate a PR, alert on drift. Read-only — no re-triage, no LLM tokens.
- `synaptic-sentinel triage --fail-on-new-tp-critical <n> --fail-on-new-tp-high <n> --fail-on-new-tp-medium <n>` — per-severity CI gates on the triage step. Exit code 1 if the number of NEW true-positive findings (first-time triaged **or** reclassified to TP from a different classification) at that severity exceeds the threshold. Use `--fail-on-new-tp-critical 0 --fail-on-new-tp-high 3` for zero-tolerance critical + tolerate up to 3 high per PR.
- `synaptic-sentinel triage --no-group` — escape hatch: disables the cross-finding correlation grouping (R20) and forces one LLM call per finding. Trade cost for per-finding autonomy.

The `synaptic-sentinel cost-history` sub-command lets you wire cost reports into your CI summary too.

---

## Privacy and data flow

- **Your code never leaves your machine for the deterministic scans.** The five scouts run locally as child processes.
- **For the Brain Layer (optional)**, each finding's snippet goes directly to the LLM provider you chose — no proxy, no middleman, no Synaptic backend. BYOK. With Ollama / LM Studio / vLLM, the code never leaves your machine at all.
- **The audit memory (`colony.db`) lives in your repo's `.sentinel/` directory** (alongside `agents.yaml`). You decide whether to commit it. _Workspaces from v0.3.5 or earlier:_ if your repo has `.synaptic-sentinel/colony.db`, the CLI keeps reading the legacy path (dual-read, no auto-migration to avoid data loss).

---

## Known Limitations

Honest caveats from the first real cross-provider benchmark — none affect your real source code, but you should know them:

1. **OpenAI `gpt-5*` models need a higher `max_completion_tokens`**. Out-of-the-box `gpt-5-nano` exhausts its reasoning-token budget at 1024 tokens and returns empty content. Either raise the cap manually or pick a different OpenAI model for now.
2. **Local LLMs with >5 GB models can saturate RAM** on consumer hardware during long batch operations (`pnpm benchmark:run`). Normal `triage` on a handful of findings is fine. For benchmark batches, prefer the ≤3 GB tier — the **Configure Brain Layer Providers** panel now shows each Ollama model's size and a ⚠ badge for models above 5 GB (with a "Don't remind me again" option once you've made your peace with the trade-off). Recommended lightweight models: `gemma3:4b` (~3 GB), `qwen2.5-coder:7b` (~4.4 GB), `llama3.2:3b` (~2 GB).
3. **Free-tier quotas exhaust quickly** on Groq (100K tokens/day) and Gemini (RPM-limited). Fine for everyday triage on a few findings; use the paid tier for full benchmark runs.
4. **Token counts are proxies** (`chars/4`, ±15-20% vs the provider's billed usage). Cost USD is `~estimated` everywhere it appears.

See the [CHANGELOG](./CHANGELOG.md) `v0.3.0` Known Issues section for the full list with rationale.

---

## License

All packages — extension, Scout Layer, Brain Layer — are licensed under **Apache License 2.0**. Source code, including the three LLM agents, is open and redistributable.

---

_Part of the [SYNAPTIC](https://github.com/golab-arch) family — Apache-2.0 toolkit for engineers shipping AI-assisted code with traceability._
