import type {
  ContextExplanation,
  ContextGroundTruth,
  Finding,
  GroundTruthEntry,
  KeywordOrAlternatives,
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

/**
 * Verifica que `haystack` (normalizado) contenga todos los `keywords`
 * (normalizados). Cada keyword puede ser un string (literal) o un array
 * de sinónimos (cualquiera del array cuenta como hit — recalibración de
 * DG-077). Reporta el "label" del keyword faltante (primer elemento del
 * array, o el string).
 */
function containsAll(
  haystack: string,
  keywords: readonly KeywordOrAlternatives[],
): {
  ok: boolean;
  missing: readonly string[];
} {
  const hay = normalize(haystack);
  const missing: string[] = [];
  for (const keyword of keywords) {
    if (typeof keyword === 'string') {
      if (!hay.includes(normalize(keyword))) {
        missing.push(keyword);
      }
    } else {
      // Array de sinónimos: pasa si cualquiera está presente.
      const matched = keyword.some((syn) => hay.includes(normalize(syn)));
      if (!matched) {
        // Label del missing = primer sinónimo (representativo).
        missing.push(keyword[0] ?? '(empty alternatives)');
      }
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
 * Anonimiza el path del fixture para evitar que el LLM haga meta-razonamiento
 * sobre "esto es codigo de testing" en vez de evaluar el codigo en si.
 *
 * Path leak issue descubierto en DG-077 via `--verbose` probe: cuando el Brain
 * Layer ve `Finding.location.path = "packages/scouts/tests/.../fixtures/
 * vulnerable/<lang>/<file>"`, los segmentos `tests/`, `fixtures/` y
 * `vulnerable/` delatan que es codigo de test y producen clasificaciones
 * `inconclusive` en vez de `true_positive` (root cause del 1.3% Triage PASS
 * persistente de Anthropic).
 *
 * Heuristica: tomar el ultimo segmento (filename) + el penultimo si es un
 * lenguaje conocido. Prefijar con `src/` para que el path luzca como codigo
 * de aplicacion real.
 *
 *   packages/scouts/tests/opengrep/fixtures/vulnerable/javascript/eval.js
 *     -> src/javascript/eval.js
 *   packages/scouts/tests/gitleaks/fixtures/secrets/leaked-config.js
 *     -> src/leaked-config.js
 *   packages/scouts/tests/checkov/fixtures/iac/Dockerfile
 *     -> src/Dockerfile
 *
 * El `category` del Finding (que SI se pasa al LLM) ya transmite la categoria
 * (SAST/Secrets/IaC/etc); cualquier hint que el path daria sobre categoria es
 * redundante. La anonimizacion no pierde informacion util — preserva el
 * lenguaje cuando es claro y el basename siempre.
 */
const KNOWN_LANGS: ReadonlySet<string> = new Set(['javascript', 'typescript', 'python']);

export function anonymizeFixturePath(fixturePath: string): string {
  const segments = fixturePath.split('/').filter((s) => s.length > 0);
  const filename = segments.at(-1) ?? 'unknown';
  const parent = segments.at(-2);
  if (parent !== undefined && KNOWN_LANGS.has(parent)) {
    return `src/${parent}/${filename}`;
  }
  return `src/${filename}`;
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
 * El `location.path` se anonimiza para no delatar el contexto de testing
 * (DG-084 A path leak fix). El `fingerprint` usa el path anonimizado por
 * consistencia interna (el fingerprint sintetico no se persiste cross-runs
 * porque `scanId: 'benchmark'` — los Findings reales del scan persisten
 * con su path original, no se ven afectados).
 *
 * El `snippet` se carga desde el fixture real si existe; si no, queda
 * undefined (el Brain Layer es robusto a ese caso — lo declara
 * "(not available)" en el prompt).
 */
export function buildSyntheticFinding(entry: GroundTruthEntry, snippetText?: string): Finding {
  const anonymizedPath = anonymizeFixturePath(entry.fixturePath);
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
      path: anonymizedPath,
      startLine: entry.line,
      ...(snippetText !== undefined ? { snippet: snippetText } : {}),
    },
    complianceRefs: [],
    fingerprint: `${anonymizedPath}:${entry.ruleId}:${String(entry.line)}`,
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
