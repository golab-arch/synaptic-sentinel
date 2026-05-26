import { describe, it, expect } from 'vitest';
import { renderSettingsHtml, type SettingsViewState } from '../src/settings-content.js';

/** Construye un state mock con defaults razonables. */
function makeState(overrides: Partial<SettingsViewState> = {}): SettingsViewState {
  return {
    active: {
      triage: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      context: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      remediation: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    },
    source: 'fallback',
    agentsYamlPath: undefined,
    agentsYamlHasComments: false,
    credentials: {},
    ollama: { available: false, models: [], endpoint: 'http://localhost:11434' },
    suppressHeavyModelWarning: false,
    ...overrides,
  };
}

const HTML_OPTIONS = { nonce: 'test-nonce', cspSource: 'vscode-resource:' };

describe('renderSettingsHtml — estructura base', () => {
  it('incluye el doctype, CSP, nonce y titulo principal', () => {
    const html = renderSettingsHtml(makeState(), HTML_OPTIONS);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('nonce-test-nonce');
    expect(html).toContain('SYNAPTIC Sentinel — Brain Layer Providers');
  });

  it('incluye las 3 secciones (Active / Managed Credentials / Local Models)', () => {
    const html = renderSettingsHtml(makeState(), HTML_OPTIONS);
    expect(html).toContain('Active Configuration');
    expect(html).toContain('Managed Credentials');
    expect(html).toContain('Local Models (Auto-Discovery)');
  });
});

describe('renderSettingsHtml — Active Configuration', () => {
  it('muestra el provider y modelo de cada agente', () => {
    const html = renderSettingsHtml(
      makeState({
        source: 'agents.yaml',
        active: {
          triage: { provider: 'deepseek', model: 'deepseek-v3.2' },
          context: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
          remediation: { provider: 'openai', model: 'gpt-5-nano' },
        },
        agentsYamlPath: '/proj/.sentinel/agents.yaml',
      }),
      HTML_OPTIONS,
    );
    expect(html).toContain('deepseek');
    expect(html).toContain('deepseek-v3.2');
    expect(html).toContain('claude-sonnet-4-6');
    expect(html).toContain('gpt-5-nano');
    expect(html).toContain('/proj/.sentinel/agents.yaml');
  });

  it('indica que el source es Anthropic fallback cuando no hay yaml', () => {
    const html = renderSettingsHtml(makeState({ source: 'fallback' }), HTML_OPTIONS);
    expect(html).toContain('Anthropic Haiku fallback');
    expect(html).toContain('ANTHROPIC_API_KEY');
  });

  it('muestra warning cuando agents.yaml tiene comentarios', () => {
    const html = renderSettingsHtml(
      makeState({ source: 'agents.yaml', agentsYamlHasComments: true }),
      HTML_OPTIONS,
    );
    expect(html).toContain('comments');
    expect(html).toContain('strip');
  });

  it('no muestra warning cuando agents.yaml no tiene comentarios', () => {
    const html = renderSettingsHtml(
      makeState({ source: 'agents.yaml', agentsYamlHasComments: false }),
      HTML_OPTIONS,
    );
    expect(html).not.toContain('strip comments');
  });
});

describe('renderSettingsHtml — Managed Credentials', () => {
  it('muestra los 12 providers con auth', () => {
    const html = renderSettingsHtml(makeState(), HTML_OPTIONS);
    for (const provider of [
      'anthropic',
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
    ]) {
      expect(html).toContain(`data-provider="${provider}"`);
    }
  });

  it('muestra el badge "configured" cuando la credencial esta presente y no testeada', () => {
    const html = renderSettingsHtml(
      makeState({
        credentials: { anthropic: { configured: true, testStatus: 'pending' } },
      }),
      HTML_OPTIONS,
    );
    expect(html).toContain('configured</span>');
  });

  it('muestra el badge "tested" cuando el test paso', () => {
    const html = renderSettingsHtml(
      makeState({
        credentials: { openai: { configured: true, testStatus: 'ok' } },
      }),
      HTML_OPTIONS,
    );
    expect(html).toContain('tested</span>');
  });

  it('muestra "not set" cuando no hay credencial', () => {
    const html = renderSettingsHtml(
      makeState({ credentials: { deepseek: { configured: false, testStatus: 'pending' } } }),
      HTML_OPTIONS,
    );
    expect(html).toContain('not set</span>');
  });

  it('habilita Save y deshabilita Delete/Test cuando no hay credencial', () => {
    const html = renderSettingsHtml(makeState(), HTML_OPTIONS);
    expect(html).toContain('data-action="delete-key" data-provider="anthropic" disabled');
    expect(html).toContain('data-action="test-key" data-provider="anthropic" disabled');
  });

  it('habilita Delete y Test cuando hay credencial', () => {
    const html = renderSettingsHtml(
      makeState({
        credentials: { anthropic: { configured: true, testStatus: 'ok' } },
      }),
      HTML_OPTIONS,
    );
    expect(html).toContain('data-action="delete-key" data-provider="anthropic">Delete</button>');
    expect(html).toContain('data-action="test-key" data-provider="anthropic">Test</button>');
  });
});

describe('renderSettingsHtml — Local Models (Ollama)', () => {
  it('muestra "not found" cuando Ollama no responde', () => {
    const html = renderSettingsHtml(makeState(), HTML_OPTIONS);
    expect(html).toContain('not found</span>');
    expect(html).toContain('ollama serve');
  });

  it('muestra "found" + lista de modelos cuando Ollama responde', () => {
    const html = renderSettingsHtml(
      makeState({
        ollama: {
          available: true,
          models: ['mistral-nemo:12b', 'qwen2.5-coder:32b'],
          endpoint: 'http://localhost:11434',
        },
      }),
      HTML_OPTIONS,
    );
    expect(html).toContain('found</span>');
    expect(html).toContain('mistral-nemo:12b');
    expect(html).toContain('qwen2.5-coder:32b');
  });

  it('hint cuando Ollama responde sin modelos pulled', () => {
    const html = renderSettingsHtml(
      makeState({
        ollama: { available: true, models: [], endpoint: 'http://localhost:11434' },
      }),
      HTML_OPTIONS,
    );
    expect(html).toContain('found</span>');
    expect(html).toContain('No models pulled');
  });

  it('incluye un boton Refresh para Ollama', () => {
    const html = renderSettingsHtml(makeState(), HTML_OPTIONS);
    expect(html).toContain('data-action="refresh-ollama"');
  });
});

describe('renderSettingsHtml — escape HTML / defensa anti-inyeccion', () => {
  it('escapa cualquier comilla o tag en el path de agents.yaml', () => {
    const html = renderSettingsHtml(
      makeState({
        source: 'agents.yaml',
        agentsYamlPath: '/proj"><script>x</script>/agents.yaml',
      }),
      HTML_OPTIONS,
    );
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&quot;');
  });

  it('escapa cualquier tag en el nombre de un modelo de Ollama', () => {
    const html = renderSettingsHtml(
      makeState({
        ollama: {
          available: true,
          models: ['<script>alert(1)</script>:latest'],
          endpoint: 'http://localhost:11434',
        },
      }),
      HTML_OPTIONS,
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderSettingsHtml — Heavy model warning (DG-087 A)', () => {
  // ~6 GB en bytes (supera el umbral de 5 GB).
  const SIX_GB = 6 * 1024 * 1024 * 1024;
  // ~2 GB en bytes (por debajo del umbral).
  const TWO_GB = 2 * 1024 * 1024 * 1024;

  it('muestra el badge "⚠ heavy" + warning panel cuando un modelo supera 5 GB', () => {
    const html = renderSettingsHtml(
      makeState({
        ollama: {
          available: true,
          models: ['gemma4:latest'],
          modelsInfo: [{ name: 'gemma4:latest', sizeBytes: SIX_GB }],
          endpoint: 'http://localhost:11434',
        },
      }),
      HTML_OPTIONS,
    );
    expect(html).toContain('⚠ heavy');
    expect(html).toContain('exceed 5 GB');
    expect(html).toContain('6.0 GB');
    expect(html).toContain("Don't remind me again");
    expect(html).toContain('data-action="dismiss-heavy-warning"');
  });

  it('NO muestra el badge ni warning panel cuando todos los modelos ≤ 5 GB', () => {
    const html = renderSettingsHtml(
      makeState({
        ollama: {
          available: true,
          models: ['gemma3:4b'],
          modelsInfo: [{ name: 'gemma3:4b', sizeBytes: TWO_GB }],
          endpoint: 'http://localhost:11434',
        },
      }),
      HTML_OPTIONS,
    );
    // El tamaño SI se muestra siempre (informational).
    expect(html).toContain('2.0 GB');
    // Pero el badge "heavy" y el panel-level warning NO.
    expect(html).not.toContain('⚠ heavy');
    expect(html).not.toContain('exceed 5 GB');
    expect(html).not.toContain("Don't remind me again");
  });

  it('respeta suppressHeavyModelWarning=true: no muestra badge ni warning aunque haya modelos pesados', () => {
    const html = renderSettingsHtml(
      makeState({
        ollama: {
          available: true,
          models: ['gemma4:latest'],
          modelsInfo: [{ name: 'gemma4:latest', sizeBytes: SIX_GB }],
          endpoint: 'http://localhost:11434',
        },
        suppressHeavyModelWarning: true,
      }),
      HTML_OPTIONS,
    );
    // El tamaño sigue mostrandose (informational).
    expect(html).toContain('6.0 GB');
    // El badge y el panel-level warning estan suprimidos.
    expect(html).not.toContain('⚠ heavy');
    expect(html).not.toContain("Don't remind me again");
  });

  it('fallback legacy: render funciona sin modelsInfo (solo models string[])', () => {
    const html = renderSettingsHtml(
      makeState({
        ollama: {
          available: true,
          models: ['mistral-nemo:12b'],
          endpoint: 'http://localhost:11434',
          // sin modelsInfo
        },
      }),
      HTML_OPTIONS,
    );
    expect(html).toContain('mistral-nemo:12b');
    // Sin info de size no se renderea ni el tamaño ni el badge.
    expect(html).not.toContain('GB');
    expect(html).not.toContain('⚠ heavy');
  });

  it('renderea sizeBytes=0 sin tamaño ni badge (Ollama no reporto size)', () => {
    const html = renderSettingsHtml(
      makeState({
        ollama: {
          available: true,
          models: ['noisy-model:latest'],
          modelsInfo: [{ name: 'noisy-model:latest', sizeBytes: 0 }],
          endpoint: 'http://localhost:11434',
        },
      }),
      HTML_OPTIONS,
    );
    expect(html).toContain('noisy-model:latest');
    // Sin size reportado: no renderea size label ni badge heavy.
    expect(html).not.toContain('0.0 GB');
    expect(html).not.toContain('⚠ heavy');
  });
});
