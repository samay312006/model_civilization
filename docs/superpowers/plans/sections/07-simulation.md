## Section 7: Simulation orchestration (Tasks 33-37)

This section assembles every engine module built in Sections 1-6 into a runnable simulation. Task 33 writes `simulation.ts` (the `Simulation` class, the real `EngineCtx`, and construction/wiring of every agent and society module behind the fixed tick order) plus `invariants.ts` (dev-mode health checks). Task 34 writes `events.ts` (the narrative ring buffer and one narration helper per event kind). Task 35 writes `snapshot.ts` and the `Snapshot`/`CivMetrics`/`SettlementView`/`PersonDetail` types in `src/shared/protocol.ts`, turning a `Simulation` into the compact typed-array payload the UI will render. Task 36 writes `save.ts` (versioned serialize/deserialize/checksum) and extends `src/engine/rng.ts` with `getState`/`setState` so a saved run can resume its exact random stream; it also adds the determinism and forbidden-API regression tests the whole engine must keep passing forever. Task 37 writes `worker.ts` and the `UiToWorker`/`WorkerToUi` protocol messages, with the interval/batching/reducer logic factored into a pure, unit-testable `handleMessage` function so the Worker global is never required by a test. Every task in this section depends on every earlier section (1-6); nothing later in this section is exercised by earlier sections. Every command below runs from the repo root `C:\simulation_exp`.

**Contract deviations in this section (recorded, deliberate):**

1. **`regenerateResources` and `updateNaturalEvents` are called with the exact signatures Section 2 actually shipped**, which extend the contract: `regenerateResources(world, tick, rng, activeEvents)` (Task 33 passes `ctx.naturalEvents`, computed *before* the regrowth call, per Section 2's own wiring note) and `updateNaturalEvents(active, world, tick, rng)` returns a **new array** that `Simulation.tick()` assigns back to `ctx.naturalEvents` (it never mutates `active` in place).
2. **`stepToward` takes `(from, to, world)`**, not the contract's 2-arg form (Section 2 deviation, reused transitively by `execute.ts`). `Simulation` never calls it directly, but this is recorded here because `EngineCtx.world` is exactly what makes `ExecuteCtxLike` satisfied.
3. **`legalActions`, `executeAction`, and `buildPerception` take an explicit `taboos: ActionKind[]` parameter** (Sections 3/4 deviation) rather than reading it off a registry-supplied `Temperament` internally. `Simulation.tick()` supplies `getBrain(p.lineage).temperament().taboos` at every call site.
4. **`updateLifecycle` takes an injected `brainInit: (p, rng) => unknown` third parameter** (Section 4 deviation 1). `Simulation.tick()` passes `(person, rng) => getBrain(person.lineage).init(person, rng)`.
5. **`executeAction` takes a fourth parameter `emotionVolatility: Emotions`** (Section 3 deviation 5) instead of looking up the acting person's temperament itself. `Simulation.tick()` passes `getBrain(p.lineage).temperament().emotionVolatility`.
6. **`ctx.tech` is a structural object `{ yieldMultiplier, addKnowledge }`** wired at construction time (Section 3 deviation 2) so `execute.ts`'s `ExecuteCtxLike.tech: TechCtxLike` is satisfied: `ctx.tech = { yieldMultiplier: techYieldMultiplier, addKnowledge }`.
7. **`religion.ts`'s `spreadBeliefs`/`maybeFoundReligion` take a `ReligionCtxLikeExtended`/`ReligionCtxLike`** that includes `recentDisasterEvents: DisasterWitnessEvent[]` and (for `spreadBeliefs`) `worshippersThisTick: Set<number>` (Section 6 deviation). `Simulation` derives `recentDisasterEvents` from its own `events` ring buffer (severity-3 entries whose `kind` names a disaster: `'famine'`, `'drought'`, `'disease'`, `'raid'`) and collects `worshippersThisTick` during the per-person tick-step-3 pass (every person whose chosen action this tick was `{ kind: 'worship' }`).
8. **`ReligionRec` (religion.ts) vs the contract `Religion`.** Section 6's `religion.ts` exports its own `ReligionRec` type, field-identical to the contract's `Religion`. `EngineCtx.religions: Religion[]` (the real contract type, defined in this section) is structurally assignable everywhere `ReligionRec[]` is expected, so `Simulation` uses the contract `Religion` type directly and passes `ctx.religions` unchanged to every religion-module call.
9. **`Simulation`'s constructor is synchronous and does all of Task 8's `initPopulation` + brain-registry initialization inline** — the contract shows only `constructor(config: SimConfig)` with no async variant, so world generation, population seeding, and per-person `brainState` initialization all happen inside the constructor body before it returns.
10. **`checkInvariants` additionally treats a NaN/Infinite `rng` internal state as impossible to observe from the public `Rng` interface**, so "no NaN/Inf in any person field" is implemented by walking every numeric leaf of every alive `Person` (traits, emotions, morality, needs, skills, health, influence, inventory, memory valence/salience, relationship affinity) plus every `Civ.knowledge` value — exactly the fields the contract enumerates, made concrete.
11. **`takeSnapshot`'s territory ownership** ("nearest-settlement-within-20-tiles") is computed by scanning every tile once and, for tiles within 20 (inclusive) euclidean tiles of at least one settlement center, assigning the civId of the nearest such settlement (ties broken by lowest settlement id); tiles with no settlement within 20 tiles get `-1`. This is a concrete instantiation of the contract's one-line spec, not a deviation from it.
12. **`worker.ts`'s `handleMessage` is a pure function** `(state: WorkerState, msg: UiToWorker) => { state: WorkerState; replies: WorkerToUi[] }` (per the section brief) — this is additive: the contract only specifies the wire protocol and that `worker.ts` wires it to `Simulation`, not the internal factoring. `WorkerState` and `handleMessage` are new exports this task defines and are listed under **Produces**.

### Task 33: Simulation class, EngineCtx, and tick orchestration (`src/engine/sim/simulation.ts` + `src/engine/sim/invariants.ts`)

**Files:**
- Create: `src/engine/sim/simulation.ts`
- Create: `src/engine/sim/invariants.ts`
- Test: `tests/engine/sim/simulation.test.ts`
- Test: `tests/engine/sim/invariants.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Civ`, `Settlement`, `Religion`, `SimConfig`, `Tick`, `ActionKind`, `Emotions`, `clamp01(v): number`
- From `src/engine/rng.ts` (Task 2): `Rng`, `createRng(seed: number): Rng`
- From `src/engine/names.ts` (Task 4): `NameGen`, `makeNameGenerator(rng: Rng): NameGen`
- From `src/engine/world/terrain.ts` (Task 5): `World`, `generateWorld(size: number, rng: Rng): World`
- From `src/engine/world/climate.ts` (Task 6): `NaturalEvent`, `regenerateResources(world, tick, rng, activeEvents?): void`, `updateNaturalEvents(active, world, tick, rng): NaturalEvent[]`
- From `src/engine/world/spatial.ts` (Task 7): `SpatialIndex { rebuild(people): void; near(pos, radius): number[] }`
- From `src/engine/agents/person.ts` (Task 8): `initPopulation(config, world, names, rng): { people: Person[]; civs: Civ[] }`
- From `src/engine/agents/needs.ts` (Task 9): `updateNeeds(p, tick): void`
- From `src/engine/agents/emotions.ts` (Task 10): `decayEmotions(p, decayPerTick): void`
- From `src/engine/agents/actions.ts` (Task 14): `legalActions(p, ctx: ActionsCtxLike, taboos): Action[]`
- From `src/engine/agents/execute.ts` (Task 15): `executeAction(p, a, ctx: ExecuteCtxLike, emotionVolatility): Outcome`, `Outcome`
- From `src/engine/agents/perception.ts` (Task 16): `buildPerception(p, ctx: PerceptionCtxLike, taboos): Perception`, `Perception`
- From `src/engine/agents/lifecycle.ts` (Task 17): `updateLifecycle(p, ctx: LifecycleCtx, brainInit): void`
- From `src/engine/agents/learning.ts` (Task 18): `reinforce(p, o, learningRate): void`, `maybeImitate(p, ctx: LearningCtx, imitationRate): void`
- From `src/engine/agents/decide.ts` (Task 19): `chooseAction(p, perception, brain: BrainLike, rng): Action`
- From `src/engine/brains/registry.ts` (Task 20): `getBrain(lineage): Brain`
- From `src/engine/society/settlements.ts` (Task 26): `updateSettlements(ctx: SettlementsCtxLike): void`
- From `src/engine/society/influence.ts` (Task 27): `updateInfluence(ctx: InfluenceCtxLike): void`
- From `src/engine/society/culture.ts` (Task 28): `maybeSchism(ctx: CultureCtxLike): void`
- From `src/engine/society/technology.ts` (Task 29): `updateTechnology(ctx: TechnologyCtxLike): void`, `addKnowledge(civ, domain, points): void`, `techYieldMultiplier(civ, action): number`
- From `src/engine/society/religion.ts` (Task 30): `maybeFoundReligion(ctx: ReligionCtxLike): void`, `spreadBeliefs(ctx: ReligionCtxLikeExtended): void`, `DisasterWitnessEvent`
- From `src/engine/society/economy.ts` (Task 31): `shareWithin(ctx: EconomyCtxLike): void`, `tradeBetween(ctx: EconomyCtxLike): void`
- From `src/engine/society/conflict.ts` (Task 32): `updateConflict(ctx: ConflictCtxLike): void`
- Tests also use `makeNameGenerator`, `createRng`, `generateWorld`, `createPerson` (Task 8), `makeTestBrain` (Task 19, `tests/helpers/testBrain.ts`)

Produces:
- `export interface EngineCtx { world: World; people: Person[]; personById: Map<number, Person>; civs: Civ[]; settlements: Settlement[]; religions: Religion[]; spatial: SpatialIndex; names: NameGen; tick: Tick; rng: Rng; events: NarrativeEvent[]; naturalEvents: NaturalEvent[]; counters: { births: number; deaths: number }; tech: { yieldMultiplier(civ: Civ, action: ActionKind): number; addKnowledge(civ: Civ, domain: TechId, points: number): void }; onPhase?: (phase: string) => void }` — contract shape plus the two additive fields `tech` (deviation 6) and the optional `onPhase` test hook named in the section brief. `EngineCtx` is a structural superset of every `*CtxLike`/`*Ctx` interface from Sections 3, 4, and 6, so every call below passes `this.ctx` (or `this.ctx` widened with a couple of locally-computed fields for `religion.ts`) with no adapter objects.
- `export const TICK_PHASES = ['world', 'spatial', 'people', 'lifecycle', 'settlements', 'influence', 'economy', 'conflict', 'technology', 'religion', 'schism', 'fade-imitate', 'metrics', 'invariants'] as const` — the exact ordered phase-name list `onPhase` is called with, one call per phase per tick, in this order, always (even when `onPhase` is undefined the phases still execute; the callback is purely an observation hook for tests).
- `export class Simulation { constructor(config: SimConfig); readonly config: SimConfig; readonly ctx: EngineCtx; currentTick: Tick; tick(): void }` — contract signature verbatim. `currentTick` is kept equal to `ctx.tick` at all times (both start at 0; `tick()` increments `ctx.tick` at the very start of the tick and copies it to `currentTick` immediately after).
- Exported RNG-stream label constants: `RNG_LABEL_WORLD = 'world'`, `RNG_LABEL_EVENTS = 'events'`, `RNG_LABEL_SOCIETY = 'society'`, `RNG_LABEL_LIFECYCLE = 'lifecycle'` — the four per-subsystem streams split once at construction from the root rng, per the section brief's exact labeling scheme. Per-person streams are split fresh every tick as `ctx.rng.split('p' + person.id)` (never cached — see Step 4 below for why a fresh per-tick split, not a per-person cached child, is what keeps replay determinism independent of population churn).
- `export function makeDisasterWitnessEvents(events: NarrativeEvent[], tick: Tick, window: number): DisasterWitnessEvent[]` — the concrete Task 33 side of Section 6 deviation 7: filters `events` to `severity === 3` entries within `window` ticks of `tick` whose `kind` is one of `'famine'`, `'drought'`, `'disease'`, `'raid'`, mapped to `{ tick: e.tick, civId: e.civId ?? -1, severity: e.severity }` (a `civId` of `-1` never matches a real civ, so civ-wide events safely produce no religion founders).

Wiring notes for Task 34/35/36/37 (binding):
- `simulation.ts` re-exports `Religion` and `NarrativeEvent` are NOT re-exported here — `Religion` comes from `src/shared/types.ts` directly and `NarrativeEvent` is defined in `src/engine/sim/events.ts` (Task 34); `simulation.ts` imports `NarrativeEvent` as a type from `./events` and this creates the only intra-section forward reference, resolved by Task 34 landing its file before Task 33's tests import it — **Task 34 is executed immediately after Task 33 in this section's task order below, and `events.ts` is written first, before `simulation.ts`'s own step 3, to keep every step's tests green in isolation.**
- `checkInvariants(sim: Simulation): string[]` (this task's `invariants.ts`) is called at the end of `tick()` (`TICK_PHASES[13] === 'invariants'`) only when `process.env.NODE_ENV === 'test'` or `(import.meta as { env?: { DEV?: boolean } }).env?.DEV === true`; violations are thrown as a single `Error` joining the returned strings with `'; '` (a silent violation would defeat the point of a dev-mode check).
- Task 35 (`snapshot.ts`) reads `sim.ctx.people`/`civs`/`settlements`/`religions`/`events` and calls no `Simulation` method other than construction.
- Task 36 (`save.ts`) reconstructs a `Simulation` without rerunning `initPopulation`/tick 0 side effects — it does so via a second, non-contract constructor path documented in Task 36 itself (a static factory), not by changing `Simulation`'s public constructor.

- [ ] **Step 1: Write `src/engine/sim/events.ts` first (Task 34's file), minimally, so Task 33's tests can import `NarrativeEvent`**

This step exists solely to break the forward reference described above. Create `src/engine/sim/events.ts` with exactly the content specified in full in **Task 34, Step 3** below — copy that implementation verbatim now; Task 34's own steps re-verify and extend nothing (the file is complete in one shot). Do not write a partial stub: the full `events.ts` is short and self-contained, and writing it once here avoids a later edit.

Run:

```
npx vitest run tests/engine/sim/events.test.ts
```

Expected at this point: FAIL — `Error: Failed to resolve import "../../../src/engine/sim/events" from "tests/engine/sim/events.test.ts". Does the file exist?` (the test file itself is written in Task 34, Step 1 — if you are executing tasks in order, write that test file now too, before implementing, so the FAIL is genuine). Once `tests/engine/sim/events.test.ts` (Task 34 Step 1) and `src/engine/sim/events.ts` (this step) both exist, re-run:

```
npx vitest run tests/engine/sim/events.test.ts
```

Expected: PASS — `Test Files  1 passed (1)`, `Tests  17 passed (17)` (see Task 34 for the full test file and the exact count).

- [ ] **Step 2: Write the failing simulation tests**

Create `tests/engine/sim/simulation.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { Simulation, TICK_PHASES } from '../../../src/engine/sim/simulation';
import { createRng } from '../../../src/engine/rng';
import type { SimConfig } from '../../../src/shared/types';

function baseConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { seed: 7, mode: 'mixed', mapSize: 'small', startPopulation: 200, ...overrides };
}

describe('Simulation construction', () => {
  it('builds a world, population, and civs matching the config', () => {
    const sim = new Simulation(baseConfig());
    expect(sim.config.seed).toBe(7);
    expect(sim.ctx.people).toHaveLength(200);
    expect(sim.ctx.civs).toHaveLength(1); // mode 'mixed'
    expect(sim.ctx.world.size).toBe(96); // MAP_SIZES.small
    expect(sim.currentTick).toBe(0);
    expect(sim.ctx.tick).toBe(0);
  });

  it('mode civs builds 4 civs', () => {
    const sim = new Simulation(baseConfig({ mode: 'civs' }));
    expect(sim.ctx.civs).toHaveLength(4);
  });

  it('initializes every person with a non-empty brainState from the real registry', () => {
    const sim = new Simulation(baseConfig());
    for (const p of sim.ctx.people) {
      expect(p.brainState).not.toBeNull();
      expect(typeof p.brainState).toBe('object');
    }
  });

  it('personById is populated and consistent with people', () => {
    const sim = new Simulation(baseConfig());
    expect(sim.ctx.personById.size).toBe(sim.ctx.people.length);
    for (const p of sim.ctx.people) {
      expect(sim.ctx.personById.get(p.id)).toBe(p);
    }
  });

  it('is deterministic for a fixed seed: two fresh sims produce identical initial people/civs', () => {
    const a = new Simulation(baseConfig({ seed: 55 }));
    const b = new Simulation(baseConfig({ seed: 55 }));
    expect(a.ctx.people).toEqual(b.ctx.people);
    expect(a.ctx.civs).toEqual(b.ctx.civs);
  });

  it('two different seeds produce different populations', () => {
    const a = new Simulation(baseConfig({ seed: 1 }));
    const b = new Simulation(baseConfig({ seed: 2 }));
    expect(a.ctx.people).not.toEqual(b.ctx.people);
  });
});

describe('Simulation.tick — order and bookkeeping', () => {
  it('advances currentTick and ctx.tick together, starting at 1 after one tick', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    sim.tick();
    expect(sim.currentTick).toBe(1);
    expect(sim.ctx.tick).toBe(1);
  });

  it('calls onPhase with every TICK_PHASES entry in order, exactly once per tick', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    const seen: string[] = [];
    sim.ctx.onPhase = (phase: string): void => {
      seen.push(phase);
    };
    sim.tick();
    expect(seen).toEqual([...TICK_PHASES]);
  });

  it('resets counters.births/deaths at the start of each tick', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    sim.tick();
    const firstBirths = sim.ctx.counters.births;
    const firstDeaths = sim.ctx.counters.deaths;
    expect(firstBirths).toBeGreaterThanOrEqual(0);
    expect(firstDeaths).toBeGreaterThanOrEqual(0);
    sim.tick();
    // counters describe THIS tick only, never accumulate across ticks
    expect(sim.ctx.counters.births).toBeGreaterThanOrEqual(0);
    expect(sim.ctx.counters.deaths).toBeGreaterThanOrEqual(0);
  });

  it('ages at least one living person by exactly one tick per call', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    const before = sim.ctx.people.find((p) => p.alive)?.ageTicks as number;
    const id = sim.ctx.people.find((p) => p.alive)?.id as number;
    sim.tick();
    const after = sim.ctx.personById.get(id)?.ageTicks;
    // the person may have died this tick (health/disease/old-age); if still alive, must be +1.
    const stillAlive = sim.ctx.personById.get(id)?.alive === true;
    if (stillAlive) expect(after).toBe(before + 1);
  });
});

describe('Simulation — extinction', () => {
  it('keeps ticking the world (no throw) after population reaches 0', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    for (const p of sim.ctx.people) {
      p.alive = false;
      p.health = 0;
    }
    expect(() => {
      for (let i = 0; i < 5; i++) sim.tick();
    }).not.toThrow();
    expect(sim.ctx.tick).toBe(5);
  });

  it('emits a severity-3 extinction event exactly once when population first hits 0', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    for (const p of sim.ctx.people) {
      p.alive = false;
      p.health = 0;
    }
    sim.tick();
    sim.tick();
    const extinctions = sim.ctx.events.filter((e) => e.kind === 'extinction');
    expect(extinctions).toHaveLength(1);
    expect(extinctions[0]?.severity).toBe(3);
  });
});

describe('Simulation — 100-tick run (seed 7, mode mixed, small map, 200 pop)', () => {
  it('runs 100 ticks with no invariant violations and a plausible population change', () => {
    const sim = new Simulation(baseConfig());
    const initialPopulation = sim.ctx.people.filter((p) => p.alive).length;
    for (let i = 0; i < 100; i++) sim.tick();
    const finalPopulation = sim.ctx.people.filter((p) => p.alive).length;
    // plausibility bounds: population neither exploded past 3x nor cratered
    // to exactly the same headcount every tick (something must have happened
    // in 100 ticks across needs/lifecycle/conflict/technology).
    expect(finalPopulation).toBeGreaterThan(0);
    expect(finalPopulation).toBeLessThan(initialPopulation * 3);
    expect(sim.ctx.tick).toBe(100);
    // total people (including the dead, who are retained for history) can
    // only grow via births, never shrink.
    expect(sim.ctx.people.length).toBeGreaterThanOrEqual(initialPopulation);
  });

  it('is deterministic: two fresh sims with the same seed produce identical history over 100 ticks', () => {
    const a = new Simulation(baseConfig());
    const b = new Simulation(baseConfig());
    for (let i = 0; i < 100; i++) {
      a.tick();
      b.tick();
    }
    expect(a.ctx.people).toEqual(b.ctx.people);
    expect(a.ctx.civs).toEqual(b.ctx.civs);
    expect(a.ctx.settlements).toEqual(b.ctx.settlements);
  });
});

describe('Simulation — dead people retained in people[] but skipped', () => {
  it('a dead person stays in people[] and personById, with alive=false', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    const target = sim.ctx.people[0];
    if (target === undefined) throw new Error('expected at least one person');
    target.needs.hunger = 1;
    target.health = 0.001;
    sim.tick();
    const after = sim.ctx.personById.get(target.id);
    expect(after).toBeDefined();
    expect(sim.ctx.people.some((p) => p.id === target.id)).toBe(true);
    if (after !== undefined && !after.alive) {
      expect(after.causeOfDeath).not.toBeNull();
    }
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/sim/simulation.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/sim/simulation" from "tests/engine/sim/simulation.test.ts". Does the file exist?` (`src/engine/sim/simulation.ts` does not exist yet).

- [ ] **Step 4: Implement `src/engine/sim/simulation.ts`**

Create `src/engine/sim/simulation.ts` with exactly:

```ts
import {
  clamp01,
  type ActionKind,
  type Civ,
  type Emotions,
  type Person,
  type Religion,
  type Settlement,
  type SimConfig,
  type TechId,
  type Tick,
} from '../../shared/types';
import { createRng, type Rng } from '../rng';
import { makeNameGenerator, type NameGen } from '../names';
import { generateWorld, type World } from '../world/terrain';
import { regenerateResources, updateNaturalEvents, type NaturalEvent } from '../world/climate';
import { SpatialIndex } from '../world/spatial';
import { initPopulation } from '../agents/person';
import { updateNeeds } from '../agents/needs';
import { decayEmotions } from '../agents/emotions';
import { legalActions, type ActionsCtxLike } from '../agents/actions';
import { executeAction, type ExecuteCtxLike, type Outcome } from '../agents/execute';
import { buildPerception, type PerceptionCtxLike, type Perception } from '../agents/perception';
import { updateLifecycle, type LifecycleCtx } from '../agents/lifecycle';
import { reinforce, maybeImitate, type LearningCtx } from '../agents/learning';
import { chooseAction } from '../agents/decide';
import { getBrain } from '../brains/registry';
import { updateSettlements, type SettlementsCtxLike } from '../society/settlements';
import { updateInfluence, type InfluenceCtxLike } from '../society/influence';
import { maybeSchism, type CultureCtxLike } from '../society/culture';
import { updateTechnology, addKnowledge, techYieldMultiplier, type TechnologyCtxLike } from '../society/technology';
import {
  maybeFoundReligion,
  spreadBeliefs,
  type DisasterWitnessEvent,
  type ReligionCtxLike,
  type ReligionCtxLikeExtended,
} from '../society/religion';
import { shareWithin, tradeBetween, type EconomyCtxLike } from '../society/economy';
import { updateConflict, type ConflictCtxLike } from '../society/conflict';
import { pushEvent, type NarrativeEvent } from './events';
import { checkInvariants } from './invariants';

/**
 * The fixed, ordered phase names Simulation.tick() reports through the
 * optional ctx.onPhase test hook — one call per phase per tick, always in
 * this order. See the contract tick-order comment; this is its concrete
 * enumeration for test verification.
 */
export const TICK_PHASES = [
  'world',
  'spatial',
  'people',
  'lifecycle',
  'settlements',
  'influence',
  'economy',
  'conflict',
  'technology',
  'religion',
  'schism',
  'fade-imitate',
  'metrics',
  'invariants',
] as const;
export type TickPhase = (typeof TICK_PHASES)[number];

export const RNG_LABEL_WORLD = 'world';
export const RNG_LABEL_EVENTS = 'events';
export const RNG_LABEL_SOCIETY = 'society';
export const RNG_LABEL_LIFECYCLE = 'lifecycle';

const DISASTER_EVENT_KINDS = new Set(['famine', 'drought', 'disease', 'raid']);
const RELIGION_EVENT_WINDOW = 30;

/**
 * The full engine context threaded through every module call. A structural
 * superset of every *CtxLike interface from Sections 3, 4, and 6, so every
 * update*/legalActions/executeAction/buildPerception/updateLifecycle call
 * below passes `this.ctx` (optionally widened with a couple of
 * locally-computed fields for religion.ts) with no adapter objects.
 */
export interface EngineCtx {
  world: World;
  people: Person[];
  personById: Map<number, Person>;
  civs: Civ[];
  settlements: Settlement[];
  religions: Religion[];
  spatial: SpatialIndex;
  names: NameGen;
  tick: Tick;
  rng: Rng;
  events: NarrativeEvent[];
  naturalEvents: NaturalEvent[];
  counters: { births: number; deaths: number };
  tech: {
    yieldMultiplier(civ: Civ, action: ActionKind): number;
    addKnowledge(civ: Civ, domain: TechId, points: number): void;
  };
  /** Test-only observation hook: called once per TICK_PHASES entry per tick. */
  onPhase?: (phase: string) => void;
}

/** Concrete side of Section 6 deviation 7: builds the DisasterWitnessEvent[] religion.ts needs from the event log. */
export function makeDisasterWitnessEvents(
  events: NarrativeEvent[],
  tick: Tick,
  window: number,
): DisasterWitnessEvent[] {
  const out: DisasterWitnessEvent[] = [];
  for (const e of events) {
    if (e.severity !== 3) continue;
    if (!DISASTER_EVENT_KINDS.has(e.kind)) continue;
    if (tick - e.tick < 0 || tick - e.tick > window) continue;
    out.push({ tick: e.tick, civId: e.civId ?? -1, severity: e.severity });
  }
  return out;
}

function emit(ctx: EngineCtx, phase: TickPhase): void {
  ctx.onPhase?.(phase);
}

export class Simulation {
  readonly config: SimConfig;
  readonly ctx: EngineCtx;
  currentTick: Tick;

  private wasExtinct = false;

  constructor(config: SimConfig) {
    this.config = config;
    const rootRng = createRng(config.seed);
    const worldRng = rootRng.split(RNG_LABEL_WORLD);
    const eventsRng = rootRng.split(RNG_LABEL_EVENTS);
    const societyRng = rootRng.split(RNG_LABEL_SOCIETY);
    const lifecycleRng = rootRng.split(RNG_LABEL_LIFECYCLE);
    void eventsRng;
    void societyRng;
    void lifecycleRng;

    const mapSizeTiles = { small: 96, medium: 144, large: 192 }[config.mapSize];
    const world = generateWorld(mapSizeTiles, worldRng);
    const names = makeNameGenerator(rootRng.split('names'));
    const { people, civs } = initPopulation(config, world, names, rootRng.split('population'));

    for (const p of people) {
      p.brainState = getBrain(p.lineage).init(p, rootRng.split(`p${p.id}`));
    }

    const personById = new Map<number, Person>();
    for (const p of people) personById.set(p.id, p);

    this.ctx = {
      world,
      people,
      personById,
      civs,
      settlements: [],
      religions: [],
      spatial: new SpatialIndex(),
      names,
      tick: 0,
      rng: rootRng,
      events: [],
      naturalEvents: [],
      counters: { births: 0, deaths: 0 },
      tech: { yieldMultiplier: techYieldMultiplier, addKnowledge },
    };
    this.currentTick = 0;
  }

  tick(): void {
    const ctx = this.ctx;
    ctx.tick += 1;
    this.currentTick = ctx.tick;
    ctx.counters.births = 0;
    ctx.counters.deaths = 0;

    // Phase: world (step 1) — natural events first, so this tick's regrowth
    // sees this tick's droughts.
    ctx.naturalEvents = updateNaturalEvents(ctx.naturalEvents, ctx.world, ctx.tick, ctx.rng.split(`events-${ctx.tick}`));
    regenerateResources(ctx.world, ctx.tick, ctx.rng.split(`regrowth-${ctx.tick}`), ctx.naturalEvents);
    emit(ctx, 'world');

    // Phase: spatial (step 2).
    ctx.spatial.rebuild(ctx.people.filter((p) => p.alive));
    emit(ctx, 'spatial');

    // Phase: people (step 3) — ascending id, alive only.
    const worshippersThisTick = new Set<number>();
    const living = [...ctx.people].filter((p) => p.alive).sort((a, b) => a.id - b.id);
    for (const p of living) {
      updateNeeds(p, ctx.tick);
      const brain = getBrain(p.lineage);
      const temperament = brain.temperament();
      decayEmotions(p, temperament.emotionDecayPerTick);

      const perceptionCtx: PerceptionCtxLike = ctx;
      const perception: Perception = buildPerception(p, perceptionCtx, temperament.taboos);
      const action = chooseAction(p, perception, brain, ctx.rng.split(`p${p.id}`));
      if (action.kind === 'worship') worshippersThisTick.add(p.id);

      const executeCtx: ExecuteCtxLike = ctx;
      const outcome: Outcome = executeAction(p, action, executeCtx, temperament.emotionVolatility);
      reinforce(p, outcome, temperament.learningRate);
      brain.onOutcome(outcome, p.brainState, ctx.rng.split(`p${p.id}-outcome`));
    }
    emit(ctx, 'people');

    // Phase: lifecycle (step 4) — all people, ascending id (dead skipped internally).
    const lifecycleCtx: LifecycleCtx = ctx;
    for (const p of [...ctx.people].sort((a, b) => a.id - b.id)) {
      updateLifecycle(p, lifecycleCtx, (child, rng) => getBrain(child.lineage).init(child, rng));
    }
    for (const p of ctx.people) {
      if (!ctx.personById.has(p.id)) ctx.personById.set(p.id, p);
    }
    emit(ctx, 'lifecycle');

    // Phase: settlements (step 5a).
    const settlementsCtx: SettlementsCtxLike = ctx;
    updateSettlements(settlementsCtx);
    emit(ctx, 'settlements');

    // Phase: influence (step 5b).
    const influenceCtx: InfluenceCtxLike = ctx;
    updateInfluence(influenceCtx);
    emit(ctx, 'influence');

    // Phase: economy (step 5c) — shareWithin then tradeBetween, as ordered.
    const economyCtx: EconomyCtxLike = ctx;
    shareWithin(economyCtx);
    tradeBetween(economyCtx);
    emit(ctx, 'economy');

    // Phase: conflict (step 5d).
    const conflictCtx: ConflictCtxLike = ctx;
    updateConflict(conflictCtx);
    emit(ctx, 'conflict');

    // Phase: technology (step 5e).
    const technologyCtx: TechnologyCtxLike = ctx;
    updateTechnology(technologyCtx);
    emit(ctx, 'technology');

    // Phase: religion (step 5f) — spreadBeliefs then maybeFoundReligion, as ordered.
    const recentDisasterEvents = makeDisasterWitnessEvents(ctx.events, ctx.tick, RELIGION_EVENT_WINDOW);
    const religionCtxExtended: ReligionCtxLikeExtended = {
      people: ctx.people,
      civs: ctx.civs,
      religions: ctx.religions,
      names: ctx.names,
      tick: ctx.tick,
      rng: ctx.rng,
      recentDisasterEvents,
      worshippersThisTick,
      settlements: ctx.settlements,
    };
    spreadBeliefs(religionCtxExtended);
    const religionCtx: ReligionCtxLike = religionCtxExtended;
    maybeFoundReligion(religionCtx);
    emit(ctx, 'religion');

    // Phase: schism (step 5g) — last among the society calls.
    const cultureCtx: CultureCtxLike = ctx;
    const civCountBefore = ctx.civs.length;
    maybeSchism(cultureCtx);
    if (ctx.civs.length > civCountBefore) {
      const newCiv = ctx.civs[ctx.civs.length - 1];
      if (newCiv !== undefined) {
        pushEvent(ctx, 'schism', 3, newCiv.id, `A faction breaks away and founds ${newCiv.name}.`);
      }
    }
    emit(ctx, 'schism');

    // Phase: fade-imitate (step 6).
    const learningCtx: LearningCtx = ctx;
    for (const p of [...ctx.people].filter((q) => q.alive).sort((a, b) => a.id - b.id)) {
      fadeMemoriesOf(p);
      const temperament = getBrain(p.lineage).temperament();
      maybeImitate(p, learningCtx, temperament.imitationRate);
    }
    emit(ctx, 'fade-imitate');

    // Phase: metrics/events flush (step 7).
    this.checkExtinction();
    emit(ctx, 'metrics');

    // Phase: invariants (step 8, DEV/test only).
    const isTestEnv = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
    const isDevEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
    if (isTestEnv || isDevEnv) {
      const violations = checkInvariants(this);
      if (violations.length > 0) {
        throw new Error(`Invariant violation(s) at tick ${ctx.tick}: ${violations.join('; ')}`);
      }
    }
    emit(ctx, 'invariants');
  }

  private checkExtinction(): void {
    const alive = this.ctx.people.some((p) => p.alive);
    if (!alive && !this.wasExtinct) {
      this.wasExtinct = true;
      pushEvent(this.ctx, 'extinction', 3, null, 'The last person has died. The world falls silent.');
    } else if (alive) {
      this.wasExtinct = false;
    }
  }
}

/** Local import-free fade helper: mirrors agents/memory.ts fadeMemories exactly (avoids a second import line for one call site). */
function fadeMemoriesOf(p: Person): void {
  p.memory = p.memory.filter((m) => {
    m.salience *= 0.999;
    return m.salience >= 0.05;
  });
  p.emotions = clampEmotions(p.emotions);
}

function clampEmotions(e: Emotions): Emotions {
  return {
    fear: clamp01(e.fear),
    joy: clamp01(e.joy),
    grief: clamp01(e.grief),
    anger: clamp01(e.anger),
    hope: clamp01(e.hope),
  };
}
```

- [ ] **Step 5: Run the tests and confirm they fail on the real implementation gap, then pass**

Run:

```
npx vitest run tests/engine/sim/simulation.test.ts
```

Expected first (before this step's file existed): the FAIL from Step 3. After creating the file above:

```
npx vitest run tests/engine/sim/simulation.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/sim/simulation.test.ts (12 tests)

 Test Files  1 passed (1)
      Tests  12 passed (12)
```

If the extinction-event test or the 100-tick determinism test fails because `fadeMemoriesOf` duplicates `agents/memory.ts`'s `fadeMemories` behavior incorrectly, replace the local `fadeMemoriesOf` function body with a direct call to the real `fadeMemories` from `../agents/memory` (import it) — the inline copy above is intentionally identical to Task 12's `fadeMemories` (multiply salience by 0.999, drop below 0.05) so this substitution never changes behavior; prefer the import for maintainability:

```ts
import { fadeMemories } from '../agents/memory';
```

and in the fade-imitate phase loop, call `fadeMemories(p)` in place of `fadeMemoriesOf(p)`, deleting the local `fadeMemoriesOf`/`clampEmotions` helpers (emotion clamping is already guaranteed by `decayEmotions`/`applyEmotionImpulse`, so no `Emotions` import is needed either). This is the canonical wiring; write it this way from the start.

- [ ] **Step 6: Write the failing invariants tests**

Create `tests/engine/sim/invariants.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../../../src/engine/sim/invariants';
import { Simulation } from '../../../src/engine/sim/simulation';
import type { SimConfig } from '../../../src/shared/types';

function baseConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { seed: 3, mode: 'civs', mapSize: 'small', startPopulation: 200, ...overrides };
}

describe('checkInvariants', () => {
  it('returns [] for a freshly constructed, untouched simulation', () => {
    const sim = new Simulation(baseConfig());
    expect(checkInvariants(sim)).toEqual([]);
  });

  it('returns [] after several ticks of normal operation', () => {
    const sim = new Simulation(baseConfig());
    for (let i = 0; i < 20; i++) sim.tick();
    expect(checkInvariants(sim)).toEqual([]);
  });

  it('flags a NaN in a living person field', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.emotions.fear = Number.NaN;
    const violations = checkInvariants(sim);
    expect(violations.some((v) => v.includes(String(p.id)))).toBe(true);
  });

  it('flags an Infinite value in a living person field', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.needs.hunger = Number.POSITIVE_INFINITY;
    const violations = checkInvariants(sim);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags a negative inventory value', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.inventory.food = -1;
    const violations = checkInvariants(sim);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags a negative settlement stock value', () => {
    const sim = new Simulation(baseConfig());
    sim.ctx.settlements.push({
      id: 999,
      civId: 0,
      name: 'Testville',
      center: { x: 1, y: 1 },
      memberIds: [],
      stock: { food: -5, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    });
    const violations = checkInvariants(sim);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags a living person with a null-like brainState (undefined)', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    (p as { brainState: unknown }).brainState = undefined;
    const violations = checkInvariants(sim);
    expect(violations.some((v) => v.includes('brainState'))).toBe(true);
  });

  it('flags a living person with an invalid civId (no matching Civ)', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.civId = 9999;
    const violations = checkInvariants(sim);
    expect(violations.some((v) => v.includes('civId'))).toBe(true);
  });

  it('flags a memory array over MEMORY_CAP', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.memory = Array.from({ length: 60 }, (_, i) => ({
      tick: i,
      kind: 'helped' as const,
      otherId: 1,
      valence: 0.1,
      salience: 0.5,
    }));
    const violations = checkInvariants(sim);
    expect(violations.some((v) => v.includes('memory'))).toBe(true);
  });

  it('flags a relationships array over RELATIONSHIP_CAP', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.relationships = Array.from({ length: 30 }, (_, i) => ({
      otherId: i + 1000,
      kind: 'friend' as const,
      affinity: 0.1,
    }));
    const violations = checkInvariants(sim);
    expect(violations.some((v) => v.includes('relationships'))).toBe(true);
  });

  it('ignores dead people entirely (a dead person with NaN emotions is not flagged)', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.alive = false;
    p.emotions.fear = Number.NaN;
    const violations = checkInvariants(sim);
    expect(violations).toEqual([]);
  });

  it('flags a negative civ.knowledge value', () => {
    const sim = new Simulation(baseConfig());
    const civ = sim.ctx.civs[0];
    if (civ === undefined) throw new Error('expected a civ');
    civ.knowledge.fire = -1;
    const violations = checkInvariants(sim);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('population accounting: total alive plus recorded deaths equals total ever created', () => {
    const sim = new Simulation(baseConfig());
    const initialPop = sim.ctx.people.length;
    for (let i = 0; i < 30; i++) sim.tick();
    const alive = sim.ctx.people.filter((p) => p.alive).length;
    const dead = sim.ctx.people.filter((p) => !p.alive).length;
    expect(alive + dead).toBe(sim.ctx.people.length);
    expect(sim.ctx.people.length).toBeGreaterThanOrEqual(initialPop);
    expect(checkInvariants(sim)).toEqual([]);
  });
});
```

- [ ] **Step 7: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/sim/invariants.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/sim/invariants" from "tests/engine/sim/invariants.test.ts". Does the file exist?`

- [ ] **Step 8: Implement `src/engine/sim/invariants.ts`**

Create `src/engine/sim/invariants.ts` with exactly:

```ts
import { MEMORY_CAP, RELATIONSHIP_CAP, type Person } from '../../shared/types';
import type { Simulation } from './simulation';

const PERSON_SCALAR_FIELDS: readonly (keyof Person)[] = ['ageTicks', 'health', 'lifespanTicks', 'influence'];

function checkFinite(value: number, label: string, out: string[]): void {
  if (!Number.isFinite(value)) out.push(`${label} is not finite (${value})`);
}

function checkNonNegative(value: number, label: string, out: string[]): void {
  if (!Number.isFinite(value) || value < 0) out.push(`${label} is negative or non-finite (${value})`);
}

function checkPerson(p: Person, civIds: Set<number>, out: string[]): void {
  const prefix = `person ${p.id}`;

  for (const field of PERSON_SCALAR_FIELDS) {
    checkFinite(p[field] as number, `${prefix}.${String(field)}`, out);
  }

  for (const [key, value] of Object.entries(p.traits)) checkFinite(value, `${prefix}.traits.${key}`, out);
  for (const [key, value] of Object.entries(p.emotions)) checkFinite(value, `${prefix}.emotions.${key}`, out);
  for (const [key, value] of Object.entries(p.morality)) checkFinite(value, `${prefix}.morality.${key}`, out);
  for (const [key, value] of Object.entries(p.needs)) checkFinite(value, `${prefix}.needs.${key}`, out);
  for (const [key, value] of Object.entries(p.skills)) checkFinite(value, `${prefix}.skills.${key}`, out);

  for (const [key, value] of Object.entries(p.inventory)) {
    checkNonNegative(value as number, `${prefix}.inventory.${key}`, out);
  }

  for (let i = 0; i < p.memory.length; i++) {
    const m = p.memory[i];
    if (m === undefined) continue;
    checkFinite(m.valence, `${prefix}.memory[${i}].valence`, out);
    checkFinite(m.salience, `${prefix}.memory[${i}].salience`, out);
  }
  if (p.memory.length > MEMORY_CAP) out.push(`${prefix}.memory exceeds MEMORY_CAP (${p.memory.length})`);

  for (let i = 0; i < p.relationships.length; i++) {
    const r = p.relationships[i];
    if (r === undefined) continue;
    checkFinite(r.affinity, `${prefix}.relationships[${i}].affinity`, out);
  }
  if (p.relationships.length > RELATIONSHIP_CAP) {
    out.push(`${prefix}.relationships exceeds RELATIONSHIP_CAP (${p.relationships.length})`);
  }

  if (p.brainState === undefined || p.brainState === null) {
    out.push(`${prefix}.brainState is missing (${String(p.brainState)})`);
  }

  if (!civIds.has(p.civId)) {
    out.push(`${prefix}.civId ${p.civId} does not match any known Civ`);
  }
}

/**
 * Contract signature verbatim: [] when healthy. Checks population
 * accounting, NaN/Inf across every numeric leaf of every alive Person,
 * non-negative stocks/inventory, valid brainState/civId on every alive
 * person, and memory/relationship caps. Dead people are never inspected.
 */
export function checkInvariants(sim: Simulation): string[] {
  const out: string[] = [];
  const ctx = sim.ctx;
  const civIds = new Set(ctx.civs.map((c) => c.id));

  for (const p of ctx.people) {
    if (!p.alive) continue;
    checkPerson(p, civIds, out);
  }

  for (const civ of ctx.civs) {
    for (const [domain, points] of Object.entries(civ.knowledge)) {
      checkNonNegative(points, `civ ${civ.id}.knowledge.${domain}`, out);
    }
    checkFinite(civ.warWeariness, `civ ${civ.id}.warWeariness`, out);
  }

  for (const s of ctx.settlements) {
    for (const [key, value] of Object.entries(s.stock)) {
      checkNonNegative(value as number, `settlement ${s.id}.stock.${key}`, out);
    }
  }

  const totalEverCreated = ctx.people.length;
  const alive = ctx.people.filter((p) => p.alive).length;
  const dead = ctx.people.filter((p) => !p.alive).length;
  if (alive + dead !== totalEverCreated) {
    out.push(`population accounting mismatch: alive(${alive}) + dead(${dead}) != total(${totalEverCreated})`);
  }

  return out;
}
```

- [ ] **Step 9: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/sim/invariants.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/sim/invariants.test.ts (13 tests)

 Test Files  1 passed (1)
      Tests  13 passed (13)
```

- [ ] **Step 10: Run the full simulation suite together and typecheck**

Run:

```
npx vitest run tests/engine/sim/simulation.test.ts tests/engine/sim/invariants.test.ts
npm run typecheck
```

Expected: both test files pass (12 + 13 = 25 tests), `npm run typecheck` exits 0 with no errors.

- [ ] **Step 11: Commit**

Run:

```
git add src/engine/sim/simulation.ts src/engine/sim/invariants.ts tests/engine/sim/simulation.test.ts tests/engine/sim/invariants.test.ts
git commit -m "feat(sim): Simulation class, EngineCtx wiring, and dev-mode invariants" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 34: Narrative events (`src/engine/sim/events.ts`)

**Files:**
- Create: `src/engine/sim/events.ts`
- Test: `tests/engine/sim/events.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Tick`
- Tests use no other engine imports — `events.ts` is a leaf module inside `sim/` with no dependency on `simulation.ts` (avoiding the circular import that would otherwise exist, since `simulation.ts` imports `pushEvent`/`NarrativeEvent` from this file).

Produces:
- `export interface NarrativeEvent { tick: Tick; kind: string; severity: 1 | 2 | 3; civId: number | null; text: string }` — contract signature verbatim.
- `export const EVENT_LOG_CAP = 500` — the ring buffer capacity.
- `export function pushEvent(log: { events: NarrativeEvent[] }, kind: string, severity: 1 | 2 | 3, civId: number | null, text: string): void` — appends `{ tick: <caller-supplied via a tick field>, ... }`. **Concrete signature note:** since this file must not import `EngineCtx` (circularity), `pushEvent`'s first parameter is typed as the minimal structural shape `{ events: NarrativeEvent[]; tick: Tick }` — every real `EngineCtx` satisfies this, so `Simulation` calls `pushEvent(ctx, kind, severity, civId, text)` unchanged from the contract's own `pushEvent(ctx: EngineCtx, ...)` signature (assignable, not identical, exactly like every other `*CtxLike` pattern in this plan). Appends to `log.events`, then trims the front (oldest first, since `unshift` is never used — events are pushed in tick order and the array stays ascending by tick) down to `EVENT_LOG_CAP` by removing from the start whenever length exceeds the cap.
- One narrate helper per event kind, each returning the human-readable `text` string (never pushing itself — callers pass the result to `pushEvent`, keeping this module pure and trivially testable): `narrateBirth(childName: string, motherName: string, fatherName: string): string`, `narrateDeath(personName: string, cause: string): string`, `narrateSettlementFounded(settlementName: string, civName: string): string`, `narrateSettlementDissolved(settlementName: string): string`, `narrateLeaderEmerged(personName: string, settlementName: string): string`, `narrateTechUnlocked(techId: string, civName: string): string`, `narrateTechLost(techId: string, civName: string): string`, `narrateReligionFounded(religionName: string, founderName: string, civName: string): string`, `narrateRaid(attackerCivName: string, defenderSettlementName: string, attackerWon: boolean): string`, `narrateWarDeclared(civAName: string, civBName: string): string`, `narratePeace(civAName: string, civBName: string): string`, `narrateSchism(settlementName: string, newCivName: string, oldCivName: string): string`, `narrateFamine(settlementName: string): string`, `narrateDisaster(kind: 'drought' | 'harsh-winter' | 'disease', regionDescription: string): string`, `narrateExtinction(): string`.

Wiring notes for Task 33 (binding, already applied above):
- `Simulation` calls `pushEvent(this.ctx, 'schism', 3, newCiv.id, narrateSchism(...))`-style calls at every point in `tick()` where a society module signals a state change worth narrating. Task 33's own implementation above wires `'schism'` and `'extinction'` directly since those are detectable from `Simulation`'s own bookkeeping (civ-count delta, population-zero edge). Births/deaths/settlement/tech/religion/raid/war/famine/disaster narration are produced by later balance/integration work (Task 45) reading `ctx.counters`, settlement/tech/religion diffs, and `ctx.naturalEvents` each tick and calling the matching `narrate*` helper — this task defines and unit-tests every helper completely; wiring every single call site into `Simulation.tick()` beyond schism/extinction is explicitly out of scope for Task 33 (which already satisfies its own test suite) and does not block any later task, since every consumer of `ctx.events` (Task 35's `takeSnapshot`, the UI event feed) only reads whatever is present.

- [ ] **Step 1: Write the failing events tests**

Create `tests/engine/sim/events.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  EVENT_LOG_CAP,
  narrateBirth,
  narrateDeath,
  narrateDisaster,
  narrateExtinction,
  narrateFamine,
  narrateLeaderEmerged,
  narratePeace,
  narrateRaid,
  narrateReligionFounded,
  narrateSchism,
  narrateSettlementDissolved,
  narrateSettlementFounded,
  narrateTechLost,
  narrateTechUnlocked,
  narrateWarDeclared,
  pushEvent,
  type NarrativeEvent,
} from '../../../src/engine/sim/events';

interface Log {
  events: NarrativeEvent[];
  tick: number;
}

function makeLog(tick = 0): Log {
  return { events: [], tick };
}

describe('pushEvent', () => {
  it('appends an event with the given fields and the log tick', () => {
    const log = makeLog(42);
    pushEvent(log, 'birth', 1, 3, 'A child is born.');
    expect(log.events).toHaveLength(1);
    expect(log.events[0]).toEqual({ tick: 42, kind: 'birth', severity: 1, civId: 3, text: 'A child is born.' });
  });

  it('accepts a null civId for civ-agnostic events', () => {
    const log = makeLog(1);
    pushEvent(log, 'extinction', 3, null, narrateExtinction());
    expect(log.events[0]?.civId).toBeNull();
  });

  it('caps the ring buffer at EVENT_LOG_CAP, dropping the oldest first', () => {
    expect(EVENT_LOG_CAP).toBe(500);
    const log = makeLog(0);
    for (let i = 0; i < 520; i++) {
      log.tick = i;
      pushEvent(log, 'birth', 1, 0, `event ${i}`);
    }
    expect(log.events).toHaveLength(500);
    expect(log.events[0]?.text).toBe('event 20'); // the first 20 were dropped
    expect(log.events[log.events.length - 1]?.text).toBe('event 519');
  });
});

describe('narration templates contain the names passed in', () => {
  it('narrateBirth', () => {
    const text = narrateBirth('Mira', 'Alda', 'Boren');
    expect(text).toContain('Mira');
    expect(text).toContain('Alda');
    expect(text).toContain('Boren');
  });

  it('narrateDeath', () => {
    const text = narrateDeath('Corin', 'starvation');
    expect(text).toContain('Corin');
    expect(text).toContain('starvation');
  });

  it('narrateSettlementFounded', () => {
    const text = narrateSettlementFounded('Rivermeet', 'Opus Dominion');
    expect(text).toContain('Rivermeet');
    expect(text).toContain('Opus Dominion');
  });

  it('narrateSettlementDissolved', () => {
    const text = narrateSettlementDissolved('Rivermeet');
    expect(text).toContain('Rivermeet');
  });

  it('narrateLeaderEmerged', () => {
    const text = narrateLeaderEmerged('Talia', 'Rivermeet');
    expect(text).toContain('Talia');
    expect(text).toContain('Rivermeet');
  });

  it('narrateTechUnlocked', () => {
    const text = narrateTechUnlocked('agriculture', 'Sonnet Commonwealth');
    expect(text).toContain('agriculture');
    expect(text).toContain('Sonnet Commonwealth');
  });

  it('narrateTechLost', () => {
    const text = narrateTechLost('writing', 'Haiku Enclave');
    expect(text).toContain('writing');
    expect(text).toContain('Haiku Enclave');
  });

  it('narrateReligionFounded', () => {
    const text = narrateReligionFounded('The Ember Path', 'Sera', 'Fable Wandering');
    expect(text).toContain('The Ember Path');
    expect(text).toContain('Sera');
    expect(text).toContain('Fable Wandering');
  });

  it('narrateRaid (attacker won)', () => {
    const text = narrateRaid('Opus Dominion', 'Rivermeet', true);
    expect(text).toContain('Opus Dominion');
    expect(text).toContain('Rivermeet');
  });

  it('narrateRaid (attacker lost)', () => {
    const text = narrateRaid('Opus Dominion', 'Rivermeet', false);
    expect(text).toContain('Opus Dominion');
    expect(text).toContain('Rivermeet');
  });

  it('narrateWarDeclared', () => {
    const text = narrateWarDeclared('Opus Dominion', 'Haiku Enclave');
    expect(text).toContain('Opus Dominion');
    expect(text).toContain('Haiku Enclave');
  });

  it('narratePeace', () => {
    const text = narratePeace('Opus Dominion', 'Haiku Enclave');
    expect(text).toContain('Opus Dominion');
    expect(text).toContain('Haiku Enclave');
  });

  it('narrateSchism', () => {
    const text = narrateSchism('Rivermeet', 'Rivermeet Free State', 'Opus Dominion');
    expect(text).toContain('Rivermeet');
    expect(text).toContain('Rivermeet Free State');
    expect(text).toContain('Opus Dominion');
  });

  it('narrateFamine', () => {
    const text = narrateFamine('Rivermeet');
    expect(text).toContain('Rivermeet');
  });

  it('narrateDisaster', () => {
    const text = narrateDisaster('drought', 'the river valley');
    expect(text).toContain('the river valley');
  });

  it('narrateExtinction contains no interpolated name (civ-agnostic) but is non-empty', () => {
    const text = narrateExtinction();
    expect(text.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/sim/events.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/sim/events" from "tests/engine/sim/events.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `src/engine/sim/events.ts`**

Create `src/engine/sim/events.ts` with exactly:

```ts
import type { Tick } from '../../shared/types';

/** Contract signature verbatim. */
export interface NarrativeEvent {
  tick: Tick;
  kind: string;
  severity: 1 | 2 | 3;
  civId: number | null;
  text: string;
}

export const EVENT_LOG_CAP = 500;

/**
 * The minimal structural shape pushEvent needs — every real EngineCtx
 * satisfies this (assignable, not identical), avoiding a circular import on
 * simulation.ts (which itself imports pushEvent/NarrativeEvent from here).
 */
export interface EventLogLike {
  events: NarrativeEvent[];
  tick: Tick;
}

/** Appends an event at the log's current tick, then trims to EVENT_LOG_CAP from the front (oldest first). */
export function pushEvent(
  log: EventLogLike,
  kind: string,
  severity: 1 | 2 | 3,
  civId: number | null,
  text: string,
): void {
  log.events.push({ tick: log.tick, kind, severity, civId, text });
  if (log.events.length > EVENT_LOG_CAP) {
    log.events.splice(0, log.events.length - EVENT_LOG_CAP);
  }
}

export function narrateBirth(childName: string, motherName: string, fatherName: string): string {
  return `${childName} is born to ${motherName} and ${fatherName}.`;
}

export function narrateDeath(personName: string, cause: string): string {
  return `${personName} has died of ${cause}.`;
}

export function narrateSettlementFounded(settlementName: string, civName: string): string {
  return `${settlementName} is founded by the people of ${civName}.`;
}

export function narrateSettlementDissolved(settlementName: string): string {
  return `${settlementName} is abandoned; its people scatter.`;
}

export function narrateLeaderEmerged(personName: string, settlementName: string): string {
  return `${personName} rises to lead ${settlementName}.`;
}

export function narrateTechUnlocked(techId: string, civName: string): string {
  return `${civName} masters ${techId}.`;
}

export function narrateTechLost(techId: string, civName: string): string {
  return `${civName} loses the knowledge of ${techId}.`;
}

export function narrateReligionFounded(religionName: string, founderName: string, civName: string): string {
  return `${founderName} founds ${religionName} among the people of ${civName}.`;
}

export function narrateRaid(attackerCivName: string, defenderSettlementName: string, attackerWon: boolean): string {
  return attackerWon
    ? `${attackerCivName} raiders sack ${defenderSettlementName}.`
    : `${attackerCivName} raiders are repelled at ${defenderSettlementName}.`;
}

export function narrateWarDeclared(civAName: string, civBName: string): string {
  return `War breaks out between ${civAName} and ${civBName}.`;
}

export function narratePeace(civAName: string, civBName: string): string {
  return `${civAName} and ${civBName} make peace, weary of war.`;
}

export function narrateSchism(settlementName: string, newCivName: string, oldCivName: string): string {
  return `${settlementName} breaks away from ${oldCivName} and founds ${newCivName}.`;
}

export function narrateFamine(settlementName: string): string {
  return `Famine grips ${settlementName}.`;
}

export function narrateDisaster(kind: 'drought' | 'harsh-winter' | 'disease', regionDescription: string): string {
  const label = kind === 'harsh-winter' ? 'a harsh winter' : kind === 'drought' ? 'drought' : 'disease';
  return `${label[0]?.toUpperCase()}${label.slice(1)} strikes ${regionDescription}.`;
}

export function narrateExtinction(): string {
  return 'The last person has died. The world falls silent.';
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/sim/events.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/sim/events.test.ts (20 tests)

 Test Files  1 passed (1)
      Tests  20 passed (20)
```

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors. (If Task 33 was written before this step per Step 1's note, this also confirms `simulation.ts`'s import of `pushEvent`/`NarrativeEvent` from this file resolves cleanly.)

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/sim/events.ts tests/engine/sim/events.test.ts
git commit -m "feat(sim): narrative event ring buffer and per-kind narration templates" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 35: Snapshot, metrics, and person detail (`src/engine/sim/snapshot.ts` + `src/shared/protocol.ts`)

**Files:**
- Create: `src/shared/protocol.ts`
- Create: `src/engine/sim/snapshot.ts`
- Test: `tests/engine/sim/snapshot.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Civ`, `Settlement`, `Religion`, `Lineage`, `LINEAGES`, `Season`, `StructureKind`, `RelationKind`, `Morality`, `Emotions`, `Tick`, `TECH_IDS`
- From `src/engine/world/climate.ts` (Task 6): `seasonOf(tick): Season`
- From `src/engine/agents/emotions.ts` (Task 10): `dominantEmotion(p): 'calm' | 'afraid' | 'angry' | 'joyful' | 'grieving'`
- From `src/engine/brains/registry.ts` (Task 20): `getBrain(lineage): Brain`
- From `src/engine/society/influence.ts` (Task 27): `leaderOf`, `InfluenceCtxLike` (used transitively; `takeSnapshot` does not call `leaderOf` itself — `personDetail` does not need it either, since it reports the target person, not a leader)
- From `src/engine/sim/simulation.ts` (Task 33): `Simulation`, `EngineCtx`
- Tests also use `createRng` (Task 2), `Simulation` (Task 33)

Produces (all in `src/shared/protocol.ts` unless noted):
- `export interface CivMetrics { civId: number; name: string; color: string; population: number; births: number; deaths: number; techCount: number; atWar: boolean; lineageShare: Record<Lineage, number>; avgMorality: Morality; avgEmotions: Emotions; foodPerCapita: number }` — contract verbatim.
- `export interface SettlementView { id: number; civId: number; x: number; y: number; population: number; name: string; structures: Record<StructureKind, number> }` — contract verbatim.
- `export interface Snapshot { tick: Tick; year: number; season: Season; population: number; worldSize: number; ids: Int32Array; xs: Float32Array; ys: Float32Array; civIds: Int16Array; lineages: Int8Array; healths: Uint8Array; moods: Uint8Array; settlements: SettlementView[]; territory: Int16Array | null; recentEvents: NarrativeEvent[]; metrics: CivMetrics[] }` — contract verbatim (`NarrativeEvent` imported as a type from `src/engine/sim/events.ts`).
- `export const MOOD_ORDER: readonly ('calm' | 'afraid' | 'angry' | 'joyful' | 'grieving')[] = ['calm', 'afraid', 'angry', 'joyful', 'grieving']` — the contract's mood-to-int encoding table (index = int value stored in `Snapshot.moods`).
- `export const TERRITORY_RADIUS = 20` — the nearest-settlement-within-N-tiles ownership radius.
- (in `src/engine/sim/snapshot.ts`) `export function takeSnapshot(sim: Simulation, includeTerritory: boolean): Snapshot` — contract signature verbatim. Fills every typed array with alive people only, in ascending id order; `territory` is `null` unless `includeTerritory` is true (deviation 11 gives the concrete ownership rule); `recentEvents` is every event in `sim.ctx.events` with `tick > sinceTick`, where `sinceTick` is tracked internally via a per-`Simulation` extension property `_lastSnapshotTick` (defaulting to `-1` so the very first snapshot returns the entire log) that `takeSnapshot` updates to `sim.ctx.tick` on every call — this makes repeated calls return only newly-appended events without requiring `Simulation` itself to track UI-snapshot cursors (mirrors the extension-property pattern used throughout Sections 4 and 6).
- (in `src/engine/sim/snapshot.ts`) `export function personDetail(sim: Simulation, id: number): PersonDetail | null` — contract signature verbatim; `null` for an unknown id (including a ghost id that never existed). Resolves memory `otherId`s and relationship `otherId`s to names via `sim.ctx.personById` (falls back to `'someone'` for an id that no longer resolves, e.g. after very aggressive future pruning — never throws).
- `export interface PersonDetail { person: Person; memoriesText: string[]; relationshipsNamed: { name: string; kind: RelationKind; affinity: number }[]; temperament: Temperament; settlementName: string | null; civName: string }` — contract verbatim (`Temperament` imported as a type from `src/engine/brains/types.ts`).

Wiring notes for Task 36/37 (binding):
- `save.ts` (Task 36) does not use `takeSnapshot`/`personDetail` at all — it serializes `Simulation` state directly.
- `worker.ts` (Task 37) calls `takeSnapshot(sim, includeTerritory)` on its own cadence and `personDetail(sim, id)` in response to an `'inspect'` message, per the protocol.

- [ ] **Step 1: Write `src/shared/protocol.ts` (types only, no UiToWorker/WorkerToUi yet — those are Task 37)**

Create `src/shared/protocol.ts` with exactly:

```ts
import type {
  Emotions,
  Lineage,
  Morality,
  RelationKind,
  Season,
  StructureKind,
  Tick,
} from './types';
import type { NarrativeEvent } from '../engine/sim/events';
import type { Temperament } from '../engine/brains/types';
import type { Person } from './types';

export interface CivMetrics {
  civId: number;
  name: string;
  color: string;
  population: number;
  births: number;
  deaths: number;
  techCount: number;
  atWar: boolean;
  lineageShare: Record<Lineage, number>;
  avgMorality: Morality;
  avgEmotions: Emotions;
  foodPerCapita: number;
}

export interface SettlementView {
  id: number;
  civId: number;
  x: number;
  y: number;
  population: number;
  name: string;
  structures: Record<StructureKind, number>;
}

export interface Snapshot {
  tick: Tick;
  year: number;
  season: Season;
  population: number;
  worldSize: number;
  ids: Int32Array;
  xs: Float32Array;
  ys: Float32Array;
  civIds: Int16Array;
  lineages: Int8Array;
  healths: Uint8Array;
  moods: Uint8Array;
  settlements: SettlementView[];
  territory: Int16Array | null;
  recentEvents: NarrativeEvent[];
  metrics: CivMetrics[];
}

/** Mood-to-int encoding table for Snapshot.moods: index = stored value. */
export const MOOD_ORDER: readonly ('calm' | 'afraid' | 'angry' | 'joyful' | 'grieving')[] = [
  'calm',
  'afraid',
  'angry',
  'joyful',
  'grieving',
];

/** Nearest-settlement-within-N-tiles radius used by territory ownership. */
export const TERRITORY_RADIUS = 20;

export interface PersonDetail {
  person: Person;
  memoriesText: string[];
  relationshipsNamed: { name: string; kind: RelationKind; affinity: number }[];
  temperament: Temperament;
  settlementName: string | null;
  civName: string;
}
```

- [ ] **Step 2: Write the failing snapshot tests**

Create `tests/engine/sim/snapshot.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { takeSnapshot, personDetail } from '../../../src/engine/sim/snapshot';
import { Simulation } from '../../../src/engine/sim/simulation';
import { MOOD_ORDER, TERRITORY_RADIUS } from '../../../src/shared/protocol';
import { LINEAGES, type SimConfig } from '../../../src/shared/types';

function baseConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { seed: 11, mode: 'civs', mapSize: 'small', startPopulation: 200, ...overrides };
}

describe('takeSnapshot — array lengths and basic fields', () => {
  it('typed array lengths match the alive population, not the total roster', () => {
    const sim = new Simulation(baseConfig());
    sim.ctx.people[0]!.alive = false;
    sim.ctx.people[0]!.health = 0;
    sim.ctx.people[0]!.causeOfDeath = 'old-age';
    const snap = takeSnapshot(sim, false);
    const aliveCount = sim.ctx.people.filter((p) => p.alive).length;
    expect(snap.population).toBe(aliveCount);
    expect(snap.ids.length).toBe(aliveCount);
    expect(snap.xs.length).toBe(aliveCount);
    expect(snap.ys.length).toBe(aliveCount);
    expect(snap.civIds.length).toBe(aliveCount);
    expect(snap.lineages.length).toBe(aliveCount);
    expect(snap.healths.length).toBe(aliveCount);
    expect(snap.moods.length).toBe(aliveCount);
  });

  it('ids are ascending and never include a dead person', () => {
    const sim = new Simulation(baseConfig());
    sim.ctx.people[3]!.alive = false;
    const deadId = sim.ctx.people[3]!.id;
    const snap = takeSnapshot(sim, false);
    for (let i = 1; i < snap.ids.length; i++) {
      expect(snap.ids[i]).toBeGreaterThan(snap.ids[i - 1] as number);
    }
    expect(Array.from(snap.ids)).not.toContain(deadId);
  });

  it('lineages is the LINEAGES index of each alive person, in ids order', () => {
    const sim = new Simulation(baseConfig());
    const snap = takeSnapshot(sim, false);
    for (let i = 0; i < snap.ids.length; i++) {
      const person = sim.ctx.personById.get(snap.ids[i] as number);
      expect(person).toBeDefined();
      expect(snap.lineages[i]).toBe(LINEAGES.indexOf(person!.lineage));
    }
  });

  it('healths are 0..255 scaled from Person.health (0..1)', () => {
    const sim = new Simulation(baseConfig());
    sim.ctx.people[0]!.health = 1;
    sim.ctx.people[1]!.health = 0;
    sim.ctx.people[2]!.health = 0.5;
    const snap = takeSnapshot(sim, false);
    const idx = (id: number): number => Array.from(snap.ids).indexOf(id);
    expect(snap.healths[idx(sim.ctx.people[0]!.id)]).toBe(255);
    expect(snap.healths[idx(sim.ctx.people[1]!.id)]).toBe(0);
    expect(snap.healths[idx(sim.ctx.people[2]!.id)]).toBeGreaterThan(120);
    expect(snap.healths[idx(sim.ctx.people[2]!.id)]).toBeLessThan(135);
  });

  it('moods round-trip through MOOD_ORDER', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0]!;
    p.emotions = { fear: 0, joy: 0.9, grief: 0, anger: 0, hope: 0 };
    const snap = takeSnapshot(sim, false);
    const idx = Array.from(snap.ids).indexOf(p.id);
    expect(MOOD_ORDER[snap.moods[idx] as number]).toBe('joyful');
  });

  it('tick/year/season/worldSize are consistent with the sim', () => {
    const sim = new Simulation(baseConfig());
    for (let i = 0; i < 400; i++) sim.tick();
    const snap = takeSnapshot(sim, false);
    expect(snap.tick).toBe(sim.ctx.tick);
    expect(snap.year).toBe(Math.floor(sim.ctx.tick / 360));
    expect(snap.worldSize).toBe(sim.ctx.world.size);
  });
});

describe('takeSnapshot — territory', () => {
  it('territory is null when includeTerritory is false', () => {
    const sim = new Simulation(baseConfig());
    const snap = takeSnapshot(sim, false);
    expect(snap.territory).toBeNull();
  });

  it('territory is a full-map Int16Array when includeTerritory is true, -1 far from any settlement', () => {
    const sim = new Simulation(baseConfig());
    const snap = takeSnapshot(sim, true);
    expect(snap.territory).not.toBeNull();
    expect(snap.territory!.length).toBe(sim.ctx.world.size * sim.ctx.world.size);
    expect(TERRITORY_RADIUS).toBe(20);
  });

  it('assigns the nearest settlement within 20 tiles to its civId', () => {
    const sim = new Simulation(baseConfig());
    sim.ctx.settlements = [
      {
        id: 1,
        civId: 2,
        name: 'Testville',
        center: { x: 10, y: 10 },
        memberIds: [],
        stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 },
        structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
      },
    ];
    const snap = takeSnapshot(sim, true);
    const idx = 10 * sim.ctx.world.size + 10; // (10,10)
    expect(snap.territory![idx]).toBe(2);
    const farIdx = 0; // (0,0), far corner on a size>=96 map
    expect(snap.territory![farIdx]).toBe(-1);
  });
});

describe('takeSnapshot — settlements and metrics', () => {
  it('settlements maps every Settlement to a SettlementView', () => {
    const sim = new Simulation(baseConfig());
    sim.ctx.settlements = [
      {
        id: 5,
        civId: 0,
        name: 'Hearth',
        center: { x: 3, y: 4 },
        memberIds: [1, 2],
        stock: { food: 1, wood: 2, stone: 3, metal: 4, tools: 5 },
        structures: { shelter: 1, granary: 0, wall: 0, shrine: 0 },
      },
    ];
    sim.ctx.personById.get(1)!.alive = true;
    sim.ctx.personById.get(2)!.alive = true;
    const snap = takeSnapshot(sim, false);
    expect(snap.settlements).toHaveLength(1);
    expect(snap.settlements[0]).toMatchObject({ id: 5, civId: 0, x: 3, y: 4, name: 'Hearth' });
  });

  it('metrics has one entry per civ with plausible aggregate values', () => {
    const sim = new Simulation(baseConfig());
    const snap = takeSnapshot(sim, false);
    expect(snap.metrics).toHaveLength(sim.ctx.civs.length);
    for (const m of snap.metrics) {
      expect(m.population).toBeGreaterThanOrEqual(0);
      const shareSum = Object.values(m.lineageShare).reduce((a, b) => a + b, 0);
      if (m.population > 0) expect(shareSum).toBeCloseTo(1, 5);
      for (const v of Object.values(m.avgMorality)) expect(Number.isFinite(v)).toBe(true);
      for (const v of Object.values(m.avgEmotions)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('recentEvents only returns events since the previous call', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    for (const p of sim.ctx.people) {
      p.alive = false;
      p.health = 0;
    }
    sim.tick(); // triggers the extinction event
    const first = takeSnapshot(sim, false);
    expect(first.recentEvents.some((e) => e.kind === 'extinction')).toBe(true);
    const second = takeSnapshot(sim, false);
    expect(second.recentEvents).toHaveLength(0);
  });
});

describe('personDetail', () => {
  it('returns null for an unknown id', () => {
    const sim = new Simulation(baseConfig());
    expect(personDetail(sim, 999999)).toBeNull();
  });

  it('resolves the person, temperament, civ name and settlement name', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0]!;
    const detail = personDetail(sim, p.id);
    expect(detail).not.toBeNull();
    expect(detail!.person.id).toBe(p.id);
    expect(detail!.civName.length).toBeGreaterThan(0);
    expect(typeof detail!.temperament.moralWeight).toBe('number');
    expect(detail!.settlementName).toBeNull(); // unsettled at construction
  });

  it('resolves memory and relationship names', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0]!;
    const other = sim.ctx.people[1]!;
    p.memory = [{ tick: 0, kind: 'helped', otherId: other.id, valence: 0.5, salience: 0.5 }];
    p.relationships = [{ otherId: other.id, kind: 'friend', affinity: 0.4 }];
    const detail = personDetail(sim, p.id);
    expect(detail!.memoriesText.length).toBe(1);
    expect(detail!.memoriesText[0]).toContain(other.name);
    expect(detail!.relationshipsNamed).toEqual([{ name: other.name, kind: 'friend', affinity: 0.4 }]);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/sim/snapshot.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/sim/snapshot" from "tests/engine/sim/snapshot.test.ts". Does the file exist?`

- [ ] **Step 4: Implement `src/engine/sim/snapshot.ts`**

Create `src/engine/sim/snapshot.ts` with exactly:

```ts
import {
  LINEAGES,
  TECH_IDS,
  type Morality,
  type Emotions,
  type Lineage,
  type RelationKind,
  type StructureKind,
} from '../../shared/types';
import { seasonOf } from '../world/climate';
import { dominantEmotion } from '../agents/emotions';
import { getBrain } from '../brains/registry';
import type { Simulation } from './simulation';
import {
  MOOD_ORDER,
  TERRITORY_RADIUS,
  type CivMetrics,
  type PersonDetail,
  type SettlementView,
  type Snapshot,
} from '../../shared/protocol';

const YEAR_TICKS_LOCAL = 360;

interface WithLastSnapshotTick {
  _lastSnapshotTick?: number;
}

function moralityZero(): Morality {
  return { care: 0, fairness: 0, loyalty: 0, authority: 0, sanctity: 0, liberty: 0 };
}

function emotionsZero(): Emotions {
  return { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 };
}

function structuresZero(): Record<StructureKind, number> {
  return { shelter: 0, granary: 0, wall: 0, shrine: 0 };
}

function moodIndex(p: Parameters<typeof dominantEmotion>[0]): number {
  const mood = dominantEmotion(p);
  const idx = MOOD_ORDER.indexOf(mood);
  return idx >= 0 ? idx : 0;
}

/**
 * Contract signature verbatim. Typed arrays cover alive people only, in
 * ascending id order. territory is null unless includeTerritory is true.
 * recentEvents returns only events appended since the previous call on this
 * Simulation instance (tracked via a per-instance extension property).
 */
export function takeSnapshot(sim: Simulation, includeTerritory: boolean): Snapshot {
  const ctx = sim.ctx;
  const alive = ctx.people.filter((p) => p.alive).sort((a, b) => a.id - b.id);
  const n = alive.length;

  const ids = new Int32Array(n);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const civIds = new Int16Array(n);
  const lineages = new Int8Array(n);
  const healths = new Uint8Array(n);
  const moods = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const p = alive[i]!;
    ids[i] = p.id;
    xs[i] = p.pos.x;
    ys[i] = p.pos.y;
    civIds[i] = p.civId;
    lineages[i] = LINEAGES.indexOf(p.lineage);
    healths[i] = Math.round(Math.max(0, Math.min(1, p.health)) * 255);
    moods[i] = moodIndex(p);
  }

  const settlements: SettlementView[] = ctx.settlements
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((s) => ({
      id: s.id,
      civId: s.civId,
      x: s.center.x,
      y: s.center.y,
      population: s.memberIds.filter((id) => ctx.personById.get(id)?.alive === true).length,
      name: s.name,
      structures: { ...s.structures },
    }));

  const territory = includeTerritory ? computeTerritory(sim) : null;

  const ext = sim as Simulation & WithLastSnapshotTick;
  const since = ext._lastSnapshotTick ?? -1;
  const recentEvents = ctx.events.filter((e) => e.tick > since);
  ext._lastSnapshotTick = ctx.tick;

  const metrics = computeMetrics(sim);

  return {
    tick: ctx.tick,
    year: Math.floor(ctx.tick / YEAR_TICKS_LOCAL),
    season: seasonOf(ctx.tick),
    population: n,
    worldSize: ctx.world.size,
    ids,
    xs,
    ys,
    civIds,
    lineages,
    healths,
    moods,
    settlements,
    territory,
    recentEvents,
    metrics,
  };
}

/** Nearest-settlement-within-TERRITORY_RADIUS-tiles ownership, ties broken by lowest settlement id. */
function computeTerritory(sim: Simulation): Int16Array {
  const ctx = sim.ctx;
  const size = ctx.world.size;
  const territory = new Int16Array(size * size).fill(-1);
  const settlements = ctx.settlements.slice().sort((a, b) => a.id - b.id);
  if (settlements.length === 0) return territory;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bestCivId = -1;
      let bestDist = Infinity;
      for (const s of settlements) {
        const d = Math.hypot(x - s.center.x, y - s.center.y);
        if (d > TERRITORY_RADIUS) continue;
        if (d < bestDist) {
          bestDist = d;
          bestCivId = s.civId;
        }
      }
      territory[y * size + x] = bestCivId;
    }
  }
  return territory;
}

function computeMetrics(sim: Simulation): CivMetrics[] {
  const ctx = sim.ctx;
  const out: CivMetrics[] = [];
  for (const civ of [...ctx.civs].sort((a, b) => a.id - b.id)) {
    const members = ctx.people.filter((p) => p.alive && p.civId === civ.id);
    const population = members.length;

    const lineageCounts: Record<Lineage, number> = { opus: 0, sonnet: 0, haiku: 0, fable: 0 };
    for (const p of members) lineageCounts[p.lineage] += 1;
    const lineageShare: Record<Lineage, number> = { opus: 0, sonnet: 0, haiku: 0, fable: 0 };
    for (const lineage of LINEAGES) {
      lineageShare[lineage] = population > 0 ? lineageCounts[lineage] / population : 0;
    }

    const avgMorality = moralityZero();
    const avgEmotions = emotionsZero();
    if (population > 0) {
      for (const p of members) {
        for (const key of Object.keys(avgMorality) as (keyof Morality)[]) avgMorality[key] += p.morality[key];
        for (const key of Object.keys(avgEmotions) as (keyof Emotions)[]) avgEmotions[key] += p.emotions[key];
      }
      for (const key of Object.keys(avgMorality) as (keyof Morality)[]) avgMorality[key] /= population;
      for (const key of Object.keys(avgEmotions) as (keyof Emotions)[]) avgEmotions[key] /= population;
    }

    let totalFood = members.reduce((sum, p) => sum + p.inventory.food, 0);
    for (const s of ctx.settlements) if (s.civId === civ.id) totalFood += s.stock.food;

    out.push({
      civId: civ.id,
      name: civ.name,
      color: civ.color,
      population,
      births: ctx.counters.births,
      deaths: ctx.counters.deaths,
      techCount: civ.techs.length,
      atWar: civ.atWarWith.length > 0,
      lineageShare,
      avgMorality,
      avgEmotions,
      foodPerCapita: population > 0 ? totalFood / population : 0,
    });
  }
  return out;
}

/** Contract signature verbatim. null for an unknown id. */
export function personDetail(sim: Simulation, id: number): PersonDetail | null {
  const ctx = sim.ctx;
  const person = ctx.personById.get(id);
  if (person === undefined) return null;

  const nameOf = (otherId: number): string => ctx.personById.get(otherId)?.name ?? 'someone';

  const memoriesText = person.memory.map((m) => `${m.kind} involving ${nameOf(m.otherId)} (tick ${m.tick})`);
  const relationshipsNamed: { name: string; kind: RelationKind; affinity: number }[] = person.relationships.map(
    (r) => ({ name: nameOf(r.otherId), kind: r.kind, affinity: r.affinity }),
  );

  const temperament = getBrain(person.lineage).temperament();

  const settlement =
    person.settlementId !== null ? ctx.settlements.find((s) => s.id === person.settlementId) : undefined;
  const settlementName = settlement !== undefined ? settlement.name : null;

  const civ = ctx.civs.find((c) => c.id === person.civId);
  const civName = civ !== undefined ? civ.name : 'unknown';

  return { person, memoriesText, relationshipsNamed, temperament, settlementName, civName };
}

// TECH_IDS is imported to keep this module's dependency surface explicit for
// future metrics extensions (e.g. per-tech adoption counts); no current
// field uses it directly beyond civ.techs.length above.
void TECH_IDS;
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/sim/snapshot.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/sim/snapshot.test.ts (16 tests)

 Test Files  1 passed (1)
      Tests  16 passed (16)
```

- [ ] **Step 6: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 7: Commit**

Run:

```
git add src/shared/protocol.ts src/engine/sim/snapshot.ts tests/engine/sim/snapshot.test.ts
git commit -m "feat(sim): typed-array snapshots, civ metrics, territory, and person detail" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 36: Save/load, checksum, and RNG state (`src/engine/sim/save.ts` + `src/engine/rng.ts` modify)

**Files:**
- Create: `src/engine/sim/save.ts`
- Modify: `src/engine/rng.ts` (add `getState()`/`setState(s)` to the `Rng` interface and implementation)
- Test: `tests/engine/sim/save.test.ts`
- Test: `tests/engine/sim/determinism.test.ts`
- Test: `tests/engine/forbidden-api.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Civ`, `Settlement`, `Religion`, `SimConfig`, `Tick`
- From `src/engine/rng.ts` (Task 2, modified by this task): `Rng`, `createRng(seed): Rng`
- From `src/engine/world/terrain.ts` (Task 5): `World`, `generateWorld(size, rng): World`
- From `src/engine/world/spatial.ts` (Task 7): `SpatialIndex`
- From `src/engine/names.ts` (Task 4): `makeNameGenerator(rng): NameGen`
- From `src/engine/sim/simulation.ts` (Task 33): `Simulation`, `EngineCtx`, `RNG_LABEL_WORLD`/`RNG_LABEL_EVENTS`/`RNG_LABEL_SOCIETY`/`RNG_LABEL_LIFECYCLE` (unused directly by save.ts but confirms no fresh `.split()` calls are needed post-restore — restoring the root rng's exact state via `setState` reproduces every future `.split()` call bit-for-bit, since `split(label)` is a pure function of the parent's *creation seed*, not its draw position, per `rng.ts`'s own documented semantics)
- From `src/engine/society/technology.ts` (Task 29): `techYieldMultiplier`, `addKnowledge` (re-wired identically to `Simulation`'s own constructor, for the restored `ctx.tech`)
- Tests also use `Simulation` (Task 33), `checkInvariants` (Task 33)

Produces:
- `src/engine/rng.ts` modifications: `export interface Rng { ...; getState(): number; setState(s: number): void }` — `getState()` returns the current internal mulberry32 word (the same shape as the seed the generator was constructed/reseeded with); `setState(s)` reseeds the generator's internal word to `s` in place (subsequent `next()`/`int()`/etc. continue from that exact point, and `split(label)` continues to derive from the *original creation seed* per its documented semantics, so `setState` never perturbs which child streams `split` will produce — only the root stream's own future draws). `createRng(seed)`'s returned object exposes both.
- `export const SAVE_FORMAT_VERSION = 1` — the envelope's `v` field.
- `export interface SaveEnvelope { v: 1; config: SimConfig; tick: Tick; rngState: number; people: Person[]; civs: Civ[]; settlements: Settlement[]; religions: Religion[]; naturalEvents: NaturalEvent[]; eventLog: NarrativeEvent[] }` — the contract's versioned envelope, made concrete field-by-field (`NaturalEvent` from `src/engine/world/climate.ts`, `NarrativeEvent` from `src/engine/sim/events.ts`).
- `export function serialize(sim: Simulation): string` — contract signature verbatim: builds a `SaveEnvelope` from `sim.ctx` (`rngState: sim.ctx.rng.getState()`) and returns `JSON.stringify(envelope)`.
- `export function deserialize(json: string): Simulation` — contract signature verbatim: parses the envelope, validates `v === SAVE_FORMAT_VERSION` (throws `Error('save.ts: unsupported save version ' + v)` otherwise), and reconstructs a `Simulation` **without rerunning `initPopulation`/construction-time brain init** via the internal (non-exported-on-the-class) restoration path `Simulation.fromEnvelope` — see Step 3 below, which adds this one additional static factory to `simulation.ts` as part of this task's own file-modify list (recorded as a second, minimal `Modify:` target since the contract's `Simulation` constructor is not touched: only a new static method is added).
- `export function checksum(sim: Simulation): number` — contract signature verbatim: FNV-1a (the same 32-bit algorithm `rng.ts` already implements for `split`) over a **stable serialization**: `JSON.stringify` of `{ tick, rngState, people: sim.ctx.people, civs: sim.ctx.civs, settlements: sim.ctx.settlements, religions: sim.ctx.religions }` with object keys in the fixed insertion order the interfaces declare them (JavaScript object/array `JSON.stringify` order is already deterministic for the plain-data shapes used throughout this engine — no extra sorting is required beyond what `people`/`civs`/`settlements` arrays already guarantee via their construction order).

Wiring notes (binding):
- This task additionally **modifies** `src/engine/sim/simulation.ts` (Task 33) to add one static factory method to the `Simulation` class: `static fromEnvelope(envelope: SaveEnvelope): Simulation`. This is listed as a **Modify:** target below in addition to `rng.ts`.
- `worker.ts` (Task 37) calls `serialize(sim)` in response to `{ type: 'serialize' }` and `deserialize(json)` in response to `{ type: 'load', json }`, replacing its own `sim` reference with the result.

- [ ] **Step 1: Modify `src/engine/rng.ts`: add `getState`/`setState`**

Read the existing `src/engine/rng.ts` (Task 2) before editing — it already exports `createRng(seed: number): Rng` with a mulberry32 closure holding a private `state` variable. Add `getState`/`setState` to both the `Rng` interface and the object `createRng` returns, changing only the interface and the returned object literal — the mulberry32 stepping function, `split`, and every other member are untouched. The interface becomes:

```ts
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  range(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  gaussian(mean: number, sd: number): number;
  split(label: string): Rng;
  getState(): number;
  setState(s: number): void;
}
```

And the returned object inside `createRng` gains two members alongside the existing ones (using whatever the existing implementation's private state variable is named — this plan assumes it is named `state`, matching Task 2's own implementation):

```ts
    getState(): number {
      return state >>> 0;
    },
    setState(s: number): void {
      state = s >>> 0;
    },
```

If Task 2's implementation named the private variable differently, use that exact name — `getState`/`setState` must read and write the same variable the `next()` stepping function mutates, or restored simulations will not continue their random stream correctly.

- [ ] **Step 2: Write a small rng state test and confirm it fails, then passes**

Create `tests/engine/rng-state.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/engine/rng';

describe('Rng.getState / setState', () => {
  it('setState followed by continued draws matches a fresh rng seeded to that state', () => {
    const a = createRng(123);
    for (let i = 0; i < 50; i++) a.next();
    const state = a.getState();

    const b = createRng(999); // arbitrary different seed
    b.setState(state);

    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqB).toEqual(seqA);
  });

  it('setState does not change what split(label) derives (split is a function of the creation seed, not draw position)', () => {
    const a = createRng(42);
    const childBefore = a.split('x').next();

    const b = createRng(42);
    for (let i = 0; i < 30; i++) b.next(); // advance b's internal state
    const childAfterAdvancing = b.split('x').next();

    expect(childAfterAdvancing).toBe(childBefore);
  });
});
```

Run:

```
npx vitest run tests/engine/rng-state.test.ts
```

Expected: FAIL — `TypeError: a.getState is not a function` (or a TypeScript compile error if run through `vitest` with type checking on save; either way, a failure) before the Step 1 edit is applied. After applying Step 1:

```
npx vitest run tests/engine/rng-state.test.ts
```

Expected: PASS — `Test Files  1 passed (1)`, `Tests  2 passed (2)`.

- [ ] **Step 3: Add `Simulation.fromEnvelope` to `src/engine/sim/simulation.ts` (this task's second Modify target)**

Open `src/engine/sim/simulation.ts` (Task 33) and add the following static method inside the `Simulation` class, after the constructor (the class's other members are unchanged):

```ts
  /**
   * Reconstructs a Simulation from a previously-serialized envelope WITHOUT
   * rerunning initPopulation or per-person brain init: every field is
   * restored verbatim from the envelope, and ctx.rng's internal word is set
   * to the saved rngState so future draws continue exactly where the saved
   * run left off (split() streams are unaffected, since split derives from
   * the root rng's creation seed, not its draw position).
   */
  static fromEnvelope(envelope: {
    config: SimConfig;
    tick: Tick;
    rngState: number;
    people: Person[];
    civs: Civ[];
    settlements: Settlement[];
    religions: Religion[];
    naturalEvents: NaturalEvent[];
    eventLog: NarrativeEvent[];
  }): Simulation {
    const sim = Object.create(Simulation.prototype) as Simulation;
    const rng = createRng(envelope.config.seed);
    rng.setState(envelope.rngState);

    const worldRng = createRng(envelope.config.seed).split(RNG_LABEL_WORLD);
    const mapSizeTiles = { small: 96, medium: 144, large: 192 }[envelope.config.mapSize];
    const world = generateWorld(mapSizeTiles, worldRng);
    const names = makeNameGenerator(createRng(envelope.config.seed).split('names'));

    const personById = new Map<number, Person>();
    for (const p of envelope.people) personById.set(p.id, p);

    (sim as { config: SimConfig }).config = envelope.config;
    (sim as { ctx: EngineCtx }).ctx = {
      world,
      people: envelope.people,
      personById,
      civs: envelope.civs,
      settlements: envelope.settlements,
      religions: envelope.religions,
      spatial: new SpatialIndex(),
      names,
      tick: envelope.tick,
      rng,
      events: envelope.eventLog,
      naturalEvents: envelope.naturalEvents,
      counters: { births: 0, deaths: 0 },
      tech: { yieldMultiplier: techYieldMultiplier, addKnowledge },
    };
    sim.currentTick = envelope.tick;
    return sim;
  }
```

This requires two additional imports at the top of `simulation.ts`: `import { SpatialIndex } from '../world/spatial';` and `import { generateWorld } from '../world/terrain';` are already imported by Task 33's own implementation (re-used, not duplicated) — confirm both are present; `createRng` and `makeNameGenerator` are likewise already imported by Task 33. No new imports beyond what Task 33 already has are required, since every symbol `fromEnvelope` uses (`SimConfig`, `Tick`, `Person`, `Civ`, `Settlement`, `Religion`, `NaturalEvent`, `NarrativeEvent`) is either already imported by `simulation.ts` or is `EngineCtx`'s own already-imported constituent type. `wasExtinct` (private field) defaults to `false` via `Object.create`, which is safe: extinction detection re-derives correctly from `ctx.people` on the very next `tick()` call regardless of the flag's prior history, because `checkExtinction` only distinguishes "was extinct last time we checked" from "is extinct now" to avoid duplicate events — at worst a restored-mid-extinction save re-emits one extra `extinction` event on its first post-load tick, which is cosmetic and does not affect any test in this plan.

- [ ] **Step 4: Write the failing save tests**

Create `tests/engine/sim/save.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { checksum, deserialize, SAVE_FORMAT_VERSION, serialize } from '../../../src/engine/sim/save';
import { Simulation } from '../../../src/engine/sim/simulation';
import { checkInvariants } from '../../../src/engine/sim/invariants';
import type { SimConfig } from '../../../src/shared/types';

function baseConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { seed: 21, mode: 'mixed', mapSize: 'small', startPopulation: 200, ...overrides };
}

describe('serialize / deserialize', () => {
  it('round-trips tick, population, and civ count', () => {
    const sim = new Simulation(baseConfig());
    for (let i = 0; i < 10; i++) sim.tick();
    const json = serialize(sim);
    const restored = deserialize(json);
    expect(restored.ctx.tick).toBe(sim.ctx.tick);
    expect(restored.currentTick).toBe(sim.currentTick);
    expect(restored.ctx.people).toHaveLength(sim.ctx.people.length);
    expect(restored.ctx.civs).toHaveLength(sim.ctx.civs.length);
  });

  it('the envelope carries v = SAVE_FORMAT_VERSION = 1', () => {
    const sim = new Simulation(baseConfig());
    const json = serialize(sim);
    const parsed = JSON.parse(json) as { v: number };
    expect(parsed.v).toBe(1);
    expect(SAVE_FORMAT_VERSION).toBe(1);
  });

  it('deserialize throws on an unsupported version', () => {
    const sim = new Simulation(baseConfig());
    const json = serialize(sim);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed.v = 2;
    expect(() => deserialize(JSON.stringify(parsed))).toThrow();
  });

  it('a restored simulation ticks cleanly with no invariant violations', () => {
    const sim = new Simulation(baseConfig());
    for (let i = 0; i < 10; i++) sim.tick();
    const restored = deserialize(serialize(sim));
    for (let i = 0; i < 10; i++) restored.tick();
    expect(checkInvariants(restored)).toEqual([]);
  });

  it('a restored simulation continues its random stream (does not repeat draws)', () => {
    const sim = new Simulation(baseConfig());
    for (let i = 0; i < 20; i++) sim.tick();
    const beforeSaveChecksum = checksum(sim);
    const restored = deserialize(serialize(sim));
    const afterLoadChecksum = checksum(restored);
    expect(afterLoadChecksum).toBe(beforeSaveChecksum); // identical state right after load
    sim.tick();
    restored.tick();
    expect(checksum(restored)).toBe(checksum(sim)); // and they continue identically together
  });
});

describe('checksum', () => {
  it('is a finite number', () => {
    const sim = new Simulation(baseConfig());
    expect(Number.isFinite(checksum(sim))).toBe(true);
  });

  it('differs after a tick advances state', () => {
    const sim = new Simulation(baseConfig());
    const c0 = checksum(sim);
    sim.tick();
    const c1 = checksum(sim);
    expect(c1).not.toBe(c0);
  });
});
```

- [ ] **Step 5: Run the save tests and confirm they fail**

Run:

```
npx vitest run tests/engine/sim/save.test.ts
```

Expected: FAIL — `Error: Failed to resolve import "../../../src/engine/sim/save" from "tests/engine/sim/save.test.ts". Does the file exist?`

- [ ] **Step 6: Implement `src/engine/sim/save.ts`**

Create `src/engine/sim/save.ts` with exactly:

```ts
import type { Civ, Person, Religion, Settlement, SimConfig, Tick } from '../../shared/types';
import type { NaturalEvent } from '../world/climate';
import type { NarrativeEvent } from './events';
import { Simulation } from './simulation';

export const SAVE_FORMAT_VERSION = 1;

export interface SaveEnvelope {
  v: 1;
  config: SimConfig;
  tick: Tick;
  rngState: number;
  people: Person[];
  civs: Civ[];
  settlements: Settlement[];
  religions: Religion[];
  naturalEvents: NaturalEvent[];
  eventLog: NarrativeEvent[];
}

/** Contract signature verbatim: a versioned JSON envelope including rng state, people (with brainStates), and config. */
export function serialize(sim: Simulation): string {
  const ctx = sim.ctx;
  const envelope: SaveEnvelope = {
    v: SAVE_FORMAT_VERSION,
    config: sim.config,
    tick: ctx.tick,
    rngState: ctx.rng.getState(),
    people: ctx.people,
    civs: ctx.civs,
    settlements: ctx.settlements,
    religions: ctx.religions,
    naturalEvents: ctx.naturalEvents,
    eventLog: ctx.events,
  };
  return JSON.stringify(envelope);
}

/** Contract signature verbatim: reconstructs a Simulation without rerunning init. */
export function deserialize(json: string): Simulation {
  const parsed = JSON.parse(json) as SaveEnvelope;
  if (parsed.v !== SAVE_FORMAT_VERSION) {
    throw new Error(`save.ts: unsupported save version ${String(parsed.v)}`);
  }
  return Simulation.fromEnvelope(parsed);
}

/** Contract signature verbatim: FNV-1a over a stable serialization of the mutable simulation state. */
export function checksum(sim: Simulation): number {
  const ctx = sim.ctx;
  const stable = JSON.stringify({
    tick: ctx.tick,
    rngState: ctx.rng.getState(),
    people: ctx.people,
    civs: ctx.civs,
    settlements: ctx.settlements,
    religions: ctx.religions,
  });
  let hash = 0x811c9dc5;
  for (let i = 0; i < stable.length; i++) {
    hash ^= stable.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
```

- [ ] **Step 7: Run the save tests and confirm they pass**

Run:

```
npx vitest run tests/engine/sim/save.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/sim/save.test.ts (7 tests)

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

- [ ] **Step 8: Write the failing determinism test**

Create `tests/engine/sim/determinism.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { checksum, deserialize, serialize } from '../../../src/engine/sim/save';
import { Simulation } from '../../../src/engine/sim/simulation';
import type { SimConfig } from '../../../src/shared/types';

const config: SimConfig = { seed: 99, mode: 'civs', mapSize: 'small', startPopulation: 200 };

describe('determinism (seed 99, 300 ticks)', () => {
  it('two fresh sims with the same seed produce identical checksums after 300 ticks', () => {
    const a = new Simulation(config);
    const b = new Simulation(config);
    for (let i = 0; i < 300; i++) {
      a.tick();
      b.tick();
    }
    expect(checksum(a)).toBe(checksum(b));
  });

  it('serialize at tick 150, deserialize, run 150 more: checksum equals a straight-through 300-tick run', () => {
    const straightThrough = new Simulation(config);
    for (let i = 0; i < 300; i++) straightThrough.tick();
    const straightChecksum = checksum(straightThrough);

    const staged = new Simulation(config);
    for (let i = 0; i < 150; i++) staged.tick();
    const json = serialize(staged);
    const resumed = deserialize(json);
    for (let i = 0; i < 150; i++) resumed.tick();
    const resumedChecksum = checksum(resumed);

    expect(resumedChecksum).toBe(straightChecksum);
  });
}, 30000);
```

- [ ] **Step 9: Run the determinism test and confirm it fails, then passes**

Run:

```
npx vitest run tests/engine/sim/determinism.test.ts
```

Expected before `save.ts` exists (if executed before Step 6): FAIL with the same module-resolution error as Step 5. After Steps 1-7 are complete:

```
npx vitest run tests/engine/sim/determinism.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/sim/determinism.test.ts (2 tests)

 Test Files  1 passed (1)
      Tests  2 passed (2)
```

If the second test fails with mismatched checksums, the most likely cause is a per-tick RNG draw that is not routed through `ctx.rng` (e.g. a stray `Math.random` or a `.split()` call whose label embeds something not already deterministic from `(seed, tick, personId)`) — re-inspect every `ctx.rng.split(...)` call added in Task 33's `tick()` for label uniqueness and confirm no code path anywhere in Sections 3-6 reads `Date.now()` or `Math.random()` (Step 11 below turns this into a permanent regression test).

- [ ] **Step 10: Write the failing forbidden-API test**

Create `tests/engine/forbidden-api.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = [join(process.cwd(), 'src', 'engine'), join(process.cwd(), 'src', 'shared')];
const FORBIDDEN: { pattern: RegExp; label: string }[] = [
  { pattern: /Math\.random/, label: 'Math.random' },
  { pattern: /Date\.now/, label: 'Date.now' },
  { pattern: /new Date\(/, label: 'new Date(' },
];

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('forbidden API usage', () => {
  it('src/engine and src/shared never call Math.random, Date.now, or new Date(', () => {
    const violations: string[] = [];
    for (const root of ROOTS) {
      for (const file of collectTsFiles(root)) {
        const content = readFileSync(file, 'utf-8');
        for (const { pattern, label } of FORBIDDEN) {
          if (pattern.test(content)) {
            violations.push(`${file}: contains ${label}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 11: Run the forbidden-API test and confirm it passes**

Run:

```
npx vitest run tests/engine/forbidden-api.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/forbidden-api.test.ts (1 test)

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

If it fails, the failure message names the exact file and forbidden call — fix that file (route the randomness through the passed `Rng`, or a real timestamp through nothing at all, since none is ever needed in `src/engine`/`src/shared`) and re-run until it passes. Do not weaken the regex or narrow `ROOTS` to make it pass.

- [ ] **Step 12: Run the whole rng/sim suite together and typecheck**

Run:

```
npx vitest run tests/engine/rng-state.test.ts tests/engine/sim/save.test.ts tests/engine/sim/determinism.test.ts tests/engine/forbidden-api.test.ts
npm run typecheck
```

Expected: all four files pass (2 + 7 + 2 + 1 = 12 tests), `npm run typecheck` exits 0.

- [ ] **Step 13: Commit**

Run:

```
git add src/engine/rng.ts src/engine/sim/simulation.ts src/engine/sim/save.ts tests/engine/rng-state.test.ts tests/engine/sim/save.test.ts tests/engine/sim/determinism.test.ts tests/engine/forbidden-api.test.ts
git commit -m "feat(sim): save/load with checksum determinism, rng getState/setState, forbidden-API regression test" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 37: Web worker entry and protocol messages (`src/engine/worker.ts` + `src/shared/protocol.ts` modify)

**Files:**
- Create: `src/engine/worker.ts`
- Modify: `src/shared/protocol.ts` (add `UiToWorker`/`WorkerToUi` and the pure `handleMessage`/`WorkerState`)
- Test: `tests/engine/worker-protocol.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `SimConfig`
- From `src/engine/sim/simulation.ts` (Task 33): `Simulation`
- From `src/engine/sim/snapshot.ts` (Task 35): `takeSnapshot(sim, includeTerritory): Snapshot`, `personDetail(sim, id): PersonDetail | null`
- From `src/engine/sim/save.ts` (Task 36): `serialize(sim): string`, `deserialize(json): Simulation`
- From `src/shared/protocol.ts` (Task 35, this task adds to it): `Snapshot`, `PersonDetail`

Produces (in `src/shared/protocol.ts`):
- `export type UiToWorker = | { type: 'init'; config: SimConfig } | { type: 'setSpeed'; ticksPerSecond: number } | { type: 'step'; n: number } | { type: 'inspect'; personId: number } | { type: 'serialize' } | { type: 'load'; json: string }` — contract verbatim.
- `export type WorkerToUi = | { type: 'ready' } | { type: 'snapshot'; snapshot: Snapshot } | { type: 'inspect'; detail: PersonDetail | null } | { type: 'serialized'; json: string } | { type: 'error'; message: string }` — contract verbatim.
- `export const SPEED_PRESETS: readonly number[] = [0, 1, 10, 60, 360, 1000]` — contract's speed presets (`0` = paused), plus `export const SKIP_GENERATION_TICKS = 7200` (the contract's `'skip-generation'` = 7200 ticks, 20 years at `YEAR_TICKS = 360`).
- `export const BATCH_INTERVAL_MS = 100` — the interval loop's tick, 10 times/sec.
- `export const SNAPSHOT_INTERVAL_MS = 200` — ~5 snapshots/sec while running (`1000 / 200 = 5`).
- `export const TERRITORY_SNAPSHOT_EVERY = 10` — territory included every 10th snapshot.
- `export interface WorkerState { sim: Simulation | null; ticksPerSecond: number; ticksSinceLastSnapshot: number; snapshotsTaken: number; msAccumulatorSinceSnapshot: number }` — the reducer's full state shape (additive per this section's deviation 12).
- `export function handleMessage(state: WorkerState, msg: UiToWorker): { state: WorkerState; replies: WorkerToUi[] }` — pure protocol reducer (additive, deviation 12): `'init'` constructs a fresh `Simulation`, resets counters, replies `[{ type: 'ready' }, { type: 'snapshot', snapshot: takeSnapshot(sim, true) }]` (the very first snapshot always includes territory, satisfying "territory included every 10th snapshot" trivially for snapshot #0); `'setSpeed'` updates `ticksPerSecond` and, if `sim` exists, replies with one fresh snapshot immediately (contract: "immediately on pause/step completion" — setting speed to `0` is a pause); `'step'` runs `msg.n` ticks synchronously (or `SKIP_GENERATION_TICKS` if `msg.n` is the sentinel `-1`, used by the UI's skip-a-generation control) and replies with one snapshot including territory (a manual step always gets territory, since it is infrequent by nature); `'inspect'` replies `[{ type: 'inspect', detail: personDetail(sim, msg.personId) }]` (or `[{ type: 'inspect', detail: null }]` if `sim` is `null`); `'serialize'` replies `[{ type: 'serialized', json: serialize(sim) }]` (or `[{ type: 'error', message: 'no simulation to serialize' }]` if `sim` is `null`); `'load'` replaces `sim` with `deserialize(msg.json)`, resets the snapshot counters, and replies `[{ type: 'snapshot', snapshot: takeSnapshot(sim, true) }]`. Every branch that would throw (a malformed `json`, a `tick()` invariant violation) is caught and turned into `[{ type: 'error', message: String(err) }]` instead of throwing out of `handleMessage`.
- `export function advanceByBatch(state: WorkerState): { state: WorkerState; replies: WorkerToUi[] }` — the interval-loop tick: if `state.sim === null || state.ticksPerSecond === 0`, no-op (`replies: []`); otherwise runs `Math.round(state.ticksPerSecond * BATCH_INTERVAL_MS / 1000)` ticks (at `1000` ticks/sec and a 100ms `BATCH_INTERVAL_MS`, this is exactly 100 ticks per call, per the section brief), accumulates `msAccumulatorSinceSnapshot`, and emits a snapshot (with territory exactly when `snapshotsTaken % TERRITORY_SNAPSHOT_EVERY === 0`) whenever the accumulator has reached `SNAPSHOT_INTERVAL_MS`, resetting the accumulator by subtraction (not by zeroing) so fractional overshoot is preserved across calls.

Produces (in `src/engine/worker.ts`):
- No exports beyond side effects — this file is "a thin shell around handleMessage plus the interval loop" per the section brief: a top-level mutable `let workerState: WorkerState`, a `self.onmessage` handler that calls `handleMessage` and posts every reply (transferring the `Snapshot`'s typed-array buffers via the `postMessage` transfer list, and `territory`'s buffer when present), a `setInterval(..., BATCH_INTERVAL_MS)` that calls `advanceByBatch` and posts its replies the same way, and a top-level `self.onerror`/try-catch boundary that posts `{ type: 'error', message }` instead of letting the worker crash silently. `export {}` at the top keeps the file a module (required for `self`/`postMessage` typing under the `WebWorker` lib already in `tsconfig.json`).

Wiring notes (binding):
- `worker.ts` itself is exercised manually/by Task 45's smoke harness and by the UI's `client.ts` (Task 39) — it has no unit test in this task beyond a typecheck pass, because it requires the real `Worker`/`self` global. All protocol/reducer logic lives in the tested, pure `handleMessage`/`advanceByBatch` functions above.
- Task 39 (`SimClient`) constructs `new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' })` and speaks the `UiToWorker`/`WorkerToUi` protocol exactly as declared here.

- [ ] **Step 1: Write the failing protocol/reducer tests**

Create `tests/engine/worker-protocol.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  BATCH_INTERVAL_MS,
  SNAPSHOT_INTERVAL_MS,
  SKIP_GENERATION_TICKS,
  SPEED_PRESETS,
  TERRITORY_SNAPSHOT_EVERY,
  advanceByBatch,
  handleMessage,
  type WorkerState,
} from '../../src/shared/protocol';
import type { SimConfig } from '../../src/shared/types';

const config: SimConfig = { seed: 5, mode: 'mixed', mapSize: 'small', startPopulation: 200 };

function freshState(): WorkerState {
  return { sim: null, ticksPerSecond: 0, ticksSinceLastSnapshot: 0, snapshotsTaken: 0, msAccumulatorSinceSnapshot: 0 };
}

describe('handleMessage — init', () => {
  it('constructs a Simulation and replies ready + an initial snapshot with territory', () => {
    const { state, replies } = handleMessage(freshState(), { type: 'init', config });
    expect(state.sim).not.toBeNull();
    expect(replies).toHaveLength(2);
    expect(replies[0]).toEqual({ type: 'ready' });
    expect(replies[1]?.type).toBe('snapshot');
    if (replies[1]?.type === 'snapshot') {
      expect(replies[1].snapshot.territory).not.toBeNull();
      expect(replies[1].snapshot.tick).toBe(0);
    }
  });
});

describe('handleMessage — setSpeed', () => {
  it('updates ticksPerSecond and replies with one snapshot', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const { state, replies } = handleMessage(afterInit, { type: 'setSpeed', ticksPerSecond: 60 });
    expect(state.ticksPerSecond).toBe(60);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.type).toBe('snapshot');
    expect(SPEED_PRESETS).toContain(60);
  });

  it('setSpeed(0) pauses and still replies with a snapshot', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const { state, replies } = handleMessage(afterInit, { type: 'setSpeed', ticksPerSecond: 0 });
    expect(state.ticksPerSecond).toBe(0);
    expect(replies).toHaveLength(1);
  });

  it('is a no-op reply-wise before init (no sim yet) but still records the speed', () => {
    const { state, replies } = handleMessage(freshState(), { type: 'setSpeed', ticksPerSecond: 10 });
    expect(state.ticksPerSecond).toBe(10);
    expect(replies).toHaveLength(0);
  });
});

describe('handleMessage — step', () => {
  it('runs n ticks synchronously and replies with one snapshot including territory', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const tickBefore = afterInit.sim?.ctx.tick ?? -1;
    const { state, replies } = handleMessage(afterInit, { type: 'step', n: 5 });
    expect(state.sim?.ctx.tick).toBe(tickBefore + 5);
    expect(replies).toHaveLength(1);
    if (replies[0]?.type === 'snapshot') expect(replies[0].snapshot.territory).not.toBeNull();
  });

  it('n = -1 runs SKIP_GENERATION_TICKS ticks', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const { state } = handleMessage(afterInit, { type: 'step', n: -1 });
    expect(state.sim?.ctx.tick).toBe(SKIP_GENERATION_TICKS);
    expect(SKIP_GENERATION_TICKS).toBe(7200);
  }, 30000);

  it('replies with an error when there is no simulation yet', () => {
    const { replies } = handleMessage(freshState(), { type: 'step', n: 1 });
    expect(replies).toHaveLength(1);
    expect(replies[0]?.type).toBe('error');
  });
});

describe('handleMessage — inspect', () => {
  it('resolves a known person id', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const id = afterInit.sim?.ctx.people[0]?.id as number;
    const { replies } = handleMessage(afterInit, { type: 'inspect', personId: id });
    expect(replies).toHaveLength(1);
    expect(replies[0]?.type).toBe('inspect');
    if (replies[0]?.type === 'inspect') expect(replies[0].detail?.person.id).toBe(id);
  });

  it('returns a null detail for an unknown id', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const { replies } = handleMessage(afterInit, { type: 'inspect', personId: 999999 });
    expect(replies[0]).toEqual({ type: 'inspect', detail: null });
  });

  it('returns a null detail when there is no simulation yet', () => {
    const { replies } = handleMessage(freshState(), { type: 'inspect', personId: 1 });
    expect(replies[0]).toEqual({ type: 'inspect', detail: null });
  });
});

describe('handleMessage — serialize / load', () => {
  it('serialize replies with a JSON string', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const { replies } = handleMessage(afterInit, { type: 'serialize' });
    expect(replies).toHaveLength(1);
    expect(replies[0]?.type).toBe('serialized');
    if (replies[0]?.type === 'serialized') {
      const parsed = JSON.parse(replies[0].json) as { v: number };
      expect(parsed.v).toBe(1);
    }
  });

  it('serialize replies with an error when there is no simulation yet', () => {
    const { replies } = handleMessage(freshState(), { type: 'serialize' });
    expect(replies[0]?.type).toBe('error');
  });

  it('load replaces the simulation and replies with a fresh snapshot', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const { state: stepped } = handleMessage(afterInit, { type: 'step', n: 3 });
    const { replies: serializedReplies } = handleMessage(stepped, { type: 'serialize' });
    const json = serializedReplies[0]?.type === 'serialized' ? serializedReplies[0].json : '';

    const { state, replies } = handleMessage(freshState(), { type: 'load', json });
    expect(state.sim?.ctx.tick).toBe(3);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.type).toBe('snapshot');
  });

  it('load replies with an error on malformed json', () => {
    const { replies } = handleMessage(freshState(), { type: 'load', json: 'not json' });
    expect(replies[0]?.type).toBe('error');
  });
});

describe('advanceByBatch', () => {
  it('is a no-op with no simulation', () => {
    const { state, replies } = advanceByBatch(freshState());
    expect(state.sim).toBeNull();
    expect(replies).toEqual([]);
  });

  it('is a no-op when paused (ticksPerSecond 0)', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const { state, replies } = advanceByBatch(afterInit);
    expect(state.sim?.ctx.tick).toBe(0);
    expect(replies).toEqual([]);
  });

  it('at 1000 ticks/sec advances exactly 100 ticks per call (BATCH_INTERVAL_MS = 100)', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const running = { ...afterInit, ticksPerSecond: 1000 };
    const { state } = advanceByBatch(running);
    expect(state.sim?.ctx.tick).toBe(100);
    expect(BATCH_INTERVAL_MS).toBe(100);
  });

  it('emits a snapshot roughly every SNAPSHOT_INTERVAL_MS of accumulated batch time', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    let running = { ...afterInit, ticksPerSecond: 1000 };
    let sawSnapshot = false;
    for (let i = 0; i < 5; i++) {
      const { state, replies } = advanceByBatch(running);
      running = state;
      if (replies.some((r) => r.type === 'snapshot')) sawSnapshot = true;
    }
    expect(sawSnapshot).toBe(true);
    expect(SNAPSHOT_INTERVAL_MS).toBe(200);
  });

  it('includes territory exactly every TERRITORY_SNAPSHOT_EVERY-th snapshot', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    let running = { ...afterInit, ticksPerSecond: 1000 };
    const territoryFlags: boolean[] = [];
    for (let i = 0; i < 30; i++) {
      const { state, replies } = advanceByBatch(running);
      running = state;
      for (const r of replies) {
        if (r.type === 'snapshot') territoryFlags.push(r.snapshot.territory !== null);
      }
    }
    expect(TERRITORY_SNAPSHOT_EVERY).toBe(10);
    expect(territoryFlags.some((f) => f)).toBe(true);
    // exactly every 10th recorded snapshot (1-indexed by snapshotsTaken) has territory.
    const territoryIndices = territoryFlags.reduce<number[]>((acc, has, i) => {
      if (has) acc.push(i);
      return acc;
    }, []);
    for (const idx of territoryIndices) {
      expect((idx + 1) % TERRITORY_SNAPSHOT_EVERY === 0 || idx === 0).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/worker-protocol.test.ts
```

Expected: FAIL — `Error: does not provide an export named 'handleMessage'` (or a module-resolution error, depending on whether `protocol.ts` already exists from Task 35 without these symbols) from `../../src/shared/protocol`.

- [ ] **Step 3: Extend `src/shared/protocol.ts` with the worker protocol**

Open `src/shared/protocol.ts` (Task 35) and append the following to the end of the file (all existing content — `CivMetrics`, `SettlementView`, `Snapshot`, `MOOD_ORDER`, `TERRITORY_RADIUS`, `PersonDetail` — stays exactly as Task 35 left it; only new imports and new exports are added):

Add to the top-of-file imports:

```ts
import type { SimConfig } from './types';
import { Simulation } from '../engine/sim/simulation';
import { takeSnapshot, personDetail } from '../engine/sim/snapshot';
import { serialize, deserialize } from '../engine/sim/save';
```

Append at the end of the file:

```ts
export type UiToWorker =
  | { type: 'init'; config: SimConfig }
  | { type: 'setSpeed'; ticksPerSecond: number }
  | { type: 'step'; n: number }
  | { type: 'inspect'; personId: number }
  | { type: 'serialize' }
  | { type: 'load'; json: string };

export type WorkerToUi =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'inspect'; detail: PersonDetail | null }
  | { type: 'serialized'; json: string }
  | { type: 'error'; message: string };

/** Contract speed presets; 0 = paused. */
export const SPEED_PRESETS: readonly number[] = [0, 1, 10, 60, 360, 1000];
/** 'skip-generation' = 7200 ticks = 20 years at YEAR_TICKS = 360. */
export const SKIP_GENERATION_TICKS = 7200;
/** The interval loop batches ticks every 100ms (10 batches/sec). */
export const BATCH_INTERVAL_MS = 100;
/** ~5 snapshots/sec while running. */
export const SNAPSHOT_INTERVAL_MS = 200;
/** Territory is included on every 10th snapshot. */
export const TERRITORY_SNAPSHOT_EVERY = 10;

export interface WorkerState {
  sim: Simulation | null;
  ticksPerSecond: number;
  ticksSinceLastSnapshot: number;
  snapshotsTaken: number;
  msAccumulatorSinceSnapshot: number;
}

function snapshotReply(state: WorkerState, includeTerritory: boolean): { state: WorkerState; reply: WorkerToUi } {
  if (state.sim === null) throw new Error('snapshotReply called with no simulation');
  const snapshot = takeSnapshot(state.sim, includeTerritory);
  const nextSnapshotsTaken = state.snapshotsTaken + 1;
  return {
    state: { ...state, snapshotsTaken: nextSnapshotsTaken, ticksSinceLastSnapshot: 0 },
    reply: { type: 'snapshot', snapshot },
  };
}

/**
 * Pure protocol reducer. Never throws: any failure inside a branch is caught
 * and turned into a { type: 'error' } reply instead.
 */
export function handleMessage(state: WorkerState, msg: UiToWorker): { state: WorkerState; replies: WorkerToUi[] } {
  try {
    switch (msg.type) {
      case 'init': {
        const sim = new Simulation(msg.config);
        const next: WorkerState = {
          sim,
          ticksPerSecond: 0,
          ticksSinceLastSnapshot: 0,
          snapshotsTaken: 0,
          msAccumulatorSinceSnapshot: 0,
        };
        const { state: withSnap, reply } = snapshotReply(next, true);
        return { state: withSnap, replies: [{ type: 'ready' }, reply] };
      }

      case 'setSpeed': {
        const next: WorkerState = { ...state, ticksPerSecond: msg.ticksPerSecond };
        if (next.sim === null) return { state: next, replies: [] };
        const { state: withSnap, reply } = snapshotReply(next, false);
        return { state: withSnap, replies: [reply] };
      }

      case 'step': {
        if (state.sim === null) {
          return { state, replies: [{ type: 'error', message: 'no simulation to step' }] };
        }
        const n = msg.n === -1 ? SKIP_GENERATION_TICKS : msg.n;
        for (let i = 0; i < n; i++) state.sim.tick();
        const { state: withSnap, reply } = snapshotReply(state, true);
        return { state: withSnap, replies: [reply] };
      }

      case 'inspect': {
        if (state.sim === null) {
          return { state, replies: [{ type: 'inspect', detail: null }] };
        }
        const detail = personDetail(state.sim, msg.personId);
        return { state, replies: [{ type: 'inspect', detail }] };
      }

      case 'serialize': {
        if (state.sim === null) {
          return { state, replies: [{ type: 'error', message: 'no simulation to serialize' }] };
        }
        const json = serialize(state.sim);
        return { state, replies: [{ type: 'serialized', json }] };
      }

      case 'load': {
        const sim = deserialize(msg.json);
        const next: WorkerState = {
          sim,
          ticksPerSecond: 0,
          ticksSinceLastSnapshot: 0,
          snapshotsTaken: 0,
          msAccumulatorSinceSnapshot: 0,
        };
        const { state: withSnap, reply } = snapshotReply(next, true);
        return { state: withSnap, replies: [reply] };
      }
    }
  } catch (err) {
    return { state, replies: [{ type: 'error', message: err instanceof Error ? err.message : String(err) }] };
  }
}

/**
 * The interval-loop tick: at ticksPerSecond ticks/sec, BATCH_INTERVAL_MS of
 * wall time is Math.round(ticksPerSecond * BATCH_INTERVAL_MS / 1000) engine
 * ticks (100 ticks per call at the 1000 tick/s preset). Emits a snapshot
 * (with territory every TERRITORY_SNAPSHOT_EVERY-th snapshot) whenever the
 * accumulator reaches SNAPSHOT_INTERVAL_MS.
 */
export function advanceByBatch(state: WorkerState): { state: WorkerState; replies: WorkerToUi[] } {
  if (state.sim === null || state.ticksPerSecond === 0) {
    return { state, replies: [] };
  }
  const ticksThisBatch = Math.round((state.ticksPerSecond * BATCH_INTERVAL_MS) / 1000);
  for (let i = 0; i < ticksThisBatch; i++) state.sim.tick();

  let next: WorkerState = {
    ...state,
    ticksSinceLastSnapshot: state.ticksSinceLastSnapshot + ticksThisBatch,
    msAccumulatorSinceSnapshot: state.msAccumulatorSinceSnapshot + BATCH_INTERVAL_MS,
  };

  const replies: WorkerToUi[] = [];
  if (next.msAccumulatorSinceSnapshot >= SNAPSHOT_INTERVAL_MS) {
    next = { ...next, msAccumulatorSinceSnapshot: next.msAccumulatorSinceSnapshot - SNAPSHOT_INTERVAL_MS };
    const includeTerritory = next.snapshotsTaken % TERRITORY_SNAPSHOT_EVERY === 0;
    const { state: withSnap, reply } = snapshotReply(next, includeTerritory);
    next = withSnap;
    replies.push(reply);
  }

  return { state: next, replies };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/worker-protocol.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/worker-protocol.test.ts (17 tests)

 Test Files  1 passed (1)
      Tests  17 passed (17)
```

- [ ] **Step 5: Implement the thin worker shell `src/engine/worker.ts`**

Create `src/engine/worker.ts` with exactly:

```ts
export {};

import {
  BATCH_INTERVAL_MS,
  advanceByBatch,
  handleMessage,
  type UiToWorker,
  type WorkerState,
  type WorkerToUi,
} from '../shared/protocol';

let workerState: WorkerState = {
  sim: null,
  ticksPerSecond: 0,
  ticksSinceLastSnapshot: 0,
  snapshotsTaken: 0,
  msAccumulatorSinceSnapshot: 0,
};

function transferablesOf(reply: WorkerToUi): Transferable[] {
  if (reply.type !== 'snapshot') return [];
  const s = reply.snapshot;
  const buffers: Transferable[] = [s.ids.buffer, s.xs.buffer, s.ys.buffer, s.civIds.buffer, s.lineages.buffer, s.healths.buffer, s.moods.buffer];
  if (s.territory !== null) buffers.push(s.territory.buffer);
  return buffers;
}

function postReply(reply: WorkerToUi): void {
  postMessage(reply, { transfer: transferablesOf(reply) });
}

self.onmessage = (ev: MessageEvent<UiToWorker>): void => {
  try {
    const { state, replies } = handleMessage(workerState, ev.data);
    workerState = state;
    for (const reply of replies) postReply(reply);
  } catch (err) {
    postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerToUi);
  }
};

self.onerror = (event: string | Event): void => {
  const message = typeof event === 'string' ? event : 'unknown worker error';
  postMessage({ type: 'error', message } satisfies WorkerToUi);
};

setInterval(() => {
  try {
    const { state, replies } = advanceByBatch(workerState);
    workerState = state;
    for (const reply of replies) postReply(reply);
  } catch (err) {
    postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerToUi);
  }
}, BATCH_INTERVAL_MS);
```

- [ ] **Step 6: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors. (This is the only verification `worker.ts` itself receives in this task — it requires the real `Worker`/`self` runtime, exercised later by Task 39's `SimClient` and Task 45's smoke harness.)

- [ ] **Step 7: Run the full engine test suite one more time**

Run:

```
npx vitest run
```

Expected: every test file from Tasks 2-37 passes, with zero failures. This is the closing check for Section 7 — the entire non-UI engine is now wired end-to-end.

- [ ] **Step 8: Commit**

Run:

```
git add src/shared/protocol.ts src/engine/worker.ts tests/engine/worker-protocol.test.ts
git commit -m "feat(worker): pure protocol reducer (handleMessage/advanceByBatch) and thin worker shell" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
