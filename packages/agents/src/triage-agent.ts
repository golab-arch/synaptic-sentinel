import {
  TRIAGE_CLASSIFICATIONS,
  TriageClassificationSchema,
  TriageVerdictSchema,
  type DataflowTrace,
  type Finding,
  type FindingCategory,
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

Respond ONLY with a valid JSON object, no markdown and no extra text. Use the
field order shown below: write the rationale FIRST as a brief reasoning chain
over the scanner-confirmed facts and the exploitability question, THEN derive
the classification and confidence from your reasoning. The order matters —
committing to a classification before reasoning produces verdicts that
contradict their own rationale.
{"rationale":"<brief reasoning in English, at most 2 sentences, walking through the scanner-confirmed facts and the exploitability question before committing to a verdict>","classification":"true_positive"|"false_positive"|"inconclusive","confidence":<number between 0 and 1>}`;

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
 * Cap defensivo sobre el numero de intermediate steps que se incluyen en
 * el prompt (DG-112 A Step 3). Traces patologicos (>25 steps, repos con
 * deep call chains) colapsan el medio para evitar prompt bloat.
 *
 * El cap aplica SOLO al prompt; el `Finding.dataflowTrace` persistido en
 * `colony.db` mantiene fidelity completa.
 */
export const MAX_INTERMEDIATE_STEPS_IN_PROMPT = 25;

/**
 * Cap defensivo sobre la longitud del `content` de cada step en el prompt
 * (DG-112 A Step 3). Contents patologicos (sinks con expresiones largas,
 * statements multi-linea minificados) se truncan a esta longitud.
 */
export const MAX_CONTENT_CHARS_PER_STEP = 200;

/** Trunca `content` con un sufijo `…` si excede `MAX_CONTENT_CHARS_PER_STEP`. */
function truncateContent(content: string): string {
  if (content.length <= MAX_CONTENT_CHARS_PER_STEP) return content;
  return `${content.slice(0, MAX_CONTENT_CHARS_PER_STEP - 1)}…`;
}

/**
 * Formatea un `DataflowTrace` para incluir en el user prompt del Triage
 * Agent (DG-112 A Step 3). Aplica caps defensivos: si los intermediate
 * steps exceden `MAX_INTERMEDIATE_STEPS_IN_PROMPT`, colapsa el medio
 * (primera mitad + ellipsis + segunda mitad). Cada `content` se trunca a
 * `MAX_CONTENT_CHARS_PER_STEP`. Funcion pura testeable.
 */
export function formatDataflowTrace(trace: DataflowTrace): string {
  let steps = trace.intermediateSteps;
  let elided = 0;
  if (steps.length > MAX_INTERMEDIATE_STEPS_IN_PROMPT) {
    elided = steps.length - MAX_INTERMEDIATE_STEPS_IN_PROMPT;
    const half = Math.floor(MAX_INTERMEDIATE_STEPS_IN_PROMPT / 2);
    steps = [...steps.slice(0, half), ...steps.slice(-half)];
  }
  const halfMark = Math.floor(MAX_INTERMEDIATE_STEPS_IN_PROMPT / 2);
  const lines: string[] = [];
  lines.push(
    `- Source: ${trace.source.path}:${String(trace.source.startLine)} \`${truncateContent(trace.source.content)}\``,
  );
  steps.forEach((step, i) => {
    if (elided > 0 && i === halfMark) {
      lines.push(`- … (${String(elided)} step${elided === 1 ? '' : 's'} elided for prompt size)`);
    }
    lines.push(
      `- Step ${String(i + 1)}: ${step.path}:${String(step.startLine)} \`${truncateContent(step.content)}\``,
    );
  });
  lines.push(
    `- Sink: ${trace.sink.path}:${String(trace.sink.startLine)} \`${truncateContent(trace.sink.content)}\``,
  );
  return lines.join('\n');
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
 *
 * DG-111.2 A (Step 2 precision hotfix): el guard solo se aplica a findings
 * de `SCA` (Software Composition Analysis). El temporal-cutoff bug que
 * motivo el guard *solo* aplica a SCA — donde el modelo dismissea CVE IDs,
 * versions y advisory dates como fabricated. Findings de `Secrets`, `SAST`,
 * `IaC`, `VibeCoded` y `BusinessLogic` NO tienen ese class de metadata, y
 * sus rationales legitimos de FP pueden usar palabras del set por razones
 * inocuas (ej. "not a real production secret" en un test fixture de
 * `Secrets`). Caso documentado en Entry #129: generic-api-key en
 * `src/tests/sai-checks.test.ts:119` pasaba de FP 0.9 a INC 0.5 por
 * misfire del guard sobre wording legitimo del fixture.
 */
export function guardAgainstFabricatedDismissals(
  verdict: TriageVerdict,
  findingCategory: string,
): TriageVerdict {
  // DG-111.2 A: scope gate — el guard solo aplica a SCA.
  if (findingCategory !== 'SCA') return verdict;
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
  /**
   * Categoria del ultimo finding pasado a `buildPrompt`. Sirve para que
   * `parseResponse` pueda gatear el guard `guardAgainstFabricatedDismissals`
   * por category (DG-111.2 A: solo aplica a SCA). El BrainAgent contract
   * llama a `buildPrompt(finding)` y luego a `parseResponse(raw)` en
   * sequence (ver `runAgent`), asi que este campo refleja el finding del
   * call actual. `''` antes de cualquier `buildPrompt` — el guard skip-ea.
   */
  #lastFindingCategory: FindingCategory | '' = '';

  constructor(options: TriageAgentOptions = {}) {
    this.#currentDate = options.currentDate ?? currentDateIso();
  }

  buildPrompt(finding: Finding): AgentPrompt {
    this.#lastFindingCategory = finding.category;
    const snippet = finding.location.snippet ?? '(not available)';
    // DG-112 A Step 3: incluye el dataflow trace cuando esta disponible
    // (reglas mode:taint del OpenGrep scout) para que el modelo razone
    // sobre reachability source→sink real en lugar de solo el snippet.
    const dataflowSection =
      finding.dataflowTrace !== undefined
        ? [
            '',
            'Dataflow trace (source → intermediate → sink):',
            formatDataflowTrace(finding.dataflowTrace),
          ]
        : [];
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
      ...dataflowSection,
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
    return guardAgainstFabricatedDismissals(verdict, this.#lastFindingCategory);
  }
}
