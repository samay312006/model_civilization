import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/engine/rng';
import type { Rng } from '../../src/engine/rng';

function draws(rng: Rng, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.next());
  return out;
}

function mean(xs: number[]): number {
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function stdDev(xs: number[]): number {
  const m = mean(xs);
  let sum = 0;
  for (const x of xs) sum += (x - m) * (x - m);
  return Math.sqrt(sum / xs.length);
}

describe('determinism', () => {
  it('same seed produces an identical 1000-draw sequence', () => {
    expect(draws(createRng(123), 1000)).toEqual(draws(createRng(123), 1000));
  });

  it('different seeds produce different sequences', () => {
    expect(draws(createRng(1), 50)).not.toEqual(draws(createRng(2), 50));
  });

  it('seed 0, negative, and fractional seeds are deterministic', () => {
    expect(draws(createRng(0), 10)).toEqual(draws(createRng(0), 10));
    expect(draws(createRng(-42), 10)).toEqual(draws(createRng(-42), 10));
    expect(draws(createRng(7.9), 10)).toEqual(draws(createRng(7.9), 10));
  });
});

describe('split', () => {
  it('different labels give independent streams', () => {
    const rng = createRng(777);
    expect(draws(rng.split('alpha'), 100)).not.toEqual(draws(rng.split('beta'), 100));
  });

  it('same seed + same label = same stream, across instances', () => {
    expect(draws(createRng(9).split('world'), 100)).toEqual(draws(createRng(9).split('world'), 100));
  });

  it('child streams are unaffected by draws taken from the parent', () => {
    const drained = createRng(7);
    const fresh = createRng(7);
    draws(drained, 250);
    expect(draws(drained.split('agents'), 100)).toEqual(draws(fresh.split('agents'), 100));
  });

  it('nested splits are deterministic and order-sensitive', () => {
    expect(draws(createRng(3).split('a').split('b'), 50)).toEqual(draws(createRng(3).split('a').split('b'), 50));
    expect(draws(createRng(3).split('a').split('b'), 50)).not.toEqual(draws(createRng(3).split('b').split('a'), 50));
  });

  it('split streams differ from the parent stream', () => {
    expect(draws(createRng(555).split('x'), 100)).not.toEqual(draws(createRng(555), 100));
  });
});

describe('distribution sanity', () => {
  it('next() stays in [0, 1)', () => {
    const xs = draws(createRng(2024), 10000);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });

  it('mean of 10000 draws is near 0.5', () => {
    const m = mean(draws(createRng(2025), 10000));
    expect(m).toBeGreaterThan(0.45);
    expect(m).toBeLessThan(0.55);
  });

  it('all ten deciles are roughly evenly filled', () => {
    const counts = new Array<number>(10).fill(0);
    const rng = createRng(2026);
    for (let i = 0; i < 10000; i++) counts[Math.floor(rng.next() * 10)]++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(700);
      expect(c).toBeLessThan(1300);
    }
  });
});

describe('gaussian', () => {
  it('gaussian(0, 1): sample mean ~0 and sd ~1', () => {
    const rng = createRng(31337);
    const xs: number[] = [];
    for (let i = 0; i < 10000; i++) xs.push(rng.gaussian(0, 1));
    expect(Math.abs(mean(xs))).toBeLessThan(0.05);
    expect(stdDev(xs)).toBeGreaterThan(0.95);
    expect(stdDev(xs)).toBeLessThan(1.05);
  });

  it('gaussian(10, 3): sample mean ~10 and sd ~3', () => {
    const rng = createRng(90210);
    const xs: number[] = [];
    for (let i = 0; i < 10000; i++) xs.push(rng.gaussian(10, 3));
    expect(mean(xs)).toBeGreaterThan(9.85);
    expect(mean(xs)).toBeLessThan(10.15);
    expect(stdDev(xs)).toBeGreaterThan(2.85);
    expect(stdDev(xs)).toBeLessThan(3.15);
  });

  it('gaussian output is always finite', () => {
    const rng = createRng(1);
    for (let i = 0; i < 10000; i++) expect(Number.isFinite(rng.gaussian(5, 2))).toBe(true);
  });
});

describe('bounds of int / range / pick / chance', () => {
  it('int(n) returns integers in [0, n)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
    expect(createRng(5).int(1)).toBe(0);
  });

  it('int of zero or negative bounds returns 0', () => {
    const rng = createRng(42);
    expect(rng.int(0)).toBe(0);
    expect(rng.int(-3)).toBe(0);
  });

  it('range(min, max) stays within [min, max)', () => {
    const rng = createRng(77);
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(-3, 7);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(7);
    }
  });

  it('pick returns only elements of the array and covers all of them', () => {
    const rng = createRng(99);
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const v = rng.pick(items);
      expect(items).toContain(v);
      seen.add(v);
    }
    expect(seen.size).toBe(3);
  });

  it('pick throws on an empty array', () => {
    expect(() => createRng(1).pick([])).toThrow();
  });

  it('chance(0) is never true, chance(1) is always true, chance(0.5) is balanced', () => {
    const rng = createRng(64);
    for (let i = 0; i < 200; i++) expect(rng.chance(0)).toBe(false);
    for (let i = 0; i < 200; i++) expect(rng.chance(1)).toBe(true);
    let hits = 0;
    for (let i = 0; i < 1000; i++) if (rng.chance(0.5)) hits++;
    expect(hits).toBeGreaterThan(400);
    expect(hits).toBeLessThan(600);
  });
});
