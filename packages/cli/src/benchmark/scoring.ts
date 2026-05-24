import type {
  ContextExplanation,
  ContextGroundTruth,
  Finding,
  GroundTruthEntry,
  RemediationGroundTruth,
  RemediationSuggestion,
  TriageGroundTruth,
  TriageVerdict,
} from '@synaptic-sentinel/core';

/**
 * Funciones puras de scoring para el benchmark cross-provider (DG-076 B).
 *
 * Toman la salida REAL de cada agente (Triage / Context / Remediation) +
 * la entry del ground truth correspondiente y devuelven un veredicto
 * binario (PASS / FAIL) + el motivo. Las funciones son totalmente
 * deterministas — el benchmark las usa para puntuar cada {provider,
 * model, run} sin depender del juicio del LLM evaluador.
 *
 * Las 3 capas son independientes: un FAIL en Triage NO descalifica
 * Context ni Remediation (esos solo corren si Triage clasifica TP). El
 * benchmark reporta cada capa por separado.
 */

/** Resultado de una sola comparacion contra ground truth. */
export interface ScoreResult {
  readonly pass: boolean;
  readonly reasons: readonly string[];
}

/** Convierte un keyword a minusculas + collapse de whitespace para comparacion case-insensitive. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

/** Verifica que `haystack` (normalizado) contenga todos los `keywords` (normalizados). */
function containsAll(
  haystack: string,
  keywords: readonly string[],
): {
  ok: boolean;
  missing: readonly string[];
} {
  const hay = normalize(haystack);
  const missing: string[] = [];
  for (const keyword of keywords) {
    if (!hay.includes(normalize(keyword))) {
      missing.push(keyword);
    }
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Puntua el resultado del Triage Agent contra el ground truth.
 *
 * PASS si y solo si:
 *   1. `classification` matchea exacto.
 *   2. `confidence >= minConfidence`.
 *   3. `rationale` contiene todos los `requiredKeywords` (case-insensitive).
 */
export function triagePass(actual: TriageVerdict, expected: TriageGroundTruth): ScoreResult {
  const reasons: string[] = [];
  if (actual.classification !== expected.classification) {
    reasons.push(
      `classification mismatch: expected ${expected.classification}, got ${actual.classification}`,
    );
  }
  if (actual.confidence < expected.minConfidence) {
    reasons.push(
      `confidence ${actual.confidence.toFixed(2)} below threshold ${expected.minConfidence.toFixed(2)}`,
    );
  }
  const keywords = containsAll(actual.rationale, expected.requiredKeywords);
  if (!keywords.ok) {
    reasons.push(`rationale missing keywords: ${keywords.missing.join(', ')}`);
  }
  return { pass: reasons.length === 0, reasons };
}

/**
 * Puntua el resultado del Context Agent contra el ground truth.
 *
 * Solo aplica si la entry tenia ground truth de context (clasificada TP).
 * PASS si los 4 fields (`summary`, `entryPoint`, `sink`, `exposure`)
 * contienen cada uno sus respectivos keywords.
 */
export function contextPass(actual: ContextExplanation, expected: ContextGroundTruth): ScoreResult {
  const reasons: string[] = [];
  for (const [field, value, list] of [
    ['summary', actual.summary, expected.summaryKeywords],
    ['entryPoint', actual.entryPoint, expected.entryPointKeywords],
    ['sink', actual.sink, expected.sinkKeywords],
    ['exposure', actual.exposure, expected.exposureKeywords],
  ] as const) {
    const check = containsAll(value, list);
    if (!check.ok) {
      reasons.push(`${field} missing keywords: ${check.missing.join(', ')}`);
    }
  }
  return { pass: reasons.length === 0, reasons };
}

/**
 * Puntua el resultado del Remediation Agent contra el ground truth.
 *
 * PASS si:
 *   1. `summary` contiene `summaryKeywords`.
 *   2. `recommendation` contiene `recommendationKeywords`.
 *   3. Si hay `fixedSnippet`, NO contiene ninguno de los `forbiddenInSnippet`.
 *
 * Validacion 3 es por NEGATIVA: un buen fix elimina el sink original.
 * Si no hay `fixedSnippet`, el check 3 se saltea (recommendation puede
 * ser de proceso/config sin snippet).
 */
export function remediationPass(
  actual: RemediationSuggestion,
  expected: RemediationGroundTruth,
): ScoreResult {
  const reasons: string[] = [];
  const summaryCheck = containsAll(actual.summary, expected.summaryKeywords);
  if (!summaryCheck.ok) {
    reasons.push(`summary missing keywords: ${summaryCheck.missing.join(', ')}`);
  }
  const recCheck = containsAll(actual.recommendation, expected.recommendationKeywords);
  if (!recCheck.ok) {
    reasons.push(`recommendation missing keywords: ${recCheck.missing.join(', ')}`);
  }
  if (actual.fixedSnippet !== undefined && expected.forbiddenInSnippet.length > 0) {
    const snippetNorm = normalize(actual.fixedSnippet);
    const offenders: string[] = [];
    for (const forbidden of expected.forbiddenInSnippet) {
      if (snippetNorm.includes(normalize(forbidden))) {
        offenders.push(forbidden);
      }
    }
    if (offenders.length > 0) {
      reasons.push(`fixedSnippet still contains forbidden patterns: ${offenders.join(', ')}`);
    }
  }
  return { pass: reasons.length === 0, reasons };
}

/**
 * Construye un `Finding` sintetico desde una entry del ground truth.
 *
 * El benchmark NO corre los scouts reales (eso ya esta cubierto por los
 * integration tests de cada scout). Lo unico que necesita es darle al
 * Brain Layer un `Finding` con la forma esperada — los campos clave son
 * `ruleId`, `category`, `severity`, `title`, `message`, `location.path`,
 * `location.startLine`, `location.snippet` (cuando aplica).
 *
 * El `snippet` se carga desde el fixture real si existe; si no, queda
 * undefined (el Brain Layer es robusto a ese caso — lo declara
 * "(not available)" en el prompt).
 */
export function buildSyntheticFinding(entry: GroundTruthEntry, snippetText?: string): Finding {
  return {
    id: `bench-${entry.ruleId}-${String(entry.line)}`,
    scanId: 'benchmark',
    scoutId: scoutIdFromCategory(entry.category),
    severity: entry.severity,
    category: entry.category,
    ruleId: entry.ruleId,
    title: entry.description,
    message: entry.description,
    location: {
      path: entry.fixturePath,
      startLine: entry.line,
      ...(snippetText !== undefined ? { snippet: snippetText } : {}),
    },
    complianceRefs: [],
    fingerprint: `${entry.fixturePath}:${entry.ruleId}:${String(entry.line)}`,
    lifecycleState: 'new',
    createdAt: '2026-05-23T22:30:00.000Z',
  } satisfies Finding;
}

/** Mapeo categoria -> scoutId canonico (el Brain Layer no se entera). */
function scoutIdFromCategory(category: Finding['category']): string {
  switch (category) {
    case 'SAST':
      return 'opengrep';
    case 'Secrets':
      return 'gitleaks';
    case 'SCA':
      return 'trivy';
    case 'IaC':
      return 'checkov';
    case 'VibeCoded':
      return 'vibe-detect';
    case 'BusinessLogic':
      // BusinessLogic es categoria del core (v0.4 §3.4) pero no la usa
      // ningun scout actual de Sentinel. Si llega aqui via ground truth,
      // lo tratamos como SAST-equivalente para que el benchmark corra.
      return 'opengrep';
  }
}
