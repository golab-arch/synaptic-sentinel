# SYNAPTIC Sentinel

**The vibe-coding security sentinel. Apache-2.0. Five deterministic scouts scan your repo; a Brain Layer (BYOK Anthropic) decides what really matters and how to fix it — all in the IDE.**

SYNAPTIC Sentinel is the security companion of the SYNAPTIC family (sibling of [SYNAPTIC Expert](https://marketplace.visualstudio.com/items?itemName=GoLab.synaptic-expert)). Where Expert helps you _write_ AI-assisted code with traceability, Sentinel audits _what gets written_ — your own code, your AI's code, your dependencies, your config — and explains why it matters. **All capabilities are open under Apache-2.0; there is no premium tier and no proprietary gating.**

Built for three kinds of users:

- **Developers** shipping AI-assisted code who want to catch the classic mistakes (eval-of-user-input, SQL injection by concatenation, secrets in commits, vulnerable deps) before the PR.
- **Tech leads** who want SARIF in CI as a quality gate, and a "living tome" of audited findings to ship as evidence.
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

### Brain Layer (BYOK Anthropic)

Three LLM agents wired into the scan flow:

- **Triage Agent** — for each finding, decides _true positive_ / _false positive_ / _inconclusive_ with a confidence score and a one-sentence rationale.
- **Context Agent** — for confirmed true positives, explains the exploitability chain: `entry point → propagation → sink → exposure`.
- **Remediation Agent** — proposes a concrete fix, with a code snippet you can copy.

The three agents share a **memory of the swarm** (a learning store on disk in your repo): a triage pattern seen with strong evidence is pre-classified on the next scan **without spending an LLM token**.

Bring Your Own Key (Anthropic). The key is stored encrypted in your OS secret store via `vscode.SecretStorage`, passed to the model only as a request header, never to a proxy.

### Turnkey from install to first scan

1. Install the extension from the marketplace.
2. **Command Palette → "SYNAPTIC Sentinel: Install Scanners"** — downloads and verifies the five scout binaries to a per-user cache (`~/.synaptic-sentinel/scanners`). Once.
3. **Command Palette → "SYNAPTIC Sentinel: Scan Workspace"** — findings appear as inline diagnostics, in the _Problems_ panel, and in the **living tome** side view.
4. _(Optional, BYOK)_ **Set Anthropic API Key** → **Triage Findings (Brain Layer)** to enrich findings with classification + context + remediation.

---

## Commands

| Command                                            | What                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `SYNAPTIC Sentinel: Scan Workspace`                | Runs the five scouts and paints findings as diagnostics.             |
| `SYNAPTIC Sentinel: Triage Findings (Brain Layer)` | Runs the three Brain Layer agents over the last scan. Requires BYOK. |
| `SYNAPTIC Sentinel: Set Anthropic API Key (BYOK)`  | Stores the key encrypted in `SecretStorage`.                         |
| `SYNAPTIC Sentinel: Install Scanners`              | One-time download of the scout binaries to the per-user cache.       |

Plus Code Actions on each finding: **mark as false positive** (suppressed in future scans), and **copy suggested remediation**.

---

## CI-native

Sentinel's CLI bundle ships with the extension and is also runnable standalone. The CLI exports the audit tome to **JSON**, **HTML** (an audit report you can hand to a reviewer), and **SARIF 2.1.0** (GitHub Code Scanning, Azure DevOps). The `--fail-on <severity>` flag turns the scan into a CI gate (exit code 2 if there are findings at or above the threshold).

---

## Privacy and data flow

- **Your code never leaves your machine for the deterministic scans.** The five scouts run locally as child processes.
- **For the Brain Layer (optional), each finding's snippet goes directly to Anthropic** — no proxy, no middleman. BYOK.
- **The audit memory (`colony.db`) lives in your repo's `.synaptic-sentinel/` directory.** You decide whether to commit it.

---

## License

All packages — extension, Scout Layer, Brain Layer — are licensed under **Apache License 2.0**. Source code, including the three LLM agents, is open and redistributable.

---

_Part of the [SYNAPTIC](https://github.com/golab-arch) family — Apache-2.0 toolkit for engineers shipping AI-assisted code with traceability._
