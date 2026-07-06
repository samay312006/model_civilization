import { describe, expect, it } from 'vitest';
import {
  RELIGION_FOUNDER_INFLUENCE,
  RELIGION_FOUNDER_SANCTITY,
  RELIGION_FOUNDING_CHANCE,
  RELIGION_FOUNDING_WINDOW,
  RELIGION_INITIAL_ZEAL,
  RELIGION_MORALITY_BIAS_BONUS,
  RELIGION_SHRINE_ZEAL_GAIN,
  RELIGION_WORSHIP_ZEAL_GAIN,
  RELIGION_ZEAL_DECAY,
  maybeFoundReligion,
  spreadBeliefs,
  type ReligionCtxLikeExtended,
  type ReligionRec,
} from '../../../src/engine/society/religion';
import { createPerson } from '../../../src/engine/agents/person';
import { createRng } from '../../../src/engine/rng';
import { makeTestCiv, makeTestCtx } from '../../helpers/testCtx';
import type { Person } from '../../../src/shared/types';

function makePerson(id: number, civId: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, civId, 'fable', { x: 10, y: 10 }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  p.beliefIds = [];
  return p;
}

function makeReligionCtx(
  ctx: ReturnType<typeof makeTestCtx>,
  overrides: Partial<ReligionCtxLikeExtended> = {},
): ReligionCtxLikeExtended {
  return {
    people: ctx.people,
    civs: ctx.civs,
    religions: [],
    names: ctx.names,
    tick: ctx.tick,
    rng: ctx.rng,
    recentDisasterEvents: [],
    worshippersThisTick: new Set<number>(),
    settlements: [],
    ...overrides,
  };
}

describe('maybeFoundReligion', () => {
  it('founds a religion from a qualifying witness within the founding window, with a 0.02 roll', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 20 });
    const founder = makePerson(1, 0, base);
    founder.morality.sanctity = RELIGION_FOUNDER_SANCTITY + 0.1;
    founder.morality.care = 0.9;
    founder.morality.fairness = 0.8;
    // createPerson randomizes loyalty/authority/liberty (via rng.split('p1')); pin them below
    // fairness so the intended top-2 axes (care, fairness) are deterministic regardless of seed.
    founder.morality.loyalty = 0.2;
    founder.morality.authority = 0.2;
    founder.morality.liberty = 0.2;
    founder.influence = RELIGION_FOUNDER_INFLUENCE + 0.1;
    base.people = [founder];
    const rctx = makeReligionCtx(base, {
      rng: createRng(1), // seed chosen for the test only to exercise the code path deterministically via split
      recentDisasterEvents: [{ tick: 0, civId: 0, severity: 3 }], // within RELIGION_FOUNDING_WINDOW=30 of tick 20
    });

    // Roll forward enough independent calls that the 0.02/tick chance fires at least once
    // deterministically for this seed; each call re-splits the rng by label+tick so ticks differ.
    // The disaster event is re-anchored to the current tick each iteration so it stays within
    // RELIGION_FOUNDING_WINDOW of `ctx.tick` for all 400 calls (mirroring production, where
    // recentDisasterEvents is a rolling slice of "recent" events recomputed every tick rather
    // than a single fixed-tick event that ages out of the window after 30 ticks).
    let founded = false;
    for (let t = 20; t < 20 + 400 && !founded; t++) {
      rctx.tick = t;
      rctx.recentDisasterEvents = [{ tick: t, civId: 0, severity: 3 }];
      maybeFoundReligion(rctx);
      if (rctx.religions.length > 0) founded = true;
    }

    expect(founded).toBe(true);
    const rel = rctx.religions[0] as ReligionRec;
    expect(rel.founderId).toBe(1);
    expect(rel.civId).toBe(0);
    expect(rel.zeal).toBe(RELIGION_INITIAL_ZEAL);
    // top-2 axes (care 0.9, fairness 0.8) each +0.15, clamped to [0,1] per spec
    // (0.9 + 0.15 = 1.05 clamps to 1)
    expect(rel.moralityBias.care).toBeCloseTo(Math.min(1, 0.9 + RELIGION_MORALITY_BIAS_BONUS), 6);
    expect(rel.moralityBias.fairness).toBeCloseTo(Math.min(1, 0.8 + RELIGION_MORALITY_BIAS_BONUS), 6);
    expect(Object.keys(rel.moralityBias)).toHaveLength(2);
    expect(RELIGION_FOUNDING_WINDOW).toBe(30);
    expect(RELIGION_FOUNDER_SANCTITY).toBe(0.7);
    expect(RELIGION_FOUNDER_INFLUENCE).toBe(0.5);
    expect(RELIGION_FOUNDING_CHANCE).toBe(0.02);
  });

  it('does not found outside the founding window (no-op boundary)', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 100 });
    const founder = makePerson(1, 0, base);
    founder.morality.sanctity = 0.9;
    founder.influence = 0.9;
    base.people = [founder];
    const rctx = makeReligionCtx(base, {
      tick: 100,
      recentDisasterEvents: [{ tick: 0, civId: 0, severity: 3 }], // 100 ticks ago, window is 30
    });

    for (let t = 100; t < 100 + 400; t++) {
      rctx.tick = t;
      maybeFoundReligion(rctx);
    }

    expect(rctx.religions).toHaveLength(0);
  });

  it('does not found from a candidate below sanctity or influence thresholds', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 10 });
    const weakCandidate = makePerson(1, 0, base);
    weakCandidate.morality.sanctity = 0.5; // below threshold
    weakCandidate.influence = 0.9;
    base.people = [weakCandidate];
    const rctx = makeReligionCtx(base, {
      tick: 10,
      recentDisasterEvents: [{ tick: 0, civId: 0, severity: 3 }],
    });

    for (let t = 10; t < 10 + 400; t++) {
      rctx.tick = t;
      maybeFoundReligion(rctx);
    }

    expect(rctx.religions).toHaveLength(0);
  });
});

describe('spreadBeliefs', () => {
  it('adopts belief with chance 0.1*founderInfluence*(0.5+fear)*zeal and nudges morality toward the bias', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 0 });
    const founder = makePerson(1, 0, base);
    founder.influence = 1; // maximize adoption chance
    const believer = makePerson(2, 0, base);
    believer.emotions.fear = 1; // (0.5 + 1) = 1.5, further maximizing adoption chance
    believer.morality.care = 0;
    base.people = [founder, believer];
    const religion: ReligionRec = {
      id: 1,
      name: 'Testism',
      founderId: 1,
      civId: 0,
      moralityBias: { care: 1 },
      zeal: 1, // maximize chance: 0.1*1*1.5*1 = 0.15/tick
    };
    const rctx = makeReligionCtx(base, { religions: [religion], rng: createRng(2) });

    let adopted = false;
    for (let t = 0; t < 300 && !adopted; t++) {
      rctx.tick = t;
      spreadBeliefs(rctx);
      if (believer.beliefIds.includes(1)) adopted = true;
    }

    expect(adopted).toBe(true);
    // once adopted, further ticks nudge morality.care toward 1 by 0.5%/tick
    const careBefore = believer.morality.care;
    spreadBeliefs(rctx);
    expect(believer.morality.care).toBeGreaterThan(careBefore);
  });

  it('does not adopt when zeal is 0 (no-op boundary)', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 0 });
    const founder = makePerson(1, 0, base);
    founder.influence = 1;
    const believer = makePerson(2, 0, base);
    believer.emotions.fear = 1;
    base.people = [founder, believer];
    const religion: ReligionRec = {
      id: 1,
      name: 'Testism',
      founderId: 1,
      civId: 0,
      moralityBias: { care: 1 },
      zeal: 0,
    };
    const rctx = makeReligionCtx(base, { religions: [religion] });

    for (let t = 0; t < 200; t++) {
      rctx.tick = t;
      spreadBeliefs(rctx);
    }

    expect(believer.beliefIds).toHaveLength(0);
  });

  it('zeal decays 0.0005/tick, gains 0.002 per worshipper and 0.001 per shrine', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 0 });
    const founder = makePerson(1, 0, base);
    base.people = [founder];
    const religion: ReligionRec = {
      id: 1,
      name: 'Testism',
      founderId: 1,
      civId: 0,
      moralityBias: {},
      zeal: 0.5,
    };
    const rctx = makeReligionCtx(base, {
      religions: [religion],
      worshippersThisTick: new Set([1]),
      settlements: [{ civId: 0, structures: { shrine: 2 } }],
    });

    spreadBeliefs(rctx);

    const expected = 0.5 - RELIGION_ZEAL_DECAY + RELIGION_WORSHIP_ZEAL_GAIN + 2 * RELIGION_SHRINE_ZEAL_GAIN;
    expect(religion.zeal).toBeCloseTo(expected, 6);
  });

  it('is a no-op when the founder is dead', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 0 });
    const founder = makePerson(1, 0, base);
    founder.alive = false;
    const believer = makePerson(2, 0, base);
    base.people = [founder, believer];
    const religion: ReligionRec = {
      id: 1,
      name: 'Testism',
      founderId: 1,
      civId: 0,
      moralityBias: { care: 1 },
      zeal: 1,
    };
    const rctx = makeReligionCtx(base, { religions: [religion] });

    for (let t = 0; t < 50; t++) {
      rctx.tick = t;
      spreadBeliefs(rctx);
    }

    expect(believer.beliefIds).toHaveLength(0);
    expect(religion.zeal).toBe(1); // untouched; the whole religion is skipped
  });
});
