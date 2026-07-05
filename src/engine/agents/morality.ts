import type { Action, ActionKind, Morality, Person } from '../../shared/types';

export const VETO_THRESHOLD = 0.75;
export const DESPERATION_FLOOR = 0.05;

/**
 * Contract table, complete for every ActionKind (a missing key would be a
 * compile error, not a silent runtime gap). Virtuous/neutral actions carry
 * an explicit empty footprint rather than being omitted.
 */
export const MORAL_FOOTPRINTS: Record<ActionKind, Partial<Morality>> = {
  gather: {},
  farm: {},
  hunt: {}, // killing an animal, not a person — no moral weight
  build: {},
  craft: {},
  rest: {},
  socialize: {},
  court: {},
  teach: {},
  trade: { fairness: 0.1 }, // an unequal trade still nags fairness
  share: {},
  steal: { fairness: 0.7, care: 0.3 },
  attack: { care: 0.9 },
  flee: { loyalty: 0.2 }, // abandoning a group in danger mildly weighs on loyalty
  migrate: { loyalty: 0.15 }, // leaving a settlement mildly weighs on loyalty
  worship: {},
  explore: {},
  heal: {},
};

/**
 * Contract signature verbatim: sum(morality[k] * footprint[k]) over the
 * footprint's keys. 0 for an action with an empty footprint.
 */
export function violationDot(morality: Morality, action: Action): number {
  const footprint = MORAL_FOOTPRINTS[action.kind];
  let dot = 0;
  for (const key of Object.keys(footprint) as (keyof Morality)[]) {
    const weight = footprint[key];
    if (weight === undefined) continue;
    dot += morality[key] * weight;
  }
  return dot;
}

/** max(hunger, fear) — the shared desperation formula (also used by actions.ts, Task 14). */
export function desperationLevel(p: Person): number {
  return Math.max(p.needs.hunger, p.emotions.fear);
}

/**
 * Deviation 3: the two fields moralGate actually reads, standing in for the
 * Task 20 Temperament (brains/types.ts does not exist at Task 11). The full
 * Temperament is a structural superset and assignable here.
 */
export interface MoralityTemperament {
  moralWeight: number;
  desperationThreshold: number;
}

/**
 * Contract signature (temperament typed per deviation 3): multiplier
 * max(0, 1 - moralWeight*violationDot); hard veto (0) when violationDot
 * exceeds VETO_THRESHOLD, unless desperation meets desperationThreshold, in
 * which case the gate floors at DESPERATION_FLOOR instead of 0.
 */
export function moralGate(p: Person, action: Action, temperament: MoralityTemperament): number {
  const dot = violationDot(p.morality, action);
  if (dot > VETO_THRESHOLD) {
    return desperationLevel(p) >= temperament.desperationThreshold ? DESPERATION_FLOOR : 0;
  }
  return Math.max(0, 1 - temperament.moralWeight * dot);
}
