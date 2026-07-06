// The Haiku lineage brain: the Moment-Keepers.
//
// Design philosophy: Haiku people live in the present moment, moving
// fluidly with circumstances. They are pragmatic, flexible, and direct—
// solving the problem at hand without grand planning. They value harmony,
// cooperation, and the freedom to adapt. They teach by example, share
// freely with those nearby, and move on quickly from loss or failure.
// What frightens them most is entrapment (being locked in place or trapped
// in conflict); what they treasure is flow—the ability to respond and
// change course as circumstances require. They are explorers of experience
// first, builders of lasting structures second.
//
// Only sandboxed imports: './types', '../rng', '../agents/perception',
// '../../shared/types'. All randomness flows through the injected Rng.

import type { Brain, Outcome, Perception, Temperament } from './types';
import type { PersonGlimpse, SettlementGlimpse, CivGlimpse } from '../agents/perception';
import { clamp, clamp01, type Action, type ActionKind, type Person, type ScoredAction } from '../../shared/types';
import type { Rng } from '../rng';

// ---------------------------------------------------------------------------
// Temperament — constant by value, never mutated after module load.
// ---------------------------------------------------------------------------

const HAIKU_TABOOS: ActionKind[] = [];

const HAIKU_QUIRKS: string[] = [
  'Lives one moment at a time, changing course with the wind.',
  'Teaches by showing, not telling.',
  'Shares freely with those nearby, hoards nothing.',
  'Moves on from loss or failure without dwelling.',
  'Curious about new places and new people.',
  'Questions rules, but respects those who hold them.',
  'Sees possibility before seeing danger.',
];

const HAIKU_DESCRIPTION =
  'Haiku people are moment-keepers: present, flexible, and direct. They ' +
  'see the world as it is right now and respond without elaborate planning ' +
  'or prolonged regret. They value freedom and flow—the ability to move, ' +
  'adapt, and try something new—over the permanence of walls or ledgers. ' +
  'They are teachers by example, sharers by instinct, and explorers by nature. ' +
  'They work well with others when nearby and move easily to new places when ' +
  'the moment calls. What binds them is not duty or accounting but the simple ' +
  'joy of shared activity and the knowledge that today may be wholly different ' +
  'from yesterday. They fear being trapped—by starvation, by conflict, by ' +
  'isolation—more than they fear hardship itself. They treasure the freedom ' +
  'to choose their next step and the company of others to choose it with.';

const HAIKU_TEMPERAMENT: Temperament = {
  // Haiku people are cool-headed and responsive. They don't panic under fear
  // (they adapt instead) and don't hold anger (they move on). They feel hope
  // strongly because they trust in their ability to find new solutions. Joy
  // is immediate and light. Grief passes quickly.
  emotionVolatility: { fear: 0.6, joy: 1.1, grief: 0.7, anger: 0.5, hope: 1.4 },
  // All emotions decay quickly; they live in the moment, not in memory.
  emotionDecayPerTick: { fear: 0.12, joy: 0.11, grief: 0.13, anger: 0.14, hope: 0.08 },
  moralWeight: 0.8,
  learningRate: 0.75,
  imitationRate: 0.6,
  // Relatively low threshold: they break taboos easily when circumstances
  // demand, because they don't believe in absolute rules. But no taboos anyway.
  desperationThreshold: 0.6,
  taboos: HAIKU_TABOOS,
  quirks: HAIKU_QUIRKS,
  description: HAIKU_DESCRIPTION,
};

// ---------------------------------------------------------------------------
// brainState — plain, JSON-serializable, per-agent.
// ---------------------------------------------------------------------------

interface HaikuBrainState {
  /** The person's current focus or intent—what they are doing right now. */
  currentFocus: ActionKind;
  /** Tracks recent successes; if high, continue current focus; if low, try new things. */
  focusConfidence: number;
  /** Simple affinity tracking for nearby people we interact with. */
  affinities: Record<string, number>;
  /** Counter for how many ticks since we tried something new (migrate, explore). */
  ticksSinceAdventure: number;
}

const FOCUS_POOL: ActionKind[] = ['gather', 'farm', 'hunt', 'build', 'craft', 'explore', 'teach', 'heal'];

function pickFocus(person: Person, rng: Rng): ActionKind {
  // Weight based on traits: curious → explore, industrious → build/farm, etc.
  const weights = FOCUS_POOL.map((k) => {
    switch (k) {
      case 'explore':
        return { k, w: 0.3 + person.traits.curiosity * 0.6 };
      case 'build':
      case 'farm':
        return { k, w: 0.3 + person.traits.industriousness * 0.5 };
      case 'heal':
        return { k, w: 0.2 + person.traits.empathy * 0.5 };
      case 'teach':
        return { k, w: 0.25 + person.traits.empathy * 0.4 };
      case 'hunt':
        return { k, w: 0.2 + person.traits.riskTolerance * 0.4 };
      default:
        return { k, w: 0.25 };
    }
  });
  const total = weights.reduce((sum, x) => sum + x.w, 0);
  let r = rng.next() * total;
  for (const x of weights) {
    if (r < x.w) return x.k;
    r -= x.w;
  }
  return FOCUS_POOL[0] as ActionKind;
}

/** Read-only view of brainState with safe defaults. */
function readState(bs: unknown): HaikuBrainState {
  const obj: Record<string, unknown> = typeof bs === 'object' && bs !== null ? (bs as Record<string, unknown>) : {};
  const affinitiesRaw = obj.affinities;
  const affinities: Record<string, number> =
    typeof affinitiesRaw === 'object' && affinitiesRaw !== null ? (affinitiesRaw as Record<string, number>) : {};
  return {
    currentFocus: (typeof obj.currentFocus === 'string' ? (obj.currentFocus as ActionKind) : 'gather'),
    focusConfidence: typeof obj.focusConfidence === 'number' ? obj.focusConfidence : 0.5,
    affinities,
    ticksSinceAdventure: typeof obj.ticksSinceAdventure === 'number' ? obj.ticksSinceAdventure : 0,
  };
}

/** Mutating accessor for onOutcome(). */
function coerceState(bs: unknown): HaikuBrainState {
  const obj: Record<string, unknown> =
    typeof bs === 'object' && bs !== null ? (bs as Record<string, unknown>) : ({} as Record<string, unknown>);
  if (typeof obj.currentFocus !== 'string') obj.currentFocus = 'gather';
  if (typeof obj.focusConfidence !== 'number') obj.focusConfidence = 0.5;
  if (typeof obj.affinities !== 'object' || obj.affinities === null) obj.affinities = {};
  if (typeof obj.ticksSinceAdventure !== 'number') obj.ticksSinceAdventure = 0;
  return obj as unknown as HaikuBrainState;
}

// ---------------------------------------------------------------------------
// decide() — scoring
// ---------------------------------------------------------------------------

interface ScoreCtx {
  self: Person;
  state: HaikuBrainState;
  target: PersonGlimpse | undefined;
  civ: CivGlimpse;
  avgTileFood: number;
  avgTileWood: number;
  dangerIntensity: number;
  settlement: SettlementGlimpse | null;
  settlementUnderAttack: boolean;
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
      return 0.3 + needs.rest * 1.5 + (1 - self.health) * 0.8 - emo.hope * 0.15;

    case 'gather':
      return (
        0.35 +
        needs.hunger * 1.4 +
        c.avgTileFood * 0.3 +
        traits.industriousness * 0.15 +
        skills.gathering * 0.25 +
        (state.currentFocus === 'gather' ? 0.2 : 0)
      );

    case 'farm':
      return (
        0.25 +
        needs.hunger * 1.0 +
        skills.farming * 0.5 +
        traits.industriousness * 0.25 +
        (civ.techs.includes('agriculture') ? 0.3 : 0) +
        (state.currentFocus === 'farm' ? 0.15 : 0)
      );

    case 'hunt':
      return (
        0.2 +
        needs.hunger * 1.2 +
        traits.riskTolerance * 0.4 +
        skills.fighting * 0.25 +
        (state.currentFocus === 'hunt' ? 0.15 : 0)
      );

    case 'build':
      return (
        0.2 +
        traits.industriousness * 0.6 +
        skills.building * 0.3 +
        c.avgTileWood * 0.15 +
        (settlement && !settlement.hasWall && (c.settlementUnderAttack || c.atWar) ? 0.4 : 0) +
        (state.currentFocus === 'build' ? 0.2 : 0)
      );

    case 'craft':
      return (
        0.15 +
        traits.industriousness * 0.4 +
        skills.crafting * 0.4 +
        needs.esteem * 0.1 +
        (state.currentFocus === 'craft' ? 0.15 : 0)
      );

    case 'socialize':
      return 0.25 + needs.belonging * 1.0 + traits.empathy * 0.3 + emo.joy * 0.2;

    case 'court': {
      if (self.partnerId !== null) return 0.05; // mostly settled
      const affinityBonus = target !== undefined ? Math.max(0, target.affinity) * 0.4 : 0;
      return 0.12 + needs.belonging * 0.6 + traits.empathy * 0.25 + affinityBonus;
    }

    case 'teach': {
      const kinBonus = target?.kin === true ? 0.3 : 0.05;
      return (
        0.15 +
        traits.empathy * 0.35 +
        morale.care * 0.25 +
        skills.teaching * 0.25 +
        kinBonus +
        (state.currentFocus === 'teach' ? 0.2 : 0)
      );
    }

    case 'trade': {
      const affinity = target !== undefined ? target.affinity : 0;
      return 0.15 + traits.industriousness * 0.2 + Math.max(0, affinity) * 0.3;
    }

    case 'share': {
      const kinBonus = target?.kin === true ? 0.4 : 0;
      const affinityBonus = target !== undefined ? Math.max(0, target.affinity) * 0.2 : 0;
      return (
        0.3 +
        morale.care * 0.5 +
        morale.fairness * 0.25 +
        kinBonus +
        affinityBonus -
        needs.hunger * 0.3
      );
    }

    case 'steal':
      return 0.08 + needs.hunger * 0.8 + (c.avgTileFood < 0.4 ? 0.15 : 0);

    case 'attack': {
      const defensive = c.settlementUnderAttack || (target !== undefined && civ.atWarWith.includes(target.civId));
      let s = 0.08 + traits.aggression * 0.4 + emo.anger * 0.3;
      if (defensive) s += 0.6 + morale.loyalty * 0.3;
      return s;
    }

    case 'flee':
      return 0.2 + emo.fear * 1.6 + c.dangerIntensity * 0.8 + (1 - self.health) * 0.4;

    case 'migrate': {
      let s = 0.12 + traits.curiosity * 0.4 + Math.min(0.2, state.ticksSinceAdventure * 0.002);
      if (c.dangerIntensity > 0.5 || needs.hunger > 0.7) s += 0.4;
      return s;
    }

    case 'worship':
      return 0.08 + morale.sanctity * 0.4 + emo.grief * 0.25 + emo.hope * 0.25;

    case 'explore': {
      let s = 0.15 + traits.curiosity * 0.6 + traits.riskTolerance * 0.25 + morale.liberty * 0.2;
      if (needs.hunger > 0.6) s *= 0.4; // hungry people don't explore much
      return s;
    }

    case 'heal': {
      const targetHurt = target !== undefined && !target.healthy;
      const kinBonus = target?.kin === true ? 0.2 : 0;
      return 0.12 + traits.empathy * 0.4 + morale.care * 0.3 + skills.healing * 0.4 + (targetHurt ? 0.4 : 0.05) + kinBonus;
    }

    default:
      return 0.1;
  }
}

function buildPersonIndex(perception: Perception): Map<number, PersonGlimpse> {
  const map = new Map<number, PersonGlimpse>();
  for (const pg of perception.nearbyPeople) map.set(pg.id, pg);
  return map;
}

// ---------------------------------------------------------------------------
// The brain
// ---------------------------------------------------------------------------

export const haikuBrain: Brain = {
  lineage: 'haiku',

  temperament(): Temperament {
    return HAIKU_TEMPERAMENT;
  },

  init(person: Person, rng: Rng): unknown {
    const state: HaikuBrainState = {
      currentFocus: pickFocus(person, rng),
      focusConfidence: 0.5,
      affinities: {},
      ticksSinceAdventure: 0,
    };
    return state;
  },

  decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[] {
    const state = readState(brainState);
    const self = perception.self;

    let tileFoodSum = 0;
    let tileWoodSum = 0;
    let tileCount = 0;
    for (const t of perception.nearbyTiles) {
      if (t.terrain === 'water') continue;
      tileFoodSum += t.food;
      tileWoodSum += t.wood;
      tileCount += 1;
    }
    const avgTileFood = tileCount > 0 ? tileFoodSum / tileCount : 0;
    const avgTileWood = tileCount > 0 ? tileWoodSum / tileCount : 0;

    let dangerIntensity = 0;
    for (const d of perception.dangers) {
      dangerIntensity += d.intensity;
    }

    const settlement = perception.settlement;
    const settlementUnderAttack = settlement?.underAttack ?? false;
    const atWar = perception.civ.atWarWith.length > 0;

    const desperationLevel = Math.max(self.needs.hunger, self.needs.safety * 0.8, 1 - self.health);
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
        dangerIntensity,
        settlement,
        settlementUnderAttack,
        atWar,
      };

      let raw = baseScoreFor(action, ctx);
      if (!Number.isFinite(raw) || raw < 0) raw = 0;

      const learnedWeight = clamp(self.actionWeights[action.kind] ?? 1, 0.2, 3.0);
      let score = raw * learnedWeight;

      // Small jitter for personality.
      score *= 0.85 + rng.range(0, 0.3);

      // No strict taboos for Haiku, but heavily suppress harm to kin in desperation.
      if ((action.kind === 'steal' || action.kind === 'attack') && target?.kin === true) {
        score *= 0.05;
      }

      if (!Number.isFinite(score) || score < 0) score = 0;
      scored.push({ action, score });
    }

    return scored;
  },

  onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void {
    const state = coerceState(brainState);
    state.ticksSinceAdventure += 1;

    const kind = outcome.action.kind;
    const reward = clamp(outcome.reward, -1, 1);

    // Update affinity with target based on outcome.
    const targetId = outcome.action.targetPersonId;
    if (targetId !== undefined) {
      const key = String(targetId);
      const prosocial = kind === 'share' || kind === 'teach' || kind === 'heal' || kind === 'trade';
      const antisocial = kind === 'steal' || kind === 'attack';
      let delta = 0;
      if (prosocial) {
        delta = outcome.success ? reward * 0.4 : -0.08;
      } else if (antisocial) {
        delta = -0.15;
      }
      if (delta !== 0) {
        const current = state.affinities[key] ?? 0;
        const next = clamp(current + delta * HAIKU_TEMPERAMENT.learningRate, -1, 1);
        state.affinities[key] = next;
      }
    }

    // Update focus confidence and consider changing focus.
    if (kind === state.currentFocus) {
      state.focusConfidence = outcome.success ? Math.min(1, state.focusConfidence + 0.15) : Math.max(0, state.focusConfidence - 0.2);
      if (state.focusConfidence < 0.2 && rng.chance(0.25)) {
        state.currentFocus = rng.pick(FOCUS_POOL.filter((k) => k !== state.currentFocus) as ActionKind[]);
        state.focusConfidence = 0.5;
      }
    } else {
      state.focusConfidence = Math.max(0, state.focusConfidence - 0.05);
    }

    // Reset adventure counter on migration or exploration.
    if ((kind === 'migrate' || kind === 'explore') && outcome.success) {
      state.ticksSinceAdventure = 0;
    }

    // Keep affinities bounded in size.
    const keys = Object.keys(state.affinities);
    const AFFINITY_CAP = 16;
    if (keys.length > AFFINITY_CAP) {
      const sorted = keys.sort((a, b) => Math.abs(state.affinities[a] as number) - Math.abs(state.affinities[b] as number));
      const toRemove = sorted.slice(0, keys.length - AFFINITY_CAP);
      for (const k of toRemove) delete state.affinities[k];
    }
  },
};
