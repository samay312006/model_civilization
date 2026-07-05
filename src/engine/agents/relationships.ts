import { RELATIONSHIP_CAP, clamp, type Person, type RelationKind } from '../../shared/types';

/**
 * Contract signature verbatim. Existing relationship: affinity moves by
 * delta (clamped), kind is overwritten (the latest interaction relabels the
 * bond). New relationship under the cap: appended. New relationship at the
 * cap: the least-invested existing bond (lowest |affinity|, earliest index
 * on ties) is evicted first.
 */
export function adjustRelationship(p: Person, otherId: number, kind: RelationKind, delta: number): void {
  const existing = p.relationships.find((r) => r.otherId === otherId);
  if (existing !== undefined) {
    existing.kind = kind;
    existing.affinity = clamp(existing.affinity + delta, -1, 1);
    return;
  }

  if (p.relationships.length >= RELATIONSHIP_CAP) {
    let evictIndex = 0;
    let lowest = Math.abs(p.relationships[0]?.affinity ?? 0);
    for (let i = 1; i < p.relationships.length; i++) {
      const abs = Math.abs((p.relationships[i] as { affinity: number }).affinity);
      if (abs < lowest) {
        lowest = abs;
        evictIndex = i;
      }
    }
    p.relationships.splice(evictIndex, 1);
  }

  p.relationships.push({ otherId, kind, affinity: clamp(delta, -1, 1) });
}

/** Contract signature verbatim: the matching relationship's affinity, or 0. */
export function affinityTo(p: Person, otherId: number): number {
  return p.relationships.find((r) => r.otherId === otherId)?.affinity ?? 0;
}

/** Contract signature verbatim: true iff a kin relationship with otherId exists. */
export function isKin(p: Person, otherId: number): boolean {
  return p.relationships.some((r) => r.otherId === otherId && r.kind === 'kin');
}
