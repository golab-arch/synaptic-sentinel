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
    title: 'Secreto placeholder dejado en el codigo',
    severity: 'high',
    message:
      'Una credencial fue asignada a un valor de marcador de posicion sin ' +
      'reemplazar. Tipico de codigo generado por IA: el marcador quedo sin ' +
      'completar, o un valor real se commiteo bajo un nombre de ejemplo.',
    pattern:
      /\b(?:api[-_]?key|secret|password|passwd|access[-_]?key|client[-_]?secret|auth[-_]?token|token)\b["'`\s]*[:=]\s*["'`]\s*(?:your[-_ ]|<[a-z]|x{4,}|changeme|change[-_ ]me|placeholder|replace[-_ ]me|todo|example|dummy|sample|insert[-_ ]|paste[-_ ])/i,
    complianceRefs: ['CWE-798'],
  },
  {
    id: 'vibe-suppressed-security-check',
    title: 'Control de seguridad suprimido en linea',
    severity: 'medium',
    message:
      'Una regla de seguridad fue silenciada con un comentario de supresion ' +
      'en linea. Suele aparecer cuando se acalla al linter en vez de corregir ' +
      'el hallazgo de fondo.',
    pattern:
      /(?:eslint-disable[a-z-]*[^\n]*\bsecurity\b|#\s*nosec\b|checkov:skip|gitleaks:allow|trivy:ignore|bandit:\s*skip)/i,
    complianceRefs: [],
  },
  {
    id: 'vibe-security-todo-stub',
    title: 'Trabajo de seguridad pendiente (TODO/FIXME)',
    severity: 'medium',
    message:
      'Un comentario TODO/FIXME/HACK senala trabajo de seguridad pendiente ' +
      '(autenticacion, validacion, control de acceso). El codigo generado por ' +
      'IA suele dejar la parte de seguridad como ejercicio para el desarrollador.',
    pattern:
      /(?:\/\/|#|\/\*|\*|<!--)\s*(?:TODO|FIXME|HACK|XXX)\b[^\n]*\b(?:auth|authenticat|authoriz|secur|validat|sanitiz|encrypt|permission|csrf|injection)/i,
    complianceRefs: ['CWE-546'],
  },
  {
    id: 'vibe-permissive-cors',
    title: 'CORS abierto a cualquier origen',
    severity: 'high',
    message:
      'La politica CORS permite cualquier origen. Un default comodo y muy ' +
      'frecuente en codigo generado por IA que expone la API a sitios de terceros.',
    pattern: /(?:access-control-allow-origin\b[^\n]*\*|\borigin\s*:\s*(?:["'`]\*["'`]|true)\b)/i,
    complianceRefs: ['CWE-942'],
  },
  {
    id: 'vibe-disabled-tls-verification',
    title: 'Verificacion de certificado TLS deshabilitada',
    severity: 'high',
    message:
      'La validacion del certificado TLS fue desactivada. Saltarse la ' +
      'verificacion del certificado abre la puerta a ataques man-in-the-middle.',
    pattern:
      /(?:\bverify\s*=\s*False\b|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*["'`]?0|InsecureSkipVerify\s*:\s*true|ssl\._create_unverified_context)/i,
    complianceRefs: ['CWE-295'],
  },
  {
    id: 'vibe-debug-mode-enabled',
    title: 'Modo debug activado de forma fija',
    severity: 'medium',
    message:
      'El modo debug quedo activado de forma fija. En produccion expone trazas ' +
      'de pila y, en frameworks como Flask, puede habilitar ejecucion remota de ' +
      'codigo via la consola de depuracion.',
    pattern:
      /(?:\bdebug\s*=\s*True\b|app\.run\([^)\n]*\bdebug\s*=\s*True|\bFLASK_DEBUG\s*[:=]\s*["'`]?1\b)/i,
    complianceRefs: ['CWE-489'],
  },
];
