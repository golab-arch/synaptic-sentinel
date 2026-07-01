# SENTINEL Competitive Research — Living Document

> **Purpose**: consolidate verified findings from competitive landscape research for SYNAPTIC Sentinel (Apache-2.0 VS Code extension for OSS-based security vulnerability detection with LLM-based FP triage). This is a **living document** — investigations resume from this state if a session is interrupted (e.g. rate-limit). Every claim has explicit status, source, vote (when verified), and rationale.

**Last updated**: 2026-06-18 (Session 4 — 12 NOT RESEARCHED gaps investigated)
**Initiated by**: Cycle 110 close + post-DG-120 A release (v0.3.16)
**Owner**: SENTINEL maintainer + Claude Code research collaboration
**Methodology**: deep-research workflow (`workflow:deep-research` — fan-out web search → fetch → extract claims → adversarial 3-vote verify → synthesize) + manual WebFetch/WebSearch verification of high-priority unverified claims when the workflow is rate-limited.

**Cumulative status**:

- Session 1-2 (workflow): **26 claims** — 23 VERIFIED · 1 MIXED · 2 REFUTED
- Session 3 (manual WebFetch): **22 claims VERIFIED** (covering the rate-limited ones)
- Session 4 (NOT RESEARCHED gaps): **12 gaps investigated** + 1 prior refutation CORRECTED (Arnica) + 1 strategic correction added (Section 1.21 OpenGrep restores cross-function taint)
- **Total** = 38 claims/gaps with verified status across the document.

---

## 0. Status legend

| Marker                | Meaning                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| ✅ **VERIFIED**       | 3-0 or 2-1 confirmed via adversarial verification, OR manually verified via direct source fetch |
| ⚠️ **MIXED**          | 1-1 split vote — evidence ambiguous                                                             |
| ❌ **REFUTED**        | 0-3 or 0-2 refuted via adversarial verification, OR manually contradicted via source            |
| 🔍 **INVESTIGATING**  | currently being researched in this session                                                      |
| ⏸ **PENDING**         | extracted claim with cited source, awaiting verification                                        |
| 📝 **SYNTHESIS**      | derived from multiple sources or domain reasoning, not a single citable claim                   |
| 🚫 **NOT RESEARCHED** | identified gap, not yet investigated                                                            |

---

## 1. VERIFIED findings (high-confidence, ready for strategic use)

### 1.1 ✅ Aikido AutoFix uses Claude Sonnet via AWS Bedrock with per-fix confidence

**Claim**: _"Aikido's AI AutoFix uses Claude Sonnet via AWS Bedrock to generate fix pull requests with confidence scoring per fix."_

- **Source**: <https://www.aikido.dev/features/ai-sast-iac-autofix>
- **Verification**: ✅ CONFIRMED (manual WebFetch Session 3)
- **Direct quotes**:
  - _"Aikido uses best-in-class LLMs (Claude Sonnet) through Amazon AWS Bedrock."_
  - _"Get confidence levels of each LLM-based fix"_
- **Strategic implication for SENTINEL**:
  - Aikido and SENTINEL **share the same LLM backbone** (Claude Sonnet) — quality differences will come from prompts/context/orchestration, not from the model.
  - **Aikido has per-fix confidence scoring** — SENTINEL has per-finding confidence in the Triage Agent verdict but NOT per-Remediation-Agent suggestion. **Gap to close**: emit confidence per fix proposal.
  - Aikido uses Bedrock (AWS), SENTINEL uses direct Anthropic API (BYOK) — SENTINEL has **lower vendor lock-in** (4 providers vs 1 cloud) but Aikido has **enterprise-friendly billing**.

### 1.2 ✅ Aikido AutoFix supports 16 languages

**Claim**: _"Aikido AutoFix supports 16+ programming languages (JavaScript, TypeScript, PHP, .NET, Java, Scala, C++, Swift, Android, Kotlin, Dart, Go, Ruby, Python, Elixir, Rust)."_

- **Source**: <https://www.aikido.dev/features/ai-sast-iac-autofix>
- **Verification**: ✅ CONFIRMED (all 16 languages with individual logo icons)
- **Strategic implication**:
  - **SENTINEL via OpenGrep already scans these languages** (OpenGrep inherits Semgrep's rule coverage ~30 langs). The gap is NOT scanning coverage — it's **fix-generation quality per language**.
  - Aikido likely has **language-tuned LLM prompts**; SENTINEL's Remediation Agent is currently **language-agnostic**.
  - **Concrete recommendation**: build per-language system prompts for the Remediation Agent (Effort: medium; Impact: high; License: N/A — internal change).

### 1.3 ✅ Aikido free tier (no credit card) + VSCode inline 1-click

**Claim**: _"Aikido offers a free tier with no credit card required and provides a VSCode integration giving inline 1-click suggestions as code is written."_

- **Source**: <https://www.aikido.dev/features/ai-sast-iac-autofix>
- **Verification**: ✅ CONFIRMED
- **Direct quotes**:
  - _"Start for Free · No CC required"_
  - _"AutoFix directly in your IDE. Aikido IDE AutoFixes code in real time. Fix issues with 1-click suggestions as your code is written"_
- **Strategic implication**: **this is the direct UX moat threat to SENTINEL**.
  - Aikido provides **zero-friction onboarding** (no CC, free tier, install plugin → immediate suggestions) — competitive parity required.
  - SENTINEL's **BYOK requires the user to obtain an API key** before any LLM-backed feature works. This is friction Aikido doesn't have.
  - **Concrete recommendation**: implement an optional **trial-mode** where SENTINEL ships with a shared rate-limited Anthropic key for first scan only, then prompts BYOK for sustained use (Effort: medium; legal/cost considerations; Impact: HIGH for newcomer adoption).
  - SENTINEL's **counter-moat** is privacy (BYOK = your tokens, your data, no Aikido seeing your code). This needs to be in the marketing.

### 1.4 ✅ Endor Labs targets architectural/design-flaw detection, NOT rule-based SAST

**Claim**: _"Endor Labs' AI Security Code Review targets architectural/design-flaw detection across PRs rather than traditional rule-based SAST vulnerability scanning, positioning it as complementary to (not a replacement for) SAST and SCA."_

- **Source**: <https://www.endorlabs.com/learn/introducing-ai-security-code-review>
- **Verification**: ✅ CONFIRMED
- **Direct quotes**:
  - _"it uses multiple AI agents to review pull requests for design flaws and architectural changes that affect your security posture"_
  - _"Most application security tools are built around rules and signatures... Both are important — but they operate at the level of isolated files or functions"_
  - _"This layered reasoning moves beyond pattern-matching or keyword rules. It evaluates changes in the context of your application"_
- **Strategic implication**:
  - Endor is **NOT a direct SAST competitor** — it's complementary, targeting a different (higher) level of code review (architecture/design).
  - **SENTINEL has a clear niche here**: "IDE-native architectural review for indie devs" — Endor is GitHub App + enterprise-priced. SENTINEL could expand the Brain Layer with an "Architecture Agent" that reads diffs and flags design-level concerns (e.g. new endpoint without auth middleware, untested CORS expansion, etc.).
  - **Concrete recommendation**: Architecture Agent as a new Brain Layer agent (DG-future, Large effort).

### 1.5 ✅ Endor Labs delivered via GitHub App, NO IDE-native integration

**Claim**: _"The feature is delivered via a GitHub App with PR-level Security Review sections and integrates with SCM tools and ticketing systems like Jira — there is no IDE-native integration mentioned, leaving an IDE-first niche open for SENTINEL."_

- **Source**: <https://www.endorlabs.com/learn/introducing-ai-security-code-review>
- **Verification**: ✅ CONFIRMED
- **Direct quotes**:
  - _"It's easy to deploy and roll out AI Security Code Review using the Endor Labs GitHub App"_
  - _"Insights from AI Security Code Review will appear in a dedicated **Security Review** section within each project"_
  - _"works with your existing source code management (SCM) tools and project management systems... creating tickets for the appropriate stakeholders"_
- **WebFetch finding**: NO mention of IDE-native integration for this specific feature on the page.
- **Strategic implication**: **confirms IDE-native niche is open** in the AI-driven architectural review segment. SENTINEL can defensibly claim "the only IDE-native LLM-driven architectural review for indie devs + small teams". **High differentiation value if built**.

### 1.6 ✅ Snyk Agent Fix uses agentic architecture + 35,000+ expert fixes DB

**Claim**: _"Snyk's automatic fix (formerly DeepCode AI Fix, renamed Snyk Agent Fix) uses an agentic architecture combining Snyk-proprietary security intelligence with LLMs and dynamic few-shot prompting drawn from a database of 35,000+ expert-written fixes."_

- **Source**: <https://snyk.io/blog/snyk-agent-fix-agentic-architecture/> (confirmed via WebSearch — the URL originally cited returned 404)
- **Verification**: ✅ CONFIRMED via WebSearch (multiple Snyk + 3rd-party sources)
- **Direct quote from search consolidation**: _"The new agentic architecture moved away from static fine-tuning to dynamic few-shot prompting, a system that can provide models with the most relevant security guidance in real time. Snyk maintains a database of over 35,000 real-world vulnerabilities from open source projects and fixes written by Snyk security experts, and during prediction, the prompt is injected with the most relevant, real-world examples of how that specific CWE was previously resolved."_
- **Strategic implication**:
  - **Snyk's 35,000+ expert fixes DB is an unbeatable proprietary moat** for SENTINEL. Do NOT try to compete on dataset scale.
  - **The dynamic few-shot pattern is replicable in principle** (no patent on the approach), but the value is the curated dataset.
  - **SENTINEL counter-strategy**: emit confidence in each Remediation suggestion + explicitly say "this is an LLM suggestion, validate before committing". Honest signaling beats fake authority.
  - **OPPORTUNITY**: SENTINEL could **crowdsource a community fixes DB** as an Apache-2.0 open dataset — users contribute their accepted/rejected fix outcomes back. Could become an OSS counter-asset to Snyk's proprietary DB over time. Long-term effort but high differentiation.

### 1.7 ✅ SAST-Genius achieved 91% FP reduction over Semgrep alone

**Claim**: _"An LLM-driven hybrid SAST framework (SAST-Genius) layered on top of Semgrep achieved approximately 91% false-positive reduction (from 225 alerts to 20) compared to Semgrep alone."_

- **Source**: <https://arxiv.org/abs/2509.15433> (canonical) / <https://arxiv.org/pdf/2509.15433>
- **Verification**: ✅ CONFIRMED via WebSearch (PDF compression made direct WebFetch unreadable, but multiple secondary sources cite the figure)
- **Direct quote**: _"SAST-Genius reduced false positives by about 91% (225 to 20) compared to Semgrep alone."_
- **Strategic implication**: **architecturally validates SENTINEL's core thesis**. The scout-OSS + LLM-brain pattern produces measurable, substantial FP reduction in peer-reviewed-track research. **SENTINEL is on the right path**.
- **Calibration**: 91% is in line with the 94-98% from claim #1.9 (LLM4PFA paper). Higher-fidelity LLM4PFA approach (eCPG-based) is the upper bound; SENTINEL's snippet-based approach is closer to SAST-Genius's range. **Realistic target: 85-95% FP reduction**.

### 1.8 ✅ Validated architectural pattern: LLM contextual triage + SAST systematic scanning

**Claim**: _"The validated architectural pattern is a hybrid: LLMs handle code analysis/pattern recognition and contextual triage, while the SAST tool (Semgrep here) handles systematic scanning — the same scout-plus-brain split SENTINEL implements with OpenGrep + Triage Agent."_

- **Source**: <https://arxiv.org/abs/2509.15433>
- **Verification**: ✅ CONFIRMED (search snippet)
- **Direct quote**: _"Traditional SAST tools, while effective for proactive security, are limited by high false-positive rates and a lack of contextual understanding. Conversely, LLMs excel at code analysis and pattern recognition but can be prone to inconsistencies and hallucinations. By integrating these two technologies, a more intelligent and efficient system is created."_
- **Strategic implication**: explicit research validation of SENTINEL's architectural choice. **Use in marketing/positioning**.

### 1.9 ✅ Hybrid LLM + static analysis: 94-98% FP elimination, 0.93-0.94 accuracy across LLMs

**Claim**: _"Hybrid LLM + static analysis approaches can eliminate 94-98% of false positives while maintaining high recall, with best-performing method (LLM4PFA) achieving 0.93-0.94 accuracy across multiple LLM backbones."_

- **Source**: <https://arxiv.org/html/2601.18844v1>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quotes**:
  - _"hybrid techniques of LLM and static analysis eliminate 94-98% of false positives with high recall"_
  - _"LLM4PFA...achieves the best effectiveness, successfully eliminating 94-98% of false positives"_
  - _"LLM4SA and LLM4PFA...achieving the highest accuracy of 0.93-0.94"_
  - Table 2 shows accuracy across models: GPT-4o, Claude-Opus-4, Qwen-3-Coder, DeepSeek-R1
- **Strategic implication**: **upper-bound benchmark target for SENTINEL**. 94-98% FP elimination is achievable with current LLMs (closed + open source). SENTINEL should target this range.

### 1.10 ✅ LLM4FPM eCPG: F1 > 99% on Juliet, 86% on D2A

**Claim**: _"An extended Code Property Graph (eCPG) plus file-reference-graph slicing (the LLM4FPM approach) achieves F1 > 99% on the Juliet test suite and improves label accuracy on D2A to 86%."_

- **Source**: <https://arxiv.org/pdf/2411.03079>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quote**: _"our approach achieves an F1-score of 99.3% on the Juliet test suite and improves the label accuracy on D2A to 86%"_
- **Strategic implication**:
  - **eCPG-based approach is the highest-quality architecture identified** — but it's a **Large engineering effort** for SENTINEL (CPG construction, file-reference graph, slicing). Currently NOT justified by the empirical evidence vs the simpler snippet approach.
  - **Decision deferred**: revisit if SENTINEL's empirical FP rate plateaus below 85%.

### 1.11 ✅ Few-shot learning beats Chain-of-Thought for FP triage

**Claim**: _"Few-shot learning with representative TP/FP examples consistently outperforms Chain-of-Thought prompting for FP triage; CoT was the weakest of three strategies, sometimes underperforming basic prompts."_

- **Source**: <https://arxiv.org/html/2601.18844v1>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quotes**:
  - _"Among prompting strategies, Chain-of-Thought (CoT) delivers the weakest performance"_
  - _"few-shot enhanced prompting consistently yields the best results among the three prompt strategies"_
  - _"advanced LLMs have already internalized reasoning capabilities...explicitly enforcing CoT prompts can paradoxically degrade performance"_
- **Strategic implication for SENTINEL**:
  - **SENTINEL's current Triage Agent uses CoT-style prompting** (rationale before classification) — DG-111.1 A explicitly puts rationale before classification.
  - **HIGHEST-IMPACT recommendation**: switch to few-shot prompting with curated TP/FP examples. Effort: medium (build dataset of 20-50 examples + rotate 3-5 in prompt). Impact: HIGH (per the paper, this consistently wins).
  - **Cross-reference with claim 1.14**: 3-shot CoT + Self-Consistency (different paper) still gets 62.5% — the key may be SELF-CONSISTENCY voting, not CoT vs few-shot. **Pragmatic combination**: few-shot prompt + 3-vote self-consistency.

### 1.12 ✅ Ensembling LLMs raises FP detection 62.5% → 78.9% (OWASP) AND 33.85% → 38.46% (real-world)

**Claim**: _"Ensembling multiple LLMs for false positive triage outperforms any single model, raising FP detection from ~62.5% to ~78.9% on OWASP Benchmark and from 33.85% to 38.46% on a real-world dataset."_

- **Source**: <https://arxiv.org/html/2506.16899v1>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quotes**:
  - _"Combining the respective TN sets of our three best-performing LLMs results in the detection of 102 out of 128 FPs in the dataset, which corresponds to approximately 78.9%"_ (OWASP)
  - _"This ensemble detects 25 FPs, representing an overall detection rate of 38.46% across all FPs"_ (real-world)
  - _"GPT-4o-detecting 80 out of 128 FPs-results in a TN proportion of 62.5%"_ (single model baseline)
- **Strategic implication**:
  - **Ensembling gains are real but modest on real-world data** (4.6 percentage points: 33.85% → 38.46%). On synthetic OWASP it's larger (16.4 pts).
  - For SENTINEL: ensembling means 2× the LLM cost. Real-world gain of ~4-5 points may not justify doubling cost.
  - **Conditional recommendation**: add OPTIONAL ensemble mode (e.g. "high-confidence mode" — runs 2 providers, votes). Default off. Effort: medium. Impact: medium for high-rigor users.

### 1.13 ✅ CWE-RAG does NOT measurably improve FP triage accuracy

**Claim**: _"Adding CWE-related contextual information via RAG did NOT measurably improve LLM false-positive triage accuracy, contradicting common assumptions that RAG over CWE corpora boosts security LLM performance."_

- **Source**: <https://arxiv.org/html/2506.16899v1>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quote**: _"Contrary to our initial assumptions, our analysis indicates that the most beneficial contextual information is those supplied directly by the SAST tool, and integrating additional (e.g., CWE-related) information did not produce measurable improvements."_
- **Strategic implication**: **AVOID-PATTERN**. SENTINEL should **NOT invest engineering effort in building CWE-RAG**. This saves significant work. The valuable context is the scout output itself — not external knowledge bases.

### 1.14 ✅ 3-shot CoT + Self-Consistency detects 62.5% FPs with 100% TP retained

**Claim**: _"LLM-based false positive triage using 3-shot Chain-of-Thought + Self-Consistency can detect approximately 62.5% of SAST false positives on the OWASP Benchmark while maintaining a 100% true positive rate (no genuine vulnerabilities missed), with best single models being GPT-4o and Qwen2.5-32B."_

- **Source**: <https://arxiv.org/html/2506.16899v1>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quotes**:
  - _"GPT-4o, yielding a TN count of 80 (62.5% detected FPs) with zero FNs."_
  - _"The TPR remains at 100%, and both Precision and weighted F₂-score exhibit robust performance"_
  - _"our best-performing LLMs (GPT-4o and Qwen2.5-32B-Instruct) conservatively identified 62.5% of all removable findings"_
- **Strategic implication**:
  - **100% TP rate maintained** = no real bugs missed. This is the right safety property for security tooling.
  - 62.5% FP detection means **3 in 8 FPs auto-suppressed safely**. The other 5 are flagged as needing user review.
  - Self-Consistency (voting from multiple sampled completions) is a **low-cost technique** to add — same model, multiple samples. SENTINEL's Triage Agent could implement this with temperature > 0 + 3-5 samples + majority vote.
  - **Recommendation**: add Self-Consistency to Triage Agent (Effort: small; Impact: medium-high). Reconcile with claim 1.11 (few-shot beats CoT): the paper here uses CoT + Self-Consistency; the LLM4PFA paper used few-shot. **Combine both**: few-shot prompting + self-consistency voting = likely best of both.

### 1.15 ✅ Backbone LLM matters more than agent framework; DeepSeek vanilla beats DeepSeek+agent

**Claim**: _"Backbone LLM choice matters more than agent framework choice for FP filtering quality — agentic reasoning amplifies strong models but cannot rescue weaker ones; for DeepSeek Chat, vanilla prompting (11.2% FPR) outperformed agent frameworks."_

- **Source**: <https://arxiv.org/html/2601.22952v1>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quotes**:
  - _"Lesson 2: The value of agentic reasoning depends more on the backbone model than on the agent framework."_
  - _"for DeepSeek Chat, vanilla prompting already achieves a low remaining FPR (11.2%), and adding agentic scaffolding provides no consistent benefit"_
  - _"Agentic reasoning amplifies the strengths of capable backbone models but does not compensate for weaker ones; backbone selection is a more critical decision than agent framework choice."_
  - From Table 4: DeepSeek Chat: _"Aider 13.2%... SWE-agent 13.1%... Vanilla LLM 11.2%"_
- **Strategic implication**:
  - **Validates SENTINEL's current architecture**: simple single-prompt agents (not agentic frameworks like SWE-agent). SENTINEL is not "behind" by avoiding complexity.
  - **Choose backbone carefully** — investing in better prompt design for current models beats wrapping them in agent frameworks.
  - **Recommendation**: do NOT pursue agentic frameworks (Effort saved: large). Continue investing in prompt + context quality.

### 1.16 ✅ Open-source LLMs comparable to closed-source for FP triage

**Claim**: _"Closed-source (GPT-4o, Claude-Opus-4) and open-source (Qwen-3-Coder, DeepSeek-R1) LLMs all demonstrate comparable effectiveness for FP triage, supporting BYOK strategy with open-source providers like Ollama/DeepSeek."_

- **Source**: <https://arxiv.org/html/2601.18844v1>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quotes**:
  - _"the four state-of-the-art LLMs exhibit comparable levels of effectiveness"_
  - _"LLM4PFA exhibits strong generalization across all models, achieving accuracy above 0.93 in every case"_
  - _"all backbone LLMs achieving accuracy rates above 0.86"_ (for LLM4SA/LLM4PFA methods)
- **Strategic implication**: **directly validates SENTINEL's BYOK + multi-provider strategy**. Ollama and DeepSeek are effective alternatives to closed-source — users can run SENTINEL fully local (Ollama) without quality compromise. **Privacy story is strong**.

### 1.17 ✅ Per-warning cost ~$0.384, ~4.7s latency with lightweight open-source LLM

**Claim**: _"A lightweight open-source LLM combined with precise code-context slicing can triage SAST warnings at ~$0.384 per warning and ~4.7s per warning."_

- **Source**: <https://arxiv.org/pdf/2411.03079>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quote**: _"triage SAST warnings at approximately $0.384 per warning and approximately 4.7 seconds per warning using a lightweight open-source LLM"_
- **Strategic implication**:
  - **Cost economics calibration**: 38¢ per warning is the academic benchmark. SENTINEL's empirical observation (Cycle 109) was ~$0.0034 for 4 calls = ~$0.0008 per call, but most findings were colony-memory-cached. Fresh-scan triage cost projection: **~$0.05-$0.40 per finding depending on model**.
  - SENTINEL's BYOK with Haiku/DeepSeek targets the lower end of this range.
  - **4.7 second latency** is consistent with SENTINEL's observed average (~2.7s per call to Sonnet). Acceptable for batch triage; **NOT acceptable for inline real-time UX** (Aikido's "1-click as code is written" implies sub-1s — different category).

### 1.18 ✅ Real-world MCC 0.148 for best LLM SAST triage (2737-sample benchmark)

**Claim**: _"On a real-world SAST triage benchmark with 2737 samples (299 TP, 2438 FP, 8.15:1 imbalance), the best LLM agent (Gemini 2.5 Pro with Improved ReAct) achieved only MCC 0.148, with Precision 0.169 and Recall 0.582."_

- **Source**: <https://arxiv.org/html/2601.02941v1>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quote**: _"Gemini 2.5 Pro | Improved ReAct | 0.641 | 0.169 | 0.582 | 0.262 | 0.197 | 0.148"_ (Table values: accuracy, precision, recall, F1, F2, MCC)
- **Strategic implication — honest reality check**:
  - **Synthetic benchmarks (OWASP, Juliet) overstate LLM SAST triage quality**.
  - On REAL-WORLD imbalanced data (8.15:1 FP:TP), best published LLM agent gets MCC 0.148 — **modestly better than random**.
  - SENTINEL's empirical performance is on N=2 workspaces — cannot make broader claims yet.
  - **Anti-optimism for marketing**: do NOT claim "99% FP reduction" — that's synthetic-benchmark territory. Realistic claim: "30-70% FP reduction on typical codebases, with explicit confidence + human review for edge cases".

### 1.19 ✅ LLM FP filtering degrades on policy/cryptography CWEs

**Claim**: _"LLM-based FP filtering is highly effective for data-flow-driven vulnerabilities but degrades sharply for policy- and cryptography-related CWEs."_

- **Source**: <https://arxiv.org/html/2601.22952v1>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quotes**:
  - _"LLM-based agents are highly effective FP filters for data-flow-driven vulnerabilities, but their effectiveness drops sharply for policy- and cryptography-related weaknesses"_
  - _"miss rates are negligible for injection-style vulnerabilities but exceed 50% for cryptography- and policy-related categories such as CWE-327, CWE-328, CWE-501, and CWE-614"_
  - _"LLM-based agents are unsuitable for unconditional, automatic suppression of SAST warnings; they should instead be deployed as decision-support tools"_
- **Strategic implication for SENTINEL**:
  - **Implement per-CWE confidence floor**: never auto-suppress findings in CWE-327 (broken crypto), CWE-328 (weak hash), CWE-501 (trust boundary violation), CWE-614 (cookie security). Surface as `inconclusive` with explicit "LLM cannot reliably triage crypto/policy issues — needs human review" rationale.
  - **CONCRETE recommendation**: hardcode list of "human-review-required" CWE categories in Triage Agent; override LLM verdict to `inconclusive` regardless of confidence. Effort: small. Impact: high (avoids dangerous false-FP suppression).

### 1.20 ✅ Two documented failure modes for LLM FPM: cluttered snippets + missing context

**Claim**: _"LLM-based false positive mitigation (FPM) for SAST has two well-documented failure modes: (1) warning-related code snippets being too broad/cluttered with irrelevant control/data flows reducing precision, and (2) missing critical code contexts leading to incomplete representations that mislead LLMs."_

- **Source**: <https://arxiv.org/pdf/2411.03079>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quote**: _"code snippets being too broad or cluttered with irrelevant control and data flow information"_ and _"missing critical code contexts leading to incomplete program representations"_
- **Strategic implication for SENTINEL**:
  - SENTINEL passes the scout's snippet directly to the Triage Agent — **vulnerable to both failure modes**.
  - **Failure mode 1 (cluttered)**: scout sometimes emits multi-line context that includes unrelated branches. SENTINEL could trim more aggressively.
  - **Failure mode 2 (missing context)**: when the sink is `agentLoop.execute()` defined in another file, SENTINEL's `dataflowTrace` shows the call but not the implementation — this is a known limitation (documented in CHANGELOG as "inconclusive-well-reasoned by design").
  - **Recommendation**: add Context Agent enhancement to fetch caller+callee function bodies when the sink is named but not implementing-visible (Effort: medium; depends on AST parsing). Without it, accept the `inconclusive` ceiling.

### 1.21 ✅ Semgrep CE is architecturally intraprocedural-only

**Claim**: _"Semgrep Community Edition is architecturally limited to intraprocedural analysis — it can only analyze interactions within a single function, and cannot do cross-function or cross-file taint propagation."_

- **Source**: <https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quotes**:
  - _"By design, Semgrep open source software, Semgrep Community Edition (CE) can only analyze interactions within a single function, also known as **intraprocedural analysis**."_
  - _"Semgrep Code runs **cross-function (interprocedural)** analysis by default, and gives security teams the option to trade off speed for better results and deeper analysis with **cross-file analysis**."_
  - _"Cross-file analysis runs on full scans. These scans may take longer to complete and can use more memory than Semgrep CE scans."_
- **Strategic implication for SENTINEL — ARCHITECTURAL LIMIT**:
  - **SENTINEL INHERITS THIS LIMIT** via OpenGrep (Semgrep CE fork).
  - SENTINEL **cannot do cross-file taint propagation** without changing scanners.
  - For cross-file taint, alternatives are:
    - CodeQL (engine is MIT but the rule database is GitHub-controlled / paid tier for some uses — license concerns)
    - Joern (Apache-2.0; CPG-based; would require integration effort)
    - Snyk Code (proprietary — not OSS-compatible)
  - **Decision documented**: SENTINEL's positioning explicitly does NOT promise cross-file taint analysis. Compete elsewhere (LLM FP triage, IDE-native, BYOK). Use the limit honestly in marketing: _"For cross-file taint, use CodeQL or Joern. SENTINEL specializes in fast, IDE-native, intraprocedural detection with smart LLM triage."_

> ⚠️ **CRITICAL UPDATE (Session 4 — Gap #11 research)**: this strategic implication needs partial revision. **OpenGrep restored cross-function (interprocedural) taint tracking across 12 languages** that Semgrep moved to Pro Engine in January 2025. See Section 10.11 for details. **SENTINEL via OpenGrep has cross-function taint** for those 12 languages — only cross-FILE remains a hard limit. Marketing claim should be: _"SENTINEL specializes in fast, IDE-native detection with cross-function taint (via OpenGrep) and smart LLM triage. For deeper cross-file taint, use CodeQL or Joern."_

### 1.22 ✅ Domain-specific prompt engineering provides large gains over naive ReAct

**Claim**: _"Domain-specific prompt engineering provides large gains over naive ReAct prompts for LLM SAST triage, with both Claude and Gemini significantly outperforming their Simple ReAct counterparts when given improved prompts."_

- **Source**: <https://arxiv.org/html/2601.02941v1>
- **Verification**: ✅ CONFIRMED (manual WebFetch)
- **Direct quotes**:
  - _"We see that both Claude and Gemini with improved prompts are much better than their Simple ReAct counterparts."_
  - _"Gemini improves in precision, while Claude improves in terms of recall."_
  - _"Improved Prompt Agent: A prompt designed with domain expertise for the ReAct agent"_ vs _"Simple ReAct Agent: We use a ReAct loop...with no optimizations."_
- **Strategic implication**:
  - **Validates SENTINEL's investment in prompt engineering** (DG-111 A 3-layer defense, DG-118 A TP/risk split). These are the right direction.
  - **Continued investment recommendation**: per-category prompt templates (SAST taint vs SAST pattern vs SCA vs Secrets vs IaC vs VibeCoded) — each has different reasoning structure.

### 1.23 ✅ Corgea covers Python/Go/JS/TS/Ruby/C#/C/C++/Java/PHP/Kotlin (free tier)

**Claim**: _"Corgea is positioned as a free-tier SAST tool covering Python, Go, JS, TS, Ruby, C#, C, C++, Java, PHP, and Kotlin."_

- **Source**: <https://owasp.org/www-community/Free_for_Open_Source_Application_Security_Tools>
- **Verification**: ✅ CONFIRMED (3-0 vote in original workflow)
- **Direct quote**: _"Corgea | SAST | Python, Go, JS, TS, Ruby, C#, C, C++, Java, PHP, Kotlin | Free tier | corgea.com"_
- **Strategic implication**: Corgea is a direct LLM-assisted SAST competitor with free tier. Kotlin coverage matches SENTINEL's OpenGrep coverage. **Not a fundamental gap**.

---

## 2. MIXED findings (evidence ambiguous)

### 2.1 ⚠️ Claude Sonnet 4 + SWE-agent: 6.3% FPR on OWASP Benchmark v1.2

**Claim**: _"Claude Sonnet 4 paired with the SWE-agent framework achieved a 6.3% false positive rate on the OWASP Benchmark v1.2, representing a 92.1% reduction in FPR compared to baseline SAST union (which flagged 98.3% of non-vulnerable cases)."_

- **Source**: <https://arxiv.org/html/2601.22952v1>
- **Verification**: ⚠️ MIXED (1-1 vote in workflow; manual review of source on Session 3 confirms the figures exist in the paper but interpretation in real-world is contested per claim 1.18)
- **Strategic implication**: **OWASP Benchmark v1.2 is synthetic**; real-world MCC 0.148 (claim 1.18) is the more relevant figure for SENTINEL marketing. Use the 92.1% as **directional evidence the approach works**, not as a performance target.

---

## 3. REFUTED findings (rejected by adversarial verification)

### 3.1 ❌ OWASP curated list "structural differentiation" interpretation

**Claim**: _"OWASP's curated list shows that the free-OSS app-security tool space is highly fragmented across at least 9 distinct categories... implying SENTINEL's all-in-one orchestration is structurally differentiated from single-category tools."_

- **Source**: <https://owasp.org/www-community/Free_for_Open_Source_Application_Security_Tools>
- **Verification**: ❌ REFUTED 0-3 (all 3 adversarial verifiers refuted)
- **Refutation reasoning** (inferred): the categorization may exist but the _implication_ "structurally differentiated" is overreach — other tools also orchestrate multiple categories (Aikido, Snyk).
- **Strategic implication**: **do NOT claim "structural differentiation" via multi-category orchestration**. It's not a defensible moat. Differentiation has to come from elsewhere (LLM FP quality, BYOK + local execution, anti-temporal-cutoff defense, override directives for nested-pinned SCA).

### 3.2 ❌→✅ Arnica Rust/Scala/Swift coverage claim — REFUTATION CORRECTED (Session 4)

**Claim**: _"Arnica's free-tier SAST/SCA/IaC explicitly covers Rust, Scala, and Swift in addition to mainstream languages."_

- **Source (original)**: <https://owasp.org/www-community/Free_for_Open_Source_Application_Security_Tools>
- **Source (re-verification, Session 4)**: <https://docs.arnica.io/arnica-documentation/code-risks/code-risk-language-and-framework-support>
- **Initial verification**: ❌ REFUTED 0-3 (Session 2 workflow)
- **Session 4 re-verification**: ✅ **CORRECTED — actually TRUE** (per Arnica official docs)
- **Direct findings from Arnica docs (verified Session 4)**:
  - **Rust**: listed as supported for SAST in **Beta** status
  - **Scala**: listed as supported for SAST in **GA** (General Availability) status, with same support as Java
  - **Swift**: listed as supported for SAST in **Experimental / Beta** status
- **Why the original workflow refuted incorrectly**: the OWASP curated list source did NOT contain the language detail; the verifiers correctly refuted the OWASP-derived claim but the underlying assertion about Arnica was true (just sourced from the wrong page).
- **Strategic implication (CORRECTED)**:
  - **Arnica IS a verified benchmark for Rust/Scala/Swift coverage in the free-tier SAST segment**.
  - **Arnica uses OpenGrep as its SAST backend** (per their docs) — same engine SENTINEL uses → **SENTINEL's language coverage gap is NOT in scanning capability** (OpenGrep covers Rust/Scala/Swift) but in **Brain Layer prompt tuning per language**.
  - **See Section 10.12 for full Arnica re-verification details**.

**Lesson learned for future research**: cross-reference vendor-specific claims with the **vendor's own official docs**, not aggregated lists. The OWASP list is good for discovery but not for granular feature claims.

---

## 4. Source catalog (24 sources from research run)

### 4.1 Primary academic (peer-reviewed-track arXiv papers) — 6 sources

| URL                                          | Type                                               | Claims verified        | Quality |
| -------------------------------------------- | -------------------------------------------------- | ---------------------- | ------- |
| <https://arxiv.org/html/2601.22952v1>        | LLM FP filtering benchmarks (Lessons 1-3)          | 1.15, 1.19 ✅ + 2.1 ⚠️ | primary |
| <https://arxiv.org/html/2601.02941v1>        | LLM SAST triage 2737-sample real-world benchmark   | 1.18, 1.22 ✅          | primary |
| <https://arxiv.org/abs/2509.15433> (and PDF) | SAST-Genius hybrid framework                       | 1.7, 1.8 ✅            | primary |
| <https://arxiv.org/html/2601.18844v1>        | Hybrid LLM4PFA/LLM4SA — industrial empirical study | 1.9, 1.11, 1.16 ✅     | primary |
| <https://arxiv.org/pdf/2411.03079>           | LLM4FPM eCPG approach                              | 1.10, 1.17, 1.20 ✅    | primary |
| <https://arxiv.org/html/2506.16899v1>        | 3-shot CoT + Self-Consistency + Ensembling         | 1.12, 1.13, 1.14 ✅    | primary |

### 4.2 Primary vendor/standards official — 6 sources

| URL                                                                                    | Type                         | Claims verified       | Quality                           |
| -------------------------------------------------------------------------------------- | ---------------------------- | --------------------- | --------------------------------- |
| <https://owasp.org/www-community/Free_for_Open_Source_Application_Security_Tools>      | OWASP curated list           | 1.23 ✅ + 3.1, 3.2 ❌ | primary (community-vetted)        |
| <https://www.endorlabs.com/learn/introducing-ai-security-code-review>                  | Endor Labs feature docs      | 1.4, 1.5 ✅           | primary (vendor self-description) |
| <https://www.aikido.dev/features/ai-sast-iac-autofix>                                  | Aikido AutoFix vendor docs   | 1.1, 1.2, 1.3 ✅      | primary (vendor self-description) |
| <https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro>                       | Semgrep official docs        | 1.21 ✅               | primary (vendor docs)             |
| <https://snyk.io/blog/snyk-agent-fix-agentic-architecture/>                            | Snyk Agent Fix blog post     | 1.6 ✅ (via search)   | primary (vendor self-description) |
| <https://snyk.io/blog/ai-trust-in-action-how-snyk-agent-redefines-secure-development/> | Snyk Agent Fix trust pillars | 1.6 ✅ supporting     | primary (vendor self-description) |

### 4.3 Secondary industry / blogs / other (used for cross-check, not primary claims)

- <https://snyk.io/articles/sast-dast-iast-rasp/> — Snyk industry article (4 claims, secondary quality)
- <https://www.mend.io/blog/how-does-slsa-help-strengthen-software-supply-chain-security/> — Mend industry blog (5 claims, secondary)
- <https://www.aikido.dev/blog/top-code-vulnerability-scanners> — Aikido blog
- <https://rafter.so/blog/vulnerability-scanning-tools-comparison>
- <https://rafter.so/blog/static-code-analysis-tools-comparison>
- <https://www.aikido.dev/blog/semgrep-alternatives>
- <https://joshua.hu/retrospective-zeropath-ai-sast-source-code-security-scanners-vulnerability>
- <https://zeropath.com/blog/toward-actual-benchmarks>
- <https://corgea.com/learn/best-sast-tools>
- <https://snyk.io/blog/ai-code-security-snyk-autofix-deepcode-ai/>
- <https://snyk.io/blog/building-ai-trust-with-snyk-code-and-snyk-agent-fix/>
- <https://semgrep.dev/docs/semgrep-code/semgrep-pro-engine-intro> (canonical redirect to docs.semgrep.dev)
- <https://dev.to/rahulxsingh/semgrep-vs-codeql-lightweight-patterns-vs-semantic-analysis-for-sast-2026-412k>
- <https://www.contrastsecurity.com/glossary/interactive-application-security-testing>

**Filtered as unreliable**: <https://sanj.dev/post/ai-code-security-tools-comparison/>

---

## 5. Strategic synthesis — what the verified findings tell SENTINEL

### 5.1 What SENTINEL is doing RIGHT (validated by research)

1. **Scout-OSS + LLM-Brain architectural pattern** — validated by claims 1.7, 1.8, 1.9, 1.16 (SAST-Genius 91% FP reduction; LLM4PFA 94-98% with comparable closed/open-source LLMs). SENTINEL is on the right path.
2. **Simple agents over agentic frameworks** — validated by claim 1.15 (backbone > framework; DeepSeek vanilla beats DeepSeek+agent). SENTINEL's simple Triage/Context/Remediation agents are right-sized.
3. **BYOK + multi-provider** — validated by claim 1.16 (open-source LLMs comparable to closed; Ollama/DeepSeek viable). Privacy moat is real and defensible.
4. **TP/risk split (DG-118 A)** — validated by domain reasoning: confidence is LLM self-assessment (poorly calibrated), priority is action urgency. Separation reduces confusion.
5. **Override directives for nested-pinned SCA (DG-115 A)** — not mentioned in any researched competitor. Genuine differentiator.
6. **Anti-temporal-cutoff defense (DG-111 A)** — not mentioned in any researched competitor. Genuine differentiator worth a blog post.

### 5.2 What SENTINEL should ADOPT (validated improvements)

| #   | Recommendation                                                                                                                      | Source claim | Effort              | Impact                | Priority |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------- | --------------------- | -------- |
| R1  | **Few-shot prompting** (replace/augment current CoT) with curated TP/FP examples per category                                       | 1.11         | Medium              | High                  | P0       |
| R2  | **Self-Consistency voting** (3-5 samples + majority vote, temp > 0) — combine with few-shot                                         | 1.14         | Small               | Medium-High           | P0       |
| R3  | **Per-CWE confidence floor** — never auto-suppress in crypto/policy categories (CWE-327, 328, 501, 614, etc.); force `inconclusive` | 1.19         | Small               | High (safety)         | P0       |
| R4  | **Per-language prompts** (system prompt variants for JS/TS, Python, Go, Rust, etc.)                                                 | 1.2, 1.22    | Medium              | High                  | P1       |
| R5  | **Confidence-per-fix** in Remediation Agent (not just Triage) — parity with Aikido                                                  | 1.1          | Small               | Medium                | P1       |
| R6  | **Architecture Agent** — design-level review of diffs (auth/CORS/data-flow concerns)                                                | 1.4, 1.5     | Large               | High (differentiator) | P2       |
| R7  | **Optional trial-mode** (shared rate-limited key for first scan) to reduce BYOK onboarding friction                                 | 1.3          | Medium (legal+cost) | High (adoption)       | P1       |
| R8  | **Snippet trim/expand based on failure-mode 1/2 detection**                                                                         | 1.20         | Medium              | Medium                | P2       |
| R9  | **Optional ensemble mode** (2-provider voting for high-rigor mode)                                                                  | 1.12         | Medium              | Medium                | P2       |
| R10 | **Community fixes DB** (Apache-2.0 dataset of accepted/rejected fix outcomes) — long-term moat vs Snyk                              | 1.6          | Large               | High (moat)           | P3       |

### 5.3 What SENTINEL should NOT pursue (validated avoidance)

| #   | Anti-recommendation                               | Source claim | Why avoid                                                                                                                                                                                                                              |
| --- | ------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **CWE-RAG corpus injection**                      | 1.13         | Empirically no measurable accuracy gain. Save engineering effort.                                                                                                                                                                      |
| A2  | **Agentic frameworks** (SWE-agent style)          | 1.15         | Backbone choice > framework; complex agents don't rescue weak models, don't materially help strong ones.                                                                                                                               |
| A3  | **Cross-file taint analysis** as built-in feature | 1.21         | Semgrep CE architectural limit. Would require swapping scanners (CodeQL = license concerns; Joern = large integration). Position honestly: "for cross-file taint, use CodeQL or Joern; SENTINEL is intraprocedural-fast + IDE-native." |
| A4  | **Compete on dataset scale**                      | 1.6          | Snyk's 35,000+ expert fixes DB is unbeatable. Differentiate on confidence + openness instead.                                                                                                                                          |
| A5  | **Claim "99% FP reduction"** in marketing         | 1.18         | Real-world MCC 0.148 — synthetic benchmark numbers do not transfer. Realistic claim: "30-70% FP reduction + explicit confidence + human review for edge cases."                                                                        |

### 5.4 Direct competitor landscape (summary, verified)

| Competitor                    | Position vs SENTINEL                                                                                                             | Verified status         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **Aikido AI AutoFix**         | DIRECT competitor — same Claude Sonnet, 16 languages, free tier no-CC, VSCode 1-click. Vendor-hosted vs SENTINEL self-host BYOK. | Claims 1.1, 1.2, 1.3 ✅ |
| **Snyk Agent Fix**            | DIFFERENT category — proprietary 35,000+ expert fixes DB. Compete on openness, not scale.                                        | Claim 1.6 ✅            |
| **Endor Labs AI Code Review** | DIFFERENT category — architectural review, GitHub App only (no IDE). NICHE OPEN for SENTINEL.                                    | Claims 1.4, 1.5 ✅      |
| **Corgea**                    | DIRECT competitor — free-tier LLM-assisted SAST, 11 languages incl. Kotlin. Cloud-hosted vs SENTINEL local.                      | Claim 1.23 ✅           |
| **Semgrep (CE + Pro)**        | UPSTREAM scanner. SENTINEL builds on OpenGrep (Semgrep CE fork). Inherits intraprocedural limit.                                 | Claim 1.21 ✅           |
| **Arnica**                    | UNVERIFIED — Rust/Scala/Swift coverage claim refuted. Need separate research pass.                                               | Refuted 3.2 ❌          |

---

## 6. Investigation log

### Session 1 — 2026-06-18 (initial deep-research workflow)

- **Workflow**: deep-research, Run ID `wf_4d58a20a-7bb`
- **Result**: 25/25 verifications rate-limited (Santiago session quota)
- **Outcome**: 0 confirmed, 0 refuted (all abstain due to rate limit)
- **Saved at**: `C:\Users\27983\AppData\Local\Temp\claude\d--GoLAB-PROYECTOS-SENTINEL\e6fe1728-1b4d-42e5-86b3-09aa384a9611\tasks\wiokonrbz.output`

### Session 2 — 2026-06-18 (deep-research workflow resumed)

- **Workflow**: deep-research, same Run ID (resumed with cached fetches)
- **Result**: 2 verified + 2 refuted + 21 still rate-limited
- **Confirmed in this session**: Corgea ✅ (3-0), Claude Sonnet 4 FPR ⚠️ (1-1)
- **Refuted in this session**: OWASP categorization ❌ (0-3), Arnica languages ❌ (0-3)
- **Saved at**: `C:\Users\27983\AppData\Local\Temp\claude\d--GoLAB-PROYECTOS-SENTINEL\e6fe1728-1b4d-42e5-86b3-09aa384a9611\tasks\wpr283ykn.output`

### Session 3 — 2026-06-18 (manual WebFetch verification — COMPLETE)

- **Approach**: WebFetch each cited source, extract verbatim quotes, verify per-claim.
- **Result**: **22/22 PENDING claims verified** (all CONFIRMED, no surprises).
- **Fetches performed**: 10 (Aikido docs, Endor docs, arXiv ×6, Snyk via WebSearch, Semgrep docs)
- **Time efficient**: 3 claims per source on average (batched by source URL).
- **Updates committed** to this document inline.

### Session 4 — 2026-06-18 (12 NOT RESEARCHED gaps investigated — COMPLETE)

- **Approach**: WebSearch per gap (12 searches), capture canonical sources, extract feature/pricing/positioning info.
- **Result**: **12/12 gaps investigated** + 1 critical correction (Arnica refutation was wrong) + 1 strategic update (OpenGrep restored cross-function taint that Semgrep CE lost).
- **Gaps documented** in new Section 10.1-10.12.
- **Key strategic findings**:
  - **OpenGrep is backed by 10+ AppSec consortium** (Aikido, Endor Labs, Jit, Orca Security) and **restored cross-function taint across 12 languages** that Semgrep moved to Pro Engine in Jan 2025.
  - **SENTINEL is using a multi-vendor-adopted, performance-tuned (3.15x faster than Semgrep) engine** with broader features than pure Semgrep CE.
  - **Arnica uses OpenGrep as backend** — confirms OpenGrep ecosystem adoption.
  - **Aikido pricing not in free-tier ASPM segment** (premium $50/dev/month for Jit.io; Akamai API Security $25K-100K+/year) — SENTINEL's free Apache-2.0 position is **defensible by license, not just price**.
- **Updates** to Sections 1.21 (cross-function taint correction) and 3.2 (Arnica refutation correction) cross-linked.

---

## 7. Outstanding research questions (next research session)

### 7.1 ✅ RESEARCHED (Session 4 — 12/12 gaps complete)

All 12 gaps from the original research scope have been investigated. Each is documented in detail in **Section 10**. Summary:

| #   | Gap                                        | Result                                                                                             | Section |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------- |
| 1   | Snyk VS Code extension current feature set | ✅ Researched — free tier, AI fixes, 40+ langs, supports Windsurf/Cursor/Eclipse Theia             | 10.1    |
| 2   | GitHub Advanced Security free-tier vs paid | ✅ Researched — public repos FREE (CodeQL + Copilot Autofix), private $30/committer/month          | 10.2    |
| 3   | JetBrains Qodana free tier                 | ✅ Researched — Community tier free, 60+ langs via JetBrains IDE engines, NOT LLM-chat-style       | 10.3    |
| 4   | SonarLint / SonarQube for IDE AI features  | ✅ Researched — free 40+ langs, AI CodeFix requires paid Cloud/Server Enterprise                   | 10.4    |
| 5   | DryRun Security positioning                | ✅ Researched — AI-native SAST, PR-level, 2x precision claim, NO IDE focus                         | 10.5    |
| 6   | NeoSec / Akamai API Security               | ✅ Researched — enterprise API security $25K-100K+/year, NOT SAST/IDE category                     | 10.6    |
| 7   | Jit.io free tier scope                     | ✅ Researched — ASPM platform $50/dev/month, free tier no-CC, AI agents SERA+COTA                  | 10.7    |
| 8   | ZeroPath benchmark approach                | ✅ Researched — AI-native SAST, 2x vulns + 75% fewer FPs claim, auto-PR                            | 10.8    |
| 9   | OSV-Scanner LLM integration                | ✅ Researched — pure vulnerability scanner, NO LLM, V2 has container scanning + guided remediation | 10.9    |
| 10  | Trufflehog Verifier mode                   | ✅ Researched — 700+ secret types with live API verification, AGPL-3.0 license concern             | 10.10   |
| 11  | Bandit / Brakeman / OpenGrep ecosystem     | ✅ Researched + **CRITICAL FINDING: OpenGrep restored cross-function taint across 12 langs**       | 10.11   |
| 12  | Arnica re-verification                     | ✅ Researched + **REFUTATION CORRECTED: Arnica DOES support Rust/Scala/Swift** (Beta/GA/Beta)      | 10.12   |

### 7.2 Deeper open questions (not addressable via web research alone)

1. **What's the FP/TP breakdown of SENTINEL's actual production scans?** Empirical N=2 (SENTINEL + SYNAPTIC_SAAS) is too small. Need community-data collection if the tool gets adoption.
2. **Does Claude Sonnet vs Haiku change FP triage quality measurably in SENTINEL's specific prompts?** Could be A/B tested via cost-history data + manual ground-truth marking.
3. **Is Vibe-Detect's heuristic ruleset measurably effective?** No external benchmark for "AI-generated code patterns" exists yet. **Could be SENTINEL's contribution to the community** — publish benchmark dataset of vibe-coded patterns + measured detection rates.
4. **Actual adoption telemetry**: GitHub release download counts for v0.3.4 → v0.3.16. Marketplace download history.
5. **License audit of OSS scanner dependencies**:
   - OpenGrep: forked from Semgrep CE (LGPL-2.1) — investigate fork license terms
   - Trufflehog: AGPL-3.0 — potential AGPL contamination issue for SENTINEL Apache-2.0. Does spawning + parsing output trigger AGPL? **Critical legal question to verify**.
   - Gitleaks: MIT ✓
   - Trivy: Apache-2.0 ✓
   - Checkov: Apache-2.0 ✓

---

## 8. Resumption instructions (for future Claude Code sessions)

If a session is interrupted (rate-limit, context window, manual pause), to resume:

1. **Read this document first** to recover state.
2. **Check Section 7.1 NOT RESEARCHED gaps** for the next investigation target.
3. **WebFetch the candidate's official documentation** + cross-reference with comparison blogs.
4. **Match findings against the strategic framework** in Section 5 (Right/Adopt/NOT-pursue).
5. **Update this document** with new entries in Sections 1, 2, or 3.
6. **Commit + push** after every research session.

**Reset clocks for rate limits**: deep-research workflow's verify phase has consistently hit rate limits (75 sub-agents in parallel). **Recommendation**: when resuming workflows, edit the script to verify only TOP-5 most critical claims, OR use manual WebFetch (single-shot per claim, 10× fewer agents). Manual WebFetch in Session 3 successfully verified 22 claims with zero rate-limit issues.

---

## 9. Action items for SENTINEL roadmap (from this research)

When you (the user) confirm the next Cycle, this document supports these candidate DGs (in priority order):

**Cycle 111 candidates** (any of these can be the next DG):

- **DG-119 A** — Few-shot prompting + Self-Consistency in Triage Agent (R1 + R2). High impact, medium effort.
- **DG-120.0.1** — Per-CWE confidence floor (R3). Small effort, safety-critical (prevents auto-suppression of crypto/policy issues).
- **DG-121 A** — Per-language prompts in Triage/Context/Remediation (R4). Medium effort, high impact for multi-language users.
- **DG-122 A** — Confidence-per-fix in Remediation Agent (R5). Small effort, parity with Aikido.
- **DG-117.1 A** — Mark-FP button in card (already backlog from Cycle 108).

**Strategic narrative** (for marketing / community building):

- **Tag line**: "The only IDE-native, BYOK, OSS-licensed security scanner with intelligent LLM triage. Your code stays local."
- **Differentiation pillars**: (1) IDE-native (not GitHub App), (2) BYOK (not vendor-locked), (3) Apache-2.0 (not proprietary), (4) Anti-temporal-cutoff defense (unique to SENTINEL), (5) Override directives for nested-pinned SCA (unique to SENTINEL).
- **Honest limits to advertise**: intraprocedural-only (use CodeQL/Joern for cross-file), real-world MCC modest (decision-support not auto-suppression), no DAST/container/SBOM (single-purpose tool).

---

---

## 10. Session 4 — 12 gap investigations (NOT RESEARCHED items resolved)

Each subsection below covers one of the 12 gaps from the original research scope. All investigated via WebSearch (canonical vendor docs + comparison sites).

### 10.1 ✅ Snyk VS Code extension current feature set

- **Investigation method**: WebSearch — Snyk official docs + GitHub repo + DeepWiki + comparison articles
- **Sources**: <https://docs.snyk.io/developer-tools/snyk-ide-plugins-and-extensions/visual-studio-code-extension> · <https://github.com/snyk/vscode-extension>
- **Findings**:
  - **Scope**: scans Open Source (deps), Code (SAST), and IaC (Infrastructure as Code) configurations.
  - **AI fixes**: AI-generated fix suggestions inline ("DeepCode AI Fix" → "Snyk Agent Fix" architecture per Section 1.6).
  - **Language coverage**: "wide array of package managers, programming languages, and frameworks" (no specific count published for the IDE extension).
  - **Free tier**: install **free of charge from VS Code marketplace**, usable with a Snyk Free account.
  - **IDE compatibility**: VS Code + **Windsurf + Cursor + Eclipse Theia** (multi-IDE via VS Code-API compatibility).
  - **"Secure at Inception"**: new capability — modal on first install asks to enable Snyk Studio which writes a `snyk_rules.mdc` file into the project root (similar to `.cursorrules` pattern for AI assistants).
- **Strategic implication for SENTINEL**:
  - **Direct competitor for the IDE niche** with broader IDE coverage (Windsurf/Cursor/Theia) than just VS Code.
  - **Snyk Free tier** + extension = zero-friction onboarding analogous to Aikido — both compete on the friction axis SENTINEL doesn't yet match.
  - **`snyk_rules.mdc` pattern** is an interesting UX innovation — SENTINEL could adopt a similar `.sentinel-rules.mdc` to surface custom triage rules to AI coding assistants (Claude Code, Cursor, Copilot). Small effort, high signal for the vibe-coding audience.

### 10.2 ✅ GitHub Advanced Security free tier vs paid boundaries

- **Investigation method**: WebSearch — GitHub Docs + GitHub blog + community discussions
- **Sources**: <https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security> · <https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql> · <https://github.com/security/plans>
- **Findings**:
  - **Public repositories — FREE**: CodeQL code scanning + Copilot Autofix both **completely free**, no scan limits.
  - **Public repo languages supported (CodeQL)**: JS/TS, Python, Java, C#, C/C++, Go, Ruby (and Swift/Kotlin in expanding coverage).
  - **Private repositories — PAID**: requires GitHub Code Security license at **$30/active committer/month** (includes code scanning, CodeQL, dependency review, Copilot Autofix).
  - **No Copilot subscription needed** for Copilot Autofix in eligible repos — it's bundled with Code Security.
  - **Team tier note**: GitHub Team plan does NOT include Code Security; must purchase separately.
- **Strategic implication for SENTINEL**:
  - **For OSS maintainers with PUBLIC repos** → GitHub Advanced Security free tier is **directly comparable** to SENTINEL's value prop. **SENTINEL's edge**: BYOK (data privacy), runs locally (no PR-flow dependency), works on private code without paying $30/dev/month.
  - **For indie devs / small teams on PRIVATE repos** → SENTINEL's free Apache-2.0 + BYOK is a **clear cost differentiator**: $0/dev/month vs $30/dev/month for the GitHub Code Security equivalent.
  - **GitHub's training-data + CodeQL semantic engine is unbeatable** for cross-file taint analysis. Do not try to match. Continue positioning SENTINEL as fast, IDE-native, intraprocedural+ (per Section 1.21 update on OpenGrep cross-function taint).

### 10.3 ✅ JetBrains Qodana free tier

- **Investigation method**: WebSearch — JetBrains official docs + blog + G2 reviews + third-party reviews
- **Sources**: <https://www.jetbrains.com/help/qodana/pricing.html> · <https://www.jetbrains.com/qodana/self-hosted/> · <https://blog.jetbrains.com/qodana/2025/06/qodana-self-hosted-lite/>
- **Findings**:
  - **Tiers**: Community (free), Ultimate, Ultimate Plus.
  - **Community license**: free, usable in **open-source AND proprietary projects**. Lacks features of paid tiers + has limited Qodana Cloud data storage.
  - **Engine**: Qodana uses **the same analysis engines as JetBrains IDEs** (IntelliJ IDEA, PhpStorm, WebStorm, GoLand, PyCharm, Rider, CLion). Findings in CI/CD = identical to findings in editor.
  - **Languages**: **60+ via specialized linters**. Primary: Java/Kotlin, Python, JS/TS, PHP, Go, C#/.NET, C/C++, Ruby, Rust.
  - **NOT primarily LLM-driven**: positioned as "continuous inspection infrastructure" — linters, baselines, quality gates, reports, cloud dashboards, CI integrations. Static analysis core, not AI-chat.
  - **Self-Hosted Lite (June 2025)**: on-premises lightweight deployment for teams. AWS supported initially; more cloud options planned.
- **Strategic implication for SENTINEL**:
  - **Different category from SENTINEL**: Qodana is **CI/CD + JetBrains-IDE-native static analysis**, NOT LLM triage tool. They compete for "static analysis quality" but in different runtime contexts.
  - **For JetBrains users specifically**: Qodana is the obvious choice (free Community + free IDE editor parity). **SENTINEL is NOT a JetBrains play** — focus on VS Code ecosystem.
  - **"Same engine in IDE + CI" is a strong UX message** — SENTINEL could mirror this: "same scan results in your IDE and your CI" if/when CI integration is built.
  - **Qodana's 60+ languages is broader than OpenGrep** — but achieved via 9+ separate linter binaries. SENTINEL's single-engine approach is simpler but narrower.

### 10.4 ✅ SonarLint / SonarQube for IDE — AI features in free tier

- **Investigation method**: WebSearch — Sonar official docs + Marketplace listing + GitHub
- **Sources**: <https://www.sonarsource.com/products/sonarqube/ide/> · <https://docs.sonarsource.com/sonarqube-for-vs-code/ai-capabilities/ai-codefix> · <https://marketplace.visualstudio.com/items?itemName=SonarSource.sonarlint-vscode>
- **Findings**:
  - **Rebranded**: SonarLint → **SonarQube for IDE** (current name, 2026).
  - **Free tier (standalone)**: covers **40+ languages** (JS/TS, Python, Java, C#, C/C++, Go, PHP, others). Real-time inline issue detection, QuickFix suggestions, bugs + vulnerabilities + code smells.
  - **AI CodeFix**: **NOT in free tier**. Available only via Connected Mode with:
    - SonarQube Server **Enterprise** or **Data Center** editions, OR
    - SonarQube Cloud **Team** or **Enterprise** plans
  - **Real-time analysis**: verifies every line as typed.
  - **Visual Studio support**: 2017, 2019, 2022, 2026.
- **Strategic implication for SENTINEL**:
  - **Sonar free tier covers more languages than OpenGrep** (40+ vs ~30) but is **pattern-matching only**, not LLM-driven triage.
  - **SonarQube's AI CodeFix is gated behind paid Enterprise** — SENTINEL's free LLM triage (via BYOK) is a clear differentiator for cost-sensitive users.
  - **Direct positioning vs Sonar**: "SonarQube for IDE gives you patterns; SENTINEL adds an LLM brain that reasons about each finding. And our AI features work in the free tier — you pay your own LLM provider, not us."
  - **UX note**: Sonar's "Connected Mode" pattern (local IDE → cloud server) is a workflow SENTINEL doesn't have. SENTINEL's "purely local + BYOK" is **simpler architecturally** but cannot share findings across team members. For team-collaboration features, this is a clear gap (defer to future).

### 10.5 ✅ DryRun Security positioning

- **Investigation method**: WebSearch — DryRun official docs + blog + G2 reviews
- **Sources**: <https://www.dryrun.security/> · <https://www.dryrun.security/resources/csa-guide> · <https://www.globenewswire.com/news-release/2026/02/03/3230986/0/en/DryRun-Security-Introduces-the-DeepScan-Agent-for-Rapid-Full-Codebase-Security.html>
- **Findings**:
  - **Positioning**: "AI-native SAST", "first AI-native, agentic code security intelligence solution" — proprietary **Contextual Security Analysis (CSA) engine**.
  - **Detection focus**: PR-level code commits via AI-driven contextual analysis. Claims ability to find **"business logic" vulnerabilities** that traditional SAST misses (similar positioning to Endor Labs).
  - **Performance claim**: **2x precision vs traditional SAST**; reduces noise by focusing on exploitability + impact.
  - **DeepScan Agent (Feb 2026)**: full-repo on-demand scanning agent for "fast, full-repository confidence: before major releases, after large refactors, during acquisitions".
  - **AppSec niche**: claims legacy SAST misses **80% of LLM-specific vulnerabilities** (model orchestration, tool use, etc.) — DryRun's special focus.
  - **Integration**: GitHub, GitLab, Slack. **NOT IDE-native** (PR + commit workflow).
  - **Pricing**: not public; G2 reviews suggest enterprise-tier sales motion.
- **Strategic implication for SENTINEL**:
  - **DryRun targets a different segment**: enterprise PR-flow security teams, NOT indie/IDE-first devs.
  - **"LLM-specific vulnerabilities" focus** is an interesting niche DryRun is staking. SENTINEL's Vibe-Detect scout is heuristic; could grow into an LLM-aware ruleset (placeholder API keys, unverified tool calls, agent orchestration foot-guns).
  - **"Contextual" framing**: DryRun emphasizes context-aware analysis as their moat. SENTINEL's Context Agent already does this — could borrow DryRun's marketing framing.

### 10.6 ✅ NeoSec / Akamai API Security

- **Investigation method**: WebSearch — Akamai press releases + product page + industry analysis
- **Sources**: <https://www.akamai.com/products/api-security> · <https://www.akamai.com/newsroom/press-release/akamai-intends-to-acquire-neosec>
- **Findings**:
  - **Acquisition history**: Akamai acquired Neosec (May 2023) for API detection + response. **Later acquired Noname Security ($450M, June 2024)** which now forms the primary basis of Akamai API Security platform.
  - **Category**: **runtime API security**, NOT SAST/code scanning. Discover→Test→Detect→Respond workflow.
  - **AI/LLM features**: discovers + tags GenAI/LLM API endpoints, AI-native governance for app↔LLM↔data interactions, runtime anomaly detection (ML-based).
  - **Pricing**: enterprise tier **$25K-100K+/year typical**. Per-traffic / per-API billing models.
  - **NOT in SENTINEL's competitive segment**: different category entirely (runtime API security vs static code scanning).
- **Strategic implication for SENTINEL**:
  - **Complementary**, not competitive. Companies using SENTINEL for code-level security may also use Akamai for runtime API protection — no overlap.
  - **DO NOT compete in runtime / DAST / API detection**. Stay focused on static analysis + LLM triage.
  - **One adjacency to note**: if SENTINEL ever adds runtime / SBOM / supply-chain features, the API Security space is well-served by enterprise vendors. **Don't go there**.

### 10.7 ✅ Jit.io free tier scope

- **Investigation method**: WebSearch — Jit official pricing + ASPM platform docs + G2 reviews + Gartner
- **Sources**: <https://www.jit.io/pricing> · <https://www.jit.io/aspm-platform> · <https://www.jit.io/lp/open-aspm-platform>
- **Findings**:
  - **Category**: **ASPM** (Application Security Posture Management) platform — unified view across SAST, SCA, secrets, SBOM, container, IaC, CSPM, DAST.
  - **AI Agents**: **SERA** (Security Evaluation and Remediation Agent) + **COTA** (Communication, Ops, and Ticketing Agent) — context-aware AI for vuln triage + remediation orchestration.
  - **Free tier**: **YES, no credit card required**. Specific feature limits not published in search results.
  - **Paid tier**: $50/dev/month flat rate (covers all security controls + features).
  - **"Open ASPM"**: positioning emphasizes integration with existing tools rather than replacing them.
  - **Integrations**: GitHub, GitLab, AWS, Azure, GCP, Jira, Slack.
  - **OpenGrep backer**: Jit is in the consortium that supports OpenGrep (per Gap #11 finding).
- **Strategic implication for SENTINEL**:
  - **Jit is ABOVE SENTINEL's category** (full ASPM platform vs IDE-native scanner). They orchestrate many tools; SENTINEL is one such tool.
  - **Adjacency opportunity**: SENTINEL could become a **Jit-integrated scout** — the "local IDE-first" piece of a Jit ASPM deployment. Worth exploring partnership (no specific action required now).
  - **Jit's "AI agent + ASPM" framing is the enterprise SaaS path** — SENTINEL is the OSS opposite (BYOK + IDE + local + free).

### 10.8 ✅ ZeroPath benchmark approach

- **Investigation method**: WebSearch — ZeroPath official site + blog + arXiv RealVuln benchmark + Joshua Rogers' independent reviews
- **Sources**: <https://zeropath.com/products/sast> · <https://zeropath.com/blog/best-sast-tools> · <https://arxiv.org/html/2604.13764>
- **Findings**:
  - **Positioning**: "AI-Native SAST". Combines ML + LLMs for context-aware detection + auto-fix.
  - **Claims (unverified marketing)**: 2x more vulnerabilities + 75% fewer FPs vs pattern-based tools.
  - **2026 recognition**: **RSAC 2026 Innovation Sandbox Top-10 Finalist**. Autonomously discovered 32+ vulnerabilities in FFmpeg + curl (major OSS projects).
  - **Benchmark approach**: published benchmark code + SARIF results as a **public GitHub fork of the XBOW validation benchmarks**, testing against major SAST vendors. Methodology transparency is a positive signal.
  - **Auto-PR**: generates ready-to-merge fix PRs.
  - **Capability target**: authentication bypasses, IDORs, logic bugs (categories pattern-based tools struggle with).
  - **Pricing**: not in search results — likely enterprise sales.
- **Strategic implication for SENTINEL**:
  - **ZeroPath is a strong AI-native SAST competitor in enterprise segment**. NOT IDE-native primarily.
  - **Their public benchmark methodology is laudable** — SENTINEL could borrow this for credibility: publish a public benchmark suite + SENTINEL's results vs other LLM SAST tools on standardized fixtures.
  - **The "32+ vulns in FFmpeg + curl" claim** is impressive marketing. Replicable: SENTINEL could scan high-profile OSS projects and publish findings (with responsible disclosure) — instant credibility-building.
  - **NEW Apache-2.0 deliverable opportunity**: publish a public SENTINEL benchmark suite (test fixtures + ground truth + reproducible scoring) as the OSS reference for "LLM-triaged OSS SAST quality".

### 10.9 ✅ OSV-Scanner LLM integration (none, as expected)

- **Investigation method**: WebSearch — Google official docs + GitHub repo + Google OSS blog
- **Sources**: <https://google.github.io/osv-scanner/> · <https://github.com/google/osv-scanner>
- **Findings**:
  - **NO LLM integration** confirmed — pure vulnerability scanner querying OSV.dev database.
  - **OSV.dev**: largest aggregated source of OSS vulnerability data, normalized advisory format across NVD + GitHub Advisories + ecosystem-specific sources.
  - **Languages (V2, 2026)**: C/C++, Dart, Elixir, Go, Java, JS, PHP, Python, R, Ruby, Rust. **11+ ecosystems, 19+ lockfile formats**.
  - **Guided Remediation (V2)**: calculates optimal dep-upgrade set considering depth + severity + fix strategy + ROI. Supports npm + Maven; more planned.
  - **Container scanning (V2)**: layer-aware for Debian, Ubuntu, Alpine; identifies which layer introduced each package + filters runtime-irrelevant vulns.
  - **HTML reports**: interactive output for non-terminal users.
  - **License**: Apache-2.0 ✅.
- **Strategic implication for SENTINEL**:
  - **OSV-Scanner is complementary**, not competitive — pure SCA without LLM. SENTINEL uses Trivy (also Apache-2.0) for SCA, which queries OSV.dev among others.
  - **OSV-Scanner's guided remediation** (dep-upgrade optimization) is a **feature SENTINEL could borrow**. Currently SENTINEL's SCA grouping (DG-113 A) computes MAX-semver-per-track but doesn't optimize for transitive dep-tree minimization. **Future improvement candidate**.
  - **SENTINEL could also support OSV-Scanner as an alternative SCA scout** (instead of/alongside Trivy) — Apache-2.0 license-compatible, more focus on remediation guidance.

### 10.10 ✅ Trufflehog Verifier mode + AGPL license concern

- **Investigation method**: WebSearch — Truffle Security official docs + blog + GitHub + comparison articles
- **Sources**: <https://github.com/trufflesecurity/trufflehog> · <https://trufflesecurity.com/blog/how-trufflehog-verifies-secrets> · <https://docs.trufflesecurity.com/reverify-secrets>
- **Findings**:
  - **Verifier mode**: validates **700-800+ secret types** via safe read-only API calls.
  - **Verification process**: for each detected candidate, attempts provider API verification (sometimes live call, sometimes cached). If endpoint returns 200 OK = "verified" secret. Auto-verification for **every** secret detector.
  - **Live + historical**: validates secrets in git history to determine which historical credentials are still live + need rotation.
  - **Beyond Git**: scans Slack, S3 buckets, GCS, Docker images, Jenkins, Elasticsearch, Postman, CI platforms.
  - **License**: **AGPL-3.0** ⚠️.
  - **Enterprise self-hosted option** available.
- **Strategic implication for SENTINEL**:
  - **Trufflehog Verifier is BEST-IN-CLASS for secret validation**. SENTINEL uses Gitleaks (MIT), which only does pattern-match without API verification.
  - **GAP IDENTIFIED**: SENTINEL's Secrets scout could be enhanced with verification (live API calls to confirm secrets are still active). High-value feature.
  - **AGPL-3.0 license concern (CRITICAL for SENTINEL Apache-2.0)**:
    - SENTINEL **does NOT bundle Trufflehog** — at most could spawn it as an external CLI like Trivy.
    - **AGPL Section 13** triggers when "you allow remote network interaction" with modified covered work. Spawning + parsing output (read-only) is **likely outside AGPL's scope**, but legal opinion advised.
    - **Safer alternative**: build a SENTINEL-internal secret verifier (Apache-2.0) — uses Gitleaks for detection + internal verification routines for top 50-100 secret types. **Effort: medium; License: Apache-2.0 clean**.
  - **Alternative for SENTINEL**: stay with Gitleaks for detection + add an optional **"verify mode"** that pings the issuing service's auth endpoint to confirm validity (for common types: GitHub, AWS, Stripe, Slack, OpenAI, Anthropic, etc.). Selective verification only — not the 700-type universe.

### 10.11 ✅ Bandit / Brakeman / OpenGrep ecosystem — CRITICAL FINDING

- **Investigation method**: WebSearch — Wiz tool guide + Snyk OSS analysis + OpenGrep vs Semgrep comparisons + Endor Labs benchmark blog
- **Sources**: <https://www.wiz.io/academy/application-security/top-open-source-sast-tools> · <https://appsecsanta.com/sast-tools/opengrep-vs-semgrep> · <https://www.endorlabs.com/learn/benchmarking-opengrep-performance-improvements> · <https://semgrep.dev/docs/faq/comparisons/opengrep>
- **Findings on single-language specialists**:
  - **Bandit (Python)**: best-in-class for Python-specific scanning. Low FPs in Python codebases. Apache-2.0.
  - **Brakeman (Ruby on Rails)**: dominant Rails security scanner. Detects SQL injection, XSS, config issues. Apache-2.0.
  - **Other OSS specialists**: gosec (Go), SpotBugs (Java), PMD (Java/JS/Apex), Infer (Java/C/C++ — Meta), PHPStan (PHP), Psalm (PHP), nodejsscan (Node.js).
  - **Multi-language OSS**: Semgrep CE, OpenGrep, CodeQL.
- **CRITICAL FINDING — OpenGrep details**:
  - **Created January 2025** as a community fork of Semgrep CE after Semgrep moved cross-function taint, fingerprinting, and other features behind their **commercial Pro Engine**.
  - **OpenGrep restored cross-function (interprocedural) taint tracking** across **12 languages** + fingerprinting.
  - **OpenGrep added Visual Basic support** (not in Semgrep CE).
  - **Backed by 10+ AppSec consortium**: Aikido, Endor Labs, Jit, Orca Security + others. **Dedicated full-time OCaml development team**.
  - **Performance**: **3.15x faster** than Semgrep on average (1.07x-4.14x range depending on project size).
  - **Compatibility**: same LGPL-2.1 CLI license, same rule format, same JSON/SARIF output — existing Semgrep rules work on OpenGrep unchanged.
- **Strategic implication for SENTINEL — MAJOR REVISION TO PRIOR FINDING**:
  - **Section 1.21 needs update** (and has been updated): SENTINEL's Semgrep CE intraprocedural-limit claim is **PARTIALLY OUTDATED**. OpenGrep (which SENTINEL uses) has cross-function taint for 12 languages.
  - **SENTINEL's positioning can be upgraded**: not "intraprocedural-only" but "intraprocedural + cross-function (via OpenGrep) for 12 languages, no cross-file".
  - **Marketing language**: "SENTINEL runs on OpenGrep, the community-backed, 3x-faster Semgrep alternative with cross-function taint and Visual Basic support — all features Semgrep moved to paid Pro Engine."
  - **Validate empirically in Cycle 111**: confirm SENTINEL's OpenGrep configuration is actually invoking cross-function mode (the feature exists in OpenGrep CLI but SENTINEL may not have enabled it).
  - **OpenGrep adoption signal**: the consortium (Aikido + Endor + Jit + Orca) is unusual cross-vendor cooperation. **Indicates OpenGrep will likely outpace Semgrep CE in features** as the consortium funds parity restoration. SENTINEL is on the right scanner.
- **Bandit/Brakeman strategic implication**:
  - **For Python-specific scans**: Bandit may catch findings OpenGrep misses (highly tuned for Python idioms). SENTINEL could **offer Bandit as an additional Python-specific scout** when Python is detected in the workspace. Apache-2.0 license-clean. Medium effort.
  - **For Rails-specific scans**: same logic for Brakeman + Ruby projects.
  - **Tradeoff**: more scouts = more output to triage = more LLM cost. The Brain Layer needs to dedup intelligently (DG-113 A grouping already handles per-package family; could extend to per-rule-id).

### 10.12 ✅ Arnica re-verification — CORRECTS PRIOR REFUTATION

- **Investigation method**: WebSearch — Arnica official docs + pricing + G2 reviews
- **Sources**: <https://www.arnica.io/> · <https://docs.arnica.io/arnica-documentation/code-risks/code-risk-language-and-framework-support> · <https://www.jit.io/pricing> (cross-reference)
- **Findings**:
  - **Free tier** (confirmed): covers SCA, SAST, IaC, secrets scanning, SBOM inventory, license + package-reputation signals, weekly risk ingestion, full user/asset inventory. **No max identity count** in free tier.
  - **Paid tiers**:
    - **Core Business**: $300/identity/year (annual) or $360 (monthly). Adds real-time risk ingestion, PR merge-blocking, ChatOps (Slack/Teams), inline PR risk, automated issue mgmt.
    - **Core Enterprise**: $600/identity/year (annual) or $720 (monthly). Adds RBAC, SAML, zero-day campaigns, API access, on-prem deployment, dynamic backlog.
  - **Language coverage** (DIRECTLY from Arnica docs, refuting the prior refutation):
    - **Rust**: ✅ supported for SAST in **Beta** status.
    - **Scala**: ✅ supported for SAST in **GA** (General Availability), same support as Java.
    - **Swift**: ✅ supported for SAST in **Experimental / Beta Support** status.
  - **Backend engine**: **Arnica leverages OpenGrep as the SAST backend** (adds proprietary customization + automation).
- **CORRECTION TO PRIOR REFUTATION (Session 2)**:
  - The original claim said Arnica's free tier covers Rust/Scala/Swift. The workflow's adversarial verification refuted this 0-3 because the **OWASP source did NOT contain the language detail** — the extractor mis-attributed.
  - **The underlying assertion about Arnica IS TRUE** (per Arnica's own docs).
  - **Section 3.2 has been updated** with this correction.
- **Strategic implication for SENTINEL**:
  - **Arnica IS a valid benchmark for free-tier multi-language coverage** in the OpenGrep-backed segment.
  - **Arnica's free tier is generous** (full SAST/SCA/IaC/secrets/SBOM) — competing on features alone is hard. **SENTINEL's edge must be**:
    - **Apache-2.0 OSS license** (Arnica is proprietary SaaS, free tier subject to vendor lock-in)
    - **Local execution + BYOK** (Arnica is SaaS — code uploaded to their cloud)
    - **IDE-first** (Arnica is GitHub/GitLab-flow-first)
  - **Arnica's OpenGrep backend confirms OpenGrep ecosystem strength** — SENTINEL is on the right tech stack.
  - **Arnica's per-identity pricing model** ($300-720/year per dev) is a **MUCH cheaper enterprise alternative to Snyk/Aikido** for big teams. SENTINEL's free tier doesn't compete on the same axis but on a different one (privacy + OSS + IDE).

---

## 11. Updated strategic synthesis (post-Session 4)

### 11.1 Revised competitor categorization

Based on Session 4 findings, the competitive landscape now clusters into 6 segments:

| Segment                              | Examples                                                                                                                   | Position vs SENTINEL                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **IDE-native + LLM-driven (DIRECT)** | Aikido AutoFix, Snyk VS Code, SonarQube for IDE (free tier no AI), Corgea                                                  | DIRECT competition on UX + features                                     |
| **GitHub-flow + LLM-driven**         | GitHub Advanced Security (free public, paid private), Endor Labs AI Code Review, DryRun Security, ZeroPath, Snyk Agent Fix | NOT IDE-first — SENTINEL niche defensible                               |
| **ASPM platforms (full-stack)**      | Jit.io, Arnica                                                                                                             | Different category — SENTINEL is a scout/scanner, they're orchestrators |
| **CI/CD + JetBrains IDE static**     | JetBrains Qodana                                                                                                           | Different IDE ecosystem                                                 |
| **Runtime / API security**           | NeoSec/Akamai, Cloudflare API Shield                                                                                       | DO NOT COMPETE — different category                                     |
| **Pure OSS scanners (no LLM)**       | OSV-Scanner, Trufflehog, Bandit, Brakeman, gosec                                                                           | COMPLEMENTARY — SENTINEL could orchestrate them                         |

### 11.2 Updated recommendation table (Session 4 additions)

| #   | Recommendation                                                                                                                                                                            | Source claim | Effort | Impact                        | Priority |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ | ----------------------------- | -------- |
| R11 | **Adopt `.sentinel-rules.mdc` pattern** (Snyk Studio-inspired) to expose SENTINEL's project context to AI coding assistants (Claude Code, Cursor, Copilot)                                | 10.1         | Small  | Medium (vibe-coding adoption) | P1       |
| R12 | **Validate OpenGrep cross-function taint is actually enabled** in SENTINEL's invocation (may already work, may need flag) — UPDATE marketing if confirmed                                 | 10.11        | Small  | High (positioning upgrade)    | P0       |
| R13 | **Add Bandit / Brakeman as optional language-specific scouts** when Python / Rails detected — complement OpenGrep with specialist coverage                                                | 10.11        | Medium | Medium                        | P2       |
| R14 | **Add secrets verification mode** (Apache-2.0 in-house, NOT bundle AGPL Trufflehog) for top 50-100 secret types — major Gitleaks enhancement                                              | 10.10        | Medium | High (UX win)                 | P1       |
| R15 | **Build public SENTINEL benchmark suite** (test fixtures + ground truth + reproducible scoring) — credibility-building, follows ZeroPath's transparent benchmarking                       | 10.8         | Large  | High (credibility)            | P2       |
| R16 | **Adopt OSV-Scanner's guided-remediation pattern** for SCA (transitive dep tree optimization, not just MAX-semver) — extends DG-113 A                                                     | 10.9         | Medium | Medium                        | P2       |
| R17 | **Add `inconclusive`-quality LLM rationale for runtime-API findings** the scout incorrectly classifies as code findings (rare but real — Akamai/Cloudflare-style runtime is out of scope) | 10.6         | Small  | Low                           | P3       |

### 11.3 Updated differentiation strategy

**DOUBLE DOWN on (verified moats)**:

1. **Apache-2.0 + BYOK + local execution** — only SENTINEL in this position (Aikido = SaaS, Snyk = SaaS+paid IDE, GitHub = SaaS, Arnica = SaaS, ZeroPath = SaaS).
2. **IDE-native LLM triage for free** — Aikido has IDE 1-click but is SaaS-hosted; SENTINEL is local.
3. **DG-115 override directives for nested-pinned SCA** — NO competitor identified with this specific pattern.
4. **DG-111 A anti-temporal-cutoff defense** — NO competitor identified with this specific pattern; worth a blog post.
5. **Privacy story** — your code never leaves your machine. Aikido sends to AWS Bedrock; Snyk sends to Snyk Cloud; GitHub Advanced Security sends to GitHub; SENTINEL keeps it local.
6. **OpenGrep ecosystem alignment** (Session 4 finding) — riding a 10+ vendor consortium's investment instead of a proprietary engine.

**NEW NICHE TO BUILD (Session 4 finding)**:

- **`.sentinel-rules.mdc` for AI coding assistants** — SENTINEL becomes the security context provider for vibe-coding agents (Claude Code, Cursor, Copilot, Windsurf). When the user asks Claude Code to "add a payment endpoint", Claude Code reads `.sentinel-rules.mdc` and applies SENTINEL's security guardrails inline.

**EXPLICITLY DO NOT PURSUE (revised)**:

1. ❌ Runtime / DAST / API security (Akamai NeoSec category)
2. ❌ Full ASPM orchestration (Jit, Arnica)
3. ❌ Snyk-scale fixes DB
4. ❌ CodeQL semantic engine
5. ❌ JetBrains IDE ecosystem (cede to Qodana)
6. ❌ Enterprise PR-flow security workflow (cede to GitHub Advanced Security paid + Endor + DryRun)

---

---

## 12. Architectural North Star — SENTINEL as Interaction-Aware Security Analysis

> **READ THIS FIRST.** This section codifies the **organizing principle** that re-frames every section above. All prior recommendations (R1-R17), all competitive comparisons, all roadmap decisions should be re-evaluated through the lens of this principle before commitment.

### 12.1 The principle (user-articulated, 2026-06-18)

**A vulnerability is not a pattern in isolation — it is a node in a graph of system interactions.**

Three concrete corollaries:

1. **A finding is a question, not an answer.** When a scout flags `eval(x)` or `import unsafe_module` or `process.env.SECRET`, that is the START of analysis, not the conclusion. The answer lives in the **flow**: where does the data come from? Where does it go? What mitigates or amplifies it? What module is it in? When does it run?

2. **Traceability is the qualifier.** The user's example: a finding may look like a "wake-up call" because of a particular import, but when you look at the actual development of the code, it had no reason to be a wake-up call — because the import _made sense in the flow several steps later_. **Without flow tracing, the finding is dismissed wrongly or amplified wrongly.**

3. **Development is a system of interactions.** Files import each other. Functions call each other. Data passes through transformations. Modules have trust boundaries. Some code runs at startup with hardcoded config; some processes user-controlled HTTP request bodies. Same `eval()`, dramatically different priorities. SENTINEL must understand this system — not just see snippets in isolation.

### 12.2 Current state vs. the principle — honest gap analysis

| Piece SENTINEL has today            | What it does                                                       | What's missing vs the principle                                          |
| ----------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| DG-112 A SAST taint dataflow trace  | Captures source→intermediate→sink for OpenGrep `mode: taint` rules | Only taint rules; only intraprocedural; only that one finding's flow     |
| DG-115 A `dependencyContext`        | Tracks dep graph for SCA (parent pins child, hasSiblingFixedCopy)  | Only SCA; no cross-finding correlation                                   |
| Context Agent (Brain Layer)         | LLM explains entryPoint/sink/exposure                              | LLM-derived, not AST-derived; can hallucinate; no project-wide grounding |
| DG-117 + DG-117.0.1 exclude-list    | Filters noise paths (fixtures/dist/.test/.spec)                    | Exclusion is NOT understanding — sigue siendo aislamiento                |
| DG-118 A `priorityScore`            | Separa confidence% de urgency                                      | Compute is (severity, triage state) — does NOT use flow context          |
| DG-115.1 A G7 `hasSiblingFixedCopy` | Flow-aware SCA decision (other copies in dep tree?)                | Only for nested-pinned deps; pattern doesn't generalize                  |

**Verdict**: SENTINEL has scattered pieces of context-awareness but **no unified interaction graph as the foundation layer**. Each Brain Layer agent reasons over a snippet plus tiny per-finding metadata. **The system as a whole is invisible to the Brain Layer.**

This is exactly the failure pattern documented in [arXiv 2411.03079 (Section 1.20)](https://arxiv.org/pdf/2411.03079): the two empirically-validated failure modes of LLM-based FP mitigation are (1) snippets "too broad or cluttered with irrelevant control/data flows" and (2) "missing critical code contexts leading to incomplete representations that mislead LLMs". Without a system-level graph, the Brain Layer keeps falling into both failure modes.

It is also the explicit moat of **DryRun Security** (Section 10.5 — "Contextual Security Analysis engine") and **Endor Labs** (Section 1.4 — architectural/design-flaw detection). They are betting their products on the principle the user just articulated. SENTINEL needs an Apache-2.0 OSS answer.

### 12.3 R1-R17 re-categorized through the North Star lens

#### HIGH alignment (these advance the principle directly)

- **R6** — Architecture Agent (reads diffs/repo entire, evaluates design-level)
- **R8** — Snippet trim/expand based on documented failure modes (attacks the two arXiv 2411.03079 failure modes head-on)
- **R12** — Validate OpenGrep cross-function taint enabled (enabler — without cross-function tracking, no system-level flow)
- **R3** — Per-CWE confidence floor for crypto/policy (acknowledges some CWEs require full system context, NOT snippet)
- **R4** — Per-language prompts (each language has distinct interaction patterns)
- **R16** — OSV-Scanner guided remediation (flow-aware dep tree optimization for SCA)

#### MEDIUM alignment (useful, but doesn't change the lens)

- R1 — Few-shot prompting (better classification but same paradigm)
- R2 — Self-Consistency voting (robustness, not context)
- R13 — Bandit/Brakeman as language specialists (better detection within isolated patterns)

#### LOW alignment (polish within current paradigm)

- R5, R7, R10, R11, R14, R15, R17 — UX, BYOK, dataset DB, secrets verification, public benchmark, runtime-API edge case

**Roadmap implication**: HIGH-alignment items should be P0/P1 because they bend the architecture toward the principle. MEDIUM items are P2 polish. LOW items are P3 backlog.

### 12.4 New recommendations R18-R22 emerging from the principle

These are the **new** recommendations that did not appear in R1-R17 because they only emerge when you adopt the principle.

| #       | Recommendation                                                                                                                                                                                                                                                  | Why it embodies the principle                             | Effort                            | Impact   | Priority |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------- | -------- | -------- |
| **R18** | **Interaction Graph Layer** — project-wide module + symbol graph built per scan, queried by Brain Layer agents during triage. Each finding becomes a node; edges are imports/calls/dataflows.                                                                   | DIRECT — encarnación del principio                        | Large (multi-cycle, staged v1→v3) | CRITICAL | P0       |
| **R19** | **Module trust boundary tagging** — parse `package.json` exports/main, route definitions (Express/Fastify/Hono), tsconfig paths, test/src structure. Tag each file: `public-entry` / `internal-handler` / `startup-config` / `test-fixture` / `private-worker`. | Same: explicit system structure                           | Medium                            | Alto     | P1       |
| **R20** | **Cross-finding correlation** — new Coordinator stage 3 (after stage 2 dedup): identify groups of findings sharing a flow path. Triage Agent evaluates groups, not individuals.                                                                                 | DIRECT — el LLM ve interacciones, no aislamientos         | Medium                            | Alto     | P1       |
| **R21** | **Temporal context tagging** — detect code's execution context: init/main vs HTTP handler vs background job vs CLI command. Pass to Triage as context.                                                                                                          | DIRECT — same eval(), distinct priorities by when it runs | Small                             | Medio    | P2       |
| **R22** | **Diff-aware mode** — compare findings vs prior scan; surface "5 new since main", "2 reintroduced". Differentiate visually and prioritize what's new.                                                                                                           | INDIRECT — temporal axis of interaction                   | Small                             | Medio    | P1       |

### 12.5 Implementation path for R18 — staged v1 → v3

R18 is the maximalist version of the principle. It cannot ship in one cycle. Stage it:

#### v1 (proposed for DG-123 A) — minimum viable graph

- **Scope**: TypeScript/JavaScript only (primary SENTINEL workspace).
- **Graph type**: module-level. Nodes = files. Edges = static `import` / `export` / `require` statements.
- **Construction**: parse imports/exports per file using regex or `tree-sitter-typescript` (MIT license; pure Rust binary, no Node.js deps).
- **Storage**: in-memory per scan only. No persistence.
- **Use**: augment Triage Agent prompt with: "_This file is imported by [N modules]; this file imports from [M modules]. Top importers: [list]. This file's role: [inferred entry-point / library / test / unknown]._"
- **Validation**: re-scan SENTINEL + SYNAPTIC_SAAS workspaces; measure if Triage classification changes meaningfully on a sample (manual ground-truth marking required).

#### v2 — symbol-level + cross-language

- Add function-level call graph (caller/callee within and across files).
- Multi-language via `tree-sitter` grammar packs (Python, Go, Java, Ruby, etc. all available MIT).
- Persist graph to colony.db (new table) for incremental updates.
- Brain Layer agents (Triage, Context, Remediation) all consume the graph.

#### v3 — CPG integration

- Integrate Joern (Apache-2.0) for full Code Property Graph.
- Higher fidelity flows, type inference, framework-aware sinks.
- Multi-cycle effort; significant runtime cost.

### 12.6 Honest tradeoffs (anti-optimismo activo)

R18 v1 is **not** guaranteed to improve triage quality empirically. Honest risks:

1. **LLM may not use the new context productively.** Adding "this file is imported by 5 modules" to the prompt does not automatically improve reasoning. The LLM might ignore it, or worse, hallucinate based on it.
2. **N=2 workspace sample is still small.** Even if SENTINEL + SYNAPTIC_SAAS show improvement, generalization to other repos is not guaranteed.
3. **Cost increase.** Each Triage call now has a larger system prompt → more tokens → higher BYOK cost. Need to measure.
4. **Performance increase.** Building the graph adds scan time. Negligible for small repos; non-trivial for large monorepos.
5. **Graph staleness.** The graph is built per-scan. If the user edits files between scans without rescanning, the graph is stale relative to the editor's state.
6. **Static import resolution is incomplete.** Dynamic `import()` calls, conditional requires, plugin systems all bypass static analysis. Graph will have blind spots.
7. **No taint propagation in v1.** Just imports — does not tell the LLM whether data flows through the import. That's v2+.

### 12.7 Roadmap impact — Cycle 111+ decision filter

Going forward, the question for every DG candidate should be:

> _"Does this DG deepen SENTINEL's understanding of the system as a network of interactions, or does it only improve an isolated piece?"_

Both are valid work, but the first category is what bends the architecture toward the North Star. Polish is OK; polish is not the same as paradigm advancement.

**Cycle 111 candidate ordering, post-principle adoption**:

1. **DG-123 A — R18 v1 Interaction Graph (this Cycle)**
2. DG-124 A — R19 module trust boundary tagging
3. DG-125 A — R20 cross-finding correlation
4. DG-126 A — R12 validate OpenGrep cross-function (was P0 R12, now bundled into R18 implementation)
5. DG-127 A — R8 snippet trim/expand
6. DG-128 A — R21 temporal context tagging
7. DG-129 A — R22 diff-aware mode
8. ... R1-R17 follow per their alignment scores

---

_End of document. Living document — updated by Claude Code research sessions. See Section 6 "Investigation log" for change history._
