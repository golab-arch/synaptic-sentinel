import { randomUUID } from 'node:crypto';
import { FindingSchema, type Finding } from '@synaptic-sentinel/core';
import { VIBE_DETECTORS } from './detectors.js';

/** Longitud maxima del fragmento de codigo guardado en un hallazgo. */
const MAX_SNIPPET_LENGTH = 200;

/** Contexto para convertir las coincidencias de un archivo en `Finding[]`. */
export interface VibeDetectContext {
  /** Scan al que pertenecen los hallazgos. */
  readonly scanId: string;
  /** Identificador del scout (`vibe-detect`). */
  readonly scoutId: string;
  /** Ruta del archivo, relativa a la raiz del proyecto y normalizada con `/`. */
  readonly filePath: string;
  /** Generador de marca temporal (inyectable para tests deterministas). */
  readonly now?: () => string;
  /** Generador de IDs (inyectable para tests deterministas). */
  readonly newId?: () => string;
}

/**
 * Aplica el catalogo de detectores `VibeCoded` al contenido de un archivo y
 * devuelve un `Finding` por cada par (linea, detector) que coincide.
 *
 * Funcion pura: no toca el sistema de archivos, de modo que es testeable de
 * forma directa contra strings. El recorrido del arbol de archivos vive en
 * `VibeDetectScout`.
 */
export function runVibeDetectors(content: string, ctx: VibeDetectContext): Finding[] {
  const now = ctx.now ?? ((): string => new Date().toISOString());
  const newId = ctx.newId ?? ((): string => randomUUID());
  const findings: Finding[] = [];

  content.split(/\r?\n/).forEach((line, index) => {
    const startLine = index + 1;
    for (const detector of VIBE_DETECTORS) {
      if (!detector.pattern.test(line)) continue;
      const snippet = line.trim().slice(0, MAX_SNIPPET_LENGTH);
      const finding = {
        id: newId(),
        scanId: ctx.scanId,
        scoutId: ctx.scoutId,
        severity: detector.severity,
        category: 'VibeCoded',
        ruleId: detector.id,
        title: detector.title,
        message: detector.message,
        location: {
          path: ctx.filePath,
          startLine,
          ...(snippet.length > 0 ? { snippet } : {}),
        },
        complianceRefs: [...detector.complianceRefs],
        fingerprint: `${ctx.filePath}:${detector.id}:${String(startLine)}`,
        lifecycleState: 'new',
        createdAt: now(),
      };
      findings.push(FindingSchema.parse(finding));
    }
  });
  return findings;
}
