import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  ColonyDb,
  FindingSchema,
  type ContextExplanationRecord,
  type TriageVerdictRecord,
} from '@synaptic-sentinel/core';
import {
  AnthropicLlmClient,
  ContextAgent,
  runAgent,
  TriageAgent,
  type LlmClient,
} from '@synaptic-sentinel/agents';

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
}

/**
 * Ejecuta el comando `triage`: corre el Brain Layer sobre los hallazgos del
 * ultimo scan. El Triage Agent clasifica cada hallazgo; el Context Agent
 * explica la cadena de explotabilidad de los verdaderos positivos. Veredictos
 * y explicaciones se persisten en `colony.db`.
 *
 * Economia de tokens (v0.4 §187): salta los hallazgos ya descartados como
 * falso positivo (`fp_known`) y los ya triados. BYOK: la API key la provee
 * el cliente y va directo a Anthropic, sin backend de Synaptic.
 */
export async function runTriageCommand(options: TriageCommandOptions): Promise<number> {
  const projectRoot = resolve(options.path);
  const dbPath = join(projectRoot, '.synaptic-sentinel', 'colony.db');
  if (!existsSync(dbPath)) {
    console.error(
      `No hay colony.db en ${projectRoot}. Corre "synaptic-sentinel scan" primero.`,
    );
    return 1;
  }

  let llm = options.llmClient;
  if (llm === undefined) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (apiKey === undefined || apiKey === '') {
      console.error(
        'triage requiere una API key de Anthropic (BYOK). Exporta ANTHROPIC_API_KEY.',
      );
      return 1;
    }
    llm = new AnthropicLlmClient({ apiKey });
  }

  const db = ColonyDb.open(dbPath);
  try {
    const scanId = db.getLatestScanId();
    if (scanId === undefined) {
      console.error('colony.db no tiene ningun scan. Corre "synaptic-sentinel scan" primero.');
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
        !knownFalsePositives.has(finding.fingerprint) &&
        !alreadyTriaged.has(finding.fingerprint),
    );

    const limit = options.limit ?? DEFAULT_TRIAGE_LIMIT;
    const toTriage = pending.slice(0, limit);
    console.log(
      `Triage del scan ${scanId}: ${String(findings.length)} hallazgo(s), ` +
        `${String(findings.length - pending.length)} omitido(s) (FP conocido / ya triado), ` +
        `${String(toTriage.length)} a triar.`,
    );
    if (pending.length > toTriage.length) {
      console.log(`  (limitado a ${String(limit)}; usa --limit para ampliar)`);
    }

    const triageAgent = new TriageAgent();
    const contextAgent = new ContextAgent();
    const verdicts: TriageVerdictRecord[] = [];
    const explanations: ContextExplanationRecord[] = [];
    for (const finding of toTriage) {
      try {
        const verdict = await runAgent(triageAgent, finding, llm);
        verdicts.push({
          id: randomUUID(),
          scanId,
          fingerprint: finding.fingerprint,
          classification: verdict.classification,
          confidence: verdict.confidence,
          rationale: verdict.rationale,
          agentId: triageAgent.id,
          createdAt: new Date().toISOString(),
        });
        console.log(
          `  [${verdict.classification}] ${finding.title} ` +
            `— ${finding.location.path}:${String(finding.location.startLine)} ` +
            `(confianza ${verdict.confidence.toFixed(2)})`,
        );
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
            console.log(`      contexto: ${explanation.summary}`);
          } catch (err) {
            // Un fallo de contexto no descarta el veredicto de triage.
            const message = err instanceof Error ? err.message : String(err);
            console.error(`      ! fallo el contexto de "${finding.title}": ${message}`);
          }
        }
      } catch (err) {
        // Un fallo de triage no aborta la corrida (degraded > failed).
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ! fallo el triage de "${finding.title}": ${message}`);
      }
    }

    db.insertTriageVerdicts(verdicts);
    db.insertContextExplanations(explanations);
    console.log(
      `Veredictos de triage persistidos: ${String(verdicts.length)}; ` +
        `explicaciones de contexto: ${String(explanations.length)}.`,
    );
    return 0;
  } finally {
    db.close();
  }
}
