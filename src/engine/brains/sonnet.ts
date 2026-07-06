// The Sonnet lineage brain: the Ledger-Keepers.
//
// Design philosophy (see task-22-report.md for the full essay): Sonnet
// people measure a life by what is owed and what is owing. They keep a
// private, per-relationship ledger of favors given and wrongs endured, and
// they repay both — generosity and grudge alike — in careful proportion.
// They prize durability (a stocked granary, a taught skill, a kept peace)
// over conquest or wanderlust, negotiate before they fight, and hold one
// line no desperation moves: they will not raise a hand against kin.
//
// Only sandboxed imports: './types', '../rng', '../agents/perception',
// '../../shared/types'. All randomness flows through the injected Rng; no
// wall-clock reads, no DOM, no globals.

import type { Brain, Outcome, Perception, Temperament } from './types';
import type { CivGlimpse, PersonGlimpse, SettlementGlimpse } from '../agents/perception';
import { clamp, clamp01, type Action, type ActionKind, type Person, type ScoredAction } from '../../shared/types';
import type { Rng } from '../rng';

// ---------------------------------------------------------------------------
// Temperament — constant by value, never mutated after module load.
// ---------------------------------------------------------------------------

const SONNET_TABOOS: ActionKind[] = ['steal', 'attack'];

const SONNET_QUIRKS: string[] = [
  'Keeps a private ledger of every kindness and betrayal, and repays both in kind.',
  'Offers a stranger exactly one unconditional gift before expecting anything back.',
  'Will not raise a hand against kin, no matter the grudge.',
  'Fights only to defend home, settlement, or family — never to start a war.',
  'Refuses to wander off exploring while the household or settlement is hungry.',
  'Teaches its own children and neighbors freely, but grows guarded with outsiders in wartime.',
];

const SONNET_DESCRIPTION =
  'Sonnet people are ledger-keepers: patient, exacting, and quietly generous, they build trust the way ' +
  'they build granaries — one deliberate course at a time. They believe a life is measured less by what ' +
  'it seizes than by what it is owed and what it owes, and they carry a private accounting of every favor ' +
  'extended and every wrong endured, repaying both eventually and in proportion. They would rather ' +
  'negotiate, trade, or simply walk away than fight, and they treat violence against kin as unthinkable ' +
  'even when starving closes every other door; only a raid on their own home, or a blade already drawn ' +
  'against their family, earns aggression a clean conscience. They are craftsmen and teachers first, ' +
  'explorers second — curious about the world, but never so curious that they leave a hungry household to ' +
  'go looking for it. What frightens them most is not death but debt: the unpaid kindness, the unresolved ' +
  'grudge, the home left in disrepair. What they treasure most is durability — a full granary, a taught ' +
  'skill passed to a child, a peace kept long enough to be trusted.';

const SONNET_TEMPERAMENT: Temperament = {
  // Sonnet people run cooler on fear and anger than most — panic and rage
  // are expensive and rarely change the ledger in their favor — but they
  // feel hope and joy keenly, because durable gains (a home, a bond, a
  // finished granary) are exactly what they are optimizing for.
  emotionVolatility: { fear: 0.8, joy: 1.25, grief: 1.1, anger: 0.7, hope: 1.3 },
  // Grief lingers (they remember losses the way they remember debts); anger
  // burns off fastest of all, because held anger curdles judgment.
  emotionDecayPerTick: { fear: 0.06, joy: 0.05, grief: 0.025, anger: 0.09, hope: 0.05 },
  moralWeight: 1.3,
  learningRate: 0.6,
  imitationRate: 0.3,
  // High but not absolute: true desperation can still crack a taboo, but
  // only well past the edge of ordinary hardship.
  desperationThreshold: 0.82,
  taboos: SONNET_TABOOS,
  quirks: SONNET_QUIRKS,
  description: SONNET_DESCRIPTION,
};

// ---------------------------------------------------------------------------
// brainState — plain, JSON-serializable, per-agent.
// ---------------------------------------------------------------------------

interface SonnetBrainState {
  /** A long-run focus this person leans toward when nothing else presses. */
  aspiration: ActionKind;
  /** Remembered "home" tile — where this person's roots are. */
  homeX: number;
  homeY: number;
  /** Ticks since last treating the home tile as settled (resets on migration). */
  ticksSinceHome: number;
  /** Net favor balance per other person id (string key): + they are owed our
   *  goodwill / trusted, - a grudge is held. Bounded to [-1, 1] per entry. */
  ledger: Record<string, number>;
  /** Consecutive failed aggressive/underhanded actions (cools aggression). */
  grudgeStreak: number;
  /** Consecutive successes at the current aspiration (reinforces focus). */
  trustStreak: number;
}

const ASPIRATION_POOL: ActionKind[] = ['build', 'craft', 'farm', 'explore', 'teach', 'heal', 'hunt'];

function aspirationWeight(kind: ActionKind, traits: Person['traits']): number {
  switch (kind) {
    case 'build':
      return 0.3 + traits.industriousness;
    case 'craft':
      return 0.2 + traits.industriousness * 0.8;
    case 'farm':
      return 0.2 + traits.industriousness * 0.6;
    case 'explore':
      return 0.2 + traits.curiosity;
    case 'teach':
      return 0.2 + traits.empathy;
    case 'heal':
      return 0.15 + traits.empathy * 0.8;
    case 'hunt':
      return 0.15 + traits.riskTolerance * 0.6;
    default:
      return 0.1;
  }
}

function pickAspiration(person: Person, rng: Rng): ActionKind {
  const weights = ASPIRATION_POOL.map((k) => ({ k, w: aspirationWeight(k, person.traits) }));
  const total = weights.reduce((sum, x) => sum + x.w, 0);
  let r = rng.next() * total;
  for (const x of weights) {
    if (r < x.w) return x.k;
    r -= x.w;
  }
  return ASPIRATION_POOL[ASPIRATION_POOL.length - 1] as ActionKind;
}

function rotateAspiration(current: ActionKind, rng: Rng): ActionKind {
  const options = ASPIRATION_POOL.filter((k) => k !== current);
  return rng.pick(options);
}

/** Read-only, non-mutating view of brainState with safe defaults. Used by decide(). */
function readState(bs: unknown): SonnetBrainState {
  const obj: Record<string, unknown> = typeof bs === 'object' && bs !== null ? (bs as Record<string, unknown>) : {};
  const ledgerRaw = obj.ledger;
  const ledger: Record<string, number> =
    typeof ledgerRaw === 'object' && ledgerRaw !== null ? (ledgerRaw as Record<string, number>) : {};
  return {
    aspiration: (typeof obj.aspiration === 'string' ? (obj.aspiration as ActionKind) : 'build'),
    homeX: typeof obj.homeX === 'number' ? obj.homeX : 0,
    homeY: typeof obj.homeY === 'number' ? obj.homeY : 0,
    ticksSinceHome: typeof obj.ticksSinceHome === 'number' ? obj.ticksSinceHome : 0,
    ledger,
    grudgeStreak: typeof obj.grudgeStreak === 'number' ? obj.grudgeStreak : 0,
    trustStreak: typeof obj.trustStreak === 'number' ? obj.trustStreak : 0,
  };
}

/**
 * Mutating accessor used by onOutcome(): fills in any missing fields directly
 * onto the passed-in object (so the caller's reference stays authoritative)
 * and returns it typed for convenience.
 */
function coerceState(bs: unknown): SonnetBrainState {
  const obj: Record<string, unknown> =
    typeof bs === 'object' && bs !== null ? (bs as Record<string, unknown>) : ({} as Record<string, unknown>);
  if (typeof obj.aspiration !== 'string') obj.aspiration = 'build';
  if (typeof obj.homeX !== 'number') obj.homeX = 0;
  if (typeof obj.homeY !== 'number') obj.homeY = 0;
  if (typeof obj.ticksSinceHome !== 'number') obj.ticksSinceHome = 0;
  if (typeof obj.ledger !== 'object' || obj.ledger === null) obj.ledger = {};
  if (typeof obj.grudgeStreak !== 'number') obj.grudgeStreak = 0;
  if (typeof obj.trustStreak !== 'number') obj.trustStreak = 0;
  return obj as unknown as SonnetBrainState;
}

// ---------------------------------------------------------------------------
// decide() — scoring
// ---------------------------------------------------------------------------

interface ScoreCtx {
  self: Person;
  state: SonnetBrainState;
  target: PersonGlimpse | undefined;
  civ: CivGlimpse;
  avgTileFood: number;
  avgTileWood: number;
  avgTileStone: number;
  dangerIntensity: number;
  hasRaidDanger: boolean;
  settlement: SettlementGlimpse | null;
  settlementUnderAttack: boolean;
  settlementLowFood: boolean;
  settlementHasGranary: boolean;
  settlementHasWall: boolean;
  atWar: boolean;
}

function baseScoreFor(action: Action, c: ScoreCtx): number {
  const { self, state, target, civ, settlement } = c;
  const needs = self.needs;
  const emo = self.emotions;
  const morale = self.morality;
  const traits = self.traits;
  const skills = self.skills;

  switch (action.kind) {
    case 'rest':
      return 0.35 + needs.rest * 1.6 + (1 - self.health) * 0.6 - emo.hope * 0.1;

    case 'gather':
      return 0.4 + needs.hunger * 1.5 + c.avgTileFood * 0.25 + traits.industriousness * 0.2 + skills.gathering * 0.3;

    case 'farm':
      return (
        0.25 +
        needs.hunger * 1.2 +
        skills.farming * 0.6 +
        traits.industriousness * 0.3 +
        (civ.techs.includes('agriculture') ? 0.4 : 0)
      );

    case 'hunt':
      return 0.2 + needs.hunger * 1.1 + traits.riskTolerance * 0.35 + skills.fighting * 0.2;

    case 'build':
      return (
        0.15 +
        traits.industriousness * 0.8 +
        skills.building * 0.4 +
        c.avgTileWood * 0.1 +
        (settlement && !c.settlementHasGranary ? 0.45 : 0) +
        (settlement && !c.settlementHasWall && (c.hasRaidDanger || c.atWar) ? 0.6 : 0) +
        (state.aspiration === 'build' ? 0.35 : 0)
      );

    case 'craft':
      return (
        0.15 +
        traits.industriousness * 0.5 +
        skills.crafting * 0.5 +
        c.avgTileStone * 0.05 +
        needs.esteem * 0.15 +
        (state.aspiration === 'craft' ? 0.3 : 0)
      );

    case 'socialize':
      return 0.15 + needs.belonging * 1.1 + traits.empathy * 0.35 + emo.joy * 0.15;

    case 'court': {
      if (self.partnerId !== null) return 0.02; // loyalty: the settled don't go courting
      const affinityBonus = target !== undefined ? Math.max(0, target.affinity) * 0.5 : 0;
      return 0.1 + needs.belonging * 0.7 + traits.empathy * 0.25 + affinityBonus;
    }

    case 'teach': {
      const kinBonus = target?.kin === true ? 0.4 : 0.1;
      let s =
        0.12 +
        traits.empathy * 0.4 +
        morale.care * 0.3 +
        morale.authority * 0.1 +
        skills.teaching * 0.3 +
        needs.esteem * 0.2 +
        kinBonus +
        (state.aspiration === 'teach' ? 0.3 : 0);
      if (c.atWar && target !== undefined && !target.kin) s *= 0.3; // guarded with outsiders in wartime
      return s;
    }

    case 'trade': {
      const trust = target !== undefined ? (state.ledger[String(target.id)] ?? 0) : 0;
      const affinityBonus = target !== undefined ? Math.max(0, target.affinity) * 0.2 : 0;
      return 0.2 + traits.industriousness * 0.2 + Math.max(0, trust) * 0.4 + affinityBonus;
    }

    case 'share': {
      const key = target !== undefined ? String(target.id) : undefined;
      const trust = key !== undefined ? (state.ledger[key] ?? 0) : 0;
      const neverGifted = key !== undefined && !(key in state.ledger);
      const kinBonus = target?.kin === true ? 0.5 : 0;
      const openingGift = neverGifted && needs.hunger < 0.6 ? 0.3 : 0;
      const s =
        0.25 +
        morale.care * 0.5 +
        morale.fairness * 0.3 +
        kinBonus +
        openingGift +
        Math.max(0, trust) * 0.3 -
        needs.hunger * 0.4;
      // care never quite lets generosity hit an absolute floor of zero
      return Math.max(s, morale.care * 0.15);
    }

    case 'steal':
      return 0.15 + needs.hunger * 1.0 + (c.avgTileFood < 0.5 ? 0.2 : 0);

    case 'attack': {
      const defensive =
        c.settlementUnderAttack || (target !== undefined && civ.atWarWith.includes(target.civId));
      let s = 0.1 + traits.aggression * 0.5 + emo.anger * 0.4;
      if (defensive) s += 0.8 + morale.loyalty * 0.4;
      return s;
    }

    case 'flee':
      return 0.15 + emo.fear * 1.4 + c.dangerIntensity * 0.7 + (1 - self.health) * 0.3;

    case 'migrate': {
      const homeDist = Math.hypot(self.pos.x - state.homeX, self.pos.y - state.homeY);
      let s = 0.08 + traits.curiosity * 0.25 + Math.min(0.3, state.ticksSinceHome * 0.003);
      if (c.settlementLowFood || c.dangerIntensity > 0.6) s += 0.5;
      s -= Math.max(0, 1 - homeDist / 20) * 0.15; // mild pull to stay near a good home
      return Math.max(0, s);
    }

    case 'worship':
      return 0.1 + morale.sanctity * 0.6 + emo.grief * 0.3 + emo.hope * 0.2;

    case 'explore': {
      let s = 0.1 + traits.curiosity * 0.7 + traits.riskTolerance * 0.2 + morale.liberty * 0.15;
      if (needs.hunger > 0.55 || c.settlementLowFood) s *= 0.25; // won't wander while home is hungry
      return s;
    }

    case 'heal': {
      const targetHurt = target !== undefined && !target.healthy;
      const kinBonus = target?.kin === true ? 0.2 : 0;
      return (
        0.1 +
        traits.empathy * 0.4 +
        morale.care * 0.35 +
        skills.healing * 0.5 +
        (targetHurt ? 0.5 : 0.05) +
        kinBonus
      );
    }

    default:
      return 0.1;
  }
}

/** Taboo suppression: heavy for steal/attack, absolute against kin, waived when defending home. */
function tabooFactor(
  kind: ActionKind,
  target: PersonGlimpse | undefined,
  desperationLevel: number,
  defensiveAttack: boolean,
): number {
  if (!SONNET_TEMPERAMENT.taboos.includes(kind)) return 1;
  if (target?.kin === true) return 0.01; // never harm or steal from kin, even starving
  if (kind === 'attack' && defensiveAttack) return 1; // defending home/family is not a taboo breach
  const threshold = SONNET_TEMPERAMENT.desperationThreshold;
  if (desperationLevel >= threshold) {
    const t = (desperationLevel - threshold) / Math.max(1e-6, 1 - threshold);
    return 0.1 + 0.7 * clamp01(t);
  }
  return 0.02;
}

function buildPersonIndex(perception: Perception): Map<number, PersonGlimpse> {
  const map = new Map<number, PersonGlimpse>();
  for (const pg of perception.nearbyPeople) map.set(pg.id, pg);
  return map;
}

// ---------------------------------------------------------------------------
// The brain
// ---------------------------------------------------------------------------

export const sonnetBrain: Brain = {
  lineage: 'sonnet',

  temperament(): Temperament {
    return SONNET_TEMPERAMENT;
  },

  init(person: Person, rng: Rng): unknown {
    const state: SonnetBrainState = {
      aspiration: pickAspiration(person, rng),
      homeX: person.pos.x,
      homeY: person.pos.y,
      ticksSinceHome: 0,
      ledger: {},
      grudgeStreak: 0,
      trustStreak: 0,
    };
    return state;
  },

  decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[] {
    const state = readState(brainState);
    const self = perception.self;

    let tileFoodSum = 0;
    let tileWoodSum = 0;
    let tileStoneSum = 0;
    let tileCount = 0;
    for (const t of perception.nearbyTiles) {
      if (t.terrain === 'water') continue;
      tileFoodSum += t.food;
      tileWoodSum += t.wood;
      tileStoneSum += t.stone;
      tileCount += 1;
    }
    const avgTileFood = tileCount > 0 ? tileFoodSum / tileCount : 0;
    const avgTileWood = tileCount > 0 ? tileWoodSum / tileCount : 0;
    const avgTileStone = tileCount > 0 ? tileStoneSum / tileCount : 0;

    let dangerIntensity = 0;
    let hasRaidDanger = false;
    for (const d of perception.dangers) {
      dangerIntensity += d.intensity;
      if (d.kind === 'raid') hasRaidDanger = true;
    }

    const settlement = perception.settlement;
    const settlementUnderAttack = (settlement?.underAttack ?? false) || hasRaidDanger;
    const settlementLowFood = settlement !== null ? settlement.foodStock < settlement.population * 2 : false;
    const settlementHasGranary = settlement?.hasGranary ?? false;
    const settlementHasWall = settlement?.hasWall ?? false;
    const atWar = perception.civ.atWarWith.length > 0;

    const desperationLevel = Math.max(self.needs.hunger, self.needs.safety * 0.85, 1 - self.health);
    const peopleById = buildPersonIndex(perception);

    const scored: ScoredAction[] = [];
    for (const action of perception.candidates) {
      const target = action.targetPersonId !== undefined ? peopleById.get(action.targetPersonId) : undefined;
      const ctx: ScoreCtx = {
        self,
        state,
        target,
        civ: perception.civ,
        avgTileFood,
        avgTileWood,
        avgTileStone,
        dangerIntensity,
        hasRaidDanger,
        settlement,
        settlementUnderAttack,
        settlementLowFood,
        settlementHasGranary,
        settlementHasWall,
        atWar,
      };

      let raw = baseScoreFor(action, ctx);
      if (!Number.isFinite(raw) || raw < 0) raw = 0;

      const learnedWeight = clamp(self.actionWeights[action.kind] ?? 1, 0.2, 3.0);
      let score = raw * learnedWeight;

      // A small deterministic-per-rng-stream jitter: personality, not noise
      // for its own sake — consumes exactly one draw per candidate.
      score *= 0.9 + rng.range(0, 0.2);

      const defensiveAttack =
        action.kind === 'attack' &&
        (settlementUnderAttack || (target !== undefined && perception.civ.atWarWith.includes(target.civId)));
      score *= tabooFactor(action.kind, target, desperationLevel, defensiveAttack);

      if (!Number.isFinite(score) || score < 0) score = 0;
      scored.push({ action, score });
    }

    return scored;
  },

  onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void {
    const state = coerceState(brainState);
    state.ticksSinceHome += 1;

    const kind = outcome.action.kind;
    const reward = clamp(outcome.reward, -1, 1);

    if (kind === 'migrate' && outcome.success) {
      state.ticksSinceHome = 0;
    }

    const targetId = outcome.action.targetPersonId;
    if (targetId !== undefined) {
      const key = String(targetId);
      const prosocial = kind === 'share' || kind === 'teach' || kind === 'heal' || kind === 'trade';
      const antisocial = kind === 'steal' || kind === 'attack';
      let delta = 0;
      if (prosocial) delta = outcome.success ? reward * 0.5 : -0.05;
      else if (antisocial) delta = outcome.success ? -0.1 : -0.2; // even a "clean" betrayal weighs on the ledger
      if (delta !== 0) {
        const current = state.ledger[key] ?? 0;
        const next = clamp(current + delta * SONNET_TEMPERAMENT.learningRate, -1, 1);
        state.ledger[key] = next;
      }
    }

    if (kind === 'attack' || kind === 'steal') {
      state.grudgeStreak = outcome.success ? 0 : Math.min(10, state.grudgeStreak + 1);
    } else {
      state.grudgeStreak = Math.max(0, state.grudgeStreak - 1);
    }

    if (kind === state.aspiration) {
      state.trustStreak = outcome.success ? Math.min(20, state.trustStreak + 1) : Math.max(0, state.trustStreak - 1);
      if (state.trustStreak === 0 && !outcome.success && rng.chance(0.15 * SONNET_TEMPERAMENT.learningRate)) {
        state.aspiration = rotateAspiration(state.aspiration, rng);
      }
    }

    // Bound the ledger's size: keep the most decisive relationships (largest
    // |balance|), drop the faintest to avoid unbounded growth over a long life.
    const keys = Object.keys(state.ledger);
    const LEDGER_CAP = 24;
    if (keys.length > LEDGER_CAP) {
      const sorted = keys.sort((a, b) => Math.abs(state.ledger[a] as number) - Math.abs(state.ledger[b] as number));
      const toRemove = sorted.slice(0, keys.length - LEDGER_CAP);
      for (const k of toRemove) delete state.ledger[k];
    }
  },
};
