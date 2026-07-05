import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/engine/rng';
import { dist } from '../../../src/shared/types';
import type { Person, Terrain, Tile } from '../../../src/shared/types';
import { World } from '../../../src/engine/world/terrain';
import { SPATIAL_CELL_SIZE, SpatialIndex, stepToward } from '../../../src/engine/world/spatial';

/** Complete Person with only id/pos/alive varying; everything else neutral. */
function stubPerson(id: number, x: number, y: number, alive = true): Person {
  return {
    id,
    alive,
    ageTicks: 7200,
    sex: 'm',
    name: `P${id}`,
    pos: { x, y },
    civId: 0,
    settlementId: null,
    lineage: 'fable',
    traits: { curiosity: 0.5, aggression: 0.5, empathy: 0.5, industriousness: 0.5, riskTolerance: 0.5 },
    emotions: { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 },
    morality: { care: 0.5, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0.5 },
    needs: { hunger: 0, safety: 0, rest: 0, belonging: 0, esteem: 0 },
    skills: { farming: 0, gathering: 0, building: 0, crafting: 0, fighting: 0, healing: 0, teaching: 0 },
    health: 1,
    lifespanTicks: 25200,
    memory: [],
    relationships: [],
    inventory: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 },
    actionWeights: {
      gather: 1, farm: 1, hunt: 1, build: 1, craft: 1, rest: 1, socialize: 1, court: 1, teach: 1,
      trade: 1, share: 1, steal: 1, attack: 1, flee: 1, migrate: 1, worship: 1, explore: 1, heal: 1,
    },
    brainState: {},
    influence: 0,
    beliefIds: [],
    partnerId: null,
    pregnantUntil: null,
    parentIds: null,
    causeOfDeath: null,
  };
}

/** Rows of characters: '~' water, anything else plains. */
function makeWorld(rows: string[]): World {
  const size = rows.length;
  const tiles: Tile[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const terrain: Terrain = rows[y][x] === '~' ? 'water' : 'plains';
      tiles.push({ terrain, fertility: terrain === 'water' ? 0 : 0.5, food: 0, wood: 0, stone: 0, metal: 0 });
    }
  }
  return new World(size, tiles);
}

describe('SpatialIndex', () => {
  it('near matches brute force on a random layout', () => {
    const rng = createRng(42);
    const people = Array.from({ length: 200 }, (_, id) => stubPerson(id, rng.int(64), rng.int(64)));
    const idx = new SpatialIndex();
    idx.rebuild(people);
    const queries: [number, number, number][] = [
      [0, 0, 4], [32, 32, 4], [63, 63, 12], [10, 50, 8], [32, 32, 0], [31, 33, 25],
    ];
    for (const [qx, qy, r] of queries) {
      const expected = people
        .filter((p) => dist(p.pos, { x: qx, y: qy }) <= r)
        .map((p) => p.id)
        .sort((a, b) => a - b);
      expect(idx.near({ x: qx, y: qy }, r)).toEqual(expected);
    }
  });

  it('near returns ascending ids regardless of rebuild order', () => {
    const rng = createRng(7);
    const people = Array.from({ length: 100 }, (_, id) => stubPerson(id, rng.int(32), rng.int(32)));
    const a = new SpatialIndex();
    a.rebuild(people);
    const b = new SpatialIndex();
    b.rebuild([...people].reverse());
    const fromA = a.near({ x: 16, y: 16 }, 12);
    const fromB = b.near({ x: 16, y: 16 }, 12);
    expect(fromA).toEqual(fromB);
    expect(fromA.length).toBeGreaterThan(0);
    expect([...fromA].sort((x, y) => x - y)).toEqual(fromA);
  });

  it('excludes dead people', () => {
    const people = [stubPerson(0, 5, 5), stubPerson(1, 5, 5, false), stubPerson(2, 6, 5)];
    const idx = new SpatialIndex();
    idx.rebuild(people);
    expect(idx.near({ x: 5, y: 5 }, 1)).toEqual([0, 2]);
  });

  it('handles radii spanning cell boundaries', () => {
    expect(SPATIAL_CELL_SIZE).toBe(8);
    const people = [stubPerson(0, 0, 0), stubPerson(1, 7, 7), stubPerson(2, 8, 8), stubPerson(3, 15, 15)];
    const idx = new SpatialIndex();
    idx.rebuild(people);
    // dist to (7,7) = 9.90 <= 10 in; dist to (8,8) = 11.31 > 10 out
    expect(idx.near({ x: 0, y: 0 }, 10)).toEqual([0, 1]);
  });
});

describe('stepToward', () => {
  const open = makeWorld(['.....', '.....', '.....', '.....', '.....']);

  it('moves one tile diagonally toward the target on open land', () => {
    expect(stepToward({ x: 0, y: 0 }, { x: 4, y: 4 }, open)).toEqual({ x: 1, y: 1 });
    expect(stepToward({ x: 4, y: 4 }, { x: 0, y: 0 }, open)).toEqual({ x: 3, y: 3 });
    expect(stepToward({ x: 2, y: 2 }, { x: 2, y: 0 }, open)).toEqual({ x: 2, y: 1 });
  });

  it('falls back to an axis step when the diagonal is water', () => {
    const w = makeWorld(['.....', '.~...', '.....', '.....', '.....']); // (1,1) water
    expect(stepToward({ x: 0, y: 0 }, { x: 4, y: 4 }, w)).toEqual({ x: 1, y: 0 });
  });

  it('sidesteps when the direct axis step is water', () => {
    const w = makeWorld(['.~...', '.....', '.....', '.....', '.....']); // (1,0) water
    expect(stepToward({ x: 0, y: 0 }, { x: 4, y: 0 }, w)).toEqual({ x: 1, y: 1 });
  });

  it('returns the from-position when fully blocked by water', () => {
    const w = makeWorld(['.~...', '~~...', '.....', '.....', '.....']); // (1,0),(0,1),(1,1) water
    expect(stepToward({ x: 0, y: 0 }, { x: 4, y: 4 }, w)).toEqual({ x: 0, y: 0 });
  });

  it('returns the from-position when already at the target', () => {
    expect(stepToward({ x: 2, y: 2 }, { x: 2, y: 2 }, open)).toEqual({ x: 2, y: 2 });
  });

  it('never steps off the map', () => {
    expect(stepToward({ x: 0, y: 0 }, { x: -5, y: -5 }, open)).toEqual({ x: 0, y: 0 });
    expect(stepToward({ x: 4, y: 4 }, { x: 9, y: 9 }, open)).toEqual({ x: 4, y: 4 });
  });
});
