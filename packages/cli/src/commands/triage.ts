import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  ColonyDb,
  deriveFromLearning,
  FindingSchema,
  patternSignature,
  triageClassificationToLearning,
  type ContextExplanationRecord,
  type LearningClassification,
  type RemediationSuggestionRecord,
  type TriageVerdict,
  type TriageVerdictRecord,
} from '@synaptic-sentinel/core';
import {
  AnthropicLlmClient,
  ContextAgent,
  RemediationAgent,
  runAgent,
  TriageAgent,
  type LlmClient,
} from '@synaptic-sentinel/agents';
import { renderBanner, renderTriageTag } from '@synaptic-sentinel/reporters';
import { shouldUseColor } from './scan.js';

/** Tope por defecto de hallazgos a triar (proteccion de costo/tokens). */
const DEFAULT_TRIAGE_LIMIT = 25;

/** Opciones del comando `triage`. */
export interface TriageCommandOptions {
  /** Directorio del proyecto cuyo `colony.db` se tria. */
  readonly path: string;
  /** Tope de hallazgos a triar en esta corrida. Por defecto 25. */
  readonly limit?: number;
  /**
   * Cliente LLM a usar. Por defecto un `AnthropicLlmClient` con la API key
   * de `ANTHROPIC_API_KEY` (BYOK). Inyectable para tests.
   */
  readonly llmClient?: LlmClient;
  /** Desactiva el color ANSI (tambien lo desactivan `NO_COLOR` y un stdout no-TTY). */
  readonly noColor?: boolean;
}

/**
 * Ejecuta el comando `triage`: corre el Brain Layer sobre los hallazgos del
 * ultimo scan. El Triage Agent clasifica cada hallazgo; sobre los verdaderos
 * positivos, el Context Agent explica la cadena de explotabilidad y el
 * Remediation Agent propone como corregirlos. Veredictos, explicaciones y
 * sugerencias se persisten en `colony.db`.
 *
 * Economia de tokens (v0.4 §187): salta los hallazgos ya descartados como
 * falso positivo (`fp_known`) y los ya triados. BYOK: la API key la provee
 * el cliente y va directo a Anthropic, sin backend de Synaptic.
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

  let llm = options.llmClient;
  if (llm === undefined) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (apiKey === undefined || apiKey === '') {
      console.error('triage requires an Anthropic API key (BYOK). Export ANTHROPIC_API_KEY.');
      return 1;
    }
    llm = new AnthropicLlmClient({ apiKey });
  }

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
          verdict = await runAgent(triageAgent, finding, llm);
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
        const source = learned !== undefined ? ' (colony memory)' : '';
        console.log(
          `  ${renderTriageTag(verdict.classification, color)}  ${finding.title} ` +
            `— ${finding.location.path}:${String(finding.location.startLine)} ` +
            `(confidence ${verdict.confidence.toFixed(2)})${source}`,
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
            const explanation = await runAgent(contextAgent, finding, llm);
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
            const message = err instanceof Error ? err.message : String(err);
            console.error(`      ! context failed for "${finding.title}": ${message}`);
          }
          // Stage 4 — Remediation: como corregir el verdadero positivo.
          try {
            const remediation = await runAgent(remediationAgent, finding, llm);
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
            const message = err instanceof Error ? err.message : String(err);
            console.error(`      ! remediation failed for "${finding.title}": ${message}`);
          }
        }
      } catch (err) {
        // Un fallo de triage no aborta la corrida (degraded > failed).
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ! triage failed for "${finding.title}": ${message}`);
      }
    }

    db.insertTriageVerdicts(verdicts);
    db.insertContextExplanations(explanations);
    db.insertRemediationSuggestions(remediations);
    db.recordLearningBatch(learningEntries, scanId);
    console.log(
      `Triage verdicts persisted: ${String(verdicts.length)}; ` +
        `context explanations: ${String(explanations.length)}; ` +
        `remediation suggestions: ${String(remediations.length)}; ` +
        `patterns learned: ${String(learningEntries.length)}; ` +
        `pre-classified from memory: ${String(learnedCount)}.`,
    );
    return 0;
  } finally {
    db.close();
  }
}
