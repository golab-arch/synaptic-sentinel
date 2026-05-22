/**
 * Tipos compartidos de Synaptic Sentinel.
 *
 * Cada tipo de datos se define como un schema `zod` (fuente unica de verdad)
 * del que se infiere el tipo TypeScript, de modo que la validacion en runtime
 * y el tipado estatico no puedan divergir.
 */

export * from './severity.js';
export * from './finding.js';
export * from './pheromone.js';
export * from './fp-known.js';
export * from './triage.js';
export * from './context.js';
export * from './remediation.js';
export * from './scan.js';
export * from './scout-agent.js';
