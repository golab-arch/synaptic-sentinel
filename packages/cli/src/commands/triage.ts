import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  ColonyDb,
  deriveDowngradedConfidence,
  deriveFromLearning,
  estimateCostUsd,
  FindingSchema,
  formatMemberRationaleTag,
  groupPendingFindings,
  loadAgentsConfig,
  patternSignature,
  resolveColonyDbPath,
  triageClassificationToLearning,
  type AgentConfig,
  type AgentsConfig,
  type BrainAgentId,
  type ContextExplanationRecord,
  type Finding,
  type LearningClassification,
  type RemediationSuggestionRecord,
  type TokenUsageRecord,
  type TriageFindingGroup,
  type TriageVerdict,
  type TriageVerdictHistoryRecord,
  type TriageVerdictRecord,
} from '@synaptic-sentinel/core';
import {
  ContextAgent,
  buildAnthropicFallbackConfig,
  createLlmClient,
  EmptyResponseError,
  JsonParseError,
  RemediationAgent,
  resolveApiKeyFromEnv,
  runAgent,
  TokenTrackingLlmClient,
  TriageAgent,
  type LlmClient,
  type TokenUsageSource,
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
   * Si `true` (DG-107 A), antes de triar borra todos los `triage_verdicts`,
   * `context_explanations` y `remediation_suggestions` para los
   * fingerprints del scan actual. Resuelve el caso de uso "cambie de
   * provider y quiero re-evaluar las mismas findings" — sin esto el flow
   * normal salta lo ya triado y el cambio de provider es invisible. NO
   * toca `fp_known` (FPs manuales preservados) ni `triage_token_usage`
   * (historia de costo del rollup preservada).
   */
  readonly reTriage?: boolean;
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
  /**
   * DG-131 A Sub-A2: si `true`, desactiva el agrupamiento cross-finding
   * (R20) y trata cada finding como solitary (LLM call individual).
   * Escape hatch para cuando el user quiere resoluciones per-finding
   * (ej. sospecha que 1 finding específico del grupo difiere semánticamente).
   */
  readonly noGroup?: boolean;
  /**
   * DG-132 A Sub-A2 (Cycle 118 FASE III R22): CI/CD gates per-severity.
   * Post-triage, cuenta findings con verdict TP que son NEW (primera vez
   * triaged) O reclassified-to-TP (class change → TP). Si el count por
   * severity supera el threshold, exit code 1 (CI fail).
   *
   * Undefined → skip check para esa severity. 0 → any new TP fails.
   * Uso típico CI: `--fail-on-new-tp-critical 0 --fail-on-new-tp-high 3`
   * (zero tolerance critical, tolerate up to 3 high per PR).
   */
  readonly failOnNewTpCritical?: number;
  readonly failOnNewTpHigh?: number;
  readonly failOnNewTpMedium?: number;
  /** Desactiva el color ANSI (tambien lo desactivan `NO_COLOR` y un stdout no-TTY). */
  readonly noColor?: boolean;
}

/**
 * DG-132 A Sub-A2 CI/CD gate evaluator. Cuenta findings con verdict TP que
 * son "nuevo TP" (new-first-triage con TP verdict O reclassified-a-TP)
 * agrupados por severity. Compara contra thresholds y decide exit code.
 *
 * Return contract:
 *   - `exitCode` 0 = PASS (todos los thresholds satisfied o no configurados)
 *   - `exitCode` 1 = FAIL (al menos un threshold excedido)
 *   - `messages` = líneas de log para stderr describiendo el resultado
 */
function evaluateCIGate(
  diff: ReturnType<ColonyDb['getVerdictDiffAgainstPrevious']>,
  findings: readonly import('@synaptic-sentinel/core').Finding[],
  verdicts: readonly TriageVerdictRecord[],
  options: TriageCommandOptions,
): { exitCode: number; messages: readonly string[] } {
  const hasAnyGate =
    options.failOnNewTpCritical !== undefined ||
    options.failOnNewTpHigh !== undefined ||
    options.failOnNewTpMedium !== undefined;
  if (!hasAnyGate) return { exitCode: 0, messages: [] };
  const findingsByFp = new Map(findings.map((f) => [f.fingerprint, f]));
  const verdictsByFp = new Map(verdicts.map((v) => [v.fingerprint, v]));
  // "New TP" = fingerprint is new OR reclassified class-changed to TP.
  const isNewTPFingerprint = (fp: string): boolean => {
    const verdict = verdictsByFp.get(fp);
    if (verdict?.classification !== 'true_positive') return false;
    if (diff.newFindings.includes(fp)) return true;
    const reclass = diff.reclassified.find((r) => r.fingerprint === fp);
    return reclass !== undefined && reclass.reason === 'class-changed';
  };
  const counts: Record<'critical' | 'high' | 'medium', number> = {
    critical: 0,
    high: 0,
    medium: 0,
  };
  for (const fp of [...diff.newFindings, ...diff.reclassified.map((r) => r.fingerprint)]) {
    if (!isNewTPFingerprint(fp)) continue;
    const finding = findingsByFp.get(fp);
    if (finding === undefined) continue;
    if (finding.severity === 'critical') counts.critical += 1;
    else if (finding.severity === 'high') counts.high += 1;
    else if (finding.severity === 'medium') counts.medium += 1;
  }
  const messages: string[] = [];
  const fails: string[] = [];
  const check = (severity: 'critical' | 'high' | 'medium', threshold: number | undefined): void => {
    if (threshold === undefined) return;
    const count = counts[severity];
    const status = count > threshold ? 'FAIL' : 'PASS';
    messages.push(
      `Diff-aware CI gate: ${String(count)} new TP ${severity} (threshold ${String(threshold)}) — ${status}`,
    );
    if (status === 'FAIL') fails.push(`${severity}: ${String(count)} > ${String(threshold)}`);
  };
  check('critical', options.failOnNewTpCritical);
  check('high', options.failOnNewTpHigh);
  check('medium', options.failOnNewTpMedium);
  if (fails.length > 0) {
    messages.push(`Diff-aware CI gate FAILED: ${fails.join(', ')}. Exiting with code 1.`);
    return { exitCode: 1, messages };
  }
  return { exitCode: 0, messages };
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
  // DG-093 A: dual-read del colony.db (preferencia .sentinel/, fallback al
  // legacy .synaptic-sentinel/). El existsSync que sigue es contra el path
  // resuelto; si NINGUNO de los dos paths tiene archivo, el caller saca el
  // mismo error que antes.
  const dbResolution = resolveColonyDbPath(projectRoot);
  const dbPath = dbResolution.path;
  if (!existsSync(dbPath)) {
    console.error(`No colony.db in ${projectRoot}. Run "synaptic-sentinel scan" first.`);
    return 1;
  }
  if (dbResolution.isLegacy) {
    console.warn(
      `Using legacy .synaptic-sentinel/colony.db (pre-DG-093). Consider ` +
        `moving it to .sentinel/colony.db at your leisure.`,
    );
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

    // DG-107 A: re-triage controlado. Borra los verdicts/contexts/
    // remediations existentes para los fingerprints del scan actual ANTES
    // de calcular `pending`, para que todos vuelvan a entrar al flow del
    // triage. NO toca `fp_known` ni `triage_token_usage` (caveats
    // documentados en el JSDoc de `clearTriageDataForFingerprints`).
    if (options.reTriage === true) {
      const fingerprints = findings.map((f) => f.fingerprint);
      const deleted = db.clearTriageDataForFingerprints(fingerprints);
      console.log(
        `Re-triage requested: cleared ${String(deleted)} previous record(s) ` +
          `across triage_verdicts + context_explanations + remediation_suggestions.`,
      );
    }

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
    // DG-085 A: rastrear el origen de los tokens (provider real vs proxy
    // chars/4) para que el summary muestre el caveat apropiado.
    const usageSourcesSeen = new Set<TokenUsageSource>();
    // Helper que toma la observation mas reciente del wrapper y la convierte
    // en un TokenUsageRecord asociado al finding actual.
    const drainObservation = (
      wrapper: TokenTrackingLlmClient,
      agentId: BrainAgentId,
      fingerprint: string,
    ): void => {
      const obs = wrapper.observations.at(-1);
      if (obs === undefined) return;
      usageSourcesSeen.add(obs.usageSource);
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
    // DG-131 A Sub-A2 (Cycle 117 FASE III R20): split toTriage en
    // groups (≥ MIN_GROUP_SIZE members con misma ruleId+package) + solitary.
    // options.noGroup === true bypassa grouping enteramente (test/UX escape).
    // Representative de cada grupo hace 1 LLM call; members propagan verdict
    // con confidence downgrade. Reduce cost significativamente en workspaces
    // con muchos SCA duplicados (22 protobufjs findings → 1 LLM call).
    const { groups: triageGroups, solitary: solitaryFindings } =
      options.noGroup === true
        ? {
            groups: [] as readonly TriageFindingGroup[],
            solitary: toTriage as readonly Finding[],
          }
        : groupPendingFindings(toTriage, () => randomUUID());
    if (triageGroups.length > 0) {
      const groupMemberTotal = triageGroups.reduce((acc, g) => acc + g.members.length, 0);
      console.log(
        `Grouping (DG-131 A R20): ${String(triageGroups.length)} group(s) covering ` +
          `${String(groupMemberTotal)} finding(s); ${String(solitaryFindings.length)} ` +
          `solitary. LLM calls saved by grouping: ${String(groupMemberTotal - triageGroups.length)}.`,
      );
    }
    // Findings que efectivamente pasan por el LLM path: representatives + solitary.
    const findingsToLLM: readonly Finding[] = [
      ...triageGroups.map((g) => g.members[0] as Finding),
      ...solitaryFindings,
    ];
    // Map fingerprint → grupo, para setear groupId + isGroupRepresentative
    // en el verdict record durante el loop principal.
    const fingerprintToGroup = new Map<string, TriageFindingGroup>();
    for (const group of triageGroups) {
      fingerprintToGroup.set(group.members[0]!.fingerprint, group);
    }
    for (const finding of findingsToLLM) {
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
        const groupOfThisFinding = fingerprintToGroup.get(finding.fingerprint);
        verdicts.push({
          id: randomUUID(),
          scanId,
          fingerprint: finding.fingerprint,
          classification: verdict.classification,
          confidence: verdict.confidence,
          rationale: verdict.rationale,
          agentId: learned !== undefined ? 'colony-learning' : triageAgent.id,
          ...(groupOfThisFinding !== undefined
            ? { groupId: groupOfThisFinding.groupId, isGroupRepresentative: true }
            : {}),
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
        // DG-125 A (Cycle 112 FASE I): EmptyResponseError (provider devolvió
        // HTTP 200 OK con content=null/'' después de 3 attempts) se
        // transforma en verdict `inconclusive` determinístico en vez de
        // dejar el finding sin veredicto. UX: el user ve el finding en el
        // sidebar como INC con rationale explicable, y puede re-triage
        // más tarde (posiblemente con otro provider) para intentar de
        // nuevo. Provider-agnostic — aplica a cualquiera de los 14+
        // providers OpenAI-compatible.
        drainObservation(triageWrapper, 'triage', finding.fingerprint);
        // DG-125 A: EmptyResponseError → inconclusive determinístico.
        if (err instanceof EmptyResponseError) {
          const emptyVerdict: TriageVerdict = {
            classification: 'inconclusive',
            confidence: 0,
            rationale:
              `Provider "${err.providerLabel}" returned an empty response after ` +
              `${String(err.attemptsExhausted)} attempts. Unable to triage this finding ` +
              `with the current provider — try re-triaging (possibly with a different ` +
              `model in agents.yaml) or investigate the provider's content-filter / ` +
              `token-budget for this prompt.`,
          };
          const groupOfThisFinding = fingerprintToGroup.get(finding.fingerprint);
          verdicts.push({
            id: randomUUID(),
            scanId,
            fingerprint: finding.fingerprint,
            classification: emptyVerdict.classification,
            confidence: emptyVerdict.confidence,
            rationale: emptyVerdict.rationale,
            agentId: triageAgent.id,
            ...(groupOfThisFinding !== undefined
              ? { groupId: groupOfThisFinding.groupId, isGroupRepresentative: true }
              : {}),
            createdAt: new Date().toISOString(),
          });
          console.error(
            `  ${renderTriageTag('inconclusive', color)}  ${finding.title} ` +
              `— ${finding.location.path}:${String(finding.location.startLine)} ` +
              `(EmptyResponseError from ${err.providerLabel}; DG-125 A graceful degradation)`,
          );
          continue;
        }
        // DG-125.0.1 (Cycle 112 FASE I): JsonParseError → inconclusive
        // determinístico. Empíricamente observado en Baseline-9 con
        // deepseek-v4-pro: refusal messages ("I cannot help with this
        // security bypass request") devuelven texto plano sin JSON. UX
        // graceful degradation idéntica a EmptyResponseError — persist
        // verdict + log ⚠ INC line con nota diagnostic. Provider-agnostic
        // (aplica a cualquier provider con content-filter policy).
        if (err instanceof JsonParseError) {
          const jsonParseVerdict: TriageVerdict = {
            classification: 'inconclusive',
            confidence: 0,
            rationale:
              `Provider returned non-JSON output that could not be parsed as a triage ` +
              `verdict. This typically indicates a refusal message (content-filter policy) ` +
              `or malformed response. Cause: ${err.parseFailure}. Raw sample: "${err.rawSample}". ` +
              `Try re-triaging with a different model in agents.yaml (some providers refuse ` +
              `security-analysis prompts) or investigate the provider's policy.`,
          };
          const groupOfThisFinding = fingerprintToGroup.get(finding.fingerprint);
          verdicts.push({
            id: randomUUID(),
            scanId,
            fingerprint: finding.fingerprint,
            classification: jsonParseVerdict.classification,
            confidence: jsonParseVerdict.confidence,
            rationale: jsonParseVerdict.rationale,
            agentId: triageAgent.id,
            ...(groupOfThisFinding !== undefined
              ? { groupId: groupOfThisFinding.groupId, isGroupRepresentative: true }
              : {}),
            createdAt: new Date().toISOString(),
          });
          console.error(
            `  ${renderTriageTag('inconclusive', color)}  ${finding.title} ` +
              `— ${finding.location.path}:${String(finding.location.startLine)} ` +
              `(JsonParseError; DG-125.0.1 graceful degradation)`,
          );
          continue;
        }
        // Otros errores (network, quota, schema drift): comportamiento
        // legacy — degraded > failed (v0.4 §3.7).
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ! triage failed for "${finding.title}": ${message}`);
      }
    }

    // DG-131 A Sub-A2 (Cycle 117 FASE III R20): propagación de verdict de
    // representative a non-representative members del grupo. Cada member
    // recibe classification+rationale del representative, confidence
    // downgraded (0.9x default), member tag en el rationale + groupId +
    // isGroupRepresentative=false. NO se hacen LLM calls adicionales —
    // ese es el ahorro de tokens que atacamos con R20.
    for (const group of triageGroups) {
      const representative = group.members[0];
      if (representative === undefined) continue;
      const repVerdict = verdicts.find((v) => v.fingerprint === representative.fingerprint);
      if (repVerdict === undefined) continue; // Representative sin verdict → skip propagation
      for (let i = 1; i < group.members.length; i += 1) {
        const member = group.members[i];
        if (member === undefined) continue;
        const downgradedConfidence = deriveDowngradedConfidence(repVerdict.confidence);
        const memberTag = formatMemberRationaleTag(group.groupKey, i, group.members.length);
        verdicts.push({
          id: randomUUID(),
          scanId,
          fingerprint: member.fingerprint,
          classification: repVerdict.classification,
          confidence: downgradedConfidence,
          rationale: repVerdict.rationale + memberTag,
          agentId: repVerdict.agentId,
          groupId: group.groupId,
          isGroupRepresentative: false,
          createdAt: new Date().toISOString(),
        });
        console.log(
          `  ${renderTriageTag(repVerdict.classification, color)}  ${member.title} ` +
            `— ${member.location.path}:${String(member.location.startLine)} ` +
            `(confidence ${downgradedConfidence.toFixed(2)}) [group member ${String(i + 1)}/${String(group.members.length)}]`,
        );
      }
    }

    db.insertTriageVerdicts(verdicts);
    // DG-130 A (Cycle 116 FASE III Sub-A2): historia append-only cross-scan.
    // Cada re-triage añade nuevos registros SIN borrar los previos → habilita
    // sidebar "Previously (N prior verdicts)" + banner "Verdict changed
    // since last scan". providerLabel identifica el origen (LLM vs colony-
    // memory) para el banner heurístico de razón.
    const triageProviderLabel = providerLabels['triage'];
    const verdictHistoryRecords: TriageVerdictHistoryRecord[] = verdicts.map((v) => ({
      ...v,
      providerLabel: v.agentId === 'colony-learning' ? 'colony-memory' : triageProviderLabel,
    }));
    db.insertVerdictHistoryBatch(verdictHistoryRecords);
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
    // DG-130 A (Cycle 116 FASE III Sub-A2): diff-aware line post-triage.
    // Compara los veredictos ACTUALES de los findings triaged en ESTA corrida
    // contra sus veredictos previos en verdict_history. Solo cuenta findings
    // que efectivamente pasaron por triage (toTriage). Los que fueron saltados
    // (known-FP o already-triaged sin --re-triage) no participan del diff.
    // DG-132 A Sub-A2 (Cycle 118 FASE III): breakdown line con reason
    // categorization. Ataca gap empírico Baseline-15: los 5 findings con
    // "Confidence changed significantly" contaban como "unchanged" en el
    // diff summary a pesar del banner. Ahora se cuentan como
    // reclassified.confidence-delta.
    if (toTriage.length > 0) {
      const triagedFingerprints = toTriage.map((f) => f.fingerprint);
      const diff = db.getVerdictDiffAgainstPrevious(triagedFingerprints);
      const rClass = diff.reclassified.filter((r) => r.reason === 'class-changed').length;
      const rProvider = diff.reclassified.filter((r) => r.reason === 'provider-changed').length;
      const rConfidence = diff.reclassified.filter((r) => r.reason === 'confidence-delta').length;
      console.log(
        `Scan diff vs previous triage: ${String(diff.newFindings.length)} new, ` +
          `${String(diff.reclassified.length)} re-classified ` +
          `(${String(rClass)} class, ${String(rConfidence)} confidence, ${String(rProvider)} provider), ` +
          `${String(diff.unchanged.length)} unchanged.`,
      );
      for (const rc of diff.reclassified) {
        const detail =
          rc.reason === 'class-changed'
            ? `${rc.from} → ${rc.to}`
            : rc.reason === 'provider-changed'
              ? `${rc.fromProvider} → ${rc.toProvider}`
              : `Δ ${rc.confidenceDelta.toFixed(2)} (${rc.fromConfidence.toFixed(2)} → ${rc.toConfidence.toFixed(2)})`;
        console.log(`  · re-classified ${rc.fingerprint.slice(0, 12)} [${rc.reason}]: ${detail}`);
      }
      // DG-132 A Sub-A2: per-severity CI gate check post-triage.
      // Count NEW-TP + reclassified-to-TP by severity, exit 1 if threshold.
      const gateResult = evaluateCIGate(diff, findings, verdicts, options);
      if (gateResult.exitCode !== 0) {
        for (const msg of gateResult.messages) {
          console.error(msg);
        }
        return gateResult.exitCode;
      }
    }
    // Cost visibility summary (DG-078 B + DG-085 A). El caveat del summary
    // distingue ahora entre tokens reales del provider y la proxy chars/4.
    if (tokenUsages.length > 0) {
      renderCostSummary(tokenUsages, usageSourcesSeen);
    }
    return 0;
  } finally {
    db.close();
  }
}

/**
 * Imprime el bloque de cost visibility post-triage (DG-078 B + DG-085 A).
 *
 * Agrupa los `tokenUsages` por `(providerLabel, agentId)`, suma tokens y
 * cost USD, y muestra una tabla compacta + un total. El caveat del summary
 * depende del origen de los counts (`usageSources`):
 *
 *   - solo `'provider'` → "tokens & cost from provider usage" (sin caveat
 *     de proxy; el cost USD se puede contrastar contra la facturacion real)
 *   - solo `'proxy'`    → "tokens are chars/4 proxy, ±15-20% vs provider"
 *   - mixed            → "mixed sources; some calls used the chars/4 proxy"
 */
function renderCostSummary(
  tokenUsages: readonly TokenUsageRecord[],
  usageSources: ReadonlySet<TokenUsageSource>,
): void {
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
  // DG-085 A: caveat depende del origen de los counts.
  const onlyProvider = usageSources.has('provider') && !usageSources.has('proxy');
  const onlyProxy = usageSources.has('proxy') && !usageSources.has('provider');
  const headerCaveat = onlyProvider
    ? 'Cost summary (tokens & cost from provider usage):'
    : onlyProxy
      ? 'Cost summary (~estimated — tokens are chars/4 proxy, ±15-20% vs provider usage):'
      : 'Cost summary (mixed — some calls used provider usage, some fell back to chars/4 proxy):';
  const totalCaveat = onlyProvider ? '(provider-reported)' : '(~estimated)';
  console.log('');
  console.log(headerCaveat);
  console.log(
    `  ${'provider/model'.padEnd(40)} ${'agent'.padEnd(11)} ${'calls'.padStart(10)}  ` +
      `${'input'.padStart(7)}     ${'output'.padStart(6)}  ${'cost USD'.padStart(9)}  ${'latency'.padStart(7)}`,
  );
  for (const row of rows) console.log(row);
  console.log(
    `  Total: ${String(totalInput)} input tokens · ${String(totalOutput)} output tokens · ` +
      `$${totalCost.toFixed(4)} USD ${totalCaveat}`,
  );
}
