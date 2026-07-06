import {
  ACTION_KINDS,
  ACTION_WEIGHT_MAX,
  ACTION_WEIGHT_MIN,
  PERCEPTION_RADIUS,
  SKILL_NAMES,
  clamp,
  clamp01,
  type Morality,
  type Person,
  type SkillName,
  type Tick,
  type Vec2,
} from '../../shared/types';
import type { Rng } from '../rng';
import type { Outcome } from './execute';

/** The one spatial capability learning needs (the Task 7 SpatialIndex satisfies it). */
export interface SpatialNearLike {
  near(pos: Vec2, radius: number): number[];
}

/** Structural subset of the Task 33 EngineCtx used by maybeImitate. */
export interface LearningCtx {
  personById: Map<number, Person>;
  spatial: SpatialNearLike;
  tick: Tick;
  rng: Rng;
}

export const REINFORCE_SCALE = 0.25;
export const IMITATION_INTERVAL = 30; // ticks between imitation opportunities
export const IMITATION_BLEND = 0.1; // 10% toward the model per imitation
export const TEACH_SKILL_RATE = 0.05; // skill gained = 0.05 * teacher.skills.teaching
export const TEACH_MORALITY_NUDGE = 0.02; // 2% toward the teacher per lesson

/**
 * Reinforcement over action weights (contract formula):
 *   w[kind] = clamp(w[kind] + learningRate * reward * 0.25,
 *                   ACTION_WEIGHT_MIN, ACTION_WEIGHT_MAX)
 * learningRate comes from the acting person's lineage temperament
 * (Task 33 passes getBrain(p.lineage).temperament().learningRate).
 */
export function reinforce(p: Person, o: Outcome, learningRate: number): void {
  const kind = o.action.kind;
  p.actionWeights[kind] = clamp(
    p.actionWeights[kind] + learningRate * o.reward * REINFORCE_SCALE,
    ACTION_WEIGHT_MIN,
    ACTION_WEIGHT_MAX,
  );
}

/**
 * Social learning: every IMITATION_INTERVAL ticks, with probability
 * imitationRate, blend all action weights 10% toward the highest-influence
 * living neighbor within PERCEPTION_RADIUS. Ties break to the lowest id
 * (near() returns ascending ids and the comparison is strict). The person
 * itself is never a model; no neighbor means no change.
 */
export function maybeImitate(p: Person, ctx: LearningCtx, imitationRate: number): void {
  if (ctx.tick % IMITATION_INTERVAL !== 0) return;
  if (!ctx.rng.chance(imitationRate)) return;

  let model: Person | null = null;
  for (const id of ctx.spatial.near(p.pos, PERCEPTION_RADIUS)) {
    if (id === p.id) continue;
    const other = ctx.personById.get(id);
    if (other === undefined || !other.alive) continue;
    if (model === null || other.influence > model.influence) model = other;
  }
  if (model === null) return;

  for (const kind of ACTION_KINDS) {
    const w = p.actionWeights[kind];
    const target = model.actionWeights[kind];
    p.actionWeights[kind] = clamp(
      w + IMITATION_BLEND * (target - w),
      ACTION_WEIGHT_MIN,
      ACTION_WEIGHT_MAX,
    );
  }
}

/**
 * Direct teaching (the canonical routine behind the 'teach' action): the
 * student gains 0.05 * teacher.skills.teaching in the teacher's best skill
 * (first in SKILL_NAMES order on ties), and every morality foundation of the
 * student moves 2% toward the teacher's value. Both clamped to [0, 1].
 */
export function teach(teacher: Person, student: Person): void {
  let best: SkillName = SKILL_NAMES[0];
  for (const s of SKILL_NAMES) {
    if (teacher.skills[s] > teacher.skills[best]) best = s;
  }
  student.skills[best] = clamp01(student.skills[best] + TEACH_SKILL_RATE * teacher.skills.teaching);

  const foundations: (keyof Morality)[] = ['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty'];
  for (const f of foundations) {
    student.morality[f] = clamp01(
      student.morality[f] + TEACH_MORALITY_NUDGE * (teacher.morality[f] - student.morality[f]),
    );
  }
}
