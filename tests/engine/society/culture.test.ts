import { describe, expect, it } from 'vitest';
import {
  SCHISM_DISTANCE_THRESHOLD,
  SCHISM_DURATION_TICKS,
  SCHISM_LEADER_INFLUENCE,
  civCulture,
  cultureDistance,
  generatedColor,
  maybeSchism,
  settlementCulture,
} from '../../../src/engine/society/culture';
import { createPerson } from '../../../src/engine/agents/person';
import { makeTestCiv, makeTestCtx, makeTestSettlement } from '../../helpers/testCtx';
import type { Morality, Person, Traits } from '../../../src/shared/types';

const ZERO_MORALITY: Morality = { care: 0, fairness: 0, loyalty: 0, authority: 0, sanctity: 0, liberty: 0 };
const ZERO_TRAITS: Traits = { curiosity: 0, aggression: 0, empathy: 0, industriousness: 0, riskTolerance: 0 };

function makePerson(id: number, civId: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, civId, 'fable', { x: 10, y: 10 }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  p.morality = { ...ZERO_MORALITY };
  p.traits = { ...ZERO_TRAITS };
  return p;
}

describe('civCulture / settlementCulture', () => {
  it('averages morality and traits across living civ members', () => {
    const ctx = makeTestCtx({ civs: [makeTestCiv()] });
    const a = makePerson(1, 0, ctx);
    a.morality.care = 1;
    a.traits.curiosity = 1;
    const b = makePerson(2, 0, ctx);
    b.morality.care = 0;
    b.traits.curiosity = 0;
    ctx.people = [a, b];
    ctx.personById = new Map([[1, a], [2, b]]);

    const culture = civCulture(0, ctx);
    expect(culture.morality.care).toBeCloseTo(0.5, 6);
    expect(culture.traits.curiosity).toBeCloseTo(0.5, 6);
  });

  it('returns all-zero vectors for a civ with no living members (no-op boundary)', () => {
    const ctx = makeTestCtx({ civs: [makeTestCiv()] });
    ctx.people = [];
    ctx.personById = new Map();
    const culture = civCulture(0, ctx);
    expect(culture.morality).toEqual(ZERO_MORALITY);
    expect(culture.traits).toEqual(ZERO_TRAITS);
  });

  it('settlementCulture scopes to the settlement membership only', () => {
    const ctx = makeTestCtx({ civs: [makeTestCiv()] });
    const a = makePerson(1, 0, ctx);
    a.morality.fairness = 1;
    const b = makePerson(2, 0, ctx);
    b.morality.fairness = 0; // not a member of the settlement
    ctx.people = [a, b];
    ctx.personById = new Map([[1, a], [2, b]]);
    const s = makeTestSettlement({ memberIds: [1] });

    const culture = settlementCulture(s, ctx);
    expect(culture.morality.fairness).toBe(1);
  });
});

describe('cultureDistance', () => {
  it('is 0 for identical vectors', () => {
    const v = { morality: { ...ZERO_MORALITY }, traits: { ...ZERO_TRAITS } };
    expect(cultureDistance(v, v)).toBe(0);
  });

  it('is the normalized mean absolute difference across all 11 axes', () => {
    const a = { morality: { ...ZERO_MORALITY, care: 1 }, traits: { ...ZERO_TRAITS } };
    const b = { morality: { ...ZERO_MORALITY }, traits: { ...ZERO_TRAITS } };
    // only 1 of 11 axes differs, by 1.0 -> 1/11
    expect(cultureDistance(a, b)).toBeCloseTo(1 / 11, 6);
  });

  it('is 1 when every axis is maximally opposed', () => {
    const full: Morality = { care: 1, fairness: 1, loyalty: 1, authority: 1, sanctity: 1, liberty: 1 };
    const fullTraits: Traits = { curiosity: 1, aggression: 1, empathy: 1, industriousness: 1, riskTolerance: 1 };
    const a = { morality: full, traits: fullTraits };
    const b = { morality: ZERO_MORALITY, traits: ZERO_TRAITS };
    expect(cultureDistance(a, b)).toBeCloseTo(1, 6);
  });
});

describe('generatedColor', () => {
  it('is hsl((id*137)%360, 70%, 55%)', () => {
    expect(generatedColor(0)).toBe('hsl(0, 70%, 55%)');
    expect(generatedColor(1)).toBe('hsl(137, 70%, 55%)');
    expect(generatedColor(4)).toBe(`hsl(${(4 * 137) % 360}, 70%, 55%)`);
  });
});

describe('maybeSchism', () => {
  it('secedes a settlement after 2+ years over the distance threshold with an influential leader', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: 0 });
    // civ culture stays at zero: one lone outside member keeps the civ average at 0.
    const outsider = makePerson(1, 0, ctx);
    const leader = makePerson(2, 0, ctx);
    leader.morality = { care: 1, fairness: 1, loyalty: 1, authority: 1, sanctity: 1, liberty: 1 };
    leader.traits = { curiosity: 1, aggression: 1, empathy: 1, industriousness: 1, riskTolerance: 1 };
    leader.influence = SCHISM_LEADER_INFLUENCE + 0.01;
    ctx.people = [outsider, leader];
    ctx.personById = new Map([[1, outsider], [2, leader]]);
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [2] });
    ctx.settlements = [settlement];

    expect(cultureDistance(settlementCulture(settlement, ctx), civCulture(0, ctx))).toBeGreaterThan(
      SCHISM_DISTANCE_THRESHOLD,
    );

    // Tick forward in SCHISM check increments; simulate ticking by calling maybeSchism
    // repeatedly with ctx.tick advancing, as Simulation would.
    for (let t = 0; t <= SCHISM_DURATION_TICKS; t++) {
      ctx.tick = t;
      maybeSchism(ctx);
    }

    expect(ctx.civs).toHaveLength(2);
    const newCiv = ctx.civs.find((c) => c.id !== 0);
    expect(newCiv).toBeDefined();
    expect(newCiv?.color).toBe(generatedColor(newCiv?.id as number));
    expect(leader.civId).toBe(newCiv?.id);
    expect(settlement.civId).toBe(newCiv?.id);
    expect(outsider.civId).toBe(0); // not a settlement member, unaffected
  });

  it('does not secede before SCHISM_DURATION_TICKS have elapsed (no-op boundary)', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: 0 });
    const outsider = makePerson(1, 0, ctx);
    const leader = makePerson(2, 0, ctx);
    leader.morality = { care: 1, fairness: 1, loyalty: 1, authority: 1, sanctity: 1, liberty: 1 };
    leader.traits = { curiosity: 1, aggression: 1, empathy: 1, industriousness: 1, riskTolerance: 1 };
    leader.influence = SCHISM_LEADER_INFLUENCE + 0.01;
    ctx.people = [outsider, leader];
    ctx.personById = new Map([[1, outsider], [2, leader]]);
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [2] });
    ctx.settlements = [settlement];

    for (let t = 0; t < SCHISM_DURATION_TICKS - 1; t++) {
      ctx.tick = t;
      maybeSchism(ctx);
    }

    expect(ctx.civs).toHaveLength(1); // not yet
  });

  it('does not secede when the leader lacks sufficient influence', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: 0 });
    const outsider = makePerson(1, 0, ctx);
    const leader = makePerson(2, 0, ctx);
    leader.morality = { care: 1, fairness: 1, loyalty: 1, authority: 1, sanctity: 1, liberty: 1 };
    leader.traits = { curiosity: 1, aggression: 1, empathy: 1, industriousness: 1, riskTolerance: 1 };
    leader.influence = SCHISM_LEADER_INFLUENCE - 0.1; // below the gate
    ctx.people = [outsider, leader];
    ctx.personById = new Map([[1, outsider], [2, leader]]);
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [2] });
    ctx.settlements = [settlement];

    for (let t = 0; t <= SCHISM_DURATION_TICKS + 10; t++) {
      ctx.tick = t;
      maybeSchism(ctx);
    }

    expect(ctx.civs).toHaveLength(1);
  });
});
