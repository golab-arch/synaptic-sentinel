/**
 * Tipos compartidos de Synaptic Sentinel.
 *
 * Cada tipo se define como un schema `zod` (fuente unica de verdad) del que
 * se infiere el tipo TypeScript, de modo que la validacion en runtime y el
 * tipado estatico no puedan divergir.
 */

export * from './severity.js';
export * from './finding.js';
export * from './pheromone.js';
export * from './scan.js';
