import { describe, it, expect } from 'vitest';
import {
  estimateCostUsd,
  isPricedModel,
  PRICING_TABLE,
  type PricingTable,
} from '../../src/config/pricing.js';

describe('PRICING_TABLE', () => {
  it('incluye los 5 cloud providers del benchmark cross-provider (DG-076/DG-077)', () => {
    expect(PRICING_TABLE.models['anthropic/claude-haiku-4-5-20251001']).toBeDefined();
    expect(PRICING_TABLE.models['openai/gpt-5-nano']).toBeDefined();
    expect(PRICING_TABLE.models['deepseek/deepseek-v4-flash']).toBeDefined();
    expect(PRICING_TABLE.models['groq/llama-3.3-70b-versatile']).toBeDefined();
    expect(PRICING_TABLE.models['gemini/gemini-2.5-flash']).toBeDefined();
  });

  it('incluye los 3 providers locales como $0', () => {
    expect(PRICING_TABLE.localProviders['ollama']).toEqual({ input: 0, output: 0 });
    expect(PRICING_TABLE.localProviders['lmstudio']).toEqual({ input: 0, output: 0 });
    expect(PRICING_TABLE.localProviders['vllm']).toEqual({ input: 0, output: 0 });
  });
});

describe('estimateCostUsd', () => {
  it('calcula cost USD desde input+output tokens para un modelo conocido', () => {
    // anthropic/claude-haiku-4-5-20251001: input $1/M, output $5/M.
    // 1000 input + 200 output = (1000 * 1 + 200 * 5) / 1e6 = 0.002 USD
    const cost = estimateCostUsd('anthropic/claude-haiku-4-5-20251001', 1000, 200);
    expect(cost).toBeCloseTo(0.002, 6);
  });

  it('retorna 0 para providers locales (ollama/lmstudio/vllm)', () => {
    expect(estimateCostUsd('ollama/gemma4:latest', 100000, 50000)).toBe(0);
    expect(estimateCostUsd('lmstudio/qwen2.5:7b', 100000, 50000)).toBe(0);
    expect(estimateCostUsd('vllm/llama-3.3', 100000, 50000)).toBe(0);
  });

  it('retorna 0 para modelos desconocidos (conservador, no lanza)', () => {
    expect(estimateCostUsd('unknown/some-model', 1000, 100)).toBe(0);
    expect(estimateCostUsd('injected/test', 1000, 100)).toBe(0);
  });

  it('cero tokens → cero cost', () => {
    expect(estimateCostUsd('anthropic/claude-haiku-4-5-20251001', 0, 0)).toBe(0);
  });

  it('acepta pricing table custom (testabilidad)', () => {
    const customPricing: PricingTable = {
      models: { 'custom/model': { input: 10, output: 20 } },
      localProviders: {},
    };
    // 1000 * 10 + 100 * 20 = 12000 / 1e6 = 0.012
    expect(estimateCostUsd('custom/model', 1000, 100, customPricing)).toBeCloseTo(0.012, 6);
  });
});

describe('isPricedModel', () => {
  it('true para modelos en la tabla de pricing', () => {
    expect(isPricedModel('anthropic/claude-haiku-4-5-20251001')).toBe(true);
    expect(isPricedModel('deepseek/deepseek-v4-flash')).toBe(true);
  });

  it('true para providers locales (no son "unknown" cost-wise)', () => {
    expect(isPricedModel('ollama/gemma4:latest')).toBe(true);
    expect(isPricedModel('lmstudio/qwen')).toBe(true);
  });

  it('false para modelos no listados', () => {
    expect(isPricedModel('unknown/some-model')).toBe(false);
    expect(isPricedModel('anthropic/claude-future-100')).toBe(false);
  });
});
