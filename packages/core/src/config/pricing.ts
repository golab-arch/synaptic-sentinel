/**
 * Tabla de pricing por modelo LLM y helper para estimar costo USD (DG-078 B).
 *
 * Single source of truth para el benchmark cross-provider (DG-076/DG-077)
 * y para el cost visibility del comando `triage` (DG-078 B).
 *
 * Inline TS const (no JSON externo) por el mismo motivo que el manifest
 * de scanners (DG-059): evita el ceremonial de copiar JSON al bundle
 * (`copy-cli-assets.mjs`) y elimina riesgo de drift de paths entre dev y
 * `.vsix`. El usuario que quiera actualizar pricing recompila el paquete.
 *
 * Cost en USD por **1 millón** de tokens. `input` = prompt tokens (system +
 * user). `output` = completion tokens. Local providers (Ollama / LM Studio
 * / vLLM) son $0 porque corren en hardware del usuario (electricidad e
 * inference time NO se modelan).
 *
 * Fuente: páginas de pricing públicas a 2026-05-23. Sujeto a cambios del
 * provider — caveat documentado en el reporte del benchmark.
 */

/** Cost por 1M tokens de un modelo concreto. */
export interface ModelPricing {
  readonly input: number;
  readonly output: number;
}

/** Tabla completa de pricing — modelos cloud + locales. */
export interface PricingTable {
  /** Map `<provider>/<model>` -> pricing. */
  readonly models: Readonly<Record<string, ModelPricing>>;
  /** Map `<provider>` -> pricing (siempre $0 para locales). */
  readonly localProviders: Readonly<Record<string, ModelPricing>>;
}

/** Source of truth pricing table. */
export const PRICING_TABLE: PricingTable = {
  models: {
    'anthropic/claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
    'anthropic/claude-sonnet-4-6': { input: 3.0, output: 15.0 },
    'anthropic/claude-opus-4-7': { input: 15.0, output: 75.0 },
    'openai/gpt-5-nano': { input: 0.2, output: 1.25 },
    'openai/gpt-5-mini': { input: 2.5, output: 10.0 },
    'openai/gpt-5': { input: 5.0, output: 30.0 },
    'deepseek/deepseek-v4-flash': { input: 0.07, output: 0.28 },
    'deepseek/deepseek-v4-pro': { input: 0.27, output: 1.1 },
    'deepseek/deepseek-r1': { input: 0.55, output: 2.0 },
    'groq/llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
    'groq/llama-4-scout-17b': { input: 0.11, output: 0.34 },
    'mistral/mistral-large-3': { input: 0.5, output: 1.5 },
    'mistral/mistral-small-3.2': { input: 0.1, output: 0.3 },
    'gemini/gemini-2.5-flash': { input: 0.075, output: 0.3 },
    'gemini/gemini-2.5-pro': { input: 1.25, output: 10.0 },
    'xai/grok-4-fast': { input: 0.2, output: 0.5 },
  },
  localProviders: {
    ollama: { input: 0.0, output: 0.0 },
    lmstudio: { input: 0.0, output: 0.0 },
    vllm: { input: 0.0, output: 0.0 },
  },
};

/**
 * Estima el costo USD de una sesión dada total de tokens consumidos.
 * Función pura: el caller pasa la `PricingTable` (default = `PRICING_TABLE`).
 *
 * Resolución:
 *   1. Match exacto en `pricing.models[providerLabel]` (ej.
 *      "anthropic/claude-haiku-4-5-20251001").
 *   2. Si no, intenta `pricing.localProviders[providerName]` (split por "/")
 *      → siempre $0.
 *   3. Si no, retorna 0 con caveat "unknown model" (el caller decide si
 *      marcar el reporte con asterisco).
 */
export function estimateCostUsd(
  providerLabel: string,
  inputTokens: number,
  outputTokens: number,
  pricing: PricingTable = PRICING_TABLE,
): number {
  const direct = pricing.models[providerLabel];
  if (direct !== undefined) {
    return (inputTokens * direct.input + outputTokens * direct.output) / 1_000_000;
  }
  const providerName = providerLabel.split('/')[0];
  if (providerName !== undefined && pricing.localProviders[providerName] !== undefined) {
    return 0;
  }
  // Unknown model: 0 conservador. El reporte/summary debería surfacearlo.
  return 0;
}

/**
 * Indica si un modelo es "conocido" en la pricing table. Útil para que el
 * reporte marque con asterisco modelos no listados (cost shown = 0 pero
 * NO porque sea local — porque no lo conocemos).
 */
export function isPricedModel(
  providerLabel: string,
  pricing: PricingTable = PRICING_TABLE,
): boolean {
  if (pricing.models[providerLabel] !== undefined) return true;
  const providerName = providerLabel.split('/')[0];
  return providerName !== undefined && pricing.localProviders[providerName] !== undefined;
}
