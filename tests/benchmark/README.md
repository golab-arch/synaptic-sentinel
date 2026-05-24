# Benchmark — Ground Truth Dataset

> **Phase 11 DG-075 C — generated as AI-draft on 2026-05-23.**
> **DG-077 B — keywords recalibrated with synonym arrays (still ai-draft).**
> **Human review pending before any external citation.**

This directory contains the ground truth dataset that the Brain Layer
empirical benchmark (DG-076 plumbing + DG-077 fixes) consumes to score
multi-provider quality. For each finding emitted by the
deliberately-vulnerable fixtures under
`packages/scouts/tests/**/fixtures/**`, the dataset declares what the
Brain Layer is **expected** to return — Triage classification + Context
explanation keywords + Remediation suggestion keywords.

The file [`ground-truth.json`](./ground-truth.json) holds 26 entries
covering 13 fixtures (SAST / Secrets / IaC / Vibe-Coded). It is validated
against `BenchmarkGroundTruthSchema` (zod) exported from
`@synaptic-sentinel/core`.

## How DG-076 + DG-077 use it

For each entry × each `{provider, model}` × each Brain Layer agent
(Triage / Context / Remediation), the benchmark runs the agent on the
finding, parses the JSON output, and scores it against the entry's
expectations:

| Agent           | Pass criterion                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Triage**      | `classification` matches exactly + `confidence ≥ minConfidence` + `rationale` contains all `requiredKeywords` (case-insensitive `contains`)                              |
| **Context**     | (only if Triage = TP) `summary` / `entryPoint` / `sink` / `exposure` each contain their respective `Keywords`                                                            |
| **Remediation** | (only if Triage = TP) `summary` + `recommendation` contain their `Keywords`; if a `fixedSnippet` is present, it does NOT contain any of the `forbiddenInSnippet` strings |

**Synonym arrays (DG-077 B)**: each keyword in `requiredKeywords` /
`*Keywords` can now be either a literal `string` OR an array of synonyms
`string[]`. The scorer treats arrays as OR-groups: the entry passes if
**any** synonym is present. This was added in DG-077 B after the PILOT
benchmark revealed that the original literal-keywords were too rigid
(e.g. requiring "code injection" literal while the LLM legitimately said
"RCE" or "arbitrary code execution").

## Running the benchmark

```sh
# Smoke test (no network, mocks):
pnpm benchmark:run -- --dry-run

# Real run (all configured providers):
export SENTINEL_ANTHROPIC_API_KEY=sk-ant-...
export SENTINEL_OPENAI_API_KEY=sk-...
export SENTINEL_DEEPSEEK_API_KEY=sk-...
export SENTINEL_GROQ_API_KEY=gsk_...
export SENTINEL_GEMINI_API_KEY=AIza...
export SENTINEL_OLLAMA_MODEL=gemma3:4b   # optional, default mistral-nemo:12b
pnpm benchmark:run -- --runs 3 --output docs/benchmark/v0.3.0.md
```

### Verbose / manual probe mode (DG-077 B)

The runner supports three flags for inspecting individual calls
end-to-end, useful for debugging prompt failures or recalibrating ground
truth:

| Flag                  | Purpose                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--verbose`           | One log line per LLM call: provider, agent, ruleId, run idx, PASS/FAIL/ERR, JSON/NOJSON, latency, 200-char raw response sample. |
| `--entries <ids>`     | Comma-separated `ruleId` list. Filters the ground truth to just these entries.                                                  |
| `--providers <names>` | Comma-separated `provider` list (`anthropic` / `openai` / `deepseek` / `groq` / `gemini` / `ollama` / ...). Skip others.        |

Single-call probe example (test one entry, one provider, with full
visibility):

```sh
$env:SENTINEL_ANTHROPIC_API_KEY = "sk-ant-..."
pnpm benchmark:run -- --runs 1 `
  --providers anthropic `
  --entries sentinel-js-eval-usage `
  --verbose `
  --output docs/benchmark/_probe.md
```

This was added in DG-077 B after the PILOT benchmark batch runs revealed
issues that could only be diagnosed at the per-call level (LLM
meta-reasoning over the fixture path, markdown wrappers, content=null
responses from reasoning models, etc).

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
- **Synonym arrays partially mitigate strictness (DG-077 B)** — many
  `*Keywords` are now `string[]` arrays where any synonym counts as a
  match. The recalibration improved Context+Remediation PASS rates
  dramatically (Anthropic Haiku Context: 2.6% → 43.6%). But Triage PASS
  rate remained low — see "Open issues" below.
- **IaC (Checkov) keywords are looser**: Checkov findings (`CKV_DOCKER_*`)
  don't have detailed entry/sink/exposure semantics like SAST findings;
  the AI-draft uses generic terms ("Dockerfile", "container", "image").
- **Coverage**: 26 entries is the AI's best enumeration based on
  reading the fixtures and the ruleset. The actual scanner output may
  emit more findings (e.g. Trivy on `package-lock.json` enumerates
  one finding per CVE — potentially dozens, not captured here). DG-076
  enumerates the real list dynamically and skips findings without a
  matching ground truth entry; the benchmark report surfaces this.

## Open issues discovered (post-DG-077)

The DG-077 PILOT + recalibrated runs exposed issues the benchmark
plumbing cannot fix alone — left as deferred sub-DGs:

- **Path leak in synthetic findings**: `buildSyntheticFinding` uses the
  real fixture path (e.g. `packages/scouts/tests/.../fixtures/vulnerable/eval-injection.js`).
  The Brain Layer prompts include `Finding.location.path`; LLMs read
  the path, notice the word `vulnerable` + `tests/.../fixtures`, and
  meta-reason "this looks like a test fixture, probably intentional" →
  classify as `inconclusive` instead of `true_positive`. Discovered
  via `--verbose` probe of Anthropic Haiku on `sentinel-js-eval-usage`
  (run 0, rationale: `"The finding is located in a test fixtures file
under 'vulnerable' directory, suggesting it may be intentionally
vulne..."`). **Fix path**: anonymize fixture paths in
  `buildSyntheticFinding` to look like prod code (e.g.
  `tests/.../fixtures/vulnerable/eval-injection.js` →
  `src/handlers/parser.js`). Deferred — touches benchmark scaffolding
  and needs verification that prompts elsewhere don't rely on the path
  structure.
- **OpenAI gpt-5\* reasoning tokens**: with `max_completion_tokens=1024`,
  gpt-5-nano exhausts the cap on internal reasoning before emitting
  visible content → 100% errors with `content=null` despite earlier
  fixes (max_completion_tokens param + temperature omit). **Fix path**:
  raise `max_completion_tokens` to 4096+ for gpt-5\* family. Deferred —
  per-model token-budget logic + cost impact analysis.
- **Local LLM batching saturates RAM**: Gemma 4 (9.6 GB) and gpt-oss:20b
  (13 GB) on consumer hardware time out / freeze after long sequential
  inference batches. Discovered when a user-side run hung after 2
  hours. **Fix path**: chunk runs with explicit timeouts + memory checks
  between batches, or recommend models ≤3 GB (e.g. `gemma3:4b`,
  `qwen2.5:3b`, `llama3.2:3b`). Deferred — infrastructure work.
- **Free-tier provider quotas**: Groq's TPD limit (100K tokens/day) and
  Gemini's RPM limit get exhausted after one full PILOT + one
  recalibration run. **Fix path**: not a code issue, just operational
  — pay tier or wait 24h. Documented for transparency.

## Schema

See [`packages/core/src/config/benchmark-ground-truth.ts`](../../packages/core/src/config/benchmark-ground-truth.ts)
for the canonical Zod schema. Re-exported from `@synaptic-sentinel/core`.
