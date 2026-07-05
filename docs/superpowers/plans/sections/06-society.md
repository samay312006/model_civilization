## Section 6: Society (Tasks 26-32)

This section builds the seven civilization-dynamics modules under `src/engine/society/`: settlements, influence/leadership, culture drift and schism, technology, religion, economy, and conflict. Every module exports one or more pure-ish `update*(ctx)` functions that Task 33's `Simulation.tick()` calls in the fixed order documented in the contract (`updateSettlements`, `updateInfluence`, `shareWithin`, `tradeBetween`, `updateConflict`, `updateTechnology`, `spreadBeliefs`+`maybeFoundReligion`, `maybeSchism`). Each module declares its own minimal structural `*CtxLike` interface — the same pattern Section 3's agent modules used for `ActionsCtxLike`/`ExecuteCtxLike` — so the engineer authoring each task only needs the fields their file actually reads; the real Task 33 `EngineCtx` is a structural superset of every one of them, so `Simulation` passes its `ctx` object directly with no adapters anywhere. Task 26 additionally creates the shared test fixture `tests/helpers/testCtx.ts` (`makeTestCtx(overrides?)`), which Tasks 27-32 reuse and narrow to their own `*CtxLike` via TypeScript's structural typing — no per-task fixture duplication. Every module's constants are concrete numbers written directly into the code, per the section brief. All randomness inside every `update*` flows through `ctx.rng.split('<module-label>')` (a fresh deterministic child stream per module per tick) so that adding or removing a module never perturbs another module's random sequence. Every `update*` iterates its collections in ascending-id order for determinism. Every command below runs from the repo root `C:\simulation_exp`.

**Contract deviations in this section (recorded, deliberate):**

1. Per-file structural context interfaces instead of the Task 33 `EngineCtx` (same pattern as Section 3 and Section 4): `SettlementsCtxLike` (Task 26), `InfluenceCtxLike` (Task 27), `CultureCtxLike` (Task 28), `TechnologyCtxLike` (Task 29), `ReligionCtxLike` (Task 30), `EconomyCtxLike` (Task 31), `ConflictCtxLike` (Task 32) each declare only the fields that module reads or writes. `EngineCtx` (Task 33) is a structural superset of all seven, so `Simulation` passes its `ctx` object directly to every one with no adaptation.
2. `tests/helpers/testCtx.ts`'s `makeTestCtx(overrides?)` returns a concrete object typed as a broad `TestEngineCtx` (a hand-maintained structural superset of every `*CtxLike` in this section, itself a subset of the eventual `EngineCtx`). Because every `*CtxLike` in Tasks 26-32 is structurally satisfied by `TestEngineCtx`, every task's tests pass `makeTestCtx(...)` directly wherever its module's `*CtxLike` is expected — no casting, no per-task duplication of fixture-building code. Task 33 does not use `testCtx.ts` at all; it is a test-only helper.
3. Extension properties are used on `Person` (`p as Person & { ... }`) for two pieces of per-person state this section needs that are not in the frozen `Person` type: `settlementJoinedAtTick` (Task 28's schism-duration tracking) and `raidCooldownUntil` is NOT used — instead conflict tracks cooldown state on `Civ` via an extension property `_raidHistory` (Task 32). Both are plain JSON-serializable values (numbers / arrays of numbers), so `JSON.stringify` of a person or civ carries them for free (Task 36's `serialize`), and both default to `undefined`/absent with defined fallback behavior when absent, so no other task's fixtures need to set them. Task 32 additionally tracks alliances on `Civ` via an extension property `_alliedWith: number[]` (spec section 6's "alliances" requirement — the contract's frozen `Civ` type has no alliance field), populated and consumed entirely inside `conflict.ts` (`maybeFormAlliances`/`isAllied`); also JSON-serializable and absent-safe by the same rule.
4. `Religion.moralityBias` in the contract is `Partial<Morality>`; Task 30 additionally tracks per-person adoption via an extension property on `Person`, `_beliefZeal: Record<number, number>` (religion id -> local zeal contribution), used only internally by `religion.ts` to compute worship/shrine boosts without mutating the shared `Religion.zeal` field non-deterministically across persons in the same tick. This is additive and does not change any contract field.

### Task 26: Settlements (`src/engine/society/settlements.ts`) + test fixture helper (`tests/helpers/testCtx.ts`)

**Files:**
- Create: `src/engine/society/settlements.ts`
- Create: `tests/helpers/testCtx.ts`
- Test: `tests/engine/society/settlements.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Civ`, `Settlement`, `Inventory`, `Vec2`, `Tick`, `TechId`, `StructureKind`, `Terrain`, `dist(a: Vec2, b: Vec2): number`, `clamp01(v: number): number`
- From `src/engine/rng.ts` (Task 2): `Rng`; tests also use `createRng(seed: number): Rng`
- From `src/engine/world/terrain.ts` (Task 5): `World`, `isHabitable(terrain: Terrain): boolean` (Section 2/3 export this helper — a tile is habitable when `terrain === 'plains' || terrain === 'forest'`)
- From `src/engine/world/spatial.ts` (Task 7): `SpatialIndex { rebuild(people: Person[]): void; near(pos: Vec2, radius: number): number[] }`
- From `src/engine/names.ts` (Task 4): `NameGen { person(sex): string; place(): string; civ(): string; religion(): string }`; tests use `makeNameGenerator(rng: Rng): NameGen`
- Tests also use `createPerson` (Task 8, `src/engine/agents/person.ts`)

Produces:
- `export interface SettlementsCtxLike { world: World; people: Person[]; personById: Map<number, Person>; civs: Civ[]; settlements: Settlement[]; spatial: SpatialIndex; names: NameGen; tick: Tick; rng: Rng }` — deviation 1: structural subset of the eventual `EngineCtx`; Task 33 passes its `ctx` directly.
- `export function updateSettlements(ctx: SettlementsCtxLike): void` — the full contract behavior: forms new settlements from spatial clusters, assigns unsettled cluster members, applies overflow pressure, dissolves undersized settlements, redistributes stock on dissolution. Iterates `ctx.people` in ascending id order and `ctx.settlements` in ascending id order throughout.
- `export function settlementCapacity(s: Settlement, civ: Civ): number` — `10 + 8 * s.structures.shelter`, doubled (`* 2`) when `civ.techs.includes('construction')`.
- Exported tuning constants: `CLUSTER_MIN_MEMBERS = 5`, `CLUSTER_RADIUS = 3`, `DISSOLUTION_MIN_MEMBERS = 3`, `OVERFLOW_SAFETY_PRESSURE = 0.1`.
- `tests/helpers/testCtx.ts`: `export interface TestEngineCtx { world: World; people: Person[]; personById: Map<number, Person>; civs: Civ[]; settlements: Settlement[]; religions: Religion[]; spatial: SpatialIndex; names: NameGen; tick: Tick; rng: Rng; events: NarrativeEvent[]; naturalEvents: NaturalEvent[]; counters: { births: number; deaths: number } }` and `export function makeTestCtx(overrides?: Partial<TestEngineCtx>): TestEngineCtx` — builds a small generated world (`generateWorld(32, createRng(42))`), empty `people`/`settlements`/`religions`/`events`/`naturalEvents` arrays, a fresh `SpatialIndex`, `makeNameGenerator(createRng(42))`, `tick: 0`, `rng: createRng(42)`, and `counters: { births: 0, deaths: 0 }`, then shallow-merges `overrides` on top (arrays/objects in `overrides` fully replace the default, they are not deep-merged). `Religion` and `NarrativeEvent` are imported as `type`-only from `src/engine/sim/simulation.ts`/`src/engine/sim/events.ts`... **but those files do not exist until Task 33/34.** To avoid a forward dependency, `testCtx.ts` declares its own minimal structural copies `TestReligion` and `TestNarrativeEvent` (field-identical to the contract `Religion`/`NarrativeEvent`) and types the two array fields with them; every later section-6 task that only reads/writes `ctx.religions`/`ctx.events` through fields present in both shapes is unaffected, and Task 33 never imports `testCtx.ts` at all.

Wiring notes for Task 33 (binding):
- Task 33 tick step 5 calls `updateSettlements(ctx)` first among the society calls, exactly as ordered in the contract.
- Settlement member removal for the dead (deferred by Task 17's lifecycle module) is handled here: `updateSettlements` prunes `memberIds` down to living people at the start of its run, before clustering/dissolution logic.
- `settlementCapacity` is exported for Task 29 (`updateTechnology`) and Task 31/32 (`shareWithin`, `updateConflict`) to reuse verbatim rather than reimplementing the `10 + 8*shelter, x2 construction` formula.

- [ ] **Step 1: Write the shared test fixture helper**

Create `tests/helpers/testCtx.ts` with exactly:

```ts
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
```

- [ ] **Step 2: Write the failing settlements tests**

Create `tests/engine/society/settlements.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  CLUSTER_MIN_MEMBERS,
  CLUSTER_RADIUS,
  DISSOLUTION_MIN_MEMBERS,
  OVERFLOW_SAFETY_PRESSURE,
  settlementCapacity,
  updateSettlements,
} from '../../../src/engine/society/settlements';
import { createPerson } from '../../../src/engine/agents/person';
import { makeTestCiv, makeTestCtx, makeTestSettlement } from '../../helpers/testCtx';
import type { Person } from '../../../src/shared/types';

function makePerson(id: number, x: number, y: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, 0, 'fable', { x, y }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  return p;
}

describe('settlementCapacity', () => {
  it('is 10 + 8*shelter, x2 with construction tech', () => {
    const civ = makeTestCiv();
    const s = makeTestSettlement({ structures: { shelter: 2, granary: 0, wall: 0, shrine: 0 } });
    expect(settlementCapacity(s, civ)).toBe(10 + 8 * 2); // 26
    const civWithTech = makeTestCiv({ techs: ['construction'] });
    expect(settlementCapacity(s, civWithTech)).toBe((10 + 8 * 2) * 2); // 52
  });

  it('a settlement with no shelters still has base capacity 10', () => {
    const civ = makeTestCiv();
    const s = makeTestSettlement();
    expect(settlementCapacity(s, civ)).toBe(10);
  });
});

describe('updateSettlements — formation', () => {
  it('forms a settlement from >=5 alive people clustered within radius 3 on habitable land', () => {
    const ctx = makeTestCtx({ civs: [makeTestCiv()] });
    // Find a habitable non-water tile to center the cluster on.
    let cx = -1, cy = -1;
    for (let y = 0; y < ctx.world.size && cx === -1; y++) {
      for (let x = 0; x < ctx.world.size; x++) {
        if (ctx.world.tileAt(x, y).terrain !== 'water') { cx = x; cy = y; break; }
      }
    }
    const people = [
      makePerson(1, cx, cy, ctx),
      makePerson(2, cx + 1, cy, ctx),
      makePerson(3, cx, cy + 1, ctx),
      makePerson(4, cx - 1, cy, ctx),
      makePerson(5, cx, cy - 1, ctx),
    ];
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    expect(ctx.settlements).toHaveLength(1);
    expect(ctx.settlements[0]?.memberIds.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(ctx.settlements[0]?.civId).toBe(0);
    for (const p of people) {
      expect(p.settlementId).toBe(ctx.settlements[0]?.id);
    }
  });

  it('does not form a settlement with fewer than 5 alive people clustered', () => {
    const ctx = makeTestCtx({ civs: [makeTestCiv()] });
    let cx = -1, cy = -1;
    for (let y = 0; y < ctx.world.size && cx === -1; y++) {
      for (let x = 0; x < ctx.world.size; x++) {
        if (ctx.world.tileAt(x, y).terrain !== 'water') { cx = x; cy = y; break; }
      }
    }
    const people = [
      makePerson(1, cx, cy, ctx),
      makePerson(2, cx + 1, cy, ctx),
      makePerson(3, cx, cy + 1, ctx),
      makePerson(4, cx - 1, cy, ctx),
    ];
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    expect(ctx.settlements).toHaveLength(0); // NO-OP boundary case: below CLUSTER_MIN_MEMBERS
    for (const p of people) {
      expect(p.settlementId).toBeNull();
    }
    expect(CLUSTER_MIN_MEMBERS).toBe(5);
    expect(CLUSTER_RADIUS).toBe(3);
  });

  it('does not cluster people whose center tile is water', () => {
    const ctx = makeTestCtx({ civs: [makeTestCiv()] });
    let wx = -1, wy = -1;
    for (let y = 0; y < ctx.world.size && wx === -1; y++) {
      for (let x = 0; x < ctx.world.size; x++) {
        if (ctx.world.tileAt(x, y).terrain === 'water') { wx = x; wy = y; break; }
      }
    }
    if (wx === -1) return; // world guarantees >=30% habitable but not that water exists at every seed; skip defensively
    const people = [
      makePerson(1, wx, wy, ctx),
      makePerson(2, wx, wy, ctx),
      makePerson(3, wx, wy, ctx),
      makePerson(4, wx, wy, ctx),
      makePerson(5, wx, wy, ctx),
    ];
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    expect(ctx.settlements).toHaveLength(0);
  });
});

describe('updateSettlements — overflow pressure', () => {
  it('members beyond capacity get needs.safety +0.1/tick', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const memberIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // 12 members, capacity 10 (no shelters)
    const people: Person[] = memberIds.map((id) => makePerson(id, 10, 10, ctx));
    for (const p of people) p.needs.safety = 0;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds });
    for (const p of people) p.settlementId = 1;
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.settlements = [settlement];
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    // capacity 10, 12 members -> the 2 lowest-id-ranked overflow members get pressure.
    // Deterministic ascending-id iteration: members beyond the first `capacity` in
    // ascending id order are the ones over capacity.
    const overflow = memberIds.slice(10); // ids 11, 12
    for (const id of overflow) {
      const p = people.find((x) => x.id === id) as Person;
      expect(p.needs.safety).toBeCloseTo(OVERFLOW_SAFETY_PRESSURE, 6);
    }
    for (const id of memberIds.slice(0, 10)) {
      const p = people.find((x) => x.id === id) as Person;
      expect(p.needs.safety).toBe(0);
    }
  });

  it('no-op when membership is at or under capacity', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const memberIds = [1, 2, 3, 4, 5];
    const people: Person[] = memberIds.map((id) => makePerson(id, 10, 10, ctx));
    for (const p of people) { p.needs.safety = 0; p.settlementId = 1; }
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds });
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.settlements = [settlement];
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    for (const p of people) expect(p.needs.safety).toBe(0);
  });
});

describe('updateSettlements — dissolution', () => {
  it('dissolves a settlement with fewer than 3 members and returns stock evenly', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const memberIds = [1, 2];
    const people: Person[] = memberIds.map((id) => makePerson(id, 10, 10, ctx));
    for (const p of people) p.settlementId = 1;
    const settlement = makeTestSettlement({
      id: 1,
      civId: 0,
      memberIds,
      stock: { food: 10, wood: 6, stone: 4, metal: 0, tools: 0 },
    });
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.settlements = [settlement];
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    expect(ctx.settlements).toHaveLength(0);
    expect(DISSOLUTION_MIN_MEMBERS).toBe(3);
    for (const p of people) {
      expect(p.settlementId).toBeNull();
      expect(p.inventory.food).toBe(5); // 10 / 2
      expect(p.inventory.wood).toBe(3); // 6 / 2
      expect(p.inventory.stone).toBe(2); // 4 / 2
    }
  });

  it('a settlement with exactly 3 members is not dissolved (boundary)', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const memberIds = [1, 2, 3];
    const people: Person[] = memberIds.map((id) => makePerson(id, 10, 10, ctx));
    for (const p of people) p.settlementId = 1;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds });
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.settlements = [settlement];
    ctx.spatial.rebuild(people);

    updateSettlements(ctx);

    expect(ctx.settlements).toHaveLength(1); // NO-OP boundary: exactly DISSOLUTION_MIN_MEMBERS survives
  });

  it('prunes dead members from memberIds before evaluating dissolution', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const alive = [makePerson(1, 10, 10, ctx), makePerson(2, 10, 10, ctx)];
    const dead = makePerson(3, 10, 10, ctx);
    dead.alive = false;
    const people = [...alive, dead];
    for (const p of alive) p.settlementId = 1;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [1, 2, 3] });
    ctx.people = people;
    ctx.personById = new Map(people.map((p) => [p.id, p]));
    ctx.settlements = [settlement];
    ctx.spatial.rebuild(alive);

    updateSettlements(ctx);

    // 2 living members remain after pruning the dead id -> below DISSOLUTION_MIN_MEMBERS -> dissolves
    expect(ctx.settlements).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/society/settlements.test.ts
```

Expected: FAIL — module-resolution error such as `Error: Failed to resolve import "../../../src/engine/society/settlements" from "tests/engine/society/settlements.test.ts". Does the file exist?` (`src/engine/society/settlements.ts` does not exist yet).

- [ ] **Step 4: Implement `src/engine/society/settlements.ts`**

Create `src/engine/society/settlements.ts` with exactly:

```ts
import type { Civ, Person, Settlement, Terrain, Tick, Vec2 } from '../../shared/types';
import type { Rng } from '../rng';
import { isHabitable, type World } from '../world/terrain';
import type { SpatialIndex } from '../world/spatial';
import type { NameGen } from '../names';

/** Deviation 1: the minimal structural subset of the eventual EngineCtx settlements reads/writes. */
export interface SettlementsCtxLike {
  world: World;
  people: Person[];
  personById: Map<number, Person>;
  civs: Civ[];
  settlements: Settlement[];
  spatial: SpatialIndex;
  names: NameGen;
  tick: Tick;
  rng: Rng;
}

export const CLUSTER_MIN_MEMBERS = 5;
export const CLUSTER_RADIUS = 3;
export const DISSOLUTION_MIN_MEMBERS = 3;
export const OVERFLOW_SAFETY_PRESSURE = 0.1;

/** capacity = 10 + 8*shelters, doubled while the civ has active construction tech. */
export function settlementCapacity(s: Settlement, civ: Civ): number {
  const base = 10 + 8 * s.structures.shelter;
  return civ.techs.includes('construction') ? base * 2 : base;
}

function civOf(ctx: SettlementsCtxLike, civId: number): Civ | undefined {
  return ctx.civs.find((c) => c.id === civId);
}

function nextSettlementId(ctx: SettlementsCtxLike): number {
  let max = 0;
  for (const s of ctx.settlements) if (s.id > max) max = s.id;
  return max + 1;
}

/**
 * Full contract behavior, run once per tick (Simulation tick step 5, first
 * among the society calls):
 *   1. prune dead members out of every settlement's memberIds
 *   2. dissolve any settlement now under DISSOLUTION_MIN_MEMBERS, returning
 *      its stock evenly to its (former) members
 *   3. form new settlements from spatial clusters of >=5 unsettled alive
 *      people within CLUSTER_RADIUS of a habitable, non-water center
 *   4. apply overflow pressure: members beyond capacity (by ascending id)
 *      get needs.safety += OVERFLOW_SAFETY_PRESSURE this tick
 */
export function updateSettlements(ctx: SettlementsCtxLike): void {
  pruneDeadMembers(ctx);
  dissolveUndersized(ctx);
  formNewSettlements(ctx);
  applyOverflowPressure(ctx);
}

function pruneDeadMembers(ctx: SettlementsCtxLike): void {
  for (const s of ctx.settlements) {
    s.memberIds = s.memberIds.filter((id) => {
      const p = ctx.personById.get(id);
      return p !== undefined && p.alive;
    });
  }
}

function dissolveUndersized(ctx: SettlementsCtxLike): void {
  const surviving: Settlement[] = [];
  for (const s of [...ctx.settlements].sort((a, b) => a.id - b.id)) {
    if (s.memberIds.length >= DISSOLUTION_MIN_MEMBERS || s.memberIds.length === 0) {
      if (s.memberIds.length > 0) surviving.push(s);
      // a settlement that dropped to 0 members simply vanishes with no stock to return
      continue;
    }
    const members = s.memberIds
      .map((id) => ctx.personById.get(id))
      .filter((p): p is Person => p !== undefined && p.alive)
      .sort((a, b) => a.id - b.id);
    const n = members.length;
    if (n > 0) {
      const foodShare = s.stock.food / n;
      const woodShare = s.stock.wood / n;
      const stoneShare = s.stock.stone / n;
      const metalShare = s.stock.metal / n;
      const toolsShare = s.stock.tools / n;
      for (const p of members) {
        p.inventory.food += foodShare;
        p.inventory.wood += woodShare;
        p.inventory.stone += stoneShare;
        p.inventory.metal += metalShare;
        p.inventory.tools += toolsShare;
        p.settlementId = null;
      }
    }
  }
  // Mutate ctx.settlements in place (rather than reassigning the property) so
  // any other reference to the same array (e.g. a caller that captured it
  // before this call) observes the same final contents.
  ctx.settlements.length = 0;
  ctx.settlements.push(...surviving);
}

function formNewSettlements(ctx: SettlementsCtxLike): void {
  const unsettled = ctx.people
    .filter((p) => p.alive && p.settlementId === null)
    .sort((a, b) => a.id - b.id);
  const claimed = new Set<number>();

  for (const p of unsettled) {
    if (claimed.has(p.id)) continue;
    if (!isHabitable(ctx.world.tileAt(p.pos.x, p.pos.y).terrain)) continue;

    const nearbyIds = ctx.spatial
      .near(p.pos, CLUSTER_RADIUS)
      .filter((id) => !claimed.has(id))
      .map((id) => ctx.personById.get(id))
      .filter((q): q is Person => q !== undefined && q.alive && q.settlementId === null)
      .sort((a, b) => a.id - b.id);

    if (nearbyIds.length < CLUSTER_MIN_MEMBERS) continue;

    const center: Vec2 = { x: p.pos.x, y: p.pos.y };
    const id = nextSettlementId(ctx);
    const settlement: Settlement = {
      id,
      civId: p.civId,
      name: ctx.names.place(),
      center,
      memberIds: nearbyIds.map((q) => q.id),
      stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    };
    for (const q of nearbyIds) {
      q.settlementId = id;
      claimed.add(q.id);
    }
    ctx.settlements.push(settlement);
  }
}

function applyOverflowPressure(ctx: SettlementsCtxLike): void {
  for (const s of [...ctx.settlements].sort((a, b) => a.id - b.id)) {
    const civ = civOf(ctx, s.civId);
    if (civ === undefined) continue;
    const capacity = settlementCapacity(s, civ);
    const members = [...s.memberIds].sort((a, b) => a - b);
    if (members.length <= capacity) continue;
    const overflow = members.slice(capacity);
    for (const id of overflow) {
      const p = ctx.personById.get(id);
      if (p === undefined || !p.alive) continue;
      p.needs.safety = Math.min(1, p.needs.safety + OVERFLOW_SAFETY_PRESSURE);
    }
  }
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/society/settlements.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/society/settlements.test.ts (10 tests)

 Test Files  1 passed (1)
      Tests  10 passed (10)
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
git add src/engine/society/settlements.ts tests/helpers/testCtx.ts tests/engine/society/settlements.test.ts
git commit -m "feat(society): settlements - clustering, capacity, overflow pressure, dissolution" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 27: Influence and leadership (`src/engine/society/influence.ts`)

**Files:**
- Create: `src/engine/society/influence.ts`
- Test: `tests/engine/society/influence.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Settlement`, `Tick`, `SKILL_NAMES`, `clamp01(v): number`
- From `src/engine/rng.ts` (Task 2): `Rng`
- Tests also use `createPerson` (Task 8), `makeTestCtx`/`makeTestSettlement`/`makeTestCiv` (Task 26, `tests/helpers/testCtx.ts`)

Produces:
- `export interface InfluenceCtxLike { people: Person[]; personById: Map<number, Person>; settlements: Settlement[]; tick: Tick; rng: Rng }` — deviation 1.
- `export function updateInfluence(ctx: InfluenceCtxLike): void` — no-op unless `ctx.tick % INFLUENCE_RECOMPUTE_INTERVAL === 0` (30 ticks); when due, for every alive person computes a fresh raw influence score and blends it into the stored value with `INFLUENCE_DECAY` (0.98): `p.influence = clamp01(p.influence * INFLUENCE_DECAY + raw * (1 - INFLUENCE_DECAY))`.
- `export function computeRawInfluence(p: Person): number` — `clamp01(0.3 * clamp01(1 - p.needs.esteem) + 0.2 * avgSkill(p) + 0.3 * normalizedPositiveAffinity(p) + 0.2 * victoryMemoryScore(p))`, where `avgSkill(p)` is the mean of all 7 `SKILL_NAMES` values, `normalizedPositiveAffinity(p)` is the mean of positive-only relationship affinities (0 if none or none positive) clamped to `[0,1]`, and `victoryMemoryScore(p)` is the mean `salience` of memories with `kind === 'victory'` in `p.memory` (0 if none), clamped to `[0,1]`.
- `export function leaderOf(s: Settlement, ctx: InfluenceCtxLike): Person | null` — the living member of `s.memberIds` with the highest `influence` (ties broken by lowest id); `null` if the settlement has no living members.
- Exported tuning constants: `INFLUENCE_RECOMPUTE_INTERVAL = 30`, `INFLUENCE_DECAY = 0.98`.

Wiring notes for Task 33 (binding):
- Task 33 tick step 5 calls `updateInfluence(ctx)` immediately after `updateSettlements(ctx)`.
- `leaderOf` is exported for Tasks 28 (schism leader-influence gate), 30 (religion founder candidate pool), and 32 (raid-trigger leader aggression check) to reuse verbatim.

- [ ] **Step 1: Write the failing influence tests**

Create `tests/engine/society/influence.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  INFLUENCE_DECAY,
  INFLUENCE_RECOMPUTE_INTERVAL,
  computeRawInfluence,
  leaderOf,
  updateInfluence,
} from '../../../src/engine/society/influence';
import { createPerson } from '../../../src/engine/agents/person';
import { makeTestCtx, makeTestSettlement } from '../../helpers/testCtx';
import type { Person } from '../../../src/shared/types';

function makePerson(id: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, 0, 'fable', { x: 10, y: 10 }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  p.influence = 0;
  for (const k of ['farming', 'gathering', 'building', 'crafting', 'fighting', 'healing', 'teaching'] as const) {
    p.skills[k] = 0;
  }
  p.relationships = [];
  p.memory = [];
  p.needs.esteem = 0;
  return p;
}

describe('computeRawInfluence', () => {
  it('is 0 for a person with no esteem relief, no skills, no affinity, no victories', () => {
    const ctx = makeTestCtx();
    const p = makePerson(1, ctx);
    p.needs.esteem = 1; // max desperation -> 0 relief
    expect(computeRawInfluence(p)).toBe(0);
  });

  it('rewards low esteem need (relief), high skills, positive affinity, and victory memories', () => {
    const ctx = makeTestCtx();
    const p = makePerson(1, ctx);
    p.needs.esteem = 0; // full relief -> 0.3 * 1
    for (const k of ['farming', 'gathering', 'building', 'crafting', 'fighting', 'healing', 'teaching'] as const) {
      p.skills[k] = 1; // avgSkill 1 -> 0.2 * 1
    }
    p.relationships = [{ otherId: 2, kind: 'friend', affinity: 1 }]; // -> 0.3 * 1
    p.memory = [{ tick: 0, kind: 'victory', otherId: 2, valence: 1, salience: 1 }]; // -> 0.2 * 1
    expect(computeRawInfluence(p)).toBeCloseTo(1, 6);
  });

  it('ignores negative affinities in the positive-affinity average', () => {
    const ctx = makeTestCtx();
    const p = makePerson(1, ctx);
    p.relationships = [
      { otherId: 2, kind: 'rival', affinity: -1 },
      { otherId: 3, kind: 'friend', affinity: 0.6 },
    ];
    // Only the +0.6 relationship counts; average of positives = 0.6 -> 0.3*0.6 = 0.18
    expect(computeRawInfluence(p)).toBeCloseTo(0.18, 6);
  });
});

describe('updateInfluence', () => {
  it('recomputes and blends with 0.98 decay every 30 ticks', () => {
    const ctx = makeTestCtx({ tick: INFLUENCE_RECOMPUTE_INTERVAL });
    const p = makePerson(1, ctx);
    p.influence = 0.5;
    p.needs.esteem = 0;
    for (const k of ['farming', 'gathering', 'building', 'crafting', 'fighting', 'healing', 'teaching'] as const) {
      p.skills[k] = 1;
    }
    p.relationships = [{ otherId: 2, kind: 'friend', affinity: 1 }];
    p.memory = [{ tick: 0, kind: 'victory', otherId: 2, valence: 1, salience: 1 }];
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);

    updateInfluence(ctx);

    const raw = computeRawInfluence(p); // 1.0 per the case above
    const expected = 0.5 * INFLUENCE_DECAY + raw * (1 - INFLUENCE_DECAY);
    expect(p.influence).toBeCloseTo(expected, 6);
  });

  it('is a no-op off the 30-tick interval', () => {
    const ctx = makeTestCtx({ tick: INFLUENCE_RECOMPUTE_INTERVAL + 1 });
    const p = makePerson(1, ctx);
    p.influence = 0.42;
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);

    updateInfluence(ctx);

    expect(p.influence).toBe(0.42);
  });

  it('skips dead people', () => {
    const ctx = makeTestCtx({ tick: 0 });
    const p = makePerson(1, ctx);
    p.alive = false;
    p.influence = 0.7;
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);

    updateInfluence(ctx);

    expect(p.influence).toBe(0.7);
  });
});

describe('leaderOf', () => {
  it('returns the living member with the highest influence', () => {
    const ctx = makeTestCtx();
    const a = makePerson(1, ctx);
    const b = makePerson(2, ctx);
    const c = makePerson(3, ctx);
    a.influence = 0.4;
    b.influence = 0.9;
    c.influence = 0.6;
    ctx.people = [a, b, c];
    ctx.personById = new Map([[1, a], [2, b], [3, c]]);
    const s = makeTestSettlement({ memberIds: [1, 2, 3] });

    expect(leaderOf(s, ctx)?.id).toBe(2);
  });

  it('breaks ties by lowest id', () => {
    const ctx = makeTestCtx();
    const a = makePerson(1, ctx);
    const b = makePerson(2, ctx);
    a.influence = 0.5;
    b.influence = 0.5;
    ctx.people = [a, b];
    ctx.personById = new Map([[1, a], [2, b]]);
    const s = makeTestSettlement({ memberIds: [2, 1] });

    expect(leaderOf(s, ctx)?.id).toBe(1);
  });

  it('excludes dead members and returns null when none remain (no-op boundary)', () => {
    const ctx = makeTestCtx();
    const a = makePerson(1, ctx);
    a.alive = false;
    ctx.people = [a];
    ctx.personById = new Map([[1, a]]);
    const s = makeTestSettlement({ memberIds: [1] });

    expect(leaderOf(s, ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/society/influence.test.ts
```

Expected: FAIL — module-resolution error: `Failed to resolve import "../../../src/engine/society/influence"` (the file does not exist yet).

- [ ] **Step 3: Implement `src/engine/society/influence.ts`**

Create `src/engine/society/influence.ts` with exactly:

```ts
import { SKILL_NAMES, clamp01, type Person, type Settlement, type Tick } from '../../shared/types';
import type { Rng } from '../rng';

/** Deviation 1: the minimal structural subset of the eventual EngineCtx influence reads/writes. */
export interface InfluenceCtxLike {
  people: Person[];
  personById: Map<number, Person>;
  settlements: Settlement[];
  tick: Tick;
  rng: Rng;
}

export const INFLUENCE_RECOMPUTE_INTERVAL = 30;
export const INFLUENCE_DECAY = 0.98;

function avgSkill(p: Person): number {
  let sum = 0;
  for (const k of SKILL_NAMES) sum += p.skills[k];
  return sum / SKILL_NAMES.length;
}

function normalizedPositiveAffinity(p: Person): number {
  const positives = p.relationships.map((r) => r.affinity).filter((a) => a > 0);
  if (positives.length === 0) return 0;
  const mean = positives.reduce((a, b) => a + b, 0) / positives.length;
  return clamp01(mean);
}

function victoryMemoryScore(p: Person): number {
  const victories = p.memory.filter((m) => m.kind === 'victory');
  if (victories.length === 0) return 0;
  const mean = victories.reduce((a, m) => a + m.salience, 0) / victories.length;
  return clamp01(mean);
}

/**
 * Raw (unblended) influence score:
 *   0.3 * esteem-relief + 0.2 * avg skills + 0.3 * normalized positive
 *   affinities + 0.2 * victory memories
 * where esteem-relief = clamp01(1 - needs.esteem) (esteem need is 1 =
 * desperate, so relief is the inverse).
 */
export function computeRawInfluence(p: Person): number {
  const esteemRelief = clamp01(1 - p.needs.esteem);
  const raw =
    0.3 * esteemRelief +
    0.2 * avgSkill(p) +
    0.3 * normalizedPositiveAffinity(p) +
    0.2 * victoryMemoryScore(p);
  return clamp01(raw);
}

/**
 * Recomputed every 30 ticks with 0.98 decay blend toward the fresh raw
 * score. A no-op on ticks off the interval, and a no-op for dead people.
 */
export function updateInfluence(ctx: InfluenceCtxLike): void {
  if (ctx.tick % INFLUENCE_RECOMPUTE_INTERVAL !== 0) return;
  const people = [...ctx.people].sort((a, b) => a.id - b.id);
  for (const p of people) {
    if (!p.alive) continue;
    const raw = computeRawInfluence(p);
    p.influence = clamp01(p.influence * INFLUENCE_DECAY + raw * (1 - INFLUENCE_DECAY));
  }
}

/** The living settlement member with the highest influence; ties break to the lowest id. */
export function leaderOf(s: Settlement, ctx: InfluenceCtxLike): Person | null {
  let leader: Person | null = null;
  for (const id of [...s.memberIds].sort((a, b) => a - b)) {
    const p = ctx.personById.get(id);
    if (p === undefined || !p.alive) continue;
    if (leader === null || p.influence > leader.influence) leader = p;
  }
  return leader;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/society/influence.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/society/influence.test.ts (9 tests)

 Test Files  1 passed (1)
      Tests  9 passed (9)
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
git add src/engine/society/influence.ts tests/engine/society/influence.test.ts
git commit -m "feat(society): influence - recomputed leadership score with decay blend" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 28: Culture drift and schism (`src/engine/society/culture.ts`)

**Files:**
- Create: `src/engine/society/culture.ts`
- Test: `tests/engine/society/culture.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Civ`, `Settlement`, `Morality`, `Traits`, `Tick`
- From `src/engine/rng.ts` (Task 2): `Rng`
- From `src/engine/names.ts` (Task 4): `NameGen`
- From `src/engine/society/influence.ts` (Task 27): `leaderOf(s: Settlement, ctx): Person | null`, `InfluenceCtxLike`
- Tests also use `createPerson` (Task 8), `makeTestCtx`/`makeTestCiv`/`makeTestSettlement` (Task 26)

Produces:
- `export interface CultureVector { morality: Morality; traits: Traits }` — contract signature verbatim.
- `export interface CultureCtxLike { people: Person[]; personById: Map<number, Person>; civs: Civ[]; settlements: Settlement[]; names: NameGen; tick: Tick; rng: Rng }` — deviation 1; structurally a superset of `InfluenceCtxLike` so `leaderOf(s, ctx)` can be called with the same `ctx`.
- `export function civCulture(civId: number, ctx: CultureCtxLike): CultureVector` — the mean of `morality` and `traits` across all alive members of the civ (each of the 6 morality axes and 5 trait axes averaged independently); returns all-zero vectors if the civ has no living members.
- `export function settlementCulture(s: Settlement, ctx: CultureCtxLike): CultureVector` — same averaging, scoped to the settlement's living `memberIds`; all-zero if none.
- `export function cultureDistance(a: CultureVector, b: CultureVector): number` — normalized mean absolute difference across all 11 axes (6 morality + 5 traits): `sum(|a[k]-b[k]|) / 11`, which is in `[0, 1]` since every axis is itself in `[0, 1]`.
- `export function maybeSchism(ctx: CultureCtxLike): void` — for every settlement (ascending id) whose `settlementCulture` distance from its civ's `civCulture` exceeds `SCHISM_DISTANCE_THRESHOLD` (0.35): tracks consecutive-over-threshold duration via the extension property `_overThresholdSinceTick` on the `Settlement` object (deviation 3, applied to `Settlement` rather than `Person` here); once that duration reaches `SCHISM_DURATION_TICKS` (`2 * YEAR_TICKS` = 720 ticks) AND `leaderOf(settlement, ctx)` has `influence > SCHISM_LEADER_INFLUENCE` (0.6), the settlement secedes: a new `Civ` is created (`id = nextCivId`, `name = ctx.names.civ()`, `color = generatedColor(newId)`, fresh zeroed `knowledge`, empty `techs`/`atWarWith`, `warWeariness: 0`), every living settlement member's `civId` is reassigned to the new civ, the settlement's own `civId` updates to match, and the duration tracker resets to `undefined`. Settlements under the threshold have their duration tracker reset to `undefined` immediately (no partial credit).
- `export function generatedColor(civId: number): string` — `hsl((civId*137)%360, 70%, 55%)` exactly as specified.
- Exported constants: `SCHISM_DISTANCE_THRESHOLD = 0.35`, `SCHISM_DURATION_TICKS = 720` (2 years at `YEAR_TICKS = 360`), `SCHISM_LEADER_INFLUENCE = 0.6`.
- Note: `YEAR_TICKS` itself is not re-exported here; `SCHISM_DURATION_TICKS` is hard-coded to `720` with a comment, so this module has no import dependency on `src/shared/types.ts`'s `YEAR_TICKS` beyond what it already imports for other types (kept simple and explicit per the section brief's "concrete numbers" rule).

Wiring notes for Task 33 (binding):
- Task 33 tick step 5 calls `maybeSchism(ctx)` last among the society calls, after `updateTechnology`/`spreadBeliefs`/`maybeFoundReligion`, exactly as ordered in the contract.
- Task 34 (`events.ts`) narrates schisms; `maybeSchism` itself does not push events (this module has no `events` field in its `CultureCtxLike`) — Task 33's wiring is expected to detect the civ-count change (or Task 34 adds an optional `events` field via its own narrower ctx wrapper) and narrate severity 3, matching the contract's "emits event" note. This plan section defines the mechanics; Task 34 owns narration text.

- [ ] **Step 1: Write the failing culture tests**

Create `tests/engine/society/culture.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  SCHISM_DISTANCE_THRESHOLD,
  SCHISM_DURATION_TICKS,
  SCHISM_LEADER_INFLUENCE,
  civCulture,
  cultureDistance,
  generatedColor,
  maybeSchism,
  settlementCulture,
} from '../../../src/engine/society/culture';
import { createPerson } from '../../../src/engine/agents/person';
import { makeTestCiv, makeTestCtx, makeTestSettlement } from '../../helpers/testCtx';
import type { Morality, Person, Traits } from '../../../src/shared/types';

const ZERO_MORALITY: Morality = { care: 0, fairness: 0, loyalty: 0, authority: 0, sanctity: 0, liberty: 0 };
const ZERO_TRAITS: Traits = { curiosity: 0, aggression: 0, empathy: 0, industriousness: 0, riskTolerance: 0 };

function makePerson(id: number, civId: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, civId, 'fable', { x: 10, y: 10 }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  p.morality = { ...ZERO_MORALITY };
  p.traits = { ...ZERO_TRAITS };
  return p;
}

describe('civCulture / settlementCulture', () => {
  it('averages morality and traits across living civ members', () => {
    const ctx = makeTestCtx({ civs: [makeTestCiv()] });
    const a = makePerson(1, 0, ctx);
    a.morality.care = 1;
    a.traits.curiosity = 1;
    const b = makePerson(2, 0, ctx);
    b.morality.care = 0;
    b.traits.curiosity = 0;
    ctx.people = [a, b];
    ctx.personById = new Map([[1, a], [2, b]]);

    const culture = civCulture(0, ctx);
    expect(culture.morality.care).toBeCloseTo(0.5, 6);
    expect(culture.traits.curiosity).toBeCloseTo(0.5, 6);
  });

  it('returns all-zero vectors for a civ with no living members (no-op boundary)', () => {
    const ctx = makeTestCtx({ civs: [makeTestCiv()] });
    ctx.people = [];
    ctx.personById = new Map();
    const culture = civCulture(0, ctx);
    expect(culture.morality).toEqual(ZERO_MORALITY);
    expect(culture.traits).toEqual(ZERO_TRAITS);
  });

  it('settlementCulture scopes to the settlement membership only', () => {
    const ctx = makeTestCtx({ civs: [makeTestCiv()] });
    const a = makePerson(1, 0, ctx);
    a.morality.fairness = 1;
    const b = makePerson(2, 0, ctx);
    b.morality.fairness = 0; // not a member of the settlement
    ctx.people = [a, b];
    ctx.personById = new Map([[1, a], [2, b]]);
    const s = makeTestSettlement({ memberIds: [1] });

    const culture = settlementCulture(s, ctx);
    expect(culture.morality.fairness).toBe(1);
  });
});

describe('cultureDistance', () => {
  it('is 0 for identical vectors', () => {
    const v = { morality: { ...ZERO_MORALITY }, traits: { ...ZERO_TRAITS } };
    expect(cultureDistance(v, v)).toBe(0);
  });

  it('is the normalized mean absolute difference across all 11 axes', () => {
    const a = { morality: { ...ZERO_MORALITY, care: 1 }, traits: { ...ZERO_TRAITS } };
    const b = { morality: { ...ZERO_MORALITY }, traits: { ...ZERO_TRAITS } };
    // only 1 of 11 axes differs, by 1.0 -> 1/11
    expect(cultureDistance(a, b)).toBeCloseTo(1 / 11, 6);
  });

  it('is 1 when every axis is maximally opposed', () => {
    const full: Morality = { care: 1, fairness: 1, loyalty: 1, authority: 1, sanctity: 1, liberty: 1 };
    const fullTraits: Traits = { curiosity: 1, aggression: 1, empathy: 1, industriousness: 1, riskTolerance: 1 };
    const a = { morality: full, traits: fullTraits };
    const b = { morality: ZERO_MORALITY, traits: ZERO_TRAITS };
    expect(cultureDistance(a, b)).toBeCloseTo(1, 6);
  });
});

describe('generatedColor', () => {
  it('is hsl((id*137)%360, 70%, 55%)', () => {
    expect(generatedColor(0)).toBe('hsl(0, 70%, 55%)');
    expect(generatedColor(1)).toBe('hsl(137, 70%, 55%)');
    expect(generatedColor(4)).toBe(`hsl(${(4 * 137) % 360}, 70%, 55%)`);
  });
});

describe('maybeSchism', () => {
  it('secedes a settlement after 2+ years over the distance threshold with an influential leader', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: 0 });
    // civ culture stays at zero: one lone outside member keeps the civ average at 0.
    const outsider = makePerson(1, 0, ctx);
    const leader = makePerson(2, 0, ctx);
    leader.morality = { care: 1, fairness: 1, loyalty: 1, authority: 1, sanctity: 1, liberty: 1 };
    leader.traits = { curiosity: 1, aggression: 1, empathy: 1, industriousness: 1, riskTolerance: 1 };
    leader.influence = SCHISM_LEADER_INFLUENCE + 0.01;
    ctx.people = [outsider, leader];
    ctx.personById = new Map([[1, outsider], [2, leader]]);
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [2] });
    ctx.settlements = [settlement];

    expect(cultureDistance(settlementCulture(settlement, ctx), civCulture(0, ctx))).toBeGreaterThan(
      SCHISM_DISTANCE_THRESHOLD,
    );

    // Tick forward in SCHISM check increments; simulate ticking by calling maybeSchism
    // repeatedly with ctx.tick advancing, as Simulation would.
    for (let t = 0; t <= SCHISM_DURATION_TICKS; t++) {
      ctx.tick = t;
      maybeSchism(ctx);
    }

    expect(ctx.civs).toHaveLength(2);
    const newCiv = ctx.civs.find((c) => c.id !== 0);
    expect(newCiv).toBeDefined();
    expect(newCiv?.color).toBe(generatedColor(newCiv?.id as number));
    expect(leader.civId).toBe(newCiv?.id);
    expect(settlement.civId).toBe(newCiv?.id);
    expect(outsider.civId).toBe(0); // not a settlement member, unaffected
  });

  it('does not secede before SCHISM_DURATION_TICKS have elapsed (no-op boundary)', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: 0 });
    const outsider = makePerson(1, 0, ctx);
    const leader = makePerson(2, 0, ctx);
    leader.morality = { care: 1, fairness: 1, loyalty: 1, authority: 1, sanctity: 1, liberty: 1 };
    leader.traits = { curiosity: 1, aggression: 1, empathy: 1, industriousness: 1, riskTolerance: 1 };
    leader.influence = SCHISM_LEADER_INFLUENCE + 0.01;
    ctx.people = [outsider, leader];
    ctx.personById = new Map([[1, outsider], [2, leader]]);
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [2] });
    ctx.settlements = [settlement];

    for (let t = 0; t < SCHISM_DURATION_TICKS - 1; t++) {
      ctx.tick = t;
      maybeSchism(ctx);
    }

    expect(ctx.civs).toHaveLength(1); // not yet
  });

  it('does not secede when the leader lacks sufficient influence', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: 0 });
    const outsider = makePerson(1, 0, ctx);
    const leader = makePerson(2, 0, ctx);
    leader.morality = { care: 1, fairness: 1, loyalty: 1, authority: 1, sanctity: 1, liberty: 1 };
    leader.traits = { curiosity: 1, aggression: 1, empathy: 1, industriousness: 1, riskTolerance: 1 };
    leader.influence = SCHISM_LEADER_INFLUENCE - 0.1; // below the gate
    ctx.people = [outsider, leader];
    ctx.personById = new Map([[1, outsider], [2, leader]]);
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [2] });
    ctx.settlements = [settlement];

    for (let t = 0; t <= SCHISM_DURATION_TICKS + 10; t++) {
      ctx.tick = t;
      maybeSchism(ctx);
    }

    expect(ctx.civs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/society/culture.test.ts
```

Expected: FAIL — module-resolution error: `Failed to resolve import "../../../src/engine/society/culture"` (the file does not exist yet).

- [ ] **Step 3: Implement `src/engine/society/culture.ts`**

Create `src/engine/society/culture.ts` with exactly:

```ts
import type { Civ, Morality, Person, Settlement, Tick, Traits } from '../../shared/types';
import type { Rng } from '../rng';
import type { NameGen } from '../names';
import { leaderOf, type InfluenceCtxLike } from './influence';

export interface CultureVector {
  morality: Morality;
  traits: Traits;
}

/** Deviation 1: structurally a superset of InfluenceCtxLike, so leaderOf(s, ctx) is callable with this ctx. */
export interface CultureCtxLike extends InfluenceCtxLike {
  civs: Civ[];
  settlements: Settlement[];
  names: NameGen;
}

export const SCHISM_DISTANCE_THRESHOLD = 0.35;
export const SCHISM_DURATION_TICKS = 720; // 2 years at YEAR_TICKS = 360
export const SCHISM_LEADER_INFLUENCE = 0.6;

const MORALITY_KEYS: (keyof Morality)[] = ['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty'];
const TRAIT_KEYS: (keyof Traits)[] = ['curiosity', 'aggression', 'empathy', 'industriousness', 'riskTolerance'];

const ZERO_MORALITY: Morality = { care: 0, fairness: 0, loyalty: 0, authority: 0, sanctity: 0, liberty: 0 };
const ZERO_TRAITS: Traits = { curiosity: 0, aggression: 0, empathy: 0, industriousness: 0, riskTolerance: 0 };

function averageCulture(members: Person[]): CultureVector {
  if (members.length === 0) {
    return { morality: { ...ZERO_MORALITY }, traits: { ...ZERO_TRAITS } };
  }
  const morality: Morality = { ...ZERO_MORALITY };
  const traits: Traits = { ...ZERO_TRAITS };
  for (const p of members) {
    for (const k of MORALITY_KEYS) morality[k] += p.morality[k];
    for (const k of TRAIT_KEYS) traits[k] += p.traits[k];
  }
  for (const k of MORALITY_KEYS) morality[k] /= members.length;
  for (const k of TRAIT_KEYS) traits[k] /= members.length;
  return { morality, traits };
}

/** Population aggregate: mean morality and traits across all living civ members. */
export function civCulture(civId: number, ctx: CultureCtxLike): CultureVector {
  const members = ctx.people.filter((p) => p.alive && p.civId === civId);
  return averageCulture(members);
}

/** Same averaging, scoped to a settlement's living membership. */
export function settlementCulture(s: Settlement, ctx: CultureCtxLike): CultureVector {
  const members = s.memberIds
    .map((id) => ctx.personById.get(id))
    .filter((p): p is Person => p !== undefined && p.alive);
  return averageCulture(members);
}

/** Normalized mean absolute difference across all 11 morality+trait axes, in [0, 1]. */
export function cultureDistance(a: CultureVector, b: CultureVector): number {
  let sum = 0;
  for (const k of MORALITY_KEYS) sum += Math.abs(a.morality[k] - b.morality[k]);
  for (const k of TRAIT_KEYS) sum += Math.abs(a.traits[k] - b.traits[k]);
  return sum / 11;
}

/** hsl((civId*137)%360, 70%, 55%) — the fixed generated-civ color formula. */
export function generatedColor(civId: number): string {
  const hue = (civId * 137) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

function nextCivId(ctx: CultureCtxLike): number {
  let max = 0;
  for (const c of ctx.civs) if (c.id > max) max = c.id;
  return max + 1;
}

/** Extension property tracking consecutive over-threshold ticks per settlement (deviation 3). */
interface WithSchismTracker {
  _overThresholdSinceTick?: Tick;
}

/**
 * Full contract behavior: a settlement whose local culture distance from its
 * civ exceeds SCHISM_DISTANCE_THRESHOLD for SCHISM_DURATION_TICKS
 * consecutive ticks, led by a member with influence > SCHISM_LEADER_INFLUENCE,
 * secedes into a brand-new Civ. Settlements that fall back under the
 * threshold lose all accumulated duration credit immediately.
 */
export function maybeSchism(ctx: CultureCtxLike): void {
  for (const s of [...ctx.settlements].sort((a, b) => a.id - b.id)) {
    const tracked = s as Settlement & WithSchismTracker;
    const civCult = civCulture(s.civId, ctx);
    const localCult = settlementCulture(s, ctx);
    const distance = cultureDistance(localCult, civCult);

    if (distance <= SCHISM_DISTANCE_THRESHOLD) {
      tracked._overThresholdSinceTick = undefined;
      continue;
    }

    if (tracked._overThresholdSinceTick === undefined) {
      tracked._overThresholdSinceTick = ctx.tick;
      continue;
    }

    const duration = ctx.tick - tracked._overThresholdSinceTick;
    if (duration < SCHISM_DURATION_TICKS) continue;

    const leader = leaderOf(s, ctx);
    if (leader === null || leader.influence <= SCHISM_LEADER_INFLUENCE) continue;

    secede(s, ctx);
    tracked._overThresholdSinceTick = undefined;
  }
}

function secede(s: Settlement, ctx: CultureCtxLike): void {
  const id = nextCivId(ctx);
  const newCiv: Civ = {
    id,
    name: ctx.names.civ(),
    color: generatedColor(id),
    knowledge: { fire: 0, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
    techs: [],
    atWarWith: [],
    warWeariness: 0,
  };
  ctx.civs.push(newCiv);
  for (const memberId of s.memberIds) {
    const p = ctx.personById.get(memberId);
    if (p === undefined || !p.alive) continue;
    p.civId = id;
  }
  s.civId = id;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/society/culture.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/society/culture.test.ts (9 tests)

 Test Files  1 passed (1)
      Tests  9 passed (9)
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
git add src/engine/society/culture.ts tests/engine/society/culture.test.ts
git commit -m "feat(society): culture - drift aggregate, distance metric, and schism secession" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 29: Technology (`src/engine/society/technology.ts`)

**Files:**
- Create: `src/engine/society/technology.ts`
- Test: `tests/engine/society/technology.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Civ`, `Person`, `TechId`, `TECH_IDS`, `TECH_THRESHOLDS`, `ActionKind`, `SkillName`, `Tick`
- Tests also use `createPerson` (Task 8), `makeTestCtx`/`makeTestCiv` (Task 26)

Produces:
- `export interface TechnologyCtxLike { people: Person[]; civs: Civ[]; tick: Tick }` — deviation 1.
- `export function addKnowledge(civ: Civ, domain: TechId, points: number): void` — contract signature verbatim: `civ.knowledge[domain] += points`, floored at 0 (never negative).
- `export function updateTechnology(ctx: TechnologyCtxLike): void` — for every civ (ascending id): for every `TechId` in `TECH_IDS` order: (a) if `civ.knowledge[domain] >= TECH_THRESHOLDS[domain]` AND `isActive(civ, domain, ctx)`, ensure `domain` is in `civ.techs` (unlock, if not already present); (b) if `domain` is in `civ.techs` but `!isActive(civ, domain, ctx)`, remove it from `civ.techs` ("lost"); (c) knowledge decay: `civ.knowledge[domain]` decays by `KNOWLEDGE_DECAY_PER_TICK` (0.1) per tick UNLESS `civ.techs.includes('writing')` (writing freezes decay for every domain, including itself), floored at 0.
- `export function isActive(civ: Civ, domain: TechId, ctx: TechnologyCtxLike): boolean` — true iff at least `TECH_ACTIVE_MIN_MEMBERS` (3) living members of `civ` have `skills[mappedSkill] >= TECH_ACTIVE_MIN_SKILL` (0.4), where `mappedSkill = TECH_SKILL_MAP[domain]`.
- `export const TECH_SKILL_MAP: Record<TechId, SkillName>` — `{ fire: 'gathering', agriculture: 'farming', construction: 'building', metallurgy: 'crafting', writing: 'teaching', medicine: 'healing' }`.
- `export function techYieldMultiplier(civ: Civ, action: ActionKind): number` — `1` if the civ lacks the relevant tech; with `agriculture` active, `action === 'farm'` returns `2`; with `metallurgy` active, `action === 'craft'` returns `1.5` and `action === 'attack'` returns `1.3`; with `medicine` active, `action === 'heal'` returns `2`; multipliers compose multiplicatively if multiple techs apply to the same action (none currently overlap, but the implementation multiplies rather than short-circuits, so future techs compose safely); all other action/tech combinations return `1`.
- Exported constants: `KNOWLEDGE_DECAY_PER_TICK = 0.1`, `TECH_ACTIVE_MIN_MEMBERS = 3`, `TECH_ACTIVE_MIN_SKILL = 0.4`.

Wiring notes for Task 33 (binding):
- Task 33 tick step 5 calls `updateTechnology(ctx)` after `tradeBetween`/`updateConflict`, before `spreadBeliefs`/`maybeFoundReligion`, exactly as ordered in the contract.
- `addKnowledge` is the contract's canonical grant routine; Task 15 (`execute.ts`, already written by Section 3) calls it via its own `TechCtxLike.addKnowledge` structural field — this task's real `addKnowledge` satisfies that field verbatim once Task 33 wires `{ yieldMultiplier: techYieldMultiplier, addKnowledge }` into `ctx.tech`, exactly as Section 3's deviation 2 note anticipates.
- Task 34 narrates "tech unlocked"/"tech lost" from the `civ.techs` membership delta this function produces; `updateTechnology` itself does not push events.

- [ ] **Step 1: Write the failing technology tests**

Create `tests/engine/society/technology.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_DECAY_PER_TICK,
  TECH_ACTIVE_MIN_MEMBERS,
  TECH_ACTIVE_MIN_SKILL,
  TECH_SKILL_MAP,
  addKnowledge,
  isActive,
  techYieldMultiplier,
  updateTechnology,
} from '../../../src/engine/society/technology';
import { createPerson } from '../../../src/engine/agents/person';
import { makeTestCiv, makeTestCtx } from '../../helpers/testCtx';
import { TECH_THRESHOLDS, type Person } from '../../../src/shared/types';

function makePerson(id: number, civId: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, civId, 'fable', { x: 10, y: 10 }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  return p;
}

describe('addKnowledge', () => {
  it('adds points to the domain, floored at 0', () => {
    const civ = makeTestCiv();
    addKnowledge(civ, 'fire', 10);
    expect(civ.knowledge.fire).toBe(10);
    addKnowledge(civ, 'fire', -50);
    expect(civ.knowledge.fire).toBe(0); // floored, never negative
  });
});

describe('TECH_SKILL_MAP', () => {
  it('maps every tech to its skill exactly as specified', () => {
    expect(TECH_SKILL_MAP).toEqual({
      fire: 'gathering',
      agriculture: 'farming',
      construction: 'building',
      metallurgy: 'crafting',
      writing: 'teaching',
      medicine: 'healing',
    });
  });
});

describe('isActive', () => {
  it('requires >=3 living members with the mapped skill >= 0.4', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const people = [1, 2, 3].map((id) => {
      const p = makePerson(id, 0, ctx);
      p.skills.farming = TECH_ACTIVE_MIN_SKILL;
      return p;
    });
    ctx.people = people;
    expect(isActive(civ, 'agriculture', ctx)).toBe(true);
    expect(TECH_ACTIVE_MIN_MEMBERS).toBe(3);
  });

  it('is false with only 2 qualifying members (no-op boundary)', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const people = [1, 2].map((id) => {
      const p = makePerson(id, 0, ctx);
      p.skills.farming = 0.9;
      return p;
    });
    const belowSkill = makePerson(3, 0, ctx);
    belowSkill.skills.farming = 0.39; // below threshold
    ctx.people = [...people, belowSkill];
    expect(isActive(civ, 'agriculture', ctx)).toBe(false);
  });

  it('ignores dead members and members of other civs', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ] });
    const dead = makePerson(1, 0, ctx);
    dead.alive = false;
    dead.skills.farming = 1;
    const otherCiv = makePerson(2, 1, ctx);
    otherCiv.skills.farming = 1;
    const alive = [makePerson(3, 0, ctx), makePerson(4, 0, ctx)];
    for (const p of alive) p.skills.farming = 1;
    ctx.people = [dead, otherCiv, ...alive];
    expect(isActive(civ, 'agriculture', ctx)).toBe(false); // only 2 qualifying in-civ living members
  });
});

describe('updateTechnology', () => {
  it('unlocks a tech once knowledge crosses its threshold and it is active', () => {
    const civ = makeTestCiv();
    civ.knowledge.fire = TECH_THRESHOLDS.fire;
    const ctx = makeTestCtx({ civs: [civ], tick: 1 });
    const people = [1, 2, 3].map((id) => {
      const p = makePerson(id, 0, ctx);
      p.skills.gathering = 1;
      return p;
    });
    ctx.people = people;

    updateTechnology(ctx);

    expect(civ.techs).toContain('fire');
  });

  it('does not unlock below threshold (no-op boundary)', () => {
    const civ = makeTestCiv();
    civ.knowledge.fire = TECH_THRESHOLDS.fire - 1;
    const ctx = makeTestCtx({ civs: [civ], tick: 1 });
    const people = [1, 2, 3].map((id) => {
      const p = makePerson(id, 0, ctx);
      p.skills.gathering = 1;
      return p;
    });
    ctx.people = people;

    updateTechnology(ctx);

    expect(civ.techs).not.toContain('fire');
  });

  it('marks a tech lost when it falls inactive (fewer than 3 skilled members)', () => {
    const civ = makeTestCiv({ techs: ['fire'] });
    civ.knowledge.fire = TECH_THRESHOLDS.fire;
    const ctx = makeTestCtx({ civs: [civ], tick: 1 });
    const p = makePerson(1, 0, ctx);
    p.skills.gathering = 1; // only 1 qualifying member, below TECH_ACTIVE_MIN_MEMBERS
    ctx.people = [p];

    updateTechnology(ctx);

    expect(civ.techs).not.toContain('fire');
  });

  it('decays knowledge by 0.1/tick per domain without active writing', () => {
    const civ = makeTestCiv();
    civ.knowledge.agriculture = 5;
    const ctx = makeTestCtx({ civs: [civ], tick: 1 });
    ctx.people = [];

    updateTechnology(ctx);

    expect(civ.knowledge.agriculture).toBeCloseTo(5 - KNOWLEDGE_DECAY_PER_TICK, 6);
  });

  it('freezes knowledge decay entirely when writing is active', () => {
    const civ = makeTestCiv({ techs: ['writing'] });
    civ.knowledge.agriculture = 5;
    civ.knowledge.writing = TECH_THRESHOLDS.writing;
    const ctx = makeTestCtx({ civs: [civ], tick: 1 });
    const people = [1, 2, 3].map((id) => {
      const p = makePerson(id, 0, ctx);
      p.skills.teaching = 1; // keeps writing itself active
      return p;
    });
    ctx.people = people;

    updateTechnology(ctx);

    expect(civ.knowledge.agriculture).toBe(5); // frozen, no decay
  });

  it('floors decayed knowledge at 0', () => {
    const civ = makeTestCiv();
    civ.knowledge.fire = 0.05;
    const ctx = makeTestCtx({ civs: [civ], tick: 1 });
    ctx.people = [];

    updateTechnology(ctx);

    expect(civ.knowledge.fire).toBe(0);
  });
});

describe('techYieldMultiplier', () => {
  it('doubles farm with agriculture', () => {
    const civ = makeTestCiv({ techs: ['agriculture'] });
    expect(techYieldMultiplier(civ, 'farm')).toBe(2);
    expect(techYieldMultiplier(civ, 'gather')).toBe(1); // unaffected
  });

  it('boosts craft x1.5 and attack x1.3 with metallurgy', () => {
    const civ = makeTestCiv({ techs: ['metallurgy'] });
    expect(techYieldMultiplier(civ, 'craft')).toBeCloseTo(1.5, 6);
    expect(techYieldMultiplier(civ, 'attack')).toBeCloseTo(1.3, 6);
  });

  it('doubles heal with medicine', () => {
    const civ = makeTestCiv({ techs: ['medicine'] });
    expect(techYieldMultiplier(civ, 'heal')).toBe(2);
  });

  it('returns 1 with no relevant tech (no-op boundary)', () => {
    const civ = makeTestCiv();
    expect(techYieldMultiplier(civ, 'farm')).toBe(1);
    expect(techYieldMultiplier(civ, 'craft')).toBe(1);
    expect(techYieldMultiplier(civ, 'attack')).toBe(1);
    expect(techYieldMultiplier(civ, 'heal')).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/society/technology.test.ts
```

Expected: FAIL — module-resolution error: `Failed to resolve import "../../../src/engine/society/technology"` (the file does not exist yet).

- [ ] **Step 3: Implement `src/engine/society/technology.ts`**

Create `src/engine/society/technology.ts` with exactly:

```ts
import {
  TECH_IDS,
  TECH_THRESHOLDS,
  type ActionKind,
  type Civ,
  type Person,
  type SkillName,
  type TechId,
  type Tick,
} from '../../shared/types';

/** Deviation 1: the minimal structural subset of the eventual EngineCtx technology reads. */
export interface TechnologyCtxLike {
  people: Person[];
  civs: Civ[];
  tick: Tick;
}

export const KNOWLEDGE_DECAY_PER_TICK = 0.1;
export const TECH_ACTIVE_MIN_MEMBERS = 3;
export const TECH_ACTIVE_MIN_SKILL = 0.4;

export const TECH_SKILL_MAP: Record<TechId, SkillName> = {
  fire: 'gathering',
  agriculture: 'farming',
  construction: 'building',
  metallurgy: 'crafting',
  writing: 'teaching',
  medicine: 'healing',
};

/** civ.knowledge[domain] += points, floored at 0. */
export function addKnowledge(civ: Civ, domain: TechId, points: number): void {
  civ.knowledge[domain] = Math.max(0, civ.knowledge[domain] + points);
}

/** True iff >= TECH_ACTIVE_MIN_MEMBERS living civ members have the mapped skill >= TECH_ACTIVE_MIN_SKILL. */
export function isActive(civ: Civ, domain: TechId, ctx: TechnologyCtxLike): boolean {
  const skill = TECH_SKILL_MAP[domain];
  let count = 0;
  for (const p of ctx.people) {
    if (!p.alive || p.civId !== civ.id) continue;
    if (p.skills[skill] >= TECH_ACTIVE_MIN_SKILL) count += 1;
    if (count >= TECH_ACTIVE_MIN_MEMBERS) return true;
  }
  return count >= TECH_ACTIVE_MIN_MEMBERS;
}

/**
 * Per civ (ascending id), per TechId (TECH_IDS order): unlock at threshold
 * while active; mark lost when active membership drops below the minimum;
 * decay knowledge 0.1/tick per domain unless the civ has active writing
 * (writing freezes decay for every domain, including itself).
 */
export function updateTechnology(ctx: TechnologyCtxLike): void {
  const civs = [...ctx.civs].sort((a, b) => a.id - b.id);
  for (const civ of civs) {
    const writingFrozen = civ.techs.includes('writing');
    for (const domain of TECH_IDS) {
      const active = isActive(civ, domain, ctx);
      const unlocked = civ.knowledge[domain] >= TECH_THRESHOLDS[domain];
      const hasIt = civ.techs.includes(domain);

      if (unlocked && active && !hasIt) {
        civ.techs.push(domain);
      } else if (hasIt && !active) {
        civ.techs = civ.techs.filter((t) => t !== domain);
      }

      if (!writingFrozen) {
        civ.knowledge[domain] = Math.max(0, civ.knowledge[domain] - KNOWLEDGE_DECAY_PER_TICK);
      }
    }
  }
}

/**
 * agriculture doubles 'farm'; metallurgy boosts 'craft' x1.5 and 'attack'
 * x1.3; medicine doubles 'heal'. Multipliers compose multiplicatively so
 * future overlapping techs remain correct; unrelated action/tech pairs are 1.
 */
export function techYieldMultiplier(civ: Civ, action: ActionKind): number {
  let mult = 1;
  if (civ.techs.includes('agriculture') && action === 'farm') mult *= 2;
  if (civ.techs.includes('metallurgy') && action === 'craft') mult *= 1.5;
  if (civ.techs.includes('metallurgy') && action === 'attack') mult *= 1.3;
  if (civ.techs.includes('medicine') && action === 'heal') mult *= 2;
  return mult;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/society/technology.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/society/technology.test.ts (13 tests)

 Test Files  1 passed (1)
      Tests  13 passed (13)
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
git add src/engine/society/technology.ts tests/engine/society/technology.test.ts
git commit -m "feat(society): technology - knowledge, unlock/lose, and yield multipliers" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 30: Religion (`src/engine/society/religion.ts`)

**Files:**
- Create: `src/engine/society/religion.ts`
- Test: `tests/engine/society/religion.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Civ`, `Morality`, `Tick`, `clamp01(v): number`
- From `src/engine/rng.ts` (Task 2): `Rng`
- From `src/engine/names.ts` (Task 4): `NameGen`
- Tests also use `createPerson` (Task 8), `makeTestCtx`/`makeTestCiv`/`TestReligion` (Task 26)

Produces:
- `export interface ReligionRec { id: number; name: string; founderId: number; civId: number; moralityBias: Partial<Morality>; zeal: number }` — field-identical structural mirror of the contract `Religion` (named `ReligionRec` here to avoid colliding with the not-yet-existing `src/engine/sim/simulation.ts` re-export; Task 33 re-exports the real `Religion` type, and `ReligionRec` is structurally identical so `EngineCtx.religions: Religion[]` satisfies `ReligionCtxLike.religions: ReligionRec[]`).
- `export interface DisasterWitnessEvent { tick: Tick; civId: number; severity: 1 | 2 | 3 }` — the minimal shape `maybeFoundReligion` needs from the not-yet-existing Task 34 `NarrativeEvent`; structurally satisfied by any object with these three fields (the real `NarrativeEvent` has more fields and is a superset).
- `export interface ReligionCtxLike { people: Person[]; civs: Civ[]; religions: ReligionRec[]; names: NameGen; tick: Tick; rng: Rng; recentDisasterEvents: DisasterWitnessEvent[] }` — deviation 1. `recentDisasterEvents` stands in for scanning the full event log; Task 33/34 pass the slice of `ctx.events` from the last `RELIGION_FOUNDING_WINDOW` ticks with `severity === 3`, filtered to `kind` values that represent disasters (famine, drought, disease, raid-devastation — Task 34's concern), mapped to `{ tick, civId, severity }`.
- `export function maybeFoundReligion(ctx: ReligionCtxLike): void` — for every disaster witness event within `RELIGION_FOUNDING_WINDOW` (30) ticks of `ctx.tick` (i.e. `ctx.tick - event.tick <= RELIGION_FOUNDING_WINDOW`), for every alive candidate in that event's civ with `morality.sanctity > RELIGION_FOUNDER_SANCTITY` (0.7) and `influence > RELIGION_FOUNDER_INFLUENCE` (0.5) who is not already a founder of an existing religion, rolls `ctx.rng.split('religion-founding').chance(RELIGION_FOUNDING_CHANCE)` (0.02) once per candidate per call; on success creates a new `ReligionRec` (`id = nextReligionId`, `name = ctx.names.religion()`, `founderId`, `civId`, `moralityBias` = the founder's top-2 morality axes by value each `+0.15` (as a `Partial<Morality>` containing only those two keys), `zeal = RELIGION_INITIAL_ZEAL` (0.2)) and pushes it to `ctx.religions`.
- `export function spreadBeliefs(ctx: ReligionCtxLike): void` — for every religion (ascending id): find its founder (skip if dead or `personById`-unresolvable via `ctx.people`); for every living person in the founder's civ who does not already hold the belief (`!p.beliefIds.includes(religion.id)`) and who is within `PERCEPTION_RADIUS`-independent socialize-contact modeling simplified here to "any living civ-mate" (this module has no spatial index in its `ReligionCtxLike`, so adoption is evaluated civ-wide, once per person per call, matching the contract's "socialize contact" at the population-aggregate level the section brief specifies): adoption chance `= 0.1 * founderInfluence * (0.5 + p.emotions.fear) * religion.zeal`; on `ctx.rng.split('religion-adopt').chance(...)` success, push `religion.id` onto `p.beliefIds`. For every believer (has `religion.id` in `beliefIds`, alive): nudge morality 0.5%/tick toward `religion.moralityBias` (`m[k] += 0.005 * (bias[k] - m[k])` for each key present in `moralityBias`, clamped to `[0,1]`); `religion.zeal` decays by `RELIGION_ZEAL_DECAY` (0.0005) per tick, then increases by `RELIGION_WORSHIP_ZEAL_GAIN` (0.002) for every believer who performed a `'worship'` action this tick (signaled via `ctx.worshippersThisTick: Set<number>`, a `ReligionCtxLike` field), and by `RELIGION_SHRINE_ZEAL_GAIN` (0.001) per shrine present in any settlement of the religion's civ (`ctx.settlements`, an optional field defaulted to `[]` when absent so tests that don't care about shrines can omit it), floored at 0 and capped at 1.
- `export interface ReligionCtxLikeExtended extends ReligionCtxLike { worshippersThisTick: Set<number>; settlements: { civId: number; structures: { shrine: number } }[] }` — the fuller shape `spreadBeliefs` actually requires (deviation 1, split from `maybeFoundReligion`'s narrower needs so `maybeFoundReligion`'s tests don't need to fabricate settlement/worship data).
- Exported constants: `RELIGION_FOUNDING_WINDOW = 30`, `RELIGION_FOUNDER_SANCTITY = 0.7`, `RELIGION_FOUNDER_INFLUENCE = 0.5`, `RELIGION_FOUNDING_CHANCE = 0.02`, `RELIGION_INITIAL_ZEAL = 0.2`, `RELIGION_MORALITY_BIAS_BONUS = 0.15`, `RELIGION_ADOPTION_MORALITY_NUDGE = 0.005`, `RELIGION_ZEAL_DECAY = 0.0005`, `RELIGION_WORSHIP_ZEAL_GAIN = 0.002`, `RELIGION_SHRINE_ZEAL_GAIN = 0.001`.

Wiring notes for Task 33 (binding):
- Task 33 tick step 5 calls `spreadBeliefs(ctx)` then `maybeFoundReligion(ctx)`, exactly as ordered in the contract ("`spreadBeliefs+maybeFoundReligion`"), passing its own `ctx` widened with `recentDisasterEvents` (derived from `ctx.events`), `worshippersThisTick` (collected during tick step 3's `executeAction` pass), and `ctx.settlements` — all of which the real `EngineCtx` plus Task 33's own bookkeeping provide, satisfying `ReligionCtxLikeExtended` structurally.
- `Religion.moralityBias` in the real contract is exactly `Partial<Morality>`; this module never assumes more than two keys are present, since only the top-2 axes bonus is ever written.

- [ ] **Step 1: Write the failing religion tests**

Create `tests/engine/society/religion.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  RELIGION_FOUNDER_INFLUENCE,
  RELIGION_FOUNDER_SANCTITY,
  RELIGION_FOUNDING_CHANCE,
  RELIGION_FOUNDING_WINDOW,
  RELIGION_INITIAL_ZEAL,
  RELIGION_MORALITY_BIAS_BONUS,
  RELIGION_SHRINE_ZEAL_GAIN,
  RELIGION_WORSHIP_ZEAL_GAIN,
  RELIGION_ZEAL_DECAY,
  maybeFoundReligion,
  spreadBeliefs,
  type ReligionCtxLikeExtended,
  type ReligionRec,
} from '../../../src/engine/society/religion';
import { createPerson } from '../../../src/engine/agents/person';
import { createRng } from '../../../src/engine/rng';
import { makeTestCiv, makeTestCtx } from '../../helpers/testCtx';
import type { Person } from '../../../src/shared/types';

function makePerson(id: number, civId: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, civId, 'fable', { x: 10, y: 10 }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  p.beliefIds = [];
  return p;
}

function makeReligionCtx(
  ctx: ReturnType<typeof makeTestCtx>,
  overrides: Partial<ReligionCtxLikeExtended> = {},
): ReligionCtxLikeExtended {
  return {
    people: ctx.people,
    civs: ctx.civs,
    religions: [],
    names: ctx.names,
    tick: ctx.tick,
    rng: ctx.rng,
    recentDisasterEvents: [],
    worshippersThisTick: new Set<number>(),
    settlements: [],
    ...overrides,
  };
}

describe('maybeFoundReligion', () => {
  it('founds a religion from a qualifying witness within the founding window, with a 0.02 roll', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 20 });
    const founder = makePerson(1, 0, base);
    founder.morality.sanctity = RELIGION_FOUNDER_SANCTITY + 0.1;
    founder.morality.care = 0.9;
    founder.morality.fairness = 0.8;
    founder.influence = RELIGION_FOUNDER_INFLUENCE + 0.1;
    base.people = [founder];
    const rctx = makeReligionCtx(base, {
      rng: createRng(1), // seed chosen for the test only to exercise the code path deterministically via split
      recentDisasterEvents: [{ tick: 0, civId: 0, severity: 3 }], // within RELIGION_FOUNDING_WINDOW=30 of tick 20
    });

    // Roll forward enough independent calls that the 0.02/tick chance fires at least once
    // deterministically for this seed; each call re-splits the rng by label+tick so ticks differ.
    let founded = false;
    for (let t = 20; t < 20 + 400 && !founded; t++) {
      rctx.tick = t;
      maybeFoundReligion(rctx);
      if (rctx.religions.length > 0) founded = true;
    }

    expect(founded).toBe(true);
    const rel = rctx.religions[0] as ReligionRec;
    expect(rel.founderId).toBe(1);
    expect(rel.civId).toBe(0);
    expect(rel.zeal).toBe(RELIGION_INITIAL_ZEAL);
    // top-2 axes (care 0.9, fairness 0.8) each +0.15
    expect(rel.moralityBias.care).toBeCloseTo(0.9 + RELIGION_MORALITY_BIAS_BONUS, 6);
    expect(rel.moralityBias.fairness).toBeCloseTo(0.8 + RELIGION_MORALITY_BIAS_BONUS, 6);
    expect(Object.keys(rel.moralityBias)).toHaveLength(2);
    expect(RELIGION_FOUNDING_WINDOW).toBe(30);
    expect(RELIGION_FOUNDER_SANCTITY).toBe(0.7);
    expect(RELIGION_FOUNDER_INFLUENCE).toBe(0.5);
    expect(RELIGION_FOUNDING_CHANCE).toBe(0.02);
  });

  it('does not found outside the founding window (no-op boundary)', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 100 });
    const founder = makePerson(1, 0, base);
    founder.morality.sanctity = 0.9;
    founder.influence = 0.9;
    base.people = [founder];
    const rctx = makeReligionCtx(base, {
      tick: 100,
      recentDisasterEvents: [{ tick: 0, civId: 0, severity: 3 }], // 100 ticks ago, window is 30
    });

    for (let t = 100; t < 100 + 400; t++) {
      rctx.tick = t;
      maybeFoundReligion(rctx);
    }

    expect(rctx.religions).toHaveLength(0);
  });

  it('does not found from a candidate below sanctity or influence thresholds', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 10 });
    const weakCandidate = makePerson(1, 0, base);
    weakCandidate.morality.sanctity = 0.5; // below threshold
    weakCandidate.influence = 0.9;
    base.people = [weakCandidate];
    const rctx = makeReligionCtx(base, {
      tick: 10,
      recentDisasterEvents: [{ tick: 0, civId: 0, severity: 3 }],
    });

    for (let t = 10; t < 10 + 400; t++) {
      rctx.tick = t;
      maybeFoundReligion(rctx);
    }

    expect(rctx.religions).toHaveLength(0);
  });
});

describe('spreadBeliefs', () => {
  it('adopts belief with chance 0.1*founderInfluence*(0.5+fear)*zeal and nudges morality toward the bias', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 0 });
    const founder = makePerson(1, 0, base);
    founder.influence = 1; // maximize adoption chance
    const believer = makePerson(2, 0, base);
    believer.emotions.fear = 1; // (0.5 + 1) = 1.5, further maximizing adoption chance
    believer.morality.care = 0;
    base.people = [founder, believer];
    const religion: ReligionRec = {
      id: 1,
      name: 'Testism',
      founderId: 1,
      civId: 0,
      moralityBias: { care: 1 },
      zeal: 1, // maximize chance: 0.1*1*1.5*1 = 0.15/tick
    };
    const rctx = makeReligionCtx(base, { religions: [religion], rng: createRng(2) });

    let adopted = false;
    for (let t = 0; t < 300 && !adopted; t++) {
      rctx.tick = t;
      spreadBeliefs(rctx);
      if (believer.beliefIds.includes(1)) adopted = true;
    }

    expect(adopted).toBe(true);
    // once adopted, further ticks nudge morality.care toward 1 by 0.5%/tick
    const careBefore = believer.morality.care;
    spreadBeliefs(rctx);
    expect(believer.morality.care).toBeGreaterThan(careBefore);
  });

  it('does not adopt when zeal is 0 (no-op boundary)', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 0 });
    const founder = makePerson(1, 0, base);
    founder.influence = 1;
    const believer = makePerson(2, 0, base);
    believer.emotions.fear = 1;
    base.people = [founder, believer];
    const religion: ReligionRec = {
      id: 1,
      name: 'Testism',
      founderId: 1,
      civId: 0,
      moralityBias: { care: 1 },
      zeal: 0,
    };
    const rctx = makeReligionCtx(base, { religions: [religion] });

    for (let t = 0; t < 200; t++) {
      rctx.tick = t;
      spreadBeliefs(rctx);
    }

    expect(believer.beliefIds).toHaveLength(0);
  });

  it('zeal decays 0.0005/tick, gains 0.002 per worshipper and 0.001 per shrine', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 0 });
    const founder = makePerson(1, 0, base);
    base.people = [founder];
    const religion: ReligionRec = {
      id: 1,
      name: 'Testism',
      founderId: 1,
      civId: 0,
      moralityBias: {},
      zeal: 0.5,
    };
    const rctx = makeReligionCtx(base, {
      religions: [religion],
      worshippersThisTick: new Set([1]),
      settlements: [{ civId: 0, structures: { shrine: 2 } }],
    });

    spreadBeliefs(rctx);

    const expected = 0.5 - RELIGION_ZEAL_DECAY + RELIGION_WORSHIP_ZEAL_GAIN + 2 * RELIGION_SHRINE_ZEAL_GAIN;
    expect(religion.zeal).toBeCloseTo(expected, 6);
  });

  it('is a no-op when the founder is dead', () => {
    const civ = makeTestCiv({ id: 0 });
    const base = makeTestCtx({ civs: [civ], tick: 0 });
    const founder = makePerson(1, 0, base);
    founder.alive = false;
    const believer = makePerson(2, 0, base);
    base.people = [founder, believer];
    const religion: ReligionRec = {
      id: 1,
      name: 'Testism',
      founderId: 1,
      civId: 0,
      moralityBias: { care: 1 },
      zeal: 1,
    };
    const rctx = makeReligionCtx(base, { religions: [religion] });

    for (let t = 0; t < 50; t++) {
      rctx.tick = t;
      spreadBeliefs(rctx);
    }

    expect(believer.beliefIds).toHaveLength(0);
    expect(religion.zeal).toBe(1); // untouched; the whole religion is skipped
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/society/religion.test.ts
```

Expected: FAIL — module-resolution error: `Failed to resolve import "../../../src/engine/society/religion"` (the file does not exist yet).

- [ ] **Step 3: Implement `src/engine/society/religion.ts`**

Create `src/engine/society/religion.ts` with exactly:

```ts
import { clamp01, type Civ, type Morality, type Person, type Tick } from '../../shared/types';
import type { Rng } from '../rng';
import type { NameGen } from '../names';

/** Field-identical structural mirror of the contract Religion (see deviation notes). */
export interface ReligionRec {
  id: number;
  name: string;
  founderId: number;
  civId: number;
  moralityBias: Partial<Morality>;
  zeal: number;
}

/** The minimal shape maybeFoundReligion needs from a narrative event. */
export interface DisasterWitnessEvent {
  tick: Tick;
  civId: number;
  severity: 1 | 2 | 3;
}

/** Deviation 1: the minimal structural subset maybeFoundReligion reads/writes. */
export interface ReligionCtxLike {
  people: Person[];
  civs: Civ[];
  religions: ReligionRec[];
  names: NameGen;
  tick: Tick;
  rng: Rng;
  recentDisasterEvents: DisasterWitnessEvent[];
}

/** The fuller shape spreadBeliefs actually requires. */
export interface ReligionCtxLikeExtended extends ReligionCtxLike {
  worshippersThisTick: Set<number>;
  settlements: { civId: number; structures: { shrine: number } }[];
}

export const RELIGION_FOUNDING_WINDOW = 30;
export const RELIGION_FOUNDER_SANCTITY = 0.7;
export const RELIGION_FOUNDER_INFLUENCE = 0.5;
export const RELIGION_FOUNDING_CHANCE = 0.02;
export const RELIGION_INITIAL_ZEAL = 0.2;
export const RELIGION_MORALITY_BIAS_BONUS = 0.15;
export const RELIGION_ADOPTION_MORALITY_NUDGE = 0.005;
export const RELIGION_ZEAL_DECAY = 0.0005;
export const RELIGION_WORSHIP_ZEAL_GAIN = 0.002;
export const RELIGION_SHRINE_ZEAL_GAIN = 0.001;

const MORALITY_KEYS: (keyof Morality)[] = ['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty'];

function nextReligionId(ctx: ReligionCtxLike): number {
  let max = 0;
  for (const r of ctx.religions) if (r.id > max) max = r.id;
  return max + 1;
}

function topTwoMoralityAxes(morality: Morality): (keyof Morality)[] {
  return [...MORALITY_KEYS].sort((a, b) => morality[b] - morality[a]).slice(0, 2);
}

/**
 * Founding: within RELIGION_FOUNDING_WINDOW ticks after a severity-3
 * disaster event in a civ, any alive high-sanctity high-influence witness
 * who is not already a founder rolls RELIGION_FOUNDING_CHANCE per call to
 * found a new religion, moralityBias = founder's top-2 axes each +0.15.
 */
export function maybeFoundReligion(ctx: ReligionCtxLike): void {
  const existingFounders = new Set(ctx.religions.map((r) => r.founderId));
  const relevantEvents = ctx.recentDisasterEvents.filter(
    (e) => e.severity === 3 && ctx.tick - e.tick >= 0 && ctx.tick - e.tick <= RELIGION_FOUNDING_WINDOW,
  );
  if (relevantEvents.length === 0) return;

  const civIdsWithDisaster = new Set(relevantEvents.map((e) => e.civId));
  const candidates = [...ctx.people]
    .filter(
      (p) =>
        p.alive &&
        civIdsWithDisaster.has(p.civId) &&
        p.morality.sanctity > RELIGION_FOUNDER_SANCTITY &&
        p.influence > RELIGION_FOUNDER_INFLUENCE &&
        !existingFounders.has(p.id),
    )
    .sort((a, b) => a.id - b.id);

  for (const candidate of candidates) {
    const roll = ctx.rng.split(`religion-founding-${candidate.id}-${ctx.tick}`);
    if (!roll.chance(RELIGION_FOUNDING_CHANCE)) continue;

    const axes = topTwoMoralityAxes(candidate.morality);
    const moralityBias: Partial<Morality> = {};
    for (const axis of axes) {
      moralityBias[axis] = clamp01(candidate.morality[axis] + RELIGION_MORALITY_BIAS_BONUS);
    }

    const religion: ReligionRec = {
      id: nextReligionId(ctx),
      name: ctx.names.religion(),
      founderId: candidate.id,
      civId: candidate.civId,
      moralityBias,
      zeal: RELIGION_INITIAL_ZEAL,
    };
    ctx.religions.push(religion);
    existingFounders.add(candidate.id);
  }
}

/**
 * Adoption: living civ-mates of the founder adopt on a per-call chance of
 * 0.1*founderInfluence*(0.5+fear)*zeal. Believers' morality nudges 0.5%/tick
 * toward moralityBias; zeal decays 0.0005/tick, +0.002 per worshipper this
 * tick, +0.001 per shrine present across the religion's civ's settlements.
 */
export function spreadBeliefs(ctx: ReligionCtxLikeExtended): void {
  for (const religion of [...ctx.religions].sort((a, b) => a.id - b.id)) {
    const founder = ctx.people.find((p) => p.id === religion.founderId);
    if (founder === undefined || !founder.alive) continue;

    const civMates = ctx.people
      .filter((p) => p.alive && p.civId === religion.civId && !p.beliefIds.includes(religion.id))
      .sort((a, b) => a.id - b.id);

    for (const p of civMates) {
      const chance = 0.1 * founder.influence * (0.5 + p.emotions.fear) * religion.zeal;
      const roll = ctx.rng.split(`religion-adopt-${religion.id}-${p.id}-${ctx.tick}`);
      if (roll.chance(chance)) {
        p.beliefIds.push(religion.id);
      }
    }

    const believers = ctx.people.filter((p) => p.alive && p.beliefIds.includes(religion.id));
    for (const p of believers) {
      for (const key of Object.keys(religion.moralityBias) as (keyof Morality)[]) {
        const target = religion.moralityBias[key];
        if (target === undefined) continue;
        p.morality[key] = clamp01(p.morality[key] + RELIGION_ADOPTION_MORALITY_NUDGE * (target - p.morality[key]));
      }
    }

    let zeal = religion.zeal - RELIGION_ZEAL_DECAY;
    let worshippers = 0;
    for (const id of ctx.worshippersThisTick) {
      const p = ctx.people.find((q) => q.id === id);
      if (p !== undefined && p.alive && p.beliefIds.includes(religion.id)) worshippers += 1;
    }
    zeal += worshippers * RELIGION_WORSHIP_ZEAL_GAIN;

    const shrineCount = ctx.settlements
      .filter((s) => s.civId === religion.civId)
      .reduce((sum, s) => sum + s.structures.shrine, 0);
    zeal += shrineCount * RELIGION_SHRINE_ZEAL_GAIN;

    religion.zeal = clamp01(zeal);
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/society/religion.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/society/religion.test.ts (8 tests)

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
git add src/engine/society/religion.ts tests/engine/society/religion.test.ts
git commit -m "feat(society): religion - founding, belief adoption, and zeal dynamics" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 31: Economy (`src/engine/society/economy.ts`)

**Files:**
- Create: `src/engine/society/economy.ts`
- Test: `tests/engine/society/economy.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Civ`, `Settlement`, `Inventory`, `Tick`, `dist(a, b): number`, `clamp01(v): number`
- From `src/engine/rng.ts` (Task 2): `Rng`
- Tests also use `createPerson` (Task 8), `makeTestCtx`/`makeTestCiv`/`makeTestSettlement` (Task 26)

Produces:
- `export interface EconomyCtxLike { people: Person[]; personById: Map<number, Person>; civs: Civ[]; settlements: Settlement[]; tick: Tick; rng: Rng }` — deviation 1.
- `export function shareWithin(ctx: EconomyCtxLike): void` — for every settlement (ascending id), for every living member (ascending id): deposit `min(p.inventory.food - SHARE_DEPOSIT_FLOOR, p.inventory.food * shareRate)` into `settlement.stock.food` when `p.inventory.food > SHARE_DEPOSIT_FLOOR` (3), where `shareRate = clamp01(0.5 + 0.25*(p.morality.care) + 0.15*(p.morality.loyalty) - 0.3*(p.morality.liberty))` (base 0.5, scaled by care+loyalty vs liberty as specified); draw `min(1, settlement.stock.food)` from `settlement.stock.food` into `p.inventory.food` when `p.needs.hunger > SHARE_DRAW_HUNGER_THRESHOLD` (0.5) and `settlement.stock.food > 0`.
- `export function tradeBetween(ctx: EconomyCtxLike): void` — no-op unless `ctx.tick % TRADE_INTERVAL === 0` (30); for every unordered pair of settlements (ascending `(a.id, b.id)` with `a.id < b.id`) whose civs are not at war with each other (`!civA.atWarWith.includes(civB.id) && !civB.atWarWith.includes(civA.id)`) and whose centers are within `TRADE_MAX_DISTANCE` (25): for each of the 4 tradeable resources (`food`, `wood`, `stone`, `metal`), if one settlement has surplus (`stock[resource] > 2 * population`, where `population = memberIds.length`) and the other has a deficit of the SAME resource relative to its own population (`stock[resource] <= 2 * otherPopulation`) while itself having surplus of a DIFFERENT resource the first lacks — the contract's "swap surplus resource for deficit resource" is implemented as: for every ordered resource pair `(give, take)` with `give !== take`, if settlement A has surplus of `give` (`A.stock[give] > 2*popA`) and settlement B has surplus of `take` (`B.stock[take] > 2*popB`) and A does NOT have surplus of `take` and B does NOT have surplus of `give`, swap `amount = min(A.stock[give] - 2*popA, B.stock[take] - 2*popB, TRADE_MAX_SWAP)` (1) 1:1 (`A.stock[give] -= amount; B.stock[take] -= amount; A.stock[take] += amount; B.stock[give] += amount`); after any successful swap, apply `TRADE_AFFINITY_BOOST` (0.05) to the relationship affinity between the two settlements' leaders if both exist and are alive (via `adjustRelationship`-shaped direct mutation, since this module does not import `relationships.ts` — see the inline helper below).
- Exported constants: `SHARE_DEPOSIT_FLOOR = 3`, `SHARE_DRAW_HUNGER_THRESHOLD = 0.5`, `TRADE_INTERVAL = 30`, `TRADE_MAX_DISTANCE = 25`, `TRADE_MAX_SWAP = 1`, `TRADE_AFFINITY_BOOST = 0.05`.

Wiring notes for Task 33 (binding):
- Task 33 tick step 5 calls `shareWithin(ctx)` then `tradeBetween(ctx)`, exactly as ordered in the contract.
- `tradeBetween`'s affinity boost is applied as a direct relationship mutation using the same shape as Task 13's `adjustRelationship` (find-or-create by `otherId`, clamp affinity to `[-1, 1]`) rather than importing `relationships.ts`, keeping this module's dependency list to only what the section brief lists; Task 33's own `EngineCtx` still calls the real `adjustRelationship` for every other subsystem — this is a self-contained inline duplicate of that one clamp-and-upsert operation, scoped to leader-pair affinity only.

- [ ] **Step 1: Write the failing economy tests**

Create `tests/engine/society/economy.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  SHARE_DEPOSIT_FLOOR,
  SHARE_DRAW_HUNGER_THRESHOLD,
  TRADE_AFFINITY_BOOST,
  TRADE_INTERVAL,
  TRADE_MAX_DISTANCE,
  TRADE_MAX_SWAP,
  shareWithin,
  tradeBetween,
} from '../../../src/engine/society/economy';
import { createPerson } from '../../../src/engine/agents/person';
import { makeTestCiv, makeTestCtx, makeTestSettlement } from '../../helpers/testCtx';
import type { Person } from '../../../src/shared/types';

function makePerson(id: number, civId: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, civId, 'fable', { x: 10, y: 10 }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  return p;
}

describe('shareWithin', () => {
  it('deposits surplus food above the floor, scaled by the share rate', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const p = makePerson(1, 0, ctx);
    p.inventory.food = 10;
    p.morality = { care: 1, fairness: 0, loyalty: 1, authority: 0, sanctity: 0, liberty: 0 };
    p.settlementId = 1;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [1] });
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);
    ctx.settlements = [settlement];

    shareWithin(ctx);

    // shareRate = clamp01(0.5 + 0.25*1 + 0.15*1 - 0.3*0) = 0.9
    // deposit = min(10 - 3, 10 * 0.9) = min(7, 9) = 7
    expect(settlement.stock.food).toBeCloseTo(7, 6);
    expect(p.inventory.food).toBeCloseTo(3, 6);
    expect(SHARE_DEPOSIT_FLOOR).toBe(3);
  });

  it('does not deposit at or below the floor (no-op boundary)', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const p = makePerson(1, 0, ctx);
    p.inventory.food = 3; // exactly at the floor
    p.settlementId = 1;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [1] });
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);
    ctx.settlements = [settlement];

    shareWithin(ctx);

    expect(settlement.stock.food).toBe(0);
    expect(p.inventory.food).toBe(3);
  });

  it('draws up to 1 food when hungry and stock is available', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const p = makePerson(1, 0, ctx);
    p.inventory.food = 0;
    p.needs.hunger = 0.9;
    p.settlementId = 1;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [1], stock: { food: 5, wood: 0, stone: 0, metal: 0, tools: 0 } });
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);
    ctx.settlements = [settlement];

    shareWithin(ctx);

    expect(p.inventory.food).toBe(1);
    expect(settlement.stock.food).toBe(4);
    expect(SHARE_DRAW_HUNGER_THRESHOLD).toBe(0.5);
  });

  it('draws nothing when not hungry, even with stock available (no-op boundary)', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const p = makePerson(1, 0, ctx);
    p.inventory.food = 0;
    p.needs.hunger = 0.1;
    p.settlementId = 1;
    const settlement = makeTestSettlement({ id: 1, civId: 0, memberIds: [1], stock: { food: 5, wood: 0, stone: 0, metal: 0, tools: 0 } });
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);
    ctx.settlements = [settlement];

    shareWithin(ctx);

    expect(p.inventory.food).toBe(0);
    expect(settlement.stock.food).toBe(5);
  });
});

describe('tradeBetween', () => {
  it('swaps 1 unit of surplus resource for a partner deficit resource between adjacent settlements every 30 ticks', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: TRADE_INTERVAL });
    const a = makeTestSettlement({
      id: 1,
      civId: 0,
      center: { x: 10, y: 10 },
      memberIds: [1],
      stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 }, // surplus food (10 > 2*1)
    });
    const b = makeTestSettlement({
      id: 2,
      civId: 0,
      center: { x: 15, y: 10 }, // distance 5, within TRADE_MAX_DISTANCE
      memberIds: [2],
      stock: { food: 0, wood: 10, stone: 0, metal: 0, tools: 0 }, // surplus wood, deficit food
    });
    const p1 = makePerson(1, 0, ctx);
    const p2 = makePerson(2, 0, ctx);
    ctx.people = [p1, p2];
    ctx.personById = new Map([[1, p1], [2, p2]]);
    ctx.settlements = [a, b];

    tradeBetween(ctx);

    expect(a.stock.food).toBeCloseTo(10 - TRADE_MAX_SWAP, 6);
    expect(a.stock.wood).toBeCloseTo(TRADE_MAX_SWAP, 6);
    expect(b.stock.wood).toBeCloseTo(10 - TRADE_MAX_SWAP, 6);
    expect(b.stock.food).toBeCloseTo(TRADE_MAX_SWAP, 6);
  });

  it('does not trade off the 30-tick interval (no-op boundary)', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: TRADE_INTERVAL + 1 });
    const a = makeTestSettlement({ id: 1, civId: 0, center: { x: 10, y: 10 }, memberIds: [1], stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const b = makeTestSettlement({ id: 2, civId: 0, center: { x: 15, y: 10 }, memberIds: [2], stock: { food: 0, wood: 10, stone: 0, metal: 0, tools: 0 } });
    ctx.settlements = [a, b];
    ctx.people = [];
    ctx.personById = new Map();

    tradeBetween(ctx);

    expect(a.stock.food).toBe(10);
    expect(b.stock.wood).toBe(10);
  });

  it('does not trade beyond TRADE_MAX_DISTANCE', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: TRADE_INTERVAL });
    const a = makeTestSettlement({ id: 1, civId: 0, center: { x: 0, y: 0 }, memberIds: [1], stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const b = makeTestSettlement({ id: 2, civId: 0, center: { x: 100, y: 100 }, memberIds: [2], stock: { food: 0, wood: 10, stone: 0, metal: 0, tools: 0 } });
    ctx.settlements = [a, b];
    ctx.people = [];
    ctx.personById = new Map();

    tradeBetween(ctx);

    expect(a.stock.food).toBe(10);
    expect(b.stock.wood).toBe(10);
    expect(TRADE_MAX_DISTANCE).toBe(25);
  });

  it('does not trade between civs at war', () => {
    const civA = makeTestCiv({ id: 0, atWarWith: [1] });
    const civB = makeTestCiv({ id: 1, atWarWith: [0] });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: TRADE_INTERVAL });
    const a = makeTestSettlement({ id: 1, civId: 0, center: { x: 10, y: 10 }, memberIds: [1], stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const b = makeTestSettlement({ id: 2, civId: 1, center: { x: 15, y: 10 }, memberIds: [2], stock: { food: 0, wood: 10, stone: 0, metal: 0, tools: 0 } });
    ctx.settlements = [a, b];
    ctx.people = [];
    ctx.personById = new Map();

    tradeBetween(ctx);

    expect(a.stock.food).toBe(10);
    expect(b.stock.wood).toBe(10);
  });

  it('boosts leader-pair affinity after a successful trade', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ], tick: TRADE_INTERVAL });
    const a = makeTestSettlement({ id: 1, civId: 0, center: { x: 10, y: 10 }, memberIds: [1], stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const b = makeTestSettlement({ id: 2, civId: 0, center: { x: 15, y: 10 }, memberIds: [2], stock: { food: 0, wood: 10, stone: 0, metal: 0, tools: 0 } });
    const p1 = makePerson(1, 0, ctx);
    const p2 = makePerson(2, 0, ctx);
    p1.influence = 1; // sole member -> leader of a
    p2.influence = 1; // sole member -> leader of b
    p1.relationships = [];
    p2.relationships = [];
    ctx.people = [p1, p2];
    ctx.personById = new Map([[1, p1], [2, p2]]);
    ctx.settlements = [a, b];

    tradeBetween(ctx);

    const rel1 = p1.relationships.find((r) => r.otherId === 2);
    const rel2 = p2.relationships.find((r) => r.otherId === 1);
    expect(rel1?.affinity).toBeCloseTo(TRADE_AFFINITY_BOOST, 6);
    expect(rel2?.affinity).toBeCloseTo(TRADE_AFFINITY_BOOST, 6);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/society/economy.test.ts
```

Expected: FAIL — module-resolution error: `Failed to resolve import "../../../src/engine/society/economy"` (the file does not exist yet).

- [ ] **Step 3: Implement `src/engine/society/economy.ts`**

Create `src/engine/society/economy.ts` with exactly:

```ts
import { clamp01, dist, type Civ, type Person, type Settlement, type Tick } from '../../shared/types';
import type { Rng } from '../rng';

/** Deviation 1: the minimal structural subset of the eventual EngineCtx economy reads/writes. */
export interface EconomyCtxLike {
  people: Person[];
  personById: Map<number, Person>;
  civs: Civ[];
  settlements: Settlement[];
  tick: Tick;
  rng: Rng;
}

export const SHARE_DEPOSIT_FLOOR = 3;
export const SHARE_DRAW_HUNGER_THRESHOLD = 0.5;
export const TRADE_INTERVAL = 30;
export const TRADE_MAX_DISTANCE = 25;
export const TRADE_MAX_SWAP = 1;
export const TRADE_AFFINITY_BOOST = 0.05;

type TradeResource = 'food' | 'wood' | 'stone' | 'metal';
const TRADE_RESOURCES: TradeResource[] = ['food', 'wood', 'stone', 'metal'];

function shareRate(p: Person): number {
  return clamp01(0.5 + 0.25 * p.morality.care + 0.15 * p.morality.loyalty - 0.3 * p.morality.liberty);
}

/**
 * Members deposit surplus food above SHARE_DEPOSIT_FLOOR into their
 * settlement's stock, scaled by shareRate; hungry members (needs.hunger >
 * SHARE_DRAW_HUNGER_THRESHOLD) draw up to 1 food from stock when available.
 */
export function shareWithin(ctx: EconomyCtxLike): void {
  for (const s of [...ctx.settlements].sort((a, b) => a.id - b.id)) {
    const members = [...s.memberIds]
      .sort((a, b) => a - b)
      .map((id) => ctx.personById.get(id))
      .filter((p): p is Person => p !== undefined && p.alive);

    for (const p of members) {
      if (p.inventory.food > SHARE_DEPOSIT_FLOOR) {
        const rate = shareRate(p);
        const deposit = Math.min(p.inventory.food - SHARE_DEPOSIT_FLOOR, p.inventory.food * rate);
        p.inventory.food -= deposit;
        s.stock.food += deposit;
      }
      if (p.needs.hunger > SHARE_DRAW_HUNGER_THRESHOLD && s.stock.food > 0) {
        const draw = Math.min(1, s.stock.food);
        s.stock.food -= draw;
        p.inventory.food += draw;
      }
    }
  }
}

/** Direct clamp-and-upsert relationship affinity boost, scoped to leader pairs (see Task 31 notes). */
function boostAffinity(p: Person, otherId: number, delta: number): void {
  const existing = p.relationships.find((r) => r.otherId === otherId);
  if (existing !== undefined) {
    existing.affinity = Math.max(-1, Math.min(1, existing.affinity + delta));
  } else {
    p.relationships.push({ otherId, kind: 'friend', affinity: Math.max(-1, Math.min(1, delta)) });
  }
}

function leaderOfSettlement(s: Settlement, ctx: EconomyCtxLike): Person | null {
  let leader: Person | null = null;
  for (const id of [...s.memberIds].sort((a, b) => a - b)) {
    const p = ctx.personById.get(id);
    if (p === undefined || !p.alive) continue;
    if (leader === null || p.influence > leader.influence) leader = p;
  }
  return leader;
}

/**
 * Every TRADE_INTERVAL ticks: adjacent (dist < TRADE_MAX_DISTANCE), non-warring
 * settlement pairs (ascending id order) swap up to TRADE_MAX_SWAP units 1:1 of
 * a resource one has in surplus for a different resource the other has in
 * surplus, and boost leader-pair affinity on any successful swap.
 */
export function tradeBetween(ctx: EconomyCtxLike): void {
  if (ctx.tick % TRADE_INTERVAL !== 0) return;

  const settlements = [...ctx.settlements].sort((a, b) => a.id - b.id);
  for (let i = 0; i < settlements.length; i++) {
    for (let j = i + 1; j < settlements.length; j++) {
      const a = settlements[i] as Settlement;
      const b = settlements[j] as Settlement;
      if (dist(a.center, b.center) >= TRADE_MAX_DISTANCE) continue;

      const civA = ctx.civs.find((c) => c.id === a.civId);
      const civB = ctx.civs.find((c) => c.id === b.civId);
      if (civA === undefined || civB === undefined) continue;
      if (civA.atWarWith.includes(civB.id) || civB.atWarWith.includes(civA.id)) continue;

      const popA = a.memberIds.length;
      const popB = b.memberIds.length;
      let traded = false;

      for (const give of TRADE_RESOURCES) {
        for (const take of TRADE_RESOURCES) {
          if (give === take) continue;
          const aSurplusGive = a.stock[give] > 2 * popA;
          const bSurplusTake = b.stock[take] > 2 * popB;
          const aSurplusTake = a.stock[take] > 2 * popA;
          const bSurplusGive = b.stock[give] > 2 * popB;
          if (!aSurplusGive || !bSurplusTake || aSurplusTake || bSurplusGive) continue;

          const amount = Math.min(a.stock[give] - 2 * popA, b.stock[take] - 2 * popB, TRADE_MAX_SWAP);
          if (amount <= 0) continue;

          a.stock[give] -= amount;
          b.stock[take] -= amount;
          a.stock[take] += amount;
          b.stock[give] += amount;
          traded = true;
        }
      }

      if (traded) {
        const leaderA = leaderOfSettlement(a, ctx);
        const leaderB = leaderOfSettlement(b, ctx);
        if (leaderA !== null && leaderB !== null) {
          boostAffinity(leaderA, leaderB.id, TRADE_AFFINITY_BOOST);
          boostAffinity(leaderB, leaderA.id, TRADE_AFFINITY_BOOST);
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/society/economy.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/society/economy.test.ts (9 tests)

 Test Files  1 passed (1)
      Tests  9 passed (9)
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
git add src/engine/society/economy.ts tests/engine/society/economy.test.ts
git commit -m "feat(society): economy - within-settlement sharing and inter-settlement trade" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 32: Conflict (`src/engine/society/conflict.ts`)

**Files:**
- Create: `src/engine/society/conflict.ts`
- Test: `tests/engine/society/conflict.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Person`, `Civ`, `Settlement`, `Tick`, `dist(a, b): number`, `clamp01(v): number`
- From `src/engine/rng.ts` (Task 2): `Rng`
- From `src/engine/society/influence.ts` (Task 27): `leaderOf(s: Settlement, ctx): Person | null`, `InfluenceCtxLike`
- Tests also use `createPerson` (Task 8), `makeTestCtx`/`makeTestCiv`/`makeTestSettlement` (Task 26)

Produces:
- `export interface ConflictCtxLike extends InfluenceCtxLike { civs: Civ[]; settlements: Settlement[] }` — deviation 1; extends `InfluenceCtxLike` so `leaderOf` is directly callable with this ctx.
- `export function updateConflict(ctx: ConflictCtxLike): void` — no-op unless `ctx.tick % RAID_CHECK_INTERVAL === 0` (15); for every settlement (ascending id) with a leader (`leaderOf`) satisfying `leader.traits.aggression > RAID_AGGRESSION_THRESHOLD` (0.6) AND (`foodPerCapita(settlement) < RAID_FOOD_THRESHOLD` (0.5) OR `revengeMemorySum(leader) > RAID_REVENGE_THRESHOLD` (0.5)): finds the nearest OTHER-civ settlement within `RAID_TARGET_MAX_DISTANCE` (30); if found, assembles a raid party (up to `RAID_PARTY_MAX_SIZE` (8) living members of the attacking settlement, ascending id, filtered to `traits.aggression > RAID_WILLING_AGGRESSION` (0.4) OR some relationship with `kind === 'loyalty'`-equivalent — see note below — `affinity > RAID_WILLING_LOYALTY` (0.7) to the leader), and resolves the raid via `resolveRaid`.
- `export function resolveRaid(attackers: Person[], defenders: Person[], attackerCiv: Civ, defenderCiv: Civ, defenderSettlement: Settlement, ctx: ConflictCtxLike): RaidResult` — `attackPower = sum(fighting skill of attackers) * (1 + 0.3 if attackerCiv.techs.includes('metallurgy') else 0)`; `defensePower = sum(fighting skill of defenders) * (1 + 0.5 if defenderSettlement.structures.wall > 0 else 0)`; the side with the higher power wins (ties favor the defender); the losing side takes `RAID_CASUALTY_MIN` (1) to `RAID_CASUALTY_MAX` (3) casualties (`ctx.rng.split('raid-casualties').int(...)`  picks the count, then that many distinct losers in ascending id order are chosen and each takes a `RAID_CASUALTY_HEALTH_HIT` (0.4) health hit, dying if health drops to 0 or below); if attackers win, they steal up to `RAID_STEAL_FRACTION` (0.3) of `defenderSettlement.stock.food`; both sides gain matching memories/grief/anger (`kind: 'defeat'`/`'victory'` per the contract, `kind: 'harmed'` for casualties) and every casualty's civ's `warWeariness` increases by `RAID_WEARINESS_PER_CASUALTY` (0.02) per own-side casualty.
- `export interface RaidResult { attackerWon: boolean; attackerCasualties: number[]; defenderCasualties: number[]; foodStolen: number }`.
- `export function updateWarState(ctx: ConflictCtxLike): void` — tracks raid counts between civ pairs via the extension property `_raidHistory: { otherCivId: number; timestamps: Tick[] }[]` on `Civ` (deviation 3); after `resolveRaid` records a raid timestamp for both civs against each other, if 3+ raids occurred between the same civ pair within `WAR_DECLARATION_WINDOW` (360 ticks = 1 year), both civs add each other to `atWarWith` (if not already present) and their raid counters (the timestamp list for that pair) reset; while both civs in `atWarWith` have `warWeariness > PEACE_WEARINESS_THRESHOLD` (0.7), peace is declared: both remove each other from `atWarWith`, both `warWeariness` reset to 0, and both raid counters for that pair reset. `updateWarState` also calls `maybeFormAlliances(ctx)` at the end of its own run (see below), so alliance evaluation happens on the same cadence as war/peace evaluation.
- `export function maybeFormAlliances(ctx: ConflictCtxLike): void` — spec section 6's "alliances" coverage (not in the contract's frozen `Civ` type, tracked via deviation 3's `_alliedWith: number[]` extension property on `Civ`). For every ordered pair of distinct civs (ascending id, each pair evaluated once): if the pair is NOT in `atWarWith` of either side, NOT already allied, has NO raids recorded against each other in `_raidHistory` within `ALLIANCE_LOOKBACK_WINDOW` (720 ticks), and both civs' `warWeariness < ALLIANCE_MAX_WEARINESS` (0.3, i.e. neither side is currently strained), the pair rolls `ctx.rng.split('alliance-<lowId>-<highId>-<tick>').chance(ALLIANCE_FORM_CHANCE)` (0.05 per eligible check); on success both civs add each other's id to `_alliedWith` (deduped). An alliance dissolves immediately (both sides remove each other from `_alliedWith`) the moment the pair enters `atWarWith` via `updateWarState`'s war-declaration step earlier in the same call — checked by `maybeFormAlliances` itself at the top of its loop before the eligibility checks above, so a pair can never be simultaneously allied and at war.
- `export function isAllied(civA: Civ, civB: Civ): boolean` — `true` iff `civB.id` is present in `civA`'s `_alliedWith` (absent/`undefined` treated as `[]`); used by `nearestOtherCivSettlement` to exclude allied civs' settlements from raid targeting, so an aggressive leader never raids an ally.
- Exported constants: `RAID_CHECK_INTERVAL = 15`, `RAID_AGGRESSION_THRESHOLD = 0.6`, `RAID_FOOD_THRESHOLD = 0.5`, `RAID_REVENGE_THRESHOLD = 0.5`, `RAID_TARGET_MAX_DISTANCE = 30`, `RAID_PARTY_MAX_SIZE = 8`, `RAID_WILLING_AGGRESSION = 0.4`, `RAID_WILLING_LOYALTY = 0.7`, `RAID_CASUALTY_MIN = 1`, `RAID_CASUALTY_MAX = 3`, `RAID_CASUALTY_HEALTH_HIT = 0.4`, `RAID_STEAL_FRACTION = 0.3`, `RAID_WEARINESS_PER_CASUALTY = 0.02`, `WAR_DECLARATION_WINDOW = 360`, `WAR_DECLARATION_MIN_RAIDS = 3`, `PEACE_WEARINESS_THRESHOLD = 0.7`, `ALLIANCE_LOOKBACK_WINDOW = 720`, `ALLIANCE_MAX_WEARINESS = 0.3`, `ALLIANCE_FORM_CHANCE = 0.05`.
- Note on "loyalty": the contract's fighter-willingness clause says "aggression>0.4 or loyalty>0.7"; `Person` has no scalar `loyalty` field (loyalty is a `Morality` axis and also a `RelationKind`). This module reads it as `p.morality.loyalty > RAID_WILLING_LOYALTY`, the direct morality-axis interpretation, since raid willingness is a per-person trait check consistent with how `RAID_AGGRESSION_THRESHOLD` reads `traits.aggression` — both are self-properties of the candidate fighter, not relationship-derived. This is recorded as part of this task's Produces (not a contract deviation — the contract line under-specified which `loyalty` it meant, and `Person.morality.loyalty` is the only scalar field with that exact name).

Wiring notes for Task 33 (binding):
- Task 33 tick step 5 calls `updateConflict(ctx)` between `tradeBetween` and `updateTechnology`, exactly as ordered in the contract.
- `updateWarState` is called internally by `updateConflict` at the end of its own run (after any raids this tick), not as a separate Task 33 wiring call — the contract lists conflict as a single `updateConflict(ctx)` entry point, so this task keeps `updateWarState` (and, transitively, `maybeFormAlliances`) as internally-invoked, separately-exported (and separately-testable) helpers.
- `revengeMemorySum(leader)` (private helper, not exported) sums `valence` (negated, since revenge grudges are negative-valence `harmed`/`kin-died`/`defeat` memories) times `salience` over the leader's memory for entries with `otherId`'s civ being the candidate target civ; simplified here (no target civ narrowing at trigger-check time) to sum of `-valence*salience` over memory kinds `'harmed'`, `'kin-died'`, `'defeat'` clamped to `[0, 1]`, matching "revenge memory sum>0.5" from the brief without requiring foreknowledge of which civ will be targeted.
- `isAllied` is exported for Task 34 (narration of alliance formation as a low-severity event) and any future diplomacy UI to reuse verbatim rather than reaching into the `_alliedWith` extension property directly.

- [ ] **Step 1: Write the failing conflict tests**

Create `tests/engine/society/conflict.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  ALLIANCE_FORM_CHANCE,
  ALLIANCE_MAX_WEARINESS,
  PEACE_WEARINESS_THRESHOLD,
  RAID_AGGRESSION_THRESHOLD,
  RAID_CASUALTY_HEALTH_HIT,
  RAID_CHECK_INTERVAL,
  RAID_FOOD_THRESHOLD,
  RAID_PARTY_MAX_SIZE,
  RAID_STEAL_FRACTION,
  RAID_TARGET_MAX_DISTANCE,
  RAID_WEARINESS_PER_CASUALTY,
  RAID_WILLING_AGGRESSION,
  WAR_DECLARATION_MIN_RAIDS,
  WAR_DECLARATION_WINDOW,
  isAllied,
  maybeFormAlliances,
  resolveRaid,
  updateConflict,
  updateWarState,
} from '../../../src/engine/society/conflict';
import { createPerson } from '../../../src/engine/agents/person';
import { makeTestCiv, makeTestCtx, makeTestSettlement } from '../../helpers/testCtx';
import type { Person } from '../../../src/shared/types';

function makePerson(id: number, civId: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, civId, 'fable', { x: 10, y: 10 }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  return p;
}

describe('resolveRaid', () => {
  it('attackers win when attack power exceeds defense power; steal up to 30% of food stock', () => {
    const ctx = makeTestCtx({ tick: 0 });
    const attackerCiv = makeTestCiv({ id: 0 });
    const defenderCiv = makeTestCiv({ id: 1 });
    const attacker = makePerson(1, 0, ctx);
    attacker.skills.fighting = 1;
    const defender = makePerson(2, 1, ctx);
    defender.skills.fighting = 0.1;
    const settlement = makeTestSettlement({
      id: 1,
      civId: 1,
      stock: { food: 100, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    });
    ctx.people = [attacker, defender];
    ctx.personById = new Map([[1, attacker], [2, defender]]);

    const result = resolveRaid([attacker], [defender], attackerCiv, defenderCiv, settlement, ctx);

    expect(result.attackerWon).toBe(true);
    expect(result.foodStolen).toBeCloseTo(100 * RAID_STEAL_FRACTION, 6);
    expect(settlement.stock.food).toBeCloseTo(100 - 100 * RAID_STEAL_FRACTION, 6);
    expect(result.defenderCasualties).toContain(2);
    expect(defender.health).toBeCloseTo(1 - RAID_CASUALTY_HEALTH_HIT, 6);
    expect(defenderCiv.warWeariness).toBeCloseTo(RAID_WEARINESS_PER_CASUALTY, 6);
  });

  it('defenders win ties; walls boost defense 1.5x and metallurgy boosts attack 1.3x', () => {
    const ctx = makeTestCtx({ tick: 0 });
    const attackerCiv = makeTestCiv({ id: 0, techs: ['metallurgy'] });
    const defenderCiv = makeTestCiv({ id: 1 });
    const attacker = makePerson(1, 0, ctx);
    attacker.skills.fighting = 1; // attackPower = 1 * 1.3 = 1.3
    const defender = makePerson(2, 1, ctx);
    defender.skills.fighting = 1; // base defense 1, with wall x1.5 -> 1.5, beats 1.3
    const settlement = makeTestSettlement({
      id: 1,
      civId: 1,
      stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 1, shrine: 0 },
    });
    ctx.people = [attacker, defender];
    ctx.personById = new Map([[1, attacker], [2, defender]]);

    const result = resolveRaid([attacker], [defender], attackerCiv, defenderCiv, settlement, ctx);

    expect(result.attackerWon).toBe(false);
    expect(result.foodStolen).toBe(0);
    expect(result.attackerCasualties).toContain(1);
  });

  it('casualties are bounded between RAID_CASUALTY_MIN and RAID_CASUALTY_MAX and never exceed the losing side size', () => {
    const ctx = makeTestCtx({ tick: 0 });
    const attackerCiv = makeTestCiv({ id: 0 });
    const defenderCiv = makeTestCiv({ id: 1 });
    const attacker = makePerson(1, 0, ctx);
    attacker.skills.fighting = 1;
    const defender = makePerson(2, 1, ctx); // only 1 defender: casualty count clamps to 1
    defender.skills.fighting = 0;
    const settlement = makeTestSettlement({ id: 1, civId: 1, stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 } });
    ctx.people = [attacker, defender];
    ctx.personById = new Map([[1, attacker], [2, defender]]);

    const result = resolveRaid([attacker], [defender], attackerCiv, defenderCiv, settlement, ctx);

    expect(result.defenderCasualties.length).toBeLessThanOrEqual(1);
    expect(result.defenderCasualties.length).toBeGreaterThanOrEqual(1);
  });
});

describe('updateConflict — raid triggering', () => {
  it('triggers a raid when an aggressive leader faces low food per capita, targeting the nearest other-civ settlement', () => {
    const attackerCiv = makeTestCiv({ id: 0 });
    const defenderCiv = makeTestCiv({ id: 1 });
    const ctx = makeTestCtx({ civs: [attackerCiv, defenderCiv], tick: RAID_CHECK_INTERVAL });
    const leader = makePerson(1, 0, ctx);
    leader.traits.aggression = RAID_AGGRESSION_THRESHOLD + 0.1;
    leader.influence = 1;
    leader.skills.fighting = 1;
    const fighter = makePerson(2, 0, ctx);
    fighter.traits.aggression = RAID_WILLING_AGGRESSION + 0.1;
    fighter.skills.fighting = 1;
    const attackerSettlement = makeTestSettlement({
      id: 1,
      civId: 0,
      center: { x: 10, y: 10 },
      memberIds: [1, 2],
      stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 }, // foodPerCapita 0 < 0.5
    });
    const defender = makePerson(3, 1, ctx);
    defender.skills.fighting = 0;
    const defenderSettlement = makeTestSettlement({
      id: 2,
      civId: 1,
      center: { x: 15, y: 10 }, // distance 5, within RAID_TARGET_MAX_DISTANCE
      memberIds: [3],
      stock: { food: 20, wood: 0, stone: 0, metal: 0, tools: 0 },
    });
    ctx.people = [leader, fighter, defender];
    ctx.personById = new Map([[1, leader], [2, fighter], [3, defender]]);
    ctx.settlements = [attackerSettlement, defenderSettlement];

    updateConflict(ctx);

    expect(RAID_TARGET_MAX_DISTANCE).toBe(30);
    expect(RAID_PARTY_MAX_SIZE).toBe(8);
    // Attackers heavily favored (2 fighters skill 1 vs 1 defender skill 0) -> attackers win, steal food
    expect(defenderSettlement.stock.food).toBeLessThan(20);
  });

  it('does not raid off the 15-tick interval (no-op boundary)', () => {
    const attackerCiv = makeTestCiv({ id: 0 });
    const defenderCiv = makeTestCiv({ id: 1 });
    const ctx = makeTestCtx({ civs: [attackerCiv, defenderCiv], tick: RAID_CHECK_INTERVAL + 1 });
    const leader = makePerson(1, 0, ctx);
    leader.traits.aggression = 1;
    leader.influence = 1;
    const attackerSettlement = makeTestSettlement({ id: 1, civId: 0, center: { x: 10, y: 10 }, memberIds: [1], stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const defender = makePerson(2, 1, ctx);
    const defenderSettlement = makeTestSettlement({ id: 2, civId: 1, center: { x: 15, y: 10 }, memberIds: [2], stock: { food: 20, wood: 0, stone: 0, metal: 0, tools: 0 } });
    ctx.people = [leader, defender];
    ctx.personById = new Map([[1, leader], [2, defender]]);
    ctx.settlements = [attackerSettlement, defenderSettlement];

    updateConflict(ctx);

    expect(defenderSettlement.stock.food).toBe(20);
  });

  it('does not raid when the leader is not aggressive enough and food/revenge conditions are unmet (no-op boundary)', () => {
    const attackerCiv = makeTestCiv({ id: 0 });
    const defenderCiv = makeTestCiv({ id: 1 });
    const ctx = makeTestCtx({ civs: [attackerCiv, defenderCiv], tick: RAID_CHECK_INTERVAL });
    const leader = makePerson(1, 0, ctx);
    leader.traits.aggression = RAID_AGGRESSION_THRESHOLD - 0.1; // below threshold
    leader.influence = 1;
    const attackerSettlement = makeTestSettlement({ id: 1, civId: 0, center: { x: 10, y: 10 }, memberIds: [1], stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const defender = makePerson(2, 1, ctx);
    const defenderSettlement = makeTestSettlement({ id: 2, civId: 1, center: { x: 15, y: 10 }, memberIds: [2], stock: { food: 20, wood: 0, stone: 0, metal: 0, tools: 0 } });
    ctx.people = [leader, defender];
    ctx.personById = new Map([[1, leader], [2, defender]]);
    ctx.settlements = [attackerSettlement, defenderSettlement];

    updateConflict(ctx);

    expect(defenderSettlement.stock.food).toBe(20);
  });

  it('does not raid a target beyond RAID_TARGET_MAX_DISTANCE (no-op boundary)', () => {
    const attackerCiv = makeTestCiv({ id: 0 });
    const defenderCiv = makeTestCiv({ id: 1 });
    const ctx = makeTestCtx({ civs: [attackerCiv, defenderCiv], tick: RAID_CHECK_INTERVAL });
    const leader = makePerson(1, 0, ctx);
    leader.traits.aggression = 1;
    leader.influence = 1;
    const attackerSettlement = makeTestSettlement({ id: 1, civId: 0, center: { x: 0, y: 0 }, memberIds: [1], stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 } });
    const defender = makePerson(2, 1, ctx);
    const defenderSettlement = makeTestSettlement({ id: 2, civId: 1, center: { x: 100, y: 100 }, memberIds: [2], stock: { food: 20, wood: 0, stone: 0, metal: 0, tools: 0 } });
    ctx.people = [leader, defender];
    ctx.personById = new Map([[1, leader], [2, defender]]);
    ctx.settlements = [attackerSettlement, defenderSettlement];

    updateConflict(ctx);

    expect(defenderSettlement.stock.food).toBe(20);
  });
});

describe('updateWarState', () => {
  it('declares war after 3+ raids between the same civ pair within a year', () => {
    const civA = makeTestCiv({ id: 0 });
    const civB = makeTestCiv({ id: 1 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 0 });

    const extA = civA as typeof civA & { _raidHistory: { otherCivId: number; timestamps: number[] }[] };
    extA._raidHistory = [{ otherCivId: 1, timestamps: [0, 100, 200] }];
    const extB = civB as typeof civB & { _raidHistory: { otherCivId: number; timestamps: number[] }[] };
    extB._raidHistory = [{ otherCivId: 0, timestamps: [0, 100, 200] }];
    ctx.tick = 250;

    updateWarState(ctx);

    expect(civA.atWarWith).toContain(1);
    expect(civB.atWarWith).toContain(0);
    expect(WAR_DECLARATION_MIN_RAIDS).toBe(3);
    expect(WAR_DECLARATION_WINDOW).toBe(360);
  });

  it('does not declare war with only 2 raids in the window (no-op boundary)', () => {
    const civA = makeTestCiv({ id: 0 });
    const civB = makeTestCiv({ id: 1 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 250 });
    const extA = civA as typeof civA & { _raidHistory: { otherCivId: number; timestamps: number[] }[] };
    extA._raidHistory = [{ otherCivId: 1, timestamps: [0, 100] }];
    const extB = civB as typeof civB & { _raidHistory: { otherCivId: number; timestamps: number[] }[] };
    extB._raidHistory = [{ otherCivId: 0, timestamps: [0, 100] }];

    updateWarState(ctx);

    expect(civA.atWarWith).not.toContain(1);
  });

  it('declares peace once both sides exceed the weariness threshold, resetting weariness and raid history', () => {
    const civA = makeTestCiv({ id: 0, atWarWith: [1], warWeariness: PEACE_WEARINESS_THRESHOLD + 0.1 });
    const civB = makeTestCiv({ id: 1, atWarWith: [0], warWeariness: PEACE_WEARINESS_THRESHOLD + 0.1 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 500 });

    updateWarState(ctx);

    expect(civA.atWarWith).not.toContain(1);
    expect(civB.atWarWith).not.toContain(0);
    expect(civA.warWeariness).toBe(0);
    expect(civB.warWeariness).toBe(0);
  });

  it('stays at war when only one side has crossed the weariness threshold (no-op boundary)', () => {
    const civA = makeTestCiv({ id: 0, atWarWith: [1], warWeariness: PEACE_WEARINESS_THRESHOLD + 0.1 });
    const civB = makeTestCiv({ id: 1, atWarWith: [0], warWeariness: 0.1 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 500 });

    updateWarState(ctx);

    expect(civA.atWarWith).toContain(1);
    expect(civB.atWarWith).toContain(0);
  });
});

describe('maybeFormAlliances / isAllied', () => {
  it('is never allied by default', () => {
    const civA = makeTestCiv({ id: 0 });
    const civB = makeTestCiv({ id: 1 });
    expect(isAllied(civA, civB)).toBe(false);
    expect(isAllied(civB, civA)).toBe(false);
  });

  it('forms an alliance between two peaceful, low-weariness, raid-free civs when the roll succeeds', () => {
    const civA = makeTestCiv({ id: 0, warWeariness: 0 });
    const civB = makeTestCiv({ id: 1, warWeariness: 0 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 0 });

    // Run many ticks to make an ALLIANCE_FORM_CHANCE=0.05 roll overwhelmingly likely at least once.
    for (let t = 0; t < 500 && !isAllied(civA, civB); t++) {
      ctx.tick = t;
      maybeFormAlliances(ctx);
    }

    expect(isAllied(civA, civB)).toBe(true);
    expect(isAllied(civB, civA)).toBe(true);
    expect(ALLIANCE_FORM_CHANCE).toBe(0.05);
  });

  it('does not ally civs that are at war with each other (no-op boundary)', () => {
    const civA = makeTestCiv({ id: 0, atWarWith: [1], warWeariness: 0 });
    const civB = makeTestCiv({ id: 1, atWarWith: [0], warWeariness: 0 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 0 });

    for (let t = 0; t < 500; t++) {
      ctx.tick = t;
      maybeFormAlliances(ctx);
    }

    expect(isAllied(civA, civB)).toBe(false);
  });

  it('does not ally civs whose weariness is at or above ALLIANCE_MAX_WEARINESS (no-op boundary)', () => {
    const civA = makeTestCiv({ id: 0, warWeariness: ALLIANCE_MAX_WEARINESS });
    const civB = makeTestCiv({ id: 1, warWeariness: 0 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 0 });

    for (let t = 0; t < 500; t++) {
      ctx.tick = t;
      maybeFormAlliances(ctx);
    }

    expect(isAllied(civA, civB)).toBe(false);
  });

  it('war declaration dissolves a standing alliance between the pair', () => {
    const civA = makeTestCiv({ id: 0, warWeariness: 0 });
    const civB = makeTestCiv({ id: 1, warWeariness: 0 });
    const ctx = makeTestCtx({ civs: [civA, civB], tick: 0 });
    for (let t = 0; t < 500 && !isAllied(civA, civB); t++) {
      ctx.tick = t;
      maybeFormAlliances(ctx);
    }
    expect(isAllied(civA, civB)).toBe(true);

    const extA = civA as typeof civA & { _raidHistory: { otherCivId: number; timestamps: number[] }[] };
    extA._raidHistory = [{ otherCivId: 1, timestamps: [1000, 1100, 1200] }];
    const extB = civB as typeof civB & { _raidHistory: { otherCivId: number; timestamps: number[] }[] };
    extB._raidHistory = [{ otherCivId: 0, timestamps: [1000, 1100, 1200] }];
    ctx.tick = 1250;

    updateWarState(ctx);

    expect(civA.atWarWith).toContain(1);
    expect(isAllied(civA, civB)).toBe(false);
    expect(isAllied(civB, civA)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```
npx vitest run tests/engine/society/conflict.test.ts
```

Expected: FAIL — module-resolution error: `Failed to resolve import "../../../src/engine/society/conflict"` (the file does not exist yet).

- [ ] **Step 3: Implement `src/engine/society/conflict.ts`**

Create `src/engine/society/conflict.ts` with exactly:

```ts
import { clamp01, dist, type Civ, type Person, type Settlement, type Tick } from '../../shared/types';
import { leaderOf, type InfluenceCtxLike } from './influence';

/** Deviation 1: extends InfluenceCtxLike so leaderOf(s, ctx) is directly callable. */
export interface ConflictCtxLike extends InfluenceCtxLike {
  civs: Civ[];
  settlements: Settlement[];
}

export interface RaidResult {
  attackerWon: boolean;
  attackerCasualties: number[];
  defenderCasualties: number[];
  foodStolen: number;
}

export const RAID_CHECK_INTERVAL = 15;
export const RAID_AGGRESSION_THRESHOLD = 0.6;
export const RAID_FOOD_THRESHOLD = 0.5;
export const RAID_REVENGE_THRESHOLD = 0.5;
export const RAID_TARGET_MAX_DISTANCE = 30;
export const RAID_PARTY_MAX_SIZE = 8;
export const RAID_WILLING_AGGRESSION = 0.4;
export const RAID_WILLING_LOYALTY = 0.7;
export const RAID_CASUALTY_MIN = 1;
export const RAID_CASUALTY_MAX = 3;
export const RAID_CASUALTY_HEALTH_HIT = 0.4;
export const RAID_STEAL_FRACTION = 0.3;
export const RAID_WEARINESS_PER_CASUALTY = 0.02;
export const WAR_DECLARATION_WINDOW = 360; // 1 year at YEAR_TICKS = 360
export const WAR_DECLARATION_MIN_RAIDS = 3;
export const PEACE_WEARINESS_THRESHOLD = 0.7;
export const ALLIANCE_LOOKBACK_WINDOW = 720; // 2 years at YEAR_TICKS = 360
export const ALLIANCE_MAX_WEARINESS = 0.3;
export const ALLIANCE_FORM_CHANCE = 0.05;

interface WithRaidHistory {
  _raidHistory?: { otherCivId: number; timestamps: Tick[] }[];
}

/** Deviation 3: alliance membership tracked outside the frozen Civ contract type. */
interface WithAlliance {
  _alliedWith?: number[];
}

/** True iff civB.id is present in civA's alliance list (absent treated as empty). */
export function isAllied(civA: Civ, civB: Civ): boolean {
  const ext = civA as Civ & WithAlliance;
  return (ext._alliedWith ?? []).includes(civB.id);
}

function foodPerCapita(s: Settlement): number {
  const pop = s.memberIds.length;
  if (pop === 0) return 0;
  return s.stock.food / pop;
}

function revengeMemorySum(p: Person): number {
  const relevantKinds = new Set(['harmed', 'kin-died', 'defeat']);
  let sum = 0;
  for (const m of p.memory) {
    if (relevantKinds.has(m.kind)) sum += -m.valence * m.salience;
  }
  return clamp01(sum);
}

function nearestOtherCivSettlement(
  from: Settlement,
  ctx: ConflictCtxLike,
): Settlement | null {
  const fromCiv = ctx.civs.find((c) => c.id === from.civId);
  let best: Settlement | null = null;
  let bestDist = Infinity;
  for (const s of [...ctx.settlements].sort((a, b) => a.id - b.id)) {
    if (s.civId === from.civId) continue;
    if (fromCiv !== undefined) {
      const targetCiv = ctx.civs.find((c) => c.id === s.civId);
      if (targetCiv !== undefined && isAllied(fromCiv, targetCiv)) continue; // never raid an ally
    }
    const d = dist(from.center, s.center);
    if (d > RAID_TARGET_MAX_DISTANCE) continue;
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/**
 * Combat resolution: attackPower = sum(fighting) * (1 + 0.3 metallurgy);
 * defensePower = sum(fighting) * (1 + 0.5 walls). Higher power wins (ties
 * favor the defender). The losing side takes 1-3 casualties (0.4 health hit
 * each, dying at <=0). Winning attackers steal up to 30% of the defender's
 * food stock. Both sides gain matching memories/emotions; own-side
 * casualties raise that side's civ warWeariness by 0.02 each.
 */
export function resolveRaid(
  attackers: Person[],
  defenders: Person[],
  attackerCiv: Civ,
  defenderCiv: Civ,
  defenderSettlement: Settlement,
  ctx: ConflictCtxLike,
): RaidResult {
  const attackPower =
    attackers.reduce((sum, p) => sum + p.skills.fighting, 0) *
    (attackerCiv.techs.includes('metallurgy') ? 1.3 : 1);
  const defensePower =
    defenders.reduce((sum, p) => sum + p.skills.fighting, 0) *
    (defenderSettlement.structures.wall > 0 ? 1.5 : 1);

  const attackerWon = attackPower > defensePower;
  const losers = (attackerWon ? defenders : attackers).slice().sort((a, b) => a.id - b.id);
  const loserCiv = attackerWon ? defenderCiv : attackerCiv;

  const casualtyRoll = ctx.rng.split(`raid-casualties-${ctx.tick}-${defenderSettlement.id}`);
  const casualtyCount = Math.min(
    losers.length,
    RAID_CASUALTY_MIN + casualtyRoll.int(RAID_CASUALTY_MAX - RAID_CASUALTY_MIN + 1),
  );
  const casualties = losers.slice(0, casualtyCount);

  for (const p of casualties) {
    p.health = Math.max(0, p.health - RAID_CASUALTY_HEALTH_HIT);
    if (p.health <= 0) {
      p.alive = false;
      p.causeOfDeath = 'violence';
    }
  }
  loserCiv.warWeariness = clamp01(loserCiv.warWeariness + casualties.length * RAID_WEARINESS_PER_CASUALTY);

  let foodStolen = 0;
  if (attackerWon) {
    foodStolen = defenderSettlement.stock.food * RAID_STEAL_FRACTION;
    defenderSettlement.stock.food -= foodStolen;
  }

  for (const p of attackers) {
    p.emotions.anger = clamp01(p.emotions.anger + (attackerWon ? 0.1 : 0.3));
    p.memory.unshift({
      tick: ctx.tick,
      kind: attackerWon ? 'victory' : 'defeat',
      otherId: defenders[0]?.id ?? -1,
      valence: attackerWon ? 0.6 : -0.6,
      salience: 0.7,
    });
  }
  for (const p of defenders) {
    p.emotions.fear = clamp01(p.emotions.fear + (attackerWon ? 0.4 : 0.1));
    p.emotions.anger = clamp01(p.emotions.anger + 0.2);
    p.memory.unshift({
      tick: ctx.tick,
      kind: attackerWon ? 'defeat' : 'victory',
      otherId: attackers[0]?.id ?? -1,
      valence: attackerWon ? -0.6 : 0.6,
      salience: 0.7,
    });
  }
  for (const p of casualties) {
    p.memory.unshift({ tick: ctx.tick, kind: 'harmed', otherId: -1, valence: -0.8, salience: 0.9 });
  }

  return {
    attackerWon,
    attackerCasualties: attackerWon ? [] : casualties.map((p) => p.id).sort((a, b) => a - b),
    defenderCasualties: attackerWon ? casualties.map((p) => p.id).sort((a, b) => a - b) : [],
    foodStolen,
  };
}

function recordRaid(attackerCiv: Civ, defenderCiv: Civ, tick: Tick): void {
  const a = attackerCiv as Civ & WithRaidHistory;
  const b = defenderCiv as Civ & WithRaidHistory;
  a._raidHistory = a._raidHistory ?? [];
  b._raidHistory = b._raidHistory ?? [];
  let entryA = a._raidHistory.find((e) => e.otherCivId === defenderCiv.id);
  if (entryA === undefined) {
    entryA = { otherCivId: defenderCiv.id, timestamps: [] };
    a._raidHistory.push(entryA);
  }
  entryA.timestamps.push(tick);
  let entryB = b._raidHistory.find((e) => e.otherCivId === attackerCiv.id);
  if (entryB === undefined) {
    entryB = { otherCivId: attackerCiv.id, timestamps: [] };
    b._raidHistory.push(entryB);
  }
  entryB.timestamps.push(tick);
}

/**
 * Every RAID_CHECK_INTERVAL ticks, per settlement (ascending id): an
 * aggressive leader (traits.aggression > 0.6) facing scarcity
 * (foodPerCapita < 0.5) or a grudge (revenge memory sum > 0.5) raids the
 * nearest other-civ settlement within RAID_TARGET_MAX_DISTANCE, fielding up
 * to RAID_PARTY_MAX_SIZE willing fighters (aggression > 0.4 or
 * morality.loyalty > 0.7).
 */
export function updateConflict(ctx: ConflictCtxLike): void {
  if (ctx.tick % RAID_CHECK_INTERVAL !== 0) return;

  for (const s of [...ctx.settlements].sort((a, b) => a.id - b.id)) {
    const leader = leaderOf(s, ctx);
    if (leader === null) continue;
    if (leader.traits.aggression <= RAID_AGGRESSION_THRESHOLD) continue;

    const scarce = foodPerCapita(s) < RAID_FOOD_THRESHOLD;
    const vengeful = revengeMemorySum(leader) > RAID_REVENGE_THRESHOLD;
    if (!scarce && !vengeful) continue;

    const target = nearestOtherCivSettlement(s, ctx);
    if (target === null) continue;

    const attackerCiv = ctx.civs.find((c) => c.id === s.civId);
    const defenderCiv = ctx.civs.find((c) => c.id === target.civId);
    if (attackerCiv === undefined || defenderCiv === undefined) continue;

    const willing = [...s.memberIds]
      .sort((a, b) => a - b)
      .map((id) => ctx.personById.get(id))
      .filter(
        (p): p is Person =>
          p !== undefined &&
          p.alive &&
          (p.traits.aggression > RAID_WILLING_AGGRESSION || p.morality.loyalty > RAID_WILLING_LOYALTY),
      )
      .slice(0, RAID_PARTY_MAX_SIZE);
    if (willing.length === 0) continue;

    const defenders = [...target.memberIds]
      .sort((a, b) => a - b)
      .map((id) => ctx.personById.get(id))
      .filter((p): p is Person => p !== undefined && p.alive);
    if (defenders.length === 0) continue;

    resolveRaid(willing, defenders, attackerCiv, defenderCiv, target, ctx);
    recordRaid(attackerCiv, defenderCiv, ctx.tick);
  }

  updateWarState(ctx);
}

/**
 * War declared once 3+ raids occur between the same civ pair within
 * WAR_DECLARATION_WINDOW ticks; peace declared once both civs' warWeariness
 * exceed PEACE_WEARINESS_THRESHOLD, resetting weariness and raid history for
 * that pair.
 */
export function updateWarState(ctx: ConflictCtxLike): void {
  const civs = [...ctx.civs].sort((a, b) => a.id - b.id);
  for (const civ of civs) {
    const ext = civ as Civ & WithRaidHistory;
    if (ext._raidHistory === undefined) continue;
    for (const entry of ext._raidHistory) {
      const recent = entry.timestamps.filter((t) => ctx.tick - t <= WAR_DECLARATION_WINDOW);
      entry.timestamps = recent;
      if (recent.length >= WAR_DECLARATION_MIN_RAIDS && !civ.atWarWith.includes(entry.otherCivId)) {
        civ.atWarWith.push(entry.otherCivId);
        const other = civs.find((c) => c.id === entry.otherCivId);
        if (other !== undefined && !other.atWarWith.includes(civ.id)) {
          other.atWarWith.push(civ.id);
        }
        entry.timestamps = [];
        const otherExt = other as (Civ & WithRaidHistory) | undefined;
        const otherEntry = otherExt?._raidHistory?.find((e) => e.otherCivId === civ.id);
        if (otherEntry !== undefined) otherEntry.timestamps = [];

        // Declaring war immediately dissolves any standing alliance between the pair.
        const civAlliance = civ as Civ & WithAlliance;
        civAlliance._alliedWith = (civAlliance._alliedWith ?? []).filter((id) => id !== entry.otherCivId);
        if (other !== undefined) {
          const otherAlliance = other as Civ & WithAlliance;
          otherAlliance._alliedWith = (otherAlliance._alliedWith ?? []).filter((id) => id !== civ.id);
        }
      }
    }
  }

  for (const civ of civs) {
    for (const otherId of [...civ.atWarWith]) {
      if (otherId < civ.id) continue; // process each pair once (lower id drives it)
      const other = civs.find((c) => c.id === otherId);
      if (other === undefined) continue;
      if (civ.warWeariness > PEACE_WEARINESS_THRESHOLD && other.warWeariness > PEACE_WEARINESS_THRESHOLD) {
        civ.atWarWith = civ.atWarWith.filter((id) => id !== other.id);
        other.atWarWith = other.atWarWith.filter((id) => id !== civ.id);
        civ.warWeariness = 0;
        other.warWeariness = 0;
      }
    }
  }

  maybeFormAlliances(ctx);
}

/**
 * Spec section 6 "alliances" coverage: for every distinct civ pair (ascending
 * id, each pair evaluated once) that is not at war, not already allied, has
 * no raids against each other within ALLIANCE_LOOKBACK_WINDOW, and both
 * sides have warWeariness below ALLIANCE_MAX_WEARINESS, roll
 * ALLIANCE_FORM_CHANCE per tick this function runs; on success both civs add
 * each other to their _alliedWith list (deviation 3 extension property).
 */
export function maybeFormAlliances(ctx: ConflictCtxLike): void {
  const civs = [...ctx.civs].sort((a, b) => a.id - b.id);
  for (const civA of civs) {
    for (const civB of civs) {
      if (civB.id <= civA.id) continue; // each unordered pair once, lower id drives it

      if (civA.atWarWith.includes(civB.id) || civB.atWarWith.includes(civA.id)) continue;
      if (isAllied(civA, civB) || isAllied(civB, civA)) continue;

      const historyA = (civA as Civ & WithRaidHistory)._raidHistory?.find((e) => e.otherCivId === civB.id);
      const historyB = (civB as Civ & WithRaidHistory)._raidHistory?.find((e) => e.otherCivId === civA.id);
      const recentRaid =
        (historyA?.timestamps.some((t) => ctx.tick - t <= ALLIANCE_LOOKBACK_WINDOW) ?? false) ||
        (historyB?.timestamps.some((t) => ctx.tick - t <= ALLIANCE_LOOKBACK_WINDOW) ?? false);
      if (recentRaid) continue;

      if (civA.warWeariness >= ALLIANCE_MAX_WEARINESS || civB.warWeariness >= ALLIANCE_MAX_WEARINESS) continue;

      const roll = ctx.rng.split(`alliance-${civA.id}-${civB.id}-${ctx.tick}`);
      if (!roll.chance(ALLIANCE_FORM_CHANCE)) continue;

      const extA = civA as Civ & WithAlliance;
      const extB = civB as Civ & WithAlliance;
      extA._alliedWith = [...(extA._alliedWith ?? []), civB.id].filter((id, i, arr) => arr.indexOf(id) === i);
      extB._alliedWith = [...(extB._alliedWith ?? []), civA.id].filter((id, i, arr) => arr.indexOf(id) === i);
    }
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:

```
npx vitest run tests/engine/society/conflict.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/society/conflict.test.ts (16 tests)

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
git add src/engine/society/conflict.ts tests/engine/society/conflict.test.ts
git commit -m "feat(society): conflict - raids, casualty resolution, war declaration and peace" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
