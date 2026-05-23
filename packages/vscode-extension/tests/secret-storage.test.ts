import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import {
  collectAllApiKeysAsEnv,
  deleteProviderApiKey,
  envVarFor,
  getProviderApiKey,
  LEGACY_ANTHROPIC_SECRET_KEY,
  migrateLegacyAnthropicKey,
  secretKeyFor,
  setProviderApiKey,
} from '../src/secret-storage.js';

/**
 * Implementacion in-memory de `vscode.SecretStorage` para los tests
 * (no hay vscode disponible bajo Vitest unit). El contrato mimico es el
 * minimo que usa el helper.
 */
function makeFakeSecretStorage(seed: Record<string, string> = {}): vscode.SecretStorage {
  const store = new Map<string, string>(Object.entries(seed));
  // El tipo `vscode.SecretStorage` exige tambien `onDidChange`; lo
  // pisamos con un objeto mock; los helpers no lo invocan.
  return {
    get: (key: string) => Promise.resolve(store.get(key)),
    store: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
    onDidChange: () => ({ dispose: () => {} }),
  } as unknown as vscode.SecretStorage;
}

describe('secretKeyFor / envVarFor', () => {
  it('namespacea las claves de SecretStorage como sentinel.<provider>.apiKey', () => {
    expect(secretKeyFor('anthropic')).toBe('sentinel.anthropic.apiKey');
    expect(secretKeyFor('deepseek')).toBe('sentinel.deepseek.apiKey');
  });

  it('mapea las env vars con el patron SENTINEL_<PROVIDER>_API_KEY', () => {
    expect(envVarFor('anthropic')).toBe('SENTINEL_ANTHROPIC_API_KEY');
    expect(envVarFor('xai')).toBe('SENTINEL_XAI_API_KEY');
  });
});

describe('migrateLegacyAnthropicKey', () => {
  it('migra la legacy key v0.2.0 al slot namespaceado y la elimina', async () => {
    const secrets = makeFakeSecretStorage({
      [LEGACY_ANTHROPIC_SECRET_KEY]: 'sk-legacy',
    });
    await migrateLegacyAnthropicKey(secrets);
    expect(await secrets.get(secretKeyFor('anthropic'))).toBe('sk-legacy');
    expect(await secrets.get(LEGACY_ANTHROPIC_SECRET_KEY)).toBeUndefined();
  });

  it('no hace nada si ya existe el slot namespaceado', async () => {
    const secrets = makeFakeSecretStorage({
      [LEGACY_ANTHROPIC_SECRET_KEY]: 'sk-legacy',
      [secretKeyFor('anthropic')]: 'sk-new',
    });
    await migrateLegacyAnthropicKey(secrets);
    expect(await secrets.get(secretKeyFor('anthropic'))).toBe('sk-new'); // no la pisa
    // La legacy queda hasta que la limpie explicitamente otra cosa; el
    // helper solo migra cuando hace falta. (Si la migracion es no-op por
    // tener slot nuevo, no se borra la legacy.)
    expect(await secrets.get(LEGACY_ANTHROPIC_SECRET_KEY)).toBe('sk-legacy');
  });

  it('no hace nada si no hay legacy key', async () => {
    const secrets = makeFakeSecretStorage();
    await migrateLegacyAnthropicKey(secrets);
    expect(await secrets.get(secretKeyFor('anthropic'))).toBeUndefined();
  });
});

describe('getProviderApiKey / setProviderApiKey / deleteProviderApiKey', () => {
  it('persiste y recupera la apiKey de un provider', async () => {
    const secrets = makeFakeSecretStorage();
    await setProviderApiKey(secrets, 'deepseek', 'sk-deep');
    expect(await getProviderApiKey(secrets, 'deepseek')).toBe('sk-deep');
  });

  it('aplica trim al guardar', async () => {
    const secrets = makeFakeSecretStorage();
    await setProviderApiKey(secrets, 'openai', '  sk-x  ');
    expect(await getProviderApiKey(secrets, 'openai')).toBe('sk-x');
  });

  it('una cadena vacia borra el slot', async () => {
    const secrets = makeFakeSecretStorage({ [secretKeyFor('openai')]: 'sk-x' });
    await setProviderApiKey(secrets, 'openai', '');
    expect(await getProviderApiKey(secrets, 'openai')).toBeUndefined();
  });

  it('deleteProviderApiKey elimina el slot', async () => {
    const secrets = makeFakeSecretStorage({ [secretKeyFor('groq')]: 'gsk-x' });
    await deleteProviderApiKey(secrets, 'groq');
    expect(await getProviderApiKey(secrets, 'groq')).toBeUndefined();
  });

  it('get devuelve undefined si el slot esta vacio', async () => {
    const secrets = makeFakeSecretStorage({ [secretKeyFor('mistral')]: '' });
    expect(await getProviderApiKey(secrets, 'mistral')).toBeUndefined();
  });

  it('al leer la key de anthropic, migra automaticamente la legacy v0.2.0', async () => {
    const secrets = makeFakeSecretStorage({
      [LEGACY_ANTHROPIC_SECRET_KEY]: 'sk-ant-legacy',
    });
    expect(await getProviderApiKey(secrets, 'anthropic')).toBe('sk-ant-legacy');
    // Post-lectura, la legacy ya no existe.
    expect(await secrets.get(LEGACY_ANTHROPIC_SECRET_KEY)).toBeUndefined();
  });
});

describe('collectAllApiKeysAsEnv', () => {
  it('arma un map env-style con todas las apiKeys configuradas', async () => {
    const secrets = makeFakeSecretStorage({
      [secretKeyFor('anthropic')]: 'sk-ant',
      [secretKeyFor('deepseek')]: 'sk-deep',
      [secretKeyFor('groq')]: 'gsk-x',
    });
    const env = await collectAllApiKeysAsEnv(secrets);
    expect(env['SENTINEL_ANTHROPIC_API_KEY']).toBe('sk-ant');
    expect(env['SENTINEL_DEEPSEEK_API_KEY']).toBe('sk-deep');
    expect(env['SENTINEL_GROQ_API_KEY']).toBe('gsk-x');
    // Anthropic se duplica en la env legacy para retro-compat con la CLI v0.2.0.
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant');
  });

  it('devuelve un map vacio si no hay ninguna key configurada', async () => {
    const secrets = makeFakeSecretStorage();
    expect(await collectAllApiKeysAsEnv(secrets)).toEqual({});
  });

  it('migra la legacy anthropic key como side-effect', async () => {
    const secrets = makeFakeSecretStorage({
      [LEGACY_ANTHROPIC_SECRET_KEY]: 'sk-ant-legacy',
    });
    const env = await collectAllApiKeysAsEnv(secrets);
    expect(env['SENTINEL_ANTHROPIC_API_KEY']).toBe('sk-ant-legacy');
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-legacy');
    expect(await secrets.get(LEGACY_ANTHROPIC_SECRET_KEY)).toBeUndefined();
  });
});
