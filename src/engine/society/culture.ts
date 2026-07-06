import type { Civ, Morality, Person, Settlement, Tick, Traits } from '../../shared/types';
import type { Rng } from '../rng';
import type { NameGen } from '../names';
import { leaderOf, type InfluenceCtxLike } from './influence';

export interface CultureVector {
  morality: Morality;
  traits: Traits;
}

/** Deviation 1: structurally a superset of InfluenceCtxLike, so leaderOf(s, ctx) is callable with this ctx. */
export interface CultureCtxLike extends InfluenceCtxLike {
  civs: Civ[];
  settlements: Settlement[];
  names: NameGen;
}

export const SCHISM_DISTANCE_THRESHOLD = 0.35;
export const SCHISM_DURATION_TICKS = 720; // 2 years at YEAR_TICKS = 360
export const SCHISM_LEADER_INFLUENCE = 0.6;

const MORALITY_KEYS: (keyof Morality)[] = ['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty'];
const TRAIT_KEYS: (keyof Traits)[] = ['curiosity', 'aggression', 'empathy', 'industriousness', 'riskTolerance'];

const ZERO_MORALITY: Morality = { care: 0, fairness: 0, loyalty: 0, authority: 0, sanctity: 0, liberty: 0 };
const ZERO_TRAITS: Traits = { curiosity: 0, aggression: 0, empathy: 0, industriousness: 0, riskTolerance: 0 };

function averageCulture(members: Person[]): CultureVector {
  if (members.length === 0) {
    return { morality: { ...ZERO_MORALITY }, traits: { ...ZERO_TRAITS } };
  }
  const morality: Morality = { ...ZERO_MORALITY };
  const traits: Traits = { ...ZERO_TRAITS };
  for (const p of members) {
    for (const k of MORALITY_KEYS) morality[k] += p.morality[k];
    for (const k of TRAIT_KEYS) traits[k] += p.traits[k];
  }
  for (const k of MORALITY_KEYS) morality[k] /= members.length;
  for (const k of TRAIT_KEYS) traits[k] /= members.length;
  return { morality, traits };
}

/** Population aggregate: mean morality and traits across all living civ members. */
export function civCulture(civId: number, ctx: CultureCtxLike): CultureVector {
  const members = ctx.people.filter((p) => p.alive && p.civId === civId);
  return averageCulture(members);
}

/** Same averaging, scoped to a settlement's living membership. */
export function settlementCulture(s: Settlement, ctx: CultureCtxLike): CultureVector {
  const members = s.memberIds
    .map((id) => ctx.personById.get(id))
    .filter((p): p is Person => p !== undefined && p.alive);
  return averageCulture(members);
}

/** Normalized mean absolute difference across all 11 morality+trait axes, in [0, 1]. */
export function cultureDistance(a: CultureVector, b: CultureVector): number {
  let sum = 0;
  for (const k of MORALITY_KEYS) sum += Math.abs(a.morality[k] - b.morality[k]);
  for (const k of TRAIT_KEYS) sum += Math.abs(a.traits[k] - b.traits[k]);
  return sum / 11;
}

/** hsl((civId*137)%360, 70%, 55%) — the fixed generated-civ color formula. */
export function generatedColor(civId: number): string {
  const hue = (civId * 137) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

function nextCivId(ctx: CultureCtxLike): number {
  let max = 0;
  for (const c of ctx.civs) if (c.id > max) max = c.id;
  return max + 1;
}

/** Extension property tracking consecutive over-threshold ticks per settlement (deviation 3). */
interface WithSchismTracker {
  _overThresholdSinceTick?: Tick;
}

/**
 * Full contract behavior: a settlement whose local culture distance from its
 * civ exceeds SCHISM_DISTANCE_THRESHOLD for SCHISM_DURATION_TICKS
 * consecutive ticks, led by a member with influence > SCHISM_LEADER_INFLUENCE,
 * secedes into a brand-new Civ. Settlements that fall back under the
 * threshold lose all accumulated duration credit immediately.
 */
export function maybeSchism(ctx: CultureCtxLike): void {
  for (const s of [...ctx.settlements].sort((a, b) => a.id - b.id)) {
    const tracked = s as Settlement & WithSchismTracker;
    const civCult = civCulture(s.civId, ctx);
    const localCult = settlementCulture(s, ctx);
    const distance = cultureDistance(localCult, civCult);

    if (distance <= SCHISM_DISTANCE_THRESHOLD) {
      tracked._overThresholdSinceTick = undefined;
      continue;
    }

    if (tracked._overThresholdSinceTick === undefined) {
      tracked._overThresholdSinceTick = ctx.tick;
      continue;
    }

    const duration = ctx.tick - tracked._overThresholdSinceTick;
    if (duration < SCHISM_DURATION_TICKS) continue;

    const leader = leaderOf(s, ctx);
    if (leader === null || leader.influence <= SCHISM_LEADER_INFLUENCE) continue;

    secede(s, ctx);
    tracked._overThresholdSinceTick = undefined;
  }
}

function secede(s: Settlement, ctx: CultureCtxLike): void {
  const id = nextCivId(ctx);
  const newCiv: Civ = {
    id,
    name: ctx.names.civ(),
    color: generatedColor(id),
    knowledge: { fire: 0, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
    techs: [],
    atWarWith: [],
    warWeariness: 0,
  };
  ctx.civs.push(newCiv);
  for (const memberId of s.memberIds) {
    const p = ctx.personById.get(memberId);
    if (p === undefined || !p.alive) continue;
    p.civId = id;
  }
  s.civId = id;
}
