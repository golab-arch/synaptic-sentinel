import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import {
  AGENTS_CONFIG_FILENAME,
  loadAgentsConfig,
  type BrainAgentId,
  type ProviderName,
} from '@synaptic-sentinel/core';
import {
  ANTHROPIC_FALLBACK_MODEL,
  buildAnthropicFallbackConfig,
  isOllamaAvailable,
  listOllamaModelsWithInfo,
} from '@synaptic-sentinel/agents';
import { agentsYamlHasComments, renderAgentsYaml } from './agents-yaml-writer.js';
import {
  deleteProviderApiKey,
  getProviderApiKey,
  setProviderApiKey,
  type SecretProviderName,
} from './secret-storage.js';
import {
  renderSettingsHtml,
  type CredentialStatus,
  type OllamaModelEntry,
  type OllamaStatus,
  type ResolvedAgentConfig,
  type SettingsViewState,
} from './settings-content.js';

/** Key del globalState donde se persiste el "Don't remind me again" (DG-087 A). */
export const SUPPRESS_HEAVY_MODEL_WARNING_KEY = 'synaptic-sentinel.suppressHeavyModelWarning';

/**
 * Proveedor del webview "Configure Brain Layer Providers" (Phase 11
 * DG-074 B).
 *
 * Sigue el patron de `SentinelTomoViewProvider` (DG-039 B): el HTML lo
 * arma un renderer puro (`settings-content.ts`), el provider hace
 * solo el round-trip con SecretStorage + el sondeo de Ollama. Las
 * API keys NUNCA cruzan al webview en texto plano — la UI solo recibe
 * un boolean `configured` por provider.
 *
 * Acciones soportadas via `postMessage`:
 *   - `ready`           — el webview recien cargado; mandamos state inicial
 *   - `set-key`         — guardar apiKey de un provider en SecretStorage
 *   - `delete-key`      — borrar apiKey de un provider
 *   - `test-key`        — (placeholder UX) marca el provider como tested-ok
 *                          inmediatamente. La validacion real (un ping al
 *                          provider) queda para DG-076 que ya tiene el
 *                          benchmark; aqui solo registra que el usuario
 *                          intento testear y la apiKey esta presente.
 *   - `refresh-ollama`         — re-pingea localhost:11434 y re-lista modelos
 *   - `dismiss-heavy-warning`  — (DG-087 A) marca en globalState que el usuario
 *                                pidio NO ver mas el warning de modelos Ollama
 *                                pesados; persiste cross-workspace
 */
export class SentinelSettingsViewProvider {
  /** Id del comando que abre el panel; contribuido en package.json. */
  static readonly commandId = 'synaptic-sentinel.configureProviders';

  /** El panel webview activo (singleton: si ya esta abierto se revela). */
  #panel: vscode.WebviewPanel | undefined;
  /** Status mutable de cada credencial (testStatus se persiste por session). */
  readonly #credentialStatus = new Map<SecretProviderName, CredentialStatus>();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly workspaceRootProvider: () => string | undefined,
    /**
     * Globalstate Memento para flags persistidos cross-workspace (DG-087 A:
     * "Don't remind me again" del warning de modelos Ollama pesados).
     * Opcional para tests legacy que instancian el provider sin contexto;
     * en producción siempre se pasa `context.globalState`.
     */
    private readonly globalState?: vscode.Memento,
  ) {}

  /** Abre el panel (lo crea si no existe, lo revela si ya esta). */
  async open(): Promise<void> {
    if (this.#panel !== undefined) {
      this.#panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'synaptic-sentinel.providers',
      'SYNAPTIC Sentinel — Brain Layer Providers',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.#panel = panel;
    panel.onDidDispose(() => {
      this.#panel = undefined;
    });
    panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.#onMessage(message);
    });
    await this.#render();
  }

  /** Resuelve el state actual + lo renderiza en el webview. */
  async #render(): Promise<void> {
    const panel = this.#panel;
    if (panel === undefined) return;
    const state = await this.#resolveState();
    panel.webview.html = renderSettingsHtml(state, {
      nonce: randomUUID(),
      cspSource: panel.webview.cspSource,
    });
  }

  /**
   * Resuelve el state completo del panel:
   *   - active configuration desde `.sentinel/agents.yaml` o fallback
   *   - estado de cada credencial (`configured` + ultimo test)
   *   - Ollama auto-discovery
   */
  async #resolveState(): Promise<SettingsViewState> {
    const workspaceRoot = this.workspaceRootProvider();

    // (1) Active configuration.
    let activeYamlConfig: ReturnType<typeof loadAgentsConfig> = null;
    let agentsYamlPath: string | undefined;
    let agentsYamlHasCommentsFlag = false;
    if (workspaceRoot !== undefined) {
      agentsYamlPath = join(workspaceRoot, AGENTS_CONFIG_FILENAME);
      try {
        activeYamlConfig = loadAgentsConfig(workspaceRoot);
      } catch {
        // YAML invalido: se trata como "no config" en la UI.
        activeYamlConfig = null;
      }
      if (existsSync(agentsYamlPath)) {
        try {
          const yamlText = readFileSync(agentsYamlPath, 'utf8');
          agentsYamlHasCommentsFlag = agentsYamlHasComments(yamlText);
        } catch {
          agentsYamlHasCommentsFlag = false;
        }
      }
    }

    const active: Record<BrainAgentId, ResolvedAgentConfig> =
      activeYamlConfig !== null
        ? {
            triage: {
              provider: activeYamlConfig.agents.triage.provider,
              model: activeYamlConfig.agents.triage.model,
            },
            context: {
              provider: activeYamlConfig.agents.context.provider,
              model: activeYamlConfig.agents.context.model,
            },
            remediation: {
              provider: activeYamlConfig.agents.remediation.provider,
              model: activeYamlConfig.agents.remediation.model,
            },
          }
        : (() => {
            const fb = buildAnthropicFallbackConfig();
            return {
              triage: { provider: fb.agents.triage.provider, model: fb.agents.triage.model },
              context: { provider: fb.agents.context.provider, model: fb.agents.context.model },
              remediation: {
                provider: fb.agents.remediation.provider,
                model: fb.agents.remediation.model,
              },
            };
          })();

    const anthropicKey = await getProviderApiKey(this.secrets, 'anthropic');
    const source: SettingsViewState['source'] =
      activeYamlConfig !== null ? 'agents.yaml' : anthropicKey !== undefined ? 'fallback' : 'none';

    // (2) Credentials.
    const authProviders: readonly SecretProviderName[] = [
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
    ];
    const credentials: Record<string, CredentialStatus> = {};
    for (const provider of authProviders) {
      const key = await getProviderApiKey(this.secrets, provider);
      const existing = this.#credentialStatus.get(provider);
      credentials[provider] = {
        configured: key !== undefined,
        testStatus: existing?.testStatus ?? 'pending',
        ...(existing?.testMessage !== undefined ? { testMessage: existing.testMessage } : {}),
      };
    }

    // (3) Ollama. DG-087 A: ademas de los nombres legacy, traemos info con
    // tamaño (size en bytes) para que el renderer marque heavy models.
    const ollamaEndpoint = 'http://localhost:11434';
    const ollamaAvailable = await isOllamaAvailable(ollamaEndpoint);
    const ollamaInfos = ollamaAvailable ? await listOllamaModelsWithInfo(ollamaEndpoint) : [];
    const ollamaModels = ollamaInfos.map((info) => info.name);
    const modelsInfo: readonly OllamaModelEntry[] = ollamaInfos.map((info) => ({
      name: info.name,
      sizeBytes: info.sizeBytes,
    }));

    const ollama: OllamaStatus = {
      available: ollamaAvailable,
      models: ollamaModels,
      modelsInfo,
      endpoint: ollamaEndpoint,
    };

    // (4) Suppress heavy warning flag (DG-087 A): persistido en globalState.
    const suppressHeavyModelWarning =
      this.globalState?.get<boolean>(SUPPRESS_HEAVY_MODEL_WARNING_KEY, false) ?? false;

    return {
      active,
      source,
      ...(agentsYamlPath !== undefined ? { agentsYamlPath } : { agentsYamlPath: undefined }),
      agentsYamlHasComments: agentsYamlHasCommentsFlag,
      credentials,
      ollama,
      suppressHeavyModelWarning,
    };
  }

  /** Maneja un mensaje del webview. */
  async #onMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) return;
    const msg = message as {
      type?: unknown;
      provider?: unknown;
      apiKey?: unknown;
    };

    if (msg.type === 'ready') {
      await this.#render();
      return;
    }

    if (msg.type === 'refresh-ollama') {
      await this.#render();
      return;
    }

    if (msg.type === 'dismiss-heavy-warning') {
      // DG-087 A: el usuario clickeo "Don't remind me again" en el warning de
      // modelos Ollama pesados. Persistir cross-workspace en globalState y
      // re-renderizar para suprimir el warning + los badges heavy.
      await this.globalState?.update(SUPPRESS_HEAVY_MODEL_WARNING_KEY, true);
      await this.#render();
      return;
    }

    const provider =
      typeof msg.provider === 'string' ? (msg.provider as SecretProviderName) : undefined;
    if (provider === undefined) return;

    if (msg.type === 'set-key') {
      const apiKey = typeof msg.apiKey === 'string' ? msg.apiKey : '';
      if (apiKey.trim() === '') {
        void vscode.window.showWarningMessage(
          `SYNAPTIC Sentinel: empty API key for ${provider} ignored.`,
        );
        return;
      }
      await setProviderApiKey(this.secrets, provider, apiKey);
      this.#credentialStatus.set(provider, {
        configured: true,
        testStatus: 'pending',
      });
      void vscode.window.showInformationMessage(`SYNAPTIC Sentinel: ${provider} API key saved.`);
      await this.#render();
      return;
    }

    if (msg.type === 'delete-key') {
      await deleteProviderApiKey(this.secrets, provider);
      this.#credentialStatus.delete(provider);
      void vscode.window.showInformationMessage(`SYNAPTIC Sentinel: ${provider} API key deleted.`);
      await this.#render();
      return;
    }

    if (msg.type === 'test-key') {
      // En este DG, "Test" es un placeholder de UX: marca la credencial como
      // tested-ok si esta configurada. La validacion real (un ping al
      // provider) requiere conocer el endpoint exacto y el modelo, y va a
      // ser deferida al benchmark empirico DG-076 que ya ejercita la red
      // real. La excepcion es Ollama que se valida via auto-discovery
      // (boton "Refresh" del panel).
      const key = await getProviderApiKey(this.secrets, provider);
      this.#credentialStatus.set(provider, {
        configured: key !== undefined,
        testStatus: key !== undefined ? 'ok' : 'error',
        testMessage:
          key !== undefined
            ? 'Key is present in SecretStorage. Network validation deferred to DG-076 (empirical benchmark).'
            : 'No API key configured.',
      });
      await this.#render();
      return;
    }
  }
}

/**
 * Side-effect helper: persiste una `AgentsConfig` a
 * `<workspaceRoot>/.sentinel/agents.yaml`. Crea el directorio si hace
 * falta. Devuelve el path absoluto resultante.
 *
 * El renderer YAML lleva un header autogenerado que documenta el origen
 * (DG-074 B). Si el archivo pre-existente tenia comentarios, se pierden
 * — la UI advierte antes de invocar este helper (state.agentsYamlHasComments).
 */
export function writeAgentsYamlFromUI(
  workspaceRoot: string,
  config: ReturnType<typeof buildAnthropicFallbackConfig>,
): string {
  const targetDir = join(workspaceRoot, dirname(AGENTS_CONFIG_FILENAME));
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(workspaceRoot, AGENTS_CONFIG_FILENAME);
  writeFileSync(targetPath, renderAgentsYaml(config), 'utf8');
  return targetPath;
}

/** Lista canonica de providers para el bridge UI <-> registry (excl. ollama). */
export const UI_AUTH_PROVIDERS: readonly ProviderName[] = [
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
];

/** Re-export para compat con el module type contract. */
export { ANTHROPIC_FALLBACK_MODEL };
