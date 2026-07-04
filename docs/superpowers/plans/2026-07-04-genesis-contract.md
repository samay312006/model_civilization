# Genesis — Shared Contract (Part 1 of the Implementation Plan)

This document is the **frozen contract** for the Genesis implementation plan. Every task in every plan section must use these exact types, signatures, constants, paths, and conventions. If a task needs a new export not listed here, that task must define it completely within its own section and list it under **Produces:**. No task may silently change anything defined here.

Spec: `docs/superpowers/specs/2026-07-04-genesis-civ-sim-design.md`

## Global Constraints

- **Runtime dependencies: zero.** Only devDependencies allowed: `vite`, `typescript`, `vitest`, `jsdom`. No runtime npm packages, no CDN scripts, no network calls anywhere.
- **TypeScript strict mode** (`"strict": true`), target ES2022. `npm run typecheck` (`tsc --noEmit`) must pass at the end of every task.
- **No LLM/API usage at runtime.** The built app must run fully offline forever.
- **Determinism:** all randomness flows through the seeded `Rng` (below). `Math.random`, `Date.now`, `new Date(` are **forbidden in `src/engine/` and `src/shared/`** (a test greps for them). Same seed + same build = identical history.
- **Nothing scripted:** no hard-coded historical outcomes; wars/famines/religions/collapse emerge from mechanics.
- **Engine is DOM-free:** nothing under `src/engine/` or `src/shared/` may import from `src/ui/` or touch `document`/`window` (worker-safe globals like `postMessage` only in `src/engine/worker.ts`).
- **Brains are sandboxed:** brain modules import only from `src/shared/types.ts`, `src/engine/rng.ts`, `src/engine/brains/types.ts`, `src/engine/agents/perception.ts`. No engine mutation, no globals, no network. `brainState` must be a JSON-serializable plain object.
- **Tests:** vitest. Engine tests run in node environment; UI tests add `// @vitest-environment jsdom` as the first line.
- **Commits:** one per task minimum, message style `feat(scope): ...` / `test(scope): ...`, each ending with the trailer line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Test commands** in steps use the form `npx vitest run tests/<path>` with expected PASS/FAIL stated.

## Directory Layout & File Ownership

```
package.json  tsconfig.json  vite.config.ts  index.html          (Task 1)
src/
  shared/
    types.ts        core types & constants                        (Task 3)
    protocol.ts     worker<->UI messages, Snapshot, CivMetrics    (Task 35, 37)
  engine/
    rng.ts          seeded splittable RNG                         (Task 2)
    names.ts        seeded name generator                         (Task 4)
    world/
      terrain.ts    map generation                                (Task 5)
      climate.ts    seasons, regrowth, natural events             (Task 6)
      spatial.ts    spatial index + world queries                 (Task 7)
    agents/
      person.ts     Person factory + population init              (Task 8)
      needs.ts                                                    (Task 9)
      emotions.ts                                                 (Task 10)
      morality.ts   footprints + moral gate                       (Task 11)
      memory.ts                                                   (Task 12)
      relationships.ts                                            (Task 13)
      actions.ts    catalog, legality/candidates                  (Task 14)
      execute.ts    action execution + outcomes/rewards           (Task 15)
      perception.ts perception builder                            (Task 16)
      lifecycle.ts  aging, death, reproduction, inheritance       (Task 17)
      learning.ts   reinforcement, imitation, teaching            (Task 18)
      decide.ts     decision pipeline                             (Task 19)
    brains/
      types.ts      Brain contract                                (Task 20)
      registry.ts   lineage -> Brain                              (Task 20)
      opus.ts       AUTHORED BY OPUS at execution time            (Task 21)
      sonnet.ts     AUTHORED BY SONNET                            (Task 22)
      haiku.ts      AUTHORED BY HAIKU                             (Task 23)
      fable.ts      AUTHORED BY FABLE                             (Task 24)
    society/
      settlements.ts                                              (Task 26)
      influence.ts  leadership                                    (Task 27)
      culture.ts    drift + schism                                (Task 28)
      technology.ts                                               (Task 29)
      religion.ts                                                 (Task 30)
      economy.ts    sharing + trade                               (Task 31)
      conflict.ts   raids, war, diplomacy                         (Task 32)
    sim/
      simulation.ts Simulation class + tick loop                  (Task 33)
      invariants.ts                                               (Task 33)
      events.ts     narrative events                              (Task 34)
      snapshot.ts   snapshot + metrics                            (Task 35)
      save.ts       serialize/deserialize/checksum                (Task 36)
    worker.ts       web worker entry                              (Task 37)
  ui/
    dom.ts          el() helper                                   (Task 38)
    theme.css                                                     (Task 38)
    main.ts         app entry + screens                           (Task 38)
    setup.ts        setup screen                                  (Task 38)
    client.ts       worker client wrapper                         (Task 39)
    controls.ts     time controls                                 (Task 39)
    map.ts          canvas map renderer, pan/zoom                 (Task 40)
    inspector.ts    person inspector                              (Task 41)
    charts.ts       canvas chart primitives                       (Task 42)
    dashboard.ts    civ dashboard                                 (Task 42)
    feed.ts         event feed                                    (Task 43)
    storage.ts      IndexedDB saves, autosave                     (Task 44)
    replay.ts       replay UI                                     (Task 44)
tests/            mirrors src/ (tests/engine/..., tests/ui/..., tests/smoke/...)
```

## Core Types — `src/shared/types.ts` (Task 3 creates this verbatim, plus doc comments)

```ts
export const YEAR_TICKS = 360;           // 1 tick = 1 day
export const SEASON_TICKS = 90;
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Tick = number;

export const MAP_SIZES = { small: 96, medium: 144, large: 192 } as const;
export type MapSize = keyof typeof MAP_SIZES;

export const PERCEPTION_RADIUS = 4;
export const MEMORY_CAP = 48;
export const RELATIONSHIP_CAP = 24;
export const ADULT_AGE_TICKS = 16 * YEAR_TICKS;
export const GESTATION_TICKS = 270;
export const SOFTMAX_TEMP = 0.35;
export const ACTION_WEIGHT_MIN = 0.2;
export const ACTION_WEIGHT_MAX = 3.0;

export interface Vec2 { x: number; y: number }

export type Terrain = 'water' | 'plains' | 'forest' | 'mountain' | 'desert';

export interface Tile {
  terrain: Terrain;
  fertility: number;  // 0..1 regrowth quality
  food: number;       // >= 0 forageable units
  wood: number;       // >= 0
  stone: number;      // >= 0
  metal: number;      // >= 0
}

export type Lineage = 'opus' | 'sonnet' | 'haiku' | 'fable';
export const LINEAGES: readonly Lineage[] = ['opus', 'sonnet', 'haiku', 'fable'];
// int encoding for snapshots: opus=0 sonnet=1 haiku=2 fable=3 (index in LINEAGES)

export interface Traits { curiosity: number; aggression: number; empathy: number; industriousness: number; riskTolerance: number }        // all 0..1
export interface Emotions { fear: number; joy: number; grief: number; anger: number; hope: number }                                       // all 0..1
export interface Morality { care: number; fairness: number; loyalty: number; authority: number; sanctity: number; liberty: number }       // all 0..1
export interface Needs { hunger: number; safety: number; rest: number; belonging: number; esteem: number }                                 // all 0..1, 1 = desperate

export const SKILL_NAMES = ['farming', 'gathering', 'building', 'crafting', 'fighting', 'healing', 'teaching'] as const;
export type SkillName = typeof SKILL_NAMES[number];
export type Skills = Record<SkillName, number>;   // 0..1

export const ACTION_KINDS = ['gather', 'farm', 'hunt', 'build', 'craft', 'rest', 'socialize', 'court', 'teach', 'trade', 'share', 'steal', 'attack', 'flee', 'migrate', 'worship', 'explore', 'heal'] as const;
export type ActionKind = typeof ACTION_KINDS[number];

export type StructureKind = 'shelter' | 'granary' | 'wall' | 'shrine';

export interface Action { kind: ActionKind; targetPersonId?: number; tile?: Vec2; structure?: StructureKind }
export interface ScoredAction { action: Action; score: number }   // score finite, >= 0

export type MemoryKind = 'helped' | 'harmed' | 'shared' | 'stolen' | 'death-witnessed' | 'kin-died' | 'disaster' | 'victory' | 'defeat' | 'birth' | 'taught' | 'wonder';
export interface MemoryEventRec { tick: Tick; kind: MemoryKind; otherId: number; valence: number; salience: number }  // valence -1..1, salience 0..1

export type RelationKind = 'kin' | 'friend' | 'rival' | 'partner';
export interface Relationship { otherId: number; kind: RelationKind; affinity: number }  // affinity -1..1

export interface Inventory { food: number; wood: number; stone: number; metal: number; tools: number }

export type TechId = 'fire' | 'agriculture' | 'construction' | 'metallurgy' | 'writing' | 'medicine';
export const TECH_IDS: readonly TechId[] = ['fire', 'agriculture', 'construction', 'metallurgy', 'writing', 'medicine'];
export const TECH_THRESHOLDS: Record<TechId, number> = { fire: 50, agriculture: 200, construction: 400, metallurgy: 800, writing: 1200, medicine: 1600 };

export interface Person {
  id: number;
  alive: boolean;
  ageTicks: number;
  sex: 'm' | 'f';
  name: string;
  pos: Vec2;                       // integer tile coords
  civId: number;
  settlementId: number | null;
  lineage: Lineage;
  traits: Traits;
  emotions: Emotions;
  morality: Morality;
  needs: Needs;
  skills: Skills;
  health: number;                  // 0..1, 0 = dead
  lifespanTicks: number;           // sampled at birth
  memory: MemoryEventRec[];        // newest first, length <= MEMORY_CAP
  relationships: Relationship[];   // length <= RELATIONSHIP_CAP
  inventory: Inventory;
  actionWeights: Record<ActionKind, number>;  // init 1.0, clamped to [ACTION_WEIGHT_MIN, ACTION_WEIGHT_MAX]
  brainState: unknown;             // JSON-serializable plain object owned by the brain
  influence: number;               // 0..1
  beliefIds: number[];
  partnerId: number | null;
  pregnantUntil: Tick | null;
  parentIds: [number, number] | null;
  causeOfDeath: string | null;
}

export interface Civ {
  id: number;
  name: string;
  color: string;                   // css hex
  knowledge: Record<TechId, number>;
  techs: TechId[];                 // currently ACTIVE techs
  atWarWith: number[];
  warWeariness: number;            // 0..1
}

export interface Settlement {
  id: number;
  civId: number;
  name: string;
  center: Vec2;
  memberIds: number[];
  stock: Inventory;                // communal stores
  structures: Record<StructureKind, number>;  // counts
}

export interface Religion {
  id: number;
  name: string;
  founderId: number;
  civId: number;
  moralityBias: Partial<Morality>;
  zeal: number;                    // 0..1
}

export interface SimConfig {
  seed: number;
  mode: 'civs' | 'mixed';          // 'civs' = 4 one-lineage civilizations; 'mixed' = 1 civ, lineages mixed
  mapSize: MapSize;
  startPopulation: number;         // 200 | 400 | 600
}

export function clamp(v: number, lo: number, hi: number): number;
export function clamp01(v: number): number;
export function dist(a: Vec2, b: Vec2): number;   // euclidean
```

## RNG — `src/engine/rng.ts` (Task 2)

```ts
export interface Rng {
  next(): number;                       // [0, 1)
  int(maxExclusive: number): number;
  range(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  gaussian(mean: number, sd: number): number;
  split(label: string): Rng;            // independent deterministic stream
}
export function createRng(seed: number): Rng;
```

Implementation guidance: mulberry32 core; `split` hashes (current seed, label) with a string hash (e.g. FNV-1a) to derive the child seed. Same seed + same labels = same streams.

## Names — `src/engine/names.ts` (Task 4)

```ts
export interface NameGen { person(sex: 'm' | 'f'): string; place(): string; civ(): string; religion(): string }
export function makeNameGenerator(rng: Rng): NameGen;   // seeded syllable combiner
```

## World — `src/engine/world/` (Tasks 5–7)

```ts
// terrain.ts
export class World {
  readonly size: number;
  tiles: Tile[];                                    // row-major, length size*size
  tileAt(x: number, y: number): Tile;
  inBounds(x: number, y: number): boolean;
  index(x: number, y: number): number;
}
export function generateWorld(size: number, rng: Rng): World;   // value-noise elevation+moisture -> terrain/fertility/resources; guarantees >= 30% habitable land

// climate.ts
export function seasonOf(tick: Tick): Season;
export function seasonYieldMultiplier(season: Season): number;   // spring 1.1, summer 1.25, autumn 1.0, winter 0.45
export function regenerateResources(world: World, tick: Tick, rng: Rng): void;   // food regrowth toward fertility cap * season; slow wood regrowth
export interface NaturalEvent { kind: 'drought' | 'harsh-winter' | 'disease'; startTick: Tick; durationTicks: number; center: Vec2 | null; intensity: number }
export function updateNaturalEvents(active: NaturalEvent[], world: World, tick: Tick, rng: Rng): NaturalEvent[];  // spawns/expires; drought suppresses regrowth, disease infects nearby people (applied in lifecycle)

// spatial.ts
export class SpatialIndex {
  rebuild(people: Person[]): void;                  // alive people only
  near(pos: Vec2, radius: number): number[];        // person ids, deterministic order (ascending id)
}
export function stepToward(from: Vec2, to: Vec2): Vec2;   // one-tile move, never into water; returns from if blocked
```

## Agents — `src/engine/agents/` (Tasks 8–19)

```ts
// person.ts
export function createPerson(id: number, civId: number, lineage: Lineage, pos: Vec2, names: NameGen, rng: Rng): Person;   // adult; traits/morality sampled; brainState set later by registry init
export function createChild(id: number, mother: Person, father: Person, names: NameGen, rng: Rng): Person;               // trait/morality blend + gaussian mutation sd 0.05; lineage = rng.pick of parents' lineages
export function initPopulation(config: SimConfig, world: World, names: NameGen, rng: Rng): { people: Person[]; civs: Civ[] };
// mode 'civs': 4 civs, one per lineage, spawned in 4 separated habitable regions; mode 'mixed': 1 civ, lineages round-robin

// needs.ts
export function updateNeeds(p: Person, tick: Tick): void;   // hunger +0.02/tick (halved if fed today), rest, safety from recent threats, belonging from relationships, esteem from influence
export function applyHungerHealth(p: Person): void;         // hunger > 0.85 drains health 0.01/tick; eating from inventory/stock handled in execute.ts

// emotions.ts
export function applyEmotionImpulse(p: Person, impulse: Partial<Emotions>, volatility: Emotions): void;  // p.emotions += impulse * volatility, clamp01
export function decayEmotions(p: Person, decayPerTick: Emotions): void;                                   // toward trait-derived baseline
export function dominantEmotion(p: Person): 'calm' | 'afraid' | 'angry' | 'joyful' | 'grieving';          // max component over 0.45, else calm

// morality.ts
export const MORAL_FOOTPRINTS: Record<ActionKind, Partial<Morality>>;  // violation magnitudes, e.g. steal: {fairness:0.7, care:0.3}, attack: {care:0.9}, share: {} (virtuous actions have empty footprints)
export function violationDot(morality: Morality, action: Action): number;   // sum(morality[k] * footprint[k]), 0..~2
export function moralGate(p: Person, action: Action, temperament: Temperament): number;
// multiplier: max(0, 1 - temperament.moralWeight * violationDot). If violationDot > 0.75 => 0 (veto),
// UNLESS desperation = max(needs.hunger, emotions.fear) >= temperament.desperationThreshold, then floor at 0.05.

// memory.ts
export function remember(p: Person, rec: MemoryEventRec): void;       // insert newest-first, evict lowest salience beyond MEMORY_CAP
export function fadeMemories(p: Person): void;                        // salience *= 0.999/tick, drop < 0.05
export function memoryBias(p: Person, otherId: number): number;       // sum valence*salience of memories about other, clamped -1..1

// relationships.ts
export function adjustRelationship(p: Person, otherId: number, kind: RelationKind, delta: number): void;
export function affinityTo(p: Person, otherId: number): number;       // 0 if none
export function isKin(p: Person, otherId: number): boolean;

// actions.ts
export function legalActions(p: Person, ctx: EngineCtx): Action[];    // candidate generation incl. targets; taboos of p's temperament removed unless desperation >= 0.95; children get reduced set
// EngineCtx is defined in simulation.ts (Task 33) and threaded through: { world, people, personById, civs, settlements, religions, spatial, names, tick, rng, events, naturalEvents }

// execute.ts
export interface Outcome { action: Action; success: boolean; reward: number; tick: Tick }   // reward in [-1, 1]
export function executeAction(p: Person, a: Action, ctx: EngineCtx): Outcome;
// implements every ActionKind's world/person effects, movement via stepToward, emotion impulses, memories for affected parties, knowledge point grants (via society/technology addKnowledge)

// perception.ts
export interface PersonGlimpse { id: number; lineage: Lineage; civId: number; settlementId: number | null; pos: Vec2; influence: number; healthy: boolean; visibleEmotion: ReturnType<typeof dominantEmotion>; affinity: number; kin: boolean }
export interface TileGlimpse { pos: Vec2; terrain: Terrain; food: number; wood: number; stone: number; metal: number }
export interface SettlementGlimpse { id: number; civId: number; center: Vec2; population: number; foodStock: number; hasGranary: boolean; hasWall: boolean; underAttack: boolean }
export interface CivGlimpse { id: number; population: number; atWarWith: number[]; techs: TechId[]; season: Season; foodPerCapita: number }
export interface DangerGlimpse { kind: 'raid' | 'disease' | 'famine'; pos: Vec2 | null; intensity: number }
export interface Perception {
  tick: Tick;
  self: Person;
  candidates: Action[];
  nearbyPeople: PersonGlimpse[];        // within PERCEPTION_RADIUS
  nearbyTiles: TileGlimpse[];           // within PERCEPTION_RADIUS
  settlement: SettlementGlimpse | null;
  nearbySettlements: SettlementGlimpse[];
  civ: CivGlimpse;
  dangers: DangerGlimpse[];
}
export function buildPerception(p: Person, ctx: EngineCtx): Perception;

// lifecycle.ts
export function updateLifecycle(p: Person, ctx: EngineCtx): void;   // aging, natural/health/disease death (sets alive=false + causeOfDeath), birth when pregnantUntil reached (uses createChild + registry init), grief impulses to kin, partner formation via prior 'court' outcomes

// learning.ts
export function reinforce(p: Person, o: Outcome, learningRate: number): void;  // w[kind] = clamp(w + learningRate * reward * 0.25, MIN, MAX)
export function maybeImitate(p: Person, ctx: EngineCtx, imitationRate: number): void;  // every 30 ticks, chance = imitationRate: blend 10% toward highest-influence neighbor's weights
export function teach(teacher: Person, student: Person): void;      // transfer skill points + 2% morality nudge (used by execute.ts 'teach')

// decide.ts
export function chooseAction(p: Person, perception: Perception, brain: Brain, rng: Rng): Action;
// 1) scored = brain.decide(perception, p.brainState, rng), filter to candidates & finite scores >= 0; fallback {kind:'rest'} if empty
// 2) eff = score * p.actionWeights[kind] * moralGate(p, action, brain.temperament())
// 3) softmax sample with SOFTMAX_TEMP over normalized eff
```

## Brain Contract — `src/engine/brains/types.ts` + `registry.ts` (Task 20)

```ts
// types.ts
export interface Temperament {
  emotionVolatility: Emotions;       // multipliers, each 0.25..4
  emotionDecayPerTick: Emotions;     // each 0..0.2
  moralWeight: number;               // 0..2
  learningRate: number;              // 0..1
  imitationRate: number;             // 0..1
  desperationThreshold: number;      // 0..1 (1 = morality never breaks)
  taboos: ActionKind[];
  quirks: string[];                  // short human-readable, shown in UI
  description: string;               // one paragraph philosophy, shown in UI
}
export interface Brain {
  readonly lineage: Lineage;
  temperament(): Temperament;                                                   // must be constant per lineage
  init(person: Person, rng: Rng): unknown;                                      // returns fresh JSON-serializable brainState
  decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[];
  onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void;             // may mutate brainState only
}

// registry.ts
export function getBrain(lineage: Lineage): Brain;
export function allBrains(): Brain[];
```

The four brain files are **authored at plan-execution time by subagents running the matching Claude model** (Agent tool `model: 'opus' | 'sonnet' | 'haiku' | 'fable'`). Plan tasks 21–24 contain the authoring brief, not pre-written code — pre-writing them would destroy the experiment. All four must pass the identical conformance suite (Task 20): valid subset scoring, no NaN/negative scores, JSON-round-trippable state, decide() < 1ms average over 1000 calls, deterministic given same Rng seed, no imports outside the sandbox list, temperament within documented ranges.

Tests that need a brain before Task 21 use `tests/helpers/testBrain.ts`:
```ts
export function makeTestBrain(lineage?: Lineage): Brain;   // scores every candidate 1.0, neutral temperament, {} state — defined in Task 19
```

## Society — `src/engine/society/` (Tasks 26–32)

```ts
// settlements.ts
export function updateSettlements(ctx: EngineCtx): void;   // form (>=5 people within radius 3 on habitable land), assign members, dissolve (<3), grow via 'build' outcomes; capacity = 10 + 8*shelters (2x with construction tech)

// influence.ts
export function updateInfluence(ctx: EngineCtx): void;     // influence from esteem, skill, relationships, victories; decay; leader of settlement = max influence member
export function leaderOf(s: Settlement, ctx: EngineCtx): Person | null;

// culture.ts
export interface CultureVector { morality: Morality; traits: Traits }
export function civCulture(civId: number, ctx: EngineCtx): CultureVector;    // population aggregate
export function cultureDistance(a: CultureVector, b: CultureVector): number; // 0..1 normalized
export function maybeSchism(ctx: EngineCtx): void;   // settlement whose local culture distance from civ > 0.35 for 2+ years, with a leader of influence > 0.6, secedes into a new Civ (new id/name/color); emits event

// technology.ts
export function addKnowledge(civ: Civ, domain: TechId, points: number): void;
export function updateTechnology(ctx: EngineCtx): void;    // unlock at TECH_THRESHOLDS; ACTIVE only while >= 3 living members have the mapped skill >= 0.4 (fire->gathering, agriculture->farming, construction->building, metallurgy->crafting, writing->teaching, medicine->healing); writing freezes knowledge decay; inactive = "lost" (event)
export function techYieldMultiplier(civ: Civ, action: ActionKind): number;   // e.g. agriculture doubles 'farm', metallurgy boosts craft/attack, medicine boosts heal

// religion.ts
export function maybeFoundReligion(ctx: EngineCtx): void;  // after disaster events: high-sanctity high-influence witness founds; creates Religion with moralityBias derived from founder
export function spreadBeliefs(ctx: EngineCtx): void;       // socialize contact: adoption chance ~ believer influence * fear * zeal; believers' morality nudged 0.5%/tick toward bias; shrines boost zeal

// economy.ts
export function shareWithin(ctx: EngineCtx): void;         // agents deposit surplus to settlement stock / draw when hungry, modulated by care+loyalty vs liberty
export function tradeBetween(ctx: EngineCtx): void;        // neighboring settlements (dist < 25, not at war) swap surplus resource for deficit resource at 1:1, small relationship/affinity boost between civs

// conflict.ts
export function updateConflict(ctx: EngineCtx): void;
// raid: aggressive leader + scarcity or grudge -> raid party targets nearby settlement's stock; resolution from fighting skill totals + walls + metallurgy; casualties, stolen stock, memories/grief/anger both sides
// war: civ-level state after repeated raids; raises raid rate; peace when both warWeariness > 0.7 (weariness grows with casualties)
```

## Simulation — `src/engine/sim/` + worker (Tasks 33–37)

```ts
// simulation.ts
export interface EngineCtx {
  world: World; people: Person[]; personById: Map<number, Person>;
  civs: Civ[]; settlements: Settlement[]; religions: Religion[];
  spatial: SpatialIndex; names: NameGen; tick: Tick; rng: Rng;
  events: NarrativeEvent[]; naturalEvents: NaturalEvent[];
  counters: { births: number; deaths: number };                  // per-tick, reset each tick
}
export class Simulation {
  constructor(config: SimConfig);
  readonly config: SimConfig;
  readonly ctx: EngineCtx;
  currentTick: Tick;
  tick(): void;
  // tick order (fixed): 1 regenerateResources+updateNaturalEvents, 2 spatial.rebuild, 3 per-person (ascending id, alive only): updateNeeds -> decayEmotions -> buildPerception+legalActions -> chooseAction -> executeAction -> reinforce, 4 updateLifecycle all, 5 society: updateSettlements, updateInfluence, shareWithin, tradeBetween, updateConflict, updateTechnology, spreadBeliefs+maybeFoundReligion, maybeSchism, 6 fadeMemories+maybeImitate, 7 metrics/events flush, 8 (DEV) assertInvariants
}

// invariants.ts
export function checkInvariants(sim: Simulation): string[];  // [] when healthy: population accounting balances, no NaN/Inf in any person field, no negative stocks/inventory, every alive person has valid brainState & civId, memory/relationship caps respected

// events.ts
export interface NarrativeEvent { tick: Tick; kind: string; severity: 1 | 2 | 3; civId: number | null; text: string }
export function pushEvent(ctx: EngineCtx, kind: string, severity: 1 | 2 | 3, civId: number | null, text: string): void;  // ring buffer cap 500
// narration templates for: birth, death (by cause), settlement founded/dissolved, leader emerged, tech unlocked/lost, religion founded, raid, war declared/peace, schism, famine, drought, disease, extinction

// snapshot.ts + shared/protocol.ts
export interface CivMetrics { civId: number; name: string; color: string; population: number; births: number; deaths: number; techCount: number; atWar: boolean; lineageShare: Record<Lineage, number>; avgMorality: Morality; avgEmotions: Emotions; foodPerCapita: number }
export interface SettlementView { id: number; civId: number; x: number; y: number; population: number; name: string; structures: Record<StructureKind, number> }
export interface Snapshot {
  tick: Tick; year: number; season: Season; population: number; worldSize: number;
  ids: Int32Array; xs: Float32Array; ys: Float32Array;
  civIds: Int16Array; lineages: Int8Array; healths: Uint8Array; moods: Uint8Array;  // mood = dominantEmotion index in ['calm','afraid','angry','joyful','grieving']
  settlements: SettlementView[];
  territory: Int16Array | null;   // per-tile owning civId or -1; included every 10th snapshot
  recentEvents: NarrativeEvent[]; // since last snapshot
  metrics: CivMetrics[];
}
export function takeSnapshot(sim: Simulation, includeTerritory: boolean): Snapshot;
export interface PersonDetail { person: Person; memoriesText: string[]; relationshipsNamed: { name: string; kind: RelationKind; affinity: number }[]; temperament: Temperament; settlementName: string | null; civName: string }
export function personDetail(sim: Simulation, id: number): PersonDetail | null;

// save.ts
export function serialize(sim: Simulation): string;           // versioned JSON incl. rng state, brainStates, config
export function deserialize(json: string): Simulation;
export function checksum(sim: Simulation): number;            // FNV-1a over stable serialization

// shared/protocol.ts — worker messages
export type UiToWorker =
  | { type: 'init'; config: SimConfig }
  | { type: 'setSpeed'; ticksPerSecond: number }               // 0 = paused; presets 1/10/60/360/1000; 'skip-generation' = run 7200 ticks fast
  | { type: 'step'; n: number }
  | { type: 'inspect'; personId: number }
  | { type: 'serialize' }
  | { type: 'load'; json: string };
export type WorkerToUi =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: Snapshot }                   // ~5/sec while running
  | { type: 'inspect'; detail: PersonDetail | null }
  | { type: 'serialized'; json: string }
  | { type: 'error'; message: string };
// worker.ts wires protocol to Simulation; transfers typed-array buffers
```

## UI — `src/ui/` (Tasks 38–44)

```ts
// dom.ts
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>, ...children: (Node | string)[]): HTMLElementTagNameMap[K];

// client.ts
export class SimClient {   // wraps Worker, typed send/subscribe, auto-restart from last autosave on worker error
  start(config: SimConfig): void;
  send(msg: UiToWorker): void;
  onSnapshot(cb: (s: Snapshot) => void): void;
  onInspect(cb: (d: PersonDetail | null) => void): void;
  onSerialized(cb: (json: string) => void): void;
  onError(cb: (message: string) => void): void;
}

// map.ts
export class MapView {      // canvas: terrain layer (offscreen, cached), territory tint, settlements, agent dots colored by civ (mode civs) / lineage (mode mixed), pan (drag) + zoom (wheel, 0.5x..24x), click -> nearest agent id or settlement
  constructor(canvas: HTMLCanvasElement);
  render(snapshot: Snapshot): void;
  onPickPerson(cb: (id: number) => void): void;
  onPickSettlement(cb: (id: number) => void): void;
}

// charts.ts
export function lineChart(canvas: HTMLCanvasElement, series: { label: string; color: string; points: number[] }[], opts?: { yMax?: number }): void;
export function stackedAreaChart(canvas: HTMLCanvasElement, series: { label: string; color: string; points: number[] }[]): void;   // lineage share
export function radarChart(canvas: HTMLCanvasElement, axes: string[], values: number[], color: string): void;                       // morality

// storage.ts (IndexedDB, db 'genesis', store 'saves')
export function saveRun(name: string, json: string): Promise<void>;
export function loadRun(name: string): Promise<string | null>;
export function listRuns(): Promise<{ name: string; savedAt: number; bytes: number }[]>;
export function deleteRun(name: string): Promise<void>;
// autosave: every 60s to name '__autosave'; on startup offer resume if present
```

Screens: **setup** (mode cards, map size, population, seed input with "random" button, Begin) → **run** (left: map canvas full-height; right dock: tabs Inspector / Civilizations / History; top bar: year/season/population, time controls pause/1×/10×/60×/360×/1000×/skip-generation, save/load/export/import buttons). Dark theme via CSS custom properties in `theme.css`. Event feed shows newest first, severity-colored, filter by civ. Person inspector: emotion gauges (bars), morality radar, memory list, relationships with names, lineage badge + temperament quirks/description. Dashboard: per-civ population line chart, lineage-share stacked area (headline in mixed mode), tech list, war status, births/deaths, avg emotions.

## Plan Task Index

Section files live at `docs/superpowers/plans/sections/NN-<name>.md`. Tasks are numbered globally and executed in order; each depends only on lower-numbered tasks.

- **S1 Foundations (Tasks 1–4):** 1 project scaffold (package.json, tsconfig strict, vite.config.ts with vitest config, index.html, npm scripts dev/build/preview/test/typecheck, folder tree, .gitignore); 2 rng.ts; 3 shared/types.ts (verbatim from this contract + clamp/clamp01/dist implementations); 4 names.ts
- **S2 World (5–7):** 5 terrain.ts; 6 climate.ts; 7 spatial.ts
- **S3 Agent core (8–16):** 8 person.ts; 9 needs.ts; 10 emotions.ts; 11 morality.ts; 12 memory.ts; 13 relationships.ts; 14 actions.ts; 15 execute.ts; 16 perception.ts
- **S4 Lifecycle/learning/decision (17–19):** 17 lifecycle.ts; 18 learning.ts; 19 decide.ts + tests/helpers/testBrain.ts
- **S5 Brains (20–25):** 20 brains/types.ts + registry.ts + conformance suite; 21 opus.ts (model: opus); 22 sonnet.ts (model: sonnet); 23 haiku.ts (model: haiku); 24 fable.ts (model: fable); 25 brain integration: 4-lineage mini-sim runs 500 ticks, lineage heritability verified, all lineages act distinctly (temperaments differ pairwise)
- **S6 Society (26–32):** 26 settlements.ts; 27 influence.ts; 28 culture.ts; 29 technology.ts; 30 religion.ts; 31 economy.ts; 32 conflict.ts
- **S7 Simulation (33–37):** 33 simulation.ts + invariants.ts; 34 events.ts; 35 snapshot.ts + protocol Snapshot/CivMetrics/PersonDetail; 36 save.ts + determinism checksum test + forbidden-API grep test; 37 worker.ts + protocol messages
- **S8 UI & integration (38–45):** 38 dom.ts + theme.css + main.ts + setup.ts; 39 client.ts + controls.ts; 40 map.ts; 41 inspector.ts; 42 charts.ts + dashboard.ts; 43 feed.ts; 44 storage.ts + replay.ts + autosave/crash recovery; 45 smoke/balance harness (5000-tick headless runs both modes, plausibility bounds, per-lineage survival sanity), README.md, final `npm run build` verification

Society modules run inside `Simulation.tick()` (Task 33) — S6 tasks each export pure-ish `update*(ctx)` functions tested against hand-built `EngineCtx` fixtures; a minimal `makeTestCtx()` fixture helper is defined in Task 26 at `tests/helpers/testCtx.ts` and reused by 27–36.

## UI/UX Design Direction (Tasks 38–44 must follow)

Dark observatory aesthetic: near-black blue-grey background (`#0b0e14`), panel surfaces `#131722`, text `#e6e9f0`, accent per-civ colors (fixed palette: `#e4572e`, `#3d9be9`, `#76b041`, `#b76ce9`, then generated hues for schism civs), lineage badge colors: opus `#d4a24e`, sonnet `#3d9be9`, haiku `#76b041`, fable `#b76ce9`. Rounded 8px panels, 1px `#232a3a` borders, `Inter, system-ui` stack, tabular numerals for stats. Canvas map fills viewport height; right dock 380px; smooth 60fps pan/zoom (requestAnimationFrame, render only on change or new snapshot).
