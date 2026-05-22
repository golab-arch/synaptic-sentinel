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

/** Instruccion de sistema del Triage Agent. */
const SYSTEM_PROMPT = `You are a senior application security (AppSec) analyst.
You receive a finding produced by a static scanner (SAST or secrets) and must
TRIAGE it: decide whether it is an exploitable true positive, a false positive,
or whether there is not enough information to decide.

Criteria:
- true_positive: represents a real, exploitable risk.
- false_positive: the pattern matched but there is NO real risk in this context.
- inconclusive: missing context (surrounding code, data flow) to decide.

Respond ONLY with a valid JSON object, no markdown and no extra text, with this
exact shape:
{"classification":"true_positive"|"false_positive"|"inconclusive","confidence":<number between 0 and 1>,"rationale":"<brief explanation in English, at most 2 sentences>"}`;

/**
 * Triage Agent — reduce falsos positivos clasificando cada hallazgo crudo
 * de un scout (v0.4 §3.6). Es un `BrainAgent`: prompt + parser, sin estado.
 */
export class TriageAgent implements BrainAgent<Finding, TriageVerdict> {
  readonly id = 'triage';
  readonly displayName = 'Triage Agent';
  readonly maxTokens = 512;

  buildPrompt(finding: Finding): AgentPrompt {
    const snippet = finding.location.snippet ?? '(not available)';
    const user = [
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
    return TriageVerdictSchema.parse(parsed);
  }
}
