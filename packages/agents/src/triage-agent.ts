import { z } from 'zod';
import type { Finding } from '@synaptic-sentinel/core';
import type { AgentPrompt, BrainAgent } from './brain-agent.js';

/** Clasificaciones de triage de un hallazgo (v0.4 §3.6: TP / FP / inconcluso). */
export const TRIAGE_CLASSIFICATIONS = [
  'true_positive',
  'false_positive',
  'inconclusive',
] as const;

/** Schema de validacion de la clasificacion. */
export const TriageClassificationSchema = z.enum(TRIAGE_CLASSIFICATIONS);

/** Clasificacion de triage de un hallazgo. */
export type TriageClassification = z.infer<typeof TriageClassificationSchema>;

/**
 * Veredicto del Triage Agent sobre un hallazgo.
 *
 * La respuesta del LLM es entrada no confiable: se valida con este schema
 * antes de usarse (defensa en profundidad contra Memory Poisoning, v0.4 §9.6).
 */
export const TriageVerdictSchema = z.object({
  classification: TriageClassificationSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

/** Veredicto del Triage Agent. */
export type TriageVerdict = z.infer<typeof TriageVerdictSchema>;

/** Instruccion de sistema del Triage Agent. */
const SYSTEM_PROMPT = `Eres un analista senior de seguridad de aplicaciones (AppSec).
Recibes un hallazgo producido por un scanner estatico (SAST o secrets) y debes
TRIARLO: decidir si es un verdadero positivo explotable, un falso positivo, o si
no hay informacion suficiente para decidir.

Criterios:
- true_positive: representa un riesgo real y explotable.
- false_positive: el patron se disparo pero NO hay riesgo real en este contexto.
- inconclusive: falta contexto (codigo circundante, flujo de datos) para decidir.

Responde UNICAMENTE con un objeto JSON valido, sin markdown ni texto adicional,
con esta forma exacta:
{"classification":"true_positive"|"false_positive"|"inconclusive","confidence":<numero entre 0 y 1>,"rationale":"<explicacion breve en espanol, maximo 2 frases>"}`;

/**
 * Extrae el primer objeto JSON de un texto.
 *
 * Tolera que el LLM envuelva el JSON en un bloque de codigo markdown o
 * agregue prosa alrededor. Lanza si no hay ningun objeto.
 */
export function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('La respuesta del LLM no contiene un objeto JSON.');
  }
  return candidate.slice(start, end + 1);
}

/**
 * Triage Agent — reduce falsos positivos clasificando cada hallazgo crudo
 * de un scout (v0.4 §3.6). Es un `BrainAgent`: prompt + parser, sin estado.
 */
export class TriageAgent implements BrainAgent<Finding, TriageVerdict> {
  readonly id = 'triage';
  readonly displayName = 'Triage Agent';
  readonly maxTokens = 512;

  buildPrompt(finding: Finding): AgentPrompt {
    const snippet = finding.location.snippet ?? '(no disponible)';
    const user = [
      'Hallazgo a triar:',
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

  parseResponse(raw: string): TriageVerdict {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(raw));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`No se pudo parsear el veredicto de triage: ${message}`);
    }
    return TriageVerdictSchema.parse(parsed);
  }
}
