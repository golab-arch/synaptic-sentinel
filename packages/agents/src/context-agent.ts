import {
  ContextExplanationSchema,
  type ContextExplanation,
  type Finding,
} from '@synaptic-sentinel/core';
import { extractJsonObject, type AgentPrompt, type BrainAgent } from './brain-agent.js';
import { formatInteractionContext } from './triage-agent.js';

// El tipo de la explicacion vive en core; se reexporta para mantener estable
// el API de @synaptic-sentinel/agents.
export { ContextExplanationSchema };
export type { ContextExplanation };

/** Instruccion de sistema del Context Agent. */
const SYSTEM_PROMPT = `You are a senior application security (AppSec) analyst.
You receive a security finding already confirmed as a true positive and must
explain its exploitability chain for a developer: where the untrusted input
comes from, which dangerous operation it ends in, and what is exposed or
achieved if it is exploited.

Respond ONLY with a valid JSON object, no markdown and no extra text, with this
exact shape:
{"summary":"<one-sentence summary>","entryPoint":"<where the untrusted input comes from>","sink":"<the dangerous operation where it ends>","exposure":"<what is exposed or achieved if exploited>"}
Write in English, clear and concise (1 to 2 sentences per field).`;

/**
 * Context Agent — explica la cadena de explotabilidad de un hallazgo
 * confirmado (v0.4 §3.6: entrada -> sink -> exposicion). Es un `BrainAgent`:
 * prompt + parser, sin estado. Corre aguas abajo del Triage Agent, sobre
 * los hallazgos clasificados como verdaderos positivos.
 */
export class ContextAgent implements BrainAgent<Finding, ContextExplanation> {
  readonly id = 'context';
  readonly displayName = 'Context Agent';
  readonly maxTokens = 1024;

  buildPrompt(finding: Finding): AgentPrompt {
    const snippet = finding.location.snippet ?? '(not available)';
    // DG-123 A (Cycle 111): incluye el interaction context al final del user
    // prompt (mismo helper que Triage Agent). Fallback graceful si el
    // Coordinator no pobló fileContext/symbolContext.
    const interactionContext = formatInteractionContext(finding);
    const interactionSection = interactionContext.length > 0 ? ['', interactionContext] : [];
    const user = [
      'Confirmed finding to explain:',
      `- Rule: ${finding.ruleId}`,
      `- Category: ${finding.category}`,
      `- Severity: ${finding.severity}`,
      `- Title: ${finding.title}`,
      `- Message: ${finding.message}`,
      `- Location: ${finding.location.path}:${String(finding.location.startLine)}`,
      `- Code:\n${snippet}`,
      ...interactionSection,
    ].join('\n');
    return { system: SYSTEM_PROMPT, user };
  }

  parseResponse(raw: string): ContextExplanation {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(raw));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not parse the context explanation: ${message}`);
    }
    return ContextExplanationSchema.parse(parsed);
  }
}
