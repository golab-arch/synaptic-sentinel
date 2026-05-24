import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  ColonyDb,
  deriveFromLearning,
  estimateCostUsd,
  FindingSchema,
  loadAgentsConfig,
  patternSignature,
  triageClassificationToLearning,
  type AgentConfig,
  type AgentsConfig,
  type BrainAgentId,
  type ContextExplanationRecord,
  type LearningClassification,
  type RemediationSuggestionRecord,
  type TokenUsageRecord,
  type TriageVerdict,
  type TriageVerdictRecord,
} from '@synaptic-sentinel/core';
import {
  ContextAgent,
  buildAnthropicFallbackConfig,
  createLlmClient,
  RemediationAgent,
  resolveApiKeyFromEnv,
  runAgent,
  TokenTrackingLlmClient,
  TriageAgent,
  type LlmClient,
} from '@synaptic-sentinel/agents';
import { renderBanner, renderTriageTag } from '@synaptic-sentinel/reporters';
import { shouldUseColor } from './scan.js';
import type { AgentProviderOverrides } from './agent-provider-flag.js';

/** Tope por defecto de hallazgos a triar (proteccion de costo/tokens). */
const DEFAULT_TRIAGE_LIMIT = 25;

/** Mapping interno: un `LlmClient` por agente del Brain Layer. */
interface AgentLlmClients {
  readonly triage: LlmClient;
  readonly context: LlmClient;
  readonly remediation: LlmClient;
}

/** Opciones del comando `triage`. */
export interface TriageCommandOptions {
  /** Directorio del proyecto cuyo `colony.db` se tria. */
  readonly path: string;
  /** Tope de hallazgos a triar en esta corrida. Por defecto 25. */
  readonly limit?: number;
  /**
   * Cliente LLM unico a usar para los 3 agentes (retro-compat con tests
   * existentes que inyectan un mock unico). Si esta presente, GANA sobre
   * `agents.yaml` y `agentProviderOverrides`.
   */
  readonly llmClient?: LlmClient;
  /**
   * Overrides per-agente desde la CLI flag `--agent-provider` (Phase 11
   * DG-073 B). Combinados con la precedencia: CLI > agents.yaml > fallback.
   */
  readonly agentProviderOverrides?: AgentProviderOverrides;
  /** Desactiva el color ANSI (tambien lo desactivan `NO_COLOR` y un stdout no-TTY). */
  readonly noColor?: boolean;
}

/**
 * Resuelve los 3 `LlmClient` (uno por agente) aplicando la precedencia
 * decidida en DG-073 B:
 *
 *   1. `options.llmClient`           — retro-compat con tests (gana siempre).
 *   2. CLI flag `--agent-provider`   — override per-agente.
 *   3. `.sentinel/agents.yaml`       — config versionable.
 *   4. Anthropic fallback implicito  — si hay ANTHROPIC_API_KEY en env,
 *                                      reproduce el comportamiento v0.2.0
 *                                      (Anthropic Haiku 4.5 para los 3).
 *
 * Si no hay ni config ni keys, devuelve un error accionable.
 */
function resolveAgentLlmClients(
  projectRoot: string,
  options: TriageCommandOptions,
):
  | {
      ok: true;
      clients: AgentLlmClients;
      providerLabels: Record<BrainAgentId, string>;
      source: string;
    }
  | { ok: false; error: string } {
  // (1) Override de tests: comportamiento legacy (un cliente compartido).
  if (options.llmClient !== undefined) {
    const llm = options.llmClient;
    return {
      ok: true,
      clients: { triage: llm, context: llm, remediation: llm },
      providerLabels: {
        triage: 'injected/test',
        context: 'injected/test',
        remediation: 'injected/test',
      },
      source: 'injected',
    };
  }

  // (2)+(3) Config del YAML + overrides de CLI.
  let yamlConfig: AgentsConfig | null = null;
  try {
    yamlConfig = loadAgentsConfig(projectRoot);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let baseConfig: AgentsConfig | null = yamlConfig;
  const overrides = options.agentProviderOverrides ?? {};
  const hasOverrides = Object.keys(overrides).length > 0;

  // (4) Anthropic fallback: si no hay YAML y no hay overrides completos,
  // intentamos retro-compat con la env legacy ANTHROPIC_API_KEY.
  if (baseConfig === null && !hasOverrides) {
    const anthropicKey = resolveApiKeyFromEnv('anthropic');
    if (anthropicKey === undefined) {
      return {
        ok: false,
        error:
          'No LLM provider configured. Create .sentinel/agents.yaml, pass ' +
          '--agent-provider, or set ANTHROPIC_API_KEY for v0.2.0 retro-compat.',
      };
    }
    baseConfig = buildAnthropicFallbackConfig();
  }

  // Composicion final: base (yaml o fallback) + overrides per-agente.
  const agents: Record<BrainAgentId, AgentConfig | undefined> = {
    triage: overrides.triage ?? baseConfig?.agents.triage,
    context: overrides.context ?? baseConfig?.agents.context,
    remediation: overrides.remediation ?? baseConfig?.agents.remediation,
  };

  // Validacion: los 3 agentes tienen que terminar con config.
  for (const agentId of ['triage', 'context', 'remediation'] as const) {
    if (agents[agentId] === undefined) {
      return {
        ok: false,
        error:
          `No provider configured for the "${agentId}" agent. Add it to ` +
          `.sentinel/agents.yaml or pass --agent-provider ${agentId}=<provider>/<model>.`,
      };
    }
  }

  // Construccion: cada agente con su LlmClient + su apiKey resuelta del env.
  try {
    const clients: AgentLlmClients = {
      triage: createLlmClient({
        config: agents.triage as AgentConfig,
        agentId: 'triage',
        ...(resolveApiKeyFromEnv((agents.triage as AgentConfig).provider) !== undefined
          ? { apiKey: resolveApiKeyFromEnv((agents.triage as AgentConfig).provider) as string }
          : {}),
      }),
      context: createLlmClient({
        config: agents.context as AgentConfig,
        agentId: 'context',
        ...(resolveApiKeyFromEnv((agents.context as AgentConfig).provider) !== undefined
          ? { apiKey: resolveApiKeyFromEnv((agents.context as AgentConfig).provider) as string }
          : {}),
      }),
      remediation: createLlmClient({
        config: agents.remediation as AgentConfig,
        agentId: 'remediation',
        ...(resolveApiKeyFromEnv((agents.remediation as AgentConfig).provider) !== undefined
          ? {
              apiKey: resolveApiKeyFromEnv((agents.remediation as AgentConfig).provider) as string,
            }
          : {}),
      }),
    };
    const source =
      yamlConfig !== null
        ? hasOverrides
          ? 'agents.yaml + CLI overrides'
          : 'agents.yaml'
        : hasOverrides
          ? 'CLI overrides (no agents.yaml)'
          : 'Anthropic fallback (legacy ANTHROPIC_API_KEY)';
    const providerLabels: Record<BrainAgentId, string> = {
      triage: `${(agents.triage as AgentConfig).provider}/${(agents.triage as AgentConfig).model}`,
      context: `${(agents.context as AgentConfig).provider}/${(agents.context as AgentConfig).model}`,
      remediation: `${(agents.remediation as AgentConfig).provider}/${(agents.remediation as AgentConfig).model}`,
    };
    return { ok: true, clients, providerLabels, source };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Formato legible de la config aplicada, para que el usuario vea que
 * provider/modelo usa cada agente al arranque del comando.
 */
function describeAgentClients(clients: AgentLlmClients): string {
  const tag = (llm: LlmClient): string => {
    const ctor = (llm.constructor as { name?: string }).name ?? 'LlmClient';
    return ctor.replace(/LlmClient$/, '');
  };
  return `triage=${tag(clients.triage)} | context=${tag(clients.context)} | remediation=${tag(
    clients.remediation,
  )}`;
}

/**
 * Ejecuta el comando `triage`: corre el Brain Layer sobre los hallazgos del
 * ultimo scan. El Triage Agent clasifica cada hallazgo; sobre los verdaderos
 * positivos, el Context Agent explica la cadena de explotabilidad y el
 * Remediation Agent propone como corregirlos. Veredictos, explicaciones y
 * sugerencias se persisten en `colony.db`.
 *
 * Multi-provider (Phase 11 DG-073 B): cada agente puede correr contra un
 * provider/modelo distinto. La precedencia es `options.llmClient` (tests)
 * > CLI flag `--agent-provider` > `.sentinel/agents.yaml` > fallback
 * Anthropic con ANTHROPIC_API_KEY (retro-compat v0.2.0).
 *
 * Economia de tokens (v0.4 §187): salta los hallazgos ya descartados como
 * falso positivo (`fp_known`) y los ya triados. BYOK: las API keys las
 * provee el usuario y van directo a cada provider, sin backend de
 * Synaptic.
 */
export async function runTriageCommand(options: TriageCommandOptions): Promise<number> {
  const color = shouldUseColor(options.noColor === true);
  console.log(renderBanner(color));
  const projectRoot = resolve(options.path);
  const dbPath = join(projectRoot, '.synaptic-sentinel', 'colony.db');
  if (!existsSync(dbPath)) {
    console.error(`No colony.db in ${projectRoot}. Run "synaptic-sentinel scan" first.`);
    return 1;
  }

  const resolved = resolveAgentLlmClients(projectRoot, options);
  if (!resolved.ok) {
    console.error(resolved.error);
    return 1;
  }
  const { clients: rawClients, providerLabels, source } = resolved;
  // Cost visibility (DG-078 B): envolvemos cada cliente con un wrapper que
  // registra tokens (proxy chars/4) + latencia por call. Drenamos las
  // observations despues de cada `runAgent` para asociarlas al fingerprint.
  const triageWrapper = new TokenTrackingLlmClient(rawClients.triage);
  const contextWrapper = new TokenTrackingLlmClient(rawClients.context);
  const remediationWrapper = new TokenTrackingLlmClient(rawClients.remediation);
  const clients: AgentLlmClients = {
    triage: triageWrapper,
    context: contextWrapper,
    remediation: remediationWrapper,
  };
  console.log(`Brain Layer providers (${source}): ${describeAgentClients(rawClients)}`);

  // Sesion de triage: agrupa todos los token usage records de esta invocacion.
  const triageSessionId = randomUUID();

  const db = ColonyDb.open(dbPath);
  try {
    const scanId = db.getLatestScanId();
    if (scanId === undefined) {
      console.error('colony.db has no scan yet. Run "synaptic-sentinel scan" first.');
      return 1;
    }

    const findings = db
      .getPheromonesByScan(scanId)
      .filter((pheromone) => pheromone.type === 'finding')
      .map((pheromone) => FindingSchema.parse(pheromone.payload));

    // Economia de tokens: no se tria lo ya descartado ni lo ya triado.
    const knownFalsePositives = db.getKnownFingerprints('fp_known');
    const alreadyTriaged = db.getTriagedFingerprints();
    const pending = findings.filter(
      (finding) =>
        !knownFalsePositives.has(finding.fingerprint) && !alreadyTriaged.has(finding.fingerprint),
    );

    const limit = options.limit ?? DEFAULT_TRIAGE_LIMIT;
    const toTriage = pending.slice(0, limit);
    console.log(
      `Triage of scan ${scanId}: ${String(findings.length)} finding(s), ` +
        `${String(findings.length - pending.length)} skipped (known FP / already triaged), ` +
        `${String(toTriage.length)} to triage.`,
    );
    if (pending.length > toTriage.length) {
      console.log(`  (capped at ${String(limit)}; use --limit to raise it)`);
    }

    const triageAgent = new TriageAgent();
    const contextAgent = new ContextAgent();
    const remediationAgent = new RemediationAgent();
    const verdicts: TriageVerdictRecord[] = [];
    const explanations: ContextExplanationRecord[] = [];
    const remediations: RemediationSuggestionRecord[] = [];
    // Cost visibility (DG-078 B): un record por cada call exitosa o fallida.
    const tokenUsages: TokenUsageRecord[] = [];
    // Helper que toma la observation mas reciente del wrapper y la convierte
    // en un TokenUsageRecord asociado al finding actual.
    const drainObservation = (
      wrapper: TokenTrackingLlmClient,
      agentId: BrainAgentId,
      fingerprint: string,
    ): void => {
      const obs = wrapper.observations.at(-1);
      if (obs === undefined) return;
      const providerLabel = providerLabels[agentId];
      const estimatedCostUsd =
        obs.outputTokens === 0 && !obs.ok
          ? 0
          : estimateCostUsd(providerLabel, obs.inputTokens, obs.outputTokens);
      tokenUsages.push({
        id: randomUUID(),
        triageSessionId,
        scanId,
        fingerprint,
        providerLabel,
        agentId,
        inputTokens: obs.inputTokens,
        outputTokens: obs.outputTokens,
        estimatedCostUsd,
        latencyMs: obs.latencyMs,
        createdAt: new Date().toISOString(),
      });
    };
    // Aprendizaje del enjambre: patrones generalizados de los hallazgos
    // clasificados, para alimentar `learning_records` (v0.4 §3.5).
    const learningEntries: { signature: string; classification: LearningClassification }[] = [];
    // Lado lectura: la memoria del enjambre pre-clasifica patrones conocidos
    // sin gastar una llamada LLM (economia de tokens, v0.4 §187).
    const learningRecords = db.getLearningRecords();
    let learnedCount = 0;
    for (const finding of toTriage) {
      try {
        const signature = patternSignature(finding);
        const learned = deriveFromLearning(signature, learningRecords);
        let verdict: TriageVerdict;
        if (learned !== undefined) {
          // La colonia ya conoce este patron: se evita la llamada LLM.
          verdict = {
            classification: learned.classification,
            confidence: learned.confidence,
            rationale:
              `Pre-classified by the colony memory: the pattern "${signature}" was ` +
              `${learned.classification} in ${String(learned.evidenceCount)} prior finding(s).`,
          };
          learnedCount += 1;
        } else {
          verdict = await runAgent(triageAgent, finding, clients.triage);
          drainObservation(triageWrapper, 'triage', finding.fingerprint);
        }
        verdicts.push({
          id: randomUUID(),
          scanId,
          fingerprint: finding.fingerprint,
          classification: verdict.classification,
          confidence: verdict.confidence,
          rationale: verdict.rationale,
          agentId: learned !== undefined ? 'colony-learning' : triageAgent.id,
          createdAt: new Date().toISOString(),
        });
        const sourceTag = learned !== undefined ? ' (colony memory)' : '';
        console.log(
          `  ${renderTriageTag(verdict.classification, color)}  ${finding.title} ` +
            `— ${finding.location.path}:${String(finding.location.startLine)} ` +
            `(confidence ${verdict.confidence.toFixed(2)})${sourceTag}`,
        );
        // Aprendizaje: solo de las decisiones del LLM, nunca de un veredicto
        // derivado de la propia memoria (evita un bucle de realimentacion).
        // Y solo las clasificaciones decisivas (inconclusive no es patron).
        if (learned === undefined) {
          const learning = triageClassificationToLearning(verdict.classification);
          if (learning !== undefined) {
            learningEntries.push({ signature, classification: learning });
          }
        }
        // Stage 4 — Context: solo sobre los verdaderos positivos (v0.4 §3.6).
        if (verdict.classification === 'true_positive') {
          try {
            const explanation = await runAgent(contextAgent, finding, clients.context);
            drainObservation(contextWrapper, 'context', finding.fingerprint);
            explanations.push({
              id: randomUUID(),
              scanId,
              fingerprint: finding.fingerprint,
              summary: explanation.summary,
              entryPoint: explanation.entryPoint,
              sink: explanation.sink,
              exposure: explanation.exposure,
              agentId: contextAgent.id,
              createdAt: new Date().toISOString(),
            });
            console.log(`      context: ${explanation.summary}`);
          } catch (err) {
            // Un fallo de contexto no descarta el veredicto de triage.
            drainObservation(contextWrapper, 'context', finding.fingerprint);
            const message = err instanceof Error ? err.message : String(err);
            console.error(`      ! context failed for "${finding.title}": ${message}`);
          }
          // Stage 4 — Remediation: como corregir el verdadero positivo.
          try {
            const remediation = await runAgent(remediationAgent, finding, clients.remediation);
            drainObservation(remediationWrapper, 'remediation', finding.fingerprint);
            remediations.push({
              id: randomUUID(),
              scanId,
              fingerprint: finding.fingerprint,
              summary: remediation.summary,
              recommendation: remediation.recommendation,
              ...(remediation.fixedSnippet !== undefined
                ? { fixedSnippet: remediation.fixedSnippet }
                : {}),
              agentId: remediationAgent.id,
              createdAt: new Date().toISOString(),
            });
            console.log(`      remediation: ${remediation.summary}`);
          } catch (err) {
            // Un fallo de remediacion no descarta el veredicto de triage.
            drainObservation(remediationWrapper, 'remediation', finding.fingerprint);
            const message = err instanceof Error ? err.message : String(err);
            console.error(`      ! remediation failed for "${finding.title}": ${message}`);
          }
        }
      } catch (err) {
        // Un fallo de triage no aborta la corrida (degraded > failed).
        // Si el wrapper alcanzo a registrar la observation antes del throw,
        // tambien la persistimos para visibilidad de cost en sesiones fallidas.
        drainObservation(triageWrapper, 'triage', finding.fingerprint);
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ! triage failed for "${finding.title}": ${message}`);
      }
    }

    db.insertTriageVerdicts(verdicts);
    db.insertContextExplanations(explanations);
    db.insertRemediationSuggestions(remediations);
    db.recordLearningBatch(learningEntries, scanId);
    db.insertTokenUsages(tokenUsages);
    console.log(
      `Triage verdicts persisted: ${String(verdicts.length)}; ` +
        `context explanations: ${String(explanations.length)}; ` +
        `remediation suggestions: ${String(remediations.length)}; ` +
        `patterns learned: ${String(learningEntries.length)}; ` +
        `pre-classified from memory: ${String(learnedCount)}.`,
    );
    // Cost visibility summary (DG-078 B). Tokens son PROXIES (chars/4) y
    // cost USD es estimado — caveat visible para el usuario.
    if (tokenUsages.length > 0) {
      renderCostSummary(tokenUsages);
    }
    return 0;
  } finally {
    db.close();
  }
}

/**
 * Imprime el bloque de cost visibility post-triage (DG-078 B).
 *
 * Agrupa los `tokenUsages` por `(providerLabel, agentId)`, suma tokens y
 * cost USD, y muestra una tabla compacta + un total. Los numeros llevan
 * caveat "~estimated" porque los tokens son proxies `chars/4` y el cost
 * puede divergir ±15-20% del facturado real.
 */
function renderCostSummary(tokenUsages: readonly TokenUsageRecord[]): void {
  // Group por (providerLabel, agentId).
  const groups = new Map<
    string,
    {
      providerLabel: string;
      agentId: BrainAgentId;
      calls: number;
      input: number;
      output: number;
      cost: number;
      latency: number;
    }
  >();
  for (const u of tokenUsages) {
    const key = `${u.providerLabel}|${u.agentId}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        providerLabel: u.providerLabel,
        agentId: u.agentId,
        calls: 1,
        input: u.inputTokens,
        output: u.outputTokens,
        cost: u.estimatedCostUsd,
        latency: u.latencyMs,
      });
    } else {
      existing.calls += 1;
      existing.input += u.inputTokens;
      existing.output += u.outputTokens;
      existing.cost += u.estimatedCostUsd;
      existing.latency += u.latencyMs;
    }
  }
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  const rows: string[] = [];
  // Order: por providerLabel asc, luego por agentId (triage, context, remediation).
  const agentOrder: Record<BrainAgentId, number> = { triage: 0, context: 1, remediation: 2 };
  const sorted = [...groups.values()].sort((a, b) => {
    const lblCmp = a.providerLabel.localeCompare(b.providerLabel);
    if (lblCmp !== 0) return lblCmp;
    return agentOrder[a.agentId] - agentOrder[b.agentId];
  });
  for (const g of sorted) {
    totalInput += g.input;
    totalOutput += g.output;
    totalCost += g.cost;
    const avgLatency = Math.round(g.latency / g.calls);
    rows.push(
      `  ${g.providerLabel.padEnd(40)} ${g.agentId.padEnd(11)} ${String(g.calls).padStart(4)} calls  ` +
        `${String(g.input).padStart(7)} in  ${String(g.output).padStart(6)} out  ` +
        `$${g.cost.toFixed(4).padStart(8)}  ${String(avgLatency).padStart(5)}ms avg`,
    );
  }
  console.log('');
  console.log('Cost summary (~estimated — tokens are chars/4 proxy, ±15-20% vs provider usage):');
  console.log(
    `  ${'provider/model'.padEnd(40)} ${'agent'.padEnd(11)} ${'calls'.padStart(10)}  ` +
      `${'input'.padStart(7)}     ${'output'.padStart(6)}  ${'cost USD'.padStart(9)}  ${'latency'.padStart(7)}`,
  );
  for (const row of rows) console.log(row);
  console.log(
    `  Total: ${String(totalInput)} input tokens · ${String(totalOutput)} output tokens · ` +
      `$${totalCost.toFixed(4)} (~estimated USD)`,
  );
}
