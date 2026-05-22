import type { LlmClient } from './llm-client.js';

/** Prompt de un agente: instruccion de sistema + tarea del usuario. */
export interface AgentPrompt {
  readonly system: string;
  readonly user: string;
}

/**
 * Contrato de un agente de la capa Cerebro.
 *
 * Un agente NO es un microservicio ni un proceso: es un prompt especializado
 * mas un parser de su salida (v0.4 §"los agentes cerebro no son
 * microservicios"). `buildPrompt` y `parseResponse` son funciones puras y
 * deterministas; la unica parte no-determinista (la llamada al LLM) la
 * inyecta `runAgent` a traves de `LlmClient`.
 */
export interface BrainAgent<TInput, TOutput> {
  /** Identificador estable del agente. */
  readonly id: string;
  /** Nombre legible. */
  readonly displayName: string;
  /** Tope de tokens de la respuesta esperada. */
  readonly maxTokens: number;
  /** Construye el prompt para una entrada. */
  buildPrompt(input: TInput): AgentPrompt;
  /** Parsea (y valida) la respuesta cruda del LLM al output tipado. */
  parseResponse(raw: string): TOutput;
}

/**
 * Ejecuta un agente: construye el prompt, llama al LLM y parsea la salida.
 *
 * Es la unica funcion del Brain Layer que cruza la frontera no-determinista;
 * todo lo demas (prompt, parseo, validacion) es puro y testeable sin red.
 */
export async function runAgent<TInput, TOutput>(
  agent: BrainAgent<TInput, TOutput>,
  input: TInput,
  llm: LlmClient,
): Promise<TOutput> {
  const prompt = agent.buildPrompt(input);
  const raw = await llm.complete({
    system: prompt.system,
    user: prompt.user,
    maxTokens: agent.maxTokens,
  });
  return agent.parseResponse(raw);
}

/**
 * Extrae el primer objeto JSON de un texto.
 *
 * Tolera que el LLM envuelva el JSON en un bloque de codigo markdown o
 * agregue prosa alrededor. Lanza si no hay ningun objeto. Lo usan los
 * `parseResponse` de los agentes para leer respuestas estructuradas.
 */
export function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('The LLM response does not contain a JSON object.');
  }
  return candidate.slice(start, end + 1);
}
