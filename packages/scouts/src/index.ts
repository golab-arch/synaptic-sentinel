/**
 * @synaptic-sentinel/scouts
 *
 * Capa Scout (determinista, sin LLM): la interfaz `ScoutAgent` comun y los
 * wrappers de scanners OSS, ejecutados como child processes dentro del
 * perimetro del cliente.
 *
 * Licencia: Apache-2.0 (OSS).
 */

export const PACKAGE_NAME = '@synaptic-sentinel/scouts';

export * from './opengrep/opengrep-scout.js';
