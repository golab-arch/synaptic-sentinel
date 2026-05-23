import {
  AgentConfigSchema,
  PROVIDER_NAMES,
  type AgentConfig,
  type BrainAgentId,
} from '@synaptic-sentinel/core';

/**
 * Parser de la CLI flag `--agent-provider` (repeatable, Phase 11 DG-073 B).
 *
 * Formato esperado de cada valor:
 *
 *   <agente>=<provider>/<model>
 *
 * Ejemplos:
 *
 *   --agent-provider triage=deepseek/deepseek-v3.2
 *   --agent-provider context=anthropic/claude-sonnet-4-6
 *   --agent-provider remediation=ollama/mistral-nemo:12b
 *
 * - El separador `=` discrimina el nombre del agente del rest (los modelos
 *   de Ollama llevan `:` en su nombre, asi que ese caracter no sirve).
 * - El separador `/` (UN solo `/`, el primero) discrimina provider del
 *   model name.
 * - El `model` puede contener `/` y `:` libremente despues del primer `/`.
 *
 * Se valida que (a) el agente sea uno de `triage` / `context` /
 * `remediation`, (b) el provider sea uno de PROVIDER_NAMES, (c) el model
 * no sea vacio. Cualquier desviacion lanza con un mensaje accionable.
 */

const AGENT_IDS: readonly BrainAgentId[] = ['triage', 'context', 'remediation'];

/** Resultado del parser: overrides por agente, todos opcionales. */
export type AgentProviderOverrides = Partial<Record<BrainAgentId, AgentConfig>>;

/**
 * Parsea una sola flag `--agent-provider <agent>=<provider>/<model>`.
 * Lanza si la sintaxis o los valores son invalidos.
 */
export function parseAgentProviderFlag(value: string): {
  agent: BrainAgentId;
  config: AgentConfig;
} {
  const eqIdx = value.indexOf('=');
  if (eqIdx <= 0) {
    throw new Error(`Invalid --agent-provider "${value}": expected "<agent>=<provider>/<model>".`);
  }
  const agent = value.slice(0, eqIdx);
  if (!(AGENT_IDS as readonly string[]).includes(agent)) {
    throw new Error(
      `Invalid --agent-provider "${value}": agent must be one of ${AGENT_IDS.join(', ')}.`,
    );
  }
  const rest = value.slice(eqIdx + 1);
  const slashIdx = rest.indexOf('/');
  if (slashIdx <= 0 || slashIdx === rest.length - 1) {
    throw new Error(
      `Invalid --agent-provider "${value}": expected "<provider>/<model>" after "=".`,
    );
  }
  const provider = rest.slice(0, slashIdx);
  const model = rest.slice(slashIdx + 1);
  if (!(PROVIDER_NAMES as readonly string[]).includes(provider)) {
    throw new Error(
      `Invalid --agent-provider "${value}": provider must be one of ${PROVIDER_NAMES.join(', ')}.`,
    );
  }
  const config: AgentConfig = AgentConfigSchema.parse({ provider, model });
  return { agent: agent as BrainAgentId, config };
}

/**
 * Parsea una lista de flags `--agent-provider` (en el orden en que vino).
 * Si la misma agente aparece dos veces, el ULTIMO gana - permite override
 * en linea de comando sobre lo que diga `agents.yaml` o defaults.
 */
export function parseAgentProviderFlags(values: readonly string[]): AgentProviderOverrides {
  const overrides: AgentProviderOverrides = {};
  for (const value of values) {
    const { agent, config } = parseAgentProviderFlag(value);
    overrides[agent] = config;
  }
  return overrides;
}
