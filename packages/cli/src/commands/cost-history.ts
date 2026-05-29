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
 *
 * DG-099 A agrega el flag `--json` para que la extensión VSCode pueda
 * consumir el output programáticamente y mostrarlo como cost card en el
 * sidebar webview.
 */

/** Opciones del comando `cost-history`. */
export interface CostHistoryCommandOptions {
  /** Directorio del proyecto cuyo `colony.db` se consulta. */
  readonly path: string;
  /** Cuántas sesiones recientes incluir en el rollup (default 10). */
  readonly limit?: number;
  /**
   * Si `true`, emite el rollup como JSON a stdout en lugar de la tabla
   * formateada (DG-099 A). El JSON tiene la forma:
   * `{ limit, rows: CostHistoryRow[], totals: { calls, inputTokens,
   * outputTokens, estimatedCostUsd } }`. Consumido por la extensión.
   */
  readonly json?: boolean;
}

/** Tope por defecto de sesiones. */
const DEFAULT_LIMIT = 10;

/**
 * Shape del JSON emitido por `cost-history --json` (DG-099 A). Es el
 * contrato entre la CLI y la extensión VSCode. Cualquier cambio aqui
 * requiere actualizar `parseCostHistoryJson` en el lado de la extensión.
 */
export interface CostHistoryJson {
  readonly limit: number;
  readonly rows: readonly CostHistoryRow[];
  readonly totals: {
    readonly calls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostUsd: number;
  };
  /**
   * ISO 8601 timestamp del registro mas reciente en `triage_token_usage`
   * (DG-107 A). Opcional — `undefined` cuando no hay sesiones de triage
   * con LLM calls reales todavia. Usado por la extension para mostrar
   * "as of <timestamp>" en el header de la cost card del sidebar — clave
   * para que el usuario sepa que la cost summary es de hace X tiempo y
   * no del triage que acaba de correr (caso: cambie de provider y todos
   * los findings ya estaban triaged → 0 LLM calls → la cost card sigue
   * mostrando la sesion anterior).
   */
  readonly latestSessionAt?: string;
}

/**
 * Computa los totales agregados a partir de las filas del rollup.
 *
 * Función pura — facil de testear sin tocar SQLite. `calls`, `inputTokens`
 * y `outputTokens` son sumas; `estimatedCostUsd` se suma como cualquier
 * otro número (NO se redondea; el caller decide la representación).
 */
export function computeCostHistoryTotals(
  rows: readonly CostHistoryRow[],
): CostHistoryJson['totals'] {
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;
  for (const row of rows) {
    calls += row.calls;
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    estimatedCostUsd += row.estimatedCostUsd;
  }
  return { calls, inputTokens, outputTokens, estimatedCostUsd };
}

export function runCostHistoryCommand(options: CostHistoryCommandOptions): number {
  const projectRoot = resolve(options.path);
  // DG-093 A: dual-read del colony.db (preferencia .sentinel/, fallback al
  // legacy .synaptic-sentinel/).
  const dbResolution = resolveColonyDbPath(projectRoot);
  const dbPath = dbResolution.path;
  if (!existsSync(dbPath)) {
    if (options.json === true) {
      // En modo JSON emitimos un payload vacio pero valido, para que la
      // extension pueda decidir no renderear la card sin tener que parsear
      // un error.
      const empty: CostHistoryJson = {
        limit: options.limit ?? DEFAULT_LIMIT,
        rows: [],
        totals: { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
      };
      console.log(JSON.stringify(empty));
      return 0;
    }
    console.error(`No colony.db in ${projectRoot}. Run "synaptic-sentinel triage" first.`);
    return 1;
  }
  if (dbResolution.isLegacy && options.json !== true) {
    console.warn(
      `Using legacy .synaptic-sentinel/colony.db (pre-DG-093). Consider ` +
        `moving it to .sentinel/colony.db at your leisure.`,
    );
  }
  const limit = options.limit ?? DEFAULT_LIMIT;
  const db = ColonyDb.open(dbPath);
  try {
    const rows = db.getCostHistory(limit);
    if (options.json === true) {
      const latestSessionAt = db.getLatestTriageSessionTimestamp();
      const payload: CostHistoryJson = {
        limit,
        rows,
        totals: computeCostHistoryTotals(rows),
        ...(latestSessionAt !== undefined ? { latestSessionAt } : {}),
      };
      console.log(JSON.stringify(payload));
      return 0;
    }
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
