import {
  ContextExplanationSchema,
  type ContextExplanation,
  type Finding,
} from '@synaptic-sentinel/core';
import { extractJsonObject, type AgentPrompt, type BrainAgent } from './brain-agent.js';

// El tipo de la explicacion vive en core; se reexporta para mantener estable
// el API de @synaptic-sentinel/agents.
export { ContextExplanationSchema };
export type { ContextExplanation };

/** Instruccion de sistema del Context Agent. */
const SYSTEM_PROMPT = `Eres un analista senior de seguridad de aplicaciones (AppSec).
Recibes un hallazgo de seguridad ya confirmado como verdadero positivo y debes
explicar su cadena de explotabilidad para un desarrollador: de donde viene la
entrada no confiable, en que operacion peligrosa termina, y que se expone o se
logra si se explota.

Responde UNICAMENTE con un objeto JSON valido, sin markdown ni texto adicional,
con esta forma exacta:
{"summary":"<resumen en una frase>","entryPoint":"<de donde viene la entrada no confiable>","sink":"<la operacion peligrosa donde termina>","exposure":"<que se expone o se logra si se explota>"}
Escribe en espanol, claro y conciso (1 a 2 frases por campo).`;

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
    const snippet = finding.location.snippet ?? '(no disponible)';
    const user = [
      'Hallazgo confirmado a explicar:',
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

  parseResponse(raw: string): ContextExplanation {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(raw));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`No se pudo parsear la explicacion de contexto: ${message}`);
    }
    return ContextExplanationSchema.parse(parsed);
  }
}
