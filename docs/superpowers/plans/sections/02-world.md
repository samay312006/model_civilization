## Section 2: World (Tasks 5–7)

This section builds the physical world the simulation runs on: procedural terrain generation from seeded fbm value noise (Task 5), the season cycle, resource regrowth and natural events (Task 6), and the spatial index plus water-aware movement primitive (Task 7). Everything here depends only on Task 2 (`src/engine/rng.ts`) and Task 3 (`src/shared/types.ts`) and is consumed by nearly every later task. All randomness flows through the passed `Rng`; no `Math.random`, no `Date.now`, no DOM.

**Contract deviations in this section (recorded, deliberate):**

1. `stepToward` gains a required third parameter: `stepToward(from: Vec2, to: Vec2, world: World): Vec2`. The contract signature has no `World` argument, but its documented behavior ("never into water; returns from if blocked") is impossible without terrain access. Callers (Task 15 `execute.ts`, Task 32 `conflict.ts`) all hold `ctx.world` and must call `stepToward(p.pos, target, ctx.world)`.
2. `regenerateResources` gains an optional fourth parameter: `regenerateResources(world: World, tick: Tick, rng: Rng, activeEvents: NaturalEvent[] = []): void`. The contract requires drought to suppress regrowth, but the contract signature has no way to see active events. Three-argument calls still compile and behave (no drought suppression). The Simulation (Task 33) must call `updateNaturalEvents` first, then pass the result: `ctx.naturalEvents = updateNaturalEvents(ctx.naturalEvents, world, tick, rng); regenerateResources(world, tick, rng, ctx.naturalEvents);`.

### Task 5: Terrain generation (`src/engine/world/terrain.ts`)

**Files:**
- Create: `src/engine/world/terrain.ts`
- Test: `tests/engine/world/terrain.test.ts`

**Interfaces:**

Consumes:
- `Tile`, `Terrain`, `clamp01(v: number): number` from `src/shared/types.ts` (Task 3)
- `Rng` (`next(): number; int(maxExclusive: number): number; range(min: number, max: number): number; pick<T>(arr: readonly T[]): T; chance(p: number): boolean; gaussian(mean: number, sd: number): number; split(label: string): Rng`) from `src/engine/rng.ts` (Task 2); tests also use `createRng(seed: number): Rng`

Produces:
- `class World` (contract) — `constructor(size: number, tiles: Tile[])` (constructor is new beyond contract; throws if `tiles.length !== size*size`), `readonly size: number`, `tiles: Tile[]` (row-major, length `size*size`), `index(x: number, y: number): number`, `inBounds(x: number, y: number): boolean`, `tileAt(x: number, y: number): Tile`
- `generateWorld(size: number, rng: Rng): World` (contract) — guarantees >= 30% plains+forest tiles, deterministic per rng stream
- `isHabitable(terrain: Terrain): boolean` — true for `'plains' | 'forest'`; used by Tasks 6–8 (spawn regions) and Task 26 (settlement founding)
- `FOREST_WOOD_CAP = 40` — wood cap consumed by Task 6 regrowth
- `makeFbmNoise(rng: Rng, octaves: number): (x: number, y: number) => number` — seeded fbm value noise in [0,1)
- Constants: `MIN_HABITABLE_FRACTION = 0.3`, `MOUNTAIN_LEVEL = 0.75`, `DESERT_MOISTURE = 0.32`, `FOREST_MOISTURE = 0.6`, `SEA_LEVELS: readonly number[] = [0.42, 0.38, 0.34, 0.3, 0.26]`

Generation design (all concrete, implemented below): two independent fbm value-noise fields (elevation, 4 octaves; moisture, 3 octaves) sampled at 4 noise features per map edge, contrast-stretched (x1.8 / x1.6 around 0.5) and clamped to [0,1]. Classification: `elevation < seaLevel` → water; `> 0.75` → mountain; else land split by moisture (`< 0.32` desert, `> 0.6` forest, else plains). Fertility comes from moisture on land (plains `0.4 + 0.6*m`, forest `0.3 + 0.5*m`, desert `0.25*m`, mountain `0.1*m`, water `0`). Initial `food = fertility * 3` on every tile. Wood is high in forest (`24..40`), stone/metal concentrate in mountains (stone `20..40`, metal `5..20` with 35% chance). The >= 30% habitable guarantee is by construction: for each rolled noise field the generator tries sea levels `0.42 → 0.26` in order; if none reach 30% it re-rolls fresh fields from `rng.split('worldgen-<attempt>')`, up to 10 attempts (10x5 consecutive failures is astronomically unlikely; a `throw` guards the impossible case).

- [ ] **Step 1: Write the failing terrain tests**

  Create `tests/engine/world/terrain.test.ts` with exactly:

  ```ts
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
  ```

- [ ] **Step 2: Run the tests and confirm they fail**

  ```
  npx vitest run tests/engine/world/terrain.test.ts
  ```

  Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/world/terrain" from "tests/engine/world/terrain.test.ts". Does the file exist?` (1 failed test file, 0 tests run).

- [ ] **Step 3: Implement terrain generation**

  Create `src/engine/world/terrain.ts` with exactly:

  ```ts
  import { clamp01 } from '../../shared/types';
  import type { Terrain, Tile } from '../../shared/types';
  import type { Rng } from '../rng';

  /** True for the terrain kinds people can settle, farm and forage on. */
  export function isHabitable(terrain: Terrain): boolean {
    return terrain === 'plains' || terrain === 'forest';
  }

  /** Wood level a forest tile regrows toward; also the upper bound of initial forest wood. */
  export const FOREST_WOOD_CAP = 40;

  /** Fraction of tiles that must be plains or forest for a map to be accepted. */
  export const MIN_HABITABLE_FRACTION = 0.3;

  /** Elevation above this is mountain. */
  export const MOUNTAIN_LEVEL = 0.75;
  /** Moisture below this on land is desert. */
  export const DESERT_MOISTURE = 0.32;
  /** Moisture above this on land is forest. */
  export const FOREST_MOISTURE = 0.6;
  /** Sea levels tried in order (each drier than the last) until MIN_HABITABLE_FRACTION is reached. */
  export const SEA_LEVELS: readonly number[] = [0.42, 0.38, 0.34, 0.3, 0.26];

  /** Noise features across one map edge (continent scale). */
  const NOISE_SCALE = 4;
  /** Fresh noise fields are rolled at most this many times (times SEA_LEVELS.length classifications). */
  const MAX_ATTEMPTS = 10;

  export class World {
    readonly size: number;
    tiles: Tile[];

    constructor(size: number, tiles: Tile[]) {
      if (tiles.length !== size * size) {
        throw new Error(`World: expected ${size * size} tiles, got ${tiles.length}`);
      }
      this.size = size;
      this.tiles = tiles;
    }

    index(x: number, y: number): number {
      return y * this.size + x;
    }

    inBounds(x: number, y: number): boolean {
      return x >= 0 && y >= 0 && x < this.size && y < this.size;
    }

    tileAt(x: number, y: number): Tile {
      return this.tiles[this.index(x, y)];
    }
  }

  /**
   * 2D lattice hash producing a stable pseudo-random value in [0, 1) per
   * integer lattice point. Seeded by two 32-bit draws from the given Rng, so
   * the whole field is a deterministic function of the Rng stream.
   */
  function makeLatticeHash(rng: Rng): (ix: number, iy: number) => number {
    const seedA = Math.floor(rng.next() * 4294967296) >>> 0;
    const seedB = Math.floor(rng.next() * 4294967296) >>> 0;
    return (ix: number, iy: number): number => {
      let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + seedA) >>> 0;
      h = (h ^ (h >>> 13)) >>> 0;
      h = (Math.imul(h, 1274126177) ^ seedB) >>> 0;
      h = (h ^ (h >>> 16)) >>> 0;
      return h / 4294967296;
    };
  }

  /** Smoothstep interpolation weight. */
  function smooth(t: number): number {
    return t * t * (3 - 2 * t);
  }

  /** Single-octave 2D value noise in [0, 1): bilinear smoothstep blend of lattice hashes. */
  function valueNoise2D(hash: (ix: number, iy: number) => number, x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const v00 = hash(ix, iy);
    const v10 = hash(ix + 1, iy);
    const v01 = hash(ix, iy + 1);
    const v11 = hash(ix + 1, iy + 1);
    const top = v00 + (v10 - v00) * fx;
    const bottom = v01 + (v11 - v01) * fx;
    return top + (bottom - top) * fy;
  }

  /**
   * Fractal Brownian motion over value noise: `octaves` layers, each at double
   * frequency and half amplitude, normalized back into [0, 1). Octaves are
   * offset so they do not correlate despite sharing one lattice hash.
   */
  export function makeFbmNoise(rng: Rng, octaves: number): (x: number, y: number) => number {
    const hash = makeLatticeHash(rng);
    return (x: number, y: number): number => {
      let sum = 0;
      let amplitude = 1;
      let frequency = 1;
      let norm = 0;
      for (let o = 0; o < octaves; o++) {
        sum += amplitude * valueNoise2D(hash, x * frequency + o * 31.7, y * frequency + o * 17.3);
        norm += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
      }
      return sum / norm;
    };
  }

  function classifyTerrain(elevation: number, moisture: number, seaLevel: number): Terrain {
    if (elevation < seaLevel) return 'water';
    if (elevation > MOUNTAIN_LEVEL) return 'mountain';
    if (moisture < DESERT_MOISTURE) return 'desert';
    if (moisture > FOREST_MOISTURE) return 'forest';
    return 'plains';
  }

  function buildTiles(terrain: Terrain[], moisture: Float64Array, rr: Rng): Tile[] {
    const tiles: Tile[] = new Array(terrain.length);
    for (let i = 0; i < terrain.length; i++) {
      const t = terrain[i];
      const m = moisture[i];
      let fertility = 0;
      let wood = 0;
      let stone = 0;
      let metal = 0;
      switch (t) {
        case 'water':
          break;
        case 'plains':
          fertility = clamp01(0.4 + 0.6 * m);
          wood = rr.range(0, 3);
          stone = rr.range(0, 2);
          break;
        case 'forest':
          fertility = clamp01(0.3 + 0.5 * m);
          wood = 24 + rr.range(0, FOREST_WOOD_CAP - 24);
          stone = rr.range(0, 2);
          break;
        case 'desert':
          fertility = clamp01(0.25 * m);
          stone = rr.range(0, 2);
          break;
        case 'mountain':
          fertility = clamp01(0.1 * m);
          stone = 20 + rr.range(0, 20);
          metal = rr.chance(0.35) ? rr.range(5, 20) : 0;
          break;
      }
      tiles[i] = { terrain: t, fertility, food: fertility * 3, wood, stone, metal };
    }
    return tiles;
  }

  /**
   * Generate a size x size world from value-noise elevation and moisture
   * fields. Guarantees >= MIN_HABITABLE_FRACTION plains+forest tiles: for each
   * rolled pair of noise fields it tries progressively lower sea levels; if
   * none reach the fraction it re-rolls fresh fields from a new deterministic
   * rng.split stream. Deterministic per seed: only rng.split children are
   * consumed, in a fixed order.
   */
  export function generateWorld(size: number, rng: Rng): World {
    const count = size * size;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const attemptRng = rng.split(`worldgen-${attempt}`);
      const elevNoise = makeFbmNoise(attemptRng.split('elevation'), 4);
      const moistNoise = makeFbmNoise(attemptRng.split('moisture'), 3);
      const elevation = new Float64Array(count);
      const moisture = new Float64Array(count);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const nx = (x / size) * NOISE_SCALE;
          const ny = (y / size) * NOISE_SCALE;
          const i = y * size + x;
          // Stretch contrast around 0.5 so thresholds carve distinct seas and ranges.
          elevation[i] = clamp01((elevNoise(nx, ny) - 0.5) * 1.8 + 0.5);
          moisture[i] = clamp01((moistNoise(nx, ny) - 0.5) * 1.6 + 0.5);
        }
      }
      for (const seaLevel of SEA_LEVELS) {
        const terrain: Terrain[] = new Array(count);
        let habitable = 0;
        for (let i = 0; i < count; i++) {
          const t = classifyTerrain(elevation[i], moisture[i], seaLevel);
          terrain[i] = t;
          if (isHabitable(t)) habitable++;
        }
        if (habitable / count >= MIN_HABITABLE_FRACTION) {
          return new World(size, buildTiles(terrain, moisture, attemptRng.split('resources')));
        }
      }
    }
    throw new Error(`generateWorld: no map with >= 30% habitable land after ${MAX_ATTEMPTS} attempts`);
  }
  ```

- [ ] **Step 4: Run the tests and confirm they pass**

  ```
  npx vitest run tests/engine/world/terrain.test.ts
  ```

  Expected: PASS — `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 5: Typecheck**

  ```
  npm run typecheck
  ```

  Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

  ```
  git add src/engine/world/terrain.ts tests/engine/world/terrain.test.ts
  git commit -m "feat(world): terrain generation via seeded fbm value noise (Task 5)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

### Task 6: Climate — seasons, regrowth, natural events (`src/engine/world/climate.ts`)

**Files:**
- Create: `src/engine/world/climate.ts`
- Test: `tests/engine/world/climate.test.ts`

**Interfaces:**

Consumes:
- `SEASON_TICKS` (= 90), `YEAR_TICKS` (= 360), `Season`, `Tick`, `Vec2`, `Tile`, `Terrain` from `src/shared/types.ts` (Task 3)
- `Rng`, `createRng(seed: number): Rng` from `src/engine/rng.ts` (Task 2)
- `World` (class: `size`, `tiles`, `tileAt(x, y)`, constructor `(size, tiles)`), `FOREST_WOOD_CAP` (= 40) from `src/engine/world/terrain.ts` (Task 5)

Produces:
- `seasonOf(tick: Tick): Season` (contract) — 90-tick quarters starting at spring on tick 0
- `seasonYieldMultiplier(season: Season): number` (contract) — spring 1.1, summer 1.25, autumn 1.0, winter 0.45
- `regenerateResources(world: World, tick: Tick, rng: Rng, activeEvents: NaturalEvent[] = []): void` (contract + **deviation 2**: optional `activeEvents`; Task 33 must pass `ctx.naturalEvents`)
- `interface NaturalEvent { kind: 'drought' | 'harsh-winter' | 'disease'; startTick: Tick; durationTicks: number; center: Vec2 | null; intensity: number }` (contract) — drought/harsh-winter are map-wide (`center: null`); disease has a land-tile center consumed by Task 17 (lifecycle infection)
- `updateNaturalEvents(active: NaturalEvent[], world: World, tick: Tick, rng: Rng): NaturalEvent[]` (contract) — expires and spawns, returns a new array, never mutates input
- `SEASONS: readonly Season[]` — `['spring', 'summer', 'autumn', 'winter']`
- `isEventActive(e: NaturalEvent, tick: Tick): boolean` — true while `startTick <= tick < startTick + durationTicks` (Task 17 uses this for disease exposure)
- Constants: `FOOD_REGROWTH_RATE = 0.02`, `WOOD_REGROWTH_RATE = 0.001`, `MAX_ACTIVE_EVENTS = 2`, `EVENT_MIN_DURATION = 30`, `EVENT_MAX_DURATION = 120`, `DROUGHT_CHANCE = 1 / (4 * YEAR_TICKS)`, `HARSH_WINTER_CHANCE = 1 / (3 * YEAR_TICKS)`, `DISEASE_CHANCE = 1 / (5 * YEAR_TICKS)`

Mechanics (all concrete): each tick food moves 2% of the remaining gap toward `fertility * 3 * seasonYieldMultiplier(seasonOf(tick))` — downward too, so a winter cap gently drains autumn surplus; forest wood moves 0.1% of the gap toward `FOREST_WOOD_CAP`. An active drought suppresses all regrowth to zero (early return). Event spawning: fixed roll order drought → harsh-winter → disease; drought only in summer at `1/1440` per tick, harsh-winter only in winter at `1/1080` per tick, disease any season at `1/1800` per tick; duration uniform 30..120 ticks; intensity `range(0.5, 1)` for weather, `range(0.3, 1)` for disease; at most 2 events active and at most one of each kind.

- [ ] **Step 1: Write the failing season tests**

  Create `tests/engine/world/climate.test.ts` with exactly:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { SEASON_TICKS } from '../../../src/shared/types';
  import { seasonOf, seasonYieldMultiplier } from '../../../src/engine/world/climate';

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
  ```

- [ ] **Step 2: Run the tests and confirm they fail**

  ```
  npx vitest run tests/engine/world/climate.test.ts
  ```

  Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/world/climate" from "tests/engine/world/climate.test.ts". Does the file exist?` (1 failed test file, 0 tests run).

- [ ] **Step 3: Implement the season functions**

  Create `src/engine/world/climate.ts` with exactly:

  ```ts
  import { SEASON_TICKS, YEAR_TICKS } from '../../shared/types';
  import type { Season, Tick } from '../../shared/types';

  export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

  /** Season of a tick: 90-tick quarters of the 360-tick year, starting at spring on tick 0. */
  export function seasonOf(tick: Tick): Season {
    return SEASONS[Math.floor((tick % YEAR_TICKS) / SEASON_TICKS)];
  }

  /** Contract-fixed food yield multipliers per season. */
  export function seasonYieldMultiplier(season: Season): number {
    switch (season) {
      case 'spring': return 1.1;
      case 'summer': return 1.25;
      case 'autumn': return 1.0;
      case 'winter': return 0.45;
    }
  }
  ```

- [ ] **Step 4: Run the tests and confirm they pass**

  ```
  npx vitest run tests/engine/world/climate.test.ts
  ```

  Expected: PASS — `Test Files  1 passed (1)`, `Tests  2 passed (2)`.

- [ ] **Step 5: Typecheck and commit the season cycle**

  ```
  npm run typecheck
  ```

  Expected: no output, exit code 0. Then:

  ```
  git add src/engine/world/climate.ts tests/engine/world/climate.test.ts
  git commit -m "feat(world): season cycle and yield multipliers (Task 6)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

- [ ] **Step 6: Write the failing regrowth and natural-event tests**

  Replace the entire contents of `tests/engine/world/climate.test.ts` with:

  ```ts
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
  ```

- [ ] **Step 7: Run the tests and confirm the new ones fail**

  ```
  npx vitest run tests/engine/world/climate.test.ts
  ```

  Expected: FAIL — `SyntaxError: The requested module '.../src/engine/world/climate.ts' does not provide an export named 'regenerateResources'` (or the equivalent Vite import-analysis error naming the first missing export). The 2 season tests may not even run because the module fails to load — that is fine.

- [ ] **Step 8: Implement regrowth and natural events**

  Replace the entire contents of `src/engine/world/climate.ts` with:

  ```ts
  import { SEASON_TICKS, YEAR_TICKS } from '../../shared/types';
  import type { Season, Tick, Vec2 } from '../../shared/types';
  import type { Rng } from '../rng';
  import { FOREST_WOOD_CAP } from './terrain';
  import type { World } from './terrain';

  export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

  /** Season of a tick: 90-tick quarters of the 360-tick year, starting at spring on tick 0. */
  export function seasonOf(tick: Tick): Season {
    return SEASONS[Math.floor((tick % YEAR_TICKS) / SEASON_TICKS)];
  }

  /** Contract-fixed food yield multipliers per season. */
  export function seasonYieldMultiplier(season: Season): number {
    switch (season) {
      case 'spring': return 1.1;
      case 'summer': return 1.25;
      case 'autumn': return 1.0;
      case 'winter': return 0.45;
    }
  }

  /** Per-tick fraction of the gap to the seasonal cap that food regrows. */
  export const FOOD_REGROWTH_RATE = 0.02;
  /** Per-tick fraction of the gap to FOREST_WOOD_CAP that forest wood regrows. */
  export const WOOD_REGROWTH_RATE = 0.001;

  export interface NaturalEvent {
    kind: 'drought' | 'harsh-winter' | 'disease';
    startTick: Tick;
    durationTicks: number;
    /** null = map-wide (drought, harsh-winter); disease is centered on a land tile. */
    center: Vec2 | null;
    /** 0..1; consumed by regrowth here and by needs/lifecycle in later tasks. */
    intensity: number;
  }

  /** True while tick lies inside [startTick, startTick + durationTicks). */
  export function isEventActive(e: NaturalEvent, tick: Tick): boolean {
    return tick >= e.startTick && tick < e.startTick + e.durationTicks;
  }

  /**
   * Move each tile's food toward fertility * 3 * seasonYieldMultiplier at
   * FOOD_REGROWTH_RATE of the remaining gap per tick (downward too, so a
   * winter cap gently drains surplus), and forest wood toward FOREST_WOOD_CAP
   * at WOOD_REGROWTH_RATE. An active drought suppresses all regrowth to zero.
   *
   * NOTE (recorded contract deviation): `activeEvents` extends the contract
   * signature as an optional trailing parameter. The Simulation (Task 33) must
   * run updateNaturalEvents first and pass ctx.naturalEvents here; calls that
   * omit it simply get no drought suppression.
   */
  export function regenerateResources(world: World, tick: Tick, _rng: Rng, activeEvents: NaturalEvent[] = []): void {
    for (const e of activeEvents) {
      if (e.kind === 'drought' && isEventActive(e, tick)) return;
    }
    const mult = seasonYieldMultiplier(seasonOf(tick));
    for (const t of world.tiles) {
      if (t.fertility > 0) {
        const foodCap = t.fertility * 3 * mult;
        t.food += (foodCap - t.food) * FOOD_REGROWTH_RATE;
      }
      if (t.terrain === 'forest' && t.wood < FOREST_WOOD_CAP) {
        t.wood += (FOREST_WOOD_CAP - t.wood) * WOOD_REGROWTH_RATE;
      }
    }
  }

  export const MAX_ACTIVE_EVENTS = 2;
  export const EVENT_MIN_DURATION = 30;
  export const EVENT_MAX_DURATION = 120;
  /** Per summer tick (~one drought every 4 years). */
  export const DROUGHT_CHANCE = 1 / (4 * YEAR_TICKS);
  /** Per winter tick (~one harsh winter every 3 years). */
  export const HARSH_WINTER_CHANCE = 1 / (3 * YEAR_TICKS);
  /** Per tick, any season (~one outbreak every 5 years). */
  export const DISEASE_CHANCE = 1 / (5 * YEAR_TICKS);

  /** Uniform duration in [EVENT_MIN_DURATION, EVENT_MAX_DURATION]. */
  function rollDuration(rng: Rng): number {
    return EVENT_MIN_DURATION + rng.int(EVENT_MAX_DURATION - EVENT_MIN_DURATION + 1);
  }

  /** Pick a non-water tile: bounded retries, deterministic fallback to the map center. */
  function pickLandTile(world: World, rng: Rng): Vec2 {
    for (let i = 0; i < 50; i++) {
      const x = rng.int(world.size);
      const y = rng.int(world.size);
      if (world.tileAt(x, y).terrain !== 'water') return { x, y };
    }
    return { x: Math.floor(world.size / 2), y: Math.floor(world.size / 2) };
  }

  /**
   * Expire finished events and roll new ones in a fixed order (drought,
   * harsh-winter, disease). At most MAX_ACTIVE_EVENTS are active at once and
   * at most one of each kind. Returns a new array; never mutates `active`.
   * Drought suppresses regrowth (see regenerateResources); harsh-winter and
   * disease intensity are consumed by needs/lifecycle in Tasks 9 and 17.
   */
  export function updateNaturalEvents(active: NaturalEvent[], world: World, tick: Tick, rng: Rng): NaturalEvent[] {
    const next = active.filter((e) => isEventActive(e, tick));
    const season = seasonOf(tick);
    const hasKind = (k: NaturalEvent['kind']): boolean => next.some((e) => e.kind === k);

    if (next.length < MAX_ACTIVE_EVENTS && season === 'summer' && !hasKind('drought') && rng.chance(DROUGHT_CHANCE)) {
      next.push({ kind: 'drought', startTick: tick, durationTicks: rollDuration(rng), center: null, intensity: rng.range(0.5, 1) });
    }
    if (next.length < MAX_ACTIVE_EVENTS && season === 'winter' && !hasKind('harsh-winter') && rng.chance(HARSH_WINTER_CHANCE)) {
      next.push({ kind: 'harsh-winter', startTick: tick, durationTicks: rollDuration(rng), center: null, intensity: rng.range(0.5, 1) });
    }
    if (next.length < MAX_ACTIVE_EVENTS && !hasKind('disease') && rng.chance(DISEASE_CHANCE)) {
      next.push({ kind: 'disease', startTick: tick, durationTicks: rollDuration(rng), center: pickLandTile(world, rng), intensity: rng.range(0.3, 1) });
    }
    return next;
  }
  ```

- [ ] **Step 9: Run the tests and confirm they pass**

  ```
  npx vitest run tests/engine/world/climate.test.ts
  ```

  Expected: PASS — `Test Files  1 passed (1)`, `Tests  12 passed (12)`.

- [ ] **Step 10: Typecheck**

  ```
  npm run typecheck
  ```

  Expected: no output, exit code 0.

- [ ] **Step 11: Commit**

  ```
  git add src/engine/world/climate.ts tests/engine/world/climate.test.ts
  git commit -m "feat(world): resource regrowth and natural events (Task 6)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

### Task 7: Spatial index and movement (`src/engine/world/spatial.ts`)

**Files:**
- Create: `src/engine/world/spatial.ts`
- Test: `tests/engine/world/spatial.test.ts`

**Interfaces:**

Consumes:
- `Person`, `Vec2`, `Tile`, `Terrain`, `dist(a: Vec2, b: Vec2): number` (euclidean) from `src/shared/types.ts` (Task 3)
- `World` (class: `inBounds(x, y)`, `tileAt(x, y)`, constructor `(size, tiles)`) from `src/engine/world/terrain.ts` (Task 5)
- Tests: `createRng(seed: number): Rng` from `src/engine/rng.ts` (Task 2)

Produces:
- `class SpatialIndex` (contract) — `rebuild(people: Person[]): void` (indexes alive people only), `near(pos: Vec2, radius: number): number[]` (ids of indexed people with euclidean distance <= radius, always sorted ascending by id)
- `stepToward(from: Vec2, to: Vec2, world: World): Vec2` (contract + **deviation 1**: required `world` parameter) — one-tile 8-directional move toward `to`; never returns a water or out-of-bounds tile; sidesteps around blockers deterministically; returns a copy of `from` when fully blocked or already at target. Callers pass `ctx.world`.
- `SPATIAL_CELL_SIZE = 8` — grid bucket edge length

Design (concrete): buckets are a `Map<number, {id, x, y}[]>` keyed by `cellX * 65536 + cellY` where `cell = floor(coord / 8)` (coords are 0..191, so keys never collide). `near` scans the cell rectangle covering the query circle, filters by `dist <= radius`, then sorts ids ascending — determinism does not depend on Map iteration order. `stepToward` candidate order: diagonal target direction `(dx,dy)` first, then `(dx,0)`, then `(0,dy)` when both axes differ; for a pure axis move the direct step first, then the two diagonal sidesteps `(+1)` before `(-1)`; the first in-bounds non-water candidate wins.

- [ ] **Step 1: Write the failing SpatialIndex tests**

  Create `tests/engine/world/spatial.test.ts` with exactly:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { createRng } from '../../../src/engine/rng';
  import { dist } from '../../../src/shared/types';
  import type { Person } from '../../../src/shared/types';
  import { SPATIAL_CELL_SIZE, SpatialIndex } from '../../../src/engine/world/spatial';

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
  ```

- [ ] **Step 2: Run the tests and confirm they fail**

  ```
  npx vitest run tests/engine/world/spatial.test.ts
  ```

  Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/world/spatial" from "tests/engine/world/spatial.test.ts". Does the file exist?` (1 failed test file, 0 tests run).

- [ ] **Step 3: Implement SpatialIndex**

  Create `src/engine/world/spatial.ts` with exactly:

  ```ts
  import { dist } from '../../shared/types';
  import type { Person, Vec2 } from '../../shared/types';

  /** Grid bucket edge length in tiles. */
  export const SPATIAL_CELL_SIZE = 8;

  interface SpatialEntry {
    id: number;
    x: number;
    y: number;
  }

  /**
   * Grid-bucket index over alive people. rebuild() is called once per tick
   * (Simulation step 2); near() answers radius queries in ascending-id order
   * so results never depend on Map iteration order.
   */
  export class SpatialIndex {
    private cells = new Map<number, SpatialEntry[]>();

    private static key(cx: number, cy: number): number {
      return cx * 65536 + cy;
    }

    rebuild(people: Person[]): void {
      this.cells.clear();
      for (const p of people) {
        if (!p.alive) continue;
        const cx = Math.floor(p.pos.x / SPATIAL_CELL_SIZE);
        const cy = Math.floor(p.pos.y / SPATIAL_CELL_SIZE);
        const key = SpatialIndex.key(cx, cy);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push({ id: p.id, x: p.pos.x, y: p.pos.y });
      }
    }

    /** Ids of indexed people within euclidean `radius` of `pos`, ascending. */
    near(pos: Vec2, radius: number): number[] {
      const minCx = Math.floor((pos.x - radius) / SPATIAL_CELL_SIZE);
      const maxCx = Math.floor((pos.x + radius) / SPATIAL_CELL_SIZE);
      const minCy = Math.floor((pos.y - radius) / SPATIAL_CELL_SIZE);
      const maxCy = Math.floor((pos.y + radius) / SPATIAL_CELL_SIZE);
      const ids: number[] = [];
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const bucket = this.cells.get(SpatialIndex.key(cx, cy));
          if (!bucket) continue;
          for (const e of bucket) {
            if (dist({ x: e.x, y: e.y }, pos) <= radius) ids.push(e.id);
          }
        }
      }
      ids.sort((a, b) => a - b);
      return ids;
    }
  }
  ```

- [ ] **Step 4: Run the tests and confirm they pass**

  ```
  npx vitest run tests/engine/world/spatial.test.ts
  ```

  Expected: PASS — `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 5: Typecheck and commit the index**

  ```
  npm run typecheck
  ```

  Expected: no output, exit code 0. Then:

  ```
  git add src/engine/world/spatial.ts tests/engine/world/spatial.test.ts
  git commit -m "feat(world): grid-bucket spatial index (Task 7)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

- [ ] **Step 6: Write the failing stepToward tests**

  Replace the entire contents of `tests/engine/world/spatial.test.ts` with:

  ```ts
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
  ```

- [ ] **Step 7: Run the tests and confirm the new ones fail**

  ```
  npx vitest run tests/engine/world/spatial.test.ts
  ```

  Expected: FAIL — `SyntaxError: The requested module '.../src/engine/world/spatial.ts' does not provide an export named 'stepToward'` (module load fails, so the SpatialIndex tests may not run either — that is fine).

- [ ] **Step 8: Implement stepToward**

  Replace the entire contents of `src/engine/world/spatial.ts` with:

  ```ts
  import { dist } from '../../shared/types';
  import type { Person, Vec2 } from '../../shared/types';
  import type { World } from './terrain';

  /** Grid bucket edge length in tiles. */
  export const SPATIAL_CELL_SIZE = 8;

  interface SpatialEntry {
    id: number;
    x: number;
    y: number;
  }

  /**
   * Grid-bucket index over alive people. rebuild() is called once per tick
   * (Simulation step 2); near() answers radius queries in ascending-id order
   * so results never depend on Map iteration order.
   */
  export class SpatialIndex {
    private cells = new Map<number, SpatialEntry[]>();

    private static key(cx: number, cy: number): number {
      return cx * 65536 + cy;
    }

    rebuild(people: Person[]): void {
      this.cells.clear();
      for (const p of people) {
        if (!p.alive) continue;
        const cx = Math.floor(p.pos.x / SPATIAL_CELL_SIZE);
        const cy = Math.floor(p.pos.y / SPATIAL_CELL_SIZE);
        const key = SpatialIndex.key(cx, cy);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push({ id: p.id, x: p.pos.x, y: p.pos.y });
      }
    }

    /** Ids of indexed people within euclidean `radius` of `pos`, ascending. */
    near(pos: Vec2, radius: number): number[] {
      const minCx = Math.floor((pos.x - radius) / SPATIAL_CELL_SIZE);
      const maxCx = Math.floor((pos.x + radius) / SPATIAL_CELL_SIZE);
      const minCy = Math.floor((pos.y - radius) / SPATIAL_CELL_SIZE);
      const maxCy = Math.floor((pos.y + radius) / SPATIAL_CELL_SIZE);
      const ids: number[] = [];
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const bucket = this.cells.get(SpatialIndex.key(cx, cy));
          if (!bucket) continue;
          for (const e of bucket) {
            if (dist({ x: e.x, y: e.y }, pos) <= radius) ids.push(e.id);
          }
        }
      }
      ids.sort((a, b) => a - b);
      return ids;
    }
  }

  /**
   * One-tile 8-directional step from `from` toward `to`. Candidates are tried
   * in a fixed deterministic order: the direct (possibly diagonal) direction
   * first, then sidesteps. Never returns a water or out-of-bounds tile;
   * returns a copy of `from` when fully blocked or already at the target.
   *
   * NOTE (recorded contract deviation): the contract listed
   * stepToward(from, to) but water avoidance requires terrain access, so
   * `world` is a required third parameter. Callers pass ctx.world.
   */
  export function stepToward(from: Vec2, to: Vec2, world: World): Vec2 {
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);
    if (dx === 0 && dy === 0) return { x: from.x, y: from.y };
    let offsets: [number, number][];
    if (dx !== 0 && dy !== 0) {
      offsets = [[dx, dy], [dx, 0], [0, dy]];
    } else if (dx !== 0) {
      offsets = [[dx, 0], [dx, 1], [dx, -1]];
    } else {
      offsets = [[0, dy], [1, dy], [-1, dy]];
    }
    for (const [ox, oy] of offsets) {
      const x = from.x + ox;
      const y = from.y + oy;
      if (world.inBounds(x, y) && world.tileAt(x, y).terrain !== 'water') {
        return { x, y };
      }
    }
    return { x: from.x, y: from.y };
  }
  ```

- [ ] **Step 9: Run the tests and confirm they pass**

  ```
  npx vitest run tests/engine/world/spatial.test.ts
  ```

  Expected: PASS — `Test Files  1 passed (1)`, `Tests  10 passed (10)`.

- [ ] **Step 10: Run the full world test suite together**

  ```
  npx vitest run tests/engine/world
  ```

  Expected: PASS — `Test Files  3 passed (3)`, `Tests  30 passed (30)`.

- [ ] **Step 11: Typecheck**

  ```
  npm run typecheck
  ```

  Expected: no output, exit code 0.

- [ ] **Step 12: Commit**

  ```
  git add src/engine/world/spatial.ts tests/engine/world/spatial.test.ts
  git commit -m "feat(world): water-aware stepToward movement (Task 7)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```
