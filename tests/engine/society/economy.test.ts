import { describe, expect, it } from 'vitest';
import {
  SHARE_DEPOSIT_FLOOR,
  SHARE_DRAW_HUNGER_THRESHOLD,
  TRADE_AFFINITY_BOOST,
  TRADE_INTERVAL,
  TRADE_MAX_DISTANCE,
  TRADE_MAX_SWAP,
  shareWithin,
  tradeBetween,
} from '../../../src/engine/society/economy';
import { createPerson } from '../../../src/engine/agents/person';
import { makeTestCiv, makeTestCtx, makeTestSettlement } from '../../helpers/testCtx';
import type { Person } from '../../../src/shared/types';

function makePerson(id: number, civId: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, civId, 'fable', { x: 10, y: 10 }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  return p;
}

describe('shareWithin', () => {
  it('deposits surplus food above the floor, scaled by the share rate', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const p = makePerson(1, 0, ctx);
    p.inventory.food = 10;
    p.morality = { care: 1, fairness: 0, loyalty: 1, authority: 0, sanctity: 0, liberty: 0 };
    p.settlementId = 1;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [1] });
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);
    ctx.settlements = [settlement];

    shareWithin(ctx);

    // shareRate = clamp01(0.5 + 0.25*1 + 0.15*1 - 0.3*0) = 0.9
    // deposit = min(10 - 3, 10 * 0.9) = min(7, 9) = 7
    expect(settlement.stock.food).toBeCloseTo(7, 6);
    expect(p.inventory.food).toBeCloseTo(3, 6);
    expect(SHARE_DEPOSIT_FLOOR).toBe(3);
  });

  it('does not deposit at or below the floor (no-op boundary)', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const p = makePerson(1, 0, ctx);
    p.inventory.food = 3; // exactly at the floor
    p.settlementId = 1;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [1] });
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);
    ctx.settlements = [settlement];

    shareWithin(ctx);

    expect(settlement.stock.food).toBe(0);
    expect(p.inventory.food).toBe(3);
  });

  it('draws up to 1 food when hungry and stock is available', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const p = makePerson(1, 0, ctx);
    p.inventory.food = 0;
    p.needs.hunger = 0.9;
    p.settlementId = 1;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [1], stock: { food: 5, wood: 0, stone: 0, metal: 0, tools: 0 } });
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);
    ctx.settlements = [settlement];

    shareWithin(ctx);

    expect(p.inventory.food).toBe(1);
    expect(settlement.stock.food).toBe(4);
    expect(SHARE_DRAW_HUNGER_THRESHOLD).toBe(0.5);
  });

  it('draws nothing when not hungry, even with stock available (no-op boundary)', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const p = makePerson(1, 0, ctx);
    p.inventory.food = 0;
    p.needs.hunger = 0.1;
    p.settlementId = 1;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [1], stock: { food: 5, wood: 0, stone: 0, metal: 0, tools: 0 } });
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);
    ctx.settlements = [settlement];

    shareWithin(ctx);

    expect(p.inventory.food).toBe(0);
    expect(settlement.stock.food).toBe(5);
  });
});

describe('tradeBetween', () => {
  it('swaps 1 unit of surplus resource for a partner deficit resource between adjacent settlements every 30 ticks', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: TRADE_INTERVAL });
    const a = makeTestSettlement({
      id: 1,
      civId: 0,
      center: { x: 10, y: 10 },
      memberIds: [1],
      stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 }, // surplus food (10 > 2*1)
    });
    const b = makeTestSettlement({
      id: 2,
      civId: 0,
      center: { x: 15, y: 10 }, // distance 5, within TRADE_MAX_DISTANCE
      memberIds: [2],
      stock: { food: 0, wood: 10, stone: 0, metal: 0, tools: 0 }, // surplus wood, deficit food
    });
    const p1 = makePerson(1, 0, ctx);
    const p2 = makePerson(2, 0, ctx);
    ctx.people = [p1, p2];
    ctx.personById = new Map([[1, p1], [2, p2]]);
    ctx.settlements = [a, b];

    tradeBetween(ctx);

    expect(a.stock.food).toBeCloseTo(10 - TRADE_MAX_SWAP, 6);
    expect(a.stock.wood).toBeCloseTo(TRADE_MAX_SWAP, 6);
    expect(b.stock.wood).toBeCloseTo(10 - TRADE_MAX_SWAP, 6);
    expect(b.stock.food).toBeCloseTo(TRADE_MAX_SWAP, 6);
  });

  it('does not trade off the 30-tick interval (no-op boundary)', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: TRADE_INTERVAL + 1 });
    const a = makeTestSettlement({ id: 1, civId: 0, center: { x: 10, y: 10 }, memberIds: [1], stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const b = makeTestSettlement({ id: 2, civId: 0, center: { x: 15, y: 10 }, memberIds: [2], stock: { food: 0, wood: 10, stone: 0, metal: 0, tools: 0 } });
    ctx.settlements = [a, b];
    ctx.people = [];
    ctx.personById = new Map();

    tradeBetween(ctx);

    expect(a.stock.food).toBe(10);
    expect(b.stock.wood).toBe(10);
  });

  it('does not trade beyond TRADE_MAX_DISTANCE', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: TRADE_INTERVAL });
    const a = makeTestSettlement({ id: 1, civId: 0, center: { x: 0, y: 0 }, memberIds: [1], stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const b = makeTestSettlement({ id: 2, civId: 0, center: { x: 100, y: 100 }, memberIds: [2], stock: { food: 0, wood: 10, stone: 0, metal: 0, tools: 0 } });
    ctx.settlements = [a, b];
    ctx.people = [];
    ctx.personById = new Map();

    tradeBetween(ctx);

    expect(a.stock.food).toBe(10);
    expect(b.stock.wood).toBe(10);
    expect(TRADE_MAX_DISTANCE).toBe(25);
  });

  it('does not trade between civs at war', () => {
    const civA = makeTestCiv({ id: 0, atWarWith: [1] });
    const civB = makeTestCiv({ id: 1, atWarWith: [0] });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: TRADE_INTERVAL });
    const a = makeTestSettlement({ id: 1, civId: 0, center: { x: 10, y: 10 }, memberIds: [1], stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const b = makeTestSettlement({ id: 2, civId: 1, center: { x: 15, y: 10 }, memberIds: [2], stock: { food: 0, wood: 10, stone: 0, metal: 0, tools: 0 } });
    ctx.settlements = [a, b];
    ctx.people = [];
    ctx.personById = new Map();

    tradeBetween(ctx);

    expect(a.stock.food).toBe(10);
    expect(b.stock.wood).toBe(10);
  });

  it('boosts leader-pair affinity after a successful trade', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: TRADE_INTERVAL });
    const a = makeTestSettlement({ id: 1, civId: 0, center: { x: 10, y: 10 }, memberIds: [1], stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const b = makeTestSettlement({ id: 2, civId: 0, center: { x: 15, y: 10 }, memberIds: [2], stock: { food: 0, wood: 10, stone: 0, metal: 0, tools: 0 } });
    const p1 = makePerson(1, 0, ctx);
    const p2 = makePerson(2, 0, ctx);
    p1.influence = 1; // sole member -> leader of a
    p2.influence = 1; // sole member -> leader of b
    p1.relationships = [];
    p2.relationships = [];
    ctx.people = [p1, p2];
    ctx.personById = new Map([[1, p1], [2, p2]]);
    ctx.settlements = [a, b];

    tradeBetween(ctx);

    const rel1 = p1.relationships.find((r) => r.otherId === 2);
    const rel2 = p2.relationships.find((r) => r.otherId === 1);
    expect(rel1?.affinity).toBeCloseTo(TRADE_AFFINITY_BOOST, 6);
    expect(rel2?.affinity).toBeCloseTo(TRADE_AFFINITY_BOOST, 6);
  });
});
