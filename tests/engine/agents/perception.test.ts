import { describe, expect, it } from 'vitest';
import { buildPerception, type PerceptionCtxLike } from '../../../src/engine/agents/perception';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import { SpatialIndex } from '../../../src/engine/world/spatial';
import { World } from '../../../src/engine/world/terrain';
import type { NaturalEvent } from '../../../src/engine/world/climate';
import {
  PERCEPTION_RADIUS,
  type Civ,
  type Person,
  type Settlement,
  type Tile,
} from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function flatWorld(size: number): World {
  const tiles: Tile[] = Array.from({ length: size * size }, () => ({
    terrain: 'plains',
    fertility: 0.5,
    food: 1,
    wood: 2,
    stone: 2,
    metal: 0,
  }));
  return new World(size, tiles);
}

function makeCiv(id: number): Civ {
  return {
    id,
    name: `Civ${id}`,
    color: '#fff',
    knowledge: { fire: 0, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
    techs: ['fire'],
    atWarWith: [],
    warWeariness: 0,
  };
}

function makeAdult(id: number, x: number, y: number, civId = 0): Person {
  const p = createPerson(id, civId, 'fable', { x, y }, names, createRng(id + 1));
  return p;
}

function makeCtx(
  people: Person[],
  world: World,
  civs: Civ[],
  settlements: Settlement[] = [],
  naturalEvents: NaturalEvent[] = [],
  tick = 1000,
): PerceptionCtxLike {
  const spatial = new SpatialIndex();
  spatial.rebuild(people);
  return {
    world,
    people,
    personById: new Map(people.map((p) => [p.id, p])),
    civs,
    settlements,
    spatial,
    tick,
    naturalEvents,
  };
}

describe('buildPerception — basics', () => {
  it('fills tick, self and candidates', () => {
    const p = makeAdult(1, 32, 32);
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [makeCiv(0)]);
    const perc = buildPerception(p, ctx, []);
    expect(perc.tick).toBe(1000);
    expect(perc.self).toBe(p);
    expect(perc.candidates.length).toBeGreaterThan(0);
  });

  it('nearbyPeople includes only living others within PERCEPTION_RADIUS, ascending id', () => {
    const p = makeAdult(1, 32, 32);
    const near = makeAdult(2, 33, 32);
    const far = makeAdult(3, 60, 60);
    const dead = makeAdult(4, 32, 33);
    dead.alive = false;
    const world = flatWorld(64);
    const ctx = makeCtx([p, near, far, dead], world, [makeCiv(0)]);
    const perc = buildPerception(p, ctx, []);
    expect(perc.nearbyPeople.map((g) => g.id)).toEqual([2]);
  });

  it('personGlimpse fields: healthy, visibleEmotion, affinity, kin', () => {
    const p = makeAdult(1, 32, 32);
    const other = makeAdult(2, 33, 32);
    other.health = 0.3;
    p.relationships = [{ otherId: 2, kind: 'kin', affinity: 0.6 }];
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world, [makeCiv(0)]);
    const glimpse = buildPerception(p, ctx, []).nearbyPeople[0];
    expect(glimpse?.healthy).toBe(false);
    expect(glimpse?.affinity).toBeCloseTo(0.6, 6);
    expect(glimpse?.kin).toBe(true);
  });

  it('nearbyTiles covers PERCEPTION_RADIUS in row-major order and includes own tile', () => {
    const p = makeAdult(1, 32, 32);
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [makeCiv(0)]);
    const tiles = buildPerception(p, ctx, []).nearbyTiles;
    expect(tiles.some((t) => t.pos.x === 32 && t.pos.y === 32)).toBe(true);
    for (let i = 1; i < tiles.length; i++) {
      const a = tiles[i - 1] as { pos: { x: number; y: number } };
      const b = tiles[i] as { pos: { x: number; y: number } };
      expect(b.pos.y > a.pos.y || (b.pos.y === a.pos.y && b.pos.x > a.pos.x)).toBe(true);
    }
    for (const t of tiles) {
      expect(Math.hypot(t.pos.x - 32, t.pos.y - 32)).toBeLessThanOrEqual(PERCEPTION_RADIUS);
    }
  });
});

describe('buildPerception — settlement and civ glimpses', () => {
  const settlement: Settlement = {
    id: 1,
    civId: 0,
    name: 'Home',
    center: { x: 32, y: 32 },
    memberIds: [1],
    stock: { food: 20, wood: 0, stone: 0, metal: 0, tools: 0 },
    structures: { shelter: 0, granary: 1, wall: 0, shrine: 0 },
  };

  it("fills the person's own settlement glimpse", () => {
    const p = makeAdult(1, 32, 32);
    p.settlementId = 1;
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [makeCiv(0)], [settlement]);
    const perc = buildPerception(p, ctx, []);
    expect(perc.settlement).not.toBeNull();
    expect(perc.settlement?.hasGranary).toBe(true);
    expect(perc.settlement?.foodStock).toBe(20);
    expect(perc.settlement?.population).toBe(1);
  });

  it('is null when the settlement no longer resolves', () => {
    const p = makeAdult(1, 32, 32);
    p.settlementId = 999;
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [makeCiv(0)], [settlement]);
    expect(buildPerception(p, ctx, []).settlement).toBeNull();
  });

  it('lists nearby foreign settlements within PERCEPTION_RADIUS*5, excluding the own one', () => {
    const p = makeAdult(1, 32, 32);
    p.settlementId = 1;
    const foreign: Settlement = { ...settlement, id: 2, civId: 9, center: { x: 40, y: 32 }, memberIds: [] };
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [makeCiv(0)], [settlement, foreign]);
    const nearby = buildPerception(p, ctx, []).nearbySettlements;
    expect(nearby.some((s) => s.id === 2)).toBe(true);
    expect(nearby.some((s) => s.id === 1)).toBe(false);
  });

  it('computes civ population, season and foodPerCapita', () => {
    const p = makeAdult(1, 32, 32, 0);
    const other = makeAdult(2, 33, 32, 0);
    p.inventory.food = 6;
    other.inventory.food = 4;
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world, [makeCiv(0)], [], [], 45); // spring
    const perc = buildPerception(p, ctx, []);
    expect(perc.civ.population).toBe(2);
    expect(perc.civ.season).toBe('spring');
    expect(perc.civ.foodPerCapita).toBeCloseTo(5, 6);
    expect(perc.civ.techs).toEqual(['fire']);
  });
});

describe('buildPerception — dangers', () => {
  it('maps active natural events within range to danger glimpses', () => {
    const p = makeAdult(1, 32, 32);
    const drought: NaturalEvent = { kind: 'drought', startTick: 900, durationTicks: 200, center: { x: 33, y: 32 }, intensity: 0.7 };
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [makeCiv(0)], [], [drought], 1000);
    const dangers = buildPerception(p, ctx, []).dangers;
    expect(dangers.some((d) => d.kind === 'famine' && d.intensity === 0.7)).toBe(true);
  });

  it('excludes events far outside PERCEPTION_RADIUS*5', () => {
    const p = makeAdult(1, 32, 32);
    const farDisease: NaturalEvent = { kind: 'disease', startTick: 900, durationTicks: 200, center: { x: 63, y: 63 }, intensity: 0.9 };
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [makeCiv(0)], [], [farDisease], 1000);
    const dangers = buildPerception(p, ctx, []).dangers;
    expect(dangers.some((d) => d.kind === 'disease')).toBe(false);
  });

  it('excludes expired events', () => {
    const p = makeAdult(1, 32, 32);
    const expired: NaturalEvent = { kind: 'disease', startTick: 100, durationTicks: 50, center: { x: 32, y: 32 }, intensity: 0.9 };
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [makeCiv(0)], [], [expired], 1000);
    expect(buildPerception(p, ctx, []).dangers).toHaveLength(0);
  });
});
