import type { Finding, ScanOutcome, Severity } from '@synaptic-sentinel/core';

/**
 * Reporter de consola: renderiza un scan a texto con estetica "techie"
 * (color ANSI, glifos por severidad). Todas las funciones son puras —
 * reciben un flag `color` y devuelven un string; la animacion (spinner) y
 * la escritura a stdout viven en la CLI. Asi este modulo es 100% testeable.
 *
 * El color ANSI se emite solo cuando el llamante lo habilita (TTY / forzado);
 * con `color = false` la salida es texto plano, apta para CI o pipes.
 */

/** Codigos ANSI base. */
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

/** Envuelve `text` en `codes` si `color` esta activo; si no, lo deja crudo. */
export function paint(text: string, codes: string, color: boolean): string {
  return color ? `${codes}${text}${RESET}` : text;
}

/** Color ANSI-256 por severidad (iconografia de v0.4 §4.3). */
const SEVERITY_COLOR: Readonly<Record<Severity, string>> = {
  critical: '\x1b[38;5;196m', // rojo
  high: '\x1b[38;5;208m', // naranja
  medium: '\x1b[38;5;220m', // amarillo
  low: '\x1b[38;5;39m', // azul
  info: '\x1b[38;5;245m', // gris
};

/** Glifo por severidad (v0.4 §4.3). */
const SEVERITY_GLYPH: Readonly<Record<Severity, string>> = {
  critical: '●',
  high: '◆',
  medium: '▲',
  low: '■',
  info: '◯',
};

/** Severidades de mayor a menor gravedad, para agrupar y ordenar. */
const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/** Verde y rojo para los estados ok / fallido de un scout. */
const OK_COLOR = '\x1b[38;5;42m';
const FAIL_COLOR = '\x1b[38;5;196m';
const ACCENT = '\x1b[38;5;44m'; // cian del branding

/** Frames del spinner (estilo braille), expuestos para la CLI. */
export const SPINNER_FRAMES: readonly string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Banner de cabecera de la CLI. */
export function renderBanner(color: boolean): string {
  const lines = [
    '┌─ SYNAPTIC SENTINEL ────────────────────────────────────',
    '│  auditoria agentica de seguridad · vibe-coding-native',
    '└─────────────────────────────────────────────────────────',
  ];
  return lines.map((line) => paint(line, ACCENT + BOLD, color)).join('\n');
}

/** Linea de resultado de un scout (✓/✗ + id + conteo + error). */
export function renderScoutLine(
  scout: {
    readonly scoutId: string;
    readonly status: string;
    readonly findings: number;
    readonly error?: string;
  },
  color: boolean,
): string {
  const ok = scout.status === 'ok';
  const glyph = paint(ok ? '✓' : '✗', ok ? OK_COLOR : FAIL_COLOR, color);
  const detail = scout.error !== undefined ? paint(` (${scout.error})`, DIM, color) : '';
  return `  ${glyph} ${scout.scoutId.padEnd(13)}${String(scout.findings)} hallazgo(s)${detail}`;
}

/**
 * Renderiza el "reveal" final de un scan: estado, conteos y los hallazgos
 * agrupados por severidad (de critical a info). El resumen por scout lo
 * imprime la CLI en vivo (`renderScoutLine`) a medida que cada uno termina.
 */
export function renderScanReveal(
  outcome: ScanOutcome,
  findings: readonly Finding[],
  color: boolean,
): string {
  const lines: string[] = [];

  const statusOk = outcome.status === 'ok';
  const status = paint(
    statusOk ? 'OK' : 'DEGRADED',
    (statusOk ? OK_COLOR : SEVERITY_COLOR.medium) + BOLD,
    color,
  );
  lines.push('');
  lines.push(`  ${status}  scan ${paint(outcome.scanId, DIM, color)}`);
  lines.push(
    `  ${paint(String(outcome.findingsCount), BOLD, color)} hallazgo(s)` +
      (outcome.suppressedCount > 0 ? ` · ${String(outcome.suppressedCount)} suprimido(s)` : ''),
  );

  lines.push('');
  if (findings.length === 0) {
    lines.push(paint('  sin hallazgos ✓', OK_COLOR, color));
    return lines.join('\n');
  }
  lines.push(paint('  HALLAZGOS', DIM, color));
  for (const severity of SEVERITY_ORDER) {
    for (const finding of findings.filter((f) => f.severity === severity)) {
      const glyph = paint(SEVERITY_GLYPH[severity], SEVERITY_COLOR[severity], color);
      const label = paint(severity.toUpperCase().padEnd(8), SEVERITY_COLOR[severity], color);
      // El ciclo de vida se anota solo si no es `new` (p.ej. `(known)`).
      const lifecycle =
        finding.lifecycleState === 'new' ? '' : paint(` (${finding.lifecycleState})`, DIM, color);
      const loc = paint(
        `${finding.location.path}:${String(finding.location.startLine)}`,
        DIM,
        color,
      );
      lines.push(`  ${glyph} ${label} ${finding.title}${lifecycle}  ${loc}`);
    }
  }
  return lines.join('\n');
}

/**
 * Tag coloreado de una clasificacion de triage, para la salida del comando
 * `triage`: verdadero positivo en rojo, falso positivo en verde, inconcluso
 * en gris.
 */
export function renderTriageTag(classification: string, color: boolean): string {
  if (classification === 'true_positive') {
    return paint('● TP', SEVERITY_COLOR.critical + BOLD, color);
  }
  if (classification === 'false_positive') {
    return paint('✓ FP', OK_COLOR + BOLD, color);
  }
  return paint('◯ INC', SEVERITY_COLOR.info + BOLD, color);
}
