## Section 4: Lifecycle, learning, decision (Tasks 17-19)

This section completes the per-person engine loop. Task 17 gives people mortality and reproduction: aging, starvation and disease death, grief propagation to partner and kin, conception, gestation, and birth with lineage inheritance. Task 18 adds the three learning channels: reinforcement over action weights, social imitation of the locally most influential person, and direct teaching. Task 19 assembles the decision pipeline that turns a brain's scored candidates into one chosen action via learned weights, the moral gate, and softmax sampling — and creates `tests/helpers/testBrain.ts`, the neutral brain every test before Task 21 uses. All three tasks depend only on Tasks 1-16 (scaffold, rng, shared types, names, climate, and the Section 3 agent modules). Engine tests run in the default node environment (no jsdom pragma). Every command runs from the repo root `C:\simulation_exp`.

**Contract deviations in this section (recorded, deliberate):**

1. `updateLifecycle` gains a required third parameter — the exact signature is `export function updateLifecycle(p: Person, ctx: LifecycleCtx, brainInit: (p: Person, rng: Rng) => unknown): void`. The contract comment says birth "uses createChild + registry init", but the brain registry is Task 20 and lifecycle is Task 17; importing the registry would also create a dependency cycle once brains consume agent modules. The initializer is therefore injected. Task 33 must call it as `updateLifecycle(p, ctx, (person, rng) => getBrain(person.lineage).init(person, rng))`.
2. Per-file structural context interfaces instead of the Task 33 `EngineCtx` (same pattern as Section 3): `LifecycleCtx` (Task 17) and `LearningCtx` (Task 18) declare only the fields each module reads. `EngineCtx` is a structural superset, so `Simulation` passes its `ctx` object directly with no adaptation.
3. `chooseAction` takes `brain: BrainLike`, not `brain: Brain` — `src/engine/brains/types.ts` does not exist until Task 20. `BrainLike` (declared in `decide.ts`) is a structural subset of the contract `Brain` (`decide` + `temperament` only), and its temperament return type is extracted from `moralGate` itself (`Parameters<typeof moralGate>[2]`), so `decide.ts` compiles against whatever structural temperament type Task 11's `morality.ts` declared. Every real `Brain` is assignable to `BrainLike`; Task 33 passes `getBrain(p.lineage)` unchanged.
4. Infection state is an extension property on the `Person` object (`infectedUntil?: Tick`), not a new field in the frozen shared `Person` type. It is written and read only through the exported helpers `setInfected` / `isInfected`, it is a plain number so `JSON.stringify` of a person carries it (Task 36 `serialize` picks it up for free), and it never becomes `NaN` (Task 33 invariants iterate person fields and see a finite number or nothing).
5. `tests/helpers/testBrain.ts` returns `TestBrain`, a field-for-field structural mirror of the Task 20 `Brain`/`Temperament` contract (which does not exist yet at Task 19). Once Task 20 lands, `TestBrain` and `Brain` are mutually assignable, so the conformance suite and later tests can use `makeTestBrain()` wherever a `Brain` is expected, exactly as the contract's `makeTestBrain(lineage?): Brain` line intends.

### Task 17: Lifecycle (`src/engine/agents/lifecycle.ts`)

**Files:**
- Create: `src/engine/agents/lifecycle.ts`
- Test: `tests/engine/agents/lifecycle.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Civ`, `Emotions`, `Tick`, `TechId` (tests only), constants `YEAR_TICKS = 360`, `ADULT_AGE_TICKS = 16 * YEAR_TICKS`, `GESTATION_TICKS = 270`, and `dist(a: Vec2, b: Vec2): number` (euclidean)
- From `src/engine/rng.ts` (Task 2): `Rng` (`next(): number; int(maxExclusive: number): number; range(min: number, max: number): number; pick<T>(arr: readonly T[]): T; chance(p: number): boolean; gaussian(mean: number, sd: number): number; split(label: string): Rng`); tests also use `createRng(seed: number): Rng`
- From `src/engine/names.ts` (Task 4): `NameGen`; tests also use `makeNameGenerator(rng: Rng): NameGen`
- From `src/engine/world/climate.ts` (Task 6): `NaturalEvent { kind: 'drought' | 'harsh-winter' | 'disease'; startTick: Tick; durationTicks: number; center: Vec2 | null; intensity: number }` and `isEventActive(e: NaturalEvent, tick: Tick): boolean` (true while `startTick <= tick < startTick + durationTicks`; Section 2 exports this explicitly for this task). Disease events always carry a non-null land-tile `center` and `intensity` in (0.3, 1].
- From `src/engine/agents/needs.ts` (Task 9): `applyHungerHealth(p: Person): void` — contract behavior: `needs.hunger > 0.85` drains `health` by 0.01 per call
- From `src/engine/agents/emotions.ts` (Task 10): `applyEmotionImpulse(p: Person, impulse: Partial<Emotions>, volatility: Emotions): void` — `p.emotions += impulse * volatility`, clamped to [0, 1]
- From `src/engine/agents/memory.ts` (Task 12): `remember(p: Person, rec: MemoryEventRec): void`
- From `src/engine/agents/relationships.ts` (Task 13): `adjustRelationship(p: Person, otherId: number, kind: RelationKind, delta: number): void`
- From `src/engine/agents/person.ts` (Task 8): `createChild(id: number, mother: Person, father: Person, names: NameGen, rng: Rng): Person` (trait/morality blend + gaussian mutation sd 0.05; `lineage = rng.pick` of the parents' lineages; `parentIds` set to the two parent ids); tests also use `createPerson(id: number, civId: number, lineage: Lineage, pos: Vec2, names: NameGen, rng: Rng): Person`

Produces:
- `export function updateLifecycle(p: Person, ctx: LifecycleCtx, brainInit: (p: Person, rng: Rng) => unknown): void` — **deviation 1; this exact signature is frozen for Task 33.** Per-person, per-tick. Internal order: +1 aging → `applyHungerHealth` → disease → death check → birth → conception. Returns immediately for the dead; a person who dies this tick neither gives birth nor conceives.
- `export interface LifecycleCtx { people: Person[]; personById: Map<number, Person>; civs: Civ[]; names: NameGen; tick: Tick; rng: Rng; naturalEvents: NaturalEvent[]; counters: { births: number; deaths: number } }` — structural subset of `EngineCtx` (deviation 2); Task 33 passes its `ctx` directly.
- `export function isInfected(p: Person, tick: Tick): boolean` and `export function setInfected(p: Person, untilTick: Tick): void` — the only access to the infection extension property (deviation 4). Tasks 16/34 may use `isInfected` for danger glimpses / narration if they wish.
- Exported tuning constants: `DISEASE_RADIUS = 10`, `INFECTION_CHANCE_PER_INTENSITY = 0.002`, `DISEASE_HEALTH_DRAIN = 0.008`, `FERTILE_MIN_AGE_TICKS = ADULT_AGE_TICKS`, `FERTILE_MAX_AGE_TICKS = 45 * YEAR_TICKS`, `CONCEPTION_HUNGER_MAX = 0.7`, `CONCEPTION_CHANCE = 0.004`, `GRIEF_IMPULSE = 0.5`.

Wiring notes for Task 33 (binding):
- Call `updateLifecycle` for every person in ascending id order in tick step 4, passing `(person, rng) => getBrain(person.lineage).init(person, rng)` as `brainInit`.
- `applyHungerHealth` is called INSIDE `updateLifecycle` — the Simulation must not call it a second time elsewhere, or hunger would drain double.
- Births push the child onto `ctx.people`, register it in `ctx.personById`, and increment `ctx.counters.births`. Deaths set `alive = false`, `health = 0`, fill `causeOfDeath`, and increment `ctx.counters.deaths`. Iterating `ctx.people` with `for...of` during step 4 will visit same-tick newborns; that is harmless (they merely age to 1).
- Settlement member removal for the dead is deliberately NOT done here — `updateSettlements` (Task 26) owns `memberIds` pruning.
- `causeOfDeath` values produced here: `'starvation'`, `'disease'`, `'old-age'`. `'violence'` is set by `execute.ts` (Task 15) before lifecycle runs and is never overwritten.
- Narrative events for births/deaths are NOT emitted here; Task 34 narrates from counters and person state, keeping this module free of the events dependency.

- [ ] **Step 1: Write the failing lifecycle tests**

Create `tests/engine/agents/lifecycle.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  CONCEPTION_HUNGER_MAX,
  DISEASE_HEALTH_DRAIN,
  GRIEF_IMPULSE,
  isInfected,
  setInfected,
  updateLifecycle,
  type LifecycleCtx,
} from '../../../src/engine/agents/lifecycle';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng, type Rng } from '../../../src/engine/rng';
import type { NaturalEvent } from '../../../src/engine/world/climate';
import {
  GESTATION_TICKS,
  YEAR_TICKS,
  type Civ,
  type Person,
  type TechId,
} from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

/** Deterministic Rng stub: chance() is always true, gaussian() returns the mean. */
const alwaysRng: Rng = {
  next: () => 0.5,
  int: (_maxExclusive: number) => 0,
  range: (min: number, _max: number) => min,
  pick: <T>(arr: readonly T[]): T => arr[0] as T,
  chance: (_p: number) => true,
  gaussian: (mean: number, _sd: number) => mean,
  split: (_label: string): Rng => alwaysRng,
};

/** A normalized adult: 20 years old, healthy, fed, calm, unattached. */
function makePerson(id: number): Person {
  const p = createPerson(id, 0, 'fable', { x: 5, y: 5 }, names, createRng(1000 + id));
  p.alive = true;
  p.ageTicks = 20 * YEAR_TICKS;
  p.lifespanTicks = 1_000_000;
  p.health = 1;
  p.needs.hunger = 0;
  p.emotions = { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 };
  p.memory = [];
  p.relationships = [];
  p.partnerId = null;
  p.pregnantUntil = null;
  p.parentIds = null;
  p.causeOfDeath = null;
  return p;
}

function makeCiv(techs: TechId[] = []): Civ {
  return {
    id: 0,
    name: 'Testia',
    color: '#ffffff',
    knowledge: { fire: 0, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
    techs,
    atWarWith: [],
    warWeariness: 0,
  };
}

interface CtxOpts {
  tick?: number;
  rng?: Rng;
  naturalEvents?: NaturalEvent[];
  civ?: Civ;
}

function makeCtx(people: Person[], opts: CtxOpts = {}): LifecycleCtx {
  return {
    people,
    personById: new Map(people.map((p) => [p.id, p])),
    civs: [opts.civ ?? makeCiv()],
    names,
    tick: opts.tick ?? 1000,
    rng: opts.rng ?? createRng(42),
    naturalEvents: opts.naturalEvents ?? [],
    counters: { births: 0, deaths: 0 },
  };
}

const noopInit = (): unknown => ({});

describe('updateLifecycle — aging and death', () => {
  it('ages a living person by exactly one tick', () => {
    const p = makePerson(1);
    const ctx = makeCtx([p]);
    updateLifecycle(p, ctx, noopInit);
    expect(p.ageTicks).toBe(20 * YEAR_TICKS + 1);
    expect(p.alive).toBe(true);
    expect(ctx.counters.deaths).toBe(0);
  });

  it('does nothing to the dead', () => {
    const p = makePerson(1);
    p.alive = false;
    p.ageTicks = 500;
    const ctx = makeCtx([p]);
    updateLifecycle(p, ctx, noopInit);
    expect(p.ageTicks).toBe(500);
    expect(ctx.counters.deaths).toBe(0);
  });

  it('starvation: sustained hunger drains health to death with causeOfDeath starvation', () => {
    const p = makePerson(1);
    p.needs.hunger = 1;
    p.health = 0.005; // one 0.01 hunger drain kills
    const ctx = makeCtx([p]);
    updateLifecycle(p, ctx, noopInit);
    expect(p.alive).toBe(false);
    expect(p.health).toBe(0);
    expect(p.causeOfDeath).toBe('starvation');
    expect(ctx.counters.deaths).toBe(1);
  });

  it('old age: dies when ageTicks pass lifespanTicks', () => {
    const p = makePerson(1);
    p.ageTicks = 50 * YEAR_TICKS;
    p.lifespanTicks = 50 * YEAR_TICKS; // the +1 aging this tick pushes past the limit
    const ctx = makeCtx([p]);
    updateLifecycle(p, ctx, noopInit);
    expect(p.alive).toBe(false);
    expect(p.causeOfDeath).toBe('old-age');
    expect(p.health).toBe(0);
    expect(ctx.counters.deaths).toBe(1);
  });

  it('honours a causeOfDeath already set by execute.ts (violence)', () => {
    const p = makePerson(1);
    p.health = 0;
    p.causeOfDeath = 'violence';
    const ctx = makeCtx([p]);
    updateLifecycle(p, ctx, noopInit);
    expect(p.alive).toBe(false);
    expect(p.causeOfDeath).toBe('violence');
    expect(ctx.counters.deaths).toBe(1);
  });

  it('grief propagates to partner and kin: impulse 0.5, kin-died memory, widowing', () => {
    const d = makePerson(1);
    const widow = makePerson(2);
    const kin = makePerson(3);
    const stranger = makePerson(4);
    d.partnerId = widow.id;
    widow.partnerId = d.id;
    d.relationships = [{ otherId: kin.id, kind: 'kin', affinity: 0.8 }];
    d.needs.hunger = 1;
    d.health = 0.005; // dies of starvation this tick
    const ctx = makeCtx([d, widow, kin, stranger]);
    updateLifecycle(d, ctx, noopInit);
    expect(d.alive).toBe(false);
    expect(widow.emotions.grief).toBeCloseTo(GRIEF_IMPULSE, 5);
    expect(kin.emotions.grief).toBeCloseTo(GRIEF_IMPULSE, 5);
    expect(stranger.emotions.grief).toBe(0);
    expect(widow.memory[0]).toMatchObject({ kind: 'kin-died', otherId: d.id, tick: ctx.tick });
    expect(kin.memory[0]).toMatchObject({ kind: 'kin-died', otherId: d.id, tick: ctx.tick });
    expect(widow.partnerId).toBeNull();
  });
});

describe('updateLifecycle — disease', () => {
  it('infects people within radius 10 of an active disease event, not beyond', () => {
    const near = makePerson(1);
    near.pos = { x: 5, y: 6 };
    const far = makePerson(2);
    far.pos = { x: 30, y: 30 };
    const disease: NaturalEvent = {
      kind: 'disease',
      startTick: 1000,
      durationTicks: 60,
      center: { x: 5, y: 5 },
      intensity: 1,
    };
    const ctx = makeCtx([near, far], { tick: 1000, rng: alwaysRng, naturalEvents: [disease] });
    updateLifecycle(near, ctx, noopInit);
    updateLifecycle(far, ctx, noopInit);
    expect(isInfected(near, ctx.tick)).toBe(true);
    expect(near.health).toBeCloseTo(1 - DISEASE_HEALTH_DRAIN, 5);
    expect(isInfected(far, ctx.tick)).toBe(false);
    expect(far.health).toBe(1);
  });

  it('medicine tech halves the disease drain', () => {
    const p = makePerson(1);
    setInfected(p, 1100);
    const ctx = makeCtx([p], { civ: makeCiv(['medicine']) }); // tick 1000
    updateLifecycle(p, ctx, noopInit);
    expect(p.health).toBeCloseTo(1 - DISEASE_HEALTH_DRAIN / 2, 5);
  });

  it('an infected person whose health reaches 0 dies of disease', () => {
    const p = makePerson(1);
    setInfected(p, 1100);
    p.health = 0.004; // one full 0.008 drain kills
    const ctx = makeCtx([p]);
    updateLifecycle(p, ctx, noopInit);
    expect(p.alive).toBe(false);
    expect(p.causeOfDeath).toBe('disease');
  });

  it('infection expires at its end tick with no further drain', () => {
    const p = makePerson(1);
    setInfected(p, 1000); // ends exactly at the current tick
    const ctx = makeCtx([p]); // tick 1000, no active events
    updateLifecycle(p, ctx, noopInit);
    expect(isInfected(p, ctx.tick)).toBe(false);
    expect(p.health).toBe(1);
  });
});

describe('updateLifecycle — reproduction', () => {
  it('an eligible partnered female conceives: pregnantUntil = tick + GESTATION_TICKS', () => {
    const mother = makePerson(1);
    mother.sex = 'f';
    const father = makePerson(2);
    father.sex = 'm';
    mother.partnerId = 2;
    father.partnerId = 1;
    const ctx = makeCtx([mother, father], { rng: alwaysRng }); // tick 1000
    updateLifecycle(mother, ctx, noopInit);
    expect(mother.pregnantUntil).toBe(1000 + GESTATION_TICKS);
  });

  it('conception is gated by age window, hunger, partner, sex and existing pregnancy', () => {
    const cases: { label: string; mutate: (mother: Person, father: Person) => void }[] = [
      { label: 'too young (15y)', mutate: (m) => { m.ageTicks = 15 * YEAR_TICKS; } },
      { label: 'too old (46y)', mutate: (m) => { m.ageTicks = 46 * YEAR_TICKS; } },
      { label: 'too hungry (hunger 0.7)', mutate: (m) => { m.needs.hunger = CONCEPTION_HUNGER_MAX; } },
      { label: 'no partner', mutate: (m) => { m.partnerId = null; } },
      { label: 'dead partner', mutate: (_m, f) => { f.alive = false; } },
      { label: 'male', mutate: (m) => { m.sex = 'm'; } },
    ];
    for (const c of cases) {
      const mother = makePerson(1);
      mother.sex = 'f';
      const father = makePerson(2);
      father.sex = 'm';
      mother.partnerId = 2;
      father.partnerId = 1;
      c.mutate(mother, father);
      const ctx = makeCtx([mother, father], { rng: alwaysRng });
      updateLifecycle(mother, ctx, noopInit);
      expect(mother.pregnantUntil, c.label).toBeNull();
    }

    // an existing pregnancy is never re-rolled
    const mother = makePerson(1);
    mother.sex = 'f';
    const father = makePerson(2);
    mother.partnerId = 2;
    mother.pregnantUntil = 5000; // due in the future
    const ctx = makeCtx([mother, father], { rng: alwaysRng });
    updateLifecycle(mother, ctx, noopInit);
    expect(mother.pregnantUntil).toBe(5000);
  });

  it('conception -> gestation -> birth over a tick loop; child inherits lineage, parents, kin and brainState', () => {
    const mother = makePerson(1);
    mother.sex = 'f';
    mother.lineage = 'opus';
    const father = makePerson(2);
    father.sex = 'm';
    father.lineage = 'haiku';
    mother.partnerId = 2;
    father.partnerId = 1;
    const ctx = makeCtx([mother, father], { tick: 0, rng: createRng(123) });
    const brainInit = (child: Person, _rng: Rng): unknown => ({ initializedFor: child.id });

    let conceptionTick = -1;
    let birthTick = -1;
    for (let t = 0; t < 12000 && birthTick === -1; t++) {
      ctx.tick = t;
      updateLifecycle(mother, ctx, brainInit);
      if (conceptionTick === -1 && mother.pregnantUntil !== null) conceptionTick = t;
      if (ctx.counters.births > 0) birthTick = t;
    }

    expect(conceptionTick).toBeGreaterThanOrEqual(0);
    expect(birthTick).toBe(conceptionTick + GESTATION_TICKS);
    expect(ctx.people).toHaveLength(3);
    expect(ctx.counters.births).toBe(1);

    const child = ctx.people[2] as Person;
    expect(child.id).toBe(3);
    expect(child.alive).toBe(true);
    expect(['opus', 'haiku']).toContain(child.lineage);
    expect(child.parentIds).not.toBeNull();
    expect([...(child.parentIds as [number, number])].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(child.brainState).toEqual({ initializedFor: child.id });
    expect(ctx.personById.get(child.id)).toBe(child);
    expect(mother.pregnantUntil).toBeNull();
    expect(mother.relationships.some((r) => r.otherId === child.id && r.kind === 'kin')).toBe(true);
    expect(child.relationships.some((r) => r.otherId === mother.id && r.kind === 'kin')).toBe(true);
    expect(mother.memory.some((m) => m.kind === 'birth' && m.otherId === child.id)).toBe(true);
  });

  it('no living father at term: the pregnancy ends without a birth', () => {
    const mother = makePerson(1);
    mother.sex = 'f';
    const father = makePerson(2);
    father.alive = false;
    mother.partnerId = 2;
    mother.pregnantUntil = 1000; // due exactly now
    const ctx = makeCtx([mother, father]); // tick 1000
    updateLifecycle(mother, ctx, noopInit);
    expect(ctx.counters.births).toBe(0);
    expect(ctx.people).toHaveLength(2);
    expect(mother.pregnantUntil).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```
npx vitest run tests/engine/agents/lifecycle.test.ts
```

Expected: FAIL — the suite cannot load, with a module-resolution error such as `Error: Failed to resolve import "../../../src/engine/agents/lifecycle" from "tests/engine/agents/lifecycle.test.ts". Does the file exist?` (`src/engine/agents/lifecycle.ts` does not exist yet). This is the required failing state.

- [ ] **Step 3: Implement `src/engine/agents/lifecycle.ts`**

Create `src/engine/agents/lifecycle.ts` with exactly:

```ts
import {
  ADULT_AGE_TICKS,
  GESTATION_TICKS,
  YEAR_TICKS,
  dist,
  type Civ,
  type Emotions,
  type Person,
  type Tick,
} from '../../shared/types';
import type { Rng } from '../rng';
import type { NameGen } from '../names';
import { isEventActive, type NaturalEvent } from '../world/climate';
import { applyHungerHealth } from './needs';
import { applyEmotionImpulse } from './emotions';
import { remember } from './memory';
import { adjustRelationship } from './relationships';
import { createChild } from './person';

/**
 * Structural subset of the Task 33 EngineCtx containing only what lifecycle
 * reads. EngineCtx is a superset, so Simulation passes its ctx directly.
 */
export interface LifecycleCtx {
  people: Person[];
  personById: Map<number, Person>;
  civs: Civ[];
  names: NameGen;
  tick: Tick;
  rng: Rng;
  naturalEvents: NaturalEvent[];
  counters: { births: number; deaths: number };
}

// Tuning constants (exported so tests and later balance passes can assert them).
export const DISEASE_RADIUS = 10;
export const INFECTION_CHANCE_PER_INTENSITY = 0.002; // per tick: 0.002 * event.intensity
export const DISEASE_HEALTH_DRAIN = 0.008; // health per tick while infected (halved by medicine)
export const FERTILE_MIN_AGE_TICKS = ADULT_AGE_TICKS; // 16 years
export const FERTILE_MAX_AGE_TICKS = 45 * YEAR_TICKS; // 45 years
export const CONCEPTION_HUNGER_MAX = 0.7; // needs.hunger must be strictly below this
export const CONCEPTION_CHANCE = 0.004; // per eligible tick
export const GRIEF_IMPULSE = 0.5;

/**
 * Volatility-neutral multiplier for impulses lifecycle applies itself:
 * lifecycle has no access to per-lineage temperament (only brainInit is
 * injected), so grief and birth-joy land at face value.
 */
const NEUTRAL_VOLATILITY: Emotions = { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 };

/**
 * Infection is tracked as an extension property on the Person object rather
 * than a new field in the frozen shared Person type (deviation 4). It is a
 * plain number, so JSON serialization of a person (Task 36) carries it, and
 * it is only ever touched through the helpers below.
 */
interface WithInfection {
  infectedUntil?: Tick;
}

/** True while the person carries an infection that has not yet run out. */
export function isInfected(p: Person, tick: Tick): boolean {
  const until = (p as Person & WithInfection).infectedUntil;
  return until !== undefined && tick < until;
}

/** Mark the person infected until untilTick (exclusive). */
export function setInfected(p: Person, untilTick: Tick): void {
  (p as Person & WithInfection).infectedUntil = untilTick;
}

function clearInfection(p: Person): void {
  delete (p as Person & WithInfection).infectedUntil;
}

/**
 * Per-person lifecycle update, run once per tick for every person
 * (Simulation tick step 4, ascending id). Internal order: aging -> hunger
 * health drain -> disease -> death check -> birth -> conception. A person
 * who dies this tick neither gives birth nor conceives.
 *
 * brainInit is injected to avoid a circular dependency on the brain registry
 * (Task 20). Task 33 passes:
 *   (person, rng) => getBrain(person.lineage).init(person, rng)
 */
export function updateLifecycle(
  p: Person,
  ctx: LifecycleCtx,
  brainInit: (p: Person, rng: Rng) => unknown,
): void {
  if (!p.alive) return;

  p.ageTicks += 1; // aging: +1 tick
  applyHungerHealth(p); // starvation drain owned by needs.ts (hunger > 0.85 -> -0.01/tick)
  updateDisease(p, ctx);

  if (p.health <= 0 || p.ageTicks > p.lifespanTicks) {
    die(p, ctx);
    return;
  }

  if (p.sex === 'f' && p.pregnantUntil !== null && p.pregnantUntil <= ctx.tick) {
    giveBirth(p, ctx, brainInit);
  }
  maybeConceive(p, ctx);
}

function updateDisease(p: Person, ctx: LifecycleCtx): void {
  // Recovery: the infection window has passed.
  const ext = p as Person & WithInfection;
  if (ext.infectedUntil !== undefined && ctx.tick >= ext.infectedUntil) {
    clearInfection(p);
  }

  // Exposure: any active disease event within DISEASE_RADIUS can infect,
  // chance 0.002 * intensity per tick. The infection lasts until the event
  // ends (startTick + durationTicks).
  if (!isInfected(p, ctx.tick)) {
    for (const ev of ctx.naturalEvents) {
      if (ev.kind !== 'disease' || ev.center === null) continue;
      if (!isEventActive(ev, ctx.tick)) continue;
      if (dist(p.pos, ev.center) > DISEASE_RADIUS) continue;
      if (ctx.rng.chance(INFECTION_CHANCE_PER_INTENSITY * ev.intensity)) {
        setInfected(p, ev.startTick + ev.durationTicks);
        break;
      }
    }
  }

  // Sickness: drain health, halved when the person's civ has active medicine.
  if (isInfected(p, ctx.tick)) {
    const civ = ctx.civs.find((c) => c.id === p.civId);
    const drain =
      civ !== undefined && civ.techs.includes('medicine')
        ? DISEASE_HEALTH_DRAIN / 2
        : DISEASE_HEALTH_DRAIN;
    p.health = Math.max(0, p.health - drain);
  }
}

function die(p: Person, ctx: LifecycleCtx): void {
  // Cause precedence: execute.ts may already have set 'violence' — never
  // overwrite an existing cause. Otherwise: disease, then starvation, then
  // old-age (which also covers any residual health<=0 case).
  if (p.causeOfDeath === null) {
    if (p.health <= 0 && isInfected(p, ctx.tick)) p.causeOfDeath = 'disease';
    else if (p.health <= 0 && p.needs.hunger > 0.85) p.causeOfDeath = 'starvation';
    else p.causeOfDeath = 'old-age';
  }
  p.alive = false;
  p.health = 0;
  clearInfection(p);
  ctx.counters.deaths += 1;

  // Grief: the partner, everyone the deceased recorded as kin/partner, and
  // the deceased's parents. Settlement member removal is deliberately
  // deferred to society/settlements.ts updateSettlements (Task 26).
  const mourners = new Set<number>();
  if (p.partnerId !== null) mourners.add(p.partnerId);
  if (p.parentIds !== null) {
    mourners.add(p.parentIds[0]);
    mourners.add(p.parentIds[1]);
  }
  for (const rel of p.relationships) {
    if (rel.kind === 'kin' || rel.kind === 'partner') mourners.add(rel.otherId);
  }
  for (const id of mourners) {
    const other = ctx.personById.get(id);
    if (other === undefined || !other.alive) continue;
    applyEmotionImpulse(other, { grief: GRIEF_IMPULSE }, NEUTRAL_VOLATILITY);
    remember(other, { tick: ctx.tick, kind: 'kin-died', otherId: p.id, valence: -0.9, salience: 0.9 });
    if (other.partnerId === p.id) other.partnerId = null; // widowed; may court again later
  }
}

function giveBirth(
  p: Person,
  ctx: LifecycleCtx,
  brainInit: (p: Person, rng: Rng) => unknown,
): void {
  const father = p.partnerId !== null ? ctx.personById.get(p.partnerId) : undefined;
  p.pregnantUntil = null; // the pregnancy ends whether or not a child arrives
  if (father === undefined || !father.alive) return; // no living father: no birth

  // Ids are never reused (the dead stay in ctx.people), so max+1 is safe and
  // deterministic. Births are rare, so the O(n) scan is fine.
  let maxId = 0;
  for (const q of ctx.people) {
    if (q.id > maxId) maxId = q.id;
  }

  const child = createChild(maxId + 1, p, father, ctx.names, ctx.rng);
  child.brainState = brainInit(child, ctx.rng);
  ctx.people.push(child);
  ctx.personById.set(child.id, child);
  ctx.counters.births += 1;

  // Kin wiring in both directions. adjustRelationship creates-or-adjusts, so
  // this is safe even if createChild (Task 8) already linked them.
  adjustRelationship(p, child.id, 'kin', 0.9);
  adjustRelationship(child, p.id, 'kin', 0.9);
  adjustRelationship(father, child.id, 'kin', 0.9);
  adjustRelationship(child, father.id, 'kin', 0.9);

  remember(p, { tick: ctx.tick, kind: 'birth', otherId: child.id, valence: 0.9, salience: 0.8 });
  remember(father, { tick: ctx.tick, kind: 'birth', otherId: child.id, valence: 0.9, salience: 0.8 });
  applyEmotionImpulse(p, { joy: 0.3 }, NEUTRAL_VOLATILITY);
  applyEmotionImpulse(father, { joy: 0.3 }, NEUTRAL_VOLATILITY);
}

function maybeConceive(p: Person, ctx: LifecycleCtx): void {
  if (p.sex !== 'f' || p.pregnantUntil !== null || p.partnerId === null) return;
  if (p.ageTicks < FERTILE_MIN_AGE_TICKS || p.ageTicks > FERTILE_MAX_AGE_TICKS) return;
  if (p.needs.hunger >= CONCEPTION_HUNGER_MAX) return;
  const partner = ctx.personById.get(p.partnerId);
  if (partner === undefined || !partner.alive) return;
  if (ctx.rng.chance(CONCEPTION_CHANCE)) {
    p.pregnantUntil = ctx.tick + GESTATION_TICKS;
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run:

```
npx vitest run tests/engine/agents/lifecycle.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/agents/lifecycle.test.ts (14 tests)

 Test Files  1 passed (1)
      Tests  14 passed (14)
```

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: no output besides the npm banner, exit code 0 (no type errors).

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/agents/lifecycle.ts tests/engine/agents/lifecycle.test.ts
git commit -m "feat(agents): lifecycle - aging, disease, death, grief, conception and birth" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 18: Learning (`src/engine/agents/learning.ts`)

**Files:**
- Create: `src/engine/agents/learning.ts`
- Test: `tests/engine/agents/learning.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `ACTION_KINDS`, `ACTION_WEIGHT_MIN = 0.2`, `ACTION_WEIGHT_MAX = 3.0`, `PERCEPTION_RADIUS = 4`, `SKILL_NAMES`, `clamp(v, lo, hi): number`, `clamp01(v): number`, types `Person`, `Morality`, `SkillName`, `Tick`, `Vec2`, `ActionKind` (tests)
- From `src/engine/rng.ts` (Task 2): `Rng`; tests also use `createRng(seed: number): Rng`
- From `src/engine/agents/execute.ts` (Task 15): `Outcome { action: Action; success: boolean; reward: number; tick: Tick }` (reward in [-1, 1])
- Tests also use `createPerson` (Task 8) and `makeNameGenerator` (Task 4)

Produces:
- `export function reinforce(p: Person, o: Outcome, learningRate: number): void` — exact contract formula: `p.actionWeights[o.action.kind] = clamp(w + learningRate * o.reward * 0.25, ACTION_WEIGHT_MIN, ACTION_WEIGHT_MAX)`
- `export function maybeImitate(p: Person, ctx: LearningCtx, imitationRate: number): void` — no-op unless `ctx.tick % 30 === 0` AND `ctx.rng.chance(imitationRate)`; then every action weight blends 10% toward the highest-influence living neighbor within `PERCEPTION_RADIUS` (ties break to the lowest id; the person itself is excluded; no neighbor = no-op)
- `export function teach(teacher: Person, student: Person): void` — `student.skills[k] += 0.05 * teacher.skills.teaching` for the teacher's best skill `k` (first-in-SKILL_NAMES-order on ties), clamped to [0, 1]; every morality foundation of the student moves 2% toward the teacher's: `m += 0.02 * (teacherM - m)`, clamped to [0, 1]
- `export interface SpatialNearLike { near(pos: Vec2, radius: number): number[] }` — the one spatial capability learning needs; the Task 7 `SpatialIndex` satisfies it
- `export interface LearningCtx { personById: Map<number, Person>; spatial: SpatialNearLike; tick: Tick; rng: Rng }` — structural subset of `EngineCtx` (deviation 2); Task 33 passes its `ctx` directly
- Exported constants: `REINFORCE_SCALE = 0.25`, `IMITATION_INTERVAL = 30`, `IMITATION_BLEND = 0.1`, `TEACH_SKILL_RATE = 0.05`, `TEACH_MORALITY_NUDGE = 0.02`

Wiring notes (binding):
- Task 33 tick step 3 calls `reinforce(p, outcome, getBrain(p.lineage).temperament().learningRate)` right after `executeAction`; tick step 6 calls `maybeImitate(p, ctx, getBrain(p.lineage).temperament().imitationRate)`.
- `teach(teacher, student)` is the canonical contract transfer routine for the `'teach'` action. `execute.ts` (Task 15) predates this file, so its `'teach'` branch either already implements an equivalent inline effect or defers the transfer; Task 33's integration wires the call `teach(p, target)` into the `'teach'` execution path if `execute.ts` left it pending. This task only defines and tests the function; it does not modify `execute.ts`.

- [ ] **Step 1: Write the failing learning tests**

Create `tests/engine/agents/learning.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import type { Outcome } from '../../../src/engine/agents/execute';
import {
  IMITATION_INTERVAL,
  maybeImitate,
  reinforce,
  teach,
  type LearningCtx,
} from '../../../src/engine/agents/learning';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import {
  ACTION_KINDS,
  ACTION_WEIGHT_MAX,
  ACTION_WEIGHT_MIN,
  SKILL_NAMES,
  type ActionKind,
  type Person,
} from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function makePerson(id: number): Person {
  const p = createPerson(id, 0, 'fable', { x: 5, y: 5 }, names, createRng(1000 + id));
  p.alive = true;
  p.influence = 0;
  for (const k of ACTION_KINDS) p.actionWeights[k] = 1;
  return p;
}

function outcome(kind: ActionKind, reward: number): Outcome {
  return { action: { kind }, success: reward >= 0, reward, tick: 0 };
}

function makeCtx(people: Person[], tick: number): LearningCtx {
  return {
    personById: new Map(people.map((p) => [p.id, p])),
    spatial: { near: () => people.map((p) => p.id) },
    tick,
    rng: createRng(42),
  };
}

describe('reinforce', () => {
  it('positive reward raises the acted weight (and only it)', () => {
    const p = makePerson(1);
    reinforce(p, outcome('gather', 1), 0.5);
    expect(p.actionWeights.gather).toBeCloseTo(1.125, 6); // 1 + 0.5 * 1 * 0.25
    expect(p.actionWeights.farm).toBe(1);
  });

  it('negative reward lowers the acted weight', () => {
    const p = makePerson(1);
    reinforce(p, outcome('steal', -1), 0.5);
    expect(p.actionWeights.steal).toBeCloseTo(0.875, 6); // 1 - 0.5 * 1 * 0.25
  });

  it('clamps to [ACTION_WEIGHT_MIN, ACTION_WEIGHT_MAX]', () => {
    const p = makePerson(1);
    p.actionWeights.gather = 2.95;
    reinforce(p, outcome('gather', 1), 1); // 2.95 + 0.25 = 3.2 -> clamp
    expect(p.actionWeights.gather).toBe(ACTION_WEIGHT_MAX);
    p.actionWeights.steal = 0.3;
    reinforce(p, outcome('steal', -1), 1); // 0.3 - 0.25 = 0.05 -> clamp
    expect(p.actionWeights.steal).toBe(ACTION_WEIGHT_MIN);
  });
});

describe('maybeImitate', () => {
  it('blends 10% toward the highest-influence neighbor', () => {
    const p = makePerson(1);
    const low = makePerson(2);
    const high = makePerson(3);
    low.influence = 0.2;
    low.actionWeights.gather = 0.2;
    high.influence = 0.9;
    high.actionWeights.gather = 3;
    const ctx = makeCtx([p, low, high], IMITATION_INTERVAL); // tick 30: on the interval
    maybeImitate(p, ctx, 1); // rate 1 -> chance always passes
    expect(p.actionWeights.gather).toBeCloseTo(1.2, 6); // 1 + 0.1 * (3 - 1): toward high, not low
  });

  it('does nothing off the 30-tick interval', () => {
    const p = makePerson(1);
    const model = makePerson(2);
    model.influence = 1;
    model.actionWeights.gather = 3;
    const ctx = makeCtx([p, model], IMITATION_INTERVAL + 1); // tick 31
    maybeImitate(p, ctx, 1);
    expect(p.actionWeights.gather).toBe(1);
  });

  it('does nothing when the imitation roll fails (rate 0)', () => {
    const p = makePerson(1);
    const model = makePerson(2);
    model.influence = 1;
    model.actionWeights.gather = 3;
    const ctx = makeCtx([p, model], IMITATION_INTERVAL);
    maybeImitate(p, ctx, 0); // chance(0) is always false
    expect(p.actionWeights.gather).toBe(1);
  });

  it('does nothing with no living neighbors', () => {
    const p = makePerson(1);
    const dead = makePerson(2);
    dead.alive = false;
    dead.influence = 1;
    dead.actionWeights.gather = 3;
    const ctx = makeCtx([p, dead], IMITATION_INTERVAL);
    maybeImitate(p, ctx, 1);
    expect(p.actionWeights.gather).toBe(1); // dead neighbor ignored; self ignored
  });

  it('repeated imitation converges toward the model weights', () => {
    const p = makePerson(1);
    const model = makePerson(2);
    model.influence = 1;
    model.actionWeights.gather = 3;
    const ctx = makeCtx([p, model], IMITATION_INTERVAL);
    let prev = p.actionWeights.gather;
    for (let i = 0; i < 30; i++) {
      maybeImitate(p, ctx, 1);
      expect(p.actionWeights.gather).toBeGreaterThan(prev);
      prev = p.actionWeights.gather;
    }
    expect(p.actionWeights.gather).toBeGreaterThan(2.8); // 3 - 2 * 0.9^30 = 2.915
    expect(p.actionWeights.gather).toBeLessThanOrEqual(3);
  });
});

describe('teach', () => {
  it("transfers the teacher's best skill scaled by teaching skill", () => {
    const teacher = makePerson(1);
    const student = makePerson(2);
    for (const s of SKILL_NAMES) {
      teacher.skills[s] = 0;
      student.skills[s] = 0;
    }
    teacher.skills.farming = 0.9; // best skill
    teacher.skills.teaching = 0.8;
    student.skills.farming = 0.1;
    teach(teacher, student);
    expect(student.skills.farming).toBeCloseTo(0.14, 6); // 0.1 + 0.05 * 0.8
    expect(student.skills.teaching).toBe(0); // only the best skill transfers
  });

  it('nudges student morality 2% toward the teacher on every foundation', () => {
    const teacher = makePerson(1);
    const student = makePerson(2);
    for (const s of SKILL_NAMES) teacher.skills[s] = 0; // no skill side effect
    teacher.morality = { care: 1, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0 };
    student.morality = { care: 0.5, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0.5 };
    teach(teacher, student);
    expect(student.morality.care).toBeCloseTo(0.51, 6); // 0.5 + 0.02 * (1 - 0.5)
    expect(student.morality.liberty).toBeCloseTo(0.49, 6); // 0.5 + 0.02 * (0 - 0.5)
    expect(student.morality.fairness).toBeCloseTo(0.5, 6); // no gap, no move
  });

  it('clamps a transferred skill at 1', () => {
    const teacher = makePerson(1);
    const student = makePerson(2);
    for (const s of SKILL_NAMES) {
      teacher.skills[s] = 0;
      student.skills[s] = 0;
    }
    teacher.skills.farming = 1;
    teacher.skills.teaching = 1;
    student.skills.farming = 0.98;
    teach(teacher, student);
    expect(student.skills.farming).toBe(1); // 0.98 + 0.05 -> clamp01
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```
npx vitest run tests/engine/agents/learning.test.ts
```

Expected: FAIL — module-resolution error: `Failed to resolve import "../../../src/engine/agents/learning"` (the file does not exist yet).

- [ ] **Step 3: Implement `src/engine/agents/learning.ts`**

Create `src/engine/agents/learning.ts` with exactly:

```ts
import {
  ACTION_KINDS,
  ACTION_WEIGHT_MAX,
  ACTION_WEIGHT_MIN,
  PERCEPTION_RADIUS,
  SKILL_NAMES,
  clamp,
  clamp01,
  type Morality,
  type Person,
  type SkillName,
  type Tick,
  type Vec2,
} from '../../shared/types';
import type { Rng } from '../rng';
import type { Outcome } from './execute';

/** The one spatial capability learning needs (the Task 7 SpatialIndex satisfies it). */
export interface SpatialNearLike {
  near(pos: Vec2, radius: number): number[];
}

/** Structural subset of the Task 33 EngineCtx used by maybeImitate. */
export interface LearningCtx {
  personById: Map<number, Person>;
  spatial: SpatialNearLike;
  tick: Tick;
  rng: Rng;
}

export const REINFORCE_SCALE = 0.25;
export const IMITATION_INTERVAL = 30; // ticks between imitation opportunities
export const IMITATION_BLEND = 0.1; // 10% toward the model per imitation
export const TEACH_SKILL_RATE = 0.05; // skill gained = 0.05 * teacher.skills.teaching
export const TEACH_MORALITY_NUDGE = 0.02; // 2% toward the teacher per lesson

/**
 * Reinforcement over action weights (contract formula):
 *   w[kind] = clamp(w[kind] + learningRate * reward * 0.25,
 *                   ACTION_WEIGHT_MIN, ACTION_WEIGHT_MAX)
 * learningRate comes from the acting person's lineage temperament
 * (Task 33 passes getBrain(p.lineage).temperament().learningRate).
 */
export function reinforce(p: Person, o: Outcome, learningRate: number): void {
  const kind = o.action.kind;
  p.actionWeights[kind] = clamp(
    p.actionWeights[kind] + learningRate * o.reward * REINFORCE_SCALE,
    ACTION_WEIGHT_MIN,
    ACTION_WEIGHT_MAX,
  );
}

/**
 * Social learning: every IMITATION_INTERVAL ticks, with probability
 * imitationRate, blend all action weights 10% toward the highest-influence
 * living neighbor within PERCEPTION_RADIUS. Ties break to the lowest id
 * (near() returns ascending ids and the comparison is strict). The person
 * itself is never a model; no neighbor means no change.
 */
export function maybeImitate(p: Person, ctx: LearningCtx, imitationRate: number): void {
  if (ctx.tick % IMITATION_INTERVAL !== 0) return;
  if (!ctx.rng.chance(imitationRate)) return;

  let model: Person | null = null;
  for (const id of ctx.spatial.near(p.pos, PERCEPTION_RADIUS)) {
    if (id === p.id) continue;
    const other = ctx.personById.get(id);
    if (other === undefined || !other.alive) continue;
    if (model === null || other.influence > model.influence) model = other;
  }
  if (model === null) return;

  for (const kind of ACTION_KINDS) {
    const w = p.actionWeights[kind];
    const target = model.actionWeights[kind];
    p.actionWeights[kind] = clamp(
      w + IMITATION_BLEND * (target - w),
      ACTION_WEIGHT_MIN,
      ACTION_WEIGHT_MAX,
    );
  }
}

/**
 * Direct teaching (the canonical routine behind the 'teach' action): the
 * student gains 0.05 * teacher.skills.teaching in the teacher's best skill
 * (first in SKILL_NAMES order on ties), and every morality foundation of the
 * student moves 2% toward the teacher's value. Both clamped to [0, 1].
 */
export function teach(teacher: Person, student: Person): void {
  let best: SkillName = SKILL_NAMES[0];
  for (const s of SKILL_NAMES) {
    if (teacher.skills[s] > teacher.skills[best]) best = s;
  }
  student.skills[best] = clamp01(student.skills[best] + TEACH_SKILL_RATE * teacher.skills.teaching);

  const foundations: (keyof Morality)[] = ['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty'];
  for (const f of foundations) {
    student.morality[f] = clamp01(
      student.morality[f] + TEACH_MORALITY_NUDGE * (teacher.morality[f] - student.morality[f]),
    );
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run:

```
npx vitest run tests/engine/agents/learning.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/agents/learning.test.ts (11 tests)

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
git add src/engine/agents/learning.ts tests/engine/agents/learning.test.ts
git commit -m "feat(agents): learning - reinforcement, imitation and teaching" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 19: Decision pipeline (`src/engine/agents/decide.ts`) + neutral test brain (`tests/helpers/testBrain.ts`)

**Files:**
- Create: `src/engine/agents/decide.ts`
- Create: `tests/helpers/testBrain.ts`
- Test: `tests/engine/agents/decide.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `SOFTMAX_TEMP = 0.35`, types `Action`, `ScoredAction { action: Action; score: number }`, `Person`; the test brain also uses `Lineage`, `Emotions`, `ActionKind`; tests use `ACTION_KINDS`
- From `src/engine/rng.ts` (Task 2): `Rng`; tests use `createRng`
- From `src/engine/agents/morality.ts` (Task 11): `moralGate(p: Person, action: Action, temperament): number` — contract semantics the tests rely on: multiplier `max(0, 1 - moralWeight * violationDot)`; hard veto (returns 0) when `violationDot > 0.75` unless desperation `max(needs.hunger, emotions.fear) >= desperationThreshold`; `MORAL_FOOTPRINTS.attack = { care: 0.9 }`, and virtuous kinds (`gather`, `rest`, `farm`, `socialize`) have empty footprints, so their gate is 1
- From `src/engine/agents/perception.ts` (Task 16): `Perception` (with `candidates: Action[]`, `civ: CivGlimpse`, etc. — tests hand-build a minimal fixture)
- From `src/engine/agents/execute.ts` (Task 15): `Outcome` (test brain's `onOutcome` parameter type)
- Tests also use `createPerson` (Task 8) and `makeNameGenerator` (Task 4)

Produces:
- `export function chooseAction(p: Person, perception: Perception, brain: BrainLike, rng: Rng): Action` — the contract 3-step pipeline. Step 1: `brain.decide(perception, p.brainState, rng)`, kept only if the action structurally matches a `perception.candidates` entry and the score is a finite number `>= 0`, deduplicated (first occurrence wins); empty result falls back to `{ kind: 'rest' }`. Step 2: `eff = score * p.actionWeights[kind] * moralGate(p, action, brain.temperament())`; entries with `eff <= 0` are dropped so a moral veto yields exactly zero probability; all dropped falls back to `{ kind: 'rest' }`. Step 3: one `rng.next()` samples softmax at temperature `SOFTMAX_TEMP` over `eff / max(eff)` (max-normalization bounds the exponent and makes the choice scale-invariant).
- `export interface BrainLike { temperament(): GateTemperament; decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[] }` — structural subset of the Task 20 `Brain` (deviation 3); every real `Brain` is assignable, so Task 33 calls `chooseAction(p, buildPerception(p, ctx), getBrain(p.lineage), ctx.rng)`.
- `export type GateTemperament = Parameters<typeof moralGate>[2]` — whatever temperament type `morality.ts` accepts; the full Task 20 `Temperament` is assignable to it.
- `tests/helpers/testBrain.ts` (contract helper, defined here): `export function makeTestBrain(lineage: Lineage = 'fable'): TestBrain` — scores every candidate 1.0, neutral temperament (all volatilities 1, all decays 0.01, moralWeight 1, learningRate 0.5, imitationRate 0.1, desperationThreshold 0.95, no taboos), `init` returns `{}`, `onOutcome` does nothing. Plus `export interface TestTemperament` and `export interface TestBrain` — field-exact structural mirrors of the Task 20 `Temperament`/`Brain` contract (deviation 5); Task 20's conformance suite may use `makeTestBrain()` anywhere a `Brain` is expected.

Wiring notes (binding):
- Task 33 tick step 3 per person: `const action = chooseAction(p, buildPerception(p, ctx), getBrain(p.lineage), ctx.rng)` then `executeAction(p, action, ctx)`.
- `chooseAction` consumes exactly one `ctx.rng.next()` per call (plus whatever the brain's own `decide` draws), keeping replay determinism simple.
- Brain exceptions are NOT caught here — the Task 20 conformance suite guarantees brains do not throw; a throw is a build-time authoring bug and should surface loudly.

- [ ] **Step 1: Create the neutral test brain helper**

Create `tests/helpers/testBrain.ts` with exactly:

```ts
import type { Outcome } from '../../src/engine/agents/execute';
import type { Perception } from '../../src/engine/agents/perception';
import type { Rng } from '../../src/engine/rng';
import type {
  ActionKind,
  Emotions,
  Lineage,
  Person,
  ScoredAction,
} from '../../src/shared/types';

/**
 * Structural mirror of the Task 20 `Temperament` contract — brains/types.ts
 * does not exist yet when this helper is created (Task 19). Field-for-field
 * identical to the contract, so once Task 20 lands, TestTemperament and
 * Temperament are mutually assignable.
 */
export interface TestTemperament {
  emotionVolatility: Emotions;
  emotionDecayPerTick: Emotions;
  moralWeight: number;
  learningRate: number;
  imitationRate: number;
  desperationThreshold: number;
  taboos: ActionKind[];
  quirks: string[];
  description: string;
}

/** Structural mirror of the Task 20 `Brain` contract. */
export interface TestBrain {
  readonly lineage: Lineage;
  temperament(): TestTemperament;
  init(person: Person, rng: Rng): unknown;
  decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[];
  onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void;
}

/**
 * The neutral test brain (contract, Task 19): scores every candidate 1.0,
 * neutral temperament, `{}` state, learns nothing. Every test that needs a
 * brain before the real ones exist (Tasks 21-24) uses this.
 */
export function makeTestBrain(lineage: Lineage = 'fable'): TestBrain {
  return {
    lineage,
    temperament: (): TestTemperament => ({
      emotionVolatility: { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 },
      emotionDecayPerTick: { fear: 0.01, joy: 0.01, grief: 0.01, anger: 0.01, hope: 0.01 },
      moralWeight: 1,
      learningRate: 0.5,
      imitationRate: 0.1,
      desperationThreshold: 0.95,
      taboos: [],
      quirks: [],
      description: 'Neutral test brain: scores every legal candidate 1.0 and never learns.',
    }),
    init: (_person: Person, _rng: Rng): unknown => ({}),
    decide: (perception: Perception, _brainState: unknown, _rng: Rng): ScoredAction[] =>
      perception.candidates.map((action) => ({ action, score: 1 })),
    onOutcome: (_outcome: Outcome, _brainState: unknown, _rng: Rng): void => {
      // The test brain never learns.
    },
  };
}
```

- [ ] **Step 2: Write the failing decision-pipeline tests**

Create `tests/engine/agents/decide.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { chooseAction, type BrainLike } from '../../../src/engine/agents/decide';
import { createPerson } from '../../../src/engine/agents/person';
import type { Perception } from '../../../src/engine/agents/perception';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import {
  ACTION_KINDS,
  type Action,
  type Person,
  type ScoredAction,
} from '../../../src/shared/types';
import { makeTestBrain } from '../../helpers/testBrain';

const names = makeNameGenerator(createRng(9));

function makePerson(id: number): Person {
  const p = createPerson(id, 0, 'fable', { x: 5, y: 5 }, names, createRng(1000 + id));
  p.alive = true;
  p.needs.hunger = 0;
  p.emotions = { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 };
  for (const k of ACTION_KINDS) p.actionWeights[k] = 1;
  return p;
}

function makePerception(p: Person, candidates: Action[]): Perception {
  return {
    tick: 0,
    self: p,
    candidates,
    nearbyPeople: [],
    nearbyTiles: [],
    settlement: null,
    nearbySettlements: [],
    civ: { id: 0, population: 1, atWarWith: [], techs: [], season: 'spring', foodPerCapita: 1 },
    dangers: [],
  };
}

/** A BrainLike with the neutral temperament and a custom decide. */
function stubBrain(decideFn: (perception: Perception) => ScoredAction[]): BrainLike {
  const base = makeTestBrain();
  return {
    temperament: () => base.temperament(),
    decide: (perception, _brainState, _rng) => decideFn(perception),
  };
}

const GATHER: Action = { kind: 'gather' };
const REST: Action = { kind: 'rest' };
const FARM: Action = { kind: 'farm' };
const SOCIALIZE: Action = { kind: 'socialize' };

describe('makeTestBrain', () => {
  it('scores every candidate 1.0 with a neutral temperament and {} state', () => {
    const brain = makeTestBrain();
    const p = makePerson(1);
    const scored = brain.decide(makePerception(p, [GATHER, REST, FARM]), {}, createRng(1));
    expect(scored).toHaveLength(3);
    for (const s of scored) expect(s.score).toBe(1);
    expect(brain.lineage).toBe('fable');
    expect(makeTestBrain('opus').lineage).toBe('opus');
    expect(brain.init(p, createRng(1))).toEqual({});
    const t = brain.temperament();
    expect(t.moralWeight).toBe(1);
    expect(t.desperationThreshold).toBe(0.95);
    expect(t.taboos).toEqual([]);
  });
});

describe('chooseAction', () => {
  it('falls back to rest when the brain returns nothing', () => {
    const p = makePerson(1);
    const perc = makePerception(p, [GATHER, REST]);
    expect(chooseAction(p, perc, stubBrain(() => []), createRng(1))).toEqual({ kind: 'rest' });
  });

  it('falls back to rest when every score is invalid (NaN, negative, Infinity)', () => {
    const p = makePerson(1);
    const perc = makePerception(p, [GATHER, REST]);
    const bad = stubBrain(() => [
      { action: GATHER, score: Number.NaN },
      { action: REST, score: -1 },
      { action: GATHER, score: Number.POSITIVE_INFINITY },
    ]);
    expect(chooseAction(p, perc, bad, createRng(1))).toEqual({ kind: 'rest' });
  });

  it('filters actions that are not in the candidate list', () => {
    const p = makePerson(1);

    // only invalid entries -> rest fallback
    const rogue = stubBrain(() => [{ action: { kind: 'steal', targetPersonId: 7 }, score: 100 }]);
    expect(chooseAction(p, makePerception(p, [GATHER]), rogue, createRng(1))).toEqual({ kind: 'rest' });

    // the non-candidate entry is dropped even at a huge score; the valid one always wins
    const mixed = stubBrain(() => [
      { action: { kind: 'attack', targetPersonId: 9 }, score: 100 },
      { action: GATHER, score: 1 },
    ]);
    for (let i = 0; i < 50; i++) {
      expect(chooseAction(p, makePerception(p, [GATHER, REST]), mixed, createRng(i))).toEqual(GATHER);
    }
  });

  it('falls back to rest on an empty candidate list even with a generous brain', () => {
    const p = makePerson(1);
    expect(chooseAction(p, makePerception(p, []), makeTestBrain(), createRng(1))).toEqual({ kind: 'rest' });
  });

  it('moral veto gives a forbidden action exactly zero probability', () => {
    const p = makePerson(1);
    p.morality = { care: 1, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0.5 };
    // desperation = max(hunger, fear) = 0 < 0.95, so the veto holds:
    // violationDot(attack) = care 1 * 0.9 = 0.9 > 0.75 -> moralGate = 0
    const attack: Action = { kind: 'attack', targetPersonId: 2 };
    const perc = makePerception(p, [attack, GATHER]);
    const rng = createRng(5);
    let attacks = 0;
    for (let i = 0; i < 500; i++) {
      if (chooseAction(p, perc, makeTestBrain(), rng).kind === 'attack') attacks += 1;
    }
    expect(attacks).toBe(0);
  });

  it('learned weights bias selection measurably over 1000 samples', () => {
    const biased = makePerson(1);
    biased.actionWeights.gather = 3;
    const neutral = makePerson(2);
    const brain = makeTestBrain();
    const countGathers = (person: Person, seed: number): number => {
      const rng = createRng(seed);
      let n = 0;
      for (let i = 0; i < 1000; i++) {
        if (chooseAction(person, makePerception(person, [GATHER, REST]), brain, rng).kind === 'gather') {
          n += 1;
        }
      }
      return n;
    };
    const biasedGathers = countGathers(biased, 11);
    const neutralGathers = countGathers(neutral, 11);
    // equal eff -> P(gather) = 0.5 (~500); eff 3 vs 1 -> softmax(1/0.35 vs 0.333/0.35) ~ 0.87 (~870)
    expect(neutralGathers).toBeGreaterThan(380);
    expect(neutralGathers).toBeLessThan(620);
    expect(biasedGathers).toBeGreaterThan(750);
    expect(biasedGathers - neutralGathers).toBeGreaterThan(150);
  });

  it('is deterministic for a given seed', () => {
    const brain = makeTestBrain();
    const run = (): string => {
      const p = makePerson(1);
      p.actionWeights.farm = 2;
      const rng = createRng(777);
      const kinds: string[] = [];
      for (let i = 0; i < 100; i++) {
        kinds.push(chooseAction(p, makePerception(p, [GATHER, REST, FARM, SOCIALIZE]), brain, rng).kind);
      }
      return kinds.join(',');
    };
    expect(run()).toBe(run());
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run:

```
npx vitest run tests/engine/agents/decide.test.ts
```

Expected: FAIL — module-resolution error: `Failed to resolve import "../../../src/engine/agents/decide"` (the file does not exist yet).

- [ ] **Step 4: Implement `src/engine/agents/decide.ts`**

Create `src/engine/agents/decide.ts` with exactly:

```ts
import { SOFTMAX_TEMP, type Action, type Person, type ScoredAction } from '../../shared/types';
import type { Rng } from '../rng';
import { moralGate } from './morality';
import type { Perception } from './perception';

/**
 * The temperament shape moralGate (Task 11) accepts — extracted from the
 * function itself so this file stays correct whichever structural subset of
 * the Task 20 Temperament morality.ts declared. The full Task 20 Temperament
 * is assignable to it.
 */
export type GateTemperament = Parameters<typeof moralGate>[2];

/**
 * Structural subset of the Task 20 Brain contract — the only two
 * capabilities the decision pipeline needs (deviation 3). Every real Brain
 * (opus/sonnet/haiku/fable and the test brain) is assignable, so Task 33
 * passes getBrain(p.lineage) directly.
 */
export interface BrainLike {
  temperament(): GateTemperament;
  decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[];
}

/**
 * Stable identity for an Action so brain output can be matched against the
 * legal candidate list even when the brain built new action objects.
 */
function actionKey(a: Action): string {
  const target = a.targetPersonId ?? 'none';
  const tile = a.tile ? `${a.tile.x},${a.tile.y}` : 'none';
  const structure = a.structure ?? 'none';
  return `${a.kind}|${target}|${tile}|${structure}`;
}

/**
 * The 3-step decision pipeline (contract):
 *  1. scored = brain.decide(perception, p.brainState, rng); keep only
 *     entries whose action is one of perception.candidates (structural
 *     match) with a finite score >= 0, deduplicated (first occurrence wins);
 *     nothing left -> { kind: 'rest' }.
 *  2. eff = score * p.actionWeights[kind] * moralGate(p, action,
 *     brain.temperament()). Entries with eff <= 0 (e.g. moral veto) are
 *     dropped entirely so they end at exactly zero probability; all dropped
 *     -> { kind: 'rest' }.
 *  3. One rng.next() samples softmax at temperature SOFTMAX_TEMP over
 *     eff / max(eff). Max-normalization bounds the exponent (raw scores are
 *     unbounded above) and makes the sampling scale-invariant.
 */
export function chooseAction(p: Person, perception: Perception, brain: BrainLike, rng: Rng): Action {
  // Step 1 — score and validate.
  const candidateKeys = new Set<string>();
  for (const c of perception.candidates) candidateKeys.add(actionKey(c));

  const scored = brain.decide(perception, p.brainState, rng);
  const seen = new Set<string>();
  const valid: ScoredAction[] = [];
  for (const s of scored) {
    if (!s || !s.action) continue;
    if (typeof s.score !== 'number' || !Number.isFinite(s.score) || s.score < 0) continue;
    const key = actionKey(s.action);
    if (!candidateKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    valid.push(s);
  }
  if (valid.length === 0) return { kind: 'rest' };

  // Step 2 — effective desirability: learned weight and moral gate.
  const temperament = brain.temperament();
  const actions: Action[] = [];
  const effs: number[] = [];
  let maxEff = 0;
  for (const s of valid) {
    const eff = s.score * p.actionWeights[s.action.kind] * moralGate(p, s.action, temperament);
    if (eff > 0) {
      actions.push(s.action);
      effs.push(eff);
      if (eff > maxEff) maxEff = eff;
    }
  }
  if (actions.length === 0) return { kind: 'rest' };

  // Step 3 — softmax sample at SOFTMAX_TEMP over max-normalized eff.
  let total = 0;
  const cumulative: number[] = [];
  for (const eff of effs) {
    total += Math.exp(eff / maxEff / SOFTMAX_TEMP);
    cumulative.push(total);
  }
  const roll = rng.next() * total;
  for (let i = 0; i < cumulative.length; i++) {
    if (roll < (cumulative[i] as number)) return actions[i] as Action;
  }
  return actions[actions.length - 1] as Action; // roll landed on the upper edge
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run:

```
npx vitest run tests/engine/agents/decide.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/agents/decide.test.ts (8 tests)

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

- [ ] **Step 6: Run the whole suite and typecheck**

Run:

```
npx vitest run
npm run typecheck
```

Expected: every test file from Tasks 2-19 passes (no failures, no skips); typecheck exits 0 with no errors. This confirms the section left Sections 1-3 untouched.

- [ ] **Step 7: Commit**

Run:

```
git add src/engine/agents/decide.ts tests/helpers/testBrain.ts tests/engine/agents/decide.test.ts
git commit -m "feat(agents): decision pipeline with softmax sampling and neutral test brain" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
