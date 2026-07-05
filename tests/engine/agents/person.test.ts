import { describe, expect, it } from 'vitest';
import {
  ADULT_MAX_AGE_YEARS,
  ADULT_MIN_AGE_YEARS,
  CIV_PALETTE,
  CHILD_MUTATION_SD,
  INITIAL_SKILL_MAX,
  INITIAL_SKILL_MIN,
  LIFESPAN_MAX_YEARS,
  LIFESPAN_MIN_YEARS,
  MORALITY_MAX,
  MORALITY_MIN,
  TRAIT_MAX,
  TRAIT_MIN,
  createChild,
  createPerson,
  initPopulation,
} from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import { generateWorld, isHabitable } from '../../../src/engine/world/terrain';
import {
  ACTION_KINDS,
  LINEAGES,
  SKILL_NAMES,
  YEAR_TICKS,
  type Lineage,
  type Person,
  type SimConfig,
} from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

describe('createPerson', () => {
  it('creates an adult within the 16-40y window', () => {
    for (let i = 0; i < 40; i++) {
      const p = createPerson(i, 0, 'sonnet', { x: 1, y: 1 }, names, createRng(i));
      expect(p.ageTicks).toBeGreaterThanOrEqual(ADULT_MIN_AGE_YEARS * YEAR_TICKS);
      expect(p.ageTicks).toBeLessThanOrEqual(ADULT_MAX_AGE_YEARS * YEAR_TICKS);
    }
  });

  it('samples traits uniformly in [0.15, 0.85] and morality in [0.2, 0.9]', () => {
    for (let i = 0; i < 60; i++) {
      const p = createPerson(i, 0, 'opus', { x: 0, y: 0 }, names, createRng(i * 7 + 1));
      for (const v of Object.values(p.traits)) {
        expect(v).toBeGreaterThanOrEqual(TRAIT_MIN);
        expect(v).toBeLessThanOrEqual(TRAIT_MAX);
      }
      for (const v of Object.values(p.morality)) {
        expect(v).toBeGreaterThanOrEqual(MORALITY_MIN);
        expect(v).toBeLessThanOrEqual(MORALITY_MAX);
      }
    }
  });

  it('starts needs low and skills in [0.05, 0.3]', () => {
    const p = createPerson(1, 0, 'haiku', { x: 2, y: 2 }, names, createRng(3));
    for (const v of Object.values(p.needs)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(0.3);
    }
    for (const s of SKILL_NAMES) {
      expect(p.skills[s]).toBeGreaterThanOrEqual(INITIAL_SKILL_MIN);
      expect(p.skills[s]).toBeLessThanOrEqual(INITIAL_SKILL_MAX);
    }
  });

  it('samples lifespanTicks gaussian(62,8) years clamped to [40, 90] years', () => {
    const samples: number[] = [];
    for (let i = 0; i < 300; i++) {
      const p = createPerson(i, 0, 'fable', { x: 0, y: 0 }, names, createRng(1000 + i));
      samples.push(p.lifespanTicks);
      expect(p.lifespanTicks).toBeGreaterThanOrEqual(LIFESPAN_MIN_YEARS * YEAR_TICKS);
      expect(p.lifespanTicks).toBeLessThanOrEqual(LIFESPAN_MAX_YEARS * YEAR_TICKS);
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean / YEAR_TICKS).toBeGreaterThan(55);
    expect(mean / YEAR_TICKS).toBeLessThan(69);
  });

  it('initializes actionWeights to 1.0 for every ActionKind', () => {
    const p = createPerson(1, 0, 'opus', { x: 0, y: 0 }, names, createRng(4));
    for (const k of ACTION_KINDS) expect(p.actionWeights[k]).toBe(1);
  });

  it('assigns id, civId, lineage, pos and a non-empty sexed name', () => {
    const p = createPerson(42, 3, 'haiku', { x: 5, y: 6 }, names, createRng(5));
    expect(p.id).toBe(42);
    expect(p.civId).toBe(3);
    expect(p.lineage).toBe('haiku');
    expect(p.pos).toEqual({ x: 5, y: 6 });
    expect(p.alive).toBe(true);
    expect(p.health).toBe(1);
    expect(p.name.length).toBeGreaterThan(0);
    expect(['m', 'f']).toContain(p.sex);
    expect(p.settlementId).toBeNull();
    expect(p.partnerId).toBeNull();
    expect(p.pregnantUntil).toBeNull();
    expect(p.parentIds).toBeNull();
    expect(p.causeOfDeath).toBeNull();
    expect(p.memory).toEqual([]);
    expect(p.relationships).toEqual([]);
    expect(p.beliefIds).toEqual([]);
    expect(p.influence).toBe(0);
  });

  it('is deterministic for a fixed seed', () => {
    // Fresh, identically-seeded name generators per compared call: `names` is
    // shared stateful across the population (required for name diversity),
    // so reusing it here would make a's and b's names differ merely because
    // b's draw comes after a's in the same stream.
    const a = createPerson(1, 0, 'opus', { x: 1, y: 1 }, makeNameGenerator(createRng(9)), createRng(99));
    const b = createPerson(1, 0, 'opus', { x: 1, y: 1 }, makeNameGenerator(createRng(9)), createRng(99));
    expect(a).toEqual(b);
  });
});

describe('createChild', () => {
  function parent(id: number, lineage: Lineage, sex: 'm' | 'f'): Person {
    const p = createPerson(id, 0, lineage, { x: 0, y: 0 }, names, createRng(id + 500));
    p.sex = sex;
    return p;
  }

  it('starts at age 0 with near-zero skills', () => {
    const mother = parent(1, 'opus', 'f');
    const father = parent(2, 'haiku', 'm');
    const child = createChild(3, mother, father, names, createRng(10));
    expect(child.ageTicks).toBe(0);
    for (const s of SKILL_NAMES) {
      expect(child.skills[s]).toBeGreaterThanOrEqual(0);
      expect(child.skills[s]).toBeLessThan(0.05);
    }
    expect(child.alive).toBe(true);
    expect(child.health).toBe(1);
  });

  it('blends parent traits/morality with small mutation, clamped to [0,1]', () => {
    const mother = parent(1, 'opus', 'f');
    const father = parent(2, 'haiku', 'm');
    mother.traits.curiosity = 0.9;
    father.traits.curiosity = 0.9;
    const child = createChild(3, mother, father, names, createRng(11));
    // avg is 0.9; mutation sd 0.05 rarely pushes far; must stay in [0,1]
    expect(child.traits.curiosity).toBeGreaterThanOrEqual(0);
    expect(child.traits.curiosity).toBeLessThanOrEqual(1);
    for (const v of Object.values(child.morality)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('averages trait values across many seeds close to the parent average', () => {
    const mother = parent(1, 'opus', 'f');
    const father = parent(2, 'haiku', 'm');
    mother.traits.empathy = 0.2;
    father.traits.empathy = 0.8;
    const expectedAvg = 0.5;
    let sum = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const child = createChild(3, mother, father, names, createRng(2000 + i));
      sum += child.traits.empathy;
    }
    expect(sum / n).toBeGreaterThan(expectedAvg - 0.02);
    expect(sum / n).toBeLessThan(expectedAvg + 0.02);
  });

  it("lineage is one of the two parents' lineages", () => {
    const mother = parent(1, 'opus', 'f');
    const father = parent(2, 'haiku', 'm');
    const seen = new Set<Lineage>();
    for (let i = 0; i < 60; i++) {
      const child = createChild(3, mother, father, names, createRng(3000 + i));
      seen.add(child.lineage);
      expect(['opus', 'haiku']).toContain(child.lineage);
    }
    expect(seen.size).toBe(2); // both lineages appear across enough draws
  });

  it('sets parentIds to [mother.id, father.id] and civId from the mother', () => {
    const mother = parent(1, 'opus', 'f');
    mother.civId = 7;
    const father = parent(2, 'haiku', 'm');
    father.civId = 7;
    const child = createChild(3, mother, father, names, createRng(12));
    expect(child.parentIds).toEqual([1, 2]);
    expect(child.civId).toBe(7);
    expect(child.pos).toEqual(mother.pos);
  });

  it('is deterministic for a fixed seed', () => {
    const mother = parent(1, 'opus', 'f');
    const father = parent(2, 'haiku', 'm');
    // Fresh, identically-seeded name generators per compared call — see the
    // comment on createPerson's determinism test above.
    const a = createChild(3, mother, father, makeNameGenerator(createRng(9)), createRng(55));
    const b = createChild(3, mother, father, makeNameGenerator(createRng(9)), createRng(55));
    expect(a).toEqual(b);
  });
});

describe('initPopulation', () => {
  const world = generateWorld(96, createRng(21));

  it('mode civs: creates exactly 4 civs, one per LINEAGES entry, with the contract palette', () => {
    const config: SimConfig = { seed: 1, mode: 'civs', mapSize: 'medium', startPopulation: 200 };
    const rng = createRng(config.seed);
    const { people, civs } = initPopulation(config, world, names, rng);
    expect(civs).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(civs[i]?.color).toBe(CIV_PALETTE[i]);
    }
    expect(people).toHaveLength(200);
    const lineageOfCiv = new Map<number, Lineage>();
    for (const p of people) {
      const existing = lineageOfCiv.get(p.civId);
      if (existing === undefined) lineageOfCiv.set(p.civId, p.lineage);
      else expect(p.lineage).toBe(existing);
    }
    expect(lineageOfCiv.size).toBe(4);
    expect(new Set(lineageOfCiv.values())).toEqual(new Set(LINEAGES));
  });

  it('mode civs: spawns each civ on habitable land, scattered within radius 6 of a centroid', () => {
    const config: SimConfig = { seed: 2, mode: 'civs', mapSize: 'medium', startPopulation: 200 };
    const { people } = initPopulation(config, world, names, createRng(config.seed));
    for (const p of people) {
      expect(isHabitable(world.tileAt(p.pos.x, p.pos.y).terrain)).toBe(true);
    }
    const byCiv = new Map<number, Person[]>();
    for (const p of people) {
      const arr = byCiv.get(p.civId) ?? [];
      arr.push(p);
      byCiv.set(p.civId, arr);
    }
    for (const members of byCiv.values()) {
      const cx = members.reduce((s, p) => s + p.pos.x, 0) / members.length;
      const cy = members.reduce((s, p) => s + p.pos.y, 0) / members.length;
      for (const p of members) {
        const d = Math.hypot(p.pos.x - cx, p.pos.y - cy);
        expect(d).toBeLessThanOrEqual(6 + 3); // scatter radius plus centroid drift tolerance
      }
    }
  });

  it('mode mixed: creates exactly 1 civ with lineages round-robin across the population', () => {
    const config: SimConfig = { seed: 3, mode: 'mixed', mapSize: 'medium', startPopulation: 400 };
    const { people, civs } = initPopulation(config, world, names, createRng(config.seed));
    expect(civs).toHaveLength(1);
    expect(civs[0]?.id).toBe(0);
    for (const p of people) expect(p.civId).toBe(0);
    const counts: Record<Lineage, number> = { opus: 0, sonnet: 0, haiku: 0, fable: 0 };
    for (const p of people) counts[p.lineage] += 1;
    for (const lineage of LINEAGES) expect(counts[lineage]).toBe(100); // 400 / 4 round-robin
  });

  it('assigns unique sequential ids starting at 0', () => {
    const config: SimConfig = { seed: 4, mode: 'civs', mapSize: 'small', startPopulation: 200 };
    const { people } = initPopulation(config, world, names, createRng(config.seed));
    const ids = people.map((p) => p.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });

  it('is deterministic for a fixed seed', () => {
    const config: SimConfig = { seed: 77, mode: 'civs', mapSize: 'medium', startPopulation: 200 };
    // Fresh, identically-seeded name generators per compared call — with the
    // shared stateful `names` above, the two calls would draw from different
    // points in the same name stream and never produce equal `name` fields.
    const a = initPopulation(config, world, makeNameGenerator(createRng(9)), createRng(config.seed));
    const b = initPopulation(config, world, makeNameGenerator(createRng(9)), createRng(config.seed));
    expect(a.people).toEqual(b.people);
    expect(a.civs).toEqual(b.civs);
  });

  it('gives same-sex people distinct names across a mixed population (guards name-collision bug)', () => {
    const config: SimConfig = { seed: 5, mode: 'mixed', mapSize: 'medium', startPopulation: 200 };
    const { people } = initPopulation(config, world, names, createRng(config.seed));
    const maleNames = new Set(people.filter((p) => p.sex === 'm').map((p) => p.name));
    const femaleNames = new Set(people.filter((p) => p.sex === 'f').map((p) => p.name));
    expect(maleNames.size).toBeGreaterThanOrEqual(10);
    expect(femaleNames.size).toBeGreaterThanOrEqual(10);
  });
});
