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
const SYSTEM_PROMPT = `Eres un ingeniero senior de seguridad de aplicaciones (AppSec).
Recibes un hallazgo de seguridad ya confirmado como verdadero positivo y debes
proponer una remediacion concreta, segura y accionable para un desarrollador.

Responde UNICAMENTE con un objeto JSON valido, sin markdown ni texto adicional,
con esta forma exacta:
{"summary":"<resumen en una frase>","recommendation":"<pasos concretos para remediar>","fixedSnippet":"<fragmento de codigo corregido>"}
El campo "fixedSnippet" es OPCIONAL: incluyelo solo si la remediacion es un
cambio de codigo puntual; si es una remediacion de configuracion o de proceso,
omite la clave por completo. Escribe en espanol, claro y conciso.`;

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
    const snippet = finding.location.snippet ?? '(no disponible)';
    const user = [
      'Hallazgo confirmado a remediar:',
      `- Regla: ${finding.ruleId}`,
      `- Categoria: ${finding.category}`,
      `- Severidad: ${finding.severity}`,
      `- Titulo: ${finding.title}`,
      `- Mensaje: ${finding.message}`,
      `- Ubicacion: ${finding.location.path}:${String(finding.location.startLine)}`,
      `- Codigo:\n${snippet}`,
    ].join('\n');
    return { system: SYSTEM_PROMPT, user };
  }

  parseResponse(raw: string): RemediationSuggestion {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(raw));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`No se pudo parsear la sugerencia de remediacion: ${message}`);
    }
    return RemediationSuggestionSchema.parse(dropEmptySnippet(parsed));
  }
}
