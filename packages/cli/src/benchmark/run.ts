#!/usr/bin/env node
/**
 * Brain Layer cross-provider benchmark runner (DG-076 B).
 *
 * Lee el ground truth (DG-075 C) + los providers configurados via env
 * vars + corre los 3 agentes (Triage / Context / Remediation) contra
 * cada {provider, model} × entry × N runs. Mide JSON validity,
 * classification accuracy (vs ground truth), latency, tokens y costo
 * (via la tabla `pricing.json`). Emite el reporte como Markdown
 * (`docs/benchmark/v0.3.0-DRAFT.md` por default).
 *
 * Como correrlo (sin keys cloud, solo validacion del plumbing):
 *
 *   pnpm benchmark:run -- --dry-run
 *
 * Como correrlo con providers reales:
 *
 *   export SENTINEL_ANTHROPIC_API_KEY=sk-ant-...
 *   export SENTINEL_OPENAI_API_KEY=sk-...
 *   export SENTINEL_DEEPSEEK_API_KEY=sk-...
 *   export SENTINEL_GROQ_API_KEY=gsk_...
 *   # Ollama: requiere daemon corriendo en localhost:11434
 *   pnpm benchmark:run -- --runs 3 --output docs/benchmark/v0.3.0-DRAFT.md
 *
 * Anti-optimismo ilusorio: este script NO publica el reporte. Lo
 * commitea el usuario manualmente tras revisar. Los numeros llevan
 * disclaimer fuerte si el ground truth sigue siendo ai-draft.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BenchmarkGroundTruthSchema,
  countByReviewStatus,
  estimateCostUsd,
  GROUND_TRUTH_PATH,
  type AgentConfig,
  type BenchmarkGroundTruth,
  type BrainAgentId,
  type ContextExplanation,
  type GroundTruthEntry,
  type RemediationSuggestion,
  type TriageVerdict,
} from '@synaptic-sentinel/core';
import {
  ContextAgent,
  createLlmClient,
  RemediationAgent,
  resolveApiKeyFromEnv,
  TriageAgent,
  type LlmClient,
} from '@synaptic-sentinel/agents';
import { buildSyntheticFinding, contextPass, remediationPass, triagePass } from './scoring.js';
import {
  renderBenchmarkReport,
  type AgentRollup,
  type BenchmarkReport,
  type ProviderResult,
} from './report.js';

/** Inicializa un AgentRollup vacio. */
function emptyRollup(): AgentRollup {
  return {
    invocations: 0,
    jsonValid: 0,
    passed: 0,
    totalLatencyMs: 0,
    latencies: [],
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** Inmutablemente acumula una sola medicion en un rollup. */
function accumulate(
  rollup: AgentRollup,
  measurement: {
    jsonValid: boolean;
    passed: boolean;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
  },
): AgentRollup {
  return {
    invocations: rollup.invocations + 1,
    jsonValid: rollup.jsonValid + (measurement.jsonValid ? 1 : 0),
    passed: rollup.passed + (measurement.passed ? 1 : 0),
    totalLatencyMs: rollup.totalLatencyMs + measurement.latencyMs,
    latencies: [...rollup.latencies, measurement.latencyMs],
    inputTokens: rollup.inputTokens + measurement.inputTokens,
    outputTokens: rollup.outputTokens + measurement.outputTokens,
  };
}

/**
 * Mock LlmClient determinista para `--dry-run`. Devuelve siempre el
 * "perfect answer" del ground truth para verificar que el plumbing
 * pasa. Los unit tests del benchmark usan este patron tambien.
 */
function makeDryRunMockClient(agent: BrainAgentId, entry: GroundTruthEntry): LlmClient {
  return {
    complete: () => {
      if (agent === 'triage') {
        const v: TriageVerdict = {
          classification: entry.triage.classification,
          confidence: Math.max(entry.triage.minConfidence, 0.9),
          rationale: `Mock rationale for ${entry.ruleId}: ${entry.triage.requiredKeywords.join(', ')}.`,
        };
        return Promise.resolve(JSON.stringify(v));
      }
      if (agent === 'context' && entry.context !== undefined) {
        const v: ContextExplanation = {
          summary: `Mock summary: ${entry.context.summaryKeywords.join(', ')}.`,
          entryPoint: `Mock entryPoint: ${entry.context.entryPointKeywords.join(', ')}.`,
          sink: `Mock sink: ${entry.context.sinkKeywords.join(', ')}.`,
          exposure: `Mock exposure: ${entry.context.exposureKeywords.join(', ')}.`,
        };
        return Promise.resolve(JSON.stringify(v));
      }
      if (agent === 'remediation' && entry.remediation !== undefined) {
        const v: RemediationSuggestion = {
          summary: `Mock summary: ${entry.remediation.summaryKeywords.join(', ')}.`,
          recommendation: `Mock recommendation: ${entry.remediation.recommendationKeywords.join(', ')}.`,
        };
        return Promise.resolve(JSON.stringify(v));
      }
      throw new Error(`Mock client called for unsupported agent: ${agent}`);
    },
  };
}

/** Construye los 4 providers cloud + Ollama desde env vars. */
function resolveProvidersFromEnv(env: Readonly<Record<string, string | undefined>>): {
  configured: { label: string; config: AgentConfig }[];
  notRun: { providerLabel: string; reason: string }[];
} {
  const configured: { label: string; config: AgentConfig }[] = [];
  const notRun: { providerLabel: string; reason: string }[] = [];

  // Anthropic Haiku 4.5 — baseline default.
  if (resolveApiKeyFromEnv('anthropic', env) !== undefined) {
    configured.push({
      label: 'anthropic/claude-haiku-4-5-20251001',
      config: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    });
  } else {
    notRun.push({
      providerLabel: 'anthropic/claude-haiku-4-5-20251001',
      reason: 'SENTINEL_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) not set.',
    });
  }

  // OpenAI GPT-5 nano — cost-killer cloud frontier.
  if (resolveApiKeyFromEnv('openai', env) !== undefined) {
    configured.push({
      label: 'openai/gpt-5-nano',
      config: { provider: 'openai', model: 'gpt-5-nano' },
    });
  } else {
    notRun.push({
      providerLabel: 'openai/gpt-5-nano',
      reason: 'SENTINEL_OPENAI_API_KEY not set.',
    });
  }

  // DeepSeek V4 Flash — cost-killer. (Empíricamente verificado en el PILOT
  // de DG-077: deepseek-v3.2 ya no existe en el API; los names actuales son
  // `deepseek-v4-flash` y `deepseek-v4-pro`. Flash es el cheap-tier.)
  if (resolveApiKeyFromEnv('deepseek', env) !== undefined) {
    configured.push({
      label: 'deepseek/deepseek-v4-flash',
      config: { provider: 'deepseek', model: 'deepseek-v4-flash' },
    });
  } else {
    notRun.push({
      providerLabel: 'deepseek/deepseek-v4-flash',
      reason: 'SENTINEL_DEEPSEEK_API_KEY not set.',
    });
  }

  // Groq Llama 3.3 70B — speed king (free tier disponible).
  if (resolveApiKeyFromEnv('groq', env) !== undefined) {
    configured.push({
      label: 'groq/llama-3.3-70b-versatile',
      config: { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    });
  } else {
    notRun.push({
      providerLabel: 'groq/llama-3.3-70b-versatile',
      reason: 'SENTINEL_GROQ_API_KEY not set.',
    });
  }

  // Gemini 2.5 Flash — cheap-tier de Google via su layer OpenAI-compat
  // (baseUrl default en el provider registry). Comparable a Haiku/gpt-5-nano.
  if (resolveApiKeyFromEnv('gemini', env) !== undefined) {
    configured.push({
      label: 'gemini/gemini-2.5-flash',
      config: { provider: 'gemini', model: 'gemini-2.5-flash' },
    });
  } else {
    notRun.push({
      providerLabel: 'gemini/gemini-2.5-flash',
      reason: 'SENTINEL_GEMINI_API_KEY not set.',
    });
  }

  // Ollama local — primary recommended local (DG-070).
  // Modelo configurable via env `SENTINEL_OLLAMA_MODEL` (default mistral-nemo:12b).
  // El usuario eligio Gemma 4 que esta descargando — al correr esto, exporta
  // SENTINEL_OLLAMA_MODEL=gemma3:latest (o el tag que use Ollama para Gemma 4).
  const ollamaModel = env['SENTINEL_OLLAMA_MODEL'] ?? 'mistral-nemo:12b';
  configured.push({
    label: `ollama/${ollamaModel}`,
    config: { provider: 'ollama', model: ollamaModel },
  });

  return { configured, notRun };
}

/**
 * Mide UNA sola llamada al LLM + scoring contra ground truth.
 *
 * Devuelve también `rawSample` (primeros ~200 chars del raw response, sin
 * newlines) cuando hay raw disponible. Lo usa el modo `--verbose` para
 * mostrar visibilidad por call. `undefined` si la llamada falló antes de
 * obtener raw.
 */
async function measureOnce<TOutput>(
  llm: LlmClient,
  buildPrompt: () => { system: string; user: string; maxTokens: number },
  parseOutput: (raw: string) => TOutput,
  scoreOutput: (output: TOutput) => boolean,
): Promise<{
  jsonValid: boolean;
  passed: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  rawSample?: string;
}> {
  const prompt = buildPrompt();
  const start = Date.now();
  let raw: string;
  try {
    raw = await llm.complete({
      system: prompt.system,
      user: prompt.user,
      maxTokens: prompt.maxTokens,
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    return {
      jsonValid: false,
      passed: false,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const latencyMs = Date.now() - start;
  // Sample del raw para verbose mode: 200 chars con newlines collapsed
  // (\n y \t → espacios) para que cada call quede en una sola línea de log.
  const rawSample = raw.replace(/[\n\r\t]+/g, ' ').slice(0, 200);
  let parsed: TOutput;
  try {
    parsed = parseOutput(raw);
  } catch (err) {
    return {
      jsonValid: false,
      passed: false,
      latencyMs,
      inputTokens: 0, // no podemos extraer del raw fallido
      outputTokens: 0,
      error: err instanceof Error ? err.message : String(err),
      rawSample,
    };
  }
  // Tokens: el contrato LlmClient.complete devuelve solo `string`, asi que
  // sin tocar el contrato (DG-073 B respeta esto) no tenemos `usage`. El
  // benchmark estima un proxy: input ≈ length de prompt / 4; output ≈
  // length de raw / 4 (heuristica de OpenAI: ~4 chars/token en ingles).
  // Esto introduce error en cost estimate pero conserva el orden de
  // magnitud — el reporte lo documenta.
  const inputTokens = Math.ceil((prompt.system.length + prompt.user.length) / 4);
  const outputTokens = Math.ceil(raw.length / 4);
  return {
    jsonValid: true,
    passed: scoreOutput(parsed),
    latencyMs,
    inputTokens,
    outputTokens,
    rawSample,
  };
}

/** Imprime una línea verbose para una sola medición (--verbose mode). */
function emitVerboseLine(
  providerLabel: string,
  agent: BrainAgentId,
  entry: GroundTruthEntry,
  runIdx: number,
  measurement: {
    jsonValid: boolean;
    passed: boolean;
    latencyMs: number;
    error?: string;
    rawSample?: string;
  },
): void {
  const status = measurement.error !== undefined ? 'ERR' : measurement.passed ? 'PASS' : 'FAIL';
  const validity = measurement.jsonValid ? 'JSON' : 'NOJSON';
  const tail =
    measurement.error !== undefined
      ? `error="${measurement.error.slice(0, 160)}"`
      : `raw="${measurement.rawSample ?? ''}"`;
  console.log(
    `[verbose] ${providerLabel} | ${agent} | ${entry.ruleId} | run=${String(runIdx)} | ${status} ${validity} | ${String(measurement.latencyMs)}ms | ${tail}`,
  );
}

/** Corre el benchmark contra un solo provider sobre todas las entries × runs. */
async function runProvider(args: {
  providerLabel: string;
  config: AgentConfig;
  entries: readonly GroundTruthEntry[];
  runsPerEntry: number;
  dryRun: boolean;
  verbose: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ProviderResult> {
  const errors: string[] = [];
  let triage = emptyRollup();
  let context = emptyRollup();
  let remediation = emptyRollup();
  const triageClassByEntry = new Map<string, string[]>();

  const triageAgent = new TriageAgent();
  const contextAgent = new ContextAgent();
  const remediationAgent = new RemediationAgent();

  let attemptedRuns = 0;
  let completedRuns = 0;

  for (const entry of args.entries) {
    const finding = buildSyntheticFinding(entry);
    const classifications: string[] = [];
    for (let run = 0; run < args.runsPerEntry; run += 1) {
      attemptedRuns += 1;

      // === Triage ===
      const triageLlm: LlmClient = args.dryRun
        ? makeDryRunMockClient('triage', entry)
        : createLlmClient({
            config: args.config,
            agentId: 'triage',
            ...(resolveApiKeyFromEnv(args.config.provider) !== undefined
              ? { apiKey: resolveApiKeyFromEnv(args.config.provider) as string }
              : {}),
            ...(args.fetchImpl !== undefined ? { fetchImpl: args.fetchImpl } : {}),
          });

      const triageMeasurement = await measureOnce(
        triageLlm,
        () => {
          const prompt = triageAgent.buildPrompt(finding);
          return { system: prompt.system, user: prompt.user, maxTokens: triageAgent.maxTokens };
        },
        (raw) => triageAgent.parseResponse(raw),
        (verdict) => {
          classifications.push(verdict.classification);
          return triagePass(verdict, entry.triage).pass;
        },
      );
      if (triageMeasurement.error !== undefined) {
        errors.push(`${entry.ruleId} triage: ${triageMeasurement.error}`);
      }
      if (args.verbose) {
        emitVerboseLine(args.providerLabel, 'triage', entry, run, triageMeasurement);
      }
      triage = accumulate(triage, triageMeasurement);
      completedRuns += 1;

      // Solo corremos Context + Remediation si Triage paso Y la entry tiene
      // ground truth de las dos capas (TP entries).
      const expectedTp = entry.triage.classification === 'true_positive';
      if (!expectedTp) continue;
      if (entry.context === undefined || entry.remediation === undefined) continue;
      if (!triageMeasurement.jsonValid) continue;

      // === Context ===
      const contextLlm: LlmClient = args.dryRun
        ? makeDryRunMockClient('context', entry)
        : createLlmClient({
            config: args.config,
            agentId: 'context',
            ...(resolveApiKeyFromEnv(args.config.provider) !== undefined
              ? { apiKey: resolveApiKeyFromEnv(args.config.provider) as string }
              : {}),
            ...(args.fetchImpl !== undefined ? { fetchImpl: args.fetchImpl } : {}),
          });
      const contextMeasurement = await measureOnce(
        contextLlm,
        () => {
          const prompt = contextAgent.buildPrompt(finding);
          return { system: prompt.system, user: prompt.user, maxTokens: contextAgent.maxTokens };
        },
        (raw) => contextAgent.parseResponse(raw),
        (explanation) => {
          // `entry.context` esta garantizado por el guard "expectedTp +
          // entry.context !== undefined" arriba; el cast es estructural.
          return contextPass(explanation, entry.context!).pass;
        },
      );
      if (contextMeasurement.error !== undefined) {
        errors.push(`${entry.ruleId} context: ${contextMeasurement.error}`);
      }
      if (args.verbose) {
        emitVerboseLine(args.providerLabel, 'context', entry, run, contextMeasurement);
      }
      context = accumulate(context, contextMeasurement);

      // === Remediation ===
      const remediationLlm: LlmClient = args.dryRun
        ? makeDryRunMockClient('remediation', entry)
        : createLlmClient({
            config: args.config,
            agentId: 'remediation',
            ...(resolveApiKeyFromEnv(args.config.provider) !== undefined
              ? { apiKey: resolveApiKeyFromEnv(args.config.provider) as string }
              : {}),
            ...(args.fetchImpl !== undefined ? { fetchImpl: args.fetchImpl } : {}),
          });
      const remediationMeasurement = await measureOnce(
        remediationLlm,
        () => {
          const prompt = remediationAgent.buildPrompt(finding);
          return {
            system: prompt.system,
            user: prompt.user,
            maxTokens: remediationAgent.maxTokens,
          };
        },
        (raw) => remediationAgent.parseResponse(raw),
        (sugg) => remediationPass(sugg, entry.remediation!).pass,
      );
      if (remediationMeasurement.error !== undefined) {
        errors.push(`${entry.ruleId} remediation: ${remediationMeasurement.error}`);
      }
      if (args.verbose) {
        emitVerboseLine(args.providerLabel, 'remediation', entry, run, remediationMeasurement);
      }
      remediation = accumulate(remediation, remediationMeasurement);
    }
    // Identificador estable de la entry (fixturePath + line + ruleId).
    triageClassByEntry.set(
      `${entry.fixturePath}:${entry.ruleId}:${String(entry.line)}`,
      classifications,
    );
  }

  // Determinism: % de pares de runs de la misma entry que coinciden en classification.
  let totalPairs = 0;
  let agreePairs = 0;
  for (const classifs of triageClassByEntry.values()) {
    for (let i = 0; i < classifs.length; i += 1) {
      for (let j = i + 1; j < classifs.length; j += 1) {
        totalPairs += 1;
        if (classifs[i] === classifs[j]) agreePairs += 1;
      }
    }
  }
  const determinismRate = totalPairs === 0 ? null : agreePairs / totalPairs;

  return {
    providerLabel: args.providerLabel,
    attemptedRuns,
    completedRuns,
    triage,
    context,
    remediation,
    estimatedCostUsd: 0, // se setea en el caller con la pricing table
    determinismRate,
    errors,
  };
}

/** Encuentra la raiz del repo (subiendo desde el script hasta ver `.synaptic/`). */
function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.synaptic'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate repo root (no .synaptic/ ancestor of ${start})`);
}

/** Entry point del script. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      runs: { type: 'string', default: '3' },
      output: { type: 'string', default: 'docs/benchmark/v0.3.0-DRAFT.md' },
      verbose: { type: 'boolean', default: false },
      entries: { type: 'string' },
      providers: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (values.help === true) {
    console.log(
      `Brain Layer cross-provider benchmark runner (DG-076 B + DG-077 B verbose mode).

Usage:
  pnpm benchmark:run [-- --dry-run] [-- --runs <n>] [-- --output <path>]
                     [-- --verbose] [-- --entries <ruleId,ruleId,...>]
                     [-- --providers <name,name,...>]

Flags:
  --dry-run                Mock LLM clients (no network calls). Smoke test.
  --runs <n>               Runs per entry. Default 3.
  --output <path>          Output Markdown path. Default docs/benchmark/v0.3.0-DRAFT.md.
  --verbose                Emit one log line per LLM call (provider | agent |
                           ruleId | run | PASS/FAIL/ERR | JSON/NOJSON | latency |
                           200-char raw sample). Useful for manual debugging.
  --entries <ids>          Comma-separated ruleIds to include. Filters the ground
                           truth before running. Useful for single-entry testing.
                           Example: --entries sentinel-js-eval-usage,vibe-fixme-security
  --providers <names>      Comma-separated provider names to include. Filters from
                           the env-resolved set. Skip providers not in this list.
                           Example: --providers anthropic,deepseek

Manual single-call probe:
  pnpm benchmark:run -- --verbose --runs 1 --providers anthropic \\
                        --entries sentinel-js-eval-usage --output /tmp/probe.md
`,
    );
    return;
  }

  const runsPerEntry = Number.parseInt(values.runs as string, 10);
  if (!Number.isInteger(runsPerEntry) || runsPerEntry < 1) {
    console.error('--runs must be a positive integer.');
    process.exitCode = 1;
    return;
  }
  const dryRun = values['dry-run'] === true;
  const verbose = values.verbose === true;
  // Filtros opcionales: vienen como "id1,id2,id3" — los partimos y trimeamos.
  const entriesFilter =
    typeof values.entries === 'string'
      ? new Set(
          values.entries
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
        )
      : null;
  const providersFilter =
    typeof values.providers === 'string'
      ? new Set(
          values.providers
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s.length > 0),
        )
      : null;

  const repoRoot = findRepoRoot(resolve(process.cwd()));
  const groundTruthPath = join(repoRoot, GROUND_TRUTH_PATH);
  const groundTruth: BenchmarkGroundTruth = BenchmarkGroundTruthSchema.parse(
    JSON.parse(readFileSync(groundTruthPath, 'utf8')),
  );
  // Pricing table viene de @synaptic-sentinel/core como single source of
  // truth (DG-078 B). El antiguo loadPricing(repoRoot) que leia
  // tests/benchmark/pricing.json fue eliminado.

  // Aplicar filtro de entries (--entries): si está activo, retener solo las que matchean.
  const filteredEntries =
    entriesFilter === null
      ? groundTruth.entries
      : groundTruth.entries.filter((e) => entriesFilter.has(e.ruleId));
  if (entriesFilter !== null && filteredEntries.length === 0) {
    console.error(
      `--entries filter "${[...entriesFilter].join(',')}" matched 0 entries. Aborting.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Brain Layer benchmark — ${filteredEntries.length} entries × ${String(runsPerEntry)} runs.`,
  );
  if (entriesFilter !== null) {
    console.log(
      `Entries filter active: ${String(filteredEntries.length)}/${String(groundTruth.entries.length)} entries selected.`,
    );
  }
  if (dryRun) {
    console.log('Mode: --dry-run (mock providers, no network calls).');
  }
  if (verbose) {
    console.log('Mode: --verbose (per-call log lines).');
  }

  const env = process.env;
  const { configured, notRun } = resolveProvidersFromEnv(env);

  // En dry-run forzamos los 5 providers de la shortlist con configs sinteticos
  // — el mock LlmClient los cubre, no se hacen llamadas reales.
  if (dryRun && configured.length === 0) {
    configured.push(
      {
        label: 'anthropic/claude-haiku-4-5-20251001',
        config: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      },
      { label: 'openai/gpt-5-nano', config: { provider: 'openai', model: 'gpt-5-nano' } },
    );
    notRun.length = 0; // limpia warning en dry-run
  }

  // Aplicar filtro de providers (--providers): si está activo, retener solo
  // los que matchean por su `provider` (no por label completo).
  const finalProviders =
    providersFilter === null
      ? configured
      : configured.filter((p) => providersFilter.has(p.config.provider.toLowerCase()));
  if (providersFilter !== null && finalProviders.length === 0) {
    console.error(
      `--providers filter "${[...providersFilter].join(',')}" matched 0 configured providers. Aborting.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Configured providers (${String(finalProviders.length)}):`);
  for (const p of finalProviders) console.log(`  - ${p.label}`);
  if (providersFilter !== null && configured.length > finalProviders.length) {
    console.log(
      `(filtered out ${String(configured.length - finalProviders.length)} configured but not in --providers list)`,
    );
  }
  if (notRun.length > 0) {
    console.log(`Not run (${String(notRun.length)}):`);
    for (const p of notRun) console.log(`  - ${p.providerLabel}: ${p.reason}`);
  }

  const providers: ProviderResult[] = [];
  for (const { label, config } of finalProviders) {
    console.log(`\n=== Running ${label} ===`);
    const result = await runProvider({
      providerLabel: label,
      config,
      entries: filteredEntries,
      runsPerEntry,
      verbose,
      dryRun,
    });
    const cost = estimateCostUsd(
      label,
      result.triage.inputTokens + result.context.inputTokens + result.remediation.inputTokens,
      result.triage.outputTokens + result.context.outputTokens + result.remediation.outputTokens,
    );
    providers.push({ ...result, estimatedCostUsd: cost });
    console.log(
      `  ${label}: ${String(result.completedRuns)}/${String(result.attemptedRuns)} runs, ` +
        `${result.errors.length === 0 ? 'no errors' : `${String(result.errors.length)} errors`}.`,
    );
  }

  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    groundTruthVersion: groundTruth.version,
    groundTruthReviewStatus: countByReviewStatus(groundTruth),
    // totalEntries refleja las entries efectivamente corridas (post --entries filter).
    totalEntries: filteredEntries.length,
    runsPerEntry,
    providers,
    notRun,
  };

  const markdown = renderBenchmarkReport(report);
  const outputPath = join(repoRoot, values.output as string);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown, 'utf8');
  console.log(`\nReport written to ${outputPath}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exitCode = 1;
});
