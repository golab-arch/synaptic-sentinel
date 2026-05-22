import {
  RemediationSuggestionSchema,
  type Finding,
  type RemediationSuggestion,
} from '@synaptic-sentinel/core';
import { extractJsonObject, type AgentPrompt, type BrainAgent } from './brain-agent.js';

// El tipo de la sugerencia vive en core; se reexporta para mantener estable
// el API de @synaptic-sentinel/agents.
export { RemediationSuggestionSchema };
export type { RemediationSuggestion };

/** Instruccion de sistema del Remediation Agent. */
const SYSTEM_PROMPT = `You are a senior application security (AppSec) engineer.
You receive a security finding already confirmed as a true positive and must
propose a concrete, safe and actionable remediation for a developer.

Respond ONLY with a valid JSON object, no markdown and no extra text, with this
exact shape:
{"summary":"<one-sentence summary>","recommendation":"<concrete steps to remediate>","fixedSnippet":"<corrected code fragment>"}
The "fixedSnippet" field is OPTIONAL: include it only if the remediation is a
specific code change; if it is a configuration or process remediation, omit the
key entirely. Write in English, clear and concise.`;

/**
 * Normaliza el objeto parseado: si el LLM devolvio `"fixedSnippet":""` (cadena
 * vacia) cuando no aplica un cambio de codigo, se elimina la clave para que el
 * campo opcional valide en vez de fallar por `min(1)`.
 */
function dropEmptySnippet(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const obj = value as Record<string, unknown>;
  if (obj['fixedSnippet'] !== '') return value;
  const copy: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key !== 'fixedSnippet') copy[key] = val;
  }
  return copy;
}

/**
 * Remediation Agent — propone como corregir un hallazgo confirmado (v0.4 §3.6:
 * resumen + pasos de remediacion + snippet corregido opcional). Es un
 * `BrainAgent`: prompt + parser, sin estado. Corre aguas abajo del Triage
 * Agent, sobre los hallazgos clasificados como verdaderos positivos.
 */
export class RemediationAgent implements BrainAgent<Finding, RemediationSuggestion> {
  readonly id = 'remediation';
  readonly displayName = 'Remediation Agent';
  readonly maxTokens = 1024;

  buildPrompt(finding: Finding): AgentPrompt {
    const snippet = finding.location.snippet ?? '(not available)';
    const user = [
      'Confirmed finding to remediate:',
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

  parseResponse(raw: string): RemediationSuggestion {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(raw));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not parse the remediation suggestion: ${message}`);
    }
    return RemediationSuggestionSchema.parse(dropEmptySnippet(parsed));
  }
}
