import { generateWorld, type World } from '../../src/engine/world/terrain';
import { SpatialIndex } from '../../src/engine/world/spatial';
import { makeNameGenerator, type NameGen } from '../../src/engine/names';
import { createRng, type Rng } from '../../src/engine/rng';
import type { NaturalEvent } from '../../src/engine/world/climate';
import type {
  Civ,
  Morality,
  Person,
  Settlement,
  Tick,
} from '../../src/shared/types';

/**
 * Structural copy of the Task 34 NarrativeEvent contract, declared locally so
 * this test helper has no forward dependency on Section 7 (which does not
 * exist yet at Task 26). Field-identical to the real type; Task 33/34 never
 * import this file.
 */
export interface TestNarrativeEvent {
  tick: Tick;
  kind: string;
  severity: 1 | 2 | 3;
  civId: number | null;
  text: string;
}

/**
 * Structural copy of the Task 33 Religion contract, declared locally for the
 * same forward-dependency reason as TestNarrativeEvent above.
 */
export interface TestReligion {
  id: number;
  name: string;
  founderId: number;
  civId: number;
  moralityBias: Partial<Morality>;
  zeal: number;
}

/**
 * Structural superset of every Section 6 module's *CtxLike interface, and a
 * structural subset of the eventual Task 33 EngineCtx. Every update*(ctx)
 * function in Tasks 26-32 accepts a TestEngineCtx wherever its own *CtxLike
 * is expected, because TypeScript structural typing only requires the fields
 * actually declared on the narrower type to be present here.
 */
export interface TestEngineCtx {
  world: World;
  people: Person[];
  personById: Map<number, Person>;
  civs: Civ[];
  settlements: Settlement[];
  religions: TestReligion[];
  spatial: SpatialIndex;
  names: NameGen;
  tick: Tick;
  rng: Rng;
  events: TestNarrativeEvent[];
  naturalEvents: NaturalEvent[];
  counters: { births: number; deaths: number };
}

/**
 * Builds a full minimal EngineCtxLike fixture: a small generated world
 * (size 32, seed 42), empty people/settlements/religions/events arrays, a
 * fresh spatial index, a seeded name generator, tick 0, a seeded rng, and
 * zeroed counters. `overrides` shallow-merges on top (any array/object you
 * pass fully replaces the default — it is not deep-merged field by field).
 */
export function makeTestCtx(overrides: Partial<TestEngineCtx> = {}): TestEngineCtx {
  const base: TestEngineCtx = {
    world: generateWorld(32, createRng(42)),
    people: [],
    personById: new Map<number, Person>(),
    civs: [],
    settlements: [],
    religions: [],
    spatial: new SpatialIndex(),
    names: makeNameGenerator(createRng(42)),
    tick: 0,
    rng: createRng(42),
    events: [],
    naturalEvents: [],
    counters: { births: 0, deaths: 0 },
  };
  return { ...base, ...overrides };
}

/** Convenience: a bare-bones Civ for tests that just need something to point at. */
export function makeTestCiv(overrides: Partial<Civ> = {}): Civ {
  return {
    id: 0,
    name: 'Testia',
    color: '#e4572e',
    knowledge: { fire: 0, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
    techs: [],
    atWarWith: [],
    warWeariness: 0,
    ...overrides,
  };
}

/** Convenience: a bare-bones Settlement for tests. */
export function makeTestSettlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: 0,
    civId: 0,
    name: 'Test Hamlet',
    center: { x: 10, y: 10 },
    memberIds: [],
    stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 },
    structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    ...overrides,
  };
}
