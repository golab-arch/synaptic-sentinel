import type { Finding } from '../types/finding.js';

/**
 * Umbral de confidence downgrade para non-representative members (DG-131 A
 * Sub-A2). El representative retiene full confidence. Cada member propagado
 * recibe `groupConfidence * DOWNGRADE_FACTOR`.
 *
 * Rationale: epistemic uncertainty — el LLM analizó el representative + N-1
 * findings via group context, pero cada member individual PODRÍA diferir
 * (ej. 1 de 22 pinnings puede ser reachable, 21 no). Downgrade refleja
 * "high confidence sobre el group, medium sobre cada member individual".
 *
 * Valor 0.9 es opinionated — release notes v0.3.19 debe documentar.
 */
export const GROUP_MEMBER_CONFIDENCE_DOWNGRADE_FACTOR = 0.9;

/**
 * Mínimo de members para que un grupo AMORTICE la LLM call sobre el group
 * context (que suele ser más caro en tokens que un finding individual).
 *
 * Groups con 1 solo finding se tratan como findings individuales (no
 * agrupados). Trade-off: N=2 groups reducen cost 50% pero pagan overhead
 * del group context prompt.
 */
export const MIN_GROUP_SIZE = 2;

/**
 * Longitud máxima del rationale extra que se agrega a cada member propagado.
 * Evita bloat en el sidebar cuando N es grande.
 */
export const MAX_MEMBER_TAG_LEN = 80;

/**
 * Un grupo de findings que compartirán una sola LLM call de triage.
 *
 * @property groupId    Id opaco estable (usado en persistence + banner).
 * @property groupKey   Semántico human-readable (`SCA:protobufjs@7.5.4` o
 *                      `SAST:rule-id`). Se usa en el rationale suffix.
 * @property members    Findings que serán triaged juntos. `members[0]` es
 *                      el representative (hace la LLM call real).
 */
export interface TriageFindingGroup {
  readonly groupId: string;
  readonly groupKey: string;
  readonly members: readonly Finding[];
}

/**
 * Clave semántica de agrupación para un finding — determinista + auditable.
 *
 * Para findings SCA con `sca.packageName + sca.installedVersion`: usa esos.
 * Para findings sin ambas: solo `ruleId`. Findings sin ruleId (raro pero
 * defensivo) se dejan solos (return null → no agrupables).
 *
 * Ejemplos:
 *  - SCA protobufjs@7.5.4 → `SCA:protobufjs@7.5.4`
 *  - SCA sin installedVersion → `SCA:protobufjs`
 *  - SAST regla js-taint-sql-injection → `SAST:sentinel-js-taint-sql-injection`
 */
export function findingGroupKey(finding: Finding): string | null {
  const ruleId = finding.ruleId?.trim();
  if (!ruleId || ruleId.length === 0) return null;
  const pkg = finding.sca?.packageName?.trim();
  const version = finding.sca?.installedVersion?.trim();
  if (pkg && pkg.length > 0) {
    if (version && version.length > 0) {
      return `SCA:${pkg}@${version}:${ruleId}`;
    }
    return `SCA:${pkg}:${ruleId}`;
  }
  return `${finding.category}:${ruleId}`;
}

/**
 * Particiona `pendingFindings` en grupos triage-able (≥ MIN_GROUP_SIZE) +
 * findings solitary (que se triarán individualmente).
 *
 * Determinismo: dentro de cada grupo, el orden de `members` respeta el
 * orden de aparición en `pendingFindings` (preserva el ordenamiento del
 * Coordinator). `members[0]` es el representative.
 *
 * Findings SIN groupKey (findingGroupKey retorna null) se agregan siempre
 * a `solitary` (no agrupables por diseño).
 *
 * @returns `{ groups, solitary }` — union disjunta de pendingFindings.
 */
export function groupPendingFindings(
  pendingFindings: readonly Finding[],
  makeGroupId: () => string,
): {
  groups: readonly TriageFindingGroup[];
  solitary: readonly Finding[];
} {
  const byKey = new Map<string, Finding[]>();
  const solitary: Finding[] = [];
  for (const finding of pendingFindings) {
    const key = findingGroupKey(finding);
    if (key === null) {
      solitary.push(finding);
      continue;
    }
    const arr = byKey.get(key) ?? [];
    arr.push(finding);
    byKey.set(key, arr);
  }
  const groups: TriageFindingGroup[] = [];
  for (const [groupKey, members] of byKey.entries()) {
    if (members.length < MIN_GROUP_SIZE) {
      // 1 solo member — no vale la pena grouping overhead. Trata como solitary.
      solitary.push(...members);
      continue;
    }
    groups.push({
      groupId: makeGroupId(),
      groupKey,
      members,
    });
  }
  return { groups, solitary };
}

/**
 * Aplica el downgrade heurístico al confidence para un member propagado
 * (non-representative) del grupo.
 *
 * `representativeConfidence` cae en [0, 1]. El downgrade produce un valor
 * clamp a [0, 1] usando el factor global.
 */
export function deriveDowngradedConfidence(representativeConfidence: number): number {
  const downgraded = representativeConfidence * GROUP_MEMBER_CONFIDENCE_DOWNGRADE_FACTOR;
  if (downgraded < 0) return 0;
  if (downgraded > 1) return 1;
  return downgraded;
}

/**
 * Genera el sufijo del rationale para un member propagado — human-readable
 * signal en el sidebar de que este verdict vino del group representative.
 *
 * Formato: ` [group ${groupKey}, member ${memberIndex + 1} of ${totalMembers}]`
 * Truncado a MAX_MEMBER_TAG_LEN chars para evitar sidebar bloat.
 */
export function formatMemberRationaleTag(
  groupKey: string,
  memberIndex: number,
  totalMembers: number,
): string {
  const tag = ` [group ${groupKey}, member ${String(memberIndex + 1)} of ${String(totalMembers)}]`;
  if (tag.length <= MAX_MEMBER_TAG_LEN) return tag;
  // Truncar el groupKey si es largo, preservando el "member N of M" hint.
  const suffix = `, member ${String(memberIndex + 1)} of ${String(totalMembers)}]`;
  const availableForKey = MAX_MEMBER_TAG_LEN - suffix.length - ' [group '.length - 3; // "..."
  const keyTrimmed = groupKey.slice(0, availableForKey) + '...';
  return ` [group ${keyTrimmed}${suffix}`;
}
