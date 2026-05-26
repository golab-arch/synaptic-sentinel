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

## How to revise (DG-095 A — full operational flow)

The ground truth is AI-drafted by design, and the way out of "internal-comparative only" is human-AppSec review. This section is the step-by-step for a reviewer who wants to take an entry from `ai-draft` to `human-confirmed` or `human-corrected`.

### Step-by-step

1. **Clone the repo** and check out a working branch.
2. **Pick an entry** from `tests/benchmark/ground-truth.json` by `ruleId:line`. The schema allows touching one entry at a time; you don't need to review all 26 at once.
3. **Open the fixture** at `<entry.fixturePath>:<entry.line>` and read the surrounding context (typically 5-10 lines before/after the targeted line).
4. **For each capa (Triage / Context / Remediation)** apply the validation criteria below.
5. **Update the entry**:
   - If the entry needs **no changes** → set `"reviewedBy": "human-confirmed"`.
   - If the entry needs **any change** to keywords / classification / minConfidence / forbiddenInSnippet → set `"reviewedBy": "human-corrected"` and add a top-level `"humanNotes"` field explaining the change in 1-2 sentences (it's not in the schema today but the schema accepts unknown fields; future schema bump will add it formally).
6. **Bump `reviewedAt`** at the top of the JSON to the current ISO timestamp.
7. **Run `pnpm test:unit`** — the `BenchmarkGroundTruthSchema` (Zod) validates the JSON; a syntax error or invalid `reviewedBy` enum value fails the test.
8. **Open a PR** with title `review(ground-truth): <ruleId>:<line> — confirmed|corrected`. The diff should be a small, focused change to a single entry.

### What to validate, per capa

**Triage**:

- Does `classification` (`true_positive` / `false_positive` / `inconclusive`) actually match what a senior AppSec engineer would say given the code at `<fixturePath>:<line>`? Default for vulnerable fixtures is `true_positive`; obvious test-helper code is `false_positive`; ambiguous flow-dependent cases are `inconclusive`.
- Is `minConfidence` realistic for a competent LLM? Too high → 100% real FAILs; too low → false easy PASSes. Range 0.7-0.95 is the sweet spot.
- Are the `requiredKeywords` (per-capa or top-level) words that an LLM's `rationale` would naturally use, OR are they too specific (e.g. requiring the literal CWE number when the LLM would say "command injection")? **Synonym arrays (`["RCE", "remote code execution", "arbitrary code"]`) are encouraged** (added in DG-077 B).

**Context** (only present if `classification === 'true_positive'`):

- Do the four buckets (`summaryKeywords`, `entryPointKeywords`, `sinkKeywords`, `exposureKeywords`) accurately reflect the attack chain in this specific code, not generic SAST jargon?
- Is the entry point a real user-controlled input, or a fabrication of the AI-draft?
- Is the sink the actual dangerous function (e.g. `eval`, `child_process.exec`, `cursor.execute`), not a vague abstraction?

**Remediation** (only present if `classification === 'true_positive'`):

- Does `summaryKeywords` describe what to do (replace eval, sanitize, parameterize), not just the vulnerability?
- Does `recommendationKeywords` include the realistic fix idiom (e.g. `JSON.parse`, `DOMPurify`, parameterized query, `secure_filename`)?
- Does `forbiddenInSnippet` correctly list the patterns that **must NOT** appear in a good fix? (e.g. for command injection, `forbiddenInSnippet: ["exec(userInput)"]`; the LLM's fix should eliminate the sink-with-tainted-input pattern entirely).

### Disclaimer thresholds in the benchmark report (DG-095 A)

The benchmark report emits one of three disclaimers based on `human-confirmed + human-corrected` count across the dataset (the `humanReviewed` total):

| Reviewed count                                  | Disclaimer level | Reporter wording                                                                                                                    |
| ----------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `humanReviewed === 0`                           | **Strong**       | "all entries are ai-draft — internal-comparative only; do NOT cite externally without filtering"                                    |
| `0 < humanReviewed < 10`                        | **Limited**      | "limited human review (N of total); threshold for external citation is 10; aggregate is internal-comparative"                       |
| `humanReviewed ≥ 10` (`HUMAN_REVIEW_THRESHOLD`) | **Soft**         | "review status: N confirmed + M corrected + K draft (≥ 10 threshold — aggregate acceptable for external citation; mention the mix)" |

The threshold of **10** is set in [`packages/cli/src/benchmark/report.ts`](../../packages/cli/src/benchmark/report.ts) (`HUMAN_REVIEW_THRESHOLD` constant). The rationale: 10 entries cover at least one case per category (SAST JS/TS, SAST Python, Secrets, IaC, Vibe-Coded) with replication; below that, the risk of selecting a non-representative subset when filtering by `human-reviewed` is high. The number can be adjusted in a future sub-DG when the dataset grows beyond ~50 entries.

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
