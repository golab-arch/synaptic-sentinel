import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { ColonyDb, FindingSchema, type TriageVerdictRecord } from '@synaptic-sentinel/core';
import {
  AnthropicLlmClient,
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
 * Ejecuta el comando `triage`: corre el Triage Agent sobre los hallazgos del
 * ultimo scan y persiste los veredictos en `colony.db`.
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

    const agent = new TriageAgent();
    const records: TriageVerdictRecord[] = [];
    for (const finding of toTriage) {
      try {
        const verdict = await runAgent(agent, finding, llm);
        records.push({
          id: randomUUID(),
          scanId,
          fingerprint: finding.fingerprint,
          classification: verdict.classification,
          confidence: verdict.confidence,
          rationale: verdict.rationale,
          agentId: agent.id,
          createdAt: new Date().toISOString(),
        });
        console.log(
          `  [${verdict.classification}] ${finding.title} ` +
            `— ${finding.location.path}:${String(finding.location.startLine)} ` +
            `(confianza ${verdict.confidence.toFixed(2)})`,
        );
      } catch (err) {
        // Un fallo de triage no aborta la corrida (degraded > failed).
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ! fallo el triage de "${finding.title}": ${message}`);
      }
    }

    db.insertTriageVerdicts(records);
    console.log(`Veredictos de triage persistidos: ${String(records.length)}.`);
    return 0;
  } finally {
    db.close();
  }
}
