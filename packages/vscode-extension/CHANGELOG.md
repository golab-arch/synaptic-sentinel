# Changelog

All notable changes to the SYNAPTIC Sentinel extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.16] - 2026-05-31

**Noise reduction + TP/risk split UX win** (Cycle 108-109, DG-117 A + DG-117.0.1 + DG-118 A). Cuts ~80% of the structural noise from scout output (test fixtures, build artifacts, scanner installer assets) and splits the LLM **confidence%** away from a new **`priorityScore`** that combines severity with the triage classification — fixing the empirical user-confusion "the TP% reads as priority alongside severity" reported in the SENTINEL evaluation handoff.

### Added

- **DG-117 A — Scout exclude-list post-hoc filter in Coordinator pre-stage-2 (Cycle 108)**. New `DEFAULT_EXCLUDED_PATH_SEGMENTS` + `isPathExcluded(path, excluded?, filenameSubstrings?)` util in `@synaptic-sentinel/core`. The Coordinator now drops findings whose `location.path` contains exactly one of the noise segments **before** stage 2 (dedup + fp_known) — the descarded ones count as `suppressedCount`. Initial segment set (9): `fixtures`, `__fixtures__`, `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`, `__pycache__`. Decision deliberada: **NO `test`/`tests` segment** (over-reach would silence legitimate security tests of auth/validation). Applies to ALL 5 scouts via Coordinator (not per-scout flags) — simpler, no per-binary flag-syntax conversion.

- **DG-117.0.1 hotfix decimal — Empirical extension (Cycle 108)**. Baseline-6 in the SENTINEL workspace revealed 3 noise patterns the initial set missed: `tests/benchmark/ground-truth.json` (benchmark test data), `.scanners/<scanner>/...` (CLI-installer artifacts of scanner OSS binaries), and `*.test.*` / `*.spec.*` filename suffixes (test code with intentional vulnerable patterns). The exclude logic extended with: 2 new segments (`benchmark`, `.scanners`) + new constant `DEFAULT_EXCLUDED_FILENAME_SUBSTRINGS = ['.test.', '.spec.']` matched against the last path segment via substring containment. `isPathExcluded` signature extended to 3 args (backward-compatible — 2-arg callers still work). Result on SENTINEL: 34 findings → 19 → **4** (-30 suppressed = -88% noise; only 2 real-code FPs + 2 meta-noise survive).

- **DG-118 A — TP/risk split (Cycle 109, backlog #5 from the user-handoff)**. New field `Finding.priorityScore?: 'urgent' | 'high' | 'medium' | 'low' | 'noise'` computed deterministically by `computePriorityScore(severity, triageClassification?)`. The algorithm (Sub-option B, user-approved):
  - `TP × severity` → severity directly mapped (`critical → urgent`, `high → high`, ..., `info → low` floor)
  - `INC × severity` → severity DEMOTED one step (uncertainty)
  - `Untriaged × severity` → severity directly (pessimistic: could-be-TP)
  - `FP × any` → `noise` (LLM dismissed, deemphasis visual)

  The sidebar now renders TWO badges side-by-side at the head of each card (severity + priority, deliberately different colors) plus a state badge on the right showing only `TP`/`INC`/`FP`/`NEW` — **the confidence% is moved to a secondary line in the brain section** with the explicit label `LLM confidence: N%`. This separates "how sure the LLM is of its verdict" (confidence%) from "how urgent is action" (priorityScore) — the empirical confusion that motivated the split.

  Cross-workspace validation in `SYNAPTIC_SAAS` (Baseline-7): **37 findings**, all 5 priority tiers present (urgent=2, high=16, medium=15, low=2, noise=2), `priorityScore` populated 37/37, sanity matrix PASS across `noise ⇔ FP`, `urgent ⇔ critical+TP`, `(low, inconclusive) → low (floor)`, `(medium, inconclusive) → low (demote)`, `(high, inconclusive) → medium (demote)`.

### Changed

- `FindingSchema` extended with optional `priorityScore?`. Additive + backward-compatible: findings persisted in `colony.db` from earlier scans accept the absence; the UI falls back gracefully to severity-only rendering when missing.
- `ScanOutcome.suppressedCount` now aggregates path-excluded findings (DG-117 A) + dedup + `fp_known` suppression (stage 2). User sees the total; the per-bucket breakdown is internal.
- Sidebar `state-badge` no longer includes the confidence% — that lived alongside the state label (`TP 95%` → just `TP`). The confidence% moved to the brain section line with the explicit `LLM confidence: N%` label.

### Known Issues / Honest tradeoffs

- **`priorityScore` is per-finding; SCA grouped remediations (DG-113 A) show 1 action per package family**. Observed during Baseline-7: `high=16` priority counts in SYNAPTIC_SAAS is dominated by ~14 protobufjs CVEs that collapse to **one** `Upgrade protobufjs to 7.5.8 / 8.2.0` remediation action via the existing DG-113 A grouping. The two views disagree on "how much work." Surfacing priority at the group level is a future improvement candidate (tracked as `DG-future-group-priority`).
- **Severity ↔ priority divergence is by design**, not a bug — that is the point of the split. E.g. `(medium, inconclusive) → low` priority. The UI distinguishes them via different colors + position; if the visual distinction proves insufficient, the priority badge can be re-styled (e.g. explicit "PRIO:" prefix) in a follow-up.
- **The exclude-list is hardcoded** (no `.sentinelignore` yet). If you have a project with a directory legitimately named `fixtures` / `benchmark` / `vendor` (used for production code, not test data), findings there are silenced. User-configurable exclude is deferred to a future sub-DG if demand emerges.
- **The exclude post-hoc filter doesn't save scout CPU** — Trivy/OpenGrep/etc. still scan the noise paths; the Coordinator just discards the findings afterwards. Acceptable for current workspace sizes; if very large monorepos surface scan-time issues, a future hotfix can push exclude flags to the scout binaries (`trivy --skip-dirs`, OpenGrep `--exclude`, etc.).
- **Inconclusive-but-well-reasoned SAST taint verdicts** (carried over from v0.3.15) — unchanged. `inconclusive`-well-reasoned remains success by design for findings whose sink implementation lives in another file.

### Notes

- Empirical validation: SENTINEL workspace (Baseline-6 / 6.1 / 7) confirmed exclude effectiveness; SYNAPTIC_SAAS workspace (Baseline-7 cross-workspace) confirmed `priorityScore` algorithm correctness with diverse data (TP/INC/FP across all 5 severity levels).
- `pnpm verify` VERDE: 62 test files / **763 tests** + manifest gate + activation gate (9 commands + 15 subscriptions). Test growth from v0.3.15: **+56 tests** (707 → 763), of which **+15** are the exclude-list matrix (DG-117 A) + **+12** the hotfix extension (DG-117.0.1) + **+29** the priority-score 20-case matrix and webview render assertions (DG-118 A).
- `vsce publish` to the VS Code Marketplace is **not** part of this release. The Marketplace listing is on v0.3.3; **14 GitHub-only releases** now accumulate (v0.3.4 → v0.3.16) — the largest skip range of the project. To install in VS Code, download `synaptic-sentinel-0.3.16.vsix` and use `code --install-extension synaptic-sentinel-0.3.16.vsix` or _Install from VSIX..._ in the Extensions view.

## [0.3.15] - 2026-05-30

**prismjs misleading remediation fix** (Cycle 107, DG-115 A + DG-115.1 A G7). Resolves the **🚨 prismjs** Known Issue called out in the v0.3.14 release notes and verified empirically against the SYNAPTIC_SAAS web lockfile. For SCA findings where the vulnerable package is a transitive copy pinned by a parent, the sidebar now emits an `overrideDirective` (npm `overrides` / yarn `resolutions` / pnpm `pnpm.overrides`) instead of — or in addition to — the misleading "upgrade to X" recommendation that a top-level bump alone does NOT honor.

### Added

- **DG-115 A — `overrideDirective` for transitive nested-pinned SCA findings** (from report §4 #15). Trivy v0.70.0 already exposes `Result.Packages[]` with full dep graph + `PkgIdentifier.UID` for 1:1 vulnerability↔package matching; the normalizer now consumes it. For each finding the new `sca.dependencyContext { directness: 'direct' | 'indirect' | 'root' | 'unknown', pinnedBy: string[], hasSiblingFixedCopy: boolean }` is computed. When a `FindingGroup` contains at least one `indirect` finding and the package manager is known (`npm`/`yarn`/`pnpm`), the remediation now carries an `overrideDirective` with: `manager`, `packageName`, `versionRange` (`^X.Y.Z` of the recommended fix major track), a copy-pasteable `snippet`, `hasSiblingFixedCopy`, and a deduped `pinnedBy` list. The sidebar renders the directive as a dominant block above the children, with a Copy button (clipboard API + `getSelection().selectAllChildren` fallback), and cites the pinner by name in the risk caveat plus a conservative-alternative exact-version recommendation.

- **DG-115.1 A G7 — STRONG / SOFT visual hierarchy in the sidebar (webview-only refinement)**. Reserves the prominent red treatment for the only case that demands it (`hasSiblingFixedCopy: true` — a fixed copy already exists top-level, e.g. prismjs 1.30.0 top-level + 1.27.0 nested under refractor → **a top-level bump alone will NOT fix this**). The SOFT case (`hasSiblingFixedCopy: false`, ~8 findings per scan: protobufjs / node-forge / fast-uri / uuid / etc.) is now collapsed by default inside a `<details>` block with a one-liner summary "**Transitive (via `<pinnedBy[0]>`) — plain bump usually works; override if it persists (`<manager>`)**". Expanding the block reveals the same full body (caveat + plain bump line + snippet + Copy + risk caveat) as before. CSS uses VS Code semantic variables (`--vscode-editorError-foreground` / `--vscode-editorWarning-foreground` and the matching `inputValidation-*Border`) for theme coherence in dark / light / high-contrast. Data of the tomo is unchanged — `overrideDirective` is still computed and persisted for both SOFT and STRONG cases; only the render is refined.

### Changed

- `TrivyResultSchema` extended with optional `Type?` (`npm`/`yarn`/`pnpm`) and `Packages?: TrivyPackage[]` (the full dep graph with `Relationship`, `DependsOn`, `Identifier.UID`). Additive — older Trivy versions that don't emit these fields degrade gracefully (no `dependencyContext`, no `overrideDirective`).
- `ScaMetadataSchema` extended with optional `packageManager?: string` and `dependencyContext?: DependencyContext`. Additive + backward-compatible — older Findings persisted in `colony.db` are accepted unchanged.
- `RemediationTargetSchema` extended with optional `overrideDirective?: OverrideDirective`. Re-scan to populate.
- New dependency: `semver` in `@synaptic-sentinel/scouts` (used to compare package versions for `hasSiblingFixedCopy` detection).

### Known Issues

> The 🚨 prismjs warning from v0.3.14 release notes is **retired**. Override directives are now emitted for any transitive nested-pinned SCA finding, with a strong / soft caveat graduation. For the prismjs case specifically, the sidebar surfaces the override block prominently — a manual `npm ls prismjs` is no longer required to discover the misleading bump path.

- **Parent/child SCA correlation** (e.g. `@protobufjs/utf8` finding listed as a separate group from its parent `protobufjs`) remains deferred. The exact-match family key in Step 4 is a deliberate trade-off to avoid over-merging unrelated scoped packages. A proper dep-graph-aware family resolver is tracked as `DG-future-SCA-dep-graph`.
- **Reachability framework-level** (e.g. config-gated CVEs like fastify `trustProxy`) remains deferred. The new `sca.dependencyContext` and `sca.packageManager` fields are the data foundation for it — implementation is the next major SCA feature beyond DG-115.
- **Inconclusive-but-well-reasoned SAST taint verdicts** as documented in v0.3.14 — unchanged. `inconclusive`-well-reasoned remains success by design for the class of finding where the sink expression's implementation lives in another file.

### Notes

- DG-115 A and DG-115.1 A G7 were both verified empirically against the SYNAPTIC_SAAS web lockfile (`pnpm-lock.yaml` with `react-syntax-highlighter@15.6.6 → refractor@3.6.0 → prismjs@1.27.0` chain + `prismjs@1.30.0` top-level). The capture vsixes (`step5.vsix` for DG-115 A, `step5b.vsix` for the G7 refinement) are bundled into this v0.3.15 release.
- Trivy `DependsOn` lists **resolved** versions, not the **constraint ranges** the pinner declared (`^` vs `~` vs exact). SENTINEL therefore cannot decide automatically whether a plain top-level bump satisfies the pinner's constraint; the SOFT / STRONG split uses `hasSiblingFixedCopy` (binary) as a safe over-approximation. The deferred parent/child + reachability features will need a manifest-aware input source for full constraint reasoning.
- `pnpm verify` VERDE: 60 test files / 707 tests + manifest gate + activation gate (9 commands + 15 subscriptions).
- `vsce publish` to the VS Code Marketplace is **not** part of this release. The Marketplace listing is on v0.3.3; the **12 GitHub-only releases** (v0.3.4 → v0.3.15) accumulate user-side publishing operations. To install in VS Code, download `synaptic-sentinel-0.3.15.vsix` and use `code --install-extension synaptic-sentinel-0.3.15.vsix` or _Install from VSIX..._ in the Extensions view.

## [0.3.14] - 2026-05-30

**Brain Layer + SCA major release** — packages 5 cycles of work (Cycles 99-105, DG-110 → DG-113.1 A) responding to the SENTINEL-EVALUATION-REPORT empirical evaluation against a real codebase.

> **⚠️ Safety-critical upgrade**. The previous release v0.3.13 (and the v0.3.3 currently on the Marketplace) contains a temporal-cutoff bug that causes the Brain Layer to dismiss real 2026 CVEs as "fabricated" with high confidence — burying a serious vulnerability with a confident false-positive. Step 2 of this release fixes that bug with a 3-layer defense in depth. **Upgrade strongly recommended for any user on v0.3.3 or v0.3.13.**

### Added

- **Step 1 (DG-110 A) — Determinism**: `temperature: 0` hardcoded in `AnthropicLlmClient.completeWithUsage`. The Anthropic client was running at the default `1.0`; the OpenAI-compatible client already pinned `0` for security-tool determinism. Aligns both adapters under the same explicit policy.

- **Step 2 (DG-111 A) — Temporal-cutoff bug fix (BLOCKER from the report §4 #1)**. 3-layer defense in depth against the LLM dismissing real, scanner-confirmed CVEs as "fabricated"/"non-existent"/"future":
  - **Capa 1 (prompt)**: `SYSTEM_PROMPT` rewrite — Software Composition Analysis (SCA) explicitly modeled (was only SAST/secrets); NEW `GROUND TRUTH` section fixing scanner-provided metadata (CVE IDs, package names, versions, advisory dates) as authoritative; explicit instruction: "Your training cutoff is NOT the authoritative source of CVE existence — the scanner's CVE feed is"; criteria for `false_positive` expanded with a negative rule: "Do NOT classify as `false_positive` on the basis that a CVE, version, release, or advisory date does not exist, is fabricated, is fictional, is future-dated, or similar".
  - **Capa 2 (date injection)**: NEW `TriageAgentOptions.currentDate` (defaults to today's UTC ISO date); user prompt now starts with `Current date (real-world authoritative): <YYYY-MM-DD>`. Defense in depth: even if the model strips/caches the system prompt, the user prompt asserts the real-world temporal frame on every call.
  - **Capa 3 (deterministic guard)**: NEW `guardAgainstFabricatedDismissals(verdict, category)` overrides `false_positive` to `inconclusive` (confidence 0.5) when the rationale contains dismissal patterns (`fabricated`, `fictional`, `spurious`, `non-existent`, `not a real`, `future-dated`, `future cve/release/version/advisory`). Overrides preserve the original rationale (truncated to 200 chars) for audit.

- **DG-111.1 A — Chain-of-Thought schema field order**: the JSON shape in the `SYSTEM_PROMPT` now lists `rationale` BEFORE `classification` and `confidence`. The LLM emits fields in the order shown, so writing the rationale first forces it to reason through the scanner-confirmed facts before committing to a verdict. Fixes verdict↔rationale contradictions observed in multi-branch fix cases (e.g. `agentLoop.execute()` rationales concluding "this appears to be a true positive" while the verdict said `false_positive`).

- **DG-111.2 A — Guard precision (scope to SCA)**: the temporal-cutoff guard now only applies to findings of `category: 'SCA'`. Avoids misfire on Secrets/SAST/IaC/VibeCoded/BusinessLogic findings whose legitimate FP rationales may contain words like "not a real production secret" (test fixtures) — a regression observed in the real-world re-scan of v0.3.13.

- **Step 3 (DG-112 A) — SAST taint dataflow trace (from report §4 #3)**. OpenGrep's `dataflow_trace` (emitted by `mode: taint` rules) is now captured by the normalizer, canonized to a new optional `Finding.dataflowTrace` field (additive, backward-compatible), and included in the Triage Agent's user prompt as `Dataflow trace (source → intermediate → sink)`. Defensive caps on the prompt section: max 25 intermediate steps (middle elided with a marker if more), max 200 chars per step `content` (truncated with `…`). Resolves "sink not visible" hedging — the LLM can now reason about the real `agentLoop.execute(orchestrationRequest)` sink instead of just the rule-match snippet.

- **Step 4 (DG-113 A) — SCA correlation/dedup (from report §4 #4)**. SCA findings are now grouped by package family (exact package-name match — `protobufjs` ≠ `@protobufjs/utf8`) in the tomo output. Each group includes the unified remediation target as the **MAX semver per major track** of all known fix versions in the group (e.g. `{"7": "7.5.8", "8": "8.2.0"}` with display `"7.5.8 / 8.2.0"`), with a heterogeneity flag when the fix set crosses multiple major tracks. Captures cross-lockfile (root + web/server) + intra-package (multiple CVEs against the same package) duplications. The sidebar renders an expandable "SCA grouped remediations" section above the individual findings. Parent/child resolution (e.g. `@protobufjs/utf8` ↔ `protobufjs`) requires a dep-graph traversal and is **deferred — see Known Issues**.

- **DG-113.1 A — Discard downgrade tracks**: `computeRemediationTarget` now filters major tracks below the MIN installed major across the group. Empirical trigger from a real-world re-scan: `fast-xml-parser` 5.5.6 was being recommended `4.5.5 / 5.7.0` — `4.5.5` is a major-version downgrade that would break user code. Post-fix the same input yields `5.7.0` only.

### Changed

- `FindingSchema` extended with optional `dataflowTrace?` (Step 3) and `sca?` (Step 4) sub-objects. Additive + backward-compatible: Findings persisted in `colony.db` from earlier scans are accepted unchanged; re-scan to populate the new fields.
- `TomoBodySchema` extended with optional `groups?: FindingGroup[]`. The canonical integrity hash includes `groups`, so tomos before and after this release have different hashes by design.
- New dependency: `semver` in `@synaptic-sentinel/core` (for `RemediationTarget` semver math).

### Known Issues

> **🚨 prismjs CVE-2024-53382 — false sense of remediation (deferred from report §4 #15)**. The Brain Layer correctly identifies `prismjs` 1.27.0 as a true positive and recommends "upgrade to 1.30.0". However in many repos the top-level `prismjs` is already 1.30.0 — the vulnerable 1.27.0 is nested under `refractor` pinned to `~1.27.0`. **A naive top-level bump does NOT fix the vulnerability**. Resolving this requires `npm:resolutions` / `yarn:resolutions` overrides or dep-graph-aware remediation, which is deferred to a future release (tracked as `DG-future-SCA-dep-graph` in the project). **For any prismjs advisory, verify manually with `npm ls prismjs` after applying the recommended bump** — and apply an `overrides` directive if a transitive copy remains.

- **Parent/child SCA correlation** (e.g. `@protobufjs/utf8` finding listed as a separate group from its parent `protobufjs`). The exact-match family key in Step 4 was a deliberate trade-off to avoid over-merging unrelated packages (`@types/node` + `@types/lodash` etc. would be wrongly clustered by a naive scope-strip). Resolving parent/child correctly requires a dep-graph, deferred to the same future release.
- **Inconclusive-but-well-reasoned SAST taint verdicts**: even with the dataflow trace, the LLM sees the sink _expression_ but not its _implementation_ (which lives in another file). For sinks like `agentLoop.execute()`, an `inconclusive` verdict with a well-reasoned rationale about the visible sink is the expected ceiling without AST cross-file resolution. **`inconclusive`-well-reasoned is success by design** for this class of finding; FP is a bonus when the sink expression is recognizable as non-vulnerable in itself.

### Notes

- The previous release v0.3.13 saw 2 hotfix iterations (DG-111.1, DG-111.2) discovered empirically during real-world re-scans. Both are folded into this v0.3.14 release. Step 4 added a third hotfix (DG-113.1, downgrade-track filter).
- `pnpm verify` VERDE: 60 test files / 679 tests + manifest gate + activation gate (9 commands + 15 subscriptions).
- `vsce publish` to the VS Code Marketplace is **not** part of this release. The Marketplace listing is on v0.3.3; the 11 GitHub-only releases (v0.3.4 → v0.3.14) are user-side publishing operations. To install in VS Code, download the `.vsix` and use `code --install-extension synaptic-sentinel-0.3.14.vsix` or _Install from VSIX..._ in the Extensions view.

## [0.3.13] - 2026-05-28

**Re-triage controls + cost card freshness timestamp** (DG-107 A). Closes 2 UX issues reported in empirical feedback after installing v0.3.12 and running Sentinel on a real workspace where the user changed the Brain provider mid-flow (in `.sentinel/agents.yaml`). The `feedback backlog vacío` milestone declared in v0.3.12 release notes lasted **~30 minutes** — a strong validation of the explicit anti-optimismo declared back then ("the feedback received is not exhaustive; other users could uncover new UX issues").

### Added

- **Re-triage all button in the sidebar** (DG-107 A, Issue #1) — when there are already triaged findings in the current scan, a new `Re-triage all` button appears in the sidebar summary card, next to the existing `Triage N untriaged` button (DG-101 A). Clicking it shows a modal warning dialog with the exact count of verdicts that will be overwritten, plus a caveat about LLM cost being incurred again, and explicit reassurance that **false positives marked manually (`mark-fp`) and the cost history rollup are preserved**. The button is styled with `var(--vscode-button-secondaryBackground)` so it visually distinguishes from the primary `Triage N untriaged` button. Use case: after changing the Brain provider in `.sentinel/agents.yaml` (e.g. `deepseek/v4-flash` → `anthropic/claude-sonnet-4-6`), click `Re-triage all` to re-evaluate the same findings with the new provider — otherwise the previous run's verdicts would silently skip every finding (since they're already triaged).
- **`synaptic-sentinel triage --re-triage` CLI flag** (DG-107 A, Issue #1) — equivalent to the sidebar button at the CLI level: clears all existing triage verdicts + context explanations + remediation suggestions for the scan's findings (transactional, with batches of 500 for large workspaces), then runs the full triage pipeline as if from scratch. Preserves `fp_known` (manual false positives) and `triage_token_usage` (cost history). Use for scripting / CI workflows where you want to re-benchmark a provider change without dropping the database.
- **Cost card freshness timestamp** (DG-107 A, Issue #2) — the cost card in the sidebar now shows `as of YYYY-MM-DD HH:MM` (UTC) in its header when there's at least one record in `triage_token_usage`. This timestamp comes from the latest session in the database, **not** from the run that just finished. Surfaces the case where the current triage run made 0 LLM calls (e.g. provider changed and everything was already triaged), and the cost card would otherwise look "fresh" even though it's showing data from a previous session with a different provider. The format uses pure regex parsing without `new Date()` to avoid timezone conversion — the displayed time matches what was persisted, deterministic cross-OS.

### Notes

- Scope only DG-107 A. No changes to the Scout Layer, Brain Layer adapters, benchmark runner, sidebar layout, or `colony.db` schema.
- The destructive `Re-triage all` action **only** clears the 3 enrichment tables (`triage_verdicts` + `context_explanations` + `remediation_suggestions`) for the fingerprints in the current scan. It does NOT touch:
  - `fp_known` (manual false positive marks survive)
  - `triage_token_usage` (cost history accumulates across re-triages — useful for comparing providers)
  - `learning_records` (colony memory persists)
- The MODAL warning dialog is opt-in (the user must explicitly click `Re-triage all` and then confirm). There is no "soft mode" / preview of which verdicts will be overwritten — the count is shown but not the per-finding breakdown.
- **Anti-optimismo**: the IMPACT validates empirically only by reproducing the flow (see below). Recommended 5-step validation in the next section.
- **Deferred — provider-reported badge per-row**: same deferral as v0.3.12. The cost card now has an `as of` freshness timestamp (this release) and the workflow ordering (v0.3.12), but still doesn't distinguish per-row whether the tokens came from the provider's own `usage` field (real) or the `chars/4` fallback proxy. Surfacing it per-row requires a `triage_token_usage` v5 → v6 schema migration; will land if there's empirical demand. Open an issue if you need it sooner.

### How to validate empirically

If you have a workspace with previous scan + triage data in `<workspace>/.sentinel/colony.db` (e.g. the project where you ran v0.3.12):

1. **Uninstall the previous version** (Ctrl+Shift+P → `Extensions: Uninstall Extension`, pick SYNAPTIC Sentinel; or `code --uninstall-extension RealGoLab.synaptic-sentinel`)
2. **Install v0.3.13**:
   - Download `synaptic-sentinel-0.3.13.vsix` from this release
   - `code --install-extension synaptic-sentinel-0.3.13.vsix` (or use _Install from VSIX..._ in the Extensions view)
3. **Edit `<workspace>/.sentinel/agents.yaml`** and switch the triage agent provider (e.g. from `deepseek/v4-flash` to `anthropic/claude-sonnet-4-6`, or vice versa)
4. **Reload the VS Code window** (`Ctrl+Shift+P` → `Developer: Reload Window`) so the sidebar rehydrates from cache (DG-103 A)
5. **In the SYNAPTIC Sentinel sidebar**, you should see the `Re-triage all` button in the summary card (because findings are triaged). Click it → confirm the MODAL → the triage pipeline runs again with the new provider. Inspect the cost card after: the `as of` timestamp updates to the new session, and the new provider/model appears in the breakdown.

### Known Issues

The Known Issues section is unchanged from v0.3.12 — **1 caveat structurally closed**:

1. **Ground truth dataset is AI-drafted** (DG-075 caveat heredado, DG-095 A structured in v0.3.7). External citation remains blocked until the corpus reaches ≥ 10 human-reviewed entries.

## [0.3.12] - 2026-05-28

**Cost card agent ordering fix** (DG-105 A). Closes a small but persistent user-feedback item from the v0.3.9 capture: the Brain Layer cost card in the sidebar was showing agents in a counter-intuitive order. Root cause was on the CLI/core side — `getCostHistory` ordered rows by `estimated_cost_usd DESC`, which is fine for "which agent is the most expensive" reporting but feels wrong as a primary signal in a sidebar card that's organized around the **workflow** of the Brain Layer.

### Changed

- **Cost card agents are now ordered by Brain Layer workflow** (DG-105 A) — `triage → context → remediation`, instead of by descending cost. The new SQL order in `getCostHistory` is `CASE agent_id WHEN 'triage' THEN 1 WHEN 'context' THEN 2 WHEN 'remediation' THEN 3 ELSE 99 END, provider_label`. Within each agent, rows are stable-sorted alphabetically by `provider_label`, so multi-provider setups (e.g. 3 providers × 3 agents = 9 rows) render in a predictable order. This affects:
  - The cost card in the **SYNAPTIC Sentinel sidebar** (after `Triage Findings`)
  - The CLI table output of `synaptic-sentinel cost-history`
  - The JSON output of `synaptic-sentinel cost-history --json`

### Notes

- Scope only DG-105 A. No changes to the Scout Layer, Brain Layer adapters, benchmark runner, sidebar layout, schema, or activate path.
- **Anti-optimismo**: this is a 1-line SQL change covered by 2 new unit tests. The IMPACT validates immediately after install — open any workspace with a previous triage in `.sentinel/colony.db` and confirm the cost card shows `triage → context → remediation` (alphabetical by `provider_label` within each agent for multi-provider).
- **Deferred — provider-reported badge per-row**: the cost card surfaces a `~estimated USD` caveat at the card header (since v0.3.9 / DG-099 A), but doesn't yet distinguish per-row whether the tokens came from the provider's own `usage` field (real) or the `chars/4` fallback proxy. That breakdown lives in the `synaptic-sentinel triage` terminal output today. Surfacing it per-row in the sidebar requires a small schema migration (`triage_token_usage` v5 → v6 to persist `usage_source`); will land in a future release if there's empirical demand. Open an issue if you need it sooner.

### Known Issues

The Known Issues section is unchanged from v0.3.11 — **1 caveat structurally closed**:

1. **Ground truth dataset is AI-drafted** (DG-075 caveat heredado, DG-095 A structured in v0.3.7). External citation remains blocked until the corpus reaches ≥ 10 human-reviewed entries.

## [0.3.11] - 2026-05-28

**Sidebar hydration on activate** (DG-103 A). Closes a real-world UX bug reported in feedback after using v0.3.10 on a 105-finding project: when you closed the workspace and reopened it later, the SYNAPTIC Sentinel sidebar always showed the empty state (`Run "Scan Workspace" to see findings here`) — as if no scan had ever run — even though the previous scan + triage + cost data was sitting right there in `<workspace>/.sentinel/colony.db`. After v0.3.11, the sidebar **rehydrates automatically on activate** from the cached `colony.db`, with cost: 0 (no scanners re-run, no LLM re-invoked).

### Added

- **Sidebar hydration on activate** (DG-103 A) — when the extension activates in a workspace whose `.sentinel/colony.db` (or legacy `.synaptic-sentinel/colony.db`) already contains a previous scan, the sidebar restores **silently**:
  - All findings from the latest scan grouped into the four buckets (`To fix · TP` / `Inconclusive` / `Untriaged` / `Already false positive`)
  - The triage verdict + context explanation + remediation suggestion on every previously-triaged finding (joined by stable fingerprint)
  - The **cost card** from the last triage session (loaded via the existing `cost-history --json` mechanism from DG-099 A)
  - Diagnostics in the editor (squiggly underlines in vulnerable files) and the status bar counter (`Sentinel: N finding(s)`)
- **`synaptic-sentinel show` CLI command** (DG-103 A) — reconstructs the tome of the latest scan from `colony.db` **without running scanners or LLM** (cost: 0). Used internally by the extension for the hydration above; also exposed as a regular CLI command for scripting:
  - `synaptic-sentinel show --path <dir>` → JSON tome to stdout
  - `synaptic-sentinel show --path <dir> --export <file>` → JSON tome to a file
  - Exit 0 on success, 1 if `colony.db` is missing or has no scans yet

### Notes

- Scope only DG-103 A. No changes to the Scout Layer, Brain Layer adapters, benchmark runner, sidebar layout, or `colony.db` schema.
- The hydration is **best-effort defensive**: if `colony.db` is missing, corrupted, has a schema mismatch, or any other read failure, the sidebar falls back to the empty state (`Run "Scan Workspace"...`) silently. A hydration failure will never crash the extension activation — the `try/catch` is doubled (helper + handler).
- The hydration is **async after** `activate()` returns, so it does NOT delay the extension being ready. There can be a brief moment (sub-second on small workspaces) where the sidebar shows the empty state and then snaps to the hydrated view.
- The hydration runs **once per activation** (not on file change, not on workspace folder change). If you edit code outside the extension and want a fresh scan, run `Scan Workspace` as usual.
- **Anti-optimismo**: the IMPACT validates empirically only by reproducing the flow. Recommended 4-step validation in the section below.

### How to validate empirically

If you already have a workspace with previous scan + triage data in `<workspace>/.sentinel/colony.db` (e.g. the project where you ran v0.3.10):

1. **Uninstall the previous version** (Ctrl+Shift+P → `Extensions: Uninstall Extension`, pick SYNAPTIC Sentinel; or `code --uninstall-extension RealGoLab.synaptic-sentinel`)
2. **Install v0.3.11**:
   - Download `synaptic-sentinel-0.3.11.vsix` from this release
   - `code --install-extension synaptic-sentinel-0.3.11.vsix` (or use _Install from VSIX..._ in the Extensions view)
3. **Close the project folder entirely** (File → Close Folder)
4. **Reopen the same folder** (File → Open Folder)

What you should see in the SYNAPTIC Sentinel sidebar **without running anything**:

- Summary card with the previous breakdown (e.g. `105 findings · 52 TP · 36 INC · 17 FP`)
- Cost card with the last triage session's spending
- The four bucketed sections with all your previous findings + triage verdicts + contexts + remediations
- Diagnostics squiggles in the editor
- `Sentinel: N finding(s)` in the status bar

### Known Issues

The Known Issues section is unchanged from v0.3.10 — **1 caveat structurally closed**:

1. **Ground truth dataset is AI-drafted** (DG-075 caveat heredado, DG-095 A structured in v0.3.7). External citation remains blocked until the corpus reaches ≥ 10 human-reviewed entries.

## [0.3.10] - 2026-05-28

**Triage cap controls** (DG-101 A). Closes the last silent UX trap from the v0.3.x backlog. Before this release the `Triage Findings` command silently capped at **25 findings per run** (the CLI default), skipping the rest with only a one-line note in the pseudoterminal that was easy to miss. If you ran `Triage Findings` on a workspace with 38 findings, the sidebar would show 25 classified plus 13 sitting in the `Untriaged` bucket — with no obvious next step. v0.3.10 surfaces the cap, makes it configurable, and gives you a one-click way to triage the remainder.

### Added

- **`synaptic-sentinel.triageLimit` setting** (DG-101 A) — open VS Code Settings (Ctrl+,), search for `SYNAPTIC Sentinel`, and adjust the cap to any value between 1 and 10000. The default stays at **25** to limit the cost of the first triage on a new workspace; raise it (e.g. 100, 500) when you want every finding triaged in one go. The setting only applies when you invoke `Triage Findings` from the Command Palette or the status bar — the new `Triage Remaining` button (below) intentionally ignores it.
- **`Triage N untriaged` button in the sidebar** (DG-101 A) — appears in the summary card of the **SYNAPTIC Sentinel** webview whenever there are findings sitting in the `Untriaged` bucket (the `NEW` pill in the breakdown is > 0). One click runs the Brain Layer on **all** untriaged findings — not just the next 25 — so the bucket clears in a single pass. The button uses VS Code's native button theming (`var(--vscode-button-*)`) so it blends with whatever dark/light theme you use.

### Notes

- Scope only DG-101 A. No changes to the Scout Layer, Brain Layer adapters, benchmark runner, cost card, or `colony.db` schema.
- The new command `synaptic-sentinel.triageRemaining` is deliberately **not** exposed in the Command Palette. The intent is to surface it contextually only when there's something to do — in the sidebar, next to the count of untriaged findings. If you'd prefer a palette entry too, open an issue.
- The button uses an internal cap of 9999 (rather than reading `triageLimit`) because it says `Triage N untriaged` where N is the exact bucket count — limiting it to the configured cap would be misleading. If your workspace has 10000+ pending findings, fall back to running `synaptic-sentinel triage --limit <N>` from the terminal.
- **Anti-optimismo**: the IMPACT validates empirically only by reproducing the cap. The quickest way: open VS Code Settings, set `synaptic-sentinel.triageLimit` to `5`, run `Scan Workspace` then `Triage Findings` on a project with ≥ 6 findings, and confirm that (a) only 5 get triaged, (b) the sidebar shows the rest under `Untriaged · run Triage Findings`, and (c) the `Triage N untriaged` button appears in the summary card.

### Known Issues

The Known Issues section is unchanged from v0.3.9 — **1 caveat structurally closed**:

1. **Ground truth dataset is AI-drafted** (DG-075 caveat heredado, DG-095 A structured in v0.3.7). External citation remains blocked until the corpus reaches ≥ 10 human-reviewed entries.

## [0.3.9] - 2026-05-26

**Sidebar Cost Visibility** (DG-099 A). Closes the last UI value-prop gap from Phase 11: the Brain Layer cost summary (tokens + cost USD + latency, per `(provider/model, agent)`) was previously printed only in the pseudoterminal after each `Triage Findings` run — useful in the moment, invisible once the terminal was closed or scrolled. v0.3.9 surfaces it as a persistent **cost card** in the SYNAPTIC Sentinel sidebar, right between the findings summary (introduced in v0.3.8 / DG-097 A) and the bucketed findings sections.

### Added

- **Cost card in the sidebar** (DG-099 A) — every time you run `Triage Findings`, the sidebar refreshes with a new cost card showing:
  - Title `Brain Layer cost · last session` (or `· last N sessions` if you raise the limit in a future iteration) plus the `~estimated USD` caveat.
  - A compact table per `(provider/model, agent)` row: `calls`, `input tokens`, `output tokens`, `cost USD`, `avg latency ms`. Numeric columns use `tabular-nums` so the digits align across rows regardless of length.
  - A total line below the table: `Total: N calls · X input · Y output · $Z`.
  - When no triage has run yet in the workspace (empty `triage_token_usage` table or missing `colony.db`), the card collapses to a minimal `Brain Layer cost — run Triage Findings to start tracking cost` instead of disappearing.
- **`synaptic-sentinel cost-history --json` flag** (DG-099 A) — the existing `cost-history` sub-command keeps emitting the human-readable table by default; `--json` opt-in emits a typed JSON payload (`{ limit, rows: CostHistoryRow[], totals: { calls, inputTokens, outputTokens, estimatedCostUsd } }`) to stdout. The extension consumes this JSON instead of parsing terminal output, so the contract between the CLI and the IDE is now structured and validated by a Zod schema.

### Notes

- This release contains only the DG-099 A feature — no changes to the Scout Layer, Brain Layer adapters, benchmark runner, or `colony.db` schema.
- Tokens and cost remain `~estimated` (DG-078 B / DG-085 A caveats): when the provider exposes real `usage` (Anthropic, OpenAI-compat, Ollama native) the counts are real; when it doesn't, a `chars/4` proxy fallback applies. The cost card does not yet distinguish provider-reported vs proxy at the row level — the existing `(provider-reported)` / `~estimated` badge keeps appearing in the pseudoterminal output for that signal.
- The cost card sits below the findings summary and above the bucketed sections deliberately: "what to fix" (the triage state breakdown) is the primary signal, "how much it cost" is secondary scan information. If you'd prefer it elsewhere, file an issue.
- **Anti-optimismo** (continuing the v0.3.8 acknowledgement): the unit tests cover the renderer + JSON parsing (549 tests, +11 vs v0.3.8 baseline), but they cannot tell us how the card actually scales with multi-provider runs (3 providers × 3 agents = 9 rows) or how it feels on light themes. Feedback welcome.

### Known Issues

The Known Issues section is unchanged from v0.3.8 — **1 caveat structurally closed**:

1. **Ground truth dataset is AI-drafted** (DG-075 caveat heredado, DG-095 A structured in v0.3.7). The 26 entries in `tests/benchmark/ground-truth.json` remain `reviewedBy: 'ai-draft'`. External citation remains blocked until the corpus reaches ≥ 10 human-reviewed entries.

## [0.3.8] - 2026-05-26

**Sidebar triage state visibility** (DG-097 A). The first **UI-visible improvement** to the SYNAPTIC Sentinel sidebar panel since v0.3.0: findings are now grouped by their triage state (TP / INC / Untriaged / FP) rather than rendered as a flat list, so the value of the Brain Layer triage actually surfaces in the IDE primary UI. Parallel small fix: deprecation warnings from Node internals (notably `DEP0040 punycode`) are no longer printed in the Sentinel pseudoterminal — they were noise the user couldn't act on.

### Added

- **Triage state grouping in the sidebar** (DG-097 A) — the **SYNAPTIC Sentinel** webview in the Explorer sidebar now organizes findings into four buckets, in this order, with a section header per non-empty bucket:
  1. **To fix · true positive** (●) — findings the Brain Layer confirmed as real issues.
  2. **Inconclusive · agent could not decide** (?) — findings where the agent reported low confidence.
  3. **Untriaged · run Triage Findings** (○) — new findings from the scan that have not been triaged yet.
  4. **Already false positive** (✓) — findings the Brain Layer dismissed; rendered with reduced opacity (0.55, full on hover) so they de-emphasize without disappearing.
- **State badge on every finding card** showing the triage label + confidence percentage as a scan-fast signal: `TP 95%`, `INC 50%`, `FP 95%`, or `NEW` (for untriaged, since there is no confidence yet). The full rationale + context + remediation remain in the expanded card body as before.
- **Summary card at the top** of the sidebar replaces the previous `N finding(s) · click to open in the editor` meta line. New format: `N findings · X TP · Y INC · Z NEW · W FP` with colored pills per bucket. Only pills for non-empty buckets appear. Singular/plural handled correctly.

### Changed

- **Node deprecation warnings suppressed in the pseudoterminal** (DG-097 A) — the extension now spawns the bundled CLI with `NODE_NO_WARNINGS=1` in the environment. The most visible effect is that `(node:NNNN) [DEP0040] DeprecationWarning: The 'punycode' module is deprecated...` no longer prints three times per scan in the **SYNAPTIC Sentinel** pseudoterminal. This was Node-internal noise that nobody — neither the user nor Sentinel — could act on; it just diluted the actual scan output.

### Notes

- This release contains only the DG-097 A feature — no changes to the Scout Layer, the Brain Layer adapters, the benchmark runner, the CLI, or `colony.db` schema.
- The sidebar grouping is **fixed** (triage state first, severity within). If you'd like a toggle to group differently (by severity / category / file), open an issue — that would be a future sub-DG.
- **Anti-optimismo**: the unit tests cover the rendering logic (538 tests, +13 vs v0.3.7 baseline), but they cannot tell us how the new colors and opacity actually feel under your VS Code theme — light themes in particular may make the dimmed FP cards harder to read than intended. Feedback on theme-specific issues is welcome.
- The `untriaged` badge says `NEW` rather than `UNTRIAGED` because it communicates "pending action" more directly and fits the narrow badge slot. The text in the section header still uses the longer `Untriaged · run Triage Findings` for clarity.

### Known Issues

The Known Issues section is unchanged from v0.3.7 — **1 caveat structurally closed**:

1. **Ground truth dataset is AI-drafted** (DG-075 caveat heredado, **DG-095 A structured** in v0.3.7). The 26 entries in `tests/benchmark/ground-truth.json` remain `reviewedBy: 'ai-draft'`. The path forward (per-layer criteria, threshold-driven disclaimer scaling) lives in `tests/benchmark/README.md`. External citation remains blocked until the corpus reaches ≥ 10 human-reviewed entries.

## [0.3.7] - 2026-05-26

**Ground truth review structure** (DG-095 A). Closes the last v0.3.0 "Known Issues" caveat **structurally**: the AI-drafted ground truth corpus still requires an AppSec engineer pass, but the caveat is no longer opaque — the benchmark report now scales its disclaimer in three levels based on how many entries have been human-reviewed, and `tests/benchmark/README.md` documents an operational flow with per-layer review criteria. **5 caveats closed + 1 structured = 100% of the v0.3.0 backlog treated.**

### Added

- **3-level disclaimer in the benchmark report** (DG-095 A) — `renderBenchmarkReport` now branches on `humanReviewed = confirmedCount + correctedCount` against the new exported constant `HUMAN_REVIEW_THRESHOLD = 10`:
  - **`humanReviewed === 0`** → strong disclaimer (unchanged from v0.3.6): _"Anti-optimismo ilusorio: all N entries are `ai-draft` (NO human-AppSec review); internal-comparative only — do NOT cite externally."_
  - **`0 < humanReviewed < 10`** → new mid-level disclaimer: _"⚠️ Limited human review (N of M entries reviewed; threshold for high-confidence external citation: 10)"_ followed by _"Ground truth review status: X confirmed + Y corrected + Z draft."_
  - **`humanReviewed >= 10`** → no strong disclaimer; the report emits _"Ground truth review status: ... (W ≥ 10 threshold — aggregate numbers are acceptable for external citation; mention the mix when reporting)"_.
- **Operational flow for ground truth revision** (DG-095 A) — `tests/benchmark/README.md` "How to revise" section rewritten with 8 concrete steps (clone → branch → pick entry → open fixture → apply criteria → update `reviewedBy` + `humanNotes` → bump `reviewedAt` → `pnpm test:unit` → PR), a "What to validate, per capa" subsection with explicit criteria for each agent (Triage: `is_true_positive` verifiable from the CWE + fixture; Context: 3 keywords ≥80% appear naturally, no fabricated tech terms; Remediation: code suggestion compilable, addresses the CWE, `risk_score` calibrated 0–100), and a "Disclaimer thresholds" table mirroring the three-level logic above.

### Notes

- This release contains only the DG-095 A feature — no changes to the Scout Layer, the Brain Layer adapters, the benchmark runner, the CLI, the extension UI, or `colony.db` schema.
- The `HUMAN_REVIEW_THRESHOLD` constant is exported from `packages/cli/src/benchmark/report.ts` so callers (tests, downstream tools) can reference it without hardcoding the number.
- **Anti-optimismo**: this release does **not** close the underlying caveat — the corpus is still 100% `ai-draft`. What it closes is the **opacity**: before, "ground truth ai-draft" was a caveat without a path forward; now it is a caveat with a threshold + a documented flow + per-layer criteria. External citation of the benchmark numbers **remains blocked** until the corpus reaches ≥ 10 human-reviewed entries — at which point the report itself will start emitting the softer disclaimer automatically.
- No CLI helper for ground truth review was added (deliberate scope decision). Editing the JSON file directly + running `pnpm test:unit` + opening a PR is sufficient and avoids over-engineering. If a CLI helper becomes useful later, it would be a separate sub-DG.

### Known Issues

The Known Issues section is **structurally closed** for v0.3.x:

1. **Ground truth dataset is AI-drafted** (DG-075 caveat heredado, **DG-095 A structured**). The 26 entries in `tests/benchmark/ground-truth.json` are still `reviewedBy: 'ai-draft'`. The path forward is now explicit: human-review entries with the criteria in `tests/benchmark/README.md`, bump `reviewedBy` to `'human-confirmed'` or `'human-corrected'`, and re-run the benchmark — the report will scale its disclaimer automatically as the corpus is reviewed.

## [0.3.6] - 2026-05-26

**Two structural fixes** accumulated from sub-DGs `DG-092 A` and `DG-093 A`. Both came directly from real user feedback while running v0.3.5 locally: an opaque `unable to open database file` error during a `Scan Workspace` (DG-092 A) and a follow-up observation that the workspace had two distinct directories — `.sentinel/agents.yaml` and `.synaptic-sentinel/colony.db` — which felt inconsistent (DG-093 A).

### Added

- **`ColonyDb.open()` now emits actionable error messages** (DG-092 A) — the previous opaque `unable to open database file` from `node-sqlite3-wasm` is now wrapped with a multi-line diagnostic that lists the three common causes observed in real reports: (a) a stale lockfile from another Sentinel CLI run still in flight (close other VS Code windows or kill stale node processes); (b) Norton / Defender / corporate antivirus blocking the write (add the workspace path to your AV exclusions); (c) the workspace is read-only or your user lacks write permissions. The original SQLite error is preserved at the end of the message for stack-trace correlation. A pre-flight also checks that the parent directory exists before delegating to the driver, so a missing dir fails fast with the absolute path in the message. Defensive only — no behavior change when things work; the diagnostic appears when the underlying driver throws.

### Changed

- **Workspace data directory unified to `.sentinel/`** (DG-093 A) — `colony.db` now lives in `<workspace>/.sentinel/colony.db`, the same directory where `.sentinel/agents.yaml` has been written since v0.3.0 (Phase 11 DG-073 B). Previous versions wrote it to `<workspace>/.synaptic-sentinel/colony.db`, which created two distinct directories side by side in your repo. **Backward-compat is preserved by dual-read**: if your workspace has `.synaptic-sentinel/colony.db` from v0.3.5 or earlier, the CLI keeps reading it and emits a log informativo suggesting you move it to `.sentinel/colony.db` when convenient. **No automatic file migration** — the CLI never moves your data; you decide when. Zero risk of data loss from this release.
- **Per-user scanner cache path unchanged** — `~/.synaptic-sentinel/scanners/` keeps its legacy name (workspace and per-user home are distinct namespaces; migrating both would only force users to re-download binaries with no upside).

### Notes

- The CHANGELOG of v0.3.4 has a similar "release with N accumulated fixes" pattern; v0.3.6 follows the same operational model: 2 GitHub Releases accumulated since the last Marketplace publish (v0.3.4 and v0.3.5 were both GitHub-only). The Marketplace listing may go from v0.3.3 directly to v0.3.6 — semver permits skipping intermediate versions on marketplace releases.
- The new `resolveColonyDbPath(projectRoot)` helper is exported from `@synaptic-sentinel/core`. Third-party integrations that open the colony DB programmatically should switch to it from hardcoded `join(root, '.synaptic-sentinel', 'colony.db')` calls.
- `.gitignore` users who versioned their old `colony.db`: see `docs/colony-db.md` for the updated section listing both `.sentinel/colony.db*` and the legacy `.synaptic-sentinel/colony.db*`.
- Anti-optimismo: 524 unit tests pass + both verify gates pass + `vsce package` produces a valid `.vsix`. The end-to-end flow (open a project, scan, observe the new `.sentinel/colony.db` written) was validated empirically in DG-092 A's bug report — the v0.3.5 run that triggered DG-092 A also confirmed that `Scan Workspace` + `Triage Findings` work end-to-end in a real installation. The migration to `.sentinel/` is unit-tested through the `resolveColonyDbPath` helper covering all four branches of its decision tree, plus a `mark-fp` integration test that exercises the dual-read with a legacy seed.

### Known Issues

The Known Issues section is unchanged from v0.3.5 — **1 caveat open**:

1. **Ground truth dataset is AI-drafted** (DG-075 caveat heredado). The 26 entries in `tests/benchmark/ground-truth.json` are `reviewedBy: 'ai-draft'`. The schema supports `'human-confirmed' | 'human-corrected'` for entries that pass through an AppSec engineer review, but no entry has gone through review at this point. The benchmark report still ships with an "internal-comparative only, do NOT cite externally" disclaimer for any session where all entries are `ai-draft`.

## [0.3.5] - 2026-05-26

**Editable provider selector in the Settings panel** (DG-090 A). Until v0.3.4 the "Active Configuration" section of the **Configure Brain Layer Providers** panel was a read-only display — you could save / delete / test API keys for any of the 12 providers, but the only way to choose **which provider runs each agent** (Triage / Context / Remediation) was to edit `.sentinel/agents.yaml` by hand or pass `--agent-provider` flags to the CLI. This UX gap was reported by a user testing v0.3.4 locally. v0.3.5 closes it: each agent row now has a provider dropdown + model input + an **Apply** button that writes `.sentinel/agents.yaml` from the panel.

### Added

- **Editable provider/model selector per agent** (DG-090 A) — in the "Active Configuration" section, each of the three agents (Triage / Context / Remediation) gets:
  - A `<select>` dropdown listing the providers that are **actually usable in your environment**: providers whose API key is `configured: true` in the OS SecretStorage, plus `ollama` if the daemon responds at `localhost:11434`. The provider currently active is always included in the dropdown even if its key isn't configured — so you can see exactly what the system is using right now.
  - A `<input type="text">` for the model name, prefilled with the active model and HTML-escaped against injection from the webview state.
  - An **Apply** button that writes `.sentinel/agents.yaml` in your workspace root via the same `writeAgentsYamlFromUI` helper the CLI reads. The file format is unchanged — the panel and the YAML are now two equivalent ways to configure the same thing.
- **Helpful hint when no provider is configured** — if you haven't saved any API key and Ollama isn't running, the panel shows a "Tip: configure at least one API key below (or start Ollama locally) to make more providers available in the dropdowns above." message under the agent rows.

### Notes

- This release contains only the DG-090 A feature — no changes to the Scout Layer, the Brain Layer adapters, the benchmark runner, or the CLI. The `.sentinel/agents.yaml` file that the editable selector writes is the **same format** the CLI has read since v0.3.0 (Phase 11 DG-073 B). If you've been editing the YAML by hand, the panel is a strict superset of that workflow — your existing files keep working unchanged.
- The validation layer behind the Apply button (`mergeAgentConfig` helper) rejects invalid combinations defensively: it returns `null` (and the UI shows a warning toast) if the `agentId` isn't one of `triage / context / remediation`, if the `provider` isn't in `PROVIDER_NAMES`, or if the model field is empty after trimming — guards against malformed `postMessage` payloads from the webview.
- Anti-optimismo: the end-to-end flow (click Apply → file written → next `triage` uses the new provider) is covered by 13 new unit tests on the renderer and the merge helper, but the stateful `writeAgentsYamlFromUI` call from the message handler isn't under test — manual F5 / installed-vsix validation is what closes that loop. If you find the Apply button doesn't update the YAML, please file an issue.

### Known Issues

The Known Issues section is unchanged from v0.3.4 — **1 caveat open**:

1. **Ground truth dataset is AI-drafted** (DG-075 caveat heredado). The 26 entries in `tests/benchmark/ground-truth.json` are `reviewedBy: 'ai-draft'`. The schema supports `'human-confirmed' | 'human-corrected'` for entries that pass through an AppSec engineer review, but no entry has gone through review at this point. The benchmark report still ships with an "internal-comparative only, do NOT cite externally" disclaimer for any session where all entries are `ai-draft`.

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
