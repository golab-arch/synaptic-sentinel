/**
 * @synaptic-sentinel/core
 *
 * Coordinator del enjambre, colony DB (memoria de feromonas), tipos
 * compartidos y el contrato `ScoutAgent`. El schema de la colony DB esta
 * en ./colony/schema.sql.
 *
 * Licencia: Apache-2.0 (OSS).
 */

export const PACKAGE_NAME = '@synaptic-sentinel/core';

export * from './types/index.js';
export * from './correlation/index.js';
export * from './colony/colony-db.js';
export * from './colony/db-path.js';
export * from './coordinator/coordinator.js';
export * from './coordinator/excluded-paths.js';
export * from './coordinator/interaction-graph.js';
export * from './coordinator/priority-score.js';
export * from './config/agents-config.js';
export * from './config/agent-output-schemas.js';
export * from './config/benchmark-ground-truth.js';
export * from './config/pricing.js';
export * from './utils/token-count.js';
