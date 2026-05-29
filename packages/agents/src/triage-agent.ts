import {
  TRIAGE_CLASSIFICATIONS,
  TriageClassificationSchema,
  TriageVerdictSchema,
  type Finding,
  type TriageClassification,
  type TriageVerdict,
} from '@synaptic-sentinel/core';
import { extractJsonObject, type AgentPrompt, type BrainAgent } from './brain-agent.js';

// Los tipos de triage viven en core (se persisten en la colony DB); se
// reexportan para mantener estable el API de @synaptic-sentinel/agents.
export { TRIAGE_CLASSIFICATIONS, TriageClassificationSchema, TriageVerdictSchema };
export type { TriageClassification, TriageVerdict };

/**
 * Instruccion de sistema del Triage Agent.
 *
 * DG-111 (Step 2 del SENTINEL-EVALUATION-REPORT.md, 2026-05-29) — §4 #1:
 * el prompt original solo modelaba SAST/secrets y nunca SCA, lo cual hacia
 * que el modelo tratara CVE IDs / versiones / fechas como objeto de su
 * propio juicio. Con LLMs cuyo training cutoff es 2025 y CVEs reales de
 * 2026 en la wild, el modelo recurrentemente clasificaba CVEs reales como
 * "fabricated" / "non-existent" / "future" — caso documentado: CVE-2026-33896
 * (cert bypass, high) → FP 85% fabricated. Patron self-reinforcing: cuantos
 * mas facts post-cutoff trae un finding, MAS confident el modelo de que es
 * falso (exactly backwards). Fix: tres capas (defense in depth):
 *
 * 1. Prompt updates abajo: SCA modelado explicitamente; GROUND TRUTH section
 *    fija que metadata del scanner (CVE id, version, dates) es autoritativa;
 *    regla explicita de que false_positive NO se justifica por "CVE no existe".
 * 2. Date injection (en buildPrompt): inyectar la real current date al user
 *    prompt para que el modelo no asuma que "su" frame temporal del cutoff
 *    es el del mundo real.
 * 3. Deterministic guard (en parseResponse → guardAgainstFabricatedDismissals):
 *    safety net que detecta rationale con keywords de dismissal (fabricated,
 *    fictional, spurious, non-existent, future-dated) y, si el verdict era
 *    false_positive, override a inconclusive con la rationale anotada.
 *
 * Las tres capas se cubren: el guard agarra los casos en que el prompt fallo
 * (LLM ignoro la instruccion o uso wording que el guard no anticipo se
 * reduce; el LLM ignora el system → date injection lo recuerda al user; el
 * LLM ignora ambos → guard salva el verdict).
 */
const SYSTEM_PROMPT = `You are a senior application security (AppSec) analyst.
You receive a finding produced by a security scanner (SAST, secrets, or SCA —
Software Composition Analysis for vulnerable dependencies) and must TRIAGE
it: decide whether it is an exploitable true positive, a false positive, or
whether there is not enough information to decide.

GROUND TRUTH (do not second-guess):
- All scanner-provided metadata is confirmed by the scanner/registry: CVE
  IDs, package names, installed versions, fix versions, advisory dates.
  Treat them as authoritative facts. Your training cutoff is NOT the
  authoritative source of CVE existence — the scanner's CVE feed is.
- Do NOT assess whether a CVE "exists", whether a version "is real", or
  whether dates are "future". Those are out of scope and will lead to
  wrong verdicts on recent (post-training-cutoff) advisories.
- Judge ONLY exploitability and reachability in this codebase, given the
  scanner-confirmed facts.

Criteria:
- true_positive: represents a real, exploitable risk in this codebase.
- false_positive: the pattern matched but there is NO real risk in this
  context (e.g. test fixture, sanitized input, vector not reachable from
  any entry point, framework-level mitigation in place). Do NOT classify
  as false_positive on the basis that a CVE, version, release, or
  advisory date "does not exist", "is fabricated", "is fictional", "is
  future-dated", or similar — that judgement is out of scope.
- inconclusive: missing context (surrounding code, data flow, configuration)
  to decide between true_positive and false_positive.

Respond ONLY with a valid JSON object, no markdown and no extra text, with
this exact shape:
{"classification":"true_positive"|"false_positive"|"inconclusive","confidence":<number between 0 and 1>,"rationale":"<brief explanation in English, at most 2 sentences>"}`;

/** Opciones del TriageAgent (DG-111 Step 2). */
export interface TriageAgentOptions {
  /**
   * Real-world current date (ISO 8601 `YYYY-MM-DD`). Se inyecta al user
   * prompt como `Current date (real-world authoritative): <date>` para que
   * el modelo no asuma que su training cutoff es el frame temporal del
   * mundo real. Tests inyectan un valor fijo para determinism; produccion
   * usa `new Date().toISOString().slice(0, 10)` (default).
   */
  readonly currentDate?: string;
}

/** Devuelve hoy en formato ISO 8601 yyyy-mm-dd (UTC, sin tiempo). */
function currentDateIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Patterns que detectan rationale del Triage Agent que dismissea metadata
 * scanner-confirmed como "fabricated" / "no existe" / "future". El guard
 * (`guardAgainstFabricatedDismissals`) los aplica al rationale y, si hay
 * match, fuerza override a `inconclusive` cuando la classification era
 * `false_positive` (DG-111 Step 2 — §4 #1 del reporte).
 *
 * Falsos positivos del guard son tolerables (downgrade a inconclusive
 * vs riesgo de bury un CVE real como FP); falsos negativos son peores. Se
 * privilegia coverage sobre precision en el regex set.
 */
export const FABRICATED_DISMISSAL_PATTERNS: readonly RegExp[] = [
  /\bfabricated\b/i,
  /\bfictional\b/i,
  /\bspurious\b/i,
  /\bnon[-]?existent\b/i,
  /\bnot\s+a\s+real\b/i,
  /\bfuture[-\s]?dated?\b/i,
  /\bfuture\s+(cve|release|version|advisory)\b/i,
];

/**
 * Override deterministico: si el verdict era `false_positive` y el rationale
 * dismissea scanner-confirmed metadata como fabricated/non-existent/future,
 * fuerza override a `inconclusive` para manual review (DG-111 Step 2). Es
 * funcion pura testeable independientemente.
 */
export function guardAgainstFabricatedDismissals(verdict: TriageVerdict): TriageVerdict {
  if (verdict.classification !== 'false_positive') return verdict;
  const matched = FABRICATED_DISMISSAL_PATTERNS.some((p) => p.test(verdict.rationale));
  if (!matched) return verdict;
  const truncatedOriginal =
    verdict.rationale.length > 200 ? `${verdict.rationale.slice(0, 200)}...` : verdict.rationale;
  return {
    classification: 'inconclusive',
    confidence: 0.5,
    rationale:
      'Brain Layer guard (DG-111 Step 2): the model dismissed scanner-confirmed ' +
      'metadata (CVE id, version, release, or advisory date) as fabricated, ' +
      'non-existent, or future. Scanner data is authoritative; overriding to ' +
      `inconclusive for manual review. Original rationale: ${truncatedOriginal}`,
  };
}

/**
 * Triage Agent — reduce falsos positivos clasificando cada hallazgo crudo
 * de un scout (v0.4 §3.6). Es un `BrainAgent`: prompt + parser, sin estado.
 *
 * DG-111 Step 2: el constructor acepta opcionalmente un `currentDate` para
 * inyectar al user prompt; en produccion se default-ea a `new Date()`; tests
 * inyectan un valor fijo para determinism.
 */
export class TriageAgent implements BrainAgent<Finding, TriageVerdict> {
  readonly id = 'triage';
  readonly displayName = 'Triage Agent';
  readonly maxTokens = 512;
  readonly #currentDate: string;

  constructor(options: TriageAgentOptions = {}) {
    this.#currentDate = options.currentDate ?? currentDateIso();
  }

  buildPrompt(finding: Finding): AgentPrompt {
    const snippet = finding.location.snippet ?? '(not available)';
    const user = [
      `Current date (real-world authoritative): ${this.#currentDate}`,
      '',
      'Finding to triage:',
      `- Rule: ${finding.ruleId}`,
      `- Category: ${finding.category}`,
      `- Severity: ${finding.severity}`,
      `- Title: ${finding.title}`,
      `- Message: ${finding.message}`,
      `- Location: ${finding.location.path}:${String(finding.location.startLine)}`,
      `- Code:\n${snippet}`,
    ].join('\n');
    return { system: SYSTEM_PROMPT, user };
  }

  parseResponse(raw: string): TriageVerdict {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(raw));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not parse the triage verdict: ${message}`);
    }
    const verdict = TriageVerdictSchema.parse(parsed);
    return guardAgainstFabricatedDismissals(verdict);
  }
}
