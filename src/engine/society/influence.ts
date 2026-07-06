import { SKILL_NAMES, clamp01, type Person, type Settlement, type Tick } from '../../shared/types';
import type { Rng } from '../rng';

/** Deviation 1: the minimal structural subset of the eventual EngineCtx influence reads/writes. */
export interface InfluenceCtxLike {
  people: Person[];
  personById: Map<number, Person>;
  settlements: Settlement[];
  tick: Tick;
  rng: Rng;
}

export const INFLUENCE_RECOMPUTE_INTERVAL = 30;
export const INFLUENCE_DECAY = 0.98;

function avgSkill(p: Person): number {
  let sum = 0;
  for (const k of SKILL_NAMES) sum += p.skills[k];
  return sum / SKILL_NAMES.length;
}

function normalizedPositiveAffinity(p: Person): number {
  const positives = p.relationships.map((r) => r.affinity).filter((a) => a > 0);
  if (positives.length === 0) return 0;
  const mean = positives.reduce((a, b) => a + b, 0) / positives.length;
  return clamp01(mean);
}

function victoryMemoryScore(p: Person): number {
  const victories = p.memory.filter((m) => m.kind === 'victory');
  if (victories.length === 0) return 0;
  const mean = victories.reduce((a, m) => a + m.salience, 0) / victories.length;
  return clamp01(mean);
}

/**
 * Raw (unblended) influence score:
 *   0.3 * esteem-relief + 0.2 * avg skills + 0.3 * normalized positive
 *   affinities + 0.2 * victory memories
 * where esteem-relief = clamp01(1 - needs.esteem) (esteem need is 1 =
 * desperate, so relief is the inverse).
 */
export function computeRawInfluence(p: Person): number {
  const esteemRelief = clamp01(1 - p.needs.esteem);
  const raw =
    0.3 * esteemRelief +
    0.2 * avgSkill(p) +
    0.3 * normalizedPositiveAffinity(p) +
    0.2 * victoryMemoryScore(p);
  return clamp01(raw);
}

/**
 * Recomputed every 30 ticks with 0.98 decay blend toward the fresh raw
 * score. A no-op on ticks off the interval, and a no-op for dead people.
 */
export function updateInfluence(ctx: InfluenceCtxLike): void {
  if (ctx.tick % INFLUENCE_RECOMPUTE_INTERVAL !== 0) return;
  const people = [...ctx.people].sort((a, b) => a.id - b.id);
  for (const p of people) {
    if (!p.alive) continue;
    const raw = computeRawInfluence(p);
    p.influence = clamp01(p.influence * INFLUENCE_DECAY + raw * (1 - INFLUENCE_DECAY));
  }
}

/** The living settlement member with the highest influence; ties break to the lowest id. */
export function leaderOf(s: Settlement, ctx: InfluenceCtxLike): Person | null {
  let leader: Person | null = null;
  for (const id of [...s.memberIds].sort((a, b) => a - b)) {
    const p = ctx.personById.get(id);
    if (p === undefined || !p.alive) continue;
    if (leader === null || p.influence > leader.influence) leader = p;
  }
  return leader;
}
