import type { ReviewStatus } from '@synaptic-sentinel/core';

/**
 * Tipos + renderer Markdown del reporte del benchmark cross-provider
 * (DG-076 B).
 *
 * El reporte se commitea en `docs/benchmark/v0.3.0-DRAFT.md` para que el
 * cambio de calidad por provider sea visible en el repo publico. Es
 * humano-readable + machine-readable (tabla markdown con totales) y
 * lleva un disclaimer fuerte sobre el status del ground truth.
 */

/** Identificador unico de una corrida {provider, model}. */
export type ProviderLabel = string; // ej. "anthropic/claude-haiku-4-5-20251001"

/** Resultados acumulados de un agente sobre todas las entries × runs de un provider. */
export interface AgentRollup {
  /** Veces que el agente fue invocado. */
  readonly invocations: number;
  /** Veces que devolvio JSON parseable + validable por el schema. */
  readonly jsonValid: number;
  /** Veces que la salida paso el ground truth (PASS objetivo). */
  readonly passed: number;
  /** Latencia total acumulada (ms) para calcular promedios. */
  readonly totalLatencyMs: number;
  /** Latencias individuales en orden, para calcular p95. */
  readonly latencies: readonly number[];
  /** Tokens de input + output totales (suma del campo `usage` del provider). */
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Rollup por provider (agrega los 3 agentes). */
export interface ProviderResult {
  readonly providerLabel: ProviderLabel;
  readonly attemptedRuns: number;
  readonly completedRuns: number;
  readonly triage: AgentRollup;
  readonly context: AgentRollup;
  readonly remediation: AgentRollup;
  /** Cost estimado USD = (input * price.input + output * price.output) / 1e6. */
  readonly estimatedCostUsd: number;
  /**
   * Determinism cross-runs. Para cada (entry × triage), comparamos las
   * N runs del mismo provider; deterministicRate = % de pares de runs
   * que dieron la misma classification.
   */
  readonly determinismRate: number | null;
  /** Errores no fatales encontrados (ej. 429, timeout, parse error). */
  readonly errors: readonly string[];
  /**
   * `true` si el provider exhausto su quota (HTTP 429 / rate-limit) y el
   * runner skip-eo el resto de la sesion (DG-088 A). Permite al reporte
   * distinguir "quota agotada" de "modelo roto" — antes ambos contaban
   * como `errors[]` opacos.
   */
  readonly quotaExhausted?: boolean;
}

/** Reporte completo del benchmark. */
export interface BenchmarkReport {
  /** ISO timestamp de generacion. */
  readonly generatedAt: string;
  /** Version del ground truth dataset usado. */
  readonly groundTruthVersion: string;
  /** Status de revision del ground truth (todas ai-draft / mixto / human-confirmed). */
  readonly groundTruthReviewStatus: Readonly<Record<ReviewStatus, number>>;
  /** Cantidad de entries en el ground truth. */
  readonly totalEntries: number;
  /** Runs por entry usados. */
  readonly runsPerEntry: number;
  /** Resultados por provider corrido. */
  readonly providers: readonly ProviderResult[];
  /** Providers que se intentaron correr pero fallaron al setup (ej. sin key, modelo missing). */
  readonly notRun: readonly { providerLabel: ProviderLabel; reason: string }[];
}

/** Calcula p95 de un arreglo de numeros (devuelve null si esta vacio). */
function p95(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx] as number;
}

/** Renderiza un porcentaje 0-1 como string "N%" con 1 decimal. */
function pct(value: number | null): string {
  if (value === null) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

/** Renderiza un cost number como string "$N.NN" con 2 decimales. */
function usd(value: number): string {
  if (value === 0) return '$0 (local)';
  return `$${value.toFixed(4)}`;
}

/** Renderiza el reporte completo a Markdown. */
export function renderBenchmarkReport(report: BenchmarkReport): string {
  const lines: string[] = [];

  // Header + disclaimer.
  lines.push(`# Brain Layer Cross-Provider Benchmark — v0.3.0-DRAFT`);
  lines.push('');
  lines.push(`> Generated: ${report.generatedAt}`);
  lines.push(
    `> Ground truth: version ${report.groundTruthVersion}, ${report.totalEntries} entries × ${String(report.runsPerEntry)} runs each.`,
  );
  lines.push('');
  const draftCount = report.groundTruthReviewStatus['ai-draft'];
  const confirmedCount = report.groundTruthReviewStatus['human-confirmed'];
  const correctedCount = report.groundTruthReviewStatus['human-corrected'];
  const humanReviewed = confirmedCount + correctedCount;
  if (humanReviewed === 0) {
    lines.push(
      `> ⚠️ **Anti-optimismo ilusorio**: all ${String(draftCount)} entries are \`ai-draft\` ` +
        `(NO human-AppSec review). These numbers are **internal-comparative only**. ` +
        `Do NOT cite externally without filtering to \`human-confirmed\` entries.`,
    );
  } else {
    lines.push(
      `> Ground truth review status: ${String(confirmedCount)} confirmed + ` +
        `${String(correctedCount)} corrected + ${String(draftCount)} draft.`,
    );
  }
  lines.push('');

  // No-run section.
  if (report.notRun.length > 0) {
    lines.push('## Providers not run');
    lines.push('');
    lines.push('| Provider | Reason |');
    lines.push('| -------- | ------ |');
    for (const skipped of report.notRun) {
      lines.push(`| \`${skipped.providerLabel}\` | ${skipped.reason} |`);
    }
    lines.push('');
  }

  // Throttled section (DG-088 A). Lista los providers que se intentaron
  // correr pero pegaron quota durante la sesion — el runner los skip-eo
  // tras 2 quota-exhausted consecutivos y aqui se documenta.
  const throttled = report.providers.filter((p) => p.quotaExhausted === true);
  if (throttled.length > 0) {
    lines.push('## Providers throttled this run');
    lines.push('');
    lines.push(
      'These providers were skipped mid-session after consecutive `429` ' +
        '/ rate-limit responses — not a model failure. Try a paid tier or ' +
        'wait for the quota window to reset, then re-run.',
    );
    lines.push('');
    lines.push('| Provider | Completed runs before skip |');
    lines.push('| -------- | -------------------------- |');
    for (const provider of throttled) {
      lines.push(
        `| \`${provider.providerLabel}\` | ${String(provider.completedRuns)} / ${String(provider.attemptedRuns)} |`,
      );
    }
    lines.push('');
  }

  // Top-level summary table.
  if (report.providers.length === 0) {
    lines.push('## No providers were successfully run');
    lines.push('');
    lines.push(
      'Configure provider API keys via env vars and re-run with ' +
        '`pnpm benchmark:run`. See `tests/benchmark/README.md`.',
    );
    return lines.join('\n');
  }

  lines.push('## Per-provider summary');
  lines.push('');
  lines.push(
    '| Provider | Triage PASS | Triage JSON OK | Triage avg latency | Cost (USD) | Determinism | Errors |',
  );
  lines.push(
    '| -------- | ----------- | -------------- | ------------------ | ---------- | ----------- | ------ |',
  );
  for (const provider of report.providers) {
    const tri = provider.triage;
    const passRate = tri.invocations === 0 ? 'n/a' : pct(tri.passed / tri.invocations);
    const validityRate = tri.invocations === 0 ? 'n/a' : pct(tri.jsonValid / tri.invocations);
    const avgLatency =
      tri.invocations === 0 ? 'n/a' : `${(tri.totalLatencyMs / tri.invocations).toFixed(0)}ms`;
    const cost = usd(provider.estimatedCostUsd);
    const determinism = provider.determinismRate === null ? 'n/a' : pct(provider.determinismRate);
    const errors = provider.errors.length === 0 ? '—' : String(provider.errors.length);
    // DG-088 A: si el provider pego quota, el row lleva un badge despues
    // del label para que el lector NO confunda "quota agotada" con "modelo
    // roto" al comparar columnas.
    const throttledBadge = provider.quotaExhausted === true ? ' ⚠️ throttled' : '';
    lines.push(
      `| \`${provider.providerLabel}\`${throttledBadge} | ${passRate} | ${validityRate} | ${avgLatency} | ${cost} | ${determinism} | ${errors} |`,
    );
  }
  lines.push('');

  // Per-agent breakdown.
  for (const provider of report.providers) {
    lines.push(`### \`${provider.providerLabel}\``);
    lines.push('');
    lines.push(
      `Attempted ${String(provider.attemptedRuns)} runs, completed ${String(provider.completedRuns)}. ` +
        `Estimated cost: ${usd(provider.estimatedCostUsd)}.`,
    );
    if (provider.errors.length > 0) {
      lines.push('');
      lines.push(`**Errors (${String(provider.errors.length)})**:`);
      for (const error of provider.errors.slice(0, 5)) {
        lines.push(`- ${error}`);
      }
      if (provider.errors.length > 5) {
        lines.push(`- (... ${String(provider.errors.length - 5)} more)`);
      }
    }
    lines.push('');
    lines.push(
      '| Agent | PASS rate | JSON validity | Avg latency | p95 latency | Input tokens | Output tokens |',
    );
    lines.push(
      '| ----- | --------- | ------------- | ----------- | ----------- | ------------ | ------------- |',
    );
    for (const [name, rollup] of [
      ['Triage', provider.triage],
      ['Context', provider.context],
      ['Remediation', provider.remediation],
    ] as const) {
      const passRate = rollup.invocations === 0 ? 'n/a' : pct(rollup.passed / rollup.invocations);
      const validityRate =
        rollup.invocations === 0 ? 'n/a' : pct(rollup.jsonValid / rollup.invocations);
      const avgLatency =
        rollup.invocations === 0
          ? 'n/a'
          : `${(rollup.totalLatencyMs / rollup.invocations).toFixed(0)}ms`;
      const p95Latency = p95(rollup.latencies);
      const p95Cell = p95Latency === null ? 'n/a' : `${p95Latency.toFixed(0)}ms`;
      lines.push(
        `| **${name}** | ${passRate} | ${validityRate} | ${avgLatency} | ${p95Cell} | ${String(rollup.inputTokens)} | ${String(rollup.outputTokens)} |`,
      );
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(
    `_Generated by \`pnpm benchmark:run\` — see [\`tests/benchmark/README.md\`](../../tests/benchmark/README.md)._`,
  );
  return lines.join('\n');
}
