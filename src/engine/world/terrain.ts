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
