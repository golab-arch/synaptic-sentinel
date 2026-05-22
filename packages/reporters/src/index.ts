/**
 * @synaptic-sentinel/reporters
 *
 * Generacion del evidence package (el "tomo"). JSON y SARIF son OSS;
 * HTML elaborado, PDF y firma digital son Pro.
 *
 * Licencia: Apache-2.0 (OSS) para los reporters incluidos aqui.
 */

export const PACKAGE_NAME = '@synaptic-sentinel/reporters';

export * from './tomo.js';
export * from './json-reporter.js';
export * from './html-reporter.js';
export * from './console-reporter.js';
