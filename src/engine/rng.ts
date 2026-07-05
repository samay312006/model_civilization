// Seeded, splittable random number generator.
// mulberry32 core; split() derives independent child streams by FNV-1a
// hashing the creation seed together with a string label.
//
// Contract (docs/superpowers/plans/2026-07-04-genesis-contract.md):
// all engine randomness flows through this module; same seed + same
// labels = same streams. Math.random is forbidden in src/engine and
// src/shared.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). Returns 0 if maxExclusive <= 0. */
  int(maxExclusive: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform element of arr. Throws if arr is empty. */
  pick<T>(arr: readonly T[]): T;
  /** True with probability p (p <= 0: never; p >= 1: always). */
  chance(p: number): boolean;
  /** Normal sample via Box-Muller; consumes exactly two uniform draws. */
  gaussian(mean: number, sd: number): number;
  /**
   * Independent deterministic stream derived from (creation seed, label).
   * Pure in the creation seed: the same label always returns the identical
   * stream, and draws taken from this rng never affect child streams.
   * Vary the label (e.g. include a tick number) when a fresh stream is
   * needed per use.
   */
  split(label: string): Rng;
}

/** FNV-1a 32-bit hash over UTF-16 code units (labels are ASCII in practice). */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  const baseSeed = seed >>> 0; // wrap to uint32; fractional part discarded
  let state = baseSeed;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return Math.floor(next() * maxExclusive);
  }

  function range(min: number, max: number): number {
    return min + next() * (max - min);
  }

  function pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick called with an empty array');
    return arr[int(arr.length)];
  }

  function chance(p: number): boolean {
    return next() < p;
  }

  function gaussian(mean: number, sd: number): number {
    const u1 = 1 - next(); // in (0, 1] so Math.log never sees 0
    const u2 = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function split(label: string): Rng {
    return createRng(fnv1a(`${baseSeed}:${label}`));
  }

  return { next, int, range, pick, chance, gaussian, split };
}
