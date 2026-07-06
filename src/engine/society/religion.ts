import { clamp01, type Civ, type Morality, type Person, type Tick } from '../../shared/types';
import type { Rng } from '../rng';
import type { NameGen } from '../names';

/** Field-identical structural mirror of the contract Religion (see deviation notes). */
export interface ReligionRec {
  id: number;
  name: string;
  founderId: number;
  civId: number;
  moralityBias: Partial<Morality>;
  zeal: number;
}

/** The minimal shape maybeFoundReligion needs from a narrative event. */
export interface DisasterWitnessEvent {
  tick: Tick;
  civId: number;
  severity: 1 | 2 | 3;
}

/** Deviation 1: the minimal structural subset maybeFoundReligion reads/writes. */
export interface ReligionCtxLike {
  people: Person[];
  civs: Civ[];
  religions: ReligionRec[];
  names: NameGen;
  tick: Tick;
  rng: Rng;
  recentDisasterEvents: DisasterWitnessEvent[];
}

/** The fuller shape spreadBeliefs actually requires. */
export interface ReligionCtxLikeExtended extends ReligionCtxLike {
  worshippersThisTick: Set<number>;
  settlements: { civId: number; structures: { shrine: number } }[];
}

export const RELIGION_FOUNDING_WINDOW = 30;
export const RELIGION_FOUNDER_SANCTITY = 0.7;
export const RELIGION_FOUNDER_INFLUENCE = 0.5;
export const RELIGION_FOUNDING_CHANCE = 0.02;
export const RELIGION_INITIAL_ZEAL = 0.2;
export const RELIGION_MORALITY_BIAS_BONUS = 0.15;
export const RELIGION_ADOPTION_MORALITY_NUDGE = 0.005;
export const RELIGION_ZEAL_DECAY = 0.0005;
export const RELIGION_WORSHIP_ZEAL_GAIN = 0.002;
export const RELIGION_SHRINE_ZEAL_GAIN = 0.001;

const MORALITY_KEYS: (keyof Morality)[] = ['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty'];

function nextReligionId(ctx: ReligionCtxLike): number {
  let max = 0;
  for (const r of ctx.religions) if (r.id > max) max = r.id;
  return max + 1;
}

function topTwoMoralityAxes(morality: Morality): (keyof Morality)[] {
  return [...MORALITY_KEYS].sort((a, b) => morality[b] - morality[a]).slice(0, 2);
}

/**
 * Founding: within RELIGION_FOUNDING_WINDOW ticks after a severity-3
 * disaster event in a civ, any alive high-sanctity high-influence witness
 * who is not already a founder rolls RELIGION_FOUNDING_CHANCE per call to
 * found a new religion, moralityBias = founder's top-2 axes each +0.15.
 */
export function maybeFoundReligion(ctx: ReligionCtxLike): void {
  const existingFounders = new Set(ctx.religions.map((r) => r.founderId));
  const relevantEvents = ctx.recentDisasterEvents.filter(
    (e) => e.severity === 3 && ctx.tick - e.tick >= 0 && ctx.tick - e.tick <= RELIGION_FOUNDING_WINDOW,
  );
  if (relevantEvents.length === 0) return;

  const civIdsWithDisaster = new Set(relevantEvents.map((e) => e.civId));
  const candidates = [...ctx.people]
    .filter(
      (p) =>
        p.alive &&
        civIdsWithDisaster.has(p.civId) &&
        p.morality.sanctity > RELIGION_FOUNDER_SANCTITY &&
        p.influence > RELIGION_FOUNDER_INFLUENCE &&
        !existingFounders.has(p.id),
    )
    .sort((a, b) => a.id - b.id);

  for (const candidate of candidates) {
    const roll = ctx.rng.split(`religion-founding-${candidate.id}-${ctx.tick}`);
    if (!roll.chance(RELIGION_FOUNDING_CHANCE)) continue;

    const axes = topTwoMoralityAxes(candidate.morality);
    const moralityBias: Partial<Morality> = {};
    for (const axis of axes) {
      moralityBias[axis] = clamp01(candidate.morality[axis] + RELIGION_MORALITY_BIAS_BONUS);
    }

    const religion: ReligionRec = {
      id: nextReligionId(ctx),
      name: ctx.names.religion(),
      founderId: candidate.id,
      civId: candidate.civId,
      moralityBias,
      zeal: RELIGION_INITIAL_ZEAL,
    };
    ctx.religions.push(religion);
    existingFounders.add(candidate.id);
  }
}

/**
 * Adoption: living civ-mates of the founder adopt on a per-call chance of
 * 0.1*founderInfluence*(0.5+fear)*zeal. Believers' morality nudges 0.5%/tick
 * toward moralityBias; zeal decays 0.0005/tick, +0.002 per worshipper this
 * tick, +0.001 per shrine present across the religion's civ's settlements.
 */
export function spreadBeliefs(ctx: ReligionCtxLikeExtended): void {
  for (const religion of [...ctx.religions].sort((a, b) => a.id - b.id)) {
    const founder = ctx.people.find((p) => p.id === religion.founderId);
    if (founder === undefined || !founder.alive) continue;

    const civMates = ctx.people
      .filter((p) => p.alive && p.civId === religion.civId && !p.beliefIds.includes(religion.id))
      .sort((a, b) => a.id - b.id);

    for (const p of civMates) {
      const chance = 0.1 * founder.influence * (0.5 + p.emotions.fear) * religion.zeal;
      const roll = ctx.rng.split(`religion-adopt-${religion.id}-${p.id}-${ctx.tick}`);
      if (roll.chance(chance)) {
        p.beliefIds.push(religion.id);
      }
    }

    const believers = ctx.people.filter((p) => p.alive && p.beliefIds.includes(religion.id));
    for (const p of believers) {
      for (const key of Object.keys(religion.moralityBias) as (keyof Morality)[]) {
        const target = religion.moralityBias[key];
        if (target === undefined) continue;
        p.morality[key] = clamp01(p.morality[key] + RELIGION_ADOPTION_MORALITY_NUDGE * (target - p.morality[key]));
      }
    }

    let zeal = religion.zeal - RELIGION_ZEAL_DECAY;
    let worshippers = 0;
    for (const id of ctx.worshippersThisTick) {
      const p = ctx.people.find((q) => q.id === id);
      if (p !== undefined && p.alive) worshippers += 1;
    }
    zeal += worshippers * RELIGION_WORSHIP_ZEAL_GAIN;

    const shrineCount = ctx.settlements
      .filter((s) => s.civId === religion.civId)
      .reduce((sum, s) => sum + s.structures.shrine, 0);
    zeal += shrineCount * RELIGION_SHRINE_ZEAL_GAIN;

    religion.zeal = clamp01(zeal);
  }
}
