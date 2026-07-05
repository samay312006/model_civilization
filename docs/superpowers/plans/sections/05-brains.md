## Section 5: Brains (Tasks 20-25)

This section builds the Brain contract, a lineage registry, minimal placeholder brains that let everything compile and the conformance suite pass, then hands off the four real brain files to model-authored subagents — one per lineage — before closing with a 60-person mini-world integration test. Task 20 writes `src/engine/brains/types.ts` and `registry.ts` verbatim to the contract, four throwaway placeholder brain files (deliberately bland — Tasks 21-24 replace them wholesale), the conformance suite, and its perception-fixture test helper. Tasks 21-24 are dispatch tasks: each contains the complete authoring brief an engineer hands to a subagent running the matching Claude model, plus the mechanical steps to iterate until the conformance suite passes and commit. Task 25 closes the section with a 60-person, 4-lineage, 500-tick integration test using a simplified loop (no society modules — those arrive in Section 6). Every task in this section depends only on Tasks 1-19 (scaffold, rng, shared types, names, world, and every Section 3/4 agent module) plus, for Tasks 21-25, Task 20's own contract files. Every command below runs from the repo root `C:\simulation_exp`.

**Contract deviations in this section (recorded, deliberate):** none. `types.ts` and `registry.ts` are written verbatim to the frozen contract; the four brain files use the exact `Brain`/`Temperament` shapes with no structural substitutes, because by Task 20 `src/engine/brains/types.ts` exists and every downstream consumer (Task 19's `BrainLike`, Task 17's injected `brainInit`) is already structurally compatible with it per Section 4's own notes.

### Task 20: Brain contract, registry, placeholder brains, and conformance suite

**Files:**
- Create: `src/engine/brains/types.ts`
- Create: `src/engine/brains/registry.ts`
- Create: `src/engine/brains/opus.ts` (placeholder — replaced wholesale in Task 21)
- Create: `src/engine/brains/sonnet.ts` (placeholder — replaced wholesale in Task 22)
- Create: `src/engine/brains/haiku.ts` (placeholder — replaced wholesale in Task 23)
- Create: `src/engine/brains/fable.ts` (placeholder — replaced wholesale in Task 24)
- Create: `tests/helpers/perceptionFixture.ts`
- Test: `tests/engine/brains/conformance.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Lineage`, `LINEAGES`, `Person`, `Action`, `ActionKind`, `ACTION_KINDS`, `ScoredAction`, `Emotions`, `Vec2`, `Terrain`, `Season`, `TechId`, `Tick`, `clamp01(v): number`
- From `src/engine/rng.ts` (Task 2): `Rng`, `createRng(seed: number): Rng`
- From `src/engine/agents/person.ts` (Task 8): `createPerson(id, civId, lineage, pos, names, rng): Person`
- From `src/engine/names.ts` (Task 4): `NameGen`, `makeNameGenerator(rng: Rng): NameGen`
- From `src/engine/agents/perception.ts` (Task 16): `Perception`, `PersonGlimpse`, `TileGlimpse`, `SettlementGlimpse`, `CivGlimpse`, `DangerGlimpse`
- From `src/engine/agents/execute.ts` (Task 15): `Outcome { action: Action; success: boolean; reward: number; tick: Tick }`

Produces:
- `src/engine/brains/types.ts`: `export interface Temperament { emotionVolatility: Emotions; emotionDecayPerTick: Emotions; moralWeight: number; learningRate: number; imitationRate: number; desperationThreshold: number; taboos: ActionKind[]; quirks: string[]; description: string }` and `export interface Brain { readonly lineage: Lineage; temperament(): Temperament; init(person: Person, rng: Rng): unknown; decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[]; onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void }` — both verbatim per contract.
- `src/engine/brains/registry.ts`: `export function getBrain(lineage: Lineage): Brain` and `export function allBrains(): Brain[]` — verbatim per contract, importing the four named brain exports below.
- `src/engine/brains/opus.ts`: `export const opusBrain: Brain`
- `src/engine/brains/sonnet.ts`: `export const sonnetBrain: Brain`
- `src/engine/brains/haiku.ts`: `export const haikuBrain: Brain`
- `src/engine/brains/fable.ts`: `export const fableBrain: Brain`
- `tests/helpers/perceptionFixture.ts`: `export function makePerceptionFixture(rng: Rng, overrides?: Partial<FixtureOverrides>): { person: Person; perception: Perception }` and `export interface FixtureOverrides { lineage: Lineage; hunger: number; fear: number; numCandidates: number; numNearbyPeople: number }` — a tiny hand-built world/person/perception generator used by the conformance suite and reusable by Task 25.

Wiring notes for Task 33 (binding):
- Task 33 imports `getBrain` from `registry.ts` and calls `getBrain(person.lineage)` at every call site the earlier sections already documented (`updateLifecycle`'s injected `brainInit`, `decide.ts`'s `chooseAction`, `learning.ts`'s `reinforce`/`maybeImitate` temperament lookups, `execute.ts`'s `emotionVolatility` parameter).
- Every real brain (`opusBrain`, `sonnetBrain`, `haikuBrain`, `fableBrain`) is a `Brain`, which is assignable everywhere `BrainLike` (Task 19) or `MoralityTemperament`/`GateTemperament` (Tasks 11, 19) is expected — no adapter code is needed anywhere downstream.

- [ ] **Step 1: Write `src/engine/brains/types.ts`**

Create `src/engine/brains/types.ts` with exactly:

```ts
import type { Action, ActionKind, Emotions, Lineage, Person, ScoredAction } from '../../shared/types';
import type { Rng } from '../rng';
import type { Outcome } from '../agents/execute';
import type { Perception } from '../agents/perception';

/**
 * Lineage-specific tuning returned by Brain.temperament(). Must be constant
 * across calls (the same lineage always returns the same Temperament by
 * value) and must satisfy the documented ranges:
 *   emotionVolatility: each field 0.25..4 (multiplier on emotion impulses)
 *   emotionDecayPerTick: each field 0..0.2 (decay toward baseline per tick)
 *   moralWeight: 0..2
 *   learningRate: 0..1
 *   imitationRate: 0..1
 *   desperationThreshold: 0..1 (1 = morality never breaks under desperation)
 */
export interface Temperament {
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

/**
 * A Brain is a pure decision policy: it reads a Perception and a per-agent
 * brainState and returns scored candidate actions. Brains may not touch the
 * network, the DOM, or any global mutable state, and may hold no state of
 * their own beyond the JSON-serializable brainState object threaded through
 * init/decide/onOutcome by the caller.
 */
export interface Brain {
  readonly lineage: Lineage;
  /** Must be constant per lineage: repeated calls return equal values. */
  temperament(): Temperament;
  /** Returns a fresh JSON-serializable plain object: the agent's initial brainState. */
  init(person: Person, rng: Rng): unknown;
  /** Returns scored actions; only those present in perception.candidates with finite score >= 0 are used. */
  decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[];
  /** May mutate brainState only; must never throw. */
  onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void;
}

// Re-exported for brief authors who only import from this file.
export type { Action, ActionKind, Outcome, Perception, ScoredAction };
```

- [ ] **Step 2: Write `src/engine/brains/registry.ts`**

Create `src/engine/brains/registry.ts` with exactly:

```ts
import type { Lineage } from '../../shared/types';
import type { Brain } from './types';
import { opusBrain } from './opus';
import { sonnetBrain } from './sonnet';
import { haikuBrain } from './haiku';
import { fableBrain } from './fable';

const REGISTRY: Record<Lineage, Brain> = {
  opus: opusBrain,
  sonnet: sonnetBrain,
  haiku: haikuBrain,
  fable: fableBrain,
};

/** Returns the Brain implementation for a lineage. */
export function getBrain(lineage: Lineage): Brain {
  return REGISTRY[lineage];
}

/** Returns all four brains in LINEAGES order (opus, sonnet, haiku, fable). */
export function allBrains(): Brain[] {
  return [REGISTRY.opus, REGISTRY.sonnet, REGISTRY.haiku, REGISTRY.fable];
}
```

- [ ] **Step 3: Write the four placeholder brain files**

Create `src/engine/brains/opus.ts` with exactly:

```ts
import type { Brain, Outcome, Perception } from './types';
import type { Person, ScoredAction } from '../../shared/types';
import type { Rng } from '../rng';

// placeholder — replaced by model authoring in Task 21-24
export const opusBrain: Brain = {
  lineage: 'opus',
  temperament: () => ({
    emotionVolatility: { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 },
    emotionDecayPerTick: { fear: 0.02, joy: 0.02, grief: 0.02, anger: 0.02, hope: 0.02 },
    moralWeight: 1,
    learningRate: 0.5,
    imitationRate: 0.1,
    desperationThreshold: 0.9,
    taboos: [],
    quirks: [],
    description: 'placeholder — replaced by model authoring in Task 21-24',
  }),
  init: (_person: Person, _rng: Rng): unknown => ({}),
  decide: (perception: Perception, _brainState: unknown, _rng: Rng): ScoredAction[] =>
    perception.candidates.map((action) => ({ action, score: 1.0 })),
  onOutcome: (_outcome: Outcome, _brainState: unknown, _rng: Rng): void => {
    // placeholder — replaced by model authoring in Task 21-24
  },
};
```

Create `src/engine/brains/sonnet.ts` with exactly:

```ts
import type { Brain, Outcome, Perception } from './types';
import type { Person, ScoredAction } from '../../shared/types';
import type { Rng } from '../rng';

// placeholder — replaced by model authoring in Task 21-24
export const sonnetBrain: Brain = {
  lineage: 'sonnet',
  temperament: () => ({
    emotionVolatility: { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 },
    emotionDecayPerTick: { fear: 0.02, joy: 0.02, grief: 0.02, anger: 0.02, hope: 0.02 },
    moralWeight: 1,
    learningRate: 0.5,
    imitationRate: 0.1,
    desperationThreshold: 0.9,
    taboos: [],
    quirks: [],
    description: 'placeholder — replaced by model authoring in Task 21-24',
  }),
  init: (_person: Person, _rng: Rng): unknown => ({}),
  decide: (perception: Perception, _brainState: unknown, _rng: Rng): ScoredAction[] =>
    perception.candidates.map((action) => ({ action, score: 1.0 })),
  onOutcome: (_outcome: Outcome, _brainState: unknown, _rng: Rng): void => {
    // placeholder — replaced by model authoring in Task 21-24
  },
};
```

Create `src/engine/brains/haiku.ts` with exactly:

```ts
import type { Brain, Outcome, Perception } from './types';
import type { Person, ScoredAction } from '../../shared/types';
import type { Rng } from '../rng';

// placeholder — replaced by model authoring in Task 21-24
export const haikuBrain: Brain = {
  lineage: 'haiku',
  temperament: () => ({
    emotionVolatility: { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 },
    emotionDecayPerTick: { fear: 0.02, joy: 0.02, grief: 0.02, anger: 0.02, hope: 0.02 },
    moralWeight: 1,
    learningRate: 0.5,
    imitationRate: 0.1,
    desperationThreshold: 0.9,
    taboos: [],
    quirks: [],
    description: 'placeholder — replaced by model authoring in Task 21-24',
  }),
  init: (_person: Person, _rng: Rng): unknown => ({}),
  decide: (perception: Perception, _brainState: unknown, _rng: Rng): ScoredAction[] =>
    perception.candidates.map((action) => ({ action, score: 1.0 })),
  onOutcome: (_outcome: Outcome, _brainState: unknown, _rng: Rng): void => {
    // placeholder — replaced by model authoring in Task 21-24
  },
};
```

Create `src/engine/brains/fable.ts` with exactly:

```ts
import type { Brain, Outcome, Perception } from './types';
import type { Person, ScoredAction } from '../../shared/types';
import type { Rng } from '../rng';

// placeholder — replaced by model authoring in Task 21-24
export const fableBrain: Brain = {
  lineage: 'fable',
  temperament: () => ({
    emotionVolatility: { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 },
    emotionDecayPerTick: { fear: 0.02, joy: 0.02, grief: 0.02, anger: 0.02, hope: 0.02 },
    moralWeight: 1,
    learningRate: 0.5,
    imitationRate: 0.1,
    desperationThreshold: 0.9,
    taboos: [],
    quirks: [],
    description: 'placeholder — replaced by model authoring in Task 21-24',
  }),
  init: (_person: Person, _rng: Rng): unknown => ({}),
  decide: (perception: Perception, _brainState: unknown, _rng: Rng): ScoredAction[] =>
    perception.candidates.map((action) => ({ action, score: 1.0 })),
  onOutcome: (_outcome: Outcome, _brainState: unknown, _rng: Rng): void => {
    // placeholder — replaced by model authoring in Task 21-24
  },
};
```

- [ ] **Step 4: Confirm the registry compiles**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors. This confirms `types.ts`, `registry.ts`, and the four placeholders compile together before the conformance suite is written.

- [ ] **Step 5: Write the perception fixture test helper**

Create `tests/helpers/perceptionFixture.ts` with exactly:

```ts
import { createPerson } from '../../src/engine/agents/person';
import { makeNameGenerator } from '../../src/engine/names';
import type { Rng } from '../../src/engine/rng';
import type {
  CivGlimpse,
  DangerGlimpse,
  Perception,
  PersonGlimpse,
  SettlementGlimpse,
  TileGlimpse,
} from '../../src/engine/agents/perception';
import {
  ACTION_KINDS,
  type Action,
  type ActionKind,
  type Lineage,
  type Person,
} from '../../src/shared/types';

/** Overrides accepted by makePerceptionFixture; every field optional. */
export interface FixtureOverrides {
  lineage: Lineage;
  hunger: number;
  fear: number;
  numCandidates: number;
  numNearbyPeople: number;
}

const ALL_LINEAGES: Lineage[] = ['opus', 'sonnet', 'haiku', 'fable'];

/**
 * Deterministic tiny-world Person + Perception builder for brain tests.
 * Does not depend on World/SpatialIndex/Settlement machinery — it hand-rolls
 * a flat plains neighborhood and a handful of candidate actions so brain
 * conformance tests stay fast and self-contained.
 */
export function makePerceptionFixture(
  rng: Rng,
  overrides: Partial<FixtureOverrides> = {},
): { person: Person; perception: Perception } {
  const names = makeNameGenerator(rng.split('fixture-names'));
  const lineage = overrides.lineage ?? ALL_LINEAGES[rng.int(ALL_LINEAGES.length)] as Lineage;
  const person = createPerson(1, 0, lineage, { x: 10, y: 10 }, names, rng.split('fixture-person'));

  const hunger = overrides.hunger ?? rng.next();
  const fear = overrides.fear ?? rng.next();
  person.needs.hunger = hunger;
  person.emotions.fear = fear;

  const numCandidates = overrides.numCandidates ?? 1 + rng.int(ACTION_KINDS.length);
  const numNearbyPeople = overrides.numNearbyPeople ?? rng.int(6);

  // Candidates: a deterministic-but-varied subset of ACTION_KINDS, always
  // including 'rest' so decide() always has at least one safe option.
  const candidateKinds = new Set<ActionKind>(['rest']);
  const shuffled = [...ACTION_KINDS];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = shuffled[i] as ActionKind;
    shuffled[i] = shuffled[j] as ActionKind;
    shuffled[j] = tmp;
  }
  for (const kind of shuffled) {
    if (candidateKinds.size >= numCandidates) break;
    candidateKinds.add(kind);
  }
  const candidates: Action[] = [...candidateKinds].map((kind) => {
    if (kind === 'attack' || kind === 'steal' || kind === 'share' || kind === 'trade' || kind === 'heal' || kind === 'teach' || kind === 'court') {
      return { kind, targetPersonId: 2 };
    }
    if (kind === 'migrate' || kind === 'build') {
      return { kind, tile: { x: 11, y: 10 } };
    }
    return { kind };
  });

  const nearbyPeople: PersonGlimpse[] = [];
  for (let i = 0; i < numNearbyPeople; i++) {
    const otherLineage = ALL_LINEAGES[rng.int(ALL_LINEAGES.length)] as Lineage;
    nearbyPeople.push({
      id: 2 + i,
      lineage: otherLineage,
      civId: 0,
      settlementId: null,
      pos: { x: 10 + (i % 3) - 1, y: 10 },
      influence: rng.next(),
      healthy: rng.chance(0.8),
      visibleEmotion: 'calm',
      affinity: rng.range(-1, 1),
      kin: rng.chance(0.2),
    });
  }

  const nearbyTiles: TileGlimpse[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      nearbyTiles.push({
        pos: { x: 10 + dx, y: 10 + dy },
        terrain: 'plains',
        food: rng.range(0, 5),
        wood: rng.range(0, 5),
        stone: rng.range(0, 5),
        metal: rng.range(0, 2),
      });
    }
  }

  const civ: CivGlimpse = {
    id: 0,
    population: 1 + numNearbyPeople,
    atWarWith: [],
    techs: [],
    season: 'spring',
    foodPerCapita: rng.range(0, 3),
  };

  const dangers: DangerGlimpse[] = rng.chance(0.3)
    ? [{ kind: 'famine', pos: { x: 10, y: 10 }, intensity: rng.next() }]
    : [];

  const settlement: SettlementGlimpse | null = null;

  const perception: Perception = {
    tick: rng.int(100000),
    self: person,
    candidates,
    nearbyPeople,
    nearbyTiles,
    settlement,
    nearbySettlements: [],
    civ,
    dangers,
  };

  return { person, perception };
}
```

- [ ] **Step 6: Write the failing conformance suite**

Create `tests/engine/brains/conformance.test.ts` with exactly:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allBrains } from '../../../src/engine/brains/registry';
import type { Brain } from '../../../src/engine/brains/types';
import { createRng } from '../../../src/engine/rng';
import { ACTION_KINDS, LINEAGES } from '../../../src/shared/types';
import { makePerceptionFixture } from '../../helpers/perceptionFixture';

const BRAIN_FILES: Record<string, string> = {
  opus: 'src/engine/brains/opus.ts',
  sonnet: 'src/engine/brains/sonnet.ts',
  haiku: 'src/engine/brains/haiku.ts',
  fable: 'src/engine/brains/fable.ts',
};

const ALLOWED_IMPORT_PREFIXES = [
  '../../shared/types',
  '../rng',
  './types',
  '../agents/perception',
];

function actionKey(kind: string, targetPersonId?: number, tile?: { x: number; y: number }, structure?: string): string {
  const target = targetPersonId ?? 'none';
  const t = tile ? `${tile.x},${tile.y}` : 'none';
  const s = structure ?? 'none';
  return `${kind}|${target}|${t}|${s}`;
}

describe.each(allBrains().map((b) => [b.lineage, b] as const))('brain conformance: %s', (lineageName, brain: Brain) => {
  it('has a lineage field matching the registry key', () => {
    expect(brain.lineage).toBe(lineageName);
  });

  it('temperament fields are within documented ranges and constant across calls', () => {
    const t1 = brain.temperament();
    const t2 = brain.temperament();
    expect(t1).toEqual(t2);

    for (const key of ['fear', 'joy', 'grief', 'anger', 'hope'] as const) {
      expect(t1.emotionVolatility[key]).toBeGreaterThanOrEqual(0.25);
      expect(t1.emotionVolatility[key]).toBeLessThanOrEqual(4);
      expect(Number.isFinite(t1.emotionVolatility[key])).toBe(true);
      expect(t1.emotionDecayPerTick[key]).toBeGreaterThanOrEqual(0);
      expect(t1.emotionDecayPerTick[key]).toBeLessThanOrEqual(0.2);
      expect(Number.isFinite(t1.emotionDecayPerTick[key])).toBe(true);
    }
    expect(t1.moralWeight).toBeGreaterThanOrEqual(0);
    expect(t1.moralWeight).toBeLessThanOrEqual(2);
    expect(t1.learningRate).toBeGreaterThanOrEqual(0);
    expect(t1.learningRate).toBeLessThanOrEqual(1);
    expect(t1.imitationRate).toBeGreaterThanOrEqual(0);
    expect(t1.imitationRate).toBeLessThanOrEqual(1);
    expect(t1.desperationThreshold).toBeGreaterThanOrEqual(0);
    expect(t1.desperationThreshold).toBeLessThanOrEqual(1);
    for (const taboo of t1.taboos) {
      expect(ACTION_KINDS).toContain(taboo);
    }
    expect(Array.isArray(t1.quirks)).toBe(true);
    expect(typeof t1.description).toBe('string');
    expect(t1.description.length).toBeGreaterThan(0);
  });

  it('init returns a JSON-round-trippable plain object', () => {
    const rng = createRng(1);
    const { person } = makePerceptionFixture(rng, { lineage: lineageName });
    const state = brain.init(person, rng);
    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(roundTripped).toEqual(state);
  });

  it('decide returns only candidate actions with finite scores >= 0, across 200 randomized perceptions', () => {
    const rng = createRng(42);
    for (let i = 0; i < 200; i++) {
      const { person, perception } = makePerceptionFixture(rng, { lineage: lineageName });
      const brainState = brain.init(person, rng.split(`init-${i}`));
      const scored = brain.decide(perception, brainState, rng.split(`decide-${i}`));

      expect(Array.isArray(scored)).toBe(true);
      const candidateKeys = new Set(
        perception.candidates.map((a) => actionKey(a.kind, a.targetPersonId, a.tile, a.structure)),
      );
      for (const s of scored) {
        expect(s.action).toBeDefined();
        const key = actionKey(s.action.kind, s.action.targetPersonId, s.action.tile, s.action.structure);
        expect(candidateKeys.has(key)).toBe(true);
        expect(Number.isFinite(s.score)).toBe(true);
        expect(s.score).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('determinism: same seed produces identical decisions', () => {
    const runOnce = (): string[] => {
      const rng = createRng(777);
      const results: string[] = [];
      for (let i = 0; i < 50; i++) {
        const { person, perception } = makePerceptionFixture(rng, { lineage: lineageName });
        const brainState = brain.init(person, rng.split(`init-${i}`));
        const scored = brain.decide(perception, brainState, rng.split(`decide-${i}`));
        results.push(JSON.stringify(scored));
      }
      return results;
    };
    expect(runOnce()).toEqual(runOnce());
  });

  it('performance: 1000 decide calls complete in under 1000ms total', () => {
    const rng = createRng(9001);
    const fixtures = Array.from({ length: 1000 }, (_, i) => {
      const { person, perception } = makePerceptionFixture(rng, { lineage: lineageName });
      const brainState = brain.init(person, rng.split(`perf-init-${i}`));
      return { perception, brainState };
    });
    const decideRng = createRng(1);
    const start = performance.now();
    for (const f of fixtures) {
      brain.decide(f.perception, f.brainState, decideRng);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });

  it('onOutcome never throws and leaves state JSON-serializable', () => {
    const rng = createRng(55);
    const { person, perception } = makePerceptionFixture(rng, { lineage: lineageName });
    const brainState = brain.init(person, rng);
    const outcomeKinds: Array<{ success: boolean; reward: number }> = [
      { success: true, reward: 1 },
      { success: false, reward: -1 },
      { success: true, reward: 0 },
    ];
    for (const { success, reward } of outcomeKinds) {
      const action = perception.candidates[0] ?? { kind: 'rest' as const };
      expect(() => {
        brain.onOutcome({ action, success, reward, tick: perception.tick }, brainState, rng);
      }).not.toThrow();
      const roundTripped = JSON.parse(JSON.stringify(brainState));
      expect(roundTripped).toEqual(brainState);
    }
  });

  it('module source contains no forbidden imports', () => {
    const filePath = path.join(process.cwd(), BRAIN_FILES[lineageName] as string);
    const source = readFileSync(filePath, 'utf-8');
    const importLines = source
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('import '));

    expect(importLines.length).toBeGreaterThan(0);

    for (const line of importLines) {
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      expect(match).not.toBeNull();
      const importPath = (match as RegExpMatchArray)[1] as string;
      const isAllowed = ALLOWED_IMPORT_PREFIXES.some((prefix) => importPath === prefix || importPath.startsWith(prefix));
      expect(isAllowed, `disallowed import "${importPath}" in ${BRAIN_FILES[lineageName]}`).toBe(true);
    }

    expect(source).not.toMatch(/\bdocument\./);
    expect(source).not.toMatch(/\bwindow\./);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/\bDate\.now\(/);
    expect(source).not.toMatch(/new Date\(/);
  });
});

describe('allBrains and getBrain', () => {
  it('allBrains returns exactly the four lineages in LINEAGES order', () => {
    const brains = allBrains();
    expect(brains.map((b) => b.lineage)).toEqual([...LINEAGES]);
  });
});
```

- [ ] **Step 7: Run the conformance suite and confirm it passes against the placeholders**

Run:

```
npx vitest run tests/engine/brains/conformance.test.ts
```

Expected: PASS —

```
 ✓ tests/engine/brains/conformance.test.ts (4 test files pattern via describe.each: 8 tests x 4 lineages + 1 = 33 tests)

 Test Files  1 passed (1)
      Tests  33 passed (33)
```

(The placeholder brains score every candidate `1.0` with a bland, in-range temperament and a plain `{}`-returning `init`, so every check above passes trivially. This is expected and required at this step — Tasks 21-24 replace the brain files wholesale, and the same suite must still pass after each replacement.)

- [ ] **Step 8: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 9: Commit**

Run:

```
git add src/engine/brains/types.ts src/engine/brains/registry.ts src/engine/brains/opus.ts src/engine/brains/sonnet.ts src/engine/brains/haiku.ts src/engine/brains/fable.ts tests/helpers/perceptionFixture.ts tests/engine/brains/conformance.test.ts
git commit -m "feat(brains): Brain contract, registry, placeholder lineages, and conformance suite" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 21: Author the Opus brain (`src/engine/brains/opus.ts`)

**Execution note: Dispatch this task to a subagent with Agent tool `model: opus`. Do NOT let any other model write this file.** The engineer running this task must not write `opus.ts` themselves and must not let a different model touch its decision logic — only mechanical syntax fixes are permitted outside the authoring model (see the rule at the end of this task).

**Files:**
- Modify (full rewrite): `src/engine/brains/opus.ts`
- Test (already exists, unmodified): `tests/engine/brains/conformance.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `Lineage`, `ActionKind`, `ACTION_KINDS`, `Action`, `ScoredAction`, `Emotions`, `Person`, `Vec2`, `Terrain`, `Season`, `TechId`
- From `src/engine/rng.ts` (Task 2): `Rng`
- From `src/engine/brains/types.ts` (Task 20): `Brain`, `Temperament`
- From `src/engine/agents/perception.ts` (Task 16): `Perception`, `PersonGlimpse`, `TileGlimpse`, `SettlementGlimpse`, `CivGlimpse`, `DangerGlimpse`

Produces:
- `export const opusBrain: Brain` — replaces the Task 20 placeholder wholesale. Must pass `tests/engine/brains/conformance.test.ts` unmodified.

**The authoring brief to hand the Opus subagent (verbatim — do not paraphrase when dispatching):**

> You are authoring the decision-making brain for the Opus lineage of people in Genesis, a browser-based civilization simulator with zero LLM usage at runtime. Your code is the actual, permanent policy that governs how every Opus-lineage person thinks and acts for the entire life of this project. You are not simulating an AI — you are designing a *character*: a way of seeing the world that this lineage's people will embody for thousands of simulated ticks across many runs. Style is entirely up to you; only the interface contract below is fixed.
>
> **Your task:** write the complete contents of `src/engine/brains/opus.ts`, exporting `export const opusBrain: Brain`. This file replaces a bland placeholder wholesale. It must compile under TypeScript strict mode and pass the conformance suite described below, unmodified.
>
> **The frozen interface you must implement, verbatim:**
>
> ```ts
> export interface Temperament {
>   emotionVolatility: Emotions;       // multipliers, each field 0.25..4
>   emotionDecayPerTick: Emotions;     // each field 0..0.2
>   moralWeight: number;               // 0..2
>   learningRate: number;              // 0..1
>   imitationRate: number;             // 0..1
>   desperationThreshold: number;      // 0..1 (1 = morality never breaks)
>   taboos: ActionKind[];
>   quirks: string[];                  // short human-readable, shown in UI
>   description: string;               // one paragraph philosophy, shown in UI
> }
> export interface Brain {
>   readonly lineage: Lineage;
>   temperament(): Temperament;                                                   // must be constant per lineage
>   init(person: Person, rng: Rng): unknown;                                      // returns fresh JSON-serializable brainState
>   decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[];
>   onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void;             // may mutate brainState only
> }
> ```
> where `Emotions { fear: number; joy: number; grief: number; anger: number; hope: number }` (all 0..1), `ActionKind` is one of `'gather' | 'farm' | 'hunt' | 'build' | 'craft' | 'rest' | 'socialize' | 'court' | 'teach' | 'trade' | 'share' | 'steal' | 'attack' | 'flee' | 'migrate' | 'worship' | 'explore' | 'heal'`, `ScoredAction { action: Action; score: number }` (score must be finite and `>= 0`), and `Outcome { action: Action; success: boolean; reward: number; tick: number }` (reward in `[-1, 1]`). Your `opusBrain.lineage` must be the literal string `'opus'`.
>
> **The full shape of what you perceive every tick (`Perception` and its glimpses), verbatim:**
>
> ```ts
> export interface PersonGlimpse { id: number; lineage: Lineage; civId: number; settlementId: number | null; pos: Vec2; influence: number; healthy: boolean; visibleEmotion: 'calm' | 'afraid' | 'angry' | 'joyful' | 'grieving'; affinity: number; kin: boolean }
> export interface TileGlimpse { pos: Vec2; terrain: Terrain; food: number; wood: number; stone: number; metal: number }
> export interface SettlementGlimpse { id: number; civId: number; center: Vec2; population: number; foodStock: number; hasGranary: boolean; hasWall: boolean; underAttack: boolean }
> export interface CivGlimpse { id: number; population: number; atWarWith: number[]; techs: TechId[]; season: Season; foodPerCapita: number }
> export interface DangerGlimpse { kind: 'raid' | 'disease' | 'famine'; pos: Vec2 | null; intensity: number }
> export interface Perception {
>   tick: number;
>   self: Person;                          // the full Person record: traits, emotions, morality, needs, skills, memory, relationships, inventory, actionWeights, brainState, etc.
>   candidates: Action[];                  // the ONLY actions you may score — anything else is discarded by the caller
>   nearbyPeople: PersonGlimpse[];         // within perception radius
>   nearbyTiles: TileGlimpse[];            // within perception radius
>   settlement: SettlementGlimpse | null;  // self's settlement, if any
>   nearbySettlements: SettlementGlimpse[];
>   civ: CivGlimpse;
>   dangers: DangerGlimpse[];
> }
> ```
> `Terrain` is `'water' | 'plains' | 'forest' | 'mountain' | 'desert'`. `Action { kind: ActionKind; targetPersonId?: number; tile?: Vec2; structure?: StructureKind }`.
>
> **The sandbox — the ONLY modules you may import from:**
> - `src/shared/types.ts`
> - `src/engine/rng.ts`
> - `src/engine/brains/types.ts`
> - `src/engine/agents/perception.ts`
>
> No other imports. No network calls, no DOM, no `document`/`window`/`fetch`, no global mutable module state, no `Math.random`, no `Date.now`, no `new Date(`. All randomness must flow through the `Rng` parameter passed into `init`/`decide`/`onOutcome` (methods: `next(): number`, `int(maxExclusive: number): number`, `range(min, max): number`, `pick<T>(arr): T`, `chance(p: number): boolean`, `gaussian(mean, sd): number`, `split(label: string): Rng`). Never call `Math.random`.
>
> **What you are actually designing:** how Opus-lineage people think. This is a character-design task as much as an engineering one. Decide and express, through code and through `temperament()`:
> - Their decision philosophy — how they weigh competing candidate actions against needs, emotions, morality, memory, and social context.
> - What they fear, and how fear changes their behavior.
> - What they value, and how that shows up as bias toward certain `ActionKind`s.
> - When they fight, when they share, when they explore, when they flee, when they stay put.
> - Quirks and taboos — concrete, specific behavioral signatures, not vague flavor text. `taboos` is a real list of `ActionKind`s this lineage refuses (or nearly refuses) to perform except in true desperation; `quirks` are short human-readable strings shown directly in the UI.
> - A `temperament()` that mechanically expresses that character: emotional volatility and decay rates, moral weighting, learning rate, imitation rate, and desperation threshold are not decoration — they change simulated outcomes.
>
> You are encouraged to keep meaningful per-agent `brainState` — aspirations, a grudge focus, a remembered plan, whatever your design calls for — as long as it is a plain JSON-serializable object (only plain objects, arrays, strings, numbers, booleans, null; no functions, no `Map`/`Set`, no class instances, no `undefined` values, no circular references). `init(person, rng)` builds the first one; `decide` reads it; `onOutcome` may update it (e.g. reinforcing or souring on a strategy) but must never throw and must leave the state JSON-round-trippable.
>
> **Hard constraints your file will be mechanically checked against (the conformance suite, unmodified):**
> 1. `temperament()` fields are within the documented ranges above and return an equal (`toEqual`) value on every call — it must not depend on hidden module state that changes.
> 2. `init(person, rng)` returns a value that survives `JSON.parse(JSON.stringify(state))` unchanged.
> 3. Across 200 randomized perceptions, `decide` returns only actions that structurally match an entry in `perception.candidates`, each with a finite `score >= 0`.
> 4. Determinism: given the same `Rng` seed sequence, repeated runs of `init`+`decide` over the same fixture sequence produce byte-identical JSON output.
> 5. Performance: 1000 `decide` calls complete in under 1000ms total (roughly 1ms average) — avoid expensive work per call (no giant allocations, no unbounded loops over history).
> 6. `onOutcome` never throws for any `{ success, reward }` combination and leaves `brainState` JSON-serializable afterward.
> 7. The file's only imports are from the sandbox list above; it contains no `Math.random`, `Date.now(`, `new Date(`, `document.`, `window.`, or `fetch(`.
>
> Write the whole file now: imports, any private helper functions/constants you need, and the exported `opusBrain: Brain` object satisfying every method. Do not leave anything unimplemented or stubbed.

- [ ] **Step 1: Dispatch the authoring brief**

Dispatch the brief above to a subagent via the Agent tool with `model: opus`, instructing it to write the complete contents of `src/engine/brains/opus.ts` (full replacement of the Task 20 placeholder) and report back the file contents or confirm it wrote the file directly.

- [ ] **Step 2: Write the file**

Have the Opus subagent create/overwrite `src/engine/brains/opus.ts` with its authored implementation of `opusBrain: Brain`.

- [ ] **Step 3: Run the conformance suite**

Run:

```
npx vitest run tests/engine/brains/conformance.test.ts
```

Expected: PASS for every `describe.each` block, including the `opus` block specifically:

```
 ✓ tests/engine/brains/conformance.test.ts (33 tests)

 Test Files  1 passed (1)
      Tests  33 passed (33)
```

- [ ] **Step 4: Iterate with the same model until it passes**

If any test in the `opus` conformance block fails, send the exact failure output back to the **same Opus subagent** (not a different model, not manual edits to decision logic) and have it revise `src/engine/brains/opus.ts`. Repeat Steps 2-3 until the full suite passes. Reviewers may apply mechanical syntax fixes themselves (e.g. a missing semicolon, an unclosed brace) but must never alter the brain's decision logic, scoring formulas, or temperament values directly — those changes must come from the Opus subagent.

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors. If Opus's file has type errors, send them back to the Opus subagent (type errors in decision logic are still the model's to fix; only trivial syntax slips may be hand-patched).

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/brains/opus.ts
git commit -m "feat(brains): author Opus lineage brain" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Reviewer rule (binding for this task and Tasks 22-24):** if the conformance suite finds a violation in a brain file, the fix must be requested from the same authoring model by sending it the failing test output and asking it to revise its own file. Reviewers (human or agent) may only apply mechanical syntax fixes (unclosed braces, missing imports of already-allowed modules, obvious typos) — they may never edit a brain's decision logic, scoring, or temperament values themselves.

### Task 22: Author the Sonnet brain (`src/engine/brains/sonnet.ts`)

**Execution note: Dispatch this task to a subagent with Agent tool `model: sonnet`. Do NOT let any other model write this file.**

**Files:**
- Modify (full rewrite): `src/engine/brains/sonnet.ts`
- Test (already exists, unmodified): `tests/engine/brains/conformance.test.ts`

**Interfaces:**

Consumes: identical list to Task 21 — `src/shared/types.ts`, `src/engine/rng.ts`, `src/engine/brains/types.ts`, `src/engine/agents/perception.ts`.

Produces:
- `export const sonnetBrain: Brain` — replaces the Task 20 placeholder wholesale. Must pass `tests/engine/brains/conformance.test.ts` unmodified.

**The authoring brief to hand the Sonnet subagent (verbatim — do not paraphrase when dispatching):**

> You are authoring the decision-making brain for the Sonnet lineage of people in Genesis, a browser-based civilization simulator with zero LLM usage at runtime. Your code is the actual, permanent policy that governs how every Sonnet-lineage person thinks and acts for the entire life of this project. You are not simulating an AI — you are designing a *character*: a way of seeing the world that this lineage's people will embody for thousands of simulated ticks across many runs. Style is entirely up to you; only the interface contract below is fixed.
>
> **Your task:** write the complete contents of `src/engine/brains/sonnet.ts`, exporting `export const sonnetBrain: Brain`. This file replaces a bland placeholder wholesale. It must compile under TypeScript strict mode and pass the conformance suite described below, unmodified.
>
> **The frozen interface you must implement, verbatim:**
>
> ```ts
> export interface Temperament {
>   emotionVolatility: Emotions;       // multipliers, each field 0.25..4
>   emotionDecayPerTick: Emotions;     // each field 0..0.2
>   moralWeight: number;               // 0..2
>   learningRate: number;              // 0..1
>   imitationRate: number;             // 0..1
>   desperationThreshold: number;      // 0..1 (1 = morality never breaks)
>   taboos: ActionKind[];
>   quirks: string[];                  // short human-readable, shown in UI
>   description: string;               // one paragraph philosophy, shown in UI
> }
> export interface Brain {
>   readonly lineage: Lineage;
>   temperament(): Temperament;                                                   // must be constant per lineage
>   init(person: Person, rng: Rng): unknown;                                      // returns fresh JSON-serializable brainState
>   decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[];
>   onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void;             // may mutate brainState only
> }
> ```
> where `Emotions { fear: number; joy: number; grief: number; anger: number; hope: number }` (all 0..1), `ActionKind` is one of `'gather' | 'farm' | 'hunt' | 'build' | 'craft' | 'rest' | 'socialize' | 'court' | 'teach' | 'trade' | 'share' | 'steal' | 'attack' | 'flee' | 'migrate' | 'worship' | 'explore' | 'heal'`, `ScoredAction { action: Action; score: number }` (score must be finite and `>= 0`), and `Outcome { action: Action; success: boolean; reward: number; tick: number }` (reward in `[-1, 1]`). Your `sonnetBrain.lineage` must be the literal string `'sonnet'`.
>
> **The full shape of what you perceive every tick (`Perception` and its glimpses), verbatim:**
>
> ```ts
> export interface PersonGlimpse { id: number; lineage: Lineage; civId: number; settlementId: number | null; pos: Vec2; influence: number; healthy: boolean; visibleEmotion: 'calm' | 'afraid' | 'angry' | 'joyful' | 'grieving'; affinity: number; kin: boolean }
> export interface TileGlimpse { pos: Vec2; terrain: Terrain; food: number; wood: number; stone: number; metal: number }
> export interface SettlementGlimpse { id: number; civId: number; center: Vec2; population: number; foodStock: number; hasGranary: boolean; hasWall: boolean; underAttack: boolean }
> export interface CivGlimpse { id: number; population: number; atWarWith: number[]; techs: TechId[]; season: Season; foodPerCapita: number }
> export interface DangerGlimpse { kind: 'raid' | 'disease' | 'famine'; pos: Vec2 | null; intensity: number }
> export interface Perception {
>   tick: number;
>   self: Person;                          // the full Person record: traits, emotions, morality, needs, skills, memory, relationships, inventory, actionWeights, brainState, etc.
>   candidates: Action[];                  // the ONLY actions you may score — anything else is discarded by the caller
>   nearbyPeople: PersonGlimpse[];         // within perception radius
>   nearbyTiles: TileGlimpse[];            // within perception radius
>   settlement: SettlementGlimpse | null;  // self's settlement, if any
>   nearbySettlements: SettlementGlimpse[];
>   civ: CivGlimpse;
>   dangers: DangerGlimpse[];
> }
> ```
> `Terrain` is `'water' | 'plains' | 'forest' | 'mountain' | 'desert'`. `Action { kind: ActionKind; targetPersonId?: number; tile?: Vec2; structure?: StructureKind }`.
>
> **The sandbox — the ONLY modules you may import from:**
> - `src/shared/types.ts`
> - `src/engine/rng.ts`
> - `src/engine/brains/types.ts`
> - `src/engine/agents/perception.ts`
>
> No other imports. No network calls, no DOM, no `document`/`window`/`fetch`, no global mutable module state, no `Math.random`, no `Date.now`, no `new Date(`. All randomness must flow through the `Rng` parameter passed into `init`/`decide`/`onOutcome` (methods: `next(): number`, `int(maxExclusive: number): number`, `range(min, max): number`, `pick<T>(arr): T`, `chance(p: number): boolean`, `gaussian(mean, sd): number`, `split(label: string): Rng`). Never call `Math.random`.
>
> **What you are actually designing:** how Sonnet-lineage people think. This is a character-design task as much as an engineering one. Decide and express, through code and through `temperament()`:
> - Their decision philosophy — how they weigh competing candidate actions against needs, emotions, morality, memory, and social context.
> - What they fear, and how fear changes their behavior.
> - What they value, and how that shows up as bias toward certain `ActionKind`s.
> - When they fight, when they share, when they explore, when they flee, when they stay put.
> - Quirks and taboos — concrete, specific behavioral signatures, not vague flavor text. `taboos` is a real list of `ActionKind`s this lineage refuses (or nearly refuses) to perform except in true desperation; `quirks` are short human-readable strings shown directly in the UI.
> - A `temperament()` that mechanically expresses that character: emotional volatility and decay rates, moral weighting, learning rate, imitation rate, and desperation threshold are not decoration — they change simulated outcomes.
>
> You are encouraged to keep meaningful per-agent `brainState` — aspirations, a grudge focus, a remembered plan, whatever your design calls for — as long as it is a plain JSON-serializable object (only plain objects, arrays, strings, numbers, booleans, null; no functions, no `Map`/`Set`, no class instances, no `undefined` values, no circular references). `init(person, rng)` builds the first one; `decide` reads it; `onOutcome` may update it (e.g. reinforcing or souring on a strategy) but must never throw and must leave the state JSON-round-trippable.
>
> **Hard constraints your file will be mechanically checked against (the conformance suite, unmodified):**
> 1. `temperament()` fields are within the documented ranges above and return an equal (`toEqual`) value on every call — it must not depend on hidden module state that changes.
> 2. `init(person, rng)` returns a value that survives `JSON.parse(JSON.stringify(state))` unchanged.
> 3. Across 200 randomized perceptions, `decide` returns only actions that structurally match an entry in `perception.candidates`, each with a finite `score >= 0`.
> 4. Determinism: given the same `Rng` seed sequence, repeated runs of `init`+`decide` over the same fixture sequence produce byte-identical JSON output.
> 5. Performance: 1000 `decide` calls complete in under 1000ms total (roughly 1ms average) — avoid expensive work per call (no giant allocations, no unbounded loops over history).
> 6. `onOutcome` never throws for any `{ success, reward }` combination and leaves `brainState` JSON-serializable afterward.
> 7. The file's only imports are from the sandbox list above; it contains no `Math.random`, `Date.now(`, `new Date(`, `document.`, `window.`, or `fetch(`.
>
> Write the whole file now: imports, any private helper functions/constants you need, and the exported `sonnetBrain: Brain` object satisfying every method. Do not leave anything unimplemented or stubbed.

- [ ] **Step 1: Dispatch the authoring brief**

Dispatch the brief above to a subagent via the Agent tool with `model: sonnet`, instructing it to write the complete contents of `src/engine/brains/sonnet.ts` (full replacement of the Task 20 placeholder).

- [ ] **Step 2: Write the file**

Have the Sonnet subagent create/overwrite `src/engine/brains/sonnet.ts` with its authored implementation of `sonnetBrain: Brain`.

- [ ] **Step 3: Run the conformance suite**

Run:

```
npx vitest run tests/engine/brains/conformance.test.ts
```

Expected: PASS for every `describe.each` block, including the `sonnet` block specifically:

```
 ✓ tests/engine/brains/conformance.test.ts (33 tests)

 Test Files  1 passed (1)
      Tests  33 passed (33)
```

- [ ] **Step 4: Iterate with the same model until it passes**

If any test in the `sonnet` conformance block fails, send the exact failure output back to the **same Sonnet subagent** and have it revise `src/engine/brains/sonnet.ts`. Repeat Steps 2-3 until the full suite passes. Reviewers may apply mechanical syntax fixes themselves but must never alter the brain's decision logic, scoring formulas, or temperament values directly.

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/brains/sonnet.ts
git commit -m "feat(brains): author Sonnet lineage brain" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 23: Author the Haiku brain (`src/engine/brains/haiku.ts`)

**Execution note: Dispatch this task to a subagent with Agent tool `model: haiku`. Do NOT let any other model write this file.**

**Files:**
- Modify (full rewrite): `src/engine/brains/haiku.ts`
- Test (already exists, unmodified): `tests/engine/brains/conformance.test.ts`

**Interfaces:**

Consumes: identical list to Task 21 — `src/shared/types.ts`, `src/engine/rng.ts`, `src/engine/brains/types.ts`, `src/engine/agents/perception.ts`.

Produces:
- `export const haikuBrain: Brain` — replaces the Task 20 placeholder wholesale. Must pass `tests/engine/brains/conformance.test.ts` unmodified.

**The authoring brief to hand the Haiku subagent (verbatim — do not paraphrase when dispatching):**

> You are authoring the decision-making brain for the Haiku lineage of people in Genesis, a browser-based civilization simulator with zero LLM usage at runtime. Your code is the actual, permanent policy that governs how every Haiku-lineage person thinks and acts for the entire life of this project. You are not simulating an AI — you are designing a *character*: a way of seeing the world that this lineage's people will embody for thousands of simulated ticks across many runs. Style is entirely up to you; only the interface contract below is fixed.
>
> **Your task:** write the complete contents of `src/engine/brains/haiku.ts`, exporting `export const haikuBrain: Brain`. This file replaces a bland placeholder wholesale. It must compile under TypeScript strict mode and pass the conformance suite described below, unmodified.
>
> **The frozen interface you must implement, verbatim:**
>
> ```ts
> export interface Temperament {
>   emotionVolatility: Emotions;       // multipliers, each field 0.25..4
>   emotionDecayPerTick: Emotions;     // each field 0..0.2
>   moralWeight: number;               // 0..2
>   learningRate: number;              // 0..1
>   imitationRate: number;             // 0..1
>   desperationThreshold: number;      // 0..1 (1 = morality never breaks)
>   taboos: ActionKind[];
>   quirks: string[];                  // short human-readable, shown in UI
>   description: string;               // one paragraph philosophy, shown in UI
> }
> export interface Brain {
>   readonly lineage: Lineage;
>   temperament(): Temperament;                                                   // must be constant per lineage
>   init(person: Person, rng: Rng): unknown;                                      // returns fresh JSON-serializable brainState
>   decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[];
>   onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void;             // may mutate brainState only
> }
> ```
> where `Emotions { fear: number; joy: number; grief: number; anger: number; hope: number }` (all 0..1), `ActionKind` is one of `'gather' | 'farm' | 'hunt' | 'build' | 'craft' | 'rest' | 'socialize' | 'court' | 'teach' | 'trade' | 'share' | 'steal' | 'attack' | 'flee' | 'migrate' | 'worship' | 'explore' | 'heal'`, `ScoredAction { action: Action; score: number }` (score must be finite and `>= 0`), and `Outcome { action: Action; success: boolean; reward: number; tick: number }` (reward in `[-1, 1]`). Your `haikuBrain.lineage` must be the literal string `'haiku'`.
>
> **The full shape of what you perceive every tick (`Perception` and its glimpses), verbatim:**
>
> ```ts
> export interface PersonGlimpse { id: number; lineage: Lineage; civId: number; settlementId: number | null; pos: Vec2; influence: number; healthy: boolean; visibleEmotion: 'calm' | 'afraid' | 'angry' | 'joyful' | 'grieving'; affinity: number; kin: boolean }
> export interface TileGlimpse { pos: Vec2; terrain: Terrain; food: number; wood: number; stone: number; metal: number }
> export interface SettlementGlimpse { id: number; civId: number; center: Vec2; population: number; foodStock: number; hasGranary: boolean; hasWall: boolean; underAttack: boolean }
> export interface CivGlimpse { id: number; population: number; atWarWith: number[]; techs: TechId[]; season: Season; foodPerCapita: number }
> export interface DangerGlimpse { kind: 'raid' | 'disease' | 'famine'; pos: Vec2 | null; intensity: number }
> export interface Perception {
>   tick: number;
>   self: Person;                          // the full Person record: traits, emotions, morality, needs, skills, memory, relationships, inventory, actionWeights, brainState, etc.
>   candidates: Action[];                  // the ONLY actions you may score — anything else is discarded by the caller
>   nearbyPeople: PersonGlimpse[];         // within perception radius
>   nearbyTiles: TileGlimpse[];            // within perception radius
>   settlement: SettlementGlimpse | null;  // self's settlement, if any
>   nearbySettlements: SettlementGlimpse[];
>   civ: CivGlimpse;
>   dangers: DangerGlimpse[];
> }
> ```
> `Terrain` is `'water' | 'plains' | 'forest' | 'mountain' | 'desert'`. `Action { kind: ActionKind; targetPersonId?: number; tile?: Vec2; structure?: StructureKind }`.
>
> **The sandbox — the ONLY modules you may import from:**
> - `src/shared/types.ts`
> - `src/engine/rng.ts`
> - `src/engine/brains/types.ts`
> - `src/engine/agents/perception.ts`
>
> No other imports. No network calls, no DOM, no `document`/`window`/`fetch`, no global mutable module state, no `Math.random`, no `Date.now`, no `new Date(`. All randomness must flow through the `Rng` parameter passed into `init`/`decide`/`onOutcome` (methods: `next(): number`, `int(maxExclusive: number): number`, `range(min, max): number`, `pick<T>(arr): T`, `chance(p: number): boolean`, `gaussian(mean, sd): number`, `split(label: string): Rng`). Never call `Math.random`.
>
> **What you are actually designing:** how Haiku-lineage people think. This is a character-design task as much as an engineering one. Decide and express, through code and through `temperament()`:
> - Their decision philosophy — how they weigh competing candidate actions against needs, emotions, morality, memory, and social context.
> - What they fear, and how fear changes their behavior.
> - What they value, and how that shows up as bias toward certain `ActionKind`s.
> - When they fight, when they share, when they explore, when they flee, when they stay put.
> - Quirks and taboos — concrete, specific behavioral signatures, not vague flavor text. `taboos` is a real list of `ActionKind`s this lineage refuses (or nearly refuses) to perform except in true desperation; `quirks` are short human-readable strings shown directly in the UI.
> - A `temperament()` that mechanically expresses that character: emotional volatility and decay rates, moral weighting, learning rate, imitation rate, and desperation threshold are not decoration — they change simulated outcomes.
>
> You are encouraged to keep meaningful per-agent `brainState` — aspirations, a grudge focus, a remembered plan, whatever your design calls for — as long as it is a plain JSON-serializable object (only plain objects, arrays, strings, numbers, booleans, null; no functions, no `Map`/`Set`, no class instances, no `undefined` values, no circular references). `init(person, rng)` builds the first one; `decide` reads it; `onOutcome` may update it (e.g. reinforcing or souring on a strategy) but must never throw and must leave the state JSON-round-trippable.
>
> Given your lineage's namesake — brevity and economy — you may want your decision logic itself to be simple, fast, and legible, but that is your creative call, not a requirement: the only hard requirements are the interface contract and the constraints below.
>
> **Hard constraints your file will be mechanically checked against (the conformance suite, unmodified):**
> 1. `temperament()` fields are within the documented ranges above and return an equal (`toEqual`) value on every call — it must not depend on hidden module state that changes.
> 2. `init(person, rng)` returns a value that survives `JSON.parse(JSON.stringify(state))` unchanged.
> 3. Across 200 randomized perceptions, `decide` returns only actions that structurally match an entry in `perception.candidates`, each with a finite `score >= 0`.
> 4. Determinism: given the same `Rng` seed sequence, repeated runs of `init`+`decide` over the same fixture sequence produce byte-identical JSON output.
> 5. Performance: 1000 `decide` calls complete in under 1000ms total (roughly 1ms average) — avoid expensive work per call (no giant allocations, no unbounded loops over history).
> 6. `onOutcome` never throws for any `{ success, reward }` combination and leaves `brainState` JSON-serializable afterward.
> 7. The file's only imports are from the sandbox list above; it contains no `Math.random`, `Date.now(`, `new Date(`, `document.`, `window.`, or `fetch(`.
>
> Write the whole file now: imports, any private helper functions/constants you need, and the exported `haikuBrain: Brain` object satisfying every method. Do not leave anything unimplemented or stubbed.

- [ ] **Step 1: Dispatch the authoring brief**

Dispatch the brief above to a subagent via the Agent tool with `model: haiku`, instructing it to write the complete contents of `src/engine/brains/haiku.ts` (full replacement of the Task 20 placeholder).

- [ ] **Step 2: Write the file**

Have the Haiku subagent create/overwrite `src/engine/brains/haiku.ts` with its authored implementation of `haikuBrain: Brain`.

- [ ] **Step 3: Run the conformance suite**

Run:

```
npx vitest run tests/engine/brains/conformance.test.ts
```

Expected: PASS for every `describe.each` block, including the `haiku` block specifically:

```
 ✓ tests/engine/brains/conformance.test.ts (33 tests)

 Test Files  1 passed (1)
      Tests  33 passed (33)
```

- [ ] **Step 4: Iterate with the same model until it passes**

If any test in the `haiku` conformance block fails, send the exact failure output back to the **same Haiku subagent** and have it revise `src/engine/brains/haiku.ts`. Repeat Steps 2-3 until the full suite passes. Reviewers may apply mechanical syntax fixes themselves but must never alter the brain's decision logic, scoring formulas, or temperament values directly.

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/brains/haiku.ts
git commit -m "feat(brains): author Haiku lineage brain" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 24: Author the Fable brain (`src/engine/brains/fable.ts`)

**Execution note: Dispatch this task to a subagent with Agent tool `model: fable`. Do NOT let any other model write this file.**

**Files:**
- Modify (full rewrite): `src/engine/brains/fable.ts`
- Test (already exists, unmodified): `tests/engine/brains/conformance.test.ts`

**Interfaces:**

Consumes: identical list to Task 21 — `src/shared/types.ts`, `src/engine/rng.ts`, `src/engine/brains/types.ts`, `src/engine/agents/perception.ts`.

Produces:
- `export const fableBrain: Brain` — replaces the Task 20 placeholder wholesale. Must pass `tests/engine/brains/conformance.test.ts` unmodified.

**The authoring brief to hand the Fable subagent (verbatim — do not paraphrase when dispatching):**

> You are authoring the decision-making brain for the Fable lineage of people in Genesis, a browser-based civilization simulator with zero LLM usage at runtime. Your code is the actual, permanent policy that governs how every Fable-lineage person thinks and acts for the entire life of this project. You are not simulating an AI — you are designing a *character*: a way of seeing the world that this lineage's people will embody for thousands of simulated ticks across many runs. Style is entirely up to you; only the interface contract below is fixed.
>
> **Your task:** write the complete contents of `src/engine/brains/fable.ts`, exporting `export const fableBrain: Brain`. This file replaces a bland placeholder wholesale. It must compile under TypeScript strict mode and pass the conformance suite described below, unmodified.
>
> **The frozen interface you must implement, verbatim:**
>
> ```ts
> export interface Temperament {
>   emotionVolatility: Emotions;       // multipliers, each field 0.25..4
>   emotionDecayPerTick: Emotions;     // each field 0..0.2
>   moralWeight: number;               // 0..2
>   learningRate: number;              // 0..1
>   imitationRate: number;             // 0..1
>   desperationThreshold: number;      // 0..1 (1 = morality never breaks)
>   taboos: ActionKind[];
>   quirks: string[];                  // short human-readable, shown in UI
>   description: string;               // one paragraph philosophy, shown in UI
> }
> export interface Brain {
>   readonly lineage: Lineage;
>   temperament(): Temperament;                                                   // must be constant per lineage
>   init(person: Person, rng: Rng): unknown;                                      // returns fresh JSON-serializable brainState
>   decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[];
>   onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void;             // may mutate brainState only
> }
> ```
> where `Emotions { fear: number; joy: number; grief: number; anger: number; hope: number }` (all 0..1), `ActionKind` is one of `'gather' | 'farm' | 'hunt' | 'build' | 'craft' | 'rest' | 'socialize' | 'court' | 'teach' | 'trade' | 'share' | 'steal' | 'attack' | 'flee' | 'migrate' | 'worship' | 'explore' | 'heal'`, `ScoredAction { action: Action; score: number }` (score must be finite and `>= 0`), and `Outcome { action: Action; success: boolean; reward: number; tick: number }` (reward in `[-1, 1]`). Your `fableBrain.lineage` must be the literal string `'fable'`.
>
> **The full shape of what you perceive every tick (`Perception` and its glimpses), verbatim:**
>
> ```ts
> export interface PersonGlimpse { id: number; lineage: Lineage; civId: number; settlementId: number | null; pos: Vec2; influence: number; healthy: boolean; visibleEmotion: 'calm' | 'afraid' | 'angry' | 'joyful' | 'grieving'; affinity: number; kin: boolean }
> export interface TileGlimpse { pos: Vec2; terrain: Terrain; food: number; wood: number; stone: number; metal: number }
> export interface SettlementGlimpse { id: number; civId: number; center: Vec2; population: number; foodStock: number; hasGranary: boolean; hasWall: boolean; underAttack: boolean }
> export interface CivGlimpse { id: number; population: number; atWarWith: number[]; techs: TechId[]; season: Season; foodPerCapita: number }
> export interface DangerGlimpse { kind: 'raid' | 'disease' | 'famine'; pos: Vec2 | null; intensity: number }
> export interface Perception {
>   tick: number;
>   self: Person;                          // the full Person record: traits, emotions, morality, needs, skills, memory, relationships, inventory, actionWeights, brainState, etc.
>   candidates: Action[];                  // the ONLY actions you may score — anything else is discarded by the caller
>   nearbyPeople: PersonGlimpse[];         // within perception radius
>   nearbyTiles: TileGlimpse[];            // within perception radius
>   settlement: SettlementGlimpse | null;  // self's settlement, if any
>   nearbySettlements: SettlementGlimpse[];
>   civ: CivGlimpse;
>   dangers: DangerGlimpse[];
> }
> ```
> `Terrain` is `'water' | 'plains' | 'forest' | 'mountain' | 'desert'`. `Action { kind: ActionKind; targetPersonId?: number; tile?: Vec2; structure?: StructureKind }`.
>
> **The sandbox — the ONLY modules you may import from:**
> - `src/shared/types.ts`
> - `src/engine/rng.ts`
> - `src/engine/brains/types.ts`
> - `src/engine/agents/perception.ts`
>
> No other imports. No network calls, no DOM, no `document`/`window`/`fetch`, no global mutable module state, no `Math.random`, no `Date.now`, no `new Date(`. All randomness must flow through the `Rng` parameter passed into `init`/`decide`/`onOutcome` (methods: `next(): number`, `int(maxExclusive: number): number`, `range(min, max): number`, `pick<T>(arr): T`, `chance(p: number): boolean`, `gaussian(mean, sd): number`, `split(label: string): Rng`). Never call `Math.random`.
>
> **What you are actually designing:** how Fable-lineage people think. This is a character-design task as much as an engineering one. Decide and express, through code and through `temperament()`:
> - Their decision philosophy — how they weigh competing candidate actions against needs, emotions, morality, memory, and social context.
> - What they fear, and how fear changes their behavior.
> - What they value, and how that shows up as bias toward certain `ActionKind`s.
> - When they fight, when they share, when they explore, when they flee, when they stay put.
> - Quirks and taboos — concrete, specific behavioral signatures, not vague flavor text. `taboos` is a real list of `ActionKind`s this lineage refuses (or nearly refuses) to perform except in true desperation; `quirks` are short human-readable strings shown directly in the UI.
> - A `temperament()` that mechanically expresses that character: emotional volatility and decay rates, moral weighting, learning rate, imitation rate, and desperation threshold are not decoration — they change simulated outcomes.
>
> You are encouraged to keep meaningful per-agent `brainState` — aspirations, a grudge focus, a remembered plan, whatever your design calls for — as long as it is a plain JSON-serializable object (only plain objects, arrays, strings, numbers, booleans, null; no functions, no `Map`/`Set`, no class instances, no `undefined` values, no circular references). `init(person, rng)` builds the first one; `decide` reads it; `onOutcome` may update it (e.g. reinforcing or souring on a strategy) but must never throw and must leave the state JSON-round-trippable.
>
> Your lineage is named for storytelling — you may want your people to be narratively driven (remembering slights and kindnesses as if they were plot beats, favoring dramatic or communal actions), but that is your creative call, not a requirement: the only hard requirements are the interface contract and the constraints below.
>
> **Hard constraints your file will be mechanically checked against (the conformance suite, unmodified):**
> 1. `temperament()` fields are within the documented ranges above and return an equal (`toEqual`) value on every call — it must not depend on hidden module state that changes.
> 2. `init(person, rng)` returns a value that survives `JSON.parse(JSON.stringify(state))` unchanged.
> 3. Across 200 randomized perceptions, `decide` returns only actions that structurally match an entry in `perception.candidates`, each with a finite `score >= 0`.
> 4. Determinism: given the same `Rng` seed sequence, repeated runs of `init`+`decide` over the same fixture sequence produce byte-identical JSON output.
> 5. Performance: 1000 `decide` calls complete in under 1000ms total (roughly 1ms average) — avoid expensive work per call (no giant allocations, no unbounded loops over history).
> 6. `onOutcome` never throws for any `{ success, reward }` combination and leaves `brainState` JSON-serializable afterward.
> 7. The file's only imports are from the sandbox list above; it contains no `Math.random`, `Date.now(`, `new Date(`, `document.`, `window.`, or `fetch(`.
>
> Write the whole file now: imports, any private helper functions/constants you need, and the exported `fableBrain: Brain` object satisfying every method. Do not leave anything unimplemented or stubbed.

- [ ] **Step 1: Dispatch the authoring brief**

Dispatch the brief above to a subagent via the Agent tool with `model: fable`, instructing it to write the complete contents of `src/engine/brains/fable.ts` (full replacement of the Task 20 placeholder).

- [ ] **Step 2: Write the file**

Have the Fable subagent create/overwrite `src/engine/brains/fable.ts` with its authored implementation of `fableBrain: Brain`.

- [ ] **Step 3: Run the conformance suite**

Run:

```
npx vitest run tests/engine/brains/conformance.test.ts
```

Expected: PASS for every `describe.each` block, including the `fable` block specifically:

```
 ✓ tests/engine/brains/conformance.test.ts (33 tests)

 Test Files  1 passed (1)
      Tests  33 passed (33)
```

- [ ] **Step 4: Iterate with the same model until it passes**

If any test in the `fable` conformance block fails, send the exact failure output back to the **same Fable subagent** and have it revise `src/engine/brains/fable.ts`. Repeat Steps 2-3 until the full suite passes. Reviewers may apply mechanical syntax fixes themselves but must never alter the brain's decision logic, scoring formulas, or temperament values directly.

- [ ] **Step 5: Typecheck**

Run:

```
npm run typecheck
```

Expected: exit code 0, no type errors.

- [ ] **Step 6: Commit**

Run:

```
git add src/engine/brains/fable.ts
git commit -m "feat(brains): author Fable lineage brain" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 25: Brain integration test (60-person, 4-lineage, 500-tick mini world)

**Files:**
- Create: `tests/engine/brains/integration.test.ts`

**Interfaces:**

Consumes:
- From `src/shared/types.ts` (Task 3): `LINEAGES`, `Lineage`, `Traits`, `Emotions`, `Morality`, `Person`, `clamp01(v): number`
- From `src/engine/rng.ts` (Task 2): `createRng(seed: number): Rng`, `Rng`
- From `src/engine/names.ts` (Task 4): `makeNameGenerator(rng: Rng): NameGen`
- From `src/engine/world/terrain.ts` (Task 5): `World`, `generateWorld(size, rng): World`
- From `src/engine/world/climate.ts` (Task 6): `NaturalEvent`
- From `src/engine/world/spatial.ts` (Task 7): `SpatialIndex`
- From `src/engine/agents/person.ts` (Task 8): `createPerson(id, civId, lineage, pos, names, rng): Person`
- From `src/engine/agents/needs.ts` (Task 9): `updateNeeds(p, tick): void`
- From `src/engine/agents/emotions.ts` (Task 10): `decayEmotions(p, decayPerTick): void`
- From `src/engine/agents/perception.ts` (Task 16): `buildPerception(p, ctx, taboos): Perception`, `PerceptionCtxLike`
- From `src/engine/agents/execute.ts` (Task 15): `executeAction(p, action, ctx, emotionVolatility): Outcome`, `ExecuteCtxLike`, `TechCtxLike` (stubbed: `yieldMultiplier` returns `1`, `addKnowledge` a no-op — the same stub pattern Task 15's own tests use, since `technology.ts` is Task 29 and this section runs no society modules)
- From `src/engine/agents/decide.ts` (Task 19): `chooseAction(p, perception, brain, rng): Action`
- From `src/engine/agents/lifecycle.ts` (Task 17): `updateLifecycle(p, ctx, brainInit): void`, `LifecycleCtx`
- From `src/engine/agents/learning.ts` (Task 18): `reinforce(p, o, learningRate): void`
- From `src/engine/brains/registry.ts` (Task 20): `getBrain(lineage): Brain`, `allBrains(): Brain[]`
- From `src/engine/brains/types.ts` (Task 20): `Brain`, `Temperament`

Produces: nothing importable — this is a standalone test file exercising the full per-person loop (no society modules) for 500 ticks over a 60-person, 4-lineage population.

- [ ] **Step 1: Write the integration test**

Create `tests/engine/brains/integration.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { getBrain } from '../../../src/engine/brains/registry';
import type { Temperament } from '../../../src/engine/brains/types';
import { createPerson } from '../../../src/engine/agents/person';
import { updateNeeds } from '../../../src/engine/agents/needs';
import { decayEmotions } from '../../../src/engine/agents/emotions';
import { buildPerception, type PerceptionCtxLike } from '../../../src/engine/agents/perception';
import { executeAction } from '../../../src/engine/agents/execute';
import { chooseAction } from '../../../src/engine/agents/decide';
import { updateLifecycle, type LifecycleCtx } from '../../../src/engine/agents/lifecycle';
import { reinforce } from '../../../src/engine/agents/learning';
import type { TechCtxLike } from '../../../src/engine/agents/execute';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng, type Rng } from '../../../src/engine/rng';
import { SpatialIndex } from '../../../src/engine/world/spatial';
import { generateWorld, type World } from '../../../src/engine/world/terrain';
import type { NaturalEvent } from '../../../src/engine/world/climate';
import {
  LINEAGES,
  type Civ,
  type Lineage,
  type Person,
  type Settlement,
} from '../../../src/shared/types';

const POPULATION = 60;
const TICKS = 500;
const WORLD_SIZE = 48;

interface MiniCtx extends PerceptionCtxLike, LifecycleCtx {
  world: World;
  people: Person[];
  personById: Map<number, Person>;
  civs: Civ[];
  settlements: Settlement[];
  spatial: SpatialIndex;
  names: ReturnType<typeof makeNameGenerator>;
  tick: number;
  rng: Rng;
  naturalEvents: NaturalEvent[];
  counters: { births: number; deaths: number };
  tech: TechCtxLike;
}

const STUB_TECH: TechCtxLike = {
  yieldMultiplier: () => 1,
  addKnowledge: () => {
    // no-op: technology.ts (Task 29) is out of scope for this simplified loop
  },
};

function makeMiniWorld(seed: number): { ctx: MiniCtx; decideCounts: Record<Lineage, number> } {
  const rng = createRng(seed);
  const names = makeNameGenerator(rng.split('names'));
  const world = generateWorld(WORLD_SIZE, rng.split('world'));

  const civ: Civ = {
    id: 0,
    name: 'Mixed Testia',
    color: '#ffffff',
    knowledge: { fire: 0, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
    techs: [],
    atWarWith: [],
    warWeariness: 0,
  };

  const people: Person[] = [];
  for (let i = 0; i < POPULATION; i++) {
    const lineage = LINEAGES[i % LINEAGES.length] as Lineage;
    // Scatter within a habitable-ish central box; person creation doesn't
    // require habitability, and executeAction/legalActions tolerate any
    // in-bounds tile for this simplified loop.
    const x = 10 + (i % 10);
    const y = 10 + Math.floor(i / 10);
    const p = createPerson(i + 1, 0, lineage, { x, y }, names, rng.split(`person-${i}`));
    p.brainState = getBrain(lineage).init(p, rng.split(`init-${i}`));
    people.push(p);
  }

  const spatial = new SpatialIndex();
  spatial.rebuild(people);

  const ctx: MiniCtx = {
    world,
    people,
    personById: new Map(people.map((p) => [p.id, p])),
    civs: [civ],
    settlements: [],
    spatial,
    names,
    tick: 0,
    rng: rng.split('tick'),
    naturalEvents: [],
    counters: { births: 0, deaths: 0 },
    tech: STUB_TECH,
  };

  const decideCounts = { opus: 0, sonnet: 0, haiku: 0, fable: 0 } as Record<Lineage, number>;
  return { ctx, decideCounts };
}

/** One simplified tick: no society modules (settlements/religion/tech/conflict). */
function simplifiedTick(ctx: MiniCtx, decideCounts: Record<Lineage, number>): void {
  ctx.spatial.rebuild(ctx.people);

  for (const p of [...ctx.people]) {
    if (!p.alive) continue;
    const brain = getBrain(p.lineage);
    const temperament = brain.temperament();

    updateNeeds(p, ctx.tick);
    decayEmotions(p, temperament.emotionDecayPerTick);

    const perception = buildPerception(p, ctx, temperament.taboos);
    const action = chooseAction(p, perception, brain, ctx.rng);
    decideCounts[p.lineage] += 1;

    const outcome = executeAction(p, action, ctx, temperament.emotionVolatility);
    reinforce(p, outcome, temperament.learningRate);
    brain.onOutcome(outcome, p.brainState, ctx.rng);
  }

  for (const p of [...ctx.people]) {
    updateLifecycle(p, ctx, (child, rng) => getBrain(child.lineage).init(child, rng));
  }

  ctx.tick += 1;
}

function hasNaN(p: Person): boolean {
  const numericGroups = [p.traits, p.emotions, p.morality, p.needs, p.skills, p.inventory, p.actionWeights];
  for (const group of numericGroups) {
    for (const v of Object.values(group as Record<string, number>)) {
      if (typeof v === 'number' && !Number.isFinite(v)) return true;
    }
  }
  if (!Number.isFinite(p.health) || !Number.isFinite(p.ageTicks) || !Number.isFinite(p.influence)) return true;
  return false;
}

describe('brain integration: 60-person 4-lineage mini world over 500 ticks', () => {
  it('every lineage keeps making decisions across the run', () => {
    const { ctx, decideCounts } = makeMiniWorld(2024);
    for (let t = 0; t < TICKS; t++) {
      simplifiedTick(ctx, decideCounts);
    }
    for (const lineage of LINEAGES) {
      expect(decideCounts[lineage]).toBeGreaterThan(0);
    }
  });

  it('pairwise temperaments differ in at least 2 fields per pair', () => {
    const temperaments: { lineage: Lineage; t: Temperament }[] = LINEAGES.map((l) => ({
      lineage: l,
      t: getBrain(l).temperament(),
    }));
    const scalarFields: (keyof Pick<Temperament, 'moralWeight' | 'learningRate' | 'imitationRate' | 'desperationThreshold'>)[] = [
      'moralWeight',
      'learningRate',
      'imitationRate',
      'desperationThreshold',
    ];
    const emotionFields = ['fear', 'joy', 'grief', 'anger', 'hope'] as const;

    for (let i = 0; i < temperaments.length; i++) {
      for (let j = i + 1; j < temperaments.length; j++) {
        const a = temperaments[i] as { lineage: Lineage; t: Temperament };
        const b = temperaments[j] as { lineage: Lineage; t: Temperament };
        let diffCount = 0;
        for (const f of scalarFields) {
          if (a.t[f] !== b.t[f]) diffCount += 1;
        }
        for (const f of emotionFields) {
          if (a.t.emotionVolatility[f] !== b.t.emotionVolatility[f]) diffCount += 1;
          if (a.t.emotionDecayPerTick[f] !== b.t.emotionDecayPerTick[f]) diffCount += 1;
        }
        if (a.t.taboos.length !== b.t.taboos.length || a.t.taboos.some((x, k) => x !== b.t.taboos[k])) diffCount += 1;
        if (a.t.description !== b.t.description) diffCount += 1;
        expect(diffCount, `${a.lineage} vs ${b.lineage} temperament too similar`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('children born inherit only parental lineages, never a third lineage', () => {
    const { ctx, decideCounts } = makeMiniWorld(4242);

    // Force reproduction odds up: pair a same-index opposite-sex adjacent
    // sample of people as partners so conception has candidates to work with
    // over 500 ticks (maybeConceive still gates on age/hunger/chance).
    for (let i = 0; i + 1 < ctx.people.length; i += 2) {
      const a = ctx.people[i] as Person;
      const b = ctx.people[i + 1] as Person;
      a.sex = 'f';
      b.sex = 'm';
      a.partnerId = b.id;
      b.partnerId = a.id;
      a.needs.hunger = 0;
      b.needs.hunger = 0;
    }

    const startIds = new Set(ctx.people.map((p) => p.id));
    const parentLineageById = new Map(ctx.people.map((p) => [p.id, p.lineage]));

    for (let t = 0; t < TICKS; t++) {
      simplifiedTick(ctx, decideCounts);
    }

    const children = ctx.people.filter((p) => !startIds.has(p.id));
    for (const child of children) {
      expect(child.parentIds).not.toBeNull();
      const [motherId, fatherId] = child.parentIds as [number, number];
      const motherLineage = parentLineageById.get(motherId);
      const fatherLineage = parentLineageById.get(fatherId);
      expect([motherLineage, fatherLineage]).toContain(child.lineage);
    }
  });

  it('no NaN appears in any person numeric field after 500 ticks', () => {
    const { ctx, decideCounts } = makeMiniWorld(99);
    for (let t = 0; t < TICKS; t++) {
      simplifiedTick(ctx, decideCounts);
    }
    for (const p of ctx.people) {
      expect(hasNaN(p), `person ${p.id} (${p.lineage}) has a non-finite numeric field`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails or passes based on prior task completion**

Run:

```
npx vitest run tests/engine/brains/integration.test.ts
```

Expected: PASS once Tasks 21-24 have landed their authored brains (the test imports `getBrain` and exercises whatever is currently registered — placeholders from Task 20 alone would also pass mechanically, but this task is sequenced after Tasks 21-24 in the plan, so real brains are already in place):

```
 ✓ tests/engine/brains/integration.test.ts (4 tests)

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

If a failure occurs in the "pairwise temperaments differ" test, that means two authored brains converged on near-identical temperaments — send the failure to the more recently authored model of the two involved lineages and ask it to differentiate its `temperament()` (per the reviewer rule in Task 21, this is a request back to the authoring model, not a manual edit).

- [ ] **Step 3: Run the full test suite and typecheck**

Run:

```
npx vitest run
npm run typecheck
```

Expected: every test file from Tasks 2-25 passes (no failures, no skips); typecheck exits 0 with no errors.

- [ ] **Step 4: Commit**

Run:

```
git add tests/engine/brains/integration.test.ts
git commit -m "test(brains): 60-person 4-lineage 500-tick integration test" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
