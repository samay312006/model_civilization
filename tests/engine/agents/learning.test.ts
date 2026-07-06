import { describe, expect, it } from 'vitest';
import type { Outcome } from '../../../src/engine/agents/execute';
import {
  IMITATION_INTERVAL,
  maybeImitate,
  reinforce,
  teach,
  type LearningCtx,
} from '../../../src/engine/agents/learning';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import {
  ACTION_KINDS,
  ACTION_WEIGHT_MAX,
  ACTION_WEIGHT_MIN,
  SKILL_NAMES,
  type ActionKind,
  type Person,
} from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function makePerson(id: number): Person {
  const p = createPerson(id, 0, 'fable', { x: 5, y: 5 }, names, createRng(1000 + id));
  p.alive = true;
  p.influence = 0;
  for (const k of ACTION_KINDS) p.actionWeights[k] = 1;
  return p;
}

function outcome(kind: ActionKind, reward: number): Outcome {
  return { action: { kind }, success: reward >= 0, reward, tick: 0 };
}

function makeCtx(people: Person[], tick: number): LearningCtx {
  return {
    personById: new Map(people.map((p) => [p.id, p])),
    spatial: { near: () => people.map((p) => p.id) },
    tick,
    rng: createRng(42),
  };
}

describe('reinforce', () => {
  it('positive reward raises the acted weight (and only it)', () => {
    const p = makePerson(1);
    reinforce(p, outcome('gather', 1), 0.5);
    expect(p.actionWeights.gather).toBeCloseTo(1.125, 6); // 1 + 0.5 * 1 * 0.25
    expect(p.actionWeights.farm).toBe(1);
  });

  it('negative reward lowers the acted weight', () => {
    const p = makePerson(1);
    reinforce(p, outcome('steal', -1), 0.5);
    expect(p.actionWeights.steal).toBeCloseTo(0.875, 6); // 1 - 0.5 * 1 * 0.25
  });

  it('clamps to [ACTION_WEIGHT_MIN, ACTION_WEIGHT_MAX]', () => {
    const p = makePerson(1);
    p.actionWeights.gather = 2.95;
    reinforce(p, outcome('gather', 1), 1); // 2.95 + 0.25 = 3.2 -> clamp
    expect(p.actionWeights.gather).toBe(ACTION_WEIGHT_MAX);
    p.actionWeights.steal = 0.3;
    reinforce(p, outcome('steal', -1), 1); // 0.3 - 0.25 = 0.05 -> clamp
    expect(p.actionWeights.steal).toBe(ACTION_WEIGHT_MIN);
  });
});

describe('maybeImitate', () => {
  it('blends 10% toward the highest-influence neighbor', () => {
    const p = makePerson(1);
    const low = makePerson(2);
    const high = makePerson(3);
    low.influence = 0.2;
    low.actionWeights.gather = 0.2;
    high.influence = 0.9;
    high.actionWeights.gather = 3;
    const ctx = makeCtx([p, low, high], IMITATION_INTERVAL); // tick 30: on the interval
    maybeImitate(p, ctx, 1); // rate 1 -> chance always passes
    expect(p.actionWeights.gather).toBeCloseTo(1.2, 6); // 1 + 0.1 * (3 - 1): toward high, not low
  });

  it('does nothing off the 30-tick interval', () => {
    const p = makePerson(1);
    const model = makePerson(2);
    model.influence = 1;
    model.actionWeights.gather = 3;
    const ctx = makeCtx([p, model], IMITATION_INTERVAL + 1); // tick 31
    maybeImitate(p, ctx, 1);
    expect(p.actionWeights.gather).toBe(1);
  });

  it('does nothing when the imitation roll fails (rate 0)', () => {
    const p = makePerson(1);
    const model = makePerson(2);
    model.influence = 1;
    model.actionWeights.gather = 3;
    const ctx = makeCtx([p, model], IMITATION_INTERVAL);
    maybeImitate(p, ctx, 0); // chance(0) is always false
    expect(p.actionWeights.gather).toBe(1);
  });

  it('does nothing with no living neighbors', () => {
    const p = makePerson(1);
    const dead = makePerson(2);
    dead.alive = false;
    dead.influence = 1;
    dead.actionWeights.gather = 3;
    const ctx = makeCtx([p, dead], IMITATION_INTERVAL);
    maybeImitate(p, ctx, 1);
    expect(p.actionWeights.gather).toBe(1); // dead neighbor ignored; self ignored
  });

  it('repeated imitation converges toward the model weights', () => {
    const p = makePerson(1);
    const model = makePerson(2);
    model.influence = 1;
    model.actionWeights.gather = 3;
    const ctx = makeCtx([p, model], IMITATION_INTERVAL);
    let prev = p.actionWeights.gather;
    for (let i = 0; i < 30; i++) {
      maybeImitate(p, ctx, 1);
      expect(p.actionWeights.gather).toBeGreaterThan(prev);
      prev = p.actionWeights.gather;
    }
    expect(p.actionWeights.gather).toBeGreaterThan(2.8); // 3 - 2 * 0.9^30 = 2.915
    expect(p.actionWeights.gather).toBeLessThanOrEqual(3);
  });
});

describe('teach', () => {
  it("transfers the teacher's best skill scaled by teaching skill", () => {
    const teacher = makePerson(1);
    const student = makePerson(2);
    for (const s of SKILL_NAMES) {
      teacher.skills[s] = 0;
      student.skills[s] = 0;
    }
    teacher.skills.farming = 0.9; // best skill
    teacher.skills.teaching = 0.8;
    student.skills.farming = 0.1;
    teach(teacher, student);
    expect(student.skills.farming).toBeCloseTo(0.14, 6); // 0.1 + 0.05 * 0.8
    expect(student.skills.teaching).toBe(0); // only the best skill transfers
  });

  it('nudges student morality 2% toward the teacher on every foundation', () => {
    const teacher = makePerson(1);
    const student = makePerson(2);
    for (const s of SKILL_NAMES) teacher.skills[s] = 0; // no skill side effect
    teacher.morality = { care: 1, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0 };
    student.morality = { care: 0.5, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0.5 };
    teach(teacher, student);
    expect(student.morality.care).toBeCloseTo(0.51, 6); // 0.5 + 0.02 * (1 - 0.5)
    expect(student.morality.liberty).toBeCloseTo(0.49, 6); // 0.5 + 0.02 * (0 - 0.5)
    expect(student.morality.fairness).toBeCloseTo(0.5, 6); // no gap, no move
  });

  it('clamps a transferred skill at 1', () => {
    const teacher = makePerson(1);
    const student = makePerson(2);
    for (const s of SKILL_NAMES) {
      teacher.skills[s] = 0;
      student.skills[s] = 0;
    }
    teacher.skills.farming = 1;
    teacher.skills.teaching = 1;
    student.skills.farming = 0.98;
    teach(teacher, student);
    expect(student.skills.farming).toBe(1); // 0.98 + 0.05 -> clamp01
  });
});
