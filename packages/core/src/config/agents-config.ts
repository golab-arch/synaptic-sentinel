import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';

/**
 * Schema y carga de `.sentinel/agents.yaml` (Phase 11 DG-073 B).
 *
 * El config file vive en `.sentinel/agents.yaml` en la raiz del proyecto
 * auditado (no en el repo de Sentinel). Es versionable en git y reviewable
 * en PRs - el patron Continue.dev que el usuario eligio en DG-070. La forma:
 *
 *   agents:
 *     triage:
 *       provider: deepseek
 *       model: deepseek-v3.2
 *     context:
 *       provider: anthropic
 *       model: claude-sonnet-4-6
 *     remediation:
 *       provider: anthropic
 *       model: claude-opus-4-7
 *
 * Las API keys NUNCA viven aqui (anti-leak): se resuelven aparte desde
 * env vars `SENTINEL_<PROVIDER>_API_KEY` (CLI) o `vscode.SecretStorage`
 * con keys namespaceadas `sentinel.<provider>.apiKey` (extension).
 *
 * Si el archivo no existe, `loadAgentsConfig` devuelve `null` y el
 * caller cae a la retro-compatibilidad (Anthropic Haiku 4.5 para los 3
 * agentes si hay `ANTHROPIC_API_KEY` configurada). Si el archivo existe
 * pero es invalido, lanza con un error claro.
 */

/** Providers soportados por el provider registry (`agents/src/provider-registry.ts`). */
export const PROVIDER_NAMES = [
  // Frontier nativo
  'anthropic',
  // OpenAI-compatible — un solo adapter sirve a 14+ via baseUrl override
  'openai',
  'groq',
  'deepseek',
  'mistral',
  'together',
  'fireworks',
  'perplexity',
  'xai',
  'gemini',
  'bedrock',
  'azure',
  // Local / self-hosted — adapter Ollama-especifico con XGrammar opt-in
  'ollama',
] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** Schema de la config de un agente individual (triage / context / remediation). */
export const AgentConfigSchema = z.object({
  /** Nombre del provider. */
  provider: z.enum(PROVIDER_NAMES),
  /** Nombre del modelo (provider-specific). */
  model: z.string().min(1),
  /**
   * URL base del endpoint del provider. Opcional - el provider registry
   * conoce los defaults para todos los providers OpenAI-compat. Solo se
   * setea para casos como Ollama en otro host, Azure OpenAI con instance
   * personalizada, AWS Bedrock Mantle con region especifica, etc.
   */
  baseUrl: z.string().url().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/** Schema del config file completo. */
export const AgentsConfigSchema = z.object({
  agents: z.object({
    triage: AgentConfigSchema,
    context: AgentConfigSchema,
    remediation: AgentConfigSchema,
  }),
});

export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;

/** Nombre del config file (relativo al directorio del proyecto). */
export const AGENTS_CONFIG_FILENAME = '.sentinel/agents.yaml';

/**
 * Parsea + valida una config de `.sentinel/agents.yaml` desde un objeto
 * JavaScript ya deserializado (funcion pura, testeable sin disco).
 */
export function parseAgentsConfig(raw: unknown): AgentsConfig {
  return AgentsConfigSchema.parse(raw);
}

/**
 * Parsea el contenido de `.sentinel/agents.yaml` como texto. Lanza con un
 * error claro si el YAML es invalido o si el schema no valida.
 */
export function parseAgentsConfigYaml(yamlText: string): AgentsConfig {
  const parsed: unknown = parseYaml(yamlText);
  return parseAgentsConfig(parsed);
}

/**
 * Carga `.sentinel/agents.yaml` desde el directorio del proyecto. Si el
 * archivo no existe, devuelve `null` (el caller decide el fallback).
 *
 * Si el archivo existe pero es invalido (YAML mal formado, schema no
 * matchea), lanza con un mensaje que incluye el path del archivo - asi el
 * usuario sabe exactamente que archivo tiene que corregir.
 */
export function loadAgentsConfig(projectRoot: string): AgentsConfig | null {
  const configPath = join(projectRoot, AGENTS_CONFIG_FILENAME);
  if (!existsSync(configPath)) return null;
  const yamlText = readFileSync(configPath, 'utf8');
  try {
    return parseAgentsConfigYaml(yamlText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid ${AGENTS_CONFIG_FILENAME}: ${message}`);
  }
}
