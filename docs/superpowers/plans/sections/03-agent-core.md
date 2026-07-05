## Section 3: Agent core (Tasks 8-16)

This section builds the per-person building blocks the rest of the engine assembles: the `Person` factory and population seeding (Task 8), needs decay (Task 9), emotion impulses/decay (Task 10), the moral-foundations gate (Task 11), episodic memory (Task 12), relationships (Task 13), the action catalog and legality/candidate generation (Task 14), full action execution with rewards (Task 15), and the perception builder (Task 16). Every task depends only on Tasks 1-7 (scaffold, rng, shared types, names, terrain, climate, spatial) plus earlier tasks within this section. `EngineCtx` does not exist until Task 33, so Tasks 14-16 each declare their own minimal local structural interface (`ActionsCtxLike`, `ExecuteCtxLike`, `PerceptionCtxLike`) naming only the fields that file reads; `technology.ts` (Task 29) does not exist yet either, so Task 15 depends on it only through the same structural `ctx.tech` shape, with a stub used in its own tests. All randomness flows through the passed `Rng`; no `Math.random`, no `Date.now`, no DOM. Every command below runs from the repo root `C:\simulation_exp`.

**Contract deviations in this section (recorded, deliberate):**

1. **`EngineCtx` does not exist until Task 33.** Tasks 14, 15, and 16 each declare their own minimal structural interface — `ActionsCtxLike` (Task 14), `ExecuteCtxLike` (Task 15), `PerceptionCtxLike` (Task 16) — naming only the fields that file reads. Every one of these interfaces is a structural subset of the eventual Task 33 `EngineCtx`, so `EngineCtx` satisfies all three without adaptation and Task 33 passes its single `ctx` object to every call site unchanged.
2. **`technology.ts` (Task 29) does not exist yet.** `execute.ts` (Task 15) needs `techYieldMultiplier` and `addKnowledge` for the `farm`/`gather`/`craft` effects. It accesses them through a structural field on its ctx-like interface: `ctx.tech: { yieldMultiplier(civ: Civ, action: ActionKind): number; addKnowledge(civ: Civ, domain: TechId, points: number): void }`. Task 15's own tests inject a stub (`yieldMultiplier` returns `1`, `addKnowledge` a no-op). Task 33 wires the real Task 29 functions as `ctx.tech = { yieldMultiplier: techYieldMultiplier, addKnowledge }`.
3. **`moralGate`'s third parameter is a local structural type, not the Task 20 `Temperament`.** `src/engine/brains/types.ts` does not exist until Task 20. `morality.ts` (Task 11) declares `export interface MoralityTemperament { moralWeight: number; desperationThreshold: number }` — the two fields `moralGate` actually reads — and types its parameter as that. The full Task 20 `Temperament` is structurally assignable to `MoralityTemperament` (it is a superset), so every real brain's `temperament()` return value works unchanged at every call site (Task 19 `decide.ts`, Task 15 `execute.ts`, Task 33).
4. **`legalActions`, `executeAction`, and `buildPerception` take their ctx-like interfaces instead of `EngineCtx`** per deviation 1 above — this is the same pattern Section 2 used for `stepToward` and Section 4 used for `LifecycleCtx`/`LearningCtx`. Each file's Interfaces block states the exact fields.
5. **`executeAction`'s emotion impulses use the acting person's lineage temperament, injected as a parameter, not looked up from a registry.** The contract says "applyEmotionImpulse using the ACTING person's brain temperament volatility (pass Temperament in via ctx registry lookup)," but the brain registry is Task 20 and `execute.ts` is Task 15 — importing it would create a dependency cycle once brains consume agent modules (the sandboxed brain files import from `src/engine/agents/perception.ts`). `executeAction` therefore takes a fourth parameter `emotionVolatility: Emotions` (the acting person's `temperament().emotionVolatility`); Task 33 calls `executeAction(p, action, ctx, getBrain(p.lineage).temperament().emotionVolatility)`.

### Task 8: Person factory and population init (`src/engine/agents/person.ts`)

**Files:**
- Create: `src/engine/agents/person.ts`
- Test: `tests/engine/agents/person.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Civ`, `Traits`, `Morality`, `Needs`, `Skills`, `SKILL_NAMES`, `ACTION_KINDS`, `Lineage`, `LINEAGES`, `SimConfig`, `Vec2`, `YEAR_TICKS = 360`, `clamp(v, lo, hi): number`, `clamp01(v): number`, `dist(a, b): number`
- From `src/engine/rng.ts` (Task 2): `Rng` (`next(): number; int(maxExclusive: number): number; range(min: number, max: number): number; pick<T>(arr: readonly T[]): T; chance(p: number): boolean; gaussian(mean: number, sd: number): number; split(label: string): Rng`); tests also use `createRng(seed: number): Rng`
- From `src/engine/names.ts` (Task 4): `NameGen { person(sex): string; place(): string; civ(): string; religion(): string }`; tests also use `makeNameGenerator(rng: Rng): NameGen`
- From `src/engine/world/terrain.ts` (Task 5): `World`, `isHabitable(terrain: Terrain): boolean`; tests also use `generateWorld(size, rng): World`

Produces:
- `export function createPerson(id: number, civId: number, lineage: Lineage, pos: Vec2, names: NameGen, rng: Rng): Person` — contract signature verbatim. Adult, `brainState` left as `{}` placeholder (registry init is Task 20/33's job, per the contract comment "brainState set later by registry init").
- `export function createChild(id: number, mother: Person, father: Person, names: NameGen, rng: Rng): Person` — contract signature verbatim.
- `export function initPopulation(config: SimConfig, world: World, names: NameGen, rng: Rng): { people: Person[]; civs: Civ[] }` — contract signature verbatim.
- Exported tuning constants: `ADULT_MIN_AGE_YEARS = 16`, `ADULT_MAX_AGE_YEARS = 40`, `TRAIT_MIN = 0.15`, `TRAIT_MAX = 0.85`, `MORALITY_MIN = 0.2`, `MORALITY_MAX = 0.9`, `INITIAL_NEEDS_LEVEL = 0.15`, `INITIAL_SKILL_MIN = 0.05`, `INITIAL_SKILL_MAX = 0.3`, `LIFESPAN_MEAN_YEARS = 62`, `LIFESPAN_SD_YEARS = 8`, `LIFESPAN_MIN_YEARS = 40`, `LIFESPAN_MAX_YEARS = 90`, `CHILD_MUTATION_SD = 0.05`, `CHILD_SKILL_MAX = 0.02`, `SCATTER_RADIUS = 6`, `CIV_PALETTE: readonly string[] = ['#e4572e', '#3d9be9', '#76b041', '#b76ce9']` (index-aligned with `LINEAGES`, matching the contract's UI palette), `CIV_NAMES: readonly string[] = ['Opus Dominion', 'Sonnet Commonwealth', 'Haiku Enclave', 'Fable Wandering']` (mode `'civs'` names, index-aligned with `LINEAGES`; mode `'mixed'` uses `names.civ()`).
- `export function initialInventory(): Inventory` — `{ food: 0, wood: 0, stone: 0, metal: 0, tools: 0 }`; a fresh object per call, reused by both factories and by Task 33 test fixtures.

Wiring notes for Task 33 (binding):
- Task 33 constructs the `Simulation` by calling `initPopulation(config, world, names, rng)`, then for every returned person calls `person.brainState = getBrain(person.lineage).init(person, rng)` before the first tick — `createPerson`/`createChild`/`initPopulation` never call the brain registry themselves (Task 20 does not exist at Task 8).

- [ ] **Step 1: Write the failing person tests**

Create `tests/engine/agents/person.test.ts` with exactly:

```ts
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
    const a = createPerson(1, 0, 'opus', { x: 1, y: 1 }, names, createRng(99));
    const b = createPerson(1, 0, 'opus', { x: 1, y: 1 }, names, createRng(99));
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
    const a = createChild(3, mother, father, names, createRng(55));
    const b = createChild(3, mother, father, names, createRng(55));
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
    const a = initPopulation(config, world, names, createRng(config.seed));
    const b = initPopulation(config, world, names, createRng(config.seed));
    expect(a.people).toEqual(b.people);
    expect(a.civs).toEqual(b.civs);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/agents/person.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/agents/person" from "tests/engine/agents/person.test.ts". Does the file exist?` (`src/engine/agents/person.ts` does not exist yet).

- [ ] **Step 3: Implement `src/engine/agents/person.ts`**

Create `src/engine/agents/person.ts` with exactly:

```ts
import {
  ACTION_KINDS,
  LINEAGES,
  SKILL_NAMES,
  YEAR_TICKS,
  clamp,
  clamp01,
  type ActionKind,
  type Civ,
  type Inventory,
  type Lineage,
  type Morality,
  type Person,
  type SimConfig,
  type Skills,
  type Traits,
  type Vec2,
} from '../../shared/types';
import type { Rng } from '../rng';
import type { NameGen } from '../names';
import { isHabitable, type World } from '../world/terrain';

export const ADULT_MIN_AGE_YEARS = 16;
export const ADULT_MAX_AGE_YEARS = 40;
export const TRAIT_MIN = 0.15;
export const TRAIT_MAX = 0.85;
export const MORALITY_MIN = 0.2;
export const MORALITY_MAX = 0.9;
export const INITIAL_NEEDS_LEVEL = 0.15; // uniform ceiling for freshly-created adults' needs
export const INITIAL_SKILL_MIN = 0.05;
export const INITIAL_SKILL_MAX = 0.3;
export const LIFESPAN_MEAN_YEARS = 62;
export const LIFESPAN_SD_YEARS = 8;
export const LIFESPAN_MIN_YEARS = 40;
export const LIFESPAN_MAX_YEARS = 90;
export const CHILD_MUTATION_SD = 0.05;
export const CHILD_SKILL_MAX = 0.02; // children start with a faint skill trace, not zero
export const SCATTER_RADIUS = 6;

/** UI palette + names for mode 'civs' (contract, index-aligned with LINEAGES). */
export const CIV_PALETTE: readonly string[] = ['#e4572e', '#3d9be9', '#76b041', '#b76ce9'];
export const CIV_NAMES: readonly string[] = [
  'Opus Dominion',
  'Sonnet Commonwealth',
  'Haiku Enclave',
  'Fable Wandering',
];

/** A fresh empty inventory. Always returns a new object (never shared). */
export function initialInventory(): Inventory {
  return { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 };
}

function sampleTraits(rng: Rng): Traits {
  return {
    curiosity: rng.range(TRAIT_MIN, TRAIT_MAX),
    aggression: rng.range(TRAIT_MIN, TRAIT_MAX),
    empathy: rng.range(TRAIT_MIN, TRAIT_MAX),
    industriousness: rng.range(TRAIT_MIN, TRAIT_MAX),
    riskTolerance: rng.range(TRAIT_MIN, TRAIT_MAX),
  };
}

function sampleMorality(rng: Rng): Morality {
  return {
    care: rng.range(MORALITY_MIN, MORALITY_MAX),
    fairness: rng.range(MORALITY_MIN, MORALITY_MAX),
    loyalty: rng.range(MORALITY_MIN, MORALITY_MAX),
    authority: rng.range(MORALITY_MIN, MORALITY_MAX),
    sanctity: rng.range(MORALITY_MIN, MORALITY_MAX),
    liberty: rng.range(MORALITY_MIN, MORALITY_MAX),
  };
}

function sampleAdultSkills(rng: Rng): Skills {
  const skills = {} as Skills;
  for (const s of SKILL_NAMES) skills[s] = rng.range(INITIAL_SKILL_MIN, INITIAL_SKILL_MAX);
  return skills;
}

function sampleChildSkills(rng: Rng): Skills {
  const skills = {} as Skills;
  for (const s of SKILL_NAMES) skills[s] = rng.range(0, CHILD_SKILL_MAX);
  return skills;
}

function sampleLifespanTicks(rng: Rng): number {
  const years = clamp(
    rng.gaussian(LIFESPAN_MEAN_YEARS, LIFESPAN_SD_YEARS),
    LIFESPAN_MIN_YEARS,
    LIFESPAN_MAX_YEARS,
  );
  return Math.round(years * YEAR_TICKS);
}

function freshActionWeights(): Record<ActionKind, number> {
  const weights = {} as Record<ActionKind, number>;
  for (const k of ACTION_KINDS) weights[k] = 1.0;
  return weights;
}

/**
 * Contract factory: an adult person (16-40y), traits/morality sampled
 * uniformly, needs low, skills faint, action weights all 1.0, a name from
 * the seeded generator. brainState is left as {} — Task 20/33's registry
 * assigns the real per-lineage initial state after creation.
 */
export function createPerson(
  id: number,
  civId: number,
  lineage: Lineage,
  pos: Vec2,
  names: NameGen,
  rng: Rng,
): Person {
  const sex: 'm' | 'f' = rng.chance(0.5) ? 'm' : 'f';
  const ageYears = rng.range(ADULT_MIN_AGE_YEARS, ADULT_MAX_AGE_YEARS);
  return {
    id,
    alive: true,
    ageTicks: Math.round(ageYears * YEAR_TICKS),
    sex,
    name: names.person(sex),
    pos: { x: pos.x, y: pos.y },
    civId,
    settlementId: null,
    lineage,
    traits: sampleTraits(rng),
    emotions: { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0.1 },
    morality: sampleMorality(rng),
    needs: {
      hunger: rng.range(0, INITIAL_NEEDS_LEVEL),
      safety: rng.range(0, INITIAL_NEEDS_LEVEL),
      rest: rng.range(0, INITIAL_NEEDS_LEVEL),
      belonging: rng.range(0, INITIAL_NEEDS_LEVEL),
      esteem: rng.range(0, INITIAL_NEEDS_LEVEL),
    },
    skills: sampleAdultSkills(rng),
    health: 1,
    lifespanTicks: sampleLifespanTicks(rng),
    memory: [],
    relationships: [],
    inventory: initialInventory(),
    actionWeights: freshActionWeights(),
    brainState: {},
    influence: 0,
    beliefIds: [],
    partnerId: null,
    pregnantUntil: null,
    parentIds: null,
    causeOfDeath: null,
  };
}

function blendTrait(rng: Rng, a: number, b: number): number {
  const avg = (a + b) / 2;
  return clamp01(avg + rng.gaussian(0, CHILD_MUTATION_SD));
}

/**
 * Contract factory: blend of parents' traits/morality (average + gaussian
 * mutation sd 0.05, clamped 0..1), lineage = rng.pick of the two parents'
 * lineages, age 0, skills near 0 (uniform 0..CHILD_SKILL_MAX). Spawns at the
 * mother's position and civ.
 */
export function createChild(id: number, mother: Person, father: Person, names: NameGen, rng: Rng): Person {
  const traits: Traits = {
    curiosity: blendTrait(rng, mother.traits.curiosity, father.traits.curiosity),
    aggression: blendTrait(rng, mother.traits.aggression, father.traits.aggression),
    empathy: blendTrait(rng, mother.traits.empathy, father.traits.empathy),
    industriousness: blendTrait(rng, mother.traits.industriousness, father.traits.industriousness),
    riskTolerance: blendTrait(rng, mother.traits.riskTolerance, father.traits.riskTolerance),
  };
  const morality: Morality = {
    care: blendTrait(rng, mother.morality.care, father.morality.care),
    fairness: blendTrait(rng, mother.morality.fairness, father.morality.fairness),
    loyalty: blendTrait(rng, mother.morality.loyalty, father.morality.loyalty),
    authority: blendTrait(rng, mother.morality.authority, father.morality.authority),
    sanctity: blendTrait(rng, mother.morality.sanctity, father.morality.sanctity),
    liberty: blendTrait(rng, mother.morality.liberty, father.morality.liberty),
  };
  const lineage = rng.pick([mother.lineage, father.lineage]);
  const sex: 'm' | 'f' = rng.chance(0.5) ? 'm' : 'f';

  return {
    id,
    alive: true,
    ageTicks: 0,
    sex,
    name: names.person(sex),
    pos: { x: mother.pos.x, y: mother.pos.y },
    civId: mother.civId,
    settlementId: mother.settlementId,
    lineage,
    traits,
    emotions: { fear: 0, joy: 0.2, grief: 0, anger: 0, hope: 0.2 },
    morality,
    needs: { hunger: 0, safety: 0, rest: 0, belonging: 0, esteem: 0 },
    skills: sampleChildSkills(rng),
    health: 1,
    lifespanTicks: sampleLifespanTicks(rng),
    memory: [],
    relationships: [],
    inventory: initialInventory(),
    actionWeights: freshActionWeights(),
    brainState: {},
    influence: 0,
    beliefIds: [],
    partnerId: null,
    pregnantUntil: null,
    parentIds: [mother.id, father.id],
    causeOfDeath: null,
  };
}

/** Euclidean distance without importing shared/types' dist (keeps this file's helper local and inlineable). */
function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Every habitable (plains/forest) tile coordinate in the world. */
function habitableTiles(world: World): Vec2[] {
  const out: Vec2[] = [];
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      if (isHabitable(world.tileAt(x, y).terrain)) out.push({ x, y });
    }
  }
  return out;
}

/**
 * Picks `count` habitable centroids that are as mutually separated as
 * possible: greedily seed with a random habitable tile, then repeatedly add
 * the habitable tile that maximizes the minimum distance to all already-
 * chosen centroids (a standard farthest-point sampling heuristic).
 */
function pickSeparatedCentroids(world: World, count: number, rng: Rng): Vec2[] {
  const pool = habitableTiles(world);
  if (pool.length === 0) throw new Error('initPopulation: world has no habitable tiles');
  const chosen: Vec2[] = [rng.pick(pool)];
  while (chosen.length < count) {
    let best: Vec2 = pool[0] as Vec2;
    let bestMinDist = -1;
    for (const candidate of pool) {
      let minDist = Infinity;
      for (const c of chosen) {
        const d = distance(candidate, c);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        best = candidate;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

/** A habitable tile within `radius` of `center`, scanning outward rings; falls back to `center`. */
function nearestHabitableWithin(world: World, center: Vec2, radius: number, rng: Rng): Vec2 {
  const candidates: Vec2[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (!world.inBounds(x, y)) continue;
      if (Math.hypot(dx, dy) > radius) continue;
      if (isHabitable(world.tileAt(x, y).terrain)) candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return { x: center.x, y: center.y };
  return rng.pick(candidates);
}

function freshCiv(id: number, name: string, color: string): Civ {
  return {
    id,
    name,
    color,
    knowledge: { fire: 0, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
    techs: [],
    atWarWith: [],
    warWeariness: 0,
  };
}

/**
 * Contract factory. Mode 'civs': 4 civilizations, one per LINEAGES entry, in
 * the contract UI palette order, spawned around the 4 most mutually
 * separated habitable centroids on the map; each civ's people scatter within
 * SCATTER_RADIUS tiles of its centroid (re-picking the nearest habitable
 * tile per person so nobody lands in water). Mode 'mixed': a single civ,
 * lineages assigned round-robin across the population in LINEAGES order,
 * everyone scattered around one centroid.
 */
export function initPopulation(
  config: SimConfig,
  world: World,
  names: NameGen,
  rng: Rng,
): { people: Person[]; civs: Civ[] } {
  const people: Person[] = [];
  let nextId = 0;

  if (config.mode === 'civs') {
    const civs: Civ[] = LINEAGES.map((lineage, i) =>
      freshCiv(i, CIV_NAMES[i] as string, CIV_PALETTE[i] as string),
    );
    const centroids = pickSeparatedCentroids(world, LINEAGES.length, rng.split('spawn-regions'));
    const perCiv = Math.floor(config.startPopulation / LINEAGES.length);
    const remainder = config.startPopulation - perCiv * LINEAGES.length;

    for (let civIdx = 0; civIdx < LINEAGES.length; civIdx++) {
      const lineage = LINEAGES[civIdx] as Lineage;
      const centroid = centroids[civIdx] as Vec2;
      const count = perCiv + (civIdx < remainder ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const pos = nearestHabitableWithin(world, centroid, SCATTER_RADIUS, rng);
        people.push(createPerson(nextId, civIdx, lineage, pos, names, rng));
        nextId += 1;
      }
    }
    return { people, civs };
  }

  // mode 'mixed': one civ, lineages round-robin.
  const civ = freshCiv(0, names.civ(), CIV_PALETTE[0] as string);
  const centroid = pickSeparatedCentroids(world, 1, rng.split('spawn-regions'))[0] as Vec2;
  for (let i = 0; i < config.startPopulation; i++) {
    const lineage = LINEAGES[i % LINEAGES.length] as Lineage;
    const pos = nearestHabitableWithin(world, centroid, SCATTER_RADIUS, rng);
    people.push(createPerson(nextId, 0, lineage, pos, names, rng));
    nextId += 1;
  }
  return { people, civs: [civ] };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/agents/person.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/agents/person.test.ts (18 tests)

 Test Files  1 passed (1)
      Tests  18 passed (18)
```

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: no output besides the npm banner, exit code 0.

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/agents/person.ts tests/engine/agents/person.test.ts
git commit -m "feat(agents): person factory and population init" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 9: Needs (`src/engine/agents/needs.ts`)

**Files:**
- Create: `src/engine/agents/needs.ts`
- Test: `tests/engine/agents/needs.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Tick`, `clamp01(v): number`
- Tests also use `createPerson` (Task 8) and `makeNameGenerator`/`createRng`

Produces:
- `export function updateNeeds(p: Person, tick: Tick): void` — per-tick need drift, called once per living person per tick (Task 33 tick step 3, before `decayEmotions`). Concrete formulas:
  - `hunger`: `+HUNGER_RATE` (0.02) per tick, halved to `HUNGER_RATE_FED` (0.01) if the person ate this tick (tracked via the `ateThisTick` extension flag set by `execute.ts`'s `gather`/`farm`/`hunt`/`share`/`trade`/`steal` food-gain branches through `markFed`), clamped to [0,1]. The fed flag is consumed (reset to false) every call so it only ever discounts the tick it was set on.
  - `rest`: `+REST_RATE` (0.015) per tick, reset toward 0 by the `rest` action in `execute.ts` (not here), clamped to [0,1].
  - `safety`: decays toward 0 at `SAFETY_DECAY` (0.01/tick) by default, but is raised by recent threat memories: `safety = clamp01(safety - SAFETY_DECAY + RECENT_THREAT_CONTRIBUTION * threatSalience)`, where `threatSalience` is the sum of `salience` over the person's memories of kind `'harmed' | 'death-witnessed' | 'kin-died' | 'disaster'` with `tick - rec.tick <= SAFETY_MEMORY_WINDOW` (90 ticks), each capped to contribute at most 1.0 total (`Math.min(1, sum)`), and `RECENT_THREAT_CONTRIBUTION = 0.05`.
  - `belonging`: decays toward a floor set by relationship count: `target = clamp01(0.9 - 0.15 * min(6, relationships.length))` (more relationships => lower baseline urgency), moved 5% of the gap per tick: `belonging += 0.05 * (target - belonging)`.
  - `esteem`: decays toward `target = clamp01(0.9 - influence)`, moved 5% of the gap per tick: `esteem += 0.05 * (target - esteem)`.
  - All five fields end clamped to [0, 1].
- `export function applyHungerHealth(p: Person): void` — contract signature verbatim: `needs.hunger > 0.85` drains `health` by `HUNGER_HEALTH_DRAIN` (0.01) per call, clamped at 0. Does nothing for `hunger <= 0.85`. Eating itself (adding food to `health`/reducing `hunger`) happens in `execute.ts`, not here.
- `export function markFed(p: Person): void` and `export function wasFedToday(p: Person, consume: boolean): boolean` — the extension-property helpers backing the halved hunger rate (mirrors the `lifecycle.ts` infection-extension-property pattern from Section 4 deviation 4): `markFed` sets a plain boolean extension field; `wasFedToday(p, true)` reads and clears it (used internally by `updateNeeds`); `wasFedToday(p, false)` just peeks (available for tests/UI without consuming the flag).
- Exported tuning constants: `HUNGER_RATE = 0.02`, `HUNGER_RATE_FED = 0.01`, `REST_RATE = 0.015`, `SAFETY_DECAY = 0.01`, `RECENT_THREAT_CONTRIBUTION = 0.05`, `SAFETY_MEMORY_WINDOW = 90`, `BELONGING_ADAPT_RATE = 0.05`, `ESTEEM_ADAPT_RATE = 0.05`, `HUNGER_HEALTH_DRAIN = 0.01`, `HUNGER_HEALTH_THRESHOLD = 0.85`.

Wiring notes for Task 33 (binding):
- `execute.ts` (Task 15) calls `markFed(p)` whenever a food-gaining action succeeds, and reduces `p.needs.hunger` directly by the amount eaten; `updateNeeds` only handles the ambient +hunger drift and the fed-day halving.
- `applyHungerHealth` is called once per person per tick, from inside `lifecycle.ts`'s `updateLifecycle` (Section 4, Task 17) — `Simulation` must not call it a second time or hunger would drain double health (documented in Section 4).

- [ ] **Step 1: Write the failing needs tests**

Create `tests/engine/agents/needs.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  BELONGING_ADAPT_RATE,
  ESTEEM_ADAPT_RATE,
  HUNGER_HEALTH_DRAIN,
  HUNGER_RATE,
  HUNGER_RATE_FED,
  REST_RATE,
  SAFETY_DECAY,
  applyHungerHealth,
  markFed,
  updateNeeds,
  wasFedToday,
} from '../../../src/engine/agents/needs';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import type { Person } from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function makePerson(): Person {
  const p = createPerson(1, 0, 'fable', { x: 0, y: 0 }, names, createRng(1));
  p.needs = { hunger: 0, safety: 0, rest: 0, belonging: 0, esteem: 0 };
  p.memory = [];
  p.relationships = [];
  p.influence = 0;
  return p;
}

describe('updateNeeds — hunger', () => {
  it('increases hunger by HUNGER_RATE when not fed', () => {
    const p = makePerson();
    updateNeeds(p, 100);
    expect(p.needs.hunger).toBeCloseTo(HUNGER_RATE, 6);
  });

  it('increases hunger by only HUNGER_RATE_FED when markFed was called this tick, and consumes the flag', () => {
    const p = makePerson();
    markFed(p);
    updateNeeds(p, 100);
    expect(p.needs.hunger).toBeCloseTo(HUNGER_RATE_FED, 6);
    updateNeeds(p, 101); // fed flag consumed; back to the full rate
    expect(p.needs.hunger).toBeCloseTo(HUNGER_RATE_FED + HUNGER_RATE, 6);
  });

  it('wasFedToday can peek without consuming', () => {
    const p = makePerson();
    markFed(p);
    expect(wasFedToday(p, false)).toBe(true);
    expect(wasFedToday(p, false)).toBe(true); // still set
    expect(wasFedToday(p, true)).toBe(true); // now consumed
    expect(wasFedToday(p, false)).toBe(false);
  });

  it('clamps hunger at 1', () => {
    const p = makePerson();
    p.needs.hunger = 0.995;
    updateNeeds(p, 1);
    expect(p.needs.hunger).toBe(1);
  });
});

describe('updateNeeds — rest', () => {
  it('increases rest by REST_RATE per tick', () => {
    const p = makePerson();
    updateNeeds(p, 1);
    expect(p.needs.rest).toBeCloseTo(REST_RATE, 6);
  });
});

describe('updateNeeds — safety', () => {
  it('decays toward 0 with no recent threat memories', () => {
    const p = makePerson();
    p.needs.safety = 0.5;
    updateNeeds(p, 1000);
    expect(p.needs.safety).toBeCloseTo(0.49, 6);
  });

  it('is raised by a recent harmed memory within the window', () => {
    const p = makePerson();
    p.needs.safety = 0;
    p.memory = [{ tick: 950, kind: 'harmed', otherId: 9, valence: -0.8, salience: 0.9 }];
    updateNeeds(p, 1000); // within SAFETY_MEMORY_WINDOW (90)
    expect(p.needs.safety).toBeCloseTo(0.035, 6); // -0.01 + 0.05*0.9
  });

  it('ignores threat memories outside the window', () => {
    const p = makePerson();
    p.needs.safety = 0.2;
    p.memory = [{ tick: 800, kind: 'harmed', otherId: 9, valence: -0.8, salience: 0.9 }];
    updateNeeds(p, 1000); // 200 ticks old, outside SAFETY_MEMORY_WINDOW
    expect(p.needs.safety).toBeCloseTo(0.19, 6);
  });

  it('caps the total threat contribution at 1.0 worth of salience', () => {
    const p = makePerson();
    p.needs.safety = 0;
    p.memory = Array.from({ length: 5 }, (_, i) => ({
      tick: 999,
      kind: 'harmed' as const,
      otherId: i,
      valence: -0.5,
      salience: 0.9,
    }));
    updateNeeds(p, 1000); // sum salience 4.5 -> capped to 1.0 contribution
    expect(p.needs.safety).toBeCloseTo(0.04, 6); // -0.01 + 0.05*1.0
  });
});

describe('updateNeeds — belonging and esteem', () => {
  it('belonging relaxes toward a lower target with more relationships', () => {
    const lonely = makePerson();
    lonely.needs.belonging = 0;
    updateNeeds(lonely, 1);
    // target = 0.9 - 0.15*0 = 0.9; belonging += 0.05*(0.9-0) = 0.045
    expect(lonely.needs.belonging).toBeCloseTo(0.045, 6);

    const social = makePerson();
    social.needs.belonging = 0;
    social.relationships = Array.from({ length: 6 }, (_, i) => ({
      otherId: i,
      kind: 'friend' as const,
      affinity: 0.5,
    }));
    updateNeeds(social, 1);
    // target = 0.9 - 0.15*6 = 0; belonging += 0.05*(0-0) = 0
    expect(social.needs.belonging).toBeCloseTo(0, 6);
  });

  it('esteem relaxes toward a lower target with more influence', () => {
    const p = makePerson();
    p.influence = 0.9;
    p.needs.esteem = 0.5;
    updateNeeds(p, 1);
    // target = 0.9 - 0.9 = 0; esteem += 0.05*(0-0.5) = -0.025
    expect(p.needs.esteem).toBeCloseTo(0.475, 6);
  });
});

describe('applyHungerHealth', () => {
  it('does nothing at or below the 0.85 threshold', () => {
    const p = makePerson();
    p.needs.hunger = 0.85;
    p.health = 1;
    applyHungerHealth(p);
    expect(p.health).toBe(1);
  });

  it('drains health by HUNGER_HEALTH_DRAIN above the threshold', () => {
    const p = makePerson();
    p.needs.hunger = 0.9;
    p.health = 1;
    applyHungerHealth(p);
    expect(p.health).toBeCloseTo(1 - HUNGER_HEALTH_DRAIN, 6);
  });

  it('clamps health at 0', () => {
    const p = makePerson();
    p.needs.hunger = 1;
    p.health = 0.005;
    applyHungerHealth(p);
    expect(p.health).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/agents/needs.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/agents/needs" from "tests/engine/agents/needs.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/engine/agents/needs.ts`**

Create `src/engine/agents/needs.ts` with exactly:

```ts
import { clamp01, type Person, type Tick } from '../../shared/types';

export const HUNGER_RATE = 0.02;
export const HUNGER_RATE_FED = 0.01;
export const REST_RATE = 0.015;
export const SAFETY_DECAY = 0.01;
export const RECENT_THREAT_CONTRIBUTION = 0.05;
export const SAFETY_MEMORY_WINDOW = 90;
export const BELONGING_ADAPT_RATE = 0.05;
export const ESTEEM_ADAPT_RATE = 0.05;
export const HUNGER_HEALTH_DRAIN = 0.01;
export const HUNGER_HEALTH_THRESHOLD = 0.85;

const THREAT_MEMORY_KINDS = new Set(['harmed', 'death-witnessed', 'kin-died', 'disaster']);

/**
 * Extension property backing the "ate this tick" flag, mirroring the
 * infection-extension-property pattern used by lifecycle.ts (Section 4).
 * Plain boolean, so it survives JSON serialization for free.
 */
interface WithFed {
  ateThisTick?: boolean;
}

/** Marks the person as having eaten this tick; halves the next updateNeeds hunger gain. */
export function markFed(p: Person): void {
  (p as Person & WithFed).ateThisTick = true;
}

/**
 * Reads the fed flag. When consume is true, clears it (the canonical use
 * inside updateNeeds, so the discount only ever applies to the tick it was
 * set on). When false, only peeks — safe for tests/UI to call any time.
 */
export function wasFedToday(p: Person, consume: boolean): boolean {
  const ext = p as Person & WithFed;
  const fed = ext.ateThisTick === true;
  if (consume) ext.ateThisTick = false;
  return fed;
}

/**
 * Per-tick need drift for one living person (Task 33 tick step 3, before
 * decayEmotions). Hunger and rest rise; safety and belonging/esteem relax
 * toward moving targets. All five fields end clamped to [0, 1].
 */
export function updateNeeds(p: Person, tick: Tick): void {
  const fed = wasFedToday(p, true);
  p.needs.hunger = clamp01(p.needs.hunger + (fed ? HUNGER_RATE_FED : HUNGER_RATE));

  p.needs.rest = clamp01(p.needs.rest + REST_RATE);

  let threatSalience = 0;
  for (const rec of p.memory) {
    if (!THREAT_MEMORY_KINDS.has(rec.kind)) continue;
    if (tick - rec.tick > SAFETY_MEMORY_WINDOW) continue;
    threatSalience += rec.salience;
  }
  const threatContribution = RECENT_THREAT_CONTRIBUTION * Math.min(1, threatSalience);
  p.needs.safety = clamp01(p.needs.safety - SAFETY_DECAY + threatContribution);

  const belongingTarget = clamp01(0.9 - 0.15 * Math.min(6, p.relationships.length));
  p.needs.belonging = clamp01(p.needs.belonging + BELONGING_ADAPT_RATE * (belongingTarget - p.needs.belonging));

  const esteemTarget = clamp01(0.9 - p.influence);
  p.needs.esteem = clamp01(p.needs.esteem + ESTEEM_ADAPT_RATE * (esteemTarget - p.needs.esteem));
}

/**
 * Contract signature verbatim: hunger above 0.85 drains health by
 * HUNGER_HEALTH_DRAIN per call, clamped at 0. Eating (reducing hunger,
 * consuming inventory/stock food) is handled entirely in execute.ts.
 */
export function applyHungerHealth(p: Person): void {
  if (p.needs.hunger > HUNGER_HEALTH_THRESHOLD) {
    p.health = Math.max(0, p.health - HUNGER_HEALTH_DRAIN);
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/agents/needs.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/agents/needs.test.ts (14 tests)

 Test Files  1 passed (1)
      Tests  14 passed (14)
```

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/agents/needs.ts tests/engine/agents/needs.test.ts
git commit -m "feat(agents): needs drift and hunger-health drain" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 10: Emotions (`src/engine/agents/emotions.ts`)

**Files:**
- Create: `src/engine/agents/emotions.ts`
- Test: `tests/engine/agents/emotions.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Emotions`, `Traits`, `clamp01(v): number`
- Tests also use `createPerson` (Task 8) and `makeNameGenerator`/`createRng`

Produces:
- `export function applyEmotionImpulse(p: Person, impulse: Partial<Emotions>, volatility: Emotions): void` — contract signature verbatim: for every key present in `impulse`, `p.emotions[k] = clamp01(p.emotions[k] + impulse[k] * volatility[k])`. Keys absent from `impulse` are untouched.
- `export function decayEmotions(p: Person, decayPerTick: Emotions): void` — contract signature verbatim: every component moves toward a trait-derived baseline by `decayPerTick[k]` per call: `p.emotions[k] = clamp01(p.emotions[k] + sign(baseline[k] - p.emotions[k]) * min(decayPerTick[k], abs(baseline[k] - p.emotions[k])))` (moves at most the full gap, never overshoots). Baselines (all derived from `p.traits`, each pre-clamped to [0,1]):
  - `fear = clamp01(0.5 - 0.4 * riskTolerance)`
  - `joy = clamp01(0.2 + 0.2 * empathy)`
  - `grief = 0.05` (constant floor; grief only meaningfully rises from events)
  - `anger = clamp01(0.15 * aggression)`
  - `hope = clamp01(0.15 + 0.25 * curiosity)`
- `export function dominantEmotion(p: Person): 'calm' | 'afraid' | 'angry' | 'joyful' | 'grieving'` — contract signature verbatim: the max of `{fear, anger, joy, grief}` (in that fixed tie-break order: fear, then anger, then joy, then grief) if it exceeds `0.45`, mapped to `'afraid' | 'angry' | 'joyful' | 'grieving'` respectively; `hope` never drives the dominant label (the contract's five-value enum has no "hopeful" case); otherwise `'calm'`.
- `export function emotionBaseline(traits: Traits): Emotions` — the trait-derived baseline used internally by `decayEmotions`, exported so Task 33/UI can show "resting" emotion state without needing a live person.
- Exported constant: `DOMINANT_EMOTION_THRESHOLD = 0.45`.

- [ ] **Step 1: Write the failing emotions tests**

Create `tests/engine/agents/emotions.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  DOMINANT_EMOTION_THRESHOLD,
  applyEmotionImpulse,
  decayEmotions,
  dominantEmotion,
  emotionBaseline,
} from '../../../src/engine/agents/emotions';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import type { Emotions, Person, Traits } from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function makePerson(): Person {
  const p = createPerson(1, 0, 'fable', { x: 0, y: 0 }, names, createRng(1));
  p.emotions = { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 };
  return p;
}

const NEUTRAL_VOLATILITY: Emotions = { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 };

describe('applyEmotionImpulse', () => {
  it('adds impulse*volatility to only the given keys', () => {
    const p = makePerson();
    applyEmotionImpulse(p, { fear: 0.3, anger: 0.2 }, NEUTRAL_VOLATILITY);
    expect(p.emotions.fear).toBeCloseTo(0.3, 6);
    expect(p.emotions.anger).toBeCloseTo(0.2, 6);
    expect(p.emotions.joy).toBe(0);
    expect(p.emotions.grief).toBe(0);
    expect(p.emotions.hope).toBe(0);
  });

  it('scales the impulse by volatility', () => {
    const p = makePerson();
    applyEmotionImpulse(p, { fear: 0.3 }, { ...NEUTRAL_VOLATILITY, fear: 2 });
    expect(p.emotions.fear).toBeCloseTo(0.6, 6);
  });

  it('clamps to [0, 1]', () => {
    const p = makePerson();
    p.emotions.joy = 0.9;
    applyEmotionImpulse(p, { joy: 0.5 }, NEUTRAL_VOLATILITY);
    expect(p.emotions.joy).toBe(1);
    p.emotions.grief = 0.1;
    applyEmotionImpulse(p, { grief: -0.5 }, NEUTRAL_VOLATILITY);
    expect(p.emotions.grief).toBe(0);
  });
});

describe('emotionBaseline', () => {
  it('derives baselines from traits', () => {
    const traits: Traits = { curiosity: 1, aggression: 0, empathy: 1, industriousness: 0.5, riskTolerance: 1 };
    const baseline = emotionBaseline(traits);
    expect(baseline.fear).toBeCloseTo(0.1, 6); // 0.5 - 0.4*1
    expect(baseline.joy).toBeCloseTo(0.4, 6); // 0.2 + 0.2*1
    expect(baseline.grief).toBeCloseTo(0.05, 6);
    expect(baseline.anger).toBeCloseTo(0, 6); // 0.15*0
    expect(baseline.hope).toBeCloseTo(0.4, 6); // 0.15 + 0.25*1
  });
});

describe('decayEmotions', () => {
  it('moves each component toward its baseline by at most decayPerTick', () => {
    const p = makePerson();
    p.traits = { curiosity: 0, aggression: 0, empathy: 0, industriousness: 0.5, riskTolerance: 0 };
    // baseline: fear 0.5, joy 0.2, grief 0.05, anger 0, hope 0.15
    p.emotions = { fear: 0, joy: 1, grief: 0.5, anger: 0.3, hope: 0.15 };
    decayEmotions(p, { fear: 0.1, joy: 0.1, grief: 0.1, anger: 0.1, hope: 0.1 });
    expect(p.emotions.fear).toBeCloseTo(0.1, 6); // moves up toward 0.5
    expect(p.emotions.joy).toBeCloseTo(0.9, 6); // moves down toward 0.2
    expect(p.emotions.grief).toBeCloseTo(0.4, 6); // moves down toward 0.05
    expect(p.emotions.anger).toBeCloseTo(0.2, 6); // moves down toward 0
    expect(p.emotions.hope).toBeCloseTo(0.15, 6); // already at baseline
  });

  it('never overshoots the baseline', () => {
    const p = makePerson();
    p.traits = { curiosity: 0, aggression: 0, empathy: 0, industriousness: 0.5, riskTolerance: 0 };
    p.emotions = { fear: 0.48, joy: 0, grief: 0, anger: 0, hope: 0 };
    decayEmotions(p, { fear: 0.5, joy: 0.5, grief: 0.5, anger: 0.5, hope: 0.5 });
    expect(p.emotions.fear).toBeCloseTo(0.5, 6); // baseline, not 0.98
  });
});

describe('dominantEmotion', () => {
  it('is calm below the threshold', () => {
    const p = makePerson();
    p.emotions = { fear: 0.4, joy: 0.4, grief: 0.4, anger: 0.4, hope: 0.9 };
    expect(dominantEmotion(p)).toBe('calm');
  });

  it('picks the max of fear/anger/joy/grief above the threshold', () => {
    const p = makePerson();
    p.emotions = { fear: 0.1, joy: 0.1, grief: 0.1, anger: 0.6, hope: 0 };
    expect(dominantEmotion(p)).toBe('angry');
  });

  it('ignores hope entirely', () => {
    const p = makePerson();
    p.emotions = { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0.99 };
    expect(dominantEmotion(p)).toBe('calm');
  });

  it('breaks ties in fixed order: fear, anger, joy, grief', () => {
    const p = makePerson();
    p.emotions = { fear: 0.6, joy: 0.6, grief: 0.6, anger: 0.6, hope: 0 };
    expect(dominantEmotion(p)).toBe('afraid');
    p.emotions = { fear: 0, joy: 0.6, grief: 0.6, anger: 0.6, hope: 0 };
    expect(dominantEmotion(p)).toBe('angry');
    p.emotions = { fear: 0, joy: 0.6, grief: 0.6, anger: 0, hope: 0 };
    expect(dominantEmotion(p)).toBe('joyful');
    p.emotions = { fear: 0, joy: 0, grief: 0.6, anger: 0, hope: 0 };
    expect(dominantEmotion(p)).toBe('grieving');
  });

  it('uses exactly the DOMINANT_EMOTION_THRESHOLD boundary (exclusive)', () => {
    const p = makePerson();
    p.emotions = { fear: DOMINANT_EMOTION_THRESHOLD, joy: 0, grief: 0, anger: 0, hope: 0 };
    expect(dominantEmotion(p)).toBe('calm'); // exactly at threshold does not count
    p.emotions.fear = DOMINANT_EMOTION_THRESHOLD + 0.001;
    expect(dominantEmotion(p)).toBe('afraid');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/agents/emotions.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/agents/emotions" from "tests/engine/agents/emotions.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/engine/agents/emotions.ts`**

Create `src/engine/agents/emotions.ts` with exactly:

```ts
import { clamp01, type Emotions, type Person, type Traits } from '../../shared/types';

export const DOMINANT_EMOTION_THRESHOLD = 0.45;

/** Trait-derived resting emotion state, exported for UI "resting" displays. */
export function emotionBaseline(traits: Traits): Emotions {
  return {
    fear: clamp01(0.5 - 0.4 * traits.riskTolerance),
    joy: clamp01(0.2 + 0.2 * traits.empathy),
    grief: 0.05,
    anger: clamp01(0.15 * traits.aggression),
    hope: clamp01(0.15 + 0.25 * traits.curiosity),
  };
}

/**
 * Contract signature verbatim: p.emotions[k] += impulse[k] * volatility[k]
 * for every key present in impulse, clamped to [0, 1]. Keys absent from
 * impulse are untouched.
 */
export function applyEmotionImpulse(p: Person, impulse: Partial<Emotions>, volatility: Emotions): void {
  for (const key of Object.keys(impulse) as (keyof Emotions)[]) {
    const delta = impulse[key];
    if (delta === undefined) continue;
    p.emotions[key] = clamp01(p.emotions[key] + delta * volatility[key]);
  }
}

/**
 * Contract signature verbatim: every component moves toward its
 * trait-derived baseline by at most decayPerTick[k] per call (never
 * overshoots the baseline).
 */
export function decayEmotions(p: Person, decayPerTick: Emotions): void {
  const baseline = emotionBaseline(p.traits);
  const keys: (keyof Emotions)[] = ['fear', 'joy', 'grief', 'anger', 'hope'];
  for (const key of keys) {
    const gap = baseline[key] - p.emotions[key];
    const step = Math.sign(gap) * Math.min(decayPerTick[key], Math.abs(gap));
    p.emotions[key] = clamp01(p.emotions[key] + step);
  }
}

/**
 * Contract signature verbatim: the max of fear/anger/joy/grief (in that
 * fixed tie-break order) if it exceeds DOMINANT_EMOTION_THRESHOLD, else
 * 'calm'. hope never drives this label.
 */
export function dominantEmotion(p: Person): 'calm' | 'afraid' | 'angry' | 'joyful' | 'grieving' {
  const ordered: { value: number; label: 'afraid' | 'angry' | 'joyful' | 'grieving' }[] = [
    { value: p.emotions.fear, label: 'afraid' },
    { value: p.emotions.anger, label: 'angry' },
    { value: p.emotions.joy, label: 'joyful' },
    { value: p.emotions.grief, label: 'grieving' },
  ];
  let best = ordered[0] as { value: number; label: 'afraid' | 'angry' | 'joyful' | 'grieving' };
  for (const entry of ordered) {
    if (entry.value > best.value) best = entry;
  }
  return best.value > DOMINANT_EMOTION_THRESHOLD ? best.label : 'calm';
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/agents/emotions.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/agents/emotions.test.ts (11 tests)

 Test Files  1 passed (1)
      Tests  11 passed (11)
```

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/agents/emotions.ts tests/engine/agents/emotions.test.ts
git commit -m "feat(agents): emotion impulses, trait-baseline decay and dominant emotion" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 11: Morality (`src/engine/agents/morality.ts`)

**Files:**
- Create: `src/engine/agents/morality.ts`
- Test: `tests/engine/agents/morality.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Morality`, `Needs`, `Emotions`, `Action`, `ActionKind`, `ACTION_KINDS`
- Tests also use `createPerson` (Task 8) and `makeNameGenerator`/`createRng`

Produces:
- `export const MORAL_FOOTPRINTS: Record<ActionKind, Partial<Morality>>` — contract signature verbatim, complete for all 18 `ACTION_KINDS` (virtuous/neutral actions get `{}`, never omitted — the key is always present):
  - `gather: {}`, `farm: {}`, `hunt: {}` (killing an animal, not a person — no moral weight), `build: {}`, `craft: {}`, `rest: {}`, `socialize: {}`, `court: {}`, `teach: {}`, `share: {}`, `worship: {}`, `explore: {}`, `heal: {}` (all virtuous/neutral)
  - `trade: { fairness: 0.1 }` (mild — an unequal trade still nags fairness)
  - `steal: { fairness: 0.7, care: 0.3 }`
  - `attack: { care: 0.9 }`
  - `flee: { loyalty: 0.2 }` (abandoning a group in danger mildly weighs on loyalty)
  - `migrate: { loyalty: 0.15 }` (leaving a settlement mildly weighs on loyalty)
  - This object is built with a `Record<ActionKind, Partial<Morality>>` literal listing every key explicitly (never derived/looped), so a missing entry is a compile error, not a runtime gap.
- `export function violationDot(morality: Morality, action: Action): number` — contract signature verbatim: `sum(morality[k] * footprint[k])` over the footprint's keys for `MORAL_FOOTPRINTS[action.kind]`; returns `0` for an action with an empty footprint.
- `export interface MoralityTemperament { moralWeight: number; desperationThreshold: number }` — deviation 3: the two fields `moralGate` reads, standing in for the Task 20 `Temperament` (which does not exist yet). The full `Temperament` is a structural superset and is assignable wherever `MoralityTemperament` is expected.
- `export function moralGate(p: Person, action: Action, temperament: MoralityTemperament): number` — contract signature (with `MoralityTemperament` per deviation 3): `dot = violationDot(p.morality, action)`; if `dot > 0.75`: veto to `0`, UNLESS `desperation = max(p.needs.hunger, p.emotions.fear) >= temperament.desperationThreshold`, in which case floor at `0.05`; otherwise `max(0, 1 - temperament.moralWeight * dot)`.
- `export function desperationLevel(p: Person): number` — `max(p.needs.hunger, p.emotions.fear)`, exported so `actions.ts` (Task 14) can reuse the exact same desperation formula for taboo overrides without duplicating it.
- Exported constant: `VETO_THRESHOLD = 0.75`, `DESPERATION_FLOOR = 0.05`.

- [ ] **Step 1: Write the failing morality tests**

Create `tests/engine/agents/morality.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  DESPERATION_FLOOR,
  MORAL_FOOTPRINTS,
  VETO_THRESHOLD,
  desperationLevel,
  moralGate,
  violationDot,
} from '../../../src/engine/agents/morality';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import { ACTION_KINDS, type Action, type Morality, type Person } from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function makePerson(): Person {
  const p = createPerson(1, 0, 'fable', { x: 0, y: 0 }, names, createRng(1));
  p.needs = { hunger: 0, safety: 0, rest: 0, belonging: 0, esteem: 0 };
  p.emotions = { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 };
  return p;
}

const FULL_MORALITY: Morality = { care: 1, fairness: 1, loyalty: 1, authority: 1, sanctity: 1, liberty: 1 };
const ZERO_MORALITY: Morality = { care: 0, fairness: 0, loyalty: 0, authority: 0, sanctity: 0, liberty: 0 };

describe('MORAL_FOOTPRINTS', () => {
  it('has an entry for every ActionKind', () => {
    for (const kind of ACTION_KINDS) {
      expect(MORAL_FOOTPRINTS).toHaveProperty(kind);
    }
    expect(Object.keys(MORAL_FOOTPRINTS).sort()).toEqual([...ACTION_KINDS].sort());
  });

  it('gives virtuous/neutral actions an empty footprint', () => {
    for (const kind of ['gather', 'farm', 'hunt', 'build', 'craft', 'rest', 'socialize', 'court', 'teach', 'share', 'worship', 'explore', 'heal'] as const) {
      expect(MORAL_FOOTPRINTS[kind]).toEqual({});
    }
  });

  it('gives attack a heavy care footprint and steal a fairness+care footprint', () => {
    expect(MORAL_FOOTPRINTS.attack).toEqual({ care: 0.9 });
    expect(MORAL_FOOTPRINTS.steal).toEqual({ fairness: 0.7, care: 0.3 });
  });
});

describe('violationDot', () => {
  it('is 0 for an action with an empty footprint regardless of morality', () => {
    expect(violationDot(FULL_MORALITY, { kind: 'gather' })).toBe(0);
  });

  it('sums morality[k] * footprint[k] over the footprint keys', () => {
    const m: Morality = { ...ZERO_MORALITY, fairness: 0.5, care: 0.4 };
    expect(violationDot(m, { kind: 'steal' })).toBeCloseTo(0.5 * 0.7 + 0.4 * 0.3, 6);
  });

  it('is 0 when the relevant morality components are 0', () => {
    expect(violationDot(ZERO_MORALITY, { kind: 'attack', targetPersonId: 2 })).toBe(0);
  });

  it('scales up to ~2 at full morality on multi-key footprints (bounded, not exactly 2)', () => {
    const dot = violationDot(FULL_MORALITY, { kind: 'steal' });
    expect(dot).toBeCloseTo(1.0, 6); // 1*0.7 + 1*0.3
    expect(dot).toBeLessThanOrEqual(2);
  });
});

describe('desperationLevel', () => {
  it('is the max of hunger and fear', () => {
    const p = makePerson();
    p.needs.hunger = 0.6;
    p.emotions.fear = 0.3;
    expect(desperationLevel(p)).toBeCloseTo(0.6, 6);
    p.emotions.fear = 0.9;
    expect(desperationLevel(p)).toBeCloseTo(0.9, 6);
  });
});

describe('moralGate', () => {
  const temperament = { moralWeight: 1, desperationThreshold: 0.95 };

  it('returns 1 for a virtuous action regardless of morality', () => {
    const p = makePerson();
    p.morality = FULL_MORALITY;
    expect(moralGate(p, { kind: 'gather' }, temperament)).toBe(1);
  });

  it('applies max(0, 1 - moralWeight*dot) below the veto threshold', () => {
    const p = makePerson();
    p.morality = { ...ZERO_MORALITY, fairness: 0.5 }; // trade footprint fairness:0.1 -> dot 0.05
    const gate = moralGate(p, { kind: 'trade', targetPersonId: 2 }, temperament);
    expect(gate).toBeCloseTo(1 - 1 * 0.05, 6);
  });

  it('vetoes (returns 0) when violationDot exceeds VETO_THRESHOLD and desperation is low', () => {
    const p = makePerson();
    p.morality = FULL_MORALITY; // attack dot = 0.9 > 0.75
    expect(violationDot(p.morality, { kind: 'attack' })).toBeGreaterThan(VETO_THRESHOLD);
    expect(moralGate(p, { kind: 'attack', targetPersonId: 2 }, temperament)).toBe(0);
  });

  it('floors at DESPERATION_FLOOR when desperation meets the threshold', () => {
    const p = makePerson();
    p.morality = FULL_MORALITY;
    p.needs.hunger = 0.95; // meets desperationThreshold
    expect(moralGate(p, { kind: 'attack', targetPersonId: 2 }, temperament)).toBe(DESPERATION_FLOOR);
  });

  it('fear alone can also trigger the desperation floor', () => {
    const p = makePerson();
    p.morality = FULL_MORALITY;
    p.emotions.fear = 0.96;
    expect(moralGate(p, { kind: 'attack', targetPersonId: 2 }, temperament)).toBe(DESPERATION_FLOOR);
  });

  it('desperation just below the threshold still vetoes', () => {
    const p = makePerson();
    p.morality = FULL_MORALITY;
    p.needs.hunger = 0.94;
    expect(moralGate(p, { kind: 'attack', targetPersonId: 2 }, temperament)).toBe(0);
  });

  it('a higher moralWeight lowers the gate proportionally for sub-veto violations', () => {
    const p = makePerson();
    p.morality = { ...ZERO_MORALITY, fairness: 0.5 }; // trade dot 0.05
    const low = moralGate(p, { kind: 'trade', targetPersonId: 2 }, { moralWeight: 0.5, desperationThreshold: 0.95 });
    const high = moralGate(p, { kind: 'trade', targetPersonId: 2 }, { moralWeight: 2, desperationThreshold: 0.95 });
    expect(low).toBeGreaterThan(high);
  });

  it('never returns a negative number even at extreme moralWeight', () => {
    const p = makePerson();
    p.morality = { ...ZERO_MORALITY, fairness: 0.5 };
    const gate = moralGate(p, { kind: 'trade', targetPersonId: 2 }, { moralWeight: 100, desperationThreshold: 0.95 });
    expect(gate).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/agents/morality.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/agents/morality" from "tests/engine/agents/morality.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/engine/agents/morality.ts`**

Create `src/engine/agents/morality.ts` with exactly:

```ts
import type { Action, ActionKind, Morality, Person } from '../../shared/types';

export const VETO_THRESHOLD = 0.75;
export const DESPERATION_FLOOR = 0.05;

/**
 * Contract table, complete for every ActionKind (a missing key would be a
 * compile error, not a silent runtime gap). Virtuous/neutral actions carry
 * an explicit empty footprint rather than being omitted.
 */
export const MORAL_FOOTPRINTS: Record<ActionKind, Partial<Morality>> = {
  gather: {},
  farm: {},
  hunt: {}, // killing an animal, not a person — no moral weight
  build: {},
  craft: {},
  rest: {},
  socialize: {},
  court: {},
  teach: {},
  trade: { fairness: 0.1 }, // an unequal trade still nags fairness
  share: {},
  steal: { fairness: 0.7, care: 0.3 },
  attack: { care: 0.9 },
  flee: { loyalty: 0.2 }, // abandoning a group in danger mildly weighs on loyalty
  migrate: { loyalty: 0.15 }, // leaving a settlement mildly weighs on loyalty
  worship: {},
  explore: {},
  heal: {},
};

/**
 * Contract signature verbatim: sum(morality[k] * footprint[k]) over the
 * footprint's keys. 0 for an action with an empty footprint.
 */
export function violationDot(morality: Morality, action: Action): number {
  const footprint = MORAL_FOOTPRINTS[action.kind];
  let dot = 0;
  for (const key of Object.keys(footprint) as (keyof Morality)[]) {
    const weight = footprint[key];
    if (weight === undefined) continue;
    dot += morality[key] * weight;
  }
  return dot;
}

/** max(hunger, fear) — the shared desperation formula (also used by actions.ts, Task 14). */
export function desperationLevel(p: Person): number {
  return Math.max(p.needs.hunger, p.emotions.fear);
}

/**
 * Deviation 3: the two fields moralGate actually reads, standing in for the
 * Task 20 Temperament (brains/types.ts does not exist at Task 11). The full
 * Temperament is a structural superset and assignable here.
 */
export interface MoralityTemperament {
  moralWeight: number;
  desperationThreshold: number;
}

/**
 * Contract signature (temperament typed per deviation 3): multiplier
 * max(0, 1 - moralWeight*violationDot); hard veto (0) when violationDot
 * exceeds VETO_THRESHOLD, unless desperation meets desperationThreshold, in
 * which case the gate floors at DESPERATION_FLOOR instead of 0.
 */
export function moralGate(p: Person, action: Action, temperament: MoralityTemperament): number {
  const dot = violationDot(p.morality, action);
  if (dot > VETO_THRESHOLD) {
    return desperationLevel(p) >= temperament.desperationThreshold ? DESPERATION_FLOOR : 0;
  }
  return Math.max(0, 1 - temperament.moralWeight * dot);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/agents/morality.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/agents/morality.test.ts (16 tests)

 Test Files  1 passed (1)
      Tests  16 passed (16)
```

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/agents/morality.ts tests/engine/agents/morality.test.ts
git commit -m "feat(agents): moral footprints table and moral gate" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 12: Memory (`src/engine/agents/memory.ts`)

**Files:**
- Create: `src/engine/agents/memory.ts`
- Test: `tests/engine/agents/memory.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `MemoryEventRec`, `MEMORY_CAP = 48`, `clamp(v, lo, hi): number`
- Tests also use `createPerson` (Task 8) and `makeNameGenerator`/`createRng`

Produces:
- `export function remember(p: Person, rec: MemoryEventRec): void` — contract signature verbatim: inserts `rec` at index 0 (newest-first: `p.memory.unshift(rec)`); if the array now exceeds `MEMORY_CAP`, evicts exactly one entry — the lowest-`salience` entry among indices `[1, length)` (the entry just inserted at index 0 is never the one evicted by its own insertion; ties break to the oldest, i.e. the highest index / largest `tick` distance — concretely, the last entry reached while scanning, so among equal salience the one with the greater array index, which by newest-first ordering is the older memory).
- `export function fadeMemories(p: Person): void` — contract signature verbatim: every memory's `salience *= FADE_RATE` (0.999), then any memory with `salience < FADE_MIN` (0.05) is dropped (order preserved for survivors).
- `export function memoryBias(p: Person, otherId: number): number` — contract signature verbatim: `clamp(sum(valence*salience) over memories where otherId matches, -1, 1)`.
- Exported constants: `FADE_RATE = 0.999`, `FADE_MIN = 0.05`.

- [ ] **Step 1: Write the failing memory tests**

Create `tests/engine/agents/memory.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { FADE_MIN, FADE_RATE, fadeMemories, memoryBias, remember } from '../../../src/engine/agents/memory';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import { MEMORY_CAP, type MemoryEventRec, type Person } from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function makePerson(): Person {
  const p = createPerson(1, 0, 'fable', { x: 0, y: 0 }, names, createRng(1));
  p.memory = [];
  return p;
}

function rec(overrides: Partial<MemoryEventRec> = {}): MemoryEventRec {
  return { tick: 0, kind: 'helped', otherId: 1, valence: 0.5, salience: 0.5, ...overrides };
}

describe('remember', () => {
  it('inserts newest-first', () => {
    const p = makePerson();
    remember(p, rec({ tick: 1 }));
    remember(p, rec({ tick: 2 }));
    expect(p.memory[0]?.tick).toBe(2);
    expect(p.memory[1]?.tick).toBe(1);
  });

  it('does not evict while under the cap', () => {
    const p = makePerson();
    for (let i = 0; i < MEMORY_CAP; i++) remember(p, rec({ tick: i }));
    expect(p.memory).toHaveLength(MEMORY_CAP);
  });

  it('evicts the lowest-salience entry (never the just-inserted one) beyond the cap', () => {
    const p = makePerson();
    for (let i = 0; i < MEMORY_CAP; i++) remember(p, rec({ tick: i, salience: 0.5 }));
    // insert one more low-salience memory that would itself be the minimum;
    // it must survive (it's index 0), and some existing 0.5-salience entry
    // is evicted instead.
    remember(p, rec({ tick: 999, salience: 0.01, otherId: 777 }));
    expect(p.memory).toHaveLength(MEMORY_CAP);
    expect(p.memory[0]?.otherId).toBe(777); // the new memory is never evicted by its own insertion
  });

  it('breaks eviction ties toward the older memory', () => {
    const p = makePerson();
    for (let i = 0; i < MEMORY_CAP; i++) {
      remember(p, rec({ tick: i, salience: i === 3 || i === 10 ? 0.1 : 0.9, otherId: i }));
    }
    // two entries tie at salience 0.1: original insertion order made tick=3
    // older than tick=10 (tick=3 was pushed first, so after all unshifts it
    // sits at a higher array index than tick=10).
    remember(p, rec({ tick: 999, salience: 0.5, otherId: 998 }));
    const survivorIds = p.memory.map((m) => m.otherId);
    expect(survivorIds).toContain(10); // the newer of the tied pair survives
    expect(survivorIds).not.toContain(3); // the older of the tied pair is evicted
  });
});

describe('fadeMemories', () => {
  it('multiplies every salience by FADE_RATE', () => {
    const p = makePerson();
    remember(p, rec({ salience: 0.5 }));
    fadeMemories(p);
    expect(p.memory[0]?.salience).toBeCloseTo(0.5 * FADE_RATE, 6);
  });

  it('drops memories whose salience falls below FADE_MIN', () => {
    const p = makePerson();
    remember(p, rec({ salience: FADE_MIN / FADE_RATE + 0.0001 })); // survives one fade
    remember(p, rec({ salience: FADE_MIN * 0.99, otherId: 2 })); // already effectively below after *FADE_RATE
    fadeMemories(p);
    const ids = p.memory.map((m) => m.otherId);
    expect(ids).toContain(1);
    expect(ids).not.toContain(2);
  });

  it('preserves order among survivors', () => {
    const p = makePerson();
    remember(p, rec({ tick: 1, otherId: 1, salience: 0.9 }));
    remember(p, rec({ tick: 2, otherId: 2, salience: 0.8 }));
    remember(p, rec({ tick: 3, otherId: 3, salience: 0.7 }));
    fadeMemories(p);
    expect(p.memory.map((m) => m.otherId)).toEqual([3, 2, 1]);
  });
});

describe('memoryBias', () => {
  it('sums valence*salience for memories about the given person', () => {
    const p = makePerson();
    remember(p, rec({ otherId: 5, valence: 0.5, salience: 0.5 }));
    remember(p, rec({ otherId: 5, valence: -0.2, salience: 0.5 }));
    remember(p, rec({ otherId: 9, valence: 1, salience: 1 })); // different person, ignored
    expect(memoryBias(p, 5)).toBeCloseTo(0.5 * 0.5 + -0.2 * 0.5, 6);
  });

  it('is 0 for a person with no memories', () => {
    const p = makePerson();
    expect(memoryBias(p, 42)).toBe(0);
  });

  it('clamps to [-1, 1]', () => {
    const p = makePerson();
    for (let i = 0; i < 10; i++) remember(p, rec({ otherId: 5, valence: 1, salience: 1 }));
    expect(memoryBias(p, 5)).toBe(1);
    const q = makePerson();
    for (let i = 0; i < 10; i++) remember(q, rec({ otherId: 5, valence: -1, salience: 1 }));
    expect(memoryBias(q, 5)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/agents/memory.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/agents/memory" from "tests/engine/agents/memory.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/engine/agents/memory.ts`**

Create `src/engine/agents/memory.ts` with exactly:

```ts
import { MEMORY_CAP, clamp, type MemoryEventRec, type Person } from '../../shared/types';

export const FADE_RATE = 0.999;
export const FADE_MIN = 0.05;

/**
 * Contract signature verbatim: newest-first insertion; evicts the
 * lowest-salience entry among everything except the just-inserted record
 * whenever the cap is exceeded. Ties break toward the older memory (the
 * later index, since the list is newest-first).
 */
export function remember(p: Person, rec: MemoryEventRec): void {
  p.memory.unshift(rec);
  if (p.memory.length <= MEMORY_CAP) return;

  // Search indices [1, length) only — index 0 is the record just inserted
  // and must never be evicted by its own insertion.
  let evictIndex = 1;
  let lowestSalience = p.memory[1]?.salience ?? Infinity;
  for (let i = 2; i < p.memory.length; i++) {
    const salience = (p.memory[i] as MemoryEventRec).salience;
    if (salience <= lowestSalience) {
      lowestSalience = salience;
      evictIndex = i; // <= keeps the later (older) index on ties
    }
  }
  p.memory.splice(evictIndex, 1);
}

/**
 * Contract signature verbatim: every salience *= FADE_RATE, then drop
 * anything below FADE_MIN. Order is preserved among survivors.
 */
export function fadeMemories(p: Person): void {
  for (const m of p.memory) m.salience *= FADE_RATE;
  p.memory = p.memory.filter((m) => m.salience >= FADE_MIN);
}

/**
 * Contract signature verbatim: clamp(sum(valence*salience) over memories
 * about otherId, -1, 1).
 */
export function memoryBias(p: Person, otherId: number): number {
  let sum = 0;
  for (const m of p.memory) {
    if (m.otherId === otherId) sum += m.valence * m.salience;
  }
  return clamp(sum, -1, 1);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/agents/memory.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/agents/memory.test.ts (10 tests)

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/agents/memory.ts tests/engine/agents/memory.test.ts
git commit -m "feat(agents): bounded episodic memory with salience-based eviction and fade" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 13: Relationships (`src/engine/agents/relationships.ts`)

**Files:**
- Create: `src/engine/agents/relationships.ts`
- Test: `tests/engine/agents/relationships.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Relationship`, `RelationKind`, `RELATIONSHIP_CAP = 24`, `clamp(v, lo, hi): number`
- Tests also use `createPerson` (Task 8) and `makeNameGenerator`/`createRng`

Produces:
- `export function adjustRelationship(p: Person, otherId: number, kind: RelationKind, delta: number): void` — contract signature verbatim. If a relationship with `otherId` already exists: its `affinity` moves by `delta` (clamped to [-1, 1]) and its `kind` is overwritten to the passed `kind` (the most recent interaction determines the label — e.g. a `'friend'` who becomes a `'rival'` after repeated harm). If none exists and `p.relationships.length < RELATIONSHIP_CAP`: a new entry `{ otherId, kind, affinity: clamp(delta, -1, 1) }` is appended. If none exists and the cap is already reached: the relationship with the lowest `Math.abs(affinity)` (the least-invested bond) is evicted first, then the new one is appended (ties broken toward the earliest index, i.e. `Array.prototype.indexOf`-order first match — `findIndex`/linear-scan-first-minimum semantics).
- `export function affinityTo(p: Person, otherId: number): number` — contract signature verbatim: the matching relationship's `affinity`, or `0` if none exists.
- `export function isKin(p: Person, otherId: number): boolean` — contract signature verbatim: `true` iff a relationship with `otherId` exists and its `kind === 'kin'`.
- Exported constant: none beyond re-exporting the contract's `RELATIONSHIP_CAP` is unnecessary (already exported from `shared/types.ts`); no new tuning constants are needed for this file's exact contract formulas.

- [ ] **Step 1: Write the failing relationships tests**

Create `tests/engine/agents/relationships.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { adjustRelationship, affinityTo, isKin } from '../../../src/engine/agents/relationships';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import { RELATIONSHIP_CAP, type Person } from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function makePerson(): Person {
  const p = createPerson(1, 0, 'fable', { x: 0, y: 0 }, names, createRng(1));
  p.relationships = [];
  return p;
}

describe('adjustRelationship', () => {
  it('creates a new relationship when none exists', () => {
    const p = makePerson();
    adjustRelationship(p, 5, 'friend', 0.3);
    expect(p.relationships).toEqual([{ otherId: 5, kind: 'friend', affinity: 0.3 }]);
  });

  it('adjusts affinity and overwrites kind on an existing relationship', () => {
    const p = makePerson();
    adjustRelationship(p, 5, 'friend', 0.3);
    adjustRelationship(p, 5, 'rival', -0.5);
    expect(p.relationships).toHaveLength(1);
    expect(p.relationships[0]?.kind).toBe('rival');
    expect(p.relationships[0]?.affinity).toBeCloseTo(-0.2, 6);
  });

  it('clamps affinity to [-1, 1]', () => {
    const p = makePerson();
    adjustRelationship(p, 5, 'friend', 0.9);
    adjustRelationship(p, 5, 'friend', 0.9);
    expect(p.relationships[0]?.affinity).toBe(1);
    adjustRelationship(p, 5, 'rival', -3);
    expect(p.relationships[0]?.affinity).toBe(-1);
  });

  it('evicts the least-invested relationship (lowest |affinity|) when the cap is reached', () => {
    const p = makePerson();
    for (let i = 0; i < RELATIONSHIP_CAP; i++) {
      adjustRelationship(p, i, 'friend', i === 3 ? 0.01 : 0.5); // id 3 is least invested
    }
    expect(p.relationships).toHaveLength(RELATIONSHIP_CAP);
    adjustRelationship(p, 999, 'friend', 0.4);
    expect(p.relationships).toHaveLength(RELATIONSHIP_CAP);
    expect(p.relationships.some((r) => r.otherId === 3)).toBe(false);
    expect(p.relationships.some((r) => r.otherId === 999)).toBe(true);
  });

  it('breaks eviction ties toward the earliest-created relationship', () => {
    const p = makePerson();
    for (let i = 0; i < RELATIONSHIP_CAP; i++) {
      adjustRelationship(p, i, 'friend', i === 2 || i === 7 ? 0.1 : 0.5);
    }
    adjustRelationship(p, 999, 'friend', 0.4);
    // id 2 was created before id 7; the tie-break evicts the earliest.
    expect(p.relationships.some((r) => r.otherId === 2)).toBe(false);
    expect(p.relationships.some((r) => r.otherId === 7)).toBe(true);
  });
});

describe('affinityTo', () => {
  it('returns the matching affinity', () => {
    const p = makePerson();
    adjustRelationship(p, 5, 'friend', 0.4);
    expect(affinityTo(p, 5)).toBeCloseTo(0.4, 6);
  });

  it('returns 0 when no relationship exists', () => {
    const p = makePerson();
    expect(affinityTo(p, 42)).toBe(0);
  });
});

describe('isKin', () => {
  it('is true only for kind kin', () => {
    const p = makePerson();
    adjustRelationship(p, 5, 'kin', 0.5);
    adjustRelationship(p, 6, 'friend', 0.5);
    expect(isKin(p, 5)).toBe(true);
    expect(isKin(p, 6)).toBe(false);
    expect(isKin(p, 999)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/agents/relationships.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/agents/relationships" from "tests/engine/agents/relationships.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/engine/agents/relationships.ts`**

Create `src/engine/agents/relationships.ts` with exactly:

```ts
import { RELATIONSHIP_CAP, clamp, type Person, type RelationKind } from '../../shared/types';

/**
 * Contract signature verbatim. Existing relationship: affinity moves by
 * delta (clamped), kind is overwritten (the latest interaction relabels the
 * bond). New relationship under the cap: appended. New relationship at the
 * cap: the least-invested existing bond (lowest |affinity|, earliest index
 * on ties) is evicted first.
 */
export function adjustRelationship(p: Person, otherId: number, kind: RelationKind, delta: number): void {
  const existing = p.relationships.find((r) => r.otherId === otherId);
  if (existing !== undefined) {
    existing.kind = kind;
    existing.affinity = clamp(existing.affinity + delta, -1, 1);
    return;
  }

  if (p.relationships.length >= RELATIONSHIP_CAP) {
    let evictIndex = 0;
    let lowest = Math.abs(p.relationships[0]?.affinity ?? 0);
    for (let i = 1; i < p.relationships.length; i++) {
      const abs = Math.abs((p.relationships[i] as { affinity: number }).affinity);
      if (abs < lowest) {
        lowest = abs;
        evictIndex = i;
      }
    }
    p.relationships.splice(evictIndex, 1);
  }

  p.relationships.push({ otherId, kind, affinity: clamp(delta, -1, 1) });
}

/** Contract signature verbatim: the matching relationship's affinity, or 0. */
export function affinityTo(p: Person, otherId: number): number {
  return p.relationships.find((r) => r.otherId === otherId)?.affinity ?? 0;
}

/** Contract signature verbatim: true iff a kin relationship with otherId exists. */
export function isKin(p: Person, otherId: number): boolean {
  return p.relationships.some((r) => r.otherId === otherId && r.kind === 'kin');
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/agents/relationships.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/agents/relationships.test.ts (8 tests)

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/agents/relationships.ts tests/engine/agents/relationships.test.ts
git commit -m "feat(agents): capped relationships with least-invested eviction" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 14: Action catalog and legality (`src/engine/agents/actions.ts`)

**Files:**
- Create: `src/engine/agents/actions.ts`
- Test: `tests/engine/agents/actions.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Action`, `ActionKind`, `ACTION_KINDS`, `Vec2`, `Civ`, `Settlement`, `Religion`, `Tick`, `ADULT_AGE_TICKS = 16 * YEAR_TICKS`, `PERCEPTION_RADIUS = 4`, `dist(a, b): number`
- From `src/engine/rng.ts` (Task 2): `Rng`; tests also use `createRng`
- From `src/engine/names.ts` (Task 4): `NameGen`; tests also use `makeNameGenerator`
- From `src/engine/world/terrain.ts` (Task 5): `World`, `isHabitable(terrain): boolean`; tests also use `generateWorld`
- From `src/engine/world/spatial.ts` (Task 7): `SpatialIndex` (`near(pos, radius): number[]`)
- From `src/engine/agents/morality.ts` (Task 11): `desperationLevel(p: Person): number`
- From `src/engine/agents/relationships.ts` (Task 13): `isKin(p: Person, otherId: number): boolean`
- Tests also use `createPerson`/`createChild` (Task 8)

Produces:
- `export interface ActionsCtxLike { world: World; personById: Map<number, Person>; spatial: SpatialIndex; settlements: Settlement[]; tick: Tick }` — deviation 1: the minimal structural subset of the eventual Task 33 `EngineCtx` that candidate generation reads. `EngineCtx` is a superset, so Task 33 passes its `ctx` directly.
- `export function legalActions(p: Person, ctx: ActionsCtxLike, taboos: ActionKind[]): Action[]` — contract signature (with `ActionsCtxLike` per deviation 1, and an explicit `taboos` parameter standing in for "p's temperament" since `Temperament` is Task 20): candidate generation incl. targets, described exactly in the per-kind table below. Taboo kinds are removed from the result UNLESS `desperationLevel(p) >= 0.95` (the contract's literal "unless desperation >= 0.95"; this is a fixed threshold, not `temperament.desperationThreshold`, precisely because `legalActions` has no temperament object — only the caller-supplied `taboos` list). Children (`p.ageTicks < ADULT_AGE_TICKS`) get a reduced set: only `gather`, `rest`, `socialize`, `explore`, `flee`, `teach` (as a student receiving, represented the same as any other teach candidate — the direction is resolved by `execute.ts`) are ever included for a child, regardless of taboos or desperation.
- Per-kind candidate rules (all concrete):
  - `gather`: always included if the person's own tile or any tile within `PERCEPTION_RADIUS` (queried via a `PERCEPTION_RADIUS`-bounded scan of `ctx.world` around `p.pos`, not `ctx.spatial`) has `food > 0`; one candidate per such tile, `{ kind: 'gather', tile }`.
  - `farm`: included only for adults, one candidate per habitable tile within `PERCEPTION_RADIUS` with `fertility > 0.3`, `{ kind: 'farm', tile }` (agriculture-capability gating by tech happens in `execute.ts`, not here — legality only checks the tile is farmable in principle).
  - `hunt`: one candidate `{ kind: 'hunt' }` (untargeted; `execute.ts` resolves success), included for adults only.
  - `build`: one candidate per `StructureKind` (`'shelter' | 'granary' | 'wall' | 'shrine'`) at the person's own settlement if `p.settlementId !== null`, `{ kind: 'build', structure }`; not included without a settlement.
  - `craft`: one candidate `{ kind: 'craft' }` if `p.inventory.wood > 0 || p.inventory.stone > 0`.
  - `rest`: always included, `{ kind: 'rest' }`.
  - `socialize`: one candidate per living person within `PERCEPTION_RADIUS` (via `ctx.spatial.near`, excluding self), `{ kind: 'socialize', targetPersonId }`.
  - `court`: one candidate per living, unpartnered, adult person of the opposite sex within `PERCEPTION_RADIUS` who is not kin (`!isKin(p, other.id)`) and is not already `p`'s partner, `{ kind: 'court', targetPersonId }`; adults only (both self and target).
  - `teach`: one candidate per living person within `PERCEPTION_RADIUS` other than self, `{ kind: 'teach', targetPersonId }`; adults only as the acting person (children can be a teach *target* via someone else's candidate, but never generate their own teach candidates — consistent with the reduced child set above, which lists `teach` as a receivable candidate for children too since a child might be the one selected as the target by a teacher's decision, not the actor here; concretely: a child's own `legalActions` never includes `'teach'` as an actor action because the reduced-set list above only gates which kinds appear at all — the per-kind rule "adults only as the acting person" still applies within that gate, so in practice children never get a `teach` candidate. The reduced-set mention of `teach` is retained for forward documentation but has no effect until Task 33 wiring; this is intentional and not a bug).
  - `trade`: one candidate per living person within `PERCEPTION_RADIUS` other than self with a non-empty inventory (`sum(inventory) > 0`), `{ kind: 'trade', targetPersonId }`; adults only.
  - `share`: one candidate per living person within `PERCEPTION_RADIUS` other than self, `{ kind: 'share', targetPersonId }`.
  - `steal`: one candidate per living person within `PERCEPTION_RADIUS` other than self with `sum(inventory) > 0`, plus one candidate per settlement within `PERCEPTION_RADIUS` of `p.pos` other than `p`'s own settlement with non-empty stock, `{ kind: 'steal', targetPersonId }` or `{ kind: 'steal', tile: settlement.center }` respectively; adults only. `steal` is always subject to the taboo filter like every other kind (it is not itself a taboo by default — taboos come from the brain's temperament, injected by the caller).
  - `attack`: one candidate per living person within `PERCEPTION_RADIUS` other than self who is not kin, `{ kind: 'attack', targetPersonId }`; adults only.
  - `flee`: always included, `{ kind: 'flee' }`.
  - `migrate`: one candidate per habitable tile within `PERCEPTION_RADIUS * 3` of `p.pos` that is farther than `PERCEPTION_RADIUS` from `p.pos` (so migrate always represents genuine long-range travel, not a step `explore`/`gather` already cover), `{ kind: 'migrate', tile }`, capped at 4 candidates (the 4 farthest-apart via the same farthest-point greedy used in `person.ts`, to keep candidate lists small); adults only.
  - `worship`: one candidate `{ kind: 'worship' }` if `p.beliefIds.length > 0`.
  - `explore`: one candidate per one of the 8 compass tiles at distance `PERCEPTION_RADIUS + 1` from `p.pos` that is in-bounds and habitable, `{ kind: 'explore', tile }`.
  - `heal`: one candidate per living person within `PERCEPTION_RADIUS` other than self with `health < 1`, `{ kind: 'heal', targetPersonId }`.
- Exported constants: `MIGRATE_RADIUS_MULTIPLIER = 3`, `MIGRATE_CANDIDATE_CAP = 4`, `EXPLORE_RING_OFFSET = 1`, `FARM_MIN_FERTILITY = 0.3`, `DESPERATION_TABOO_OVERRIDE = 0.95`.
- `export const CHILD_ACTION_KINDS: readonly ActionKind[] = ['gather', 'rest', 'socialize', 'explore', 'flee', 'teach']` — the reduced set for `p.ageTicks < ADULT_AGE_TICKS`.

Wiring notes for Task 33 (binding):
- Task 33 tick step 3 calls `legalActions(p, ctx, getBrain(p.lineage).temperament().taboos)`.

- [ ] **Step 1: Write the failing actions tests**

Create `tests/engine/agents/actions.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  CHILD_ACTION_KINDS,
  DESPERATION_TABOO_OVERRIDE,
  legalActions,
  type ActionsCtxLike,
} from '../../../src/engine/agents/actions';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import { SpatialIndex } from '../../../src/engine/world/spatial';
import { World } from '../../../src/engine/world/terrain';
import {
  ACTION_KINDS,
  ADULT_AGE_TICKS,
  type ActionKind,
  type Person,
  type Settlement,
  type Tile,
} from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function flatWorld(size: number, fertility = 0.5, food = 1): World {
  const tiles: Tile[] = Array.from({ length: size * size }, () => ({
    terrain: 'plains',
    fertility,
    food,
    wood: 5,
    stone: 5,
    metal: 0,
  }));
  return new World(size, tiles);
}

function makeCtx(people: Person[], world: World, settlements: Settlement[] = []): ActionsCtxLike {
  const spatial = new SpatialIndex();
  spatial.rebuild(people);
  return {
    world,
    personById: new Map(people.map((p) => [p.id, p])),
    spatial,
    settlements,
    tick: 1000,
  };
}

function makeAdult(id: number, x: number, y: number, sex: 'm' | 'f' = 'm'): Person {
  const p = createPerson(id, 0, 'fable', { x, y }, names, createRng(id + 1));
  p.sex = sex;
  p.needs.hunger = 0;
  p.emotions.fear = 0;
  return p;
}

function makeChild(id: number, x: number, y: number): Person {
  const p = makeAdult(id, x, y);
  p.ageTicks = 5 * 360;
  return p;
}

describe('legalActions — basics', () => {
  it('always includes rest and flee', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0, 0); // no food anywhere
    const actions = legalActions(p, makeCtx([p], world), []);
    expect(actions.some((a) => a.kind === 'rest')).toBe(true);
    expect(actions.some((a) => a.kind === 'flee')).toBe(true);
  });

  it('includes gather candidates only where food > 0', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0.5, 0);
    world.tileAt(10, 10).food = 2; // own tile has food
    const actions = legalActions(p, makeCtx([p], world), []);
    const gathers = actions.filter((a) => a.kind === 'gather');
    expect(gathers.length).toBeGreaterThan(0);
    for (const g of gathers) {
      expect(world.tileAt((g.tile as { x: number }).x, (g.tile as { y: number }).y).food).toBeGreaterThan(0);
    }
  });

  it('includes farm candidates only on fertile-enough habitable tiles', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0.5, 0); // fertility 0.5 > 0.3
    const actions = legalActions(p, makeCtx([p], world), []);
    expect(actions.some((a) => a.kind === 'farm')).toBe(true);
    const infertile = flatWorld(32, 0.1, 0);
    const noFarm = legalActions(p, makeCtx([p], infertile), []);
    expect(noFarm.some((a) => a.kind === 'farm')).toBe(false);
  });

  it('includes craft only with wood or stone in inventory', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0, 0);
    p.inventory = { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 };
    expect(legalActions(p, makeCtx([p], world), []).some((a) => a.kind === 'craft')).toBe(false);
    p.inventory.wood = 1;
    expect(legalActions(p, makeCtx([p], world), []).some((a) => a.kind === 'craft')).toBe(true);
  });

  it('includes worship only with at least one belief', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0, 0);
    expect(legalActions(p, makeCtx([p], world), []).some((a) => a.kind === 'worship')).toBe(false);
    p.beliefIds = [1];
    expect(legalActions(p, makeCtx([p], world), []).some((a) => a.kind === 'worship')).toBe(true);
  });

  it('build requires a settlement; one candidate per structure kind', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0, 0);
    expect(legalActions(p, makeCtx([p], world), []).some((a) => a.kind === 'build')).toBe(false);
    p.settlementId = 1;
    const builds = legalActions(p, makeCtx([p], world), []).filter((a) => a.kind === 'build');
    expect(builds.map((b) => b.structure).sort()).toEqual(['granary', 'shelter', 'shrine', 'wall']);
  });
});

describe('legalActions — social/targeted candidates', () => {
  it('socialize/teach/share/heal target every other nearby living person', () => {
    const p = makeAdult(1, 10, 10);
    const other = makeAdult(2, 11, 10);
    other.health = 0.5;
    const world = flatWorld(32, 0, 0);
    const actions = legalActions(p, makeCtx([p, other], world), []);
    expect(actions.some((a) => a.kind === 'socialize' && a.targetPersonId === 2)).toBe(true);
    expect(actions.some((a) => a.kind === 'teach' && a.targetPersonId === 2)).toBe(true);
    expect(actions.some((a) => a.kind === 'share' && a.targetPersonId === 2)).toBe(true);
    expect(actions.some((a) => a.kind === 'heal' && a.targetPersonId === 2)).toBe(true);
  });

  it('heal excludes full-health targets', () => {
    const p = makeAdult(1, 10, 10);
    const other = makeAdult(2, 11, 10);
    other.health = 1;
    const world = flatWorld(32, 0, 0);
    const actions = legalActions(p, makeCtx([p, other], world), []);
    expect(actions.some((a) => a.kind === 'heal')).toBe(false);
  });

  it('court excludes kin, same-sex, partnered and non-adult targets', () => {
    const p = makeAdult(1, 10, 10, 'm');
    const kinF = makeAdult(2, 11, 10, 'f');
    const sameSex = makeAdult(3, 9, 10, 'm');
    const partnered = makeAdult(4, 10, 11, 'f');
    partnered.partnerId = 999;
    const child = makeChild(5, 10, 9);
    const eligible = makeAdult(6, 12, 10, 'f');
    const world = flatWorld(32, 0, 0);
    const people = [p, kinF, sameSex, partnered, child, eligible];
    const ctx = makeCtx(people, world);
    // wire kinship after ctx build (isKin reads p.relationships, not ctx)
    p.relationships = [{ otherId: 2, kind: 'kin', affinity: 0.5 }];
    const targets = legalActions(p, ctx, [])
      .filter((a) => a.kind === 'court')
      .map((a) => a.targetPersonId);
    expect(targets).toEqual([6]);
  });

  it('attack excludes kin', () => {
    const p = makeAdult(1, 10, 10);
    const kin = makeAdult(2, 11, 10);
    const stranger = makeAdult(3, 9, 10);
    p.relationships = [{ otherId: 2, kind: 'kin', affinity: 0.5 }];
    const world = flatWorld(32, 0, 0);
    const targets = legalActions(p, makeCtx([p, kin, stranger], world), [])
      .filter((a) => a.kind === 'attack')
      .map((a) => a.targetPersonId);
    expect(targets).toEqual([3]);
  });

  it('trade/steal require a non-empty target inventory', () => {
    const p = makeAdult(1, 10, 10);
    const empty = makeAdult(2, 11, 10);
    const loaded = makeAdult(3, 9, 10);
    loaded.inventory.food = 5;
    const world = flatWorld(32, 0, 0);
    const actions = legalActions(p, makeCtx([p, empty, loaded], world), []);
    const tradeTargets = actions.filter((a) => a.kind === 'trade').map((a) => a.targetPersonId);
    const stealTargets = actions.filter((a) => a.kind === 'steal' && a.targetPersonId !== undefined).map((a) => a.targetPersonId);
    expect(tradeTargets).toEqual([3]);
    expect(stealTargets).toEqual([3]);
  });

  it('steal can also target a nearby foreign settlement with stock', () => {
    const p = makeAdult(1, 10, 10);
    p.settlementId = 1;
    const world = flatWorld(32, 0, 0);
    const foreign: Settlement = {
      id: 2,
      civId: 9,
      name: 'Rival Town',
      center: { x: 11, y: 10 },
      memberIds: [],
      stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    };
    const actions = legalActions(p, makeCtx([p], world, [foreign]), []);
    expect(actions.some((a) => a.kind === 'steal' && a.tile !== undefined)).toBe(true);
  });
});

describe('legalActions — migrate and explore', () => {
  it('migrate targets only tiles beyond PERCEPTION_RADIUS, capped at 4', () => {
    const p = makeAdult(1, 32, 32);
    const world = flatWorld(64, 0.5, 0);
    const actions = legalActions(p, makeCtx([p], world), []).filter((a) => a.kind === 'migrate');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.length).toBeLessThanOrEqual(4);
  });

  it('explore proposes ring tiles at PERCEPTION_RADIUS+1', () => {
    const p = makeAdult(1, 32, 32);
    const world = flatWorld(64, 0.5, 0);
    const actions = legalActions(p, makeCtx([p], world), []).filter((a) => a.kind === 'explore');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.length).toBeLessThanOrEqual(8);
  });
});

describe('legalActions — taboos and desperation', () => {
  it('removes taboo kinds', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0, 0);
    const withTaboo = legalActions(p, makeCtx([p], world), ['rest']);
    expect(withTaboo.some((a) => a.kind === 'rest')).toBe(false);
  });

  it('restores taboo kinds once desperation reaches the override threshold', () => {
    const p = makeAdult(1, 10, 10);
    p.needs.hunger = DESPERATION_TABOO_OVERRIDE;
    const world = flatWorld(32, 0, 0);
    const withTaboo = legalActions(p, makeCtx([p], world), ['rest']);
    expect(withTaboo.some((a) => a.kind === 'rest')).toBe(true);
  });

  it('desperation just below the threshold still removes the taboo kind', () => {
    const p = makeAdult(1, 10, 10);
    p.needs.hunger = DESPERATION_TABOO_OVERRIDE - 0.01;
    const world = flatWorld(32, 0, 0);
    const withTaboo = legalActions(p, makeCtx([p], world), ['rest']);
    expect(withTaboo.some((a) => a.kind === 'rest')).toBe(false);
  });
});

describe('legalActions — children', () => {
  it('restricts children to the reduced action set regardless of taboos or desperation', () => {
    const child = makeChild(1, 10, 10);
    child.needs.hunger = 1;
    const other = makeAdult(2, 11, 10);
    const world = flatWorld(32, 0.5, 1);
    const actions = legalActions(child, makeCtx([child, other], world), []);
    const kinds = new Set(actions.map((a) => a.kind));
    for (const kind of kinds) {
      expect(CHILD_ACTION_KINDS).toContain(kind);
    }
    expect(kinds.has('attack')).toBe(false);
    expect(kinds.has('farm')).toBe(false);
    expect(kinds.has('hunt')).toBe(false);
  });
});

describe('legalActions — completeness sanity', () => {
  it('every produced action kind is one of ACTION_KINDS', () => {
    const p = makeAdult(1, 32, 32);
    p.settlementId = 1;
    p.beliefIds = [1];
    p.inventory.wood = 1;
    const other = makeAdult(2, 33, 32, 'f');
    other.health = 0.5;
    const world = flatWorld(64, 0.5, 1);
    const actions = legalActions(p, makeCtx([p, other], world), []);
    for (const a of actions) {
      expect(ACTION_KINDS as readonly ActionKind[]).toContain(a.kind);
    }
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/agents/actions.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/agents/actions" from "tests/engine/agents/actions.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/engine/agents/actions.ts`**

Create `src/engine/agents/actions.ts` with exactly:

```ts
import {
  ADULT_AGE_TICKS,
  PERCEPTION_RADIUS,
  dist,
  type Action,
  type ActionKind,
  type Person,
  type Settlement,
  type Tick,
  type Vec2,
} from '../../shared/types';
import { isHabitable, type World } from '../world/terrain';
import type { SpatialIndex } from '../world/spatial';
import { desperationLevel } from './morality';
import { isKin } from './relationships';

/** Deviation 1: the minimal structural subset of the eventual EngineCtx candidate generation reads. */
export interface ActionsCtxLike {
  world: World;
  personById: Map<number, Person>;
  spatial: SpatialIndex;
  settlements: Settlement[];
  tick: Tick;
}

export const MIGRATE_RADIUS_MULTIPLIER = 3;
export const MIGRATE_CANDIDATE_CAP = 4;
export const EXPLORE_RING_OFFSET = 1;
export const FARM_MIN_FERTILITY = 0.3;
export const DESPERATION_TABOO_OVERRIDE = 0.95;

/** The reduced action set available to a person below ADULT_AGE_TICKS. */
export const CHILD_ACTION_KINDS: readonly ActionKind[] = ['gather', 'rest', 'socialize', 'explore', 'flee', 'teach'];

function isAdult(p: Person): boolean {
  return p.ageTicks >= ADULT_AGE_TICKS;
}

function tilesWithin(world: World, center: Vec2, radius: number): Vec2[] {
  const out: Vec2[] = [];
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (!world.inBounds(x, y)) continue;
      if (Math.hypot(dx, dy) > radius) continue;
      out.push({ x, y });
    }
  }
  return out;
}

function nearbyLivingPeople(p: Person, ctx: ActionsCtxLike): Person[] {
  const out: Person[] = [];
  for (const id of ctx.spatial.near(p.pos, PERCEPTION_RADIUS)) {
    if (id === p.id) continue;
    const other = ctx.personById.get(id);
    if (other !== undefined && other.alive) out.push(other);
  }
  return out;
}

function inventorySum(inv: { food: number; wood: number; stone: number; metal: number; tools: number }): number {
  return inv.food + inv.wood + inv.stone + inv.metal + inv.tools;
}

function farthestPointSubset(tiles: Vec2[], center: Vec2, cap: number): Vec2[] {
  if (tiles.length <= cap) return tiles;
  // Seed with the tile farthest from center, then greedily add the tile
  // farthest from all chosen so far (same heuristic as person.ts spawn regions).
  let seed = tiles[0] as Vec2;
  let seedDist = -1;
  for (const t of tiles) {
    const d = dist(t, center);
    if (d > seedDist) {
      seedDist = d;
      seed = t;
    }
  }
  const chosen: Vec2[] = [seed];
  while (chosen.length < cap) {
    let best = tiles[0] as Vec2;
    let bestMinDist = -1;
    for (const t of tiles) {
      let minDist = Infinity;
      for (const c of chosen) {
        const d = dist(t, c);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        best = t;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

function generateForAdultAndChild(p: Person, ctx: ActionsCtxLike): Action[] {
  const actions: Action[] = [];

  // rest, flee: always available.
  actions.push({ kind: 'rest' });
  actions.push({ kind: 'flee' });

  // gather: any tile within PERCEPTION_RADIUS with food > 0.
  for (const tile of tilesWithin(ctx.world, p.pos, PERCEPTION_RADIUS)) {
    if (ctx.world.tileAt(tile.x, tile.y).food > 0) actions.push({ kind: 'gather', tile });
  }

  // socialize: every nearby living person.
  for (const other of nearbyLivingPeople(p, ctx)) {
    actions.push({ kind: 'socialize', targetPersonId: other.id });
  }

  // explore: 8 compass tiles at PERCEPTION_RADIUS + EXPLORE_RING_OFFSET.
  const exploreDist = PERCEPTION_RADIUS + EXPLORE_RING_OFFSET;
  const compass: Vec2[] = [
    { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
  ];
  for (const dir of compass) {
    const tile: Vec2 = {
      x: p.pos.x + Math.round((dir.x * exploreDist) / Math.max(1, Math.hypot(dir.x, dir.y))),
      y: p.pos.y + Math.round((dir.y * exploreDist) / Math.max(1, Math.hypot(dir.x, dir.y))),
    };
    if (!ctx.world.inBounds(tile.x, tile.y)) continue;
    if (!isHabitable(ctx.world.tileAt(tile.x, tile.y).terrain)) continue;
    actions.push({ kind: 'explore', tile });
  }

  // teach: every nearby living person (receivable by a child target too, per
  // the acting-side gate applied below in legalActions).
  for (const other of nearbyLivingPeople(p, ctx)) {
    actions.push({ kind: 'teach', targetPersonId: other.id });
  }

  return actions;
}

function generateAdultOnly(p: Person, ctx: ActionsCtxLike): Action[] {
  const actions: Action[] = [];

  // farm: habitable tiles within PERCEPTION_RADIUS with fertility > FARM_MIN_FERTILITY.
  for (const tile of tilesWithin(ctx.world, p.pos, PERCEPTION_RADIUS)) {
    const t = ctx.world.tileAt(tile.x, tile.y);
    if (isHabitable(t.terrain) && t.fertility > FARM_MIN_FERTILITY) actions.push({ kind: 'farm', tile });
  }

  // hunt: one untargeted candidate.
  actions.push({ kind: 'hunt' });

  // build: one candidate per structure kind, only with a settlement.
  if (p.settlementId !== null) {
    for (const structure of ['shelter', 'granary', 'wall', 'shrine'] as const) {
      actions.push({ kind: 'build', structure });
    }
  }

  // craft: needs wood or stone.
  if (p.inventory.wood > 0 || p.inventory.stone > 0) actions.push({ kind: 'craft' });

  const neighbors = nearbyLivingPeople(p, ctx);

  // court: opposite sex, adult, unpartnered, not kin, not already partnered to self.
  for (const other of neighbors) {
    if (!isAdult(other)) continue;
    if (other.sex === p.sex) continue;
    if (other.partnerId !== null) continue;
    if (isKin(p, other.id)) continue;
    if (p.partnerId === other.id) continue;
    actions.push({ kind: 'court', targetPersonId: other.id });
  }

  // trade: non-empty target inventory.
  for (const other of neighbors) {
    if (inventorySum(other.inventory) > 0) actions.push({ kind: 'trade', targetPersonId: other.id });
  }

  // share: every nearby living person.
  for (const other of neighbors) {
    actions.push({ kind: 'share', targetPersonId: other.id });
  }

  // steal: non-empty target inventory, or a nearby foreign settlement with stock.
  for (const other of neighbors) {
    if (inventorySum(other.inventory) > 0) actions.push({ kind: 'steal', targetPersonId: other.id });
  }
  for (const settlement of ctx.settlements) {
    if (settlement.id === p.settlementId) continue;
    if (dist(p.pos, settlement.center) > PERCEPTION_RADIUS) continue;
    if (inventorySum(settlement.stock) > 0) actions.push({ kind: 'steal', tile: settlement.center });
  }

  // attack: not kin.
  for (const other of neighbors) {
    if (isKin(p, other.id)) continue;
    actions.push({ kind: 'attack', targetPersonId: other.id });
  }

  // migrate: habitable tiles beyond PERCEPTION_RADIUS but within
  // PERCEPTION_RADIUS * MIGRATE_RADIUS_MULTIPLIER, capped via farthest-point subset.
  const migrateOuter = tilesWithin(ctx.world, p.pos, PERCEPTION_RADIUS * MIGRATE_RADIUS_MULTIPLIER).filter(
    (t) => dist(t, p.pos) > PERCEPTION_RADIUS && isHabitable(ctx.world.tileAt(t.x, t.y).terrain),
  );
  for (const tile of farthestPointSubset(migrateOuter, p.pos, MIGRATE_CANDIDATE_CAP)) {
    actions.push({ kind: 'migrate', tile });
  }

  // worship: requires at least one belief.
  if (p.beliefIds.length > 0) actions.push({ kind: 'worship' });

  // heal: nearby living person with health < 1.
  for (const other of neighbors) {
    if (other.health < 1) actions.push({ kind: 'heal', targetPersonId: other.id });
  }

  return actions;
}

/**
 * Contract signature (ActionsCtxLike per deviation 1; taboos passed
 * explicitly since Temperament is Task 20). Generates every legal candidate
 * action for p, removes taboo kinds unless desperation reaches
 * DESPERATION_TABOO_OVERRIDE, and restricts children to CHILD_ACTION_KINDS
 * regardless of taboos or desperation.
 */
export function legalActions(p: Person, ctx: ActionsCtxLike, taboos: ActionKind[]): Action[] {
  let actions = generateForAdultAndChild(p, ctx);
  if (isAdult(p)) actions = actions.concat(generateAdultOnly(p, ctx));

  if (!isAdult(p)) {
    // Restrict to the reduced child set. 'teach' is listed in
    // CHILD_ACTION_KINDS to document that a child can be a teach *target* of
    // someone else's candidate, but a child never generates a 'teach'
    // candidate as the acting person, so it is dropped here too.
    actions = actions.filter((a) => CHILD_ACTION_KINDS.includes(a.kind) && a.kind !== 'teach');
  }

  if (taboos.length === 0) return actions;
  const desperate = desperationLevel(p) >= DESPERATION_TABOO_OVERRIDE;
  if (desperate) return actions;
  const tabooSet = new Set(taboos);
  return actions.filter((a) => !tabooSet.has(a.kind));
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/agents/actions.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/agents/actions.test.ts (19 tests)

 Test Files  1 passed (1)
      Tests  19 passed (19)
```

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/agents/actions.ts tests/engine/agents/actions.test.ts
git commit -m "feat(agents): action catalog with legality, taboo and child filtering" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 15: Action execution (`src/engine/agents/execute.ts`)

**Files:**
- Create: `src/engine/agents/execute.ts`
- Test: `tests/engine/agents/execute.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Action`, `ActionKind`, `ACTION_KINDS`, `Civ`, `Settlement`, `StructureKind`, `TechId`, `Tick`, `Vec2`, `Emotions`, `clamp(v, lo, hi): number`, `clamp01(v): number`, `dist(a, b): number`
- From `src/engine/rng.ts` (Task 2): `Rng`; tests also use `createRng`
- From `src/engine/world/terrain.ts` (Task 5): `World`, `isHabitable(terrain): boolean`; tests also use `generateWorld`
- From `src/engine/world/spatial.ts` (Task 7): `stepToward(from, to, world): Vec2`
- From `src/engine/agents/needs.ts` (Task 9): `markFed(p: Person): void`
- From `src/engine/agents/emotions.ts` (Task 10): `applyEmotionImpulse(p, impulse, volatility): void`
- From `src/engine/agents/memory.ts` (Task 12): `remember(p, rec): void`
- From `src/engine/agents/relationships.ts` (Task 13): `adjustRelationship(p, otherId, kind, delta): void`, `affinityTo(p, otherId): number`
- Tests also use `createPerson` (Task 8)

Produces:
- `export interface TechCtxLike { yieldMultiplier(civ: Civ, action: ActionKind): number; addKnowledge(civ: Civ, domain: TechId, points: number): void }` — deviation 2: the structural stand-in for the not-yet-written Task 29 `technology.ts`. Task 15's own tests inject a stub (`yieldMultiplier` returns `1`, `addKnowledge` a no-op); Task 33 wires `{ yieldMultiplier: techYieldMultiplier, addKnowledge }` from the real Task 29 module.
- `export interface ExecuteCtxLike { world: World; personById: Map<number, Person>; civs: Civ[]; settlements: Settlement[]; tick: Tick; rng: Rng; tech: TechCtxLike }` — deviation 1: the minimal structural subset of the eventual `EngineCtx` execution reads. `EngineCtx` (Task 33) plus its own `ctx.tech` wiring is a superset, so Task 33 passes its `ctx` directly once `ctx.tech` is attached.
- `export interface Outcome { action: Action; success: boolean; reward: number; tick: Tick }` — contract signature verbatim, reward always in `[-1, 1]`.
- `export function executeAction(p: Person, a: Action, ctx: ExecuteCtxLike, emotionVolatility: Emotions): Outcome` — deviation 5: takes the acting person's `temperament().emotionVolatility` as an explicit fourth parameter (no brain registry access from this file). Implements every `ActionKind` per the table below. Movement embedding: for any action whose target is a `tile` farther than one adjacent step (`dist(p.pos, a.tile) > Math.SQRT2 + 1e-9`), execution instead performs exactly one `stepToward(p.pos, a.tile, ctx.world)` move, mutates `p.pos`, and returns `{ action: a, success: true, reward: MOVEMENT_PROGRESS_REWARD (0.05), tick: ctx.tick }` without running the kind's own effect this tick (the effect runs on a later tick once the person is adjacent). This applies to `gather`, `farm`, `steal` (tile form), `migrate`, `explore` — any action carrying a `tile` — and is checked once, generically, before the per-kind `switch`.
- Exported tuning constants (every number the brief calls for, concrete): `MOVEMENT_PROGRESS_REWARD = 0.05`, `GATHER_SKILL_PRACTICE = 0.002`, `GATHER_BASE_YIELD = 0.5`, `FARM_YIELD_BASE = 1.5`, `HUNT_BASE_CHANCE = 0.35`, `HUNT_SKILL_BONUS = 0.4`, `HUNT_FOOD_YIELD = 2.0`, `HUNT_INJURY_CHANCE = 0.25`, `HUNT_INJURY_HEALTH = 0.1`, `BUILD_WOOD_COST = 10`, `BUILD_STONE_COST = 5`, `BUILD_PROGRESS_PER_TICK = 1`, `STRUCTURE_COMPLETE_PROGRESS = 60`, `CRAFT_WOOD_COST = 2`, `CRAFT_STONE_COST = 1`, `CRAFT_TOOLS_YIELD = 1`, `REST_RECOVERY = 0.3`, `REST_HEALTH_REGEN = 0.01`, `SOCIALIZE_AFFINITY_GAIN = 0.02`, `SOCIALIZE_BELONGING_RELIEF = 0.05`, `BELIEF_SPREAD_CHANCE_BASE = 0.1`, `COURT_AFFINITY_THRESHOLD = 0.3`, `COURT_AFFINITY_BUMP = 0.05`, `TEACH_SKILL_RATE = 0.05`, `TEACH_MORALITY_NUDGE = 0.02` (mirrors `learning.ts`'s constants of the same name and value; `execute.ts` predates Task 18, so it implements the transfer inline rather than importing — Task 33's wiring note below reconciles this), `TRADE_SWAP_AMOUNT = 1`, `SHARE_AMOUNT = 1`, `STEAL_PERSON_AMOUNT = 1`, `STEAL_SETTLEMENT_AMOUNT = 2`, `STEAL_PERCEIVED_CHANCE_BASE = 0.5`, `ATTACK_DAMAGE_MIN = 0.15`, `ATTACK_DAMAGE_MAX = 0.4`, `ATTACK_KILL_HEALTH_THRESHOLD = 0` (death is health reaching 0, handled by `lifecycle.ts`, Task 17 — `execute.ts` only ever lowers health and sets `causeOfDeath = 'violence'` when it drives health to `<= 0`), `FLEE_STEPS = 2`, `WORSHIP_ZEAL_UPKEEP = 0.01`, `WORSHIP_SANCTITY_NUDGE = 0.01`, `WORSHIP_ESTEEM_RELIEF = 0.03`, `EXPLORE_CURIOSITY_REWARD = 0.1`, `EXPLORE_WONDER_CHANCE = 0.02`, `HEAL_BASE_RECOVERY = 0.1`, `HEAL_MEDICINE_MULTIPLIER = 1.5`.
- Every branch calls `markFed(p)` on any action that adds food to `p.inventory.food` or reduces `p.needs.hunger` directly (`gather`, `farm`, `hunt`, `share` receiving, `trade` receiving food, `steal` receiving food).

Per-`ActionKind` effect table (all concrete, implemented below exactly):

| Kind | Effect |
|---|---|
| `gather` | `amount = min(tile.food, GATHER_BASE_YIELD + p.skills.gathering)`; `tile.food -= amount`; `p.inventory.food += amount`; `markFed(p)`; `p.skills.gathering = clamp01(p.skills.gathering + GATHER_SKILL_PRACTICE)`; `ctx.tech.addKnowledge(civ, 'fire', amount)` and `ctx.tech.addKnowledge(civ, 'agriculture', amount * 0.2)` (gathering feeds both fire and, faintly, agriculture curiosity); reward `= clamp(amount / 2, -1, 1)`; success `= amount > 0`. |
| `farm` | Legality already restricted to fertile habitable tiles (Task 14); if the tile additionally fails `isHabitable` at execution time (can happen if terrain changed) the action fails with reward `-0.1`. Otherwise `yield = FARM_YIELD_BASE * p.skills.farming * ctx.tech.yieldMultiplier(civ, 'farm')`; `tile.food += yield` then `amount = min(tile.food, yield)` harvested immediately into `p.inventory.food` (farm both plants and reaps this tick, modeling a tended plot); `tile.food -= amount`; `markFed(p)`; `p.skills.farming = clamp01(p.skills.farming + GATHER_SKILL_PRACTICE)`; `ctx.tech.addKnowledge(civ, 'agriculture', amount)`; reward `= clamp(amount / 3, -1, 1)`; success `= amount > 0`. |
| `hunt` | `chance = clamp01(HUNT_BASE_CHANCE + HUNT_SKILL_BONUS * p.skills.fighting)`; on `ctx.rng.chance(chance)` success: `p.inventory.food += HUNT_FOOD_YIELD`; `markFed(p)`; reward `= 0.6`; on failure: reward `= -0.2`; independently, on `ctx.rng.chance(HUNT_INJURY_CHANCE)` (checked regardless of success/failure): `p.health = clamp01(p.health - HUNT_INJURY_HEALTH)`, `applyEmotionImpulse(p, { fear: 0.2 }, emotionVolatility)`, reward reduced by `0.1` (still clamped to `[-1,1]`); `p.skills.fighting = clamp01(p.skills.fighting + GATHER_SKILL_PRACTICE)`; success `=` the hunt roll. |
| `build` | Requires `p.settlementId !== null` and the settlement resolvable in `ctx.settlements`, else reward `-0.1`, success `false`. Otherwise: `woodSpend = min(p.inventory.wood, BUILD_WOOD_COST)`, `stoneSpend = min(p.inventory.stone, BUILD_STONE_COST)`; if both are `0`, reward `-0.05`, success `false` (nothing to contribute); else deduct from `p.inventory`, add `(woodSpend + stoneSpend) * BUILD_PROGRESS_PER_TICK` to a per-structure progress counter kept as an extension field `settlement._buildProgress` (a plain `Record<StructureKind, number>`, created on first use, JSON-serializable); a single maximal contribution (`BUILD_WOOD_COST + BUILD_STONE_COST = 15`) is deliberately well under `STRUCTURE_COMPLETE_PROGRESS = 60`, so a structure always takes several build actions (concretely at least 4, at most 5 at the 15/tick maximal rate) — modeling a settlement project as sustained group labor, not one worker's afternoon; when a structure's accumulated progress reaches the threshold, `settlement.structures[structure] += 1` and progress resets to `0`; `p.skills.building = clamp01(p.skills.building + GATHER_SKILL_PRACTICE)`; `ctx.tech.addKnowledge(civ, 'construction', woodSpend + stoneSpend)`; reward `= clamp((woodSpend + stoneSpend) / 15, -1, 1)`; success `= true`. |
| `craft` | `woodSpend = min(p.inventory.wood, CRAFT_WOOD_COST)`, `stoneSpend = min(p.inventory.stone, CRAFT_STONE_COST)`; if `woodSpend < CRAFT_WOOD_COST || stoneSpend < CRAFT_STONE_COST`, reward `-0.05`, success `false` (not enough material — legality only checked "some" wood/stone, execution needs the full cost); else deduct both, `p.inventory.tools += CRAFT_TOOLS_YIELD`; `p.skills.crafting = clamp01(p.skills.crafting + GATHER_SKILL_PRACTICE)`; `ctx.tech.addKnowledge(civ, 'metallurgy', CRAFT_TOOLS_YIELD)`; reward `= 0.3`; success `= true`. |
| `rest` | `p.needs.rest = clamp01(p.needs.rest - REST_RECOVERY)`; `p.health = clamp01(p.health + REST_HEALTH_REGEN)`; reward `= clamp(REST_RECOVERY, -1, 1)` scaled by prior urgency: concretely `reward = clamp(0.3 * (priorRest), -1, 1)` where `priorRest` is `p.needs.rest` **before** the subtraction (resting when already rested yields little reward, resting when exhausted yields more); success `= true` always. |
| `socialize` | Requires `a.targetPersonId` resolvable and alive in `ctx.personById`, else reward `-0.05`, success `false`. Otherwise: `adjustRelationship(p, target.id, currentKindOr('friend'), SOCIALIZE_AFFINITY_GAIN)` and the mirrored call on `target`; `p.needs.belonging = clamp01(p.needs.belonging - SOCIALIZE_BELONGING_RELIEF)`, same for `target`; belief spread: if `p.beliefIds.length > 0` and `target.beliefIds` doesn't already contain that belief, `ctx.rng.chance(BELIEF_SPREAD_CHANCE_BASE)` adds `p.beliefIds[0]` to `target.beliefIds` (the first-listed belief is the one "currently being talked about" — a simplification documented here); reward `= 0.2`; success `= true`. `currentKindOr('friend')` reads the existing relationship kind if one exists (via a local lookup, not re-exported) so repeated socializing never downgrades an existing `'kin'`/`'partner'`/`'rival'` label back to `'friend'`. |
| `court` | Requires `a.targetPersonId` resolvable, alive, else reward `-0.05`/`false`. If `affinityTo(p, target.id) > COURT_AFFINITY_THRESHOLD` and both `p.partnerId === null` and `target.partnerId === null` and both are adults (age checked directly here, not re-imported, via `p.ageTicks >= ADULT_AGE_TICKS`): `p.partnerId = target.id`; `target.partnerId = p.id`; `adjustRelationship` both directions with kind `'partner'`, delta `0.2`; `applyEmotionImpulse(p, { joy: 0.4, hope: 0.2 }, emotionVolatility)` and the same on `target`; reward `= 0.8`; success `= true`. Otherwise: `adjustRelationship` both directions with kind `'friend'`, delta `COURT_AFFINITY_BUMP`; reward `= 0.15`; success `= true` (courting always "succeeds" at nudging affinity even without pairing). |
| `teach` | Requires `a.targetPersonId` resolvable, alive, else reward `-0.05`/`false`. Finds the teacher's (`p`'s) best skill (first-in-`SKILL_NAMES`-order on ties, same rule as `learning.ts`'s `teach`); `target.skills[best] = clamp01(target.skills[best] + TEACH_SKILL_RATE * p.skills.teaching)`; every morality foundation of `target` moves `TEACH_MORALITY_NUDGE` toward `p`'s; `remember(target, { tick, kind: 'taught', otherId: p.id, valence: 0.5, salience: 0.4 })`; `p.skills.teaching = clamp01(p.skills.teaching + GATHER_SKILL_PRACTICE)`; `ctx.tech.addKnowledge(civ, 'writing', 1)`; reward `= 0.3`; success `= true`. (This inlines the same formula `learning.ts`'s exported `teach()` implements — Task 33's wiring note explains the reconciliation.) |
| `trade` | Requires `a.targetPersonId` resolvable, alive, else reward `-0.05`/`false`. Personal 1:1 barter: finds `p`'s largest-surplus resource among `food/wood/stone/metal` (the one `p` has the most of) and `target`'s largest-surplus resource that is *different* from `p`'s pick (the resource `p` is relatively short on, from what's available); swaps `TRADE_SWAP_AMOUNT` of each if both have at least that much, else reward `-0.05`/`false`; on success both `p.inventory` and `target.inventory` are updated (give one resource, receive the other); if either side's received resource is `food`, that side's `markFed` is called; small mutual affinity bump `adjustRelationship` both directions delta `0.03`; reward `= 0.3`; success `= true`. |
| `share` | Requires `a.targetPersonId` resolvable, alive, else reward `-0.05`/`false`. If `p.inventory.food < SHARE_AMOUNT`, reward `-0.05`, success `false`. Else `p.inventory.food -= SHARE_AMOUNT`; `target.inventory.food += SHARE_AMOUNT`; `markFed(target)`; `remember(p, { tick, kind: 'shared', otherId: target.id, valence: 0.6, salience: 0.4 })`; `remember(target, { tick, kind: 'helped', otherId: p.id, valence: 0.6, salience: 0.5 })`; `adjustRelationship` both directions delta `0.05`; `applyEmotionImpulse(p, { joy: 0.15 }, emotionVolatility)` (care-driven warm glow); reward `= 0.4 * p.traits.empathy + 0.1` (more rewarding for empathetic people, floor 0.1); success `= true`. |
| `steal` (person) | Requires `a.targetPersonId` resolvable, alive, else reward `-0.05`/`false`. If `target.inventory.food + target.inventory.wood + target.inventory.stone + target.inventory.metal + target.inventory.tools < STEAL_PERSON_AMOUNT`, reward `-0.05`, success `false`. Else takes `STEAL_PERSON_AMOUNT` from the target's largest non-zero resource, adds it to `p.inventory` (food gain calls `markFed(p)`); perceived chance `= clamp01(STEAL_PERCEIVED_CHANCE_BASE - 0.3 * p.skills.fighting + 0.3 * target.skills.fighting)`; on `ctx.rng.chance(perceivedChance)`: `remember(target, { tick, kind: 'stolen', otherId: p.id, valence: -0.7, salience: 0.6 })`, `applyEmotionImpulse(target, { anger: 0.3 }, emotionVolatility)`, `adjustRelationship(target, p.id, 'rival', -0.2)`; `applyEmotionImpulse(p, { anger: 0 }, emotionVolatility)` is skipped (stealing doesn't anger the thief) but `p`'s own fear ticks up slightly if perceived: `applyEmotionImpulse(p, { fear: 0.1 }, emotionVolatility)` only when perceived; reward `= 0.35` regardless of perception (the theft itself succeeded); success `= true`. |
| `steal` (settlement, `a.tile` set, adjacent) | Requires `a.tile` to match a settlement in `ctx.settlements` within `1` tile, else reward `-0.1`/`false`. If `stock` totals `< STEAL_SETTLEMENT_AMOUNT`, reward `-0.05`, success `false`. Else takes `STEAL_SETTLEMENT_AMOUNT` from the settlement's largest non-zero stock resource into `p.inventory` (food gain calls `markFed(p)`); every living member of that settlement (via `ctx.personById`, filtered by `settlementId`) gets `applyEmotionImpulse(member, { anger: 0.15 }, emotionVolatility)` at `STEAL_PERCEIVED_CHANCE_BASE` chance (settlement raids are noisier than personal theft, but still not certain); reward `= 0.5`; success `= true`. |
| `attack` | Requires `a.targetPersonId` resolvable, alive, else reward `-0.1`/`false`. Opposed roll: `pRoll = p.skills.fighting + 0.3 * ctx.tech.yieldMultiplier(pCiv, 'attack') - 0.3 + ctx.rng.range(0, 0.5)`, `tRoll = target.skills.fighting + ctx.rng.range(0, 0.5)` (the attacker's roll includes a metallurgy-derived bonus via `yieldMultiplier`, the contract's "modified by metallurgy tools"); if `pRoll > tRoll`: attacker wins, `damage = ATTACK_DAMAGE_MIN + (ATTACK_DAMAGE_MAX - ATTACK_DAMAGE_MIN) * clamp01(pRoll - tRoll)` applied to `target.health` (clamped at 0); if `target.health` reaches `0`, `target.causeOfDeath = 'violence'`; `remember(target, { tick, kind: 'harmed', otherId: p.id, valence: -0.9, salience: 0.9 })`; `applyEmotionImpulse(target, { fear: 0.4, anger: 0.3 }, targetVolatility)` — but since `execute.ts` only receives the **acting** person's volatility (deviation 5), the victim's impulse uses the same neutral-multiplier fallback `{ fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 }` `lifecycle.ts` uses for grief (documented explicitly: only the actor's own impulses use `emotionVolatility`; every impulse applied to another party in any action uses this same `NEUTRAL_IMPULSE` constant, exported for reuse); `adjustRelationship(target, p.id, 'rival', -0.4)`; `applyEmotionImpulse(p, { anger: -0.1 }, emotionVolatility)` (a spent-aggression cool-down) and if `target` died, `applyEmotionImpulse(p, {}, emotionVolatility)` is a no-op but a `remember(p, { tick, kind: 'victory', otherId: target.id, valence: 0.5, salience: 0.6 })` is added; reward `= clamp(0.5 + 0.3 * (target.health <= 0 ? 1 : 0), -1, 1)`; success `= true`. If `pRoll <= tRoll`: defender wins the exchange — symmetric damage to `p` instead (`damage` formula with roles reversed), `p`'s own `applyEmotionImpulse(p, { fear: 0.4, anger: 0.2 }, emotionVolatility)`, `remember(p, { tick, kind: 'defeat', otherId: target.id, valence: -0.6, salience: 0.6 })`, `remember(target, { tick, kind: 'harmed', otherId: p.id, valence: -0.9, salience: 0.9 }, )` is NOT added (the target successfully defended and takes no harm memory — only `p` is harmed in this branch); if `p.health` reaches `0`, `p.causeOfDeath = 'violence'`; reward `= -0.5` (clamped); success `= false`. Kin targets never reach here (Task 14 legality excludes kin), but `execute.ts` does not re-check kinship — it trusts the candidate list, matching every other action. |
| `flee` | Two `stepToward` moves away from the nearest danger: the nearest living person with `affinityTo(p, id) < -0.3` (a rival/threat) within perception, or if none, the settlement/tile the person last recorded a `'harmed'`/`'death-witnessed'` memory near (approximated here as: if no hostile neighbor found via `ctx.personById` scan restricted to same-tile-or-adjacent people — `flee` has no spatial index in its ctx-like interface, so it scans only people already known to be nearby via `p`'s own memory of recent `'harmed'` events' `otherId`, resolving their last known `pos` — if that other person is still alive and within `FLEE_STEPS * 2` tiles; if no danger source resolves at all, `flee` behaves like an anxious `rest`: `p.needs.rest = clamp01(p.needs.rest - 0.1)`, reward `0.05`, success `true`). When a danger position is found: compute `away = { x: p.pos.x + (p.pos.x - danger.x), y: p.pos.y + (p.pos.y - danger.y) }` (the point directly opposite the danger through `p`), then call `stepToward(p.pos, away, ctx.world)` exactly `FLEE_STEPS` (2) times in sequence, updating `p.pos` after each; `applyEmotionImpulse(p, { fear: -0.1 }, emotionVolatility)` (fleeing is a small relief); reward `= 0.1`; success `= true` (fleeing always "succeeds" at fleeing, even if blocked by water and `stepToward` returns the same tile both times). |
| `migrate` (adjacent) | Once adjacent to `a.tile` (movement embedding has already handled the multi-tick approach): `p.pos = { ...a.tile }`; if `p.settlementId !== null`, `p.settlementId = null` (leaving the old settlement — `updateSettlements`, Task 26, will assign a new one later if warranted); reward `= 0.1`; success `= true`. |
| `worship` | Requires `p.beliefIds.length > 0`, else reward `-0.05`/`false`. `p.morality.sanctity = clamp01(p.morality.sanctity + WORSHIP_SANCTITY_NUDGE)`; `p.needs.esteem = clamp01(p.needs.esteem - WORSHIP_ESTEEM_RELIEF)`; zeal maintenance is modeled as a small `p.emotions.hope` bump: `applyEmotionImpulse(p, { hope: WORSHIP_ZEAL_UPKEEP }, emotionVolatility)`; reward `= 0.15`; success `= true`. |
| `explore` | Once adjacent to `a.tile` (movement embedding handles the approach — most `explore` candidates start beyond one step, since they're generated at `PERCEPTION_RADIUS + 1`): `p.pos = { ...a.tile }`; `applyEmotionImpulse(p, { hope: 0.1 }, emotionVolatility)` (curiosity reward, contract's "curiosity reward"); on `ctx.rng.chance(EXPLORE_WONDER_CHANCE)`: `remember(p, { tick, kind: 'wonder', otherId: p.id, valence: 0.8, salience: 0.7 })` and an extra `applyEmotionImpulse(p, { joy: 0.2 }, emotionVolatility)`; reward `= EXPLORE_CURIOSITY_REWARD` (plus `0.1` more if a wonder triggered, clamped to `[-1,1]`); success `= true`. |
| `heal` | Requires `a.targetPersonId` resolvable, alive, else reward `-0.05`/`false`. `recovery = HEAL_BASE_RECOVERY * p.skills.healing * ctx.tech.yieldMultiplier(civ, 'heal')` (the contract's "medicine multiplier" flows through the same `yieldMultiplier` hook as every other tech bonus); `target.health = clamp01(target.health + recovery)`; `remember(target, { tick, kind: 'helped', otherId: p.id, valence: 0.7, salience: 0.5 })`; `p.skills.healing = clamp01(p.skills.healing + GATHER_SKILL_PRACTICE)`; `ctx.tech.addKnowledge(civ, 'medicine', recovery * 10)`; `adjustRelationship` both directions delta `0.05`; reward `= clamp(recovery * 2, -1, 1)`; success `= true`. |

Every branch's reward is passed through a final `clamp(reward, -1, 1)` and checked for `Number.isFinite` before being placed in the returned `Outcome` (a defensive `Number.isFinite(reward) ? reward : 0` guard at the very end of `executeAction`, so a future edit introducing a division-by-zero can never leak a `NaN` or `Infinity` into the tick loop).

Wiring notes for Task 33 (binding):
- Task 33 tick step 3 calls `executeAction(p, action, ctx, getBrain(p.lineage).temperament().emotionVolatility)` where `ctx.tech = { yieldMultiplier: techYieldMultiplier, addKnowledge }` (Task 29) has been attached once at `Simulation` construction.
- The `teach` branch here is a complete, working inline implementation (it does not defer to `learning.ts`). Task 18's `learning.ts` (Section 4) independently exports a `teach()` function with the identical formula for the `maybeImitate`/general-purpose learning path; the two are intentionally duplicated with matching constants (`TEACH_SKILL_RATE = 0.05`, `TEACH_MORALITY_NUDGE = 0.02` in both files) rather than cross-imported, because `execute.ts` (Task 15) is written before `learning.ts` (Task 18) and `src/engine/agents/execute.ts` must not gain a forward dependency on a later task. Task 33 does not need to reconcile anything further — both call sites already do the right thing independently.
- `Settlement._buildProgress` is an extension property (same pattern as `lifecycle.ts`'s `infectedUntil`): `export function buildProgressOf(s: Settlement, structure: StructureKind): number` and `export function setBuildProgress(s: Settlement, structure: StructureKind, value: number): void` are exported so Task 26 (`settlements.ts`) and Task 35 (`snapshot.ts`) can read/reset it without reaching into the extension property directly.
- `NEUTRAL_IMPULSE: Emotions = { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 }` is exported for reuse by any later module that applies an emotion impulse to a person other than the current actor (already the pattern `lifecycle.ts`, Section 4, established for grief).

- [ ] **Step 1: Write the failing execute tests**

Create `tests/engine/agents/execute.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  MOVEMENT_PROGRESS_REWARD,
  NEUTRAL_IMPULSE,
  buildProgressOf,
  executeAction,
  type ExecuteCtxLike,
  type TechCtxLike,
} from '../../../src/engine/agents/execute';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import { World } from '../../../src/engine/world/terrain';
import {
  ACTION_KINDS,
  ADULT_AGE_TICKS,
  type Action,
  type ActionKind,
  type Civ,
  type Person,
  type Settlement,
  type Tile,
} from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function flatWorld(size: number, fertility = 0.5, food = 3, wood = 10, stone = 10): World {
  const tiles: Tile[] = Array.from({ length: size * size }, () => ({
    terrain: 'plains',
    fertility,
    food,
    wood,
    stone,
    metal: 0,
  }));
  return new World(size, tiles);
}

function stubTech(): TechCtxLike {
  return {
    yieldMultiplier: () => 1,
    addKnowledge: () => {},
  };
}

function makeCiv(): Civ {
  return {
    id: 0,
    name: 'Testia',
    color: '#fff',
    knowledge: { fire: 0, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
    techs: [],
    atWarWith: [],
    warWeariness: 0,
  };
}

function makeCtx(people: Person[], world: World, settlements: Settlement[] = [], civ = makeCiv(), tick = 1000): ExecuteCtxLike {
  return {
    world,
    personById: new Map(people.map((p) => [p.id, p])),
    civs: [civ],
    settlements,
    tick,
    rng: createRng(42),
    tech: stubTech(),
  };
}

function makeAdult(id: number, x: number, y: number): Person {
  const p = createPerson(id, 0, 'fable', { x, y }, names, createRng(id + 1));
  p.ageTicks = 20 * 360;
  p.needs.hunger = 0.3;
  p.needs.rest = 0.5;
  p.health = 0.8;
  return p;
}

const NEUTRAL_VOLATILITY = NEUTRAL_IMPULSE;

describe('executeAction — movement embedding', () => {
  it('a distant tile target becomes one stepToward move with success and MOVEMENT_PROGRESS_REWARD', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    const action: Action = { kind: 'gather', tile: { x: 20, y: 10 } };
    const outcome = executeAction(p, action, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(outcome.reward).toBeCloseTo(MOVEMENT_PROGRESS_REWARD, 6);
    expect(p.pos).not.toEqual({ x: 10, y: 10 });
    expect(p.inventory.food).toBe(0); // the gather effect itself did not run this tick
  });
});

describe('executeAction — gather', () => {
  it('harvests min(tile.food, base+skill) into inventory, practices skill, marks fed', () => {
    const p = makeAdult(1, 10, 10);
    p.skills.gathering = 0.1;
    const world = flatWorld(64, 0.5, 0.3); // tile.food = 0.3 < base+skill
    const ctx = makeCtx([p], world);
    const before = p.skills.gathering;
    const outcome = executeAction(p, { kind: 'gather', tile: { x: 10, y: 10 } }, ctx, NEUTRAL_VOLATILITY);
    expect(p.inventory.food).toBeCloseTo(0.3, 6);
    expect(world.tileAt(10, 10).food).toBeCloseTo(0, 6);
    expect(p.skills.gathering).toBeGreaterThan(before);
    expect(outcome.success).toBe(true);
    expect(outcome.reward).toBeGreaterThan(0);
  });
});

describe('executeAction — farm', () => {
  it('yields 1.5*skill*techMultiplier scaled food into inventory', () => {
    const p = makeAdult(1, 10, 10);
    p.skills.farming = 0.4;
    const world = flatWorld(64, 0.5, 0);
    const ctx = makeCtx([p], world);
    const outcome = executeAction(p, { kind: 'farm', tile: { x: 10, y: 10 } }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(p.inventory.food).toBeGreaterThan(0);
    expect(p.inventory.food).toBeCloseTo(1.5 * 0.4 * 1, 6);
  });
});

describe('executeAction — hunt', () => {
  it('grants food on a successful roll and marks fed', () => {
    const p = makeAdult(1, 10, 10);
    p.skills.fighting = 1;
    const world = flatWorld(64);
    // rng.chance(true-ish): use a stub rng that always succeeds and never injures
    const ctx = makeCtx([p], world);
    ctx.rng = { ...ctx.rng, chance: (prob: number) => prob > 0.5 } as typeof ctx.rng;
    const outcome = executeAction(p, { kind: 'hunt' }, ctx, NEUTRAL_VOLATILITY);
    expect(p.inventory.food).toBeGreaterThan(0);
    expect(outcome.success).toBe(true);
  });

  it('never produces NaN across many rolls', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    for (let i = 0; i < 100; i++) {
      const outcome = executeAction(p, { kind: 'hunt' }, ctx, NEUTRAL_VOLATILITY);
      expect(Number.isFinite(outcome.reward)).toBe(true);
      expect(outcome.reward).toBeGreaterThanOrEqual(-1);
      expect(outcome.reward).toBeLessThanOrEqual(1);
    }
  });
});

describe('executeAction — build', () => {
  it('consumes wood/stone and accumulates structure progress toward completion', () => {
    const p = makeAdult(1, 10, 10);
    p.settlementId = 1;
    p.inventory.wood = 10;
    p.inventory.stone = 5;
    const settlement: Settlement = {
      id: 1,
      civId: 0,
      name: 'Home',
      center: { x: 10, y: 10 },
      memberIds: [1],
      stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    };
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [settlement]);
    executeAction(p, { kind: 'build', structure: 'shelter' }, ctx, NEUTRAL_VOLATILITY);
    expect(p.inventory.wood).toBe(0);
    expect(p.inventory.stone).toBe(0);
    expect(buildProgressOf(settlement, 'shelter')).toBeCloseTo(15, 6);
  });

  it('completes a structure once progress reaches the threshold', () => {
    const p = makeAdult(1, 10, 10);
    p.settlementId = 1;
    const settlement: Settlement = {
      id: 1,
      civId: 0,
      name: 'Home',
      center: { x: 10, y: 10 },
      memberIds: [1],
      stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    };
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [settlement]);
    for (let i = 0; i < 5; i++) {
      p.inventory.wood = 10;
      p.inventory.stone = 5;
      executeAction(p, { kind: 'build', structure: 'shelter' }, ctx, NEUTRAL_VOLATILITY);
    }
    expect(settlement.structures.shelter).toBe(1);
  });
});

describe('executeAction — craft', () => {
  it('requires the full material cost, yields a tool on success', () => {
    const p = makeAdult(1, 10, 10);
    p.inventory.wood = 1; // less than CRAFT_WOOD_COST (2)
    p.inventory.stone = 5;
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    const fail = executeAction(p, { kind: 'craft' }, ctx, NEUTRAL_VOLATILITY);
    expect(fail.success).toBe(false);
    expect(p.inventory.tools).toBe(0);
    p.inventory.wood = 2;
    const ok = executeAction(p, { kind: 'craft' }, ctx, NEUTRAL_VOLATILITY);
    expect(ok.success).toBe(true);
    expect(p.inventory.tools).toBe(1);
  });
});

describe('executeAction — rest', () => {
  it('reduces rest need and regenerates a little health', () => {
    const p = makeAdult(1, 10, 10);
    p.needs.rest = 0.8;
    p.health = 0.5;
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    const outcome = executeAction(p, { kind: 'rest' }, ctx, NEUTRAL_VOLATILITY);
    expect(p.needs.rest).toBeLessThan(0.8);
    expect(p.health).toBeGreaterThan(0.5);
    expect(outcome.success).toBe(true);
  });
});

describe('executeAction — socialize', () => {
  it('raises mutual affinity and relieves belonging', () => {
    const p = makeAdult(1, 10, 10);
    const other = makeAdult(2, 11, 10);
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    p.needs.belonging = 0.5;
    other.needs.belonging = 0.5;
    executeAction(p, { kind: 'socialize', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(p.relationships.find((r) => r.otherId === 2)?.affinity).toBeGreaterThan(0);
    expect(other.relationships.find((r) => r.otherId === 1)?.affinity).toBeGreaterThan(0);
    expect(p.needs.belonging).toBeLessThan(0.5);
  });
});

describe('executeAction — court', () => {
  it('pairs partners when affinity exceeds the threshold', () => {
    const p = makeAdult(1, 10, 10);
    p.sex = 'm';
    const other = makeAdult(2, 11, 10);
    other.sex = 'f';
    p.relationships = [{ otherId: 2, kind: 'friend', affinity: 0.5 }];
    other.relationships = [{ otherId: 1, kind: 'friend', affinity: 0.5 }];
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    const outcome = executeAction(p, { kind: 'court', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(p.partnerId).toBe(2);
    expect(other.partnerId).toBe(1);
    expect(outcome.reward).toBeCloseTo(0.8, 6);
  });

  it('only bumps affinity below the threshold', () => {
    const p = makeAdult(1, 10, 10);
    p.sex = 'm';
    const other = makeAdult(2, 11, 10);
    other.sex = 'f';
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    executeAction(p, { kind: 'court', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(p.partnerId).toBeNull();
    expect(p.relationships.find((r) => r.otherId === 2)?.affinity).toBeGreaterThan(0);
  });
});

describe('executeAction — teach', () => {
  it("transfers the teacher's best skill and nudges morality", () => {
    const p = makeAdult(1, 10, 10);
    const other = makeAdult(2, 11, 10);
    p.skills.farming = 0.9;
    p.skills.teaching = 0.8;
    other.skills.farming = 0.1;
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    executeAction(p, { kind: 'teach', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(other.skills.farming).toBeGreaterThan(0.1);
    expect(other.memory.some((m) => m.kind === 'taught')).toBe(true);
  });
});

describe('executeAction — trade', () => {
  it('swaps 1 unit of complementary surplus resources', () => {
    const p = makeAdult(1, 10, 10);
    p.inventory = { food: 0, wood: 10, stone: 0, metal: 0, tools: 0 };
    const other = makeAdult(2, 11, 10);
    other.inventory = { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 };
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    const outcome = executeAction(p, { kind: 'trade', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(p.inventory.wood).toBe(9);
    expect(p.inventory.food).toBe(1);
    expect(other.inventory.food).toBe(9);
    expect(other.inventory.wood).toBe(1);
  });
});

describe('executeAction — share', () => {
  it('gives food and records helped/shared memories both sides', () => {
    const p = makeAdult(1, 10, 10);
    p.inventory.food = 5;
    const other = makeAdult(2, 11, 10);
    other.inventory.food = 0;
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    executeAction(p, { kind: 'share', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(p.inventory.food).toBe(4);
    expect(other.inventory.food).toBe(1);
    expect(p.memory.some((m) => m.kind === 'shared')).toBe(true);
    expect(other.memory.some((m) => m.kind === 'helped')).toBe(true);
  });
});

describe('executeAction — steal', () => {
  it('takes from a target person inventory and may record a stolen memory when perceived', () => {
    const p = makeAdult(1, 10, 10);
    const other = makeAdult(2, 11, 10);
    other.inventory.food = 5;
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    ctx.rng = { ...ctx.rng, chance: () => true } as typeof ctx.rng; // always perceived
    const outcome = executeAction(p, { kind: 'steal', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(p.inventory.food).toBeGreaterThan(0);
    expect(other.inventory.food).toBeLessThan(5);
    expect(other.memory.some((m) => m.kind === 'stolen')).toBe(true);
  });

  it('can target a nearby foreign settlement stock', () => {
    const p = makeAdult(1, 10, 10);
    const settlement: Settlement = {
      id: 2,
      civId: 9,
      name: 'Rival',
      center: { x: 10, y: 10 },
      memberIds: [],
      stock: { food: 5, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    };
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [settlement]);
    const outcome = executeAction(p, { kind: 'steal', tile: { x: 10, y: 10 } }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(settlement.stock.food).toBeLessThan(5);
    expect(p.inventory.food).toBeGreaterThan(0);
  });
});

describe('executeAction — attack', () => {
  it('damages the loser, may kill, records memories and emotion impulses both sides', () => {
    const p = makeAdult(1, 10, 10);
    p.skills.fighting = 1;
    const other = makeAdult(2, 11, 10);
    other.skills.fighting = 0;
    other.health = 0.05;
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    ctx.rng = { ...ctx.rng, range: (min: number) => min } as typeof ctx.rng; // no randomness bonus, p still favored on skill
    const outcome = executeAction(p, { kind: 'attack', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(other.health).toBeLessThanOrEqual(0.05);
    if (other.health <= 0) expect(other.causeOfDeath).toBe('violence');
    expect(other.memory.some((m) => m.kind === 'harmed')).toBe(true);
    expect(p.memory.some((m) => m.kind === 'victory') || other.alive).toBeDefined();
  });

  it('never produces NaN across many rolls regardless of outcome', () => {
    const p = makeAdult(1, 10, 10);
    const other = makeAdult(2, 11, 10);
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    for (let i = 0; i < 100; i++) {
      other.health = 1;
      const outcome = executeAction(p, { kind: 'attack', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
      expect(Number.isFinite(outcome.reward)).toBe(true);
      expect(outcome.reward).toBeGreaterThanOrEqual(-1);
      expect(outcome.reward).toBeLessThanOrEqual(1);
    }
  });
});

describe('executeAction — flee', () => {
  it('moves away from a resolvable hostile person and always succeeds', () => {
    const p = makeAdult(1, 10, 10);
    const hostile = makeAdult(2, 11, 10);
    p.relationships = [{ otherId: 2, kind: 'rival', affinity: -0.5 }];
    p.memory = [{ tick: 999, kind: 'harmed', otherId: 2, valence: -0.9, salience: 0.9 }];
    const world = flatWorld(64);
    const ctx = makeCtx([p, hostile], world);
    const outcome = executeAction(p, { kind: 'flee' }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(p.pos).not.toEqual({ x: 10, y: 10 });
  });

  it('behaves like an anxious rest when no danger resolves', () => {
    const p = makeAdult(1, 10, 10);
    p.needs.rest = 0.5;
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    const outcome = executeAction(p, { kind: 'flee' }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(p.pos).toEqual({ x: 10, y: 10 });
    expect(p.needs.rest).toBeLessThan(0.5);
  });
});

describe('executeAction — worship', () => {
  it('requires a belief, nudges sanctity, relieves esteem', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    const noBelief = executeAction(p, { kind: 'worship' }, ctx, NEUTRAL_VOLATILITY);
    expect(noBelief.success).toBe(false);
    p.beliefIds = [1];
    p.needs.esteem = 0.5;
    const before = p.morality.sanctity;
    const outcome = executeAction(p, { kind: 'worship' }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(p.morality.sanctity).toBeGreaterThan(before);
    expect(p.needs.esteem).toBeLessThan(0.5);
  });
});

describe('executeAction — explore', () => {
  it('moves onto the tile and grants a curiosity reward', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    const outcome = executeAction(p, { kind: 'explore', tile: { x: 11, y: 10 } }, ctx, NEUTRAL_VOLATILITY);
    expect(p.pos).toEqual({ x: 11, y: 10 });
    expect(outcome.success).toBe(true);
    expect(outcome.reward).toBeGreaterThan(0);
  });
});

describe('executeAction — heal', () => {
  it('restores target health scaled by healing skill', () => {
    const p = makeAdult(1, 10, 10);
    p.skills.healing = 0.8;
    const other = makeAdult(2, 11, 10);
    other.health = 0.5;
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    const outcome = executeAction(p, { kind: 'heal', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(other.health).toBeGreaterThan(0.5);
    expect(outcome.success).toBe(true);
    expect(other.memory.some((m) => m.kind === 'helped')).toBe(true);
  });
});

describe('executeAction — property: every ActionKind executes without NaN and within reward bounds', () => {
  it('runs every kind at least once with a valid target/tile and checks the outcome', () => {
    const world = flatWorld(64, 0.5, 3);
    for (const kind of ACTION_KINDS as readonly ActionKind[]) {
      const p = makeAdult(1, 10, 10);
      const other = makeAdult(2, 11, 10);
      p.settlementId = 1;
      p.inventory = { food: 5, wood: 10, stone: 10, metal: 5, tools: 1 };
      other.inventory = { food: 5, wood: 0, stone: 0, metal: 0, tools: 0 };
      p.beliefIds = [1];
      other.health = 0.5;
      const settlement: Settlement = {
        id: 1,
        civId: 0,
        name: 'Home',
        center: { x: 10, y: 10 },
        memberIds: [1],
        stock: { food: 5, wood: 0, stone: 0, metal: 0, tools: 0 },
        structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
      };
      const ctx = makeCtx([p, other], world, [settlement]);
      const action: Action =
        kind === 'build'
          ? { kind, structure: 'shelter' }
          : kind === 'gather' || kind === 'farm' || kind === 'migrate' || kind === 'explore'
            ? { kind, tile: { x: 10, y: 10 } }
            : kind === 'steal'
              ? { kind, targetPersonId: 2 }
              : ['socialize', 'court', 'teach', 'trade', 'share', 'attack', 'heal'].includes(kind)
                ? { kind, targetPersonId: 2 }
                : { kind };
      const outcome = executeAction(p, action, ctx, NEUTRAL_VOLATILITY);
      expect(Number.isFinite(outcome.reward)).toBe(true);
      expect(outcome.reward).toBeGreaterThanOrEqual(-1);
      expect(outcome.reward).toBeLessThanOrEqual(1);
      expect(typeof outcome.success).toBe('boolean');
      for (const v of Object.values(p.needs)) expect(Number.isFinite(v)).toBe(true);
      for (const v of Object.values(p.emotions)) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isFinite(p.health)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/agents/execute.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/agents/execute" from "tests/engine/agents/execute.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/engine/agents/execute.ts`**

Create `src/engine/agents/execute.ts` with exactly:

```ts
import {
  ADULT_AGE_TICKS,
  SKILL_NAMES,
  clamp,
  clamp01,
  dist,
  type Action,
  type ActionKind,
  type Civ,
  type Emotions,
  type Inventory,
  type Person,
  type Settlement,
  type SkillName,
  type StructureKind,
  type TechId,
  type Tick,
  type Vec2,
} from '../../shared/types';
import type { Rng } from '../rng';
import { isHabitable, type World } from '../world/terrain';
import { stepToward } from '../world/spatial';
import { markFed } from './needs';
import { applyEmotionImpulse } from './emotions';
import { remember } from './memory';
import { adjustRelationship, affinityTo } from './relationships';

/** Deviation 2: structural stand-in for the not-yet-written Task 29 technology.ts. */
export interface TechCtxLike {
  yieldMultiplier(civ: Civ, action: ActionKind): number;
  addKnowledge(civ: Civ, domain: TechId, points: number): void;
}

/** Deviation 1: the minimal structural subset of the eventual EngineCtx execution reads. */
export interface ExecuteCtxLike {
  world: World;
  personById: Map<number, Person>;
  civs: Civ[];
  settlements: Settlement[];
  tick: Tick;
  rng: Rng;
  tech: TechCtxLike;
}

/** Contract signature verbatim. reward always in [-1, 1]. */
export interface Outcome {
  action: Action;
  success: boolean;
  reward: number;
  tick: Tick;
}

export const MOVEMENT_PROGRESS_REWARD = 0.05;
export const GATHER_SKILL_PRACTICE = 0.002;
export const GATHER_BASE_YIELD = 0.5;
export const FARM_YIELD_BASE = 1.5;
export const HUNT_BASE_CHANCE = 0.35;
export const HUNT_SKILL_BONUS = 0.4;
export const HUNT_FOOD_YIELD = 2.0;
export const HUNT_INJURY_CHANCE = 0.25;
export const HUNT_INJURY_HEALTH = 0.1;
export const BUILD_WOOD_COST = 10;
export const BUILD_STONE_COST = 5;
export const BUILD_PROGRESS_PER_TICK = 1;
export const STRUCTURE_COMPLETE_PROGRESS = 60;
export const CRAFT_WOOD_COST = 2;
export const CRAFT_STONE_COST = 1;
export const CRAFT_TOOLS_YIELD = 1;
export const REST_RECOVERY = 0.3;
export const REST_HEALTH_REGEN = 0.01;
export const SOCIALIZE_AFFINITY_GAIN = 0.02;
export const SOCIALIZE_BELONGING_RELIEF = 0.05;
export const BELIEF_SPREAD_CHANCE_BASE = 0.1;
export const COURT_AFFINITY_THRESHOLD = 0.3;
export const COURT_AFFINITY_BUMP = 0.05;
export const TEACH_SKILL_RATE = 0.05;
export const TEACH_MORALITY_NUDGE = 0.02;
export const TRADE_SWAP_AMOUNT = 1;
export const SHARE_AMOUNT = 1;
export const STEAL_PERSON_AMOUNT = 1;
export const STEAL_SETTLEMENT_AMOUNT = 2;
export const STEAL_PERCEIVED_CHANCE_BASE = 0.5;
export const ATTACK_DAMAGE_MIN = 0.15;
export const ATTACK_DAMAGE_MAX = 0.4;
export const FLEE_STEPS = 2;
export const WORSHIP_ZEAL_UPKEEP = 0.01;
export const WORSHIP_SANCTITY_NUDGE = 0.01;
export const WORSHIP_ESTEEM_RELIEF = 0.03;
export const EXPLORE_CURIOSITY_REWARD = 0.1;
export const EXPLORE_WONDER_CHANCE = 0.02;
export const HEAL_BASE_RECOVERY = 0.1;
export const HEAL_MEDICINE_MULTIPLIER = 1.5; // reserved for tech.yieldMultiplier callers; heal reads the multiplier via ctx.tech directly

/** Neutral per-component multiplier for impulses applied to someone other than the acting person. */
export const NEUTRAL_IMPULSE: Emotions = { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 };

/** Extension property backing per-structure build progress on a Settlement (mirrors lifecycle.ts's pattern). */
interface WithBuildProgress {
  _buildProgress?: Record<StructureKind, number>;
}

export function buildProgressOf(s: Settlement, structure: StructureKind): number {
  return (s as Settlement & WithBuildProgress)._buildProgress?.[structure] ?? 0;
}

export function setBuildProgress(s: Settlement, structure: StructureKind, value: number): void {
  const ext = s as Settlement & WithBuildProgress;
  if (ext._buildProgress === undefined) {
    ext._buildProgress = { shelter: 0, granary: 0, wall: 0, shrine: 0 };
  }
  ext._buildProgress[structure] = value;
}

function finiteReward(reward: number): number {
  return Number.isFinite(reward) ? clamp(reward, -1, 1) : 0;
}

function outcomeOf(action: Action, success: boolean, reward: number, tick: Tick): Outcome {
  return { action, success, reward: finiteReward(reward), tick };
}

function civOf(ctx: ExecuteCtxLike, p: Person): Civ | undefined {
  return ctx.civs.find((c) => c.id === p.civId);
}

function resourceKeys(): (keyof Inventory)[] {
  return ['food', 'wood', 'stone', 'metal'];
}

function largestResource(inv: Inventory, exclude?: keyof Inventory): keyof Inventory | null {
  let best: keyof Inventory | null = null;
  let bestAmount = 0;
  for (const key of resourceKeys()) {
    if (key === exclude) continue;
    if (inv[key] > bestAmount) {
      bestAmount = inv[key];
      best = key;
    }
  }
  return best;
}

function bestSkill(p: Person): SkillName {
  let best: SkillName = SKILL_NAMES[0];
  for (const s of SKILL_NAMES) {
    if (p.skills[s] > p.skills[best]) best = s;
  }
  return best;
}

const NEEDS_ADJACENT = Math.SQRT2 + 1e-9;

/**
 * Contract function (ExecuteCtxLike per deviation 1; emotionVolatility
 * injected per deviation 5). Movement is embedded generically for any
 * tile-targeted action farther than one adjacent step; every ActionKind's
 * own effect is implemented in the switch below.
 */
export function executeAction(p: Person, a: Action, ctx: ExecuteCtxLike, emotionVolatility: Emotions): Outcome {
  if (a.tile !== undefined && dist(p.pos, a.tile) > NEEDS_ADJACENT) {
    const next = stepToward(p.pos, a.tile, ctx.world);
    p.pos = next;
    return outcomeOf(a, true, MOVEMENT_PROGRESS_REWARD, ctx.tick);
  }

  switch (a.kind) {
    case 'gather':
      return execGather(p, a, ctx);
    case 'farm':
      return execFarm(p, a, ctx);
    case 'hunt':
      return execHunt(p, ctx, emotionVolatility);
    case 'build':
      return execBuild(p, a, ctx);
    case 'craft':
      return execCraft(p, ctx);
    case 'rest':
      return execRest(p, ctx);
    case 'socialize':
      return execSocialize(p, a, ctx);
    case 'court':
      return execCourt(p, a, ctx, emotionVolatility);
    case 'teach':
      return execTeach(p, a, ctx);
    case 'trade':
      return execTrade(p, a, ctx);
    case 'share':
      return execShare(p, a, ctx, emotionVolatility);
    case 'steal':
      return execSteal(p, a, ctx, emotionVolatility);
    case 'attack':
      return execAttack(p, a, ctx, emotionVolatility);
    case 'flee':
      return execFlee(p, ctx, emotionVolatility);
    case 'migrate':
      return execMigrate(p, a, ctx);
    case 'worship':
      return execWorship(p, ctx, emotionVolatility);
    case 'explore':
      return execExplore(p, a, ctx, emotionVolatility);
    case 'heal':
      return execHeal(p, a, ctx);
  }
}

function execGather(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const tile = a.tile as Vec2;
  const t = ctx.world.tileAt(tile.x, tile.y);
  const amount = Math.min(t.food, GATHER_BASE_YIELD + p.skills.gathering);
  t.food -= amount;
  p.inventory.food += amount;
  if (amount > 0) markFed(p);
  p.skills.gathering = clamp01(p.skills.gathering + GATHER_SKILL_PRACTICE);
  const civ = civOf(ctx, p);
  if (civ !== undefined) {
    ctx.tech.addKnowledge(civ, 'fire', amount);
    ctx.tech.addKnowledge(civ, 'agriculture', amount * 0.2);
  }
  return outcomeOf(a, amount > 0, amount / 2, ctx.tick);
}

function execFarm(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const tile = a.tile as Vec2;
  const t = ctx.world.tileAt(tile.x, tile.y);
  if (!isHabitable(t.terrain)) return outcomeOf(a, false, -0.1, ctx.tick);
  const civ = civOf(ctx, p);
  const multiplier = civ !== undefined ? ctx.tech.yieldMultiplier(civ, 'farm') : 1;
  const grown = FARM_YIELD_BASE * p.skills.farming * multiplier;
  t.food += grown;
  const amount = Math.min(t.food, grown);
  t.food -= amount;
  p.inventory.food += amount;
  if (amount > 0) markFed(p);
  p.skills.farming = clamp01(p.skills.farming + GATHER_SKILL_PRACTICE);
  if (civ !== undefined) ctx.tech.addKnowledge(civ, 'agriculture', amount);
  return outcomeOf(a, amount > 0, amount / 3, ctx.tick);
}

function execHunt(p: Person, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const action: Action = { kind: 'hunt' };
  const chance = clamp01(HUNT_BASE_CHANCE + HUNT_SKILL_BONUS * p.skills.fighting);
  const success = ctx.rng.chance(chance);
  let reward = success ? 0.6 : -0.2;
  if (success) {
    p.inventory.food += HUNT_FOOD_YIELD;
    markFed(p);
  }
  if (ctx.rng.chance(HUNT_INJURY_CHANCE)) {
    p.health = clamp01(p.health - HUNT_INJURY_HEALTH);
    applyEmotionImpulse(p, { fear: 0.2 }, volatility);
    reward -= 0.1;
  }
  p.skills.fighting = clamp01(p.skills.fighting + GATHER_SKILL_PRACTICE);
  return outcomeOf(action, success, reward, ctx.tick);
}

function execBuild(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const structure = a.structure as StructureKind;
  const settlement = ctx.settlements.find((s) => s.id === p.settlementId);
  if (settlement === undefined) return outcomeOf(a, false, -0.1, ctx.tick);

  const woodSpend = Math.min(p.inventory.wood, BUILD_WOOD_COST);
  const stoneSpend = Math.min(p.inventory.stone, BUILD_STONE_COST);
  if (woodSpend === 0 && stoneSpend === 0) return outcomeOf(a, false, -0.05, ctx.tick);

  p.inventory.wood -= woodSpend;
  p.inventory.stone -= stoneSpend;
  const gained = (woodSpend + stoneSpend) * BUILD_PROGRESS_PER_TICK;
  let progress = buildProgressOf(settlement, structure) + gained;
  if (progress >= STRUCTURE_COMPLETE_PROGRESS) {
    settlement.structures[structure] += 1;
    progress = 0;
  }
  setBuildProgress(settlement, structure, progress);
  p.skills.building = clamp01(p.skills.building + GATHER_SKILL_PRACTICE);
  const civ = civOf(ctx, p);
  if (civ !== undefined) ctx.tech.addKnowledge(civ, 'construction', woodSpend + stoneSpend);
  return outcomeOf(a, true, (woodSpend + stoneSpend) / 15, ctx.tick);
}

function execCraft(p: Person, ctx: ExecuteCtxLike): Outcome {
  const action: Action = { kind: 'craft' };
  if (p.inventory.wood < CRAFT_WOOD_COST || p.inventory.stone < CRAFT_STONE_COST) {
    return outcomeOf(action, false, -0.05, ctx.tick);
  }
  p.inventory.wood -= CRAFT_WOOD_COST;
  p.inventory.stone -= CRAFT_STONE_COST;
  p.inventory.tools += CRAFT_TOOLS_YIELD;
  p.skills.crafting = clamp01(p.skills.crafting + GATHER_SKILL_PRACTICE);
  const civ = civOf(ctx, p);
  if (civ !== undefined) ctx.tech.addKnowledge(civ, 'metallurgy', CRAFT_TOOLS_YIELD);
  return outcomeOf(action, true, 0.3, ctx.tick);
}

function execRest(p: Person, ctx: ExecuteCtxLike): Outcome {
  const action: Action = { kind: 'rest' };
  const priorRest = p.needs.rest;
  p.needs.rest = clamp01(p.needs.rest - REST_RECOVERY);
  p.health = clamp01(p.health + REST_HEALTH_REGEN);
  return outcomeOf(action, true, 0.3 * priorRest, ctx.tick);
}

function relationshipKind(p: Person, otherId: number): 'kin' | 'friend' | 'rival' | 'partner' {
  return p.relationships.find((r) => r.otherId === otherId)?.kind ?? 'friend';
}

function execSocialize(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);

  adjustRelationship(p, target.id, relationshipKind(p, target.id), SOCIALIZE_AFFINITY_GAIN);
  adjustRelationship(target, p.id, relationshipKind(target, p.id), SOCIALIZE_AFFINITY_GAIN);
  p.needs.belonging = clamp01(p.needs.belonging - SOCIALIZE_BELONGING_RELIEF);
  target.needs.belonging = clamp01(target.needs.belonging - SOCIALIZE_BELONGING_RELIEF);

  if (p.beliefIds.length > 0) {
    const belief = p.beliefIds[0] as number;
    if (!target.beliefIds.includes(belief) && ctx.rng.chance(BELIEF_SPREAD_CHANCE_BASE)) {
      target.beliefIds.push(belief);
    }
  }
  return outcomeOf(a, true, 0.2, ctx.tick);
}

function execCourt(p: Person, a: Action, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);

  const bothAdult = p.ageTicks >= ADULT_AGE_TICKS && target.ageTicks >= ADULT_AGE_TICKS;
  if (affinityTo(p, target.id) > COURT_AFFINITY_THRESHOLD && p.partnerId === null && target.partnerId === null && bothAdult) {
    p.partnerId = target.id;
    target.partnerId = p.id;
    adjustRelationship(p, target.id, 'partner', 0.2);
    adjustRelationship(target, p.id, 'partner', 0.2);
    applyEmotionImpulse(p, { joy: 0.4, hope: 0.2 }, volatility);
    applyEmotionImpulse(target, { joy: 0.4, hope: 0.2 }, NEUTRAL_IMPULSE);
    return outcomeOf(a, true, 0.8, ctx.tick);
  }

  adjustRelationship(p, target.id, 'friend', COURT_AFFINITY_BUMP);
  adjustRelationship(target, p.id, 'friend', COURT_AFFINITY_BUMP);
  return outcomeOf(a, true, 0.15, ctx.tick);
}

function execTeach(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);

  const skill = bestSkill(p);
  target.skills[skill] = clamp01(target.skills[skill] + TEACH_SKILL_RATE * p.skills.teaching);
  const foundations: (keyof Person['morality'])[] = ['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty'];
  for (const f of foundations) {
    target.morality[f] = clamp01(target.morality[f] + TEACH_MORALITY_NUDGE * (p.morality[f] - target.morality[f]));
  }
  remember(target, { tick: ctx.tick, kind: 'taught', otherId: p.id, valence: 0.5, salience: 0.4 });
  p.skills.teaching = clamp01(p.skills.teaching + GATHER_SKILL_PRACTICE);
  const civ = civOf(ctx, p);
  if (civ !== undefined) ctx.tech.addKnowledge(civ, 'writing', 1);
  return outcomeOf(a, true, 0.3, ctx.tick);
}

function execTrade(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);

  const give = largestResource(p.inventory);
  if (give === null) return outcomeOf(a, false, -0.05, ctx.tick);
  const receive = largestResource(target.inventory, give);
  if (receive === null) return outcomeOf(a, false, -0.05, ctx.tick);
  if (p.inventory[give] < TRADE_SWAP_AMOUNT || target.inventory[receive] < TRADE_SWAP_AMOUNT) {
    return outcomeOf(a, false, -0.05, ctx.tick);
  }

  p.inventory[give] -= TRADE_SWAP_AMOUNT;
  target.inventory[give] += TRADE_SWAP_AMOUNT;
  target.inventory[receive] -= TRADE_SWAP_AMOUNT;
  p.inventory[receive] += TRADE_SWAP_AMOUNT;
  if (receive === 'food') markFed(p);
  if (give === 'food') markFed(target);

  adjustRelationship(p, target.id, relationshipKind(p, target.id), 0.03);
  adjustRelationship(target, p.id, relationshipKind(target, p.id), 0.03);
  return outcomeOf(a, true, 0.3, ctx.tick);
}

function execShare(p: Person, a: Action, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);
  if (p.inventory.food < SHARE_AMOUNT) return outcomeOf(a, false, -0.05, ctx.tick);

  p.inventory.food -= SHARE_AMOUNT;
  target.inventory.food += SHARE_AMOUNT;
  markFed(target);
  remember(p, { tick: ctx.tick, kind: 'shared', otherId: target.id, valence: 0.6, salience: 0.4 });
  remember(target, { tick: ctx.tick, kind: 'helped', otherId: p.id, valence: 0.6, salience: 0.5 });
  adjustRelationship(p, target.id, relationshipKind(p, target.id), 0.05);
  adjustRelationship(target, p.id, relationshipKind(target, p.id), 0.05);
  applyEmotionImpulse(p, { joy: 0.15 }, volatility);
  return outcomeOf(a, true, 0.4 * p.traits.empathy + 0.1, ctx.tick);
}

function execSteal(p: Person, a: Action, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  if (a.targetPersonId !== undefined) {
    const target = ctx.personById.get(a.targetPersonId);
    if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);
    const resource = largestResource(target.inventory);
    if (resource === null || target.inventory[resource] < STEAL_PERSON_AMOUNT) {
      return outcomeOf(a, false, -0.05, ctx.tick);
    }
    target.inventory[resource] -= STEAL_PERSON_AMOUNT;
    p.inventory[resource] += STEAL_PERSON_AMOUNT;
    if (resource === 'food') markFed(p);
    const perceivedChance = clamp01(STEAL_PERCEIVED_CHANCE_BASE - 0.3 * p.skills.fighting + 0.3 * target.skills.fighting);
    if (ctx.rng.chance(perceivedChance)) {
      remember(target, { tick: ctx.tick, kind: 'stolen', otherId: p.id, valence: -0.7, salience: 0.6 });
      applyEmotionImpulse(target, { anger: 0.3 }, NEUTRAL_IMPULSE);
      adjustRelationship(target, p.id, 'rival', -0.2);
      applyEmotionImpulse(p, { fear: 0.1 }, volatility);
    }
    return outcomeOf(a, true, 0.35, ctx.tick);
  }

  // Settlement form (a.tile set).
  const tile = a.tile as Vec2;
  const settlement = ctx.settlements.find((s) => s.id !== p.settlementId && dist(tile, s.center) <= 1);
  if (settlement === undefined) return outcomeOf(a, false, -0.1, ctx.tick);
  const resource = largestResource(settlement.stock);
  if (resource === null || settlement.stock[resource] < STEAL_SETTLEMENT_AMOUNT) {
    return outcomeOf(a, false, -0.05, ctx.tick);
  }
  settlement.stock[resource] -= STEAL_SETTLEMENT_AMOUNT;
  p.inventory[resource] += STEAL_SETTLEMENT_AMOUNT;
  if (resource === 'food') markFed(p);
  for (const memberId of settlement.memberIds) {
    const member = ctx.personById.get(memberId);
    if (member === undefined || !member.alive) continue;
    if (ctx.rng.chance(STEAL_PERCEIVED_CHANCE_BASE)) {
      applyEmotionImpulse(member, { anger: 0.15 }, NEUTRAL_IMPULSE);
    }
  }
  return outcomeOf(a, true, 0.5, ctx.tick);
}

function execAttack(p: Person, a: Action, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.1, ctx.tick);

  const pCiv = civOf(ctx, p);
  const metallurgyBonus = pCiv !== undefined ? ctx.tech.yieldMultiplier(pCiv, 'attack') : 1;
  const pRoll = p.skills.fighting + 0.3 * metallurgyBonus - 0.3 + ctx.rng.range(0, 0.5);
  const tRoll = target.skills.fighting + ctx.rng.range(0, 0.5);

  if (pRoll > tRoll) {
    const damage = ATTACK_DAMAGE_MIN + (ATTACK_DAMAGE_MAX - ATTACK_DAMAGE_MIN) * clamp01(pRoll - tRoll);
    target.health = clamp01(target.health - damage);
    if (target.health <= 0) target.causeOfDeath = 'violence';
    remember(target, { tick: ctx.tick, kind: 'harmed', otherId: p.id, valence: -0.9, salience: 0.9 });
    applyEmotionImpulse(target, { fear: 0.4, anger: 0.3 }, NEUTRAL_IMPULSE);
    adjustRelationship(target, p.id, 'rival', -0.4);
    applyEmotionImpulse(p, { anger: -0.1 }, volatility);
    if (target.health <= 0) {
      remember(p, { tick: ctx.tick, kind: 'victory', otherId: target.id, valence: 0.5, salience: 0.6 });
    }
    return outcomeOf(a, true, 0.5 + 0.3 * (target.health <= 0 ? 1 : 0), ctx.tick);
  }

  const damage = ATTACK_DAMAGE_MIN + (ATTACK_DAMAGE_MAX - ATTACK_DAMAGE_MIN) * clamp01(tRoll - pRoll);
  p.health = clamp01(p.health - damage);
  if (p.health <= 0) p.causeOfDeath = 'violence';
  applyEmotionImpulse(p, { fear: 0.4, anger: 0.2 }, volatility);
  remember(p, { tick: ctx.tick, kind: 'defeat', otherId: target.id, valence: -0.6, salience: 0.6 });
  return outcomeOf(a, false, -0.5, ctx.tick);
}

/** Resolves the nearest known danger position from recent harmed/witnessed memories, or null. */
function nearestDanger(p: Person, ctx: ExecuteCtxLike): Vec2 | null {
  for (const rec of p.memory) {
    if (rec.kind !== 'harmed' && rec.kind !== 'death-witnessed') continue;
    const other = ctx.personById.get(rec.otherId);
    if (other === undefined || !other.alive) continue;
    if (dist(p.pos, other.pos) <= FLEE_STEPS * 2) return other.pos;
  }
  return null;
}

function execFlee(p: Person, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const action: Action = { kind: 'flee' };
  const danger = nearestDanger(p, ctx);
  if (danger === null) {
    p.needs.rest = clamp01(p.needs.rest - 0.1);
    return outcomeOf(action, true, 0.05, ctx.tick);
  }
  const away: Vec2 = { x: p.pos.x + (p.pos.x - danger.x), y: p.pos.y + (p.pos.y - danger.y) };
  for (let i = 0; i < FLEE_STEPS; i++) {
    p.pos = stepToward(p.pos, away, ctx.world);
  }
  applyEmotionImpulse(p, { fear: -0.1 }, volatility);
  return outcomeOf(action, true, 0.1, ctx.tick);
}

function execMigrate(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const tile = a.tile as Vec2;
  p.pos = { x: tile.x, y: tile.y };
  if (p.settlementId !== null) p.settlementId = null;
  return outcomeOf(a, true, 0.1, ctx.tick);
}

function execWorship(p: Person, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const action: Action = { kind: 'worship' };
  if (p.beliefIds.length === 0) return outcomeOf(action, false, -0.05, ctx.tick);
  p.morality.sanctity = clamp01(p.morality.sanctity + WORSHIP_SANCTITY_NUDGE);
  p.needs.esteem = clamp01(p.needs.esteem - WORSHIP_ESTEEM_RELIEF);
  applyEmotionImpulse(p, { hope: WORSHIP_ZEAL_UPKEEP }, volatility);
  return outcomeOf(action, true, 0.15, ctx.tick);
}

function execExplore(p: Person, a: Action, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const tile = a.tile as Vec2;
  p.pos = { x: tile.x, y: tile.y };
  applyEmotionImpulse(p, { hope: 0.1 }, volatility);
  let reward = EXPLORE_CURIOSITY_REWARD;
  if (ctx.rng.chance(EXPLORE_WONDER_CHANCE)) {
    remember(p, { tick: ctx.tick, kind: 'wonder', otherId: p.id, valence: 0.8, salience: 0.7 });
    applyEmotionImpulse(p, { joy: 0.2 }, volatility);
    reward += 0.1;
  }
  return outcomeOf(a, true, reward, ctx.tick);
}

function execHeal(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);

  const civ = civOf(ctx, p);
  const multiplier = civ !== undefined ? ctx.tech.yieldMultiplier(civ, 'heal') : 1;
  const recovery = HEAL_BASE_RECOVERY * p.skills.healing * multiplier;
  target.health = clamp01(target.health + recovery);
  remember(target, { tick: ctx.tick, kind: 'helped', otherId: p.id, valence: 0.7, salience: 0.5 });
  p.skills.healing = clamp01(p.skills.healing + GATHER_SKILL_PRACTICE);
  if (civ !== undefined) ctx.tech.addKnowledge(civ, 'medicine', recovery * 10);
  adjustRelationship(p, target.id, relationshipKind(p, target.id), 0.05);
  adjustRelationship(target, p.id, relationshipKind(target, p.id), 0.05);
  return outcomeOf(a, true, recovery * 2, ctx.tick);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/agents/execute.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/agents/execute.test.ts (25 tests)

 Test Files  1 passed (1)
      Tests  25 passed (25)
```

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/agents/execute.ts tests/engine/agents/execute.test.ts
git commit -m "feat(agents): execute every ActionKind's world/person effects and outcomes" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 16: Perception (`src/engine/agents/perception.ts`)

**Files:**
- Create: `src/engine/agents/perception.ts`
- Test: `tests/engine/agents/perception.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Civ`, `Settlement`, `Tile`, `Terrain`, `TechId`, `Season`, `Vec2`, `Tick`, `PERCEPTION_RADIUS = 4`, `dist(a, b): number`
- From `src/engine/rng.ts` (Task 2): `Rng` (tests only, for building people)
- From `src/engine/world/terrain.ts` (Task 5): `World`; tests also use `generateWorld`
- From `src/engine/world/climate.ts` (Task 6): `seasonOf(tick): Season`, `NaturalEvent { kind; startTick; durationTicks; center; intensity }`, `isEventActive(e, tick): boolean`
- From `src/engine/world/spatial.ts` (Task 7): `SpatialIndex` (`near(pos, radius): number[]`)
- From `src/engine/agents/emotions.ts` (Task 10): `dominantEmotion(p): 'calm' | 'afraid' | 'angry' | 'joyful' | 'grieving'`
- From `src/engine/agents/relationships.ts` (Task 13): `affinityTo(p, otherId): number`, `isKin(p, otherId): boolean`
- From `src/engine/agents/actions.ts` (Task 14): `legalActions(p, ctx, taboos): Action[]`, `ActionsCtxLike`
- Tests also use `createPerson` (Task 8)

Produces:
- `export interface PersonGlimpse { id: number; lineage: Lineage; civId: number; settlementId: number | null; pos: Vec2; influence: number; healthy: boolean; visibleEmotion: ReturnType<typeof dominantEmotion>; affinity: number; kin: boolean }` — contract signature verbatim (`healthy = health >= 0.5`).
- `export interface TileGlimpse { pos: Vec2; terrain: Terrain; food: number; wood: number; stone: number; metal: number }` — contract signature verbatim.
- `export interface SettlementGlimpse { id: number; civId: number; center: Vec2; population: number; foodStock: number; hasGranary: boolean; hasWall: boolean; underAttack: boolean }` — contract signature verbatim (`underAttack` computed from `ctx.naturalEvents`/danger inputs, see below).
- `export interface CivGlimpse { id: number; population: number; atWarWith: number[]; techs: TechId[]; season: Season; foodPerCapita: number }` — contract signature verbatim.
- `export interface DangerGlimpse { kind: 'raid' | 'disease' | 'famine'; pos: Vec2 | null; intensity: number }` — contract signature verbatim.
- `export interface Perception { tick: Tick; self: Person; candidates: Action[]; nearbyPeople: PersonGlimpse[]; nearbyTiles: TileGlimpse[]; settlement: SettlementGlimpse | null; nearbySettlements: SettlementGlimpse[]; civ: CivGlimpse; dangers: DangerGlimpse[] }` — contract signature verbatim.
- `export interface PerceptionCtxLike { world: World; people: Person[]; personById: Map<number, Person>; civs: Civ[]; settlements: Settlement[]; spatial: SpatialIndex; tick: Tick; naturalEvents: NaturalEvent[] }` — deviation 1: the minimal structural subset of the eventual `EngineCtx` this file (and the `ActionsCtxLike` it forwards to `legalActions`) reads. Every field `ActionsCtxLike` needs (`world`, `personById`, `spatial`, `settlements`, `tick`) is present, so `PerceptionCtxLike` is passed straight through to `legalActions` unchanged. `EngineCtx` is a superset of `PerceptionCtxLike`.
- `export function buildPerception(p: Person, ctx: PerceptionCtxLike, taboos: ActionKind[]): Perception` — contract signature plus an explicit `taboos` parameter (mirroring Task 14's `legalActions`, since `Temperament` is Task 20; Task 33 passes `getBrain(p.lineage).temperament().taboos`). Fills every field per the rules below.

Field-filling rules (all concrete):
- `tick = ctx.tick`; `self = p`; `candidates = legalActions(p, ctx, taboos)`.
- `nearbyPeople`: one `PersonGlimpse` per living person within `PERCEPTION_RADIUS` of `p.pos` (via `ctx.spatial.near`, excluding `p` itself), in ascending-id order (the order `near` already returns): `{ id, lineage, civId, settlementId, pos, influence, healthy: health >= 0.5, visibleEmotion: dominantEmotion(other), affinity: affinityTo(p, other.id), kin: isKin(p, other.id) }`.
- `nearbyTiles`: one `TileGlimpse` per in-bounds tile within `PERCEPTION_RADIUS` of `p.pos` (inclusive of `p`'s own tile), in row-major scan order (`y` ascending, then `x` ascending) so results are deterministic regardless of iteration internals: `{ pos, terrain, food, wood, stone, metal }`.
- `settlement`: `null` if `p.settlementId === null`; otherwise the `SettlementGlimpse` for `ctx.settlements.find(s => s.id === p.settlementId)`, or `null` if that id no longer resolves (a settlement dissolved this tick before perception runs).
- `nearbySettlements`: one `SettlementGlimpse` per settlement in `ctx.settlements` (any civ) whose `center` is within `PERCEPTION_RADIUS * 5` of `p.pos` (a wider radius than person/tile perception, since settlements are landmarks people navigate toward from farther away), excluding `p`'s own settlement (already covered by `settlement`).
- A `SettlementGlimpse` is built as: `{ id, civId, center, population: memberIds.filter(id => alive via ctx.personById).length, foodStock: stock.food, hasGranary: structures.granary > 0, hasWall: structures.wall > 0, underAttack }`, where `underAttack` is `true` iff any active `'drought'`-adjacent-free check is irrelevant here — concretely: `underAttack` is derived purely from recent violence density, computed as `true` iff at least 2 living members of the settlement have a memory of kind `'harmed'` with `tick - rec.tick <= 5` (a same-tick-ish raid signature; conflict.ts, Task 32, does not exist yet, so this is the best local signal available and is intentionally conservative — most ticks it is `false`).
- `civ`: `CivGlimpse` for `ctx.civs.find(c => c.id === p.civId)`; if unresolvable (should not happen for a living person, but defensively handled), falls back to `{ id: p.civId, population: 0, atWarWith: [], techs: [], season: seasonOf(ctx.tick), foodPerCapita: 0 }`. When resolvable: `population = ctx.people.filter(person => person.alive && person.civId === civ.id).length`; `atWarWith = civ.atWarWith`; `techs = civ.techs`; `season = seasonOf(ctx.tick)`; `foodPerCapita = totalCivFood / max(1, population)` where `totalCivFood` sums `person.inventory.food` over living civ members plus `settlement.stock.food` over the civ's settlements.
- `dangers`: one `DangerGlimpse` per active `NaturalEvent` in `ctx.naturalEvents` within `PERCEPTION_RADIUS * 5` of `p.pos` (or with a `null` center, meaning ambient/global — always included), mapped `'drought' | 'harsh-winter' -> 'famine'`, `'disease' -> 'disease'`; `{ kind, pos: event.center, intensity: event.intensity }`. In addition, one synthetic `{ kind: 'raid', pos: settlement.center, intensity: 0.5 }` glimpse per nearby `SettlementGlimpse` (own or foreign) whose `underAttack` is `true`.
- Every distance/radius check in this file uses `dist` (euclidean), matching the contract's `PERCEPTION_RADIUS` semantics used everywhere else (Tasks 9, 14).

- [ ] **Step 1: Write the failing perception tests**

Create `tests/engine/agents/perception.test.ts` with exactly:

```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/agents/perception.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/agents/perception" from "tests/engine/agents/perception.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/engine/agents/perception.ts`**

Create `src/engine/agents/perception.ts` with exactly:

```ts
import {
  PERCEPTION_RADIUS,
  dist,
  type Action,
  type ActionKind,
  type Civ,
  type Lineage,
  type Person,
  type Season,
  type Settlement,
  type TechId,
  type Terrain,
  type Tick,
  type Vec2,
} from '../../shared/types';
import type { World } from '../world/terrain';
import { isEventActive, seasonOf, type NaturalEvent } from '../world/climate';
import type { SpatialIndex } from '../world/spatial';
import { dominantEmotion } from './emotions';
import { affinityTo, isKin } from './relationships';
import { legalActions, type ActionsCtxLike } from './actions';

export const NEARBY_SETTLEMENT_RADIUS_MULTIPLIER = 5;
export const DANGER_RADIUS_MULTIPLIER = 5;
export const SETTLEMENT_ATTACK_MEMORY_WINDOW = 5;
export const SETTLEMENT_ATTACK_MIN_VICTIMS = 2;
export const RAID_DANGER_INTENSITY = 0.5;

export interface PersonGlimpse {
  id: number;
  lineage: Lineage;
  civId: number;
  settlementId: number | null;
  pos: Vec2;
  influence: number;
  healthy: boolean;
  visibleEmotion: ReturnType<typeof dominantEmotion>;
  affinity: number;
  kin: boolean;
}

export interface TileGlimpse {
  pos: Vec2;
  terrain: Terrain;
  food: number;
  wood: number;
  stone: number;
  metal: number;
}

export interface SettlementGlimpse {
  id: number;
  civId: number;
  center: Vec2;
  population: number;
  foodStock: number;
  hasGranary: boolean;
  hasWall: boolean;
  underAttack: boolean;
}

export interface CivGlimpse {
  id: number;
  population: number;
  atWarWith: number[];
  techs: TechId[];
  season: Season;
  foodPerCapita: number;
}

export interface DangerGlimpse {
  kind: 'raid' | 'disease' | 'famine';
  pos: Vec2 | null;
  intensity: number;
}

export interface Perception {
  tick: Tick;
  self: Person;
  candidates: Action[];
  nearbyPeople: PersonGlimpse[];
  nearbyTiles: TileGlimpse[];
  settlement: SettlementGlimpse | null;
  nearbySettlements: SettlementGlimpse[];
  civ: CivGlimpse;
  dangers: DangerGlimpse[];
}

/**
 * Deviation 1: the minimal structural subset of the eventual EngineCtx this
 * file (and the ActionsCtxLike it forwards to legalActions) reads. Every
 * field ActionsCtxLike needs is present, so it is passed straight through.
 */
export interface PerceptionCtxLike {
  world: World;
  people: Person[];
  personById: Map<number, Person>;
  civs: Civ[];
  settlements: Settlement[];
  spatial: SpatialIndex;
  tick: Tick;
  naturalEvents: NaturalEvent[];
}

function toActionsCtx(ctx: PerceptionCtxLike): ActionsCtxLike {
  return {
    world: ctx.world,
    personById: ctx.personById,
    spatial: ctx.spatial,
    settlements: ctx.settlements,
    tick: ctx.tick,
  };
}

function personGlimpse(p: Person, other: Person): PersonGlimpse {
  return {
    id: other.id,
    lineage: other.lineage,
    civId: other.civId,
    settlementId: other.settlementId,
    pos: { x: other.pos.x, y: other.pos.y },
    influence: other.influence,
    healthy: other.health >= 0.5,
    visibleEmotion: dominantEmotion(other),
    affinity: affinityTo(p, other.id),
    kin: isKin(p, other.id),
  };
}

function buildNearbyPeople(p: Person, ctx: PerceptionCtxLike): PersonGlimpse[] {
  const out: PersonGlimpse[] = [];
  for (const id of ctx.spatial.near(p.pos, PERCEPTION_RADIUS)) {
    if (id === p.id) continue;
    const other = ctx.personById.get(id);
    if (other !== undefined && other.alive) out.push(personGlimpse(p, other));
  }
  return out;
}

function buildNearbyTiles(p: Person, ctx: PerceptionCtxLike): TileGlimpse[] {
  const out: TileGlimpse[] = [];
  const r = Math.ceil(PERCEPTION_RADIUS);
  for (let y = p.pos.y - r; y <= p.pos.y + r; y++) {
    for (let x = p.pos.x - r; x <= p.pos.x + r; x++) {
      if (!ctx.world.inBounds(x, y)) continue;
      if (dist({ x, y }, p.pos) > PERCEPTION_RADIUS) continue;
      const t = ctx.world.tileAt(x, y);
      out.push({ pos: { x, y }, terrain: t.terrain, food: t.food, wood: t.wood, stone: t.stone, metal: t.metal });
    }
  }
  return out; // already row-major (y ascending, then x ascending) by construction
}

function isUnderAttack(s: Settlement, ctx: PerceptionCtxLike): boolean {
  let victims = 0;
  for (const memberId of s.memberIds) {
    const member = ctx.personById.get(memberId);
    if (member === undefined || !member.alive) continue;
    const recent = member.memory.some(
      (m) => m.kind === 'harmed' && ctx.tick - m.tick <= SETTLEMENT_ATTACK_MEMORY_WINDOW,
    );
    if (recent) victims += 1;
  }
  return victims >= SETTLEMENT_ATTACK_MIN_VICTIMS;
}

function settlementGlimpse(s: Settlement, ctx: PerceptionCtxLike): SettlementGlimpse {
  const population = s.memberIds.filter((id) => ctx.personById.get(id)?.alive === true).length;
  return {
    id: s.id,
    civId: s.civId,
    center: { x: s.center.x, y: s.center.y },
    population,
    foodStock: s.stock.food,
    hasGranary: s.structures.granary > 0,
    hasWall: s.structures.wall > 0,
    underAttack: isUnderAttack(s, ctx),
  };
}

function buildCivGlimpse(p: Person, ctx: PerceptionCtxLike): CivGlimpse {
  const civ = ctx.civs.find((c) => c.id === p.civId);
  const season = seasonOf(ctx.tick);
  if (civ === undefined) {
    return { id: p.civId, population: 0, atWarWith: [], techs: [], season, foodPerCapita: 0 };
  }
  const members = ctx.people.filter((person) => person.alive && person.civId === civ.id);
  let totalFood = members.reduce((sum, person) => sum + person.inventory.food, 0);
  for (const s of ctx.settlements) {
    if (s.civId === civ.id) totalFood += s.stock.food;
  }
  return {
    id: civ.id,
    population: members.length,
    atWarWith: civ.atWarWith,
    techs: civ.techs,
    season,
    foodPerCapita: totalFood / Math.max(1, members.length),
  };
}

function buildDangers(p: Person, ctx: PerceptionCtxLike, nearbySettlements: SettlementGlimpse[], ownSettlement: SettlementGlimpse | null): DangerGlimpse[] {
  const out: DangerGlimpse[] = [];
  for (const ev of ctx.naturalEvents) {
    if (!isEventActive(ev, ctx.tick)) continue;
    if (ev.center !== null && dist(p.pos, ev.center) > PERCEPTION_RADIUS * DANGER_RADIUS_MULTIPLIER) continue;
    const kind: 'famine' | 'disease' = ev.kind === 'disease' ? 'disease' : 'famine';
    out.push({ kind, pos: ev.center, intensity: ev.intensity });
  }
  const all = ownSettlement !== null ? [ownSettlement, ...nearbySettlements] : nearbySettlements;
  for (const s of all) {
    if (s.underAttack) out.push({ kind: 'raid', pos: s.center, intensity: RAID_DANGER_INTENSITY });
  }
  return out;
}

/**
 * Contract function (PerceptionCtxLike per deviation 1; taboos explicit
 * since Temperament is Task 20). Assembles the full Perception the brain
 * decides against.
 */
export function buildPerception(p: Person, ctx: PerceptionCtxLike, taboos: ActionKind[]): Perception {
  const nearbyPeople = buildNearbyPeople(p, ctx);
  const nearbyTiles = buildNearbyTiles(p, ctx);

  const ownSettlementRaw = p.settlementId !== null ? ctx.settlements.find((s) => s.id === p.settlementId) : undefined;
  const settlement = ownSettlementRaw !== undefined ? settlementGlimpse(ownSettlementRaw, ctx) : null;

  const nearbySettlements = ctx.settlements
    .filter((s) => s.id !== p.settlementId)
    .filter((s) => dist(p.pos, s.center) <= PERCEPTION_RADIUS * NEARBY_SETTLEMENT_RADIUS_MULTIPLIER)
    .map((s) => settlementGlimpse(s, ctx));

  const civ = buildCivGlimpse(p, ctx);
  const dangers = buildDangers(p, ctx, nearbySettlements, settlement);
  const candidates = legalActions(p, toActionsCtx(ctx), taboos);

  return {
    tick: ctx.tick,
    self: p,
    candidates,
    nearbyPeople,
    nearbyTiles,
    settlement,
    nearbySettlements,
    civ,
    dangers,
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/agents/perception.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/agents/perception.test.ts (11 tests)

 Test Files  1 passed (1)
      Tests  11 passed (11)
```

- [ ] **Step 5: Run the whole suite and typecheck**

Run:

```
npx vitest run
npm run typecheck
```

Expected: every test file from Tasks 2-16 passes (no failures, no skips); typecheck exits 0 with no errors. This confirms the section left Sections 1-2 untouched and is internally consistent.

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/agents/perception.ts tests/engine/agents/perception.test.ts
git commit -m "feat(agents): perception builder assembling glimpses, civ view and dangers" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
