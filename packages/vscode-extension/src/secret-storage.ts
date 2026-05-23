import type * as vscode from 'vscode';

/**
 * Helpers namespaceados sobre `vscode.SecretStorage` (Phase 11 DG-073 B).
 *
 * En v0.2.0, la unica API key (Anthropic) se guardaba bajo la key
 * `synaptic-sentinel.anthropicApiKey`. En v0.3.0 (multi-provider) cada
 * provider tiene su slot:
 *
 *   sentinel.anthropic.apiKey
 *   sentinel.openai.apiKey
 *   sentinel.deepseek.apiKey
 *   sentinel.groq.apiKey
 *   ...
 *
 * Migracion: la primera vez que se LEE `sentinel.anthropic.apiKey`, si esta
 * vacio pero existe la key legacy, se copia + se borra la legacy. Es
 * idempotente y barato (una sola llamada extra por session a lo sumo).
 *
 * Los providers que NO requieren auth (Ollama local) no se almacenan aqui.
 */

/** Nombre de la key legacy (v0.2.0, solo Anthropic). */
export const LEGACY_ANTHROPIC_SECRET_KEY = 'synaptic-sentinel.anthropicApiKey';

/**
 * Lista canonica de providers que tienen slot en `SecretStorage`. Coincide
 * con `PROVIDER_NAMES` del registry, excepto Ollama (sin auth).
 *
 * Definida aqui (no importada de `core`) para que el modulo no tenga deps
 * externas — la extension lo importa antes de que se cargue `core`.
 */
export const SECRET_PROVIDERS = [
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
] as const;

export type SecretProviderName = (typeof SECRET_PROVIDERS)[number];

/** Construye la clave de SecretStorage para un provider. */
export function secretKeyFor(provider: SecretProviderName): string {
  return `sentinel.${provider}.apiKey`;
}

/** Construye el nombre de la env var con la que la CLI lee la apiKey. */
export function envVarFor(provider: SecretProviderName): string {
  return `SENTINEL_${provider.toUpperCase()}_API_KEY`;
}

/**
 * Una sola vez por sesion: si `sentinel.anthropic.apiKey` no existe pero
 * existe la key legacy v0.2.0, copia su valor al slot nuevo y elimina la
 * legacy. Despues de esto, el codigo nuevo trabaja exclusivamente con la
 * namespaceada.
 */
export async function migrateLegacyAnthropicKey(secrets: vscode.SecretStorage): Promise<void> {
  const newKey = secretKeyFor('anthropic');
  const existing = await secrets.get(newKey);
  if (existing !== undefined && existing !== '') return;
  const legacy = await secrets.get(LEGACY_ANTHROPIC_SECRET_KEY);
  if (legacy === undefined || legacy === '') return;
  await secrets.store(newKey, legacy);
  await secrets.delete(LEGACY_ANTHROPIC_SECRET_KEY);
}

/**
 * Obtiene la apiKey de un provider del SecretStorage. Aplica la migracion
 * legacy si el provider es `anthropic` y la nueva key no existe todavia.
 */
export async function getProviderApiKey(
  secrets: vscode.SecretStorage,
  provider: SecretProviderName,
): Promise<string | undefined> {
  if (provider === 'anthropic') {
    await migrateLegacyAnthropicKey(secrets);
  }
  const value = await secrets.get(secretKeyFor(provider));
  return value !== undefined && value !== '' ? value : undefined;
}

/** Guarda la apiKey de un provider en el SecretStorage. */
export async function setProviderApiKey(
  secrets: vscode.SecretStorage,
  provider: SecretProviderName,
  apiKey: string,
): Promise<void> {
  const trimmed = apiKey.trim();
  if (trimmed === '') {
    await secrets.delete(secretKeyFor(provider));
    return;
  }
  await secrets.store(secretKeyFor(provider), trimmed);
}

/** Elimina la apiKey de un provider del SecretStorage. */
export async function deleteProviderApiKey(
  secrets: vscode.SecretStorage,
  provider: SecretProviderName,
): Promise<void> {
  await secrets.delete(secretKeyFor(provider));
}

/**
 * Devuelve un map `{ ENV_VAR: apiKey }` con todas las apiKeys configuradas
 * — pensado para inyectarlo en el `env` del child process de la CLI. La
 * extension barre los 12 providers conocidos y, para los que tengan key
 * almacenada, pone una entrada con el nombre de env var canonico
 * `SENTINEL_<PROVIDER>_API_KEY`. La CLI las descubre via
 * `resolveApiKeyFromEnv` del provider registry.
 *
 * Para retro-compat con la CLI v0.2.0 (que solo lee `ANTHROPIC_API_KEY`),
 * tambien duplica la key de Anthropic en `ANTHROPIC_API_KEY` cuando esta
 * configurada.
 */
export async function collectAllApiKeysAsEnv(
  secrets: vscode.SecretStorage,
): Promise<Record<string, string>> {
  await migrateLegacyAnthropicKey(secrets);
  const env: Record<string, string> = {};
  for (const provider of SECRET_PROVIDERS) {
    const value = await secrets.get(secretKeyFor(provider));
    if (value !== undefined && value !== '') {
      env[envVarFor(provider)] = value;
      // Retro-compat: la legacy ANTHROPIC_API_KEY queda viva en paralelo.
      if (provider === 'anthropic') {
        env['ANTHROPIC_API_KEY'] = value;
      }
    }
  }
  return env;
}
