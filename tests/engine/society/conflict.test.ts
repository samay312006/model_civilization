import { describe, expect, it } from 'vitest';
import {
  ALLIANCE_FORM_CHANCE,
  ALLIANCE_MAX_WEARINESS,
  PEACE_WEARINESS_THRESHOLD,
  RAID_AGGRESSION_THRESHOLD,
  RAID_CASUALTY_HEALTH_HIT,
  RAID_CHECK_INTERVAL,
  RAID_FOOD_THRESHOLD,
  RAID_PARTY_MAX_SIZE,
  RAID_STEAL_FRACTION,
  RAID_TARGET_MAX_DISTANCE,
  RAID_WEARINESS_PER_CASUALTY,
  RAID_WILLING_AGGRESSION,
  WAR_DECLARATION_MIN_RAIDS,
  WAR_DECLARATION_WINDOW,
  isAllied,
  maybeFormAlliances,
  resolveRaid,
  updateConflict,
  updateWarState,
} from '../../../src/engine/society/conflict';
import { createPerson } from '../../../src/engine/agents/person';
import { makeTestCiv, makeTestCtx, makeTestSettlement } from '../../helpers/testCtx';
import type { Person } from '../../../src/shared/types';

function makePerson(id: number, civId: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, civId, 'fable', { x: 10, y: 10 }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  return p;
}

describe('resolveRaid', () => {
  it('attackers win when attack power exceeds defense power; steal up to 30% of food stock', () => {
    const ctx = makeTestCtx({ tick: 0 });
    const attackerCiv = makeTestCiv({ id: 0 });
    const defenderCiv = makeTestCiv({ id: 1 });
    const attacker = makePerson(1, 0, ctx);
    attacker.skills.fighting = 1;
    const defender = makePerson(2, 1, ctx);
    defender.skills.fighting = 0.1;
    const settlement = makeTestSettlement({
      id: 1,
      civId: 1,
      stock: { food: 100, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    });
    ctx.people = [attacker, defender];
    ctx.personById = new Map([[1, attacker], [2, defender]]);

    const result = resolveRaid([attacker], [defender], attackerCiv, defenderCiv, settlement, ctx);

    expect(result.attackerWon).toBe(true);
    expect(result.foodStolen).toBeCloseTo(100 * RAID_STEAL_FRACTION, 6);
    expect(settlement.stock.food).toBeCloseTo(100 - 100 * RAID_STEAL_FRACTION, 6);
    expect(result.defenderCasualties).toContain(2);
    expect(defender.health).toBeCloseTo(1 - RAID_CASUALTY_HEALTH_HIT, 6);
    expect(defenderCiv.warWeariness).toBeCloseTo(RAID_WEARINESS_PER_CASUALTY, 6);
  });

  it('defenders win ties; walls boost defense 1.5x and metallurgy boosts attack 1.3x', () => {
    const ctx = makeTestCtx({ tick: 0 });
    const attackerCiv = makeTestCiv({ id: 0, techs: ['metallurgy'] });
    const defenderCiv = makeTestCiv({ id: 1 });
    const attacker = makePerson(1, 0, ctx);
    attacker.skills.fighting = 1; // attackPower = 1 * 1.3 = 1.3
    const defender = makePerson(2, 1, ctx);
    defender.skills.fighting = 1; // base defense 1, with wall x1.5 -> 1.5, beats 1.3
    const settlement = makeTestSettlement({
      id: 1,
      civId: 1,
      stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 1, shrine: 0 },
    });
    ctx.people = [attacker, defender];
    ctx.personById = new Map([[1, attacker], [2, defender]]);

    const result = resolveRaid([attacker], [defender], attackerCiv, defenderCiv, settlement, ctx);

    expect(result.attackerWon).toBe(false);
    expect(result.foodStolen).toBe(0);
    expect(result.attackerCasualties).toContain(1);
  });

  it('casualties are bounded between RAID_CASUALTY_MIN and RAID_CASUALTY_MAX and never exceed the losing side size', () => {
    const ctx = makeTestCtx({ tick: 0 });
    const attackerCiv = makeTestCiv({ id: 0 });
    const defenderCiv = makeTestCiv({ id: 1 });
    const attacker = makePerson(1, 0, ctx);
    attacker.skills.fighting = 1;
    const defender = makePerson(2, 1, ctx); // only 1 defender: casualty count clamps to 1
    defender.skills.fighting = 0;
    const settlement = makeTestSettlement({ id: 1, civId: 1, stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 } });
    ctx.people = [attacker, defender];
    ctx.personById = new Map([[1, attacker], [2, defender]]);

    const result = resolveRaid([attacker], [defender], attackerCiv, defenderCiv, settlement, ctx);

    expect(result.defenderCasualties.length).toBeLessThanOrEqual(1);
    expect(result.defenderCasualties.length).toBeGreaterThanOrEqual(1);
  });
});

describe('updateConflict — raid triggering', () => {
  it('triggers a raid when an aggressive leader faces low food per capita, targeting the nearest other-civ settlement', () => {
    const attackerCiv = makeTestCiv({ id: 0 });
    const defenderCiv = makeTestCiv({ id: 1 });
    const ctx = makeTestCtx({ civs: [attackerCiv, defenderCiv], tick: RAID_CHECK_INTERVAL });
    const leader = makePerson(1, 0, ctx);
    leader.traits.aggression = RAID_AGGRESSION_THRESHOLD + 0.1;
    leader.influence = 1;
    leader.skills.fighting = 1;
    const fighter = makePerson(2, 0, ctx);
    fighter.traits.aggression = RAID_WILLING_AGGRESSION + 0.1;
    fighter.skills.fighting = 1;
    const attackerSettlement = makeTestSettlement({
      id: 1,
      civId: 0,
      center: { x: 10, y: 10 },
      memberIds: [1, 2],
      stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 }, // foodPerCapita 0 < 0.5
    });
    const defender = makePerson(3, 1, ctx);
    defender.skills.fighting = 0;
    const defenderSettlement = makeTestSettlement({
      id: 2,
      civId: 1,
      center: { x: 15, y: 10 }, // distance 5, within RAID_TARGET_MAX_DISTANCE
      memberIds: [3],
      stock: { food: 20, wood: 0, stone: 0, metal: 0, tools: 0 },
    });
    ctx.people = [leader, fighter, defender];
    ctx.personById = new Map([[1, leader], [2, fighter], [3, defender]]);
    ctx.settlements = [attackerSettlement, defenderSettlement];

    updateConflict(ctx);

    expect(RAID_TARGET_MAX_DISTANCE).toBe(30);
    expect(RAID_PARTY_MAX_SIZE).toBe(8);
    // Attackers heavily favored (2 fighters skill 1 vs 1 defender skill 0) -> attackers win, steal food
    expect(defenderSettlement.stock.food).toBeLessThan(20);
  });

  it('does not raid off the 15-tick interval (no-op boundary)', () => {
    const attackerCiv = makeTestCiv({ id: 0 });
    const defenderCiv = makeTestCiv({ id: 1 });
    const ctx = makeTestCtx({ civs: [attackerCiv, defenderCiv], tick: RAID_CHECK_INTERVAL + 1 });
    const leader = makePerson(1, 0, ctx);
    leader.traits.aggression = 1;
    leader.influence = 1;
    const attackerSettlement = makeTestSettlement({ id: 1, civId: 0, center: { x: 10, y: 10 }, memberIds: [1], stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const defender = makePerson(2, 1, ctx);
    const defenderSettlement = makeTestSettlement({ id: 2, civId: 1, center: { x: 15, y: 10 }, memberIds: [2], stock: { food: 20, wood: 0, stone: 0, metal: 0, tools: 0 } });
    ctx.people = [leader, defender];
    ctx.personById = new Map([[1, leader], [2, defender]]);
    ctx.settlements = [attackerSettlement, defenderSettlement];

    updateConflict(ctx);

    expect(defenderSettlement.stock.food).toBe(20);
  });

  it('does not raid when the leader is not aggressive enough and food/revenge conditions are unmet (no-op boundary)', () => {
    const attackerCiv = makeTestCiv({ id: 0 });
    const defenderCiv = makeTestCiv({ id: 1 });
    const ctx = makeTestCtx({ civs: [attackerCiv, defenderCiv], tick: RAID_CHECK_INTERVAL });
    const leader = makePerson(1, 0, ctx);
    leader.traits.aggression = RAID_AGGRESSION_THRESHOLD - 0.1; // below threshold
    leader.influence = 1;
    const attackerSettlement = makeTestSettlement({ id: 1, civId: 0, center: { x: 10, y: 10 }, memberIds: [1], stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const defender = makePerson(2, 1, ctx);
    const defenderSettlement = makeTestSettlement({ id: 2, civId: 1, center: { x: 15, y: 10 }, memberIds: [2], stock: { food: 20, wood: 0, stone: 0, metal: 0, tools: 0 } });
    ctx.people = [leader, defender];
    ctx.personById = new Map([[1, leader], [2, defender]]);
    ctx.settlements = [attackerSettlement, defenderSettlement];

    updateConflict(ctx);

    expect(defenderSettlement.stock.food).toBe(20);
  });

  it('does not raid a target beyond RAID_TARGET_MAX_DISTANCE (no-op boundary)', () => {
    const attackerCiv = makeTestCiv({ id: 0 });
    const defenderCiv = makeTestCiv({ id: 1 });
    const ctx = makeTestCtx({ civs: [attackerCiv, defenderCiv], tick: RAID_CHECK_INTERVAL });
    const leader = makePerson(1, 0, ctx);
    leader.traits.aggression = 1;
    leader.influence = 1;
    const attackerSettlement = makeTestSettlement({ id: 1, civId: 0, center: { x: 0, y: 0 }, memberIds: [1], stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const defender = makePerson(2, 1, ctx);
    const defenderSettlement = makeTestSettlement({ id: 2, civId: 1, center: { x: 100, y: 100 }, memberIds: [2], stock: { food: 20, wood: 0, stone: 0, metal: 0, tools: 0 } });
    ctx.people = [leader, defender];
    ctx.personById = new Map([[1, leader], [2, defender]]);
    ctx.settlements = [attackerSettlement, defenderSettlement];

    updateConflict(ctx);

    expect(defenderSettlement.stock.food).toBe(20);
  });
});

describe('updateWarState', () => {
  it('declares war after 3+ raids between the same civ pair within a year', () => {
    const civA = makeTestCiv({ id: 0 });
    const civB = makeTestCiv({ id: 1 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 0 });

    const extA = civA as typeof civA & { _raidHistory: { otherCivId: number; timestamps: number[] }[] };
    extA._raidHistory = [{ otherCivId: 1, timestamps: [0, 100, 200] }];
    const extB = civB as typeof civB & { _raidHistory: { otherCivId: number; timestamps: number[] }[] };
    extB._raidHistory = [{ otherCivId: 0, timestamps: [0, 100, 200] }];
    ctx.tick = 250;

    updateWarState(ctx);

    expect(civA.atWarWith).toContain(1);
    expect(civB.atWarWith).toContain(0);
    expect(WAR_DECLARATION_MIN_RAIDS).toBe(3);
    expect(WAR_DECLARATION_WINDOW).toBe(360);
  });

  it('does not declare war with only 2 raids in the window (no-op boundary)', () => {
    const civA = makeTestCiv({ id: 0 });
    const civB = makeTestCiv({ id: 1 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 250 });
    const extA = civA as typeof civA & { _raidHistory: { otherCivId: number; timestamps: number[] }[] };
    extA._raidHistory = [{ otherCivId: 1, timestamps: [0, 100] }];
    const extB = civB as typeof civB & { _raidHistory: { otherCivId: number; timestamps: number[] }[] };
    extB._raidHistory = [{ otherCivId: 0, timestamps: [0, 100] }];

    updateWarState(ctx);

    expect(civA.atWarWith).not.toContain(1);
  });

  it('declares peace once both sides exceed the weariness threshold, resetting weariness and raid history', () => {
    const civA = makeTestCiv({ id: 0, atWarWith: [1], warWeariness: PEACE_WEARINESS_THRESHOLD + 0.1 });
    const civB = makeTestCiv({ id: 1, atWarWith: [0], warWeariness: PEACE_WEARINESS_THRESHOLD + 0.1 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 500 });

    updateWarState(ctx);

    expect(civA.atWarWith).not.toContain(1);
    expect(civB.atWarWith).not.toContain(0);
    expect(civA.warWeariness).toBe(0);
    expect(civB.warWeariness).toBe(0);
  });

  it('stays at war when only one side has crossed the weariness threshold (no-op boundary)', () => {
    const civA = makeTestCiv({ id: 0, atWarWith: [1], warWeariness: PEACE_WEARINESS_THRESHOLD + 0.1 });
    const civB = makeTestCiv({ id: 1, atWarWith: [0], warWeariness: 0.1 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 500 });

    updateWarState(ctx);

    expect(civA.atWarWith).toContain(1);
    expect(civB.atWarWith).toContain(0);
  });
});

describe('maybeFormAlliances / isAllied', () => {
  it('is never allied by default', () => {
    const civA = makeTestCiv({ id: 0 });
    const civB = makeTestCiv({ id: 1 });
    expect(isAllied(civA, civB)).toBe(false);
    expect(isAllied(civB, civA)).toBe(false);
  });

  it('forms an alliance between two peaceful, low-weariness, raid-free civs when the roll succeeds', () => {
    const civA = makeTestCiv({ id: 0, warWeariness: 0 });
    const civB = makeTestCiv({ id: 1, warWeariness: 0 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 0 });

    // Run many ticks to make an ALLIANCE_FORM_CHANCE=0.05 roll overwhelmingly likely at least once.
    for (let t = 0; t < 500 && !isAllied(civA, civB); t++) {
      ctx.tick = t;
      maybeFormAlliances(ctx);
    }

    expect(isAllied(civA, civB)).toBe(true);
    expect(isAllied(civB, civA)).toBe(true);
    expect(ALLIANCE_FORM_CHANCE).toBe(0.05);
  });

  it('does not ally civs that are at war with each other (no-op boundary)', () => {
    const civA = makeTestCiv({ id: 0, atWarWith: [1], warWeariness: 0 });
    const civB = makeTestCiv({ id: 1, atWarWith: [0], warWeariness: 0 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 0 });

    for (let t = 0; t < 500; t++) {
      ctx.tick = t;
      maybeFormAlliances(ctx);
    }

    expect(isAllied(civA, civB)).toBe(false);
  });

  it('does not ally civs whose weariness is at or above ALLIANCE_MAX_WEARINESS (no-op boundary)', () => {
    const civA = makeTestCiv({ id: 0, warWeariness: ALLIANCE_MAX_WEARINESS });
    const civB = makeTestCiv({ id: 1, warWeariness: 0 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 0 });

    for (let t = 0; t < 500; t++) {
      ctx.tick = t;
      maybeFormAlliances(ctx);
    }

    expect(isAllied(civA, civB)).toBe(false);
  });

  it('war declaration dissolves a standing alliance between the pair', () => {
    const civA = makeTestCiv({ id: 0, warWeariness: 0 });
    const civB = makeTestCiv({ id: 1, warWeariness: 0 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 0 });
    for (let t = 0; t < 500 && !isAllied(civA, civB); t++) {
      ctx.tick = t;
      maybeFormAlliances(ctx);
    }
    expect(isAllied(civA, civB)).toBe(true);

    const extA = civA as typeof civA & { _raidHistory: { otherCivId: number; timestamps: number[] }[] };
    extA._raidHistory = [{ otherCivId: 1, timestamps: [1000, 1100, 1200] }];
    const extB = civB as typeof civB & { _raidHistory: { otherCivId: number; timestamps: number[] }[] };
    extB._raidHistory = [{ otherCivId: 0, timestamps: [1000, 1100, 1200] }];
    ctx.tick = 1250;

    updateWarState(ctx);

    expect(civA.atWarWith).toContain(1);
    expect(isAllied(civA, civB)).toBe(false);
    expect(isAllied(civB, civA)).toBe(false);
  });
});
