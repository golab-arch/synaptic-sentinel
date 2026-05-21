import { randomUUID } from 'node:crypto';
import { FindingSchema, type Finding } from '@synaptic-sentinel/core';
import { relativizePath } from '../opengrep/normalizer.js';
import type { GitleaksOutput } from './gitleaks-output.js';

/** Contexto necesario para normalizar la salida de Gitleaks a `Finding[]`. */
export interface GitleaksNormalizeContext {
  /** Scan al que pertenecen los hallazgos. */
  readonly scanId: string;
  /** Identificador del scout (`gitleaks`). */
  readonly scoutId: string;
  /** Raiz del proyecto, para relativizar las rutas. */
  readonly rootPath: string;
  /** Generador de marca temporal (inyectable para tests deterministas). */
  readonly now?: () => string;
  /** Generador de IDs (inyectable para tests deterministas). */
  readonly newId?: () => string;
}

/**
 * Normaliza la salida de Gitleaks a la lista canonica de `Finding`.
 *
 * Todo secreto filtrado se mapea a severidad `high` y categoria `Secrets`:
 * una credencial en el codigo es un hallazgo serio. La discriminacion fina
 * (TP/FP, criticidad real) corresponde al Brain Layer.
 */
export function normalizeGitleaksOutput(
  output: GitleaksOutput,
  ctx: GitleaksNormalizeContext,
): Finding[] {
  const now = ctx.now ?? ((): string => new Date().toISOString());
  const newId = ctx.newId ?? ((): string => randomUUID());

  return output.map((result): Finding => {
    const finding = {
      id: newId(),
      scanId: ctx.scanId,
      scoutId: ctx.scoutId,
      severity: 'high',
      category: 'Secrets',
      ruleId: result.RuleID,
      title: result.RuleID,
      message: result.Description,
      location: {
        path: relativizePath(result.File, ctx.rootPath),
        startLine: result.StartLine,
        endLine: result.EndLine,
        ...(result.StartColumn > 0 ? { startColumn: result.StartColumn } : {}),
        ...(result.EndColumn > 0 ? { endColumn: result.EndColumn } : {}),
        snippet: result.Match,
      },
      // CWE-798: Use of Hard-coded Credentials.
      complianceRefs: ['CWE-798'],
      fingerprint: result.Fingerprint,
      lifecycleState: 'new',
      createdAt: now(),
    };
    return FindingSchema.parse(finding);
  });
}
