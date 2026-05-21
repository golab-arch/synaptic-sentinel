/**
 * @synaptic-sentinel/scouts
 *
 * Capa Scout (determinista, sin LLM): wrappers de scanners OSS ejecutados
 * como child processes dentro del perimetro del cliente. El contrato comun
 * `ScoutAgent` vive en `@synaptic-sentinel/core`.
 *
 * Licencia: Apache-2.0 (OSS).
 */

export const PACKAGE_NAME = '@synaptic-sentinel/scouts';

export * from './run-process.js';
export * from './opengrep/opengrep-scout.js';
export * from './opengrep/rules.js';
export * from './gitleaks/gitleaks-scout.js';
