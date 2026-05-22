import type { Severity } from '@synaptic-sentinel/core';

/**
 * Un detector heuristico de un anti-patron de "codigo vibe-coded": codigo
 * generado por IA y aceptado sin revision. Cada detector es una expresion
 * regular que se evalua linea por linea.
 *
 * Importante: los patrones NO llevan el flag `g` — se usan con `RegExp.test`,
 * que con `g` seria stateful (avanza `lastIndex`) y produciria resultados
 * intermitentes entre lineas.
 */
export interface VibeDetector {
  /** Identificador estable de la regla (sirve de `ruleId` y de `fingerprint`). */
  readonly id: string;
  /** Titulo corto y legible. */
  readonly title: string;
  /** Severidad del hallazgo. */
  readonly severity: Severity;
  /** Descripcion del anti-patron y su riesgo. */
  readonly message: string;
  /** Patron que dispara el detector, evaluado por linea. */
  readonly pattern: RegExp;
  /** Referencias de cumplimiento (CWE) asociadas; vacio si no hay una clara. */
  readonly complianceRefs: readonly string[];
}

/**
 * Catalogo curado de detectores de anti-patrones de codigo generado por IA.
 *
 * El catalogo es deliberadamente conservador: cada patron apunta a una senal
 * de alta confianza para minimizar falsos positivos. La discriminacion fina
 * (es realmente explotable en este proyecto?) la afina el Brain Layer.
 */
export const VIBE_DETECTORS: readonly VibeDetector[] = [
  {
    id: 'vibe-placeholder-secret',
    title: 'Placeholder secret left in the code',
    severity: 'high',
    message:
      'A credential was assigned an unreplaced placeholder value. Typical of ' +
      'AI-generated code: the placeholder was left unfilled, or a real value ' +
      'was committed under an example name.',
    pattern:
      /\b(?:api[-_]?key|secret|password|passwd|access[-_]?key|client[-_]?secret|auth[-_]?token|token)\b["'`\s]*[:=]\s*["'`]\s*(?:your[-_ ]|<[a-z]|x{4,}|changeme|change[-_ ]me|placeholder|replace[-_ ]me|todo|example|dummy|sample|insert[-_ ]|paste[-_ ])/i,
    complianceRefs: ['CWE-798'],
  },
  {
    id: 'vibe-suppressed-security-check',
    title: 'Security check suppressed inline',
    severity: 'medium',
    message:
      'A security rule was silenced with an inline suppression comment. Often ' +
      'appears when the linter is muted instead of fixing the underlying finding.',
    pattern:
      /(?:eslint-disable[a-z-]*[^\n]*\bsecurity\b|#\s*nosec\b|checkov:skip|gitleaks:allow|trivy:ignore|bandit:\s*skip)/i,
    complianceRefs: [],
  },
  {
    id: 'vibe-security-todo-stub',
    title: 'Pending security work (TODO/FIXME)',
    severity: 'medium',
    message:
      'A TODO/FIXME/HACK comment flags pending security work (authentication, ' +
      'validation, access control). AI-generated code often leaves the security ' +
      'part as an exercise for the developer.',
    pattern:
      /(?:\/\/|#|\/\*|\*|<!--)\s*(?:TODO|FIXME|HACK|XXX)\b[^\n]*\b(?:auth|authenticat|authoriz|secur|validat|sanitiz|encrypt|permission|csrf|injection)/i,
    complianceRefs: ['CWE-546'],
  },
  {
    id: 'vibe-permissive-cors',
    title: 'CORS open to any origin',
    severity: 'high',
    message:
      'The CORS policy allows any origin. A convenient default, very common in ' +
      'AI-generated code, that exposes the API to third-party sites.',
    pattern: /(?:access-control-allow-origin\b[^\n]*\*|\borigin\s*:\s*(?:["'`]\*["'`]|true)\b)/i,
    complianceRefs: ['CWE-942'],
  },
  {
    id: 'vibe-disabled-tls-verification',
    title: 'TLS certificate verification disabled',
    severity: 'high',
    message:
      'TLS certificate validation was turned off. Skipping certificate ' +
      'verification opens the door to man-in-the-middle attacks.',
    pattern:
      /(?:\bverify\s*=\s*False\b|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*["'`]?0|InsecureSkipVerify\s*:\s*true|ssl\._create_unverified_context)/i,
    complianceRefs: ['CWE-295'],
  },
  {
    id: 'vibe-debug-mode-enabled',
    title: 'Debug mode hard-enabled',
    severity: 'medium',
    message:
      'Debug mode was left hard-enabled. In production it exposes stack traces ' +
      'and, in frameworks like Flask, can enable remote code execution via the ' +
      'debug console.',
    pattern:
      /(?:\bdebug\s*=\s*True\b|app\.run\([^)\n]*\bdebug\s*=\s*True|\bFLASK_DEBUG\s*[:=]\s*["'`]?1\b)/i,
    complianceRefs: ['CWE-489'],
  },
];
