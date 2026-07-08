# SYNAPTIC Sentinel v0.3.22 — FASE III complete: trust cross-session

**Three empirically validated DGs deliver per-fingerprint verdict persistence, cross-finding correlation via grouping, and diff-aware CI/CD integration.**

Users now **visually see cross-scan verdict drift, provider shifts, confidence deltas, and grouping propagation** with reason categorization + delta metrics. The "trust cross-session" behavior FASE III set out to build is empirically REALIZED across 5-baseline trajectories in real user workspaces.

Install from VSIX: download `synaptic-sentinel-0.3.22.vsix` below and run `code --install-extension synaptic-sentinel-0.3.22.vsix` or use _Install from VSIX..._ in the Extensions view. Marketplace publish is a separate cycle (still on v0.3.3 — 19-version gap; catching up planned).

---

## What's new (headline features)

### 🕰️ Verdict history + Previously section (DG-130 A)

Every finding card in the sidebar now shows a collapsible **Previously (N prior verdicts)** section — the full triage history for that fingerprint (timestamp + provider label + full rationale), preserved across every scan you've ever run. Change providers, re-triage, come back a week later — the trajectory is one click away.

### ⚠ Verdict-changed banner with reason heuristic (DG-130 A)

When the current triage verdict differs from the previous, the finding card shows a warning banner explaining **why**:

- `Different provider (deepseek/v4-flash → anthropic/haiku-4-5) — cross-provider agreement is not guaranteed.`
- `Verdict reclassified — likely new context signals available.`
- `Confidence changed significantly (Δ 0.30).`

Reason precedence: provider > class > confidence-delta (threshold 0.15). Empirically validated on 5+ real findings in a single re-triage cycle.

### 🔗 Cross-finding grouping (DG-131 A — R20)

When N ≥ 2 findings share the same rule + package + version, only the group representative pays the LLM token cost. Members inherit the verdict with a 0.9× confidence downgrade (epistemic honesty: high confidence on the group, medium on each member individually). Sidebar renders **GROUPED REP** (purple) and **GROUPED** (lighter purple) badges + a `[group SCA:pkg@ver:CVE, member N of M]` rationale suffix.

**Empirical impact** (Baseline-15 in SYNAPTIC_SAAS): 12 LLM calls saved in a single re-triage — 44 findings triaged with only 8 LLM calls + 24 colony-memory + 12 propagated members. 20% cost reduction on that specific workload.

CLI escape hatch: `synaptic-sentinel triage --no-group` disables grouping globally.

### 📊 Diff-aware line with reason breakdown (DG-132 A — R22)

Both the terminal and the sidebar summary card now emit:

```
Scan diff vs previous triage: 1 new · 9 re-classified (0 class, 9 confidence, 0 provider) · 34 unchanged
```

Every reclassified finding is categorized by reason. The empirical gap of the earlier basic diff (5 confidence-changed findings counting as "unchanged" despite the banner) is now closed — the summary line and the banner agree.

### 🚦 Diff-aware CI/CD gates + JSON export (DG-132 A)

New CLI command `synaptic-sentinel diff --json` for structured output tailored to CI/CD tooling:

```json
{
  "scanId": "…",
  "summary": { "newFindings": 1, "reclassified": 9, "unchanged": 34 },
  "reclassifiedByReason": { "classChanged": 0, "confidenceDelta": 9, "providerChanged": 0 },
  "newFindings": [{ "fingerprint", "ruleId", "severity", "location", "title" }],
  "reclassified": [{ "…", "reason", "from", "to", "confidenceDelta", "fromConfidence", "toConfidence", "fromProvider", "toProvider" }],
  "unchanged": [{ "…" }]
}
```

Per-severity gates on the `triage` command:

- `--fail-on-new-tp-critical <n>` — exit code 1 if new/reclassified-to-TP critical findings exceed N.
- `--fail-on-new-tp-high <n>` — same for high.
- `--fail-on-new-tp-medium <n>` — same for medium.

Example: `synaptic-sentinel triage --re-triage --fail-on-new-tp-critical 0 --fail-on-new-tp-high 3` — zero tolerance for new critical + tolerate up to 3 new high per PR.

---

## The cross-provider reproducibility gap, empirically collected

FASE III collected a dramatic real-world data point in SYNAPTIC_SAAS. The same finding (`fast-xml-parser CVE-2026-41650`, same code, same lockfile) drifted like this across 5 scans and 2 providers:

| Baseline | Provider              | Verdict         | Confidence |
| -------- | --------------------- | --------------- | ---------- |
| 14a      | deepseek/v4-flash     | Inconclusive    | 0.50       |
| 14b      | deepseek/v4-flash     | Inconclusive    | 1.00       |
| 15       | deepseek/v4-flash     | Inconclusive    | 0.90       |
| 03:11    | deepseek/v4-pro       | Inconclusive    | 1.00       |
| 16       | deepseek/v4-pro       | Inconclusive    | 0.00 (JsonParseError) |

Before v0.3.22 this shift would be invisible — the sidebar would just show the latest verdict and users would either trust it or not. Now the Previously section shows the entire trajectory, the banner explains the delta, and the diff summary counts it correctly. Trust cross-session is not a slogan; it is a measurable UX property.

---

## Hotfixes shipped in this release

- **DG-131.0.1 (placebo — kept for record)** — replaced a silent try-catch in the schema v7 ALTER TABLE ADD COLUMN path with explicit `PRAGMA table_info` check. Turned out to be in a code path that never ran on existing v6 DBs — masked the real bug fixed by DG-131.0.2.
- **DG-131.0.2 (real fix)** — root cause identified via `node + node-sqlite3-wasm` inspection of the real user's `colony.db`: the `schema.sql` file had `CREATE INDEX IF NOT EXISTS idx_*_group_id ON <table>(group_id)` statements running BEFORE the ALTER TABLE in JS. On existing v6 DBs, `CREATE TABLE IF NOT EXISTS` skipped (table exists without column), then `CREATE INDEX` failed with `"no such column: group_id"` aborting the whole migration. Fix: move those CREATE INDEX statements from `schema.sql` to `colony-db.ts` (after the ALTER). Empirically pre-ship verified on a clone of the real user's v6 DB: schema `6→7` bumped cleanly, 49 verdicts preserved, columns + indexes created without errors.

**Institutional lesson learned reinforced**: `SIEMPRE empirical inspection FIRST before speculative fixes`.

---

## Known tradeoffs (honest, non-optimistic)

- **Sidebar interactive chip filter NOT in v1** — deferred. Users who want to filter by diff status (new / reclassified / unchanged) must scroll or use `synaptic-sentinel diff --json` for programmatic filtering.
- **Group representative choice = `members[0]`** — deterministic but not necessarily "best" (highest severity + reachability). Trade-off acceptable for v1.
- **`findingGroupKey` uses literal `ruleId`** — two distinct CVEs on the same package do NOT group. More cautious posture; acceptable v1.
- **Context + Remediation only for group representative** — members inherit the triage verdict but have no context/remediation of their own. The GROUPED badge signals the semantics live in the representative.
- **Confidence downgrade factor 0.9 is opinionated** — matches the design goal (high confidence on the group, medium on each member individually).
- **Cost varies significantly across providers** — Baseline-16 with `deepseek-v4-pro` cost 4× Baseline-15 with `deepseek-v4-flash` on identical workload; v4-pro also produced 3 `JsonParseError` degradations vs 0 for v4-flash. BYOK design preserves user choice.
- **FASE III took 5 vsix updates** (step-130-1 + step-131-1 broken + step-131-2 placebo + step-131-3 real + step-132-1) — user install fatigue moderate. Trade-off vs correctness.
- **User's `agents.yaml` config bug persistent** (not FASE III related) — `context=Anthropic` + `remediation=Anthropic` with `model: deepseek-v4-pro` triggers 404 errors on 46 calls per scan. Better error messages are a follow-up candidate.
- **Migration test coverage gap** — no unit test for the v6→v7 schema migration path (requires manual setup). Empirical pre-ship testing on a real user DB clone was the workaround.
- **N=1 empirical sample per baseline** — 5 baselines in a single workspace is strong evidence but not conclusive.

---

## Testing + verification

- `pnpm verify` VERDE: **70 test files / 894 tests / 3 skipped** + manifest gate + activation gate (9 commands + 15 subscriptions).
- Test growth from v0.3.17 → v0.3.22: **+115 tests cumulative** across all FASE III DGs (17 DG-130 A + 18 DG-131 A + 9 DG-132 A + others).
- Empirical validation trajectory: Baseline-14 (DG-130 A) → Baseline-15 (DG-131 A post-hotfixes) → Baseline-16 (DG-132 A). Total FASE III duration: 3 days vs estimate 4-6 weeks.

---

## Install

```bash
# From the vsix file attached to this release:
code --install-extension synaptic-sentinel-0.3.22.vsix

# Or in VS Code: Extensions → "..." → Install from VSIX...
```

**Clean-install strongly recommended for the schema v7 migration** (a lesson from FASE III's hotfix cascade — old cached extension bundles can interfere):

```powershell
# 1. Close ALL VSCode windows
# 2. Task Manager → End Task on all Code.exe processes
# 3. Clean any prior installs (wildcard):
Remove-Item -Recurse -Force "$env:USERPROFILE\.vscode\extensions\realgolab.synaptic-sentinel-*"
# 4. Install from VSIX in a fresh VSCode window
```

---

## Roadmap next

FASE IV backlog attack. Priority candidates (empirically motivated by Baseline-16 friction and side observations across FASE III):

1. **R25 sidebar interactive chip filter** (DG-132.0.1 reactive) — completes the Sub-A2 v2 promise from Baseline-16.
2. Better **`agents.yaml` config validation error messages** — help users discover their model/provider mismatch faster (currently manifests as 46 opaque 404s).
3. **R21 SBOM export** (SPDX / CycloneDX) — compliance workflows.

The full backlog lives in `docs/SENTINEL_COMPETITIVE_RESEARCH.md` §12.

---

Apache-2.0 · [SYNAPTIC family](https://marketplace.visualstudio.com/publishers/GoLab) · Built by GoLab · Empirical validation is not optional.
