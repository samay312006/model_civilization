import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/engine/rng';
import type { Terrain, Tile } from '../../../src/shared/types';
import { World, generateWorld, isHabitable } from '../../../src/engine/world/terrain';

function plainsTile(): Tile {
  return { terrain: 'plains', fertility: 0.5, food: 1.5, wood: 0, stone: 0, metal: 0 };
}

describe('World', () => {
  it('index, inBounds and tileAt agree on a 4x4 grid', () => {
    const tiles = Array.from({ length: 16 }, plainsTile);
    const w = new World(4, tiles);
    expect(w.size).toBe(4);
    expect(w.index(0, 0)).toBe(0);
    expect(w.index(3, 0)).toBe(3);
    expect(w.index(0, 1)).toBe(4);
    expect(w.index(3, 3)).toBe(15);
    expect(w.inBounds(0, 0)).toBe(true);
    expect(w.inBounds(3, 3)).toBe(true);
    expect(w.inBounds(-1, 0)).toBe(false);
    expect(w.inBounds(4, 0)).toBe(false);
    expect(w.inBounds(0, 4)).toBe(false);
    expect(w.tileAt(2, 1)).toBe(tiles[6]);
  });

  it('constructor rejects a tile array of the wrong length', () => {
    const tiles = Array.from({ length: 15 }, plainsTile);
    expect(() => new World(4, tiles)).toThrow();
  });
});

describe('generateWorld', () => {
  it('produces a size*size tile array', () => {
    const w = generateWorld(64, createRng(1));
    expect(w.size).toBe(64);
    expect(w.tiles).toHaveLength(64 * 64);
  });

  it('is deterministic for the same seed', () => {
    const a = generateWorld(64, createRng(123));
    const b = generateWorld(64, createRng(123));
    expect(a.tiles).toEqual(b.tiles);
  });

  it('differs across seeds', () => {
    const a = generateWorld(64, createRng(123));
    const c = generateWorld(64, createRng(124));
    expect(JSON.stringify(a.tiles)).not.toBe(JSON.stringify(c.tiles));
  });

  it('guarantees at least 30% habitable (plains/forest) tiles across 5 seeds', () => {
    for (const seed of [11, 22, 33, 44, 55]) {
      const w = generateWorld(96, createRng(seed));
      const habitable = w.tiles.filter((t) => isHabitable(t.terrain)).length;
      expect(habitable / w.tiles.length).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('water tiles have zero fertility and zero food', () => {
    const w = generateWorld(64, createRng(7));
    for (const t of w.tiles) {
      if (t.terrain === 'water') {
        expect(t.fertility).toBe(0);
        expect(t.food).toBe(0);
      }
    }
  });

  it('initial food is fertility*3 and all resources are finite and non-negative', () => {
    const w = generateWorld(64, createRng(9));
    const seen = new Set<Terrain>();
    for (const t of w.tiles) {
      seen.add(t.terrain);
      expect(t.food).toBe(t.fertility * 3);
      for (const v of [t.fertility, t.food, t.wood, t.stone, t.metal]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
    expect(seen.has('plains') || seen.has('forest')).toBe(true);
  });
});
