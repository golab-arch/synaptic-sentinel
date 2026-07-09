# SYNAPTIC Sentinel — website copy for golab.cl

> Ready to paste into the GoLab website. Two options: (A) short landing card; (B) long-form product page. Both are honest — nothing here promises what the tool doesn't actually do, and the "known tradeoffs" are called out because the users we want to attract respect that.

---

## Option A — Short landing card (for the family showcase)

**SYNAPTIC Sentinel** · Apache-2.0 · VS Code

The vibe-coding security sentinel. Five deterministic scouts (OpenGrep, Gitleaks, Trivy, Checkov, Vibe-Detect) audit your code, your AI's code, your dependencies, and your config. A **multi-provider Brain Layer** (BYOK — Anthropic / OpenAI / DeepSeek / Groq / Ollama / any OpenAI-compatible) decides what really matters and how to fix it, with per-session cost visibility. **All capabilities open under Apache-2.0** — no premium tier, no gating.

**New in v0.3.22 (FASE III complete)**: verdict history persisted across scans, cross-provider drift made visible via a **⚠ Verdict changed since last scan** banner with reason heuristic (provider / class / confidence delta), grouping-based token cost reduction for SCA duplicates (12 LLM calls saved on a 44-finding re-triage in our own SYNAPTIC_SAAS workspace), and diff-aware CI/CD gates + JSON export for pipelines.

→ **Install**: [GitHub Release](https://github.com/golab-arch/synaptic-sentinel/releases/latest) · [Source](https://github.com/golab-arch/synaptic-sentinel)

---

## Option B — Long-form product page

### The problem SYNAPTIC Sentinel solves

Security scanners produce noise. LLM triage helps, but the same finding can come back TP one day and INC the next after you swap providers — and users lose trust. Existing tools hide that variance behind the latest verdict; Sentinel makes it **visible**.

### What Sentinel is

An open-source (Apache-2.0) VS Code extension that runs five deterministic scanners in parallel, then wires a **three-agent LLM Brain Layer** (triage, context, remediation) over the results. Everything runs in-IDE. Everything is BYOK — bring your own API key for any of Anthropic, OpenAI, DeepSeek, Groq, Gemini, Mistral, Together, Fireworks, Perplexity, xAI, AWS Bedrock, Azure OpenAI, or run Ollama / LM Studio / vLLM locally for free.

**No premium tier. No gating. No telemetry to us.**

### Five scouts, deterministic and parallel

- **OpenGrep** — SAST with 17 curated rules (11 pattern-based + 6 taint) covering CWE-22 / 78 / 79 / 89 / 95 / 327 / 502. Taint mode follows `request.*` → dangerous sink in JS/TS and Python.
- **Gitleaks** — secrets, API keys, tokens checked in by accident. Redacted by default.
- **Trivy** — vulnerable dependencies (CVE database), severity-mapped, with fixed-in info.
- **Checkov** — misconfigurations in Dockerfiles, Terraform, Kubernetes.
- **Vibe-Detect** — 6 native heuristic detectors for anti-patterns specific to AI-generated code. Runs offline.

Binaries are downloaded on-demand from the official upstream releases with SHA-256 verification. No Docker, no Python toolchain on the client.

### Multi-provider Brain Layer

Three agents wired into the scan flow:

- **Triage Agent** decides true positive / false positive / inconclusive per finding, with confidence + rationale.
- **Context Agent** explains the exploitability chain: entry point → propagation → sink → exposure.
- **Remediation Agent** proposes a concrete fix with a code snippet.

Pick a different provider per agent. Run triage on DeepSeek v4-flash (cheap), context on Anthropic Haiku (quality), remediation on Ollama locally (free / private). Or use one provider for everything.

### v0.3.22 — trust cross-session (FASE III complete)

The FASE III release focuses on a single principle: **cross-provider triage variance should be surfaced, not hidden**. Three empirically validated features deliver it:

- **Previously (N prior verdicts)** — every finding card has a collapsible section showing every triage verdict this fingerprint has ever received (timestamp + provider label + full rationale). Change providers, re-triage, come back a week later — the trajectory is one click away.

- **⚠ Verdict changed since last scan** banner — when the current verdict differs from the previous, the banner explains why with a reason heuristic (provider changed / verdict reclassified / confidence changed significantly). Empirically validated on 5+ findings in a single re-triage cycle in our own workspace.

- **Diff-aware summary with reason breakdown** — both the terminal and the sidebar summary card show `Scan diff vs previous triage: N new · M re-classified (X class, Y confidence, Z provider) · K unchanged`. Every reclassified finding is categorized by reason.

- **Cross-finding grouping (R20)** — when N ≥ 2 findings share the same rule + package + version, only the group representative pays the LLM token cost; members inherit the verdict with a 0.9× confidence downgrade. Empirical impact in our own SYNAPTIC_SAAS test workspace: 12 LLM calls saved in a single re-triage — 44 findings triaged with only 8 LLM calls + 24 colony-memory + 12 propagated members.

- **Diff-aware CI/CD gates** — `synaptic-sentinel diff --json` for structured output; `synaptic-sentinel triage --fail-on-new-tp-critical 0 --fail-on-new-tp-high 3` for per-severity PR gates.

### The empirical trajectory FASE III collected

Same finding (`fast-xml-parser CVE-2026-41650`, same code, same lockfile) across 5 scans and 2 providers:

| Scan | Provider          | Verdict      | Confidence |
| ---- | ----------------- | ------------ | ---------- |
| 1st  | deepseek/v4-flash | Inconclusive | 0.50       |
| 2nd  | deepseek/v4-flash | Inconclusive | 1.00       |
| 3rd  | deepseek/v4-flash | Inconclusive | 0.90       |
| 4th  | deepseek/v4-pro   | Inconclusive | 1.00       |
| 5th  | deepseek/v4-pro   | Inconclusive | 0.00       |

Before v0.3.22 this drift would be invisible — the sidebar would show only the latest verdict. After v0.3.22, the trajectory + reason for each shift is one click away. **Trust cross-session is a measurable UX property, not a slogan.**

### Cost visibility per session

Every triage session ends with a cost summary block. Actual example from a real Baseline in our SYNAPTIC_SAAS workspace:

```
Cost summary (mixed sources — some calls from provider usage API, some chars/4 proxy):
  provider/model                     agent          calls   input   output   cost USD   avg latency
  deepseek/deepseek-v4-pro           triage         8       5353    2998     $0.0046    14889ms
  anthropic/deepseek-v4-pro          context        23      5734    0        $0.0000    335ms
  anthropic/deepseek-v4-pro          remediation    23      5562    0        $0.0000    338ms
  Total: 16649 in · 2998 out · $0.0046 (~estimated)
```

You know exactly what each triage cost you before your monthly provider bill lands.

### Honest tradeoffs (anti-optimism active)

We list the things v0.3.22 does not do or does imperfectly — the users we want to attract respect that:

- **Sidebar interactive chip filter** — deferred. Users who want to filter by diff status must scroll or use the CLI's JSON export.
- **Group representative choice** = order of appearance (not "best" by severity + reachability).
- **`findingGroupKey`** uses the literal `ruleId` — two distinct CVEs on the same package do NOT group.
- **Context + Remediation only for group representative** — members inherit the triage verdict but have no context/remediation of their own.
- **Confidence downgrade factor 0.9 is opinionated** — matches the design goal of epistemic honesty.
- **Cost varies significantly across providers** — v4-pro is 4× more expensive than v4-flash on the same workload in our own testing. BYOK preserves your choice.
- **FASE III took 5 vsix updates** (broken → placebo → real fix cascade). Install fatigue is real.
- **N=1 empirical sample per baseline** — 5 baselines in a single workspace is strong evidence, not conclusive.

### Install

Download the .vsix from the [latest GitHub Release](https://github.com/golab-arch/synaptic-sentinel/releases/latest) and run `code --install-extension synaptic-sentinel-0.3.22.vsix` (or use _Install from VSIX..._ in the Extensions view). Marketplace publish is on a separate cadence — currently still on v0.3.3, catching up planned.

**Full source, licence, and roadmap on [GitHub](https://github.com/golab-arch/synaptic-sentinel).**

---

## Notes for whoever pastes this

- Both options are pure markdown. The tables use pipe syntax that GitHub / Docusaurus / VuePress / Astro / Next-MDX all handle out of the box.
- Numbers cited (12 LLM calls saved, 4× cost difference between v4-pro and v4-flash, 894 tests, 5 baselines) are all from real empirical baselines in our SYNAPTIC_SAAS workspace during FASE III. Every number is auditable in the BITACORA entries #183-#194.
- The "honest tradeoffs" section is intentionally not hidden in a footer or a "known issues" wiki page — surfacing tradeoffs on the landing is a signal to the users we want.
- Version drift note (marketplace on 0.3.3, GitHub on 0.3.22 = 19-version gap) is acknowledged in the Install section so users searching the marketplace don't feel misled.
