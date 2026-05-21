import type { Tomo } from './tomo.js';

/**
 * Serializa un tomo al formato JSON del evidence package (v0.4 §4.2).
 * Salida legible (2 espacios) para ingesta por sistemas y revision humana.
 */
export function renderTomoJson(tomo: Tomo): string {
  return `${JSON.stringify(tomo, null, 2)}\n`;
}
