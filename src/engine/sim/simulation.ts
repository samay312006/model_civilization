import {
  type ActionKind,
  type Civ,
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
import { executeAction, type ExecuteCtxLike, type Outcome } from '../agents/execute';
import { buildPerception, type PerceptionCtxLike, type Perception } from '../agents/perception';
import { updateLifecycle, type LifecycleCtx } from '../agents/lifecycle';
import { reinforce, maybeImitate, type LearningCtx } from '../agents/learning';
import { fadeMemories } from '../agents/memory';
import { chooseAction } from '../agents/decide';
import { getBrain } from '../brains/registry';
import { updateSettlements, type SettlementsCtxLike } from '../society/settlements';
import { updateInfluence, leaderOf, type InfluenceCtxLike } from '../society/influence';
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
import {
  pushEvent,
  narrateBirth,
  narrateDeath,
  narrateSettlementFounded,
  narrateSettlementDissolved,
  narrateLeaderEmerged,
  narrateTechUnlocked,
  narrateTechLost,
  narrateReligionFounded,
  narrateRaid,
  narrateWarDeclared,
  narratePeace,
  narrateFamine,
  narrateDisaster,
  type NarrativeEvent,
} from './events';
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

// 'harsh-winter' is deliberately excluded: it is a routine seasonal hardship
// (rolled every winter with its own chance, map-wide, never civ-ending) that
// needs.ts/lifecycle.ts already model as ambient attrition, not the kind of
// singular calamity that plausibly moves someone to found a religion.
const DISASTER_EVENT_KINDS = new Set(['famine', 'drought', 'disease', 'raid']);
const RELIGION_EVENT_WINDOW = 30;

/**
 * The full engine context threaded through every module call. A structural
 * superset of every CtxLike interface from Sections 3, 4, and 6, so every
 * update-style call (legalActions, executeAction, buildPerception,
 * updateLifecycle, ...) below passes `this.ctx` (optionally widened with a
 * couple of locally-computed fields for religion.ts) with no adapter objects.
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

/**
 * Concrete side of Section 6 deviation 7: builds the DisasterWitnessEvent[]
 * religion.ts needs from the event log.
 *
 * Semantic note (Task 33 review fix): this filters candidate events by KIND
 * (DISASTER_EVENT_KINDS) with severity >= 2, not by matching the source
 * NarrativeEvent's severity to religion.ts's gate value. Disaster narration
 * in tick() is pushed at severity 2 (regional, not civ-ending) and severity 3
 * is reserved elsewhere in the feed taxonomy for war-declared/schism/
 * extinction — so requiring severity === 3 here on the *source* event would
 * make this function permanently return [] (the original bug: every disaster
 * was silently dropped and maybeFoundReligion never received a witness).
 * religion.ts's own maybeFoundReligion separately hard-gates on
 * `e.severity === 3` for the *DisasterWitnessEvent* it receives (its founding
 * threshold, not a passthrough of narration severity), so the witness event
 * pushed below is always constructed with severity: 3 — a fixed "this counts
 * as founding-worthy" sentinel, decoupled from the originating narration's
 * own severity field.
 */
export function makeDisasterWitnessEvents(
  events: NarrativeEvent[],
  tick: Tick,
  window: number,
): DisasterWitnessEvent[] {
  const out: DisasterWitnessEvent[] = [];
  for (const e of events) {
    if (!DISASTER_EVENT_KINDS.has(e.kind)) continue;
    if (e.severity < 2) continue;
    if (tick - e.tick < 0 || tick - e.tick > window) continue;
    out.push({ tick: e.tick, civId: e.civId ?? -1, severity: 3 });
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
    // eventsRng/societyRng/lifecycleRng: intentionally unused streams. These
    // splits exist only so the RNG_LABEL_* constants are exercised once at
    // construction time and documented for save.ts determinism (a save/load
    // round-trip must reproduce the same label namespace); the real
    // per-subsystem randomness is drawn per-tick via ctx.rng.split(...) calls
    // scattered through tick() (e.g. `p${p.id}`, `events-${ctx.tick}`), which
    // is the actual determinism mechanism — not these constructor-time splits.
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
    // sees this tick's droughts. Newly-started NaturalEvents this tick also
    // become disaster narration (drought/harsh-winter/disease); severity 2
    // (regional, not yet civ-ending). `makeDisasterWitnessEvents` (used later,
    // by religion) reads these back out of ctx.events, so this must run
    // before the religion phase.
    ctx.naturalEvents = updateNaturalEvents(ctx.naturalEvents, ctx.world, ctx.tick, ctx.rng.split(`events-${ctx.tick}`));
    regenerateResources(ctx.world, ctx.tick, ctx.rng.split(`regrowth-${ctx.tick}`), ctx.naturalEvents);
    for (const ev of ctx.naturalEvents) {
      if (ev.startTick !== ctx.tick) continue;
      const regionDescription =
        ev.center !== null ? `the region near (${ev.center.x}, ${ev.center.y})` : 'the land';
      pushEvent(ctx, ev.kind, 2, null, narrateDisaster(ev.kind, regionDescription));
    }
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
    // Births/deaths are narrated here via straightforward before/after diffs:
    // updateLifecycle appends new Person objects to ctx.people for births
    // (contract: "birth when pregnantUntil reached (uses createChild...)")
    // and flips `alive` false + sets `causeOfDeath` for deaths — both are
    // observable without any change to lifecycle.ts's void return type.
    const rosterCountBefore = ctx.people.length;
    const aliveIdsBefore = new Set(ctx.people.filter((p) => p.alive).map((p) => p.id));
    const lifecycleCtx: LifecycleCtx = ctx;
    for (const p of [...ctx.people].sort((a, b) => a.id - b.id)) {
      updateLifecycle(p, lifecycleCtx, (child, rng) => getBrain(child.lineage).init(child, rng));
    }
    for (const p of ctx.people) {
      if (!ctx.personById.has(p.id)) ctx.personById.set(p.id, p);
    }
    // Births: every person appended to ctx.people during this phase.
    // Counters note (Task 33 review fix): ctx.counters.births/deaths are
    // owned exclusively by lifecycle.ts (it increments them at the exact
    // birth/death sites inside updateLifecycle, see lifecycle.ts). This loop
    // only narrates — it must never also increment ctx.counters, or every
    // birth/death would be counted twice (once here, once in lifecycle.ts).
    for (let i = rosterCountBefore; i < ctx.people.length; i++) {
      const child = ctx.people[i];
      if (child === undefined || child.parentIds === null) continue;
      const mother = ctx.personById.get(child.parentIds[0]);
      const father = ctx.personById.get(child.parentIds[1]);
      pushEvent(
        ctx,
        'birth',
        1,
        child.civId,
        narrateBirth(child.name, mother?.name ?? 'someone', father?.name ?? 'someone'),
      );
    }
    // Deaths: every previously-alive person now alive=false. (Counters owned
    // by lifecycle.ts — see note above; no ctx.counters.deaths increment here.)
    for (const p of ctx.people) {
      if (!aliveIdsBefore.has(p.id)) continue;
      if (p.alive) continue;
      pushEvent(ctx, 'death', p.causeOfDeath === 'old-age' ? 1 : 2, p.civId, narrateDeath(p.name, p.causeOfDeath ?? 'unknown causes'));
    }
    emit(ctx, 'lifecycle');

    // Phase: settlements (step 5a). Founded/dissolved narrated via an id-set
    // diff (updateSettlements mutates ctx.settlements in place per the
    // contract: "form ... assign members, dissolve (<3)").
    const settlementsBefore = new Map(ctx.settlements.map((s) => [s.id, s.name] as const));
    const settlementsCtx: SettlementsCtxLike = ctx;
    updateSettlements(settlementsCtx);
    const settlementIdsAfter = new Set(ctx.settlements.map((s) => s.id));
    for (const s of ctx.settlements) {
      if (settlementsBefore.has(s.id)) continue;
      const civ = ctx.civs.find((c) => c.id === s.civId);
      pushEvent(ctx, 'settlement-founded', 2, s.civId, narrateSettlementFounded(s.name, civ?.name ?? 'an unknown people'));
    }
    for (const [id, name] of settlementsBefore) {
      if (settlementIdsAfter.has(id)) continue;
      pushEvent(ctx, 'settlement-dissolved', 2, null, narrateSettlementDissolved(name));
    }
    emit(ctx, 'settlements');

    // Phase: influence (step 5b). Leader-emerged narrated via a per-settlement
    // leaderOf(...) diff (contract: "leader of settlement = max influence
    // member"); a settlement gaining a leader where it had none, or changing
    // to a different person, counts as an emergence.
    const leaderIdsBefore = new Map<number, number | null>();
    for (const s of ctx.settlements) leaderIdsBefore.set(s.id, leaderOf(s, ctx)?.id ?? null);
    const influenceCtx: InfluenceCtxLike = ctx;
    updateInfluence(influenceCtx);
    for (const s of ctx.settlements) {
      const before = leaderIdsBefore.get(s.id) ?? null;
      const after = leaderOf(s, ctx)?.id ?? null;
      if (after === null || after === before) continue;
      const leader = ctx.personById.get(after);
      if (leader === undefined) continue;
      pushEvent(ctx, 'leader-emerged', 1, s.civId, narrateLeaderEmerged(leader.name, s.name));
    }
    emit(ctx, 'influence');

    // Phase: economy (step 5c) — shareWithin then tradeBetween, as ordered.
    // Famine narrated via a per-settlement stock.food transition to
    // depleted (>0 before economy resolves this tick's draws, 0 after) while
    // the settlement still has members — economy.ts is where hungry members
    // draw down stock (contract: "draw when hungry"), making this phase the
    // correct place to observe the transition.
    const hadFoodBefore = new Map<number, boolean>();
    for (const s of ctx.settlements) hadFoodBefore.set(s.id, s.stock.food > 0);
    const economyCtx: EconomyCtxLike = ctx;
    shareWithin(economyCtx);
    tradeBetween(economyCtx);
    for (const s of ctx.settlements) {
      if (s.memberIds.length === 0) continue;
      const had = hadFoodBefore.get(s.id) ?? false;
      if (had && s.stock.food <= 0) {
        pushEvent(ctx, 'famine', 2, s.civId, narrateFamine(s.name));
      }
    }
    emit(ctx, 'economy');

    // Phase: conflict (step 5d). War declared/peace narrated via a per-civ
    // atWarWith diff; raids narrated via freshly-recorded 'victory'/'defeat'
    // memories (contract conflict.ts note: "casualties, stolen stock,
    // memories/grief/anger both sides") on attacker/defender settlement
    // leaders — updateConflict itself returns void, so both signals are read
    // back from the state it is documented to mutate.
    const atWarBefore = new Map<number, Set<number>>();
    for (const civ of ctx.civs) atWarBefore.set(civ.id, new Set(civ.atWarWith));
    const conflictCtx: ConflictCtxLike = ctx;
    updateConflict(conflictCtx);
    for (const civ of ctx.civs) {
      const before = atWarBefore.get(civ.id) ?? new Set<number>();
      for (const otherId of civ.atWarWith) {
        if (before.has(otherId) || otherId < civ.id) continue; // narrate each pair once, lower id first
        const other = ctx.civs.find((c) => c.id === otherId);
        pushEvent(ctx, 'war-declared', 3, civ.id, narrateWarDeclared(civ.name, other?.name ?? 'an unknown people'));
      }
      for (const otherId of before) {
        if (civ.atWarWith.includes(otherId) || otherId < civ.id) continue;
        const other = ctx.civs.find((c) => c.id === otherId);
        pushEvent(ctx, 'peace', 2, civ.id, narratePeace(civ.name, other?.name ?? 'an unknown people'));
      }
    }
    // Dedupe note (Task 33 review fix): resolveRaid records a 'victory'/
    // 'defeat' memory on EVERY combatant on BOTH sides (all attackers, all
    // defenders), so a naive per-person scan pushed one 'raid' event per
    // participant — a single raid with, say, 6 attackers + 4 defenders
    // narrated as 10 duplicate events. Every combatant of one raid resolves
    // to the same unordered pair of settlements (their own settlementId, and
    // the settlementId of the person recorded at memory.otherId), so keying
    // on that pair collapses one raid to exactly one event while still
    // letting two distinct raids (different settlement pairs) this same
    // tick narrate separately.
    const narratedRaidPairs = new Set<string>();
    for (const p of [...ctx.people].sort((a, b) => a.id - b.id)) {
      const latest = p.memory[0];
      if (latest === undefined || latest.tick !== ctx.tick) continue;
      if (latest.kind !== 'victory' && latest.kind !== 'defeat') continue;
      const other = ctx.personById.get(latest.otherId);
      if (other === undefined) continue;
      const sIdA = p.settlementId;
      const sIdB = other.settlementId;
      if (sIdA === null || sIdB === null || sIdA === sIdB) continue;
      const pairKey = sIdA < sIdB ? `${sIdA}:${sIdB}` : `${sIdB}:${sIdA}`;
      if (narratedRaidPairs.has(pairKey)) continue;
      narratedRaidPairs.add(pairKey);
      const settlement = ctx.settlements.find((s) => s.id === p.settlementId);
      const attackerWon = latest.kind === 'victory';
      const attackerCiv = ctx.civs.find((c) => c.id === p.civId);
      pushEvent(
        ctx,
        'raid',
        2,
        p.civId,
        narrateRaid(attackerCiv?.name ?? 'Raiders', settlement?.name ?? 'a nearby settlement', attackerWon),
      );
    }
    emit(ctx, 'conflict');

    // Phase: technology (step 5e). Unlocked/lost narrated via a per-civ
    // civ.techs array diff (contract: "unlock at TECH_THRESHOLDS ... inactive
    // = 'lost' (event)" — the parenthetical "(event)" names this exact
    // narration point).
    const techsBefore = new Map<number, Set<string>>();
    for (const civ of ctx.civs) techsBefore.set(civ.id, new Set(civ.techs));
    const technologyCtx: TechnologyCtxLike = ctx;
    updateTechnology(technologyCtx);
    for (const civ of ctx.civs) {
      const before = techsBefore.get(civ.id) ?? new Set<string>();
      for (const techId of civ.techs) {
        if (!before.has(techId)) pushEvent(ctx, 'tech-unlocked', 2, civ.id, narrateTechUnlocked(techId, civ.name));
      }
      for (const techId of before) {
        if (!civ.techs.includes(techId as (typeof civ.techs)[number])) {
          pushEvent(ctx, 'tech-lost', 2, civ.id, narrateTechLost(techId, civ.name));
        }
      }
    }
    emit(ctx, 'technology');

    // Phase: religion (step 5f) — spreadBeliefs then maybeFoundReligion, as
    // ordered. Religion founded narrated via an id-set diff on ctx.religions.
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
    const religionIdsBefore = new Set(ctx.religions.map((r) => r.id));
    maybeFoundReligion(religionCtx);
    for (const r of ctx.religions) {
      if (religionIdsBefore.has(r.id)) continue;
      const founder = ctx.personById.get(r.founderId);
      const civ = ctx.civs.find((c) => c.id === r.civId);
      pushEvent(
        ctx,
        'religion-founded',
        2,
        r.civId,
        narrateReligionFounded(r.name, founder?.name ?? 'a nameless prophet', civ?.name ?? 'an unknown people'),
      );
    }
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
      fadeMemories(p);
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
