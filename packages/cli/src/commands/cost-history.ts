import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ColonyDb, resolveColonyDbPath, type CostHistoryRow } from '@synaptic-sentinel/core';

/**
 * Sub-comando `cost-history` (DG-078 B).
 *
 * Lee la tabla `triage_token_usage` y muestra un rollup de las últimas
 * N sesiones (default 10) agrupado por `{provider/model, agent}`. Útil
 * para responder "¿cuánto gasté esta semana en triage?" sin tener que
 * iterar sobre cada session manualmente.
 *
 * Reusa la pricing table de `@synaptic-sentinel/core` calibrada en DG-076
 * + DG-077 (single source of truth tras eliminar `tests/benchmark/pricing.json`).
 */

/** Opciones del comando `cost-history`. */
export interface CostHistoryCommandOptions {
  /** Directorio del proyecto cuyo `colony.db` se consulta. */
  readonly path: string;
  /** Cuántas sesiones recientes incluir en el rollup (default 10). */
  readonly limit?: number;
}

/** Tope por defecto de sesiones. */
const DEFAULT_LIMIT = 10;

export function runCostHistoryCommand(options: CostHistoryCommandOptions): number {
  const projectRoot = resolve(options.path);
  // DG-093 A: dual-read del colony.db (preferencia .sentinel/, fallback al
  // legacy .synaptic-sentinel/).
  const dbResolution = resolveColonyDbPath(projectRoot);
  const dbPath = dbResolution.path;
  if (!existsSync(dbPath)) {
    console.error(`No colony.db in ${projectRoot}. Run "synaptic-sentinel triage" first.`);
    return 1;
  }
  if (dbResolution.isLegacy) {
    console.warn(
      `Using legacy .synaptic-sentinel/colony.db (pre-DG-093). Consider ` +
        `moving it to .sentinel/colony.db at your leisure.`,
    );
  }
  const limit = options.limit ?? DEFAULT_LIMIT;
  const db = ColonyDb.open(dbPath);
  try {
    const rows = db.getCostHistory(limit);
    if (rows.length === 0) {
      console.log(
        `No token usage recorded yet. Run "synaptic-sentinel triage" with a configured Brain Layer ` +
          `to start tracking cost.`,
      );
      return 0;
    }
    renderCostHistory(rows, limit);
    return 0;
  } finally {
    db.close();
  }
}

/**
 * Imprime el rollup como una tabla compacta + totales.
 *
 * El caveat "~estimated" se imprime explícitamente al inicio: los tokens
 * son proxies `chars/4` (DG-076 caveat heredado) y el cost USD puede
 * divergir ±15-20% del facturado real del provider.
 */
function renderCostHistory(rows: readonly CostHistoryRow[], limit: number): void {
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCalls = 0;
  console.log(
    `Cost history — last ${String(limit)} triage session(s) (~estimated; tokens are chars/4 proxy):`,
  );
  console.log('');
  console.log(
    `  ${'provider/model'.padEnd(40)} ${'agent'.padEnd(11)} ${'calls'.padStart(5)}  ` +
      `${'input'.padStart(8)}  ${'output'.padStart(8)}  ${'cost USD'.padStart(9)}  ${'avg lat'.padStart(8)}`,
  );
  for (const row of rows) {
    totalCalls += row.calls;
    totalInput += row.inputTokens;
    totalOutput += row.outputTokens;
    totalCost += row.estimatedCostUsd;
    const avgLatency = Math.round(row.avgLatencyMs);
    console.log(
      `  ${row.providerLabel.padEnd(40)} ${row.agentId.padEnd(11)} ${String(row.calls).padStart(5)}  ` +
        `${String(row.inputTokens).padStart(8)}  ${String(row.outputTokens).padStart(8)}  ` +
        `$${row.estimatedCostUsd.toFixed(4).padStart(8)}  ${String(avgLatency).padStart(6)}ms`,
    );
  }
  console.log('');
  console.log(
    `  Total: ${String(totalCalls)} calls · ${String(totalInput)} input tokens · ` +
      `${String(totalOutput)} output tokens · $${totalCost.toFixed(4)} (~estimated USD)`,
  );
}
