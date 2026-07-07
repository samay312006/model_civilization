import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/engine/rng';
import type { Rng } from '../../../src/engine/rng';
import { SEASON_TICKS } from '../../../src/shared/types';
import type { Terrain, Tile } from '../../../src/shared/types';
import { FOREST_WOOD_CAP, World } from '../../../src/engine/world/terrain';
import {
  EVENT_MAX_DURATION,
  EVENT_MIN_DURATION,
  MAX_ACTIVE_EVENTS,
  regenerateResources,
  seasonOf,
  seasonYieldMultiplier,
  updateNaturalEvents,
} from '../../../src/engine/world/climate';
import type { NaturalEvent } from '../../../src/engine/world/climate';

function makeTile(terrain: Terrain, fertility: number): Tile {
  return { terrain, fertility, food: fertility * 3, wood: terrain === 'forest' ? 20 : 0, stone: 0, metal: 0 };
}

/** Rows of characters: '~' water, 'F' forest (fertility 0.6), anything else plains (fertility 0.8). */
function makeWorld(rows: string[]): World {
  const size = rows.length;
  const tiles: Tile[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ch = rows[y][x];
      if (ch === '~') tiles.push(makeTile('water', 0));
      else if (ch === 'F') tiles.push(makeTile('forest', 0.6));
      else tiles.push(makeTile('plains', 0.8));
    }
  }
  return new World(size, tiles);
}

/** Rng whose chance() always fires; everything else delegates to a real seeded rng. */
function forceChance(base: Rng): Rng {
  return {
    next: () => base.next(),
    int: (m) => base.int(m),
    range: (lo, hi) => base.range(lo, hi),
    pick: (arr) => base.pick(arr),
    chance: () => true,
    gaussian: (mean, sd) => base.gaussian(mean, sd),
    split: (label) => forceChance(base.split(label)),
    getState: () => base.getState(),
    setState: (s) => base.setState(s),
  };
}

/** Rng whose chance() never fires. */
function neverChance(base: Rng): Rng {
  return {
    next: () => base.next(),
    int: (m) => base.int(m),
    range: (lo, hi) => base.range(lo, hi),
    pick: (arr) => base.pick(arr),
    chance: () => false,
    gaussian: (mean, sd) => base.gaussian(mean, sd),
    split: (label) => neverChance(base.split(label)),
    getState: () => base.getState(),
    setState: (s) => base.setState(s),
  };
}

describe('seasons', () => {
  it('cycles spring/summer/autumn/winter at SEASON_TICKS boundaries, repeating yearly', () => {
    expect(SEASON_TICKS).toBe(90);
    expect(seasonOf(0)).toBe('spring');
    expect(seasonOf(89)).toBe('spring');
    expect(seasonOf(90)).toBe('summer');
    expect(seasonOf(179)).toBe('summer');
    expect(seasonOf(180)).toBe('autumn');
    expect(seasonOf(269)).toBe('autumn');
    expect(seasonOf(270)).toBe('winter');
    expect(seasonOf(359)).toBe('winter');
    expect(seasonOf(360)).toBe('spring');
    expect(seasonOf(360 * 5 + 90)).toBe('summer');
  });

  it('returns the exact contract yield multipliers', () => {
    expect(seasonYieldMultiplier('spring')).toBe(1.1);
    expect(seasonYieldMultiplier('summer')).toBe(1.25);
    expect(seasonYieldMultiplier('autumn')).toBe(1.0);
    expect(seasonYieldMultiplier('winter')).toBe(0.45);
  });
});

describe('regenerateResources', () => {
  it('regrows food by 2% of the gap per tick toward fertility*3*seasonMult, capped', () => {
    const world = makeWorld(['..', '..']);
    const tile = world.tileAt(0, 0);
    tile.food = 0;
    const rng = createRng(1);
    regenerateResources(world, 0, rng); // tick 0 = spring, cap = 0.8 * 3 * 1.1 = 2.64
    expect(tile.food).toBeCloseTo(0.0528, 6); // (2.64 - 0) * 0.02
    for (let i = 0; i < 1000; i++) regenerateResources(world, 0, rng);
    expect(tile.food).toBeGreaterThan(2.639);
    expect(tile.food).toBeLessThanOrEqual(2.64 + 1e-9);
  });

  it('declines toward the lower cap in winter when overstocked', () => {
    const world = makeWorld(['..', '..']);
    const tile = world.tileAt(0, 0);
    tile.food = 2.64;
    regenerateResources(world, 270, createRng(1)); // winter cap = 0.8 * 3 * 0.45 = 1.08
    expect(tile.food).toBeCloseTo(2.6088, 6); // 2.64 + (1.08 - 2.64) * 0.02
  });

  it('regrows wood toward FOREST_WOOD_CAP only on forest tiles', () => {
    const world = makeWorld(['F.', '..']);
    const forest = world.tileAt(0, 0);
    const plains = world.tileAt(1, 0);
    plains.wood = 2;
    regenerateResources(world, 0, createRng(1));
    expect(FOREST_WOOD_CAP).toBe(40);
    expect(forest.wood).toBeCloseTo(20.02, 6); // 20 + (40 - 20) * 0.001
    expect(plains.wood).toBe(2);
  });

  it('an active drought suppresses all regrowth to zero', () => {
    const world = makeWorld(['F.', '..']);
    const forest = world.tileAt(0, 0);
    const plains = world.tileAt(1, 0);
    plains.food = 1;
    const drought: NaturalEvent = { kind: 'drought', startTick: 0, durationTicks: 50, center: null, intensity: 1 };
    regenerateResources(world, 10, createRng(1), [drought]);
    expect(plains.food).toBe(1);
    expect(forest.wood).toBe(20);
    // once the drought has expired the same list no longer suppresses
    regenerateResources(world, 60, createRng(1), [drought]);
    expect(plains.food).toBeGreaterThan(1);
  });

  it('water tiles never gain food', () => {
    const world = makeWorld(['~.', '..']);
    const water = world.tileAt(0, 0);
    for (let i = 0; i < 100; i++) regenerateResources(world, i, createRng(1));
    expect(water.fertility).toBe(0);
    expect(water.food).toBe(0);
  });
});

describe('updateNaturalEvents', () => {
  const world = makeWorld(['....', '....', '....', '....']);

  it('spawns drought only in summer, harsh-winter only in winter, disease anywhere', () => {
    const spring = updateNaturalEvents([], world, 0, forceChance(createRng(1)));
    expect(spring.map((e) => e.kind)).toEqual(['disease']);

    const summer = updateNaturalEvents([], world, 100, forceChance(createRng(1)));
    expect(summer.map((e) => e.kind)).toEqual(['drought', 'disease']);

    const winter = updateNaturalEvents([], world, 300, forceChance(createRng(1)));
    expect(winter.map((e) => e.kind)).toEqual(['harsh-winter', 'disease']);
  });

  it('caps active events at MAX_ACTIVE_EVENTS', () => {
    expect(MAX_ACTIVE_EVENTS).toBe(2);
    const rng = forceChance(createRng(2));
    const first = updateNaturalEvents([], world, 100, rng);
    expect(first).toHaveLength(2);
    const second = updateNaturalEvents(first, world, 101, rng);
    expect(second).toHaveLength(2);
    expect(second).toEqual(first);
  });

  it('expires events once durationTicks have elapsed', () => {
    const drought: NaturalEvent = { kind: 'drought', startTick: 0, durationTicks: 30, center: null, intensity: 0.8 };
    const still = updateNaturalEvents([drought], world, 29, neverChance(createRng(3)));
    expect(still).toEqual([drought]);
    const gone = updateNaturalEvents([drought], world, 30, neverChance(createRng(3)));
    expect(gone).toEqual([]);
  });

  it('gives events durations in 30..120 and gives disease a land-tile center', () => {
    for (let i = 0; i < 20; i++) {
      const tick = 100 + i * 360; // always summer
      const events = updateNaturalEvents([], world, tick, forceChance(createRng(100 + i)));
      expect(events).toHaveLength(2);
      for (const e of events) {
        expect(e.startTick).toBe(tick);
        expect(e.durationTicks).toBeGreaterThanOrEqual(EVENT_MIN_DURATION);
        expect(e.durationTicks).toBeLessThanOrEqual(EVENT_MAX_DURATION);
        expect(e.intensity).toBeGreaterThan(0);
        expect(e.intensity).toBeLessThanOrEqual(1);
        if (e.kind === 'disease') {
          expect(e.center).not.toBeNull();
          const c = e.center as { x: number; y: number };
          expect(world.tileAt(c.x, c.y).terrain).not.toBe('water');
        } else {
          expect(e.center).toBeNull();
        }
      }
    }
  });

  it('is deterministic per seed over a long run', () => {
    const run = (seed: number): string => {
      const rng = createRng(seed);
      let active: NaturalEvent[] = [];
      const log: string[] = [];
      for (let tick = 0; tick < 20000; tick++) {
        active = updateNaturalEvents(active, world, tick, rng);
        for (const e of active) {
          if (e.startTick === tick) log.push(`${tick}:${e.kind}:${e.durationTicks}:${e.intensity.toFixed(6)}`);
        }
      }
      return log.join('|');
    };
    const a = run(99);
    expect(a).toBe(run(99));
    expect(a.length).toBeGreaterThan(0); // ~19 spawns expected over 20000 ticks; zero is ~e^-19
    expect(a).not.toBe(run(100));
  });
});
