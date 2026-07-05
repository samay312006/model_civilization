import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/engine/rng';
import { makeNameGenerator, MALE_ENDINGS, FEMALE_ENDINGS } from '../../src/engine/names';
import type { NameGen } from '../../src/engine/names';

function sample(gen: NameGen, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(gen.person('m'), gen.person('f'), gen.place(), gen.civ(), gen.religion());
  }
  return out;
}

describe('makeNameGenerator', () => {
  it('is deterministic per seed across all name kinds', () => {
    const a = makeNameGenerator(createRng(2026));
    const b = makeNameGenerator(createRng(2026));
    expect(sample(a, 40)).toEqual(sample(b, 40));
  });

  it('different seeds give different name sequences', () => {
    const a = makeNameGenerator(createRng(1));
    const b = makeNameGenerator(createRng(2));
    expect(sample(a, 20)).not.toEqual(sample(b, 20));
  });

  it('every name is a non-empty capitalized word', () => {
    const gen = makeNameGenerator(createRng(7));
    for (const name of sample(gen, 40)) {
      expect(name.length).toBeGreaterThan(0);
      expect(name).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it('every name is between 3 and 12 characters', () => {
    const gen = makeNameGenerator(createRng(8));
    for (const name of sample(gen, 40)) {
      expect(name.length).toBeGreaterThanOrEqual(3);
      expect(name.length).toBeLessThanOrEqual(12);
    }
  });

  it('female names use only female endings', () => {
    const gen = makeNameGenerator(createRng(9));
    for (let i = 0; i < 200; i++) {
      const name = gen.person('f').toLowerCase();
      expect(FEMALE_ENDINGS.some((e) => name.endsWith(e))).toBe(true);
      expect(MALE_ENDINGS.some((e) => name.endsWith(e))).toBe(false);
    }
  });

  it('male names use only male endings', () => {
    const gen = makeNameGenerator(createRng(10));
    for (let i = 0; i < 200; i++) {
      const name = gen.person('m').toLowerCase();
      expect(MALE_ENDINGS.some((e) => name.endsWith(e))).toBe(true);
      expect(FEMALE_ENDINGS.some((e) => name.endsWith(e))).toBe(false);
    }
  });

  it('male and female ending pools are disjoint', () => {
    for (const e of MALE_ENDINGS) expect(FEMALE_ENDINGS).not.toContain(e);
  });

  it('produces varied names, not one repeated name', () => {
    const gen = makeNameGenerator(createRng(11));
    const males = new Set<string>();
    for (let i = 0; i < 100; i++) males.add(gen.person('m'));
    expect(males.size).toBeGreaterThanOrEqual(10);
  });
});
