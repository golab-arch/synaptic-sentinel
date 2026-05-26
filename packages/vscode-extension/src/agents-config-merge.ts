import {
  PROVIDER_NAMES,
  type AgentConfig,
  type AgentsConfig,
  type BrainAgentId,
  type ProviderName,
} from '@synaptic-sentinel/core';

/**
 * Helper puro testeable (DG-090 A): aplica el merge de un cambio de
 * provider para UN agente sobre una `AgentsConfig` base.
 *
 * Vive en un archivo separado de `settings-view.ts` para evitar la
 * dependencia transitiva en `vscode` (que rompe el environment de vitest
 * unit). Misma estrategia que `agents-yaml-writer.ts` (DG-074 B).
 *
 * Validacion defensiva:
 *   - `agentId` debe ser uno de los 3 (`triage` / `context` / `remediation`);
 *   - `provider` debe estar en `PROVIDER_NAMES` (anti-typo, anti-injection
 *     desde el postMessage del webview);
 *   - `model` debe ser non-empty tras trim.
 *
 * Devuelve `null` si algun arg es invalido — el caller muestra el warning
 * correspondiente y omite la escritura del yaml.
 */
export function mergeAgentConfig(
  current: AgentsConfig,
  agentId: unknown,
  provider: unknown,
  model: unknown,
): AgentsConfig | null {
  const validAgent =
    agentId === 'triage' || agentId === 'context' || agentId === 'remediation'
      ? (agentId as BrainAgentId)
      : null;
  if (validAgent === null) return null;
  const validProvider =
    typeof provider === 'string' && (PROVIDER_NAMES as readonly string[]).includes(provider)
      ? (provider as ProviderName)
      : null;
  if (validProvider === null) return null;
  if (typeof model !== 'string' || model.trim() === '') return null;
  const next: AgentConfig = { provider: validProvider, model: model.trim() };
  return {
    ...current,
    agents: { ...current.agents, [validAgent]: next },
  };
}
