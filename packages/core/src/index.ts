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
export * from './colony/colony-db.js';
export * from './coordinator/coordinator.js';
