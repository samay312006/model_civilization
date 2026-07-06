import { describe, expect, it } from 'vitest';
import {
  CLUSTER_MIN_MEMBERS,
  CLUSTER_RADIUS,
  DISSOLUTION_MIN_MEMBERS,
  OVERFLOW_SAFETY_PRESSURE,
  settlementCapacity,
  updateSettlements,
} from '../../../src/engine/society/settlements';
import { createPerson } from '../../../src/engine/agents/person';
import { makeTestCiv, makeTestCtx, makeTestSettlement } from '../../helpers/testCtx';
import type { Person } from '../../../src/shared/types';

function makePerson(id: number, x: number, y: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, 0, 'fable', { x, y }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  return p;
}

describe('settlementCapacity', () => {
  it('is 10 + 8*shelter, x2 with construction tech', () => {
    const civ = makeTestCiv();
    const s = makeTestSettlement({ structures: { shelter: 2, granary: 0, wall: 0, shrine: 0 } });
    expect(settlementCapacity(s, civ)).toBe(10 + 8 * 2); // 26
    const civWithTech = makeTestCiv({ techs: ['construction'] });
    expect(settlementCapacity(s, civWithTech)).toBe((10 + 8 * 2) * 2); // 52
  });

  it('a settlement with no shelters still has base capacity 10', () => {
    const civ = makeTestCiv();
    const s = makeTestSettlement();
    expect(settlementCapacity(s, civ)).toBe(10);
  });
});

describe('updateSettlements — formation', () => {
  it('forms a settlement from >=5 alive people clustered within radius 3 on habitable land', () => {
    const ctx = makeTestCtx({ civs: [makeTestCiv()] });
    // Find a habitable non-water tile to center the cluster on.
    let cx = -1, cy = -1;
    for (let y = 0; y < ctx.world.size && cx === -1; y++) {
      for (let x = 0; x < ctx.world.size; x++) {
        if (ctx.world.tileAt(x, y).terrain !== 'water') { cx = x; cy = y; break; }
      }
    }
    const people = [
      makePerson(1, cx, cy, ctx),
      makePerson(2, cx + 1, cy, ctx),
      makePerson(3, cx, cy + 1, ctx),
      makePerson(4, cx - 1, cy, ctx),
      makePerson(5, cx, cy - 1, ctx),
    ];
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    expect(ctx.settlements).toHaveLength(1);
    expect(ctx.settlements[0]?.memberIds.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(ctx.settlements[0]?.civId).toBe(0);
    for (const p of people) {
      expect(p.settlementId).toBe(ctx.settlements[0]?.id);
    }
  });

  it('does not form a settlement with fewer than 5 alive people clustered', () => {
    const ctx = makeTestCtx({ civs: [makeTestCiv()] });
    let cx = -1, cy = -1;
    for (let y = 0; y < ctx.world.size && cx === -1; y++) {
      for (let x = 0; x < ctx.world.size; x++) {
        if (ctx.world.tileAt(x, y).terrain !== 'water') { cx = x; cy = y; break; }
      }
    }
    const people = [
      makePerson(1, cx, cy, ctx),
      makePerson(2, cx + 1, cy, ctx),
      makePerson(3, cx, cy + 1, ctx),
      makePerson(4, cx - 1, cy, ctx),
    ];
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    expect(ctx.settlements).toHaveLength(0); // NO-OP boundary case: below CLUSTER_MIN_MEMBERS
    for (const p of people) {
      expect(p.settlementId).toBeNull();
    }
    expect(CLUSTER_MIN_MEMBERS).toBe(5);
    expect(CLUSTER_RADIUS).toBe(3);
  });

  it('does not cluster people whose center tile is water', () => {
    const ctx = makeTestCtx({ civs: [makeTestCiv()] });
    let wx = -1, wy = -1;
    for (let y = 0; y < ctx.world.size && wx === -1; y++) {
      for (let x = 0; x < ctx.world.size; x++) {
        if (ctx.world.tileAt(x, y).terrain === 'water') { wx = x; wy = y; break; }
      }
    }
    if (wx === -1) return; // world guarantees >=30% habitable but not that water exists at every seed; skip defensively
    const people = [
      makePerson(1, wx, wy, ctx),
      makePerson(2, wx, wy, ctx),
      makePerson(3, wx, wy, ctx),
      makePerson(4, wx, wy, ctx),
      makePerson(5, wx, wy, ctx),
    ];
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    expect(ctx.settlements).toHaveLength(0);
  });
});

describe('updateSettlements — overflow pressure', () => {
  it('members beyond capacity get needs.safety +0.1/tick', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const memberIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // 12 members, capacity 10 (no shelters)
    const people: Person[] = memberIds.map((id) => makePerson(id, 10, 10, ctx));
    for (const p of people) p.needs.safety = 0;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds });
    for (const p of people) p.settlementId = 1;
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.settlements = [settlement];
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    // capacity 10, 12 members -> the 2 lowest-id-ranked overflow members get pressure.
    // Deterministic ascending-id iteration: members beyond the first `capacity` in
    // ascending id order are the ones over capacity.
    const overflow = memberIds.slice(10); // ids 11, 12
    for (const id of overflow) {
      const p = people.find((x) => x.id === id) as Person;
      expect(p.needs.safety).toBeCloseTo(OVERFLOW_SAFETY_PRESSURE, 6);
    }
    for (const id of memberIds.slice(0, 10)) {
      const p = people.find((x) => x.id === id) as Person;
      expect(p.needs.safety).toBe(0);
    }
  });

  it('no-op when membership is at or under capacity', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const memberIds = [1, 2, 3, 4, 5];
    const people: Person[] = memberIds.map((id) => makePerson(id, 10, 10, ctx));
    for (const p of people) { p.needs.safety = 0; p.settlementId = 1; }
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds });
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.settlements = [settlement];
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    for (const p of people) expect(p.needs.safety).toBe(0);
  });
});

describe('updateSettlements — dissolution', () => {
  it('dissolves a settlement with fewer than 3 members and returns stock evenly', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const memberIds = [1, 2];
    const people: Person[] = memberIds.map((id) => makePerson(id, 10, 10, ctx));
    for (const p of people) p.settlementId = 1;
    const settlement = makeTestSettlement({
      id: 1,
      civId: 0,
      memberIds,
      stock: { food: 10, wood: 6, stone: 4, metal: 0, tools: 0 },
    });
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.settlements = [settlement];
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    expect(ctx.settlements).toHaveLength(0);
    expect(DISSOLUTION_MIN_MEMBERS).toBe(3);
    for (const p of people) {
      expect(p.settlementId).toBeNull();
      expect(p.inventory.food).toBe(5); // 10 / 2
      expect(p.inventory.wood).toBe(3); // 6 / 2
      expect(p.inventory.stone).toBe(2); // 4 / 2
    }
  });

  it('a settlement with exactly 3 members is not dissolved (boundary)', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const memberIds = [1, 2, 3];
    const people: Person[] = memberIds.map((id) => makePerson(id, 10, 10, ctx));
    for (const p of people) p.settlementId = 1;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds });
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.settlements = [settlement];
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    expect(ctx.settlements).toHaveLength(1); // NO-OP boundary: exactly DISSOLUTION_MIN_MEMBERS survives
  });

  it('prunes dead members from memberIds before evaluating dissolution', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const alive = [makePerson(1, 10, 10, ctx), makePerson(2, 10, 10, ctx)];
    const dead = makePerson(3, 10, 10, ctx);
    dead.alive = false;
    const people = [...alive, dead];
    for (const p of alive) p.settlementId = 1;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [1, 2, 3] });
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.settlements = [settlement];
    ctx.spatial.rebuild(alive);

    updateSettlements(ctx);

    // 2 living members remain after pruning the dead id -> below DISSOLUTION_MIN_MEMBERS -> dissolves
    expect(ctx.settlements).toHaveLength(0);
  });
});
