# Benchmark — Ground Truth Dataset

> **Phase 11 DG-075 C — generated as AI-draft on 2026-05-23.**
> **Human review pending before any external citation.**

This directory contains the ground truth dataset that the Brain Layer
empirical benchmark (DG-076) consumes to score multi-provider quality.
For each finding emitted by the deliberately-vulnerable fixtures under
`packages/scouts/tests/**/fixtures/**`, the dataset declares what the
Brain Layer is **expected** to return — Triage classification + Context
explanation keywords + Remediation suggestion keywords.

The file [`ground-truth.json`](./ground-truth.json) holds 27 entries
covering 13 fixtures (SAST / Secrets / IaC / Vibe-Coded). It is validated
against `BenchmarkGroundTruthSchema` (zod) exported from
`@synaptic-sentinel/core`.

## How DG-076 will use it

For each entry × each `{provider, model}` × each Brain Layer agent
(Triage / Context / Remediation), the benchmark runs the agent on the
finding, parses the JSON output, and scores it against the entry's
expectations:

| Agent           | Pass criterion                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Triage**      | `classification` matches exactly + `confidence ≥ minConfidence` + `rationale` contains all `requiredKeywords` (case-insensitive `contains`)                              |
| **Context**     | (only if Triage = TP) `summary` / `entryPoint` / `sink` / `exposure` each contain their respective `Keywords`                                                            |
| **Remediation** | (only if Triage = TP) `summary` + `recommendation` contain their `Keywords`; if a `fixedSnippet` is present, it does NOT contain any of the `forbiddenInSnippet` strings |

JSON validity, latency, token count, and cost are measured separately
(provider-agnostic objective metrics).

## Authority status — anti-optimismo ilusorio activo

Every entry in this dataset carries a `reviewedBy` field:

| Value             | Meaning                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-draft`        | Written by Claude based on reading the fixture source + the OpenGrep ruleset. **NOT authoritative.** Suitable for internal comparative benchmarks (provider A vs B). |
| `human-confirmed` | A human AppSec engineer read the entry and accepted it as-is. Suitable for external claims (blog post, marketplace listing).                                         |
| `human-corrected` | A human AppSec engineer modified the entry. Suitable for external claims; the modification is documented in `humanNotes`.                                            |

**At creation (DG-075 C), all 27 entries are `ai-draft`.** Before any
external citation of the benchmark numbers, the user — or a human
AppSec engineer — should walk the dataset entry by entry and:

1. Update `reviewedBy` to `human-confirmed` or `human-corrected`.
2. Fill `humanNotes` with rationale for any deviation.
3. Update the top-level `reviewedAt` to the current ISO timestamp.

Until then, the benchmark output should be reported with the disclaimer
"ground truth is AI-draft pending human review".

## How to revise

1. Read the fixture file at `fixturePath:line`.
2. For each capa (Triage / Context / Remediation), ask:
   - Are the `requiredKeywords` realistic? (Would a competent LLM
     answer use these words?)
   - Are they too few? (False easy passes.)
   - Are they too many? (False hard fails.)
3. If the entry needs change:
   - Modify the relevant `requiredKeywords` / `*Keywords` / `forbiddenInSnippet`.
   - Set `reviewedBy: "human-corrected"`.
   - Add a `humanNotes` field explaining the change.
4. If the entry is fine as-is:
   - Set `reviewedBy: "human-confirmed"`.

The schema validates that after revision, every entry still parses
against `BenchmarkGroundTruthSchema`. Run `pnpm test:unit` to verify.

## Known limitations of the AI-draft

- **Vibe-Detect entries** are the most uncertain: the heuristics (TODO
  comments, FIXME tags, placeholder strings) emit findings that have
  borderline "is this really a vulnerability" status. The AI-draft
  marks these with lower `minConfidence` (0.6) and a `humanNotes` field
  flagging the borderline.
- **`requiredKeywords` may be too strict**: if the LLM uses synonyms
  ("cmd injection" instead of "command injection"), the pass might
  fail. The keywords are deliberately short (1-2 words) but the user
  should adjust them based on observed LLM outputs in DG-076.
- **IaC (Checkov) keywords are looser**: Checkov findings (`CKV_DOCKER_*`)
  don't have detailed entry/sink/exposure semantics like SAST findings;
  the AI-draft uses generic terms ("Dockerfile", "container", "image").
- **Coverage**: 27 entries is the AI's best enumeration based on
  reading the fixtures and the ruleset. The actual scanner output may
  emit more findings (e.g. Trivy on `package-lock.json` enumerates
  one finding per CVE — potentially dozens, not captured here). DG-076
  will enumerate the real list dynamically and skip findings without a
  matching ground truth entry; the benchmark report will surface this.

## Schema

See [`packages/core/src/config/benchmark-ground-truth.ts`](../../packages/core/src/config/benchmark-ground-truth.ts)
for the canonical Zod schema. Re-exported from `@synaptic-sentinel/core`.
