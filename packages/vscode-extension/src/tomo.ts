import { z } from 'zod';

/** Severidad de un hallazgo (subconjunto del contrato del tomo). */
const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);

/** Ubicacion de un hallazgo dentro del codigo del cliente. */
const FindingLocationSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  startColumn: z.number().int().positive().optional(),
  endColumn: z.number().int().positive().optional(),
  snippet: z.string().optional(),
});

/** Veredicto de triage del Brain Layer (forma minima, solo para mostrar). */
const ExtensionTriageSchema = z.object({
  classification: z.string().min(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

/** Explicacion de contexto del Brain Layer (forma minima, solo para mostrar). */
const ExtensionContextSchema = z.object({
  summary: z.string().min(1),
  entryPoint: z.string().min(1),
  sink: z.string().min(1),
  exposure: z.string().min(1),
});

/** Sugerencia de remediacion del Brain Layer (forma minima, solo para mostrar). */
const ExtensionRemediationSchema = z.object({
  summary: z.string().min(1),
  recommendation: z.string().min(1),
  fixedSnippet: z.string().min(1).optional(),
});

/** Hallazgo, en la forma minima que consume la extension. */
const ExtensionFindingSchema = z.object({
  severity: SeveritySchema,
  category: z.string().min(1),
  ruleId: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  location: FindingLocationSchema,
  /** Huella estable: identifica el hallazgo para marcarlo como falso positivo. */
  fingerprint: z.string().min(1),
  lifecycleState: z.string().min(1).default('new'),
  /** Veredicto de triage, presente solo si el hallazgo fue triado. */
  triage: ExtensionTriageSchema.optional(),
  /** Explicacion de contexto, presente solo si el hallazgo fue explicado. */
  context: ExtensionContextSchema.optional(),
  /** Sugerencia de remediacion, presente solo si el hallazgo fue remediado. */
  remediation: ExtensionRemediationSchema.optional(),
});

/**
 * Schema minimo del tomo exportado por la CLI.
 *
 * Solo valida el subconjunto que la extension necesita para pintar
 * diagnostics; los demas campos del tomo (metadata, integrity, ...) se
 * ignoran. El tomo es la frontera de contrato entre la CLI y la extension
 * (DG-021 A: la extension no importa los paquetes del motor).
 */
/**
 * Override directive replicado para la extension (DG-115 A Step 5 — §4 #15
 * 'prismjs misleading remediation'). Forma identica al
 * `OverrideDirective` del core; la frontera CLI↔extension impide importar.
 */
const ExtensionOverrideDirectiveSchema = z.object({
  manager: z.enum(['npm', 'yarn', 'pnpm']),
  packageName: z.string().min(1),
  versionRange: z.string().min(1),
  snippet: z.string().min(1),
  hasSiblingFixedCopy: z.boolean(),
  pinnedBy: z.array(z.string().min(1)).default([]),
});

/** Override directive en la forma que consume la extension (DG-115 A). */
export type ExtensionOverrideDirective = z.infer<typeof ExtensionOverrideDirectiveSchema>;

/**
 * Remediation target de un FindingGroup (DG-113 A Step 4 — §4 #4).
 * Forma identica al `RemediationTarget` del core; replicada aqui por la
 * frontera CLI↔extension (la extension NO importa core).
 */
const ExtensionRemediationTargetSchema = z.object({
  recommendedFixes: z.record(z.string(), z.string()),
  display: z.string(),
  heterogeneous: z.boolean(),
  noFixAvailable: z.boolean(),
  /** Override directive — DG-115 A Step 5. Opcional. */
  overrideDirective: ExtensionOverrideDirectiveSchema.optional(),
});

/**
 * FindingGroup en la forma que consume la extension (DG-113 A Step 4).
 * Solo valida lo minimo que el webview necesita: familyKey + findings
 * (subset minimal: fingerprint, severity, title, ruleId — para join +
 * render) + remediation.
 */
const ExtensionFindingGroupSchema = z.object({
  familyKey: z.string().min(1),
  findings: z.array(
    z.object({
      fingerprint: z.string().min(1),
      severity: SeveritySchema,
      title: z.string().min(1),
      ruleId: z.string().min(1),
      message: z.string().min(1),
      location: FindingLocationSchema,
    }),
  ),
  remediation: ExtensionRemediationTargetSchema,
});

/** FindingGroup en la forma que consume la extension. */
export type ExtensionFindingGroup = z.infer<typeof ExtensionFindingGroupSchema>;

export const ExtensionTomoSchema = z.object({
  summary: z.object({
    scanId: z.string().min(1),
    status: z.enum(['ok', 'degraded']),
    totalFindings: z.number().int().nonnegative(),
  }),
  findings: z.array(ExtensionFindingSchema),
  /** Grupos SCA por package family — DG-113 A Step 4. Opcional. */
  groups: z.array(ExtensionFindingGroupSchema).optional(),
});

/** Tomo en la forma que consume la extension. */
export type ExtensionTomo = z.infer<typeof ExtensionTomoSchema>;

/** Hallazgo en la forma que consume la extension. */
export type ExtensionFinding = z.infer<typeof ExtensionFindingSchema>;

/** Valida y parsea el JSON de un tomo. Lanza si no cumple el contrato minimo. */
export function parseTomo(raw: unknown): ExtensionTomo {
  return ExtensionTomoSchema.parse(raw);
}

/**
 * Cost summary del cross-provider Brain Layer (DG-099 A) — output del
 * sub-comando `cost-history --json`. La extension lo muestra como card
 * en el sidebar webview, al lado del summary card de findings.
 *
 * Forma identica a `CostHistoryJson` del CLI: si el contrato cambia ahi,
 * ajustar este schema en el mismo cycle.
 */
const CostHistoryRowSchema = z.object({
  providerLabel: z.string().min(1),
  agentId: z.enum(['triage', 'context', 'remediation']),
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
});

const CostHistoryTotalsSchema = z.object({
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});

export const CostSummarySchema = z.object({
  limit: z.number().int().positive(),
  rows: z.array(CostHistoryRowSchema),
  totals: CostHistoryTotalsSchema,
  /**
   * ISO 8601 timestamp del registro mas reciente en `triage_token_usage`
   * (DG-107 A). Opcional. Cuando esta presente, el renderer muestra
   * "as of <date>" en el header de la cost card — clave para que el
   * usuario sepa que la cost summary es de hace X tiempo y no del
   * triage que acaba de correr (caso: cambio de provider con todos
   * findings ya triaged → 0 LLM calls → cost card stale).
   */
  latestSessionAt: z.string().datetime().optional(),
});

/** Cost summary del Brain Layer en la forma que consume la extension (DG-099 A). */
export type CostSummary = z.infer<typeof CostSummarySchema>;

/**
 * Parsea el JSON emitido por `synaptic-sentinel cost-history --json`.
 *
 * Devuelve `null` defensivamente si el shape no coincide: la extension
 * decide no renderear la cost card cuando recibe null, en lugar de
 * romper el render del sidebar entero.
 */
export function parseCostSummary(raw: unknown): CostSummary | null {
  const result = CostSummarySchema.safeParse(raw);
  return result.success ? result.data : null;
}
