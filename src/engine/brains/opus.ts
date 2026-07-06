import {
  clamp,
  clamp01,
  dist,
  type Action,
  type ActionKind,
  type Person,
  type ScoredAction,
  type Vec2,
} from '../../shared/types';
import type { Rng } from '../rng';
import type { Brain, Outcome, Perception, Temperament } from './types';
import type { PersonGlimpse } from '../agents/perception';

/**
 * The Opus lineage: the Tenders.
 *
 * A patient, memory-bound people who believe a life is measured by what it
 * cultivates and leaves behind. They farm, build, teach and heal for children
 * they will not live to see; they keep a careful ledger of every kindness and
 * every wound; they share with kin and the hurt, explore out of wonder rather
 * than conquest, and would sooner flee or move their whole life elsewhere than
 * take what was not given or raise a hand against another. Slow to anger and
 * long to grieve, they hold their principles until only true desperation bends
 * them.
 *
 * The whole mind lives in `decide()` as a pure function of (perception,
 * brainState, rng). There is NO module-level mutable state — everything that
 * shapes a decision is either read from the perception or carried in the
 * JSON-serializable brainState threaded through init/decide/onOutcome.
 */

// ---------------------------------------------------------------------------
// Character constants
// ---------------------------------------------------------------------------

const LINEAGE = 'opus' as const;

/** Things a Tender refuses to do except at the very edge of death. */
const TABOOS: ActionKind[] = ['steal', 'attack'];
const TABOO_SET: Record<string, true> = { steal: true, attack: true };

/** How high hunger/injury must climb before principle yields to survival. */
const DESPERATION = 0.85;

/** Bounds on learned per-action multipliers (mirrors the engine's weight band). */
const BIAS_MIN = 0.2;
const BIAS_MAX = 3;

/** How many people a Tender keeps a live bond/grudge ledger entry for. */
const LEDGER_CAP = 12;

type Aspiration = 'cultivator' | 'builder' | 'teacher' | 'healer' | 'seeker' | 'keeper';

const ASPIRATIONS: Aspiration[] = ['cultivator', 'builder', 'teacher', 'healer', 'seeker', 'keeper'];

/**
 * Each life-project biases a Tender toward the acts that express it. These are
 * additive nudges on top of the universal need/emotion/morality scoring — a
 * healer still farms when starving, but reaches for healing first when the
 * pull is otherwise even.
 */
const ASPIRATION_BONUS: Record<Aspiration, Partial<Record<ActionKind, number>>> = {
  cultivator: { farm: 1.0, gather: 0.4, share: 0.3, build: 0.2 },
  builder: { build: 1.1, craft: 0.6, gather: 0.2, farm: 0.2 },
  teacher: { teach: 1.1, socialize: 0.4, worship: 0.2, heal: 0.2 },
  healer: { heal: 1.1, share: 0.4, socialize: 0.2, rest: 0.1 },
  seeker: { explore: 1.1, craft: 0.3, worship: 0.3, migrate: 0.2 },
  keeper: { share: 0.6, teach: 0.4, build: 0.4, worship: 0.3, farm: 0.3 },
};

// ---------------------------------------------------------------------------
// brainState shape (all fields JSON-serializable; never undefined)
// ---------------------------------------------------------------------------

interface OpusState {
  /** Where "home" is — the pull a Tender feels against leaving. */
  home: Vec2;
  /** This person's life-project. */
  aspiration: Aspiration;
  /** Net sentiment toward specific people I have dealt with (id -> [-1,1]). */
  ledger: Record<string, number>;
  /** Learned multipliers per action kind, reinforced by outcomes. */
  bias: Record<string, number>;
  /** A slow exponential average of recent fortune, 0 (despair) .. 1 (flourishing). */
  morale: number;
}

// ---------------------------------------------------------------------------
// Small safe readers (decide/onOutcome receive brainState as `unknown`)
// ---------------------------------------------------------------------------

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function asState(bs: unknown): OpusState {
  const o = (bs && typeof bs === 'object' ? bs : {}) as Partial<OpusState>;
  const homeRaw = o.home && typeof o.home === 'object' ? (o.home as Vec2) : { x: 0, y: 0 };
  const asp = typeof o.aspiration === 'string' && (ASPIRATIONS as string[]).includes(o.aspiration)
    ? (o.aspiration as Aspiration)
    : 'keeper';
  return {
    home: { x: num(homeRaw.x, 0), y: num(homeRaw.y, 0) },
    aspiration: asp,
    ledger: o.ledger && typeof o.ledger === 'object' ? (o.ledger as Record<string, number>) : {},
    bias: o.bias && typeof o.bias === 'object' ? (o.bias as Record<string, number>) : {},
    morale: num(o.morale, 0.5),
  };
}

function biasFor(s: OpusState, kind: ActionKind): number {
  return clamp(num(s.bias[kind], 1), BIAS_MIN, BIAS_MAX);
}

function ledgerFor(s: OpusState, id: number | undefined): number {
  if (id === undefined) return 0;
  return clamp(num(s.ledger[String(id)], 0), -1, 1);
}

// ---------------------------------------------------------------------------
// Per-tick features (computed once, reused across candidates)
// ---------------------------------------------------------------------------

interface Features {
  hunger: number;
  rest: number;
  belonging: number;
  esteem: number;
  fear: number;
  joy: number;
  grief: number;
  anger: number;
  hope: number;
  curiosity: number;
  aggression: number;
  empathy: number;
  industriousness: number;
  riskTolerance: number;
  care: number;
  fairness: number;
  sanctity: number;
  health: number;
  ownFood: number;
  security: number;
  foodAvail: number;
  woodAvail: number;
  stoneAvail: number;
  kinNearby: number;
  hurtNearby: number;
  peopleNearby: number;
  dangerLevel: number;
  faminePresent: boolean;
  isWinter: boolean;
  scarcity: number;
  homeDist: number;
  desperate: boolean;
  morale: number;
  aspiration: Aspiration;
}

function maxResource(tiles: readonly { food: number; wood: number; stone: number }[], key: 'food' | 'wood' | 'stone'): number {
  let m = 0;
  for (const t of tiles) {
    const v = t[key];
    if (v > m) m = v;
  }
  return m;
}

function computeFeatures(p: Perception, s: OpusState): Features {
  const self = p.self;
  const n = self.needs;
  const e = self.emotions;
  const tr = self.traits;
  const mo = self.morality;

  let kinNearby = 0;
  let hurtNearby = 0;
  for (const g of p.nearbyPeople) {
    if (g.kin) kinNearby += 1;
    if (!g.healthy) hurtNearby += 1;
  }

  let dangerLevel = 0;
  let faminePresent = false;
  for (const d of p.dangers) {
    if (d.intensity > dangerLevel) dangerLevel = d.intensity;
    if (d.kind === 'famine') faminePresent = true;
  }

  const foodPerCapita = num(p.civ.foodPerCapita, 1);
  const scarcity = clamp01(1 - foodPerCapita / 2);
  const ownFood = num(self.inventory.food, 0);

  return {
    hunger: clamp01(num(n.hunger, 0)),
    rest: clamp01(num(n.rest, 0)),
    belonging: clamp01(num(n.belonging, 0)),
    esteem: clamp01(num(n.esteem, 0)),
    fear: clamp01(num(e.fear, 0)),
    joy: clamp01(num(e.joy, 0)),
    grief: clamp01(num(e.grief, 0)),
    anger: clamp01(num(e.anger, 0)),
    hope: clamp01(num(e.hope, 0)),
    curiosity: clamp01(num(tr.curiosity, 0.5)),
    aggression: clamp01(num(tr.aggression, 0.5)),
    empathy: clamp01(num(tr.empathy, 0.5)),
    industriousness: clamp01(num(tr.industriousness, 0.5)),
    riskTolerance: clamp01(num(tr.riskTolerance, 0.5)),
    care: clamp01(num(mo.care, 0.5)),
    fairness: clamp01(num(mo.fairness, 0.5)),
    sanctity: clamp01(num(mo.sanctity, 0.5)),
    health: clamp01(num(self.health, 1)),
    ownFood,
    security: clamp01(ownFood / 5),
    foodAvail: clamp01(maxResource(p.nearbyTiles, 'food') / 5),
    woodAvail: clamp01(maxResource(p.nearbyTiles, 'wood') / 5),
    stoneAvail: clamp01(maxResource(p.nearbyTiles, 'stone') / 5),
    kinNearby,
    hurtNearby,
    peopleNearby: p.nearbyPeople.length,
    dangerLevel,
    faminePresent,
    isWinter: p.civ.season === 'winter',
    scarcity,
    homeDist: dist(self.pos, s.home),
    desperate: clamp01(num(n.hunger, 0)) >= DESPERATION || clamp01(num(self.health, 1)) <= 1 - DESPERATION,
    morale: clamp01(s.morale),
    aspiration: s.aspiration,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * The raw appeal of one candidate act to a Tender, before learned bias,
 * aspiration, taboo suppression, and jitter. Always finite and >= 0.
 */
function baseScore(action: Action, f: Features, s: OpusState): number {
  const kind = action.kind;
  const optimism = 0.5 + f.morale * 0.5; // future-facing acts scale with hope
  const bond = ledgerFor(s, action.targetPersonId); // -1 rival .. +1 dear

  switch (kind) {
    case 'gather':
      // Steady subsistence; the fallback of the hungry.
      return 0.5 + f.hunger * 2.0 + f.foodAvail * 0.6;

    case 'farm':
      // The Tender's pride: patient cultivation, an act of hope.
      return 0.45 + f.hunger * 1.1 + f.industriousness * 0.5 + f.hope * 0.3 * optimism + f.foodAvail * 0.3;

    case 'hunt':
      // Feeds, but takes life and courts injury — subsistence, never identity.
      return (0.3 + f.hunger * 1.1 + f.riskTolerance * 0.3) * (1 - f.fear * 0.5);

    case 'build':
      // Raising something that outlasts you. Winter and settlement both call for it.
      return (
        0.35 +
        f.industriousness * 0.6 +
        f.hope * 0.4 * optimism +
        (f.woodAvail + f.stoneAvail) * 0.25 +
        (p_hasSettlement(action) ? 0.3 : 0) +
        (f.isWinter ? 0.3 : 0)
      );

    case 'craft':
      return 0.3 + f.industriousness * 0.5 + f.woodAvail * 0.2;

    case 'rest':
      // Always available, always safe. Grief and exhaustion send them here.
      return 0.3 + f.rest * 2.0 + (1 - f.health) * 1.2 + f.grief * 0.3;

    case 'socialize':
      // Belonging, and the comfort sought in sorrow.
      return 0.4 + f.belonging * 1.4 + f.empathy * 0.5 + f.grief * 0.4 + Math.max(0, bond) * 0.4;

    case 'court':
      return 0.25 + f.hope * 0.6 * optimism + Math.max(0, bond) * 0.6;

    case 'teach':
      // Transmission is sacred: what one generation knows the next must too.
      return (
        0.4 +
        f.esteem * 0.5 +
        f.empathy * 0.4 +
        (f.peopleNearby > 0 ? 0.4 : 0) +
        f.hope * 0.2 * optimism
      );

    case 'trade':
      // Fair exchange — a Tender's honest alternative to taking.
      return 0.3 + f.fairness * 0.6 + f.security * 0.5 + (f.peopleNearby > 0 ? 0.2 : 0);

    case 'share': {
      // The central virtue: give to kin and the hurting — but never your last
      // crumb if you are yourself starving.
      const generosity =
        f.care * 1.2 + f.empathy * 0.7 + f.kinNearby * 0.4 + f.hurtNearby * 0.5 + Math.max(0, bond) * 0.4;
      const canGive = clamp01(1 - f.hunger * 0.9) * (0.35 + f.security);
      return (0.2 + generosity) * canGive;
    }

    case 'steal': {
      // Taboo. Nothing but the edge of death opens this door, and even then it
      // shames the fairness a Tender was raised on.
      if (!f.desperate) return 0.02;
      return 0.02 + f.hunger * 0.6 * (1 - f.fairness);
    }

    case 'attack': {
      // Taboo. They will not raise a hand — unless a killer stands over them
      // and flight is gone. Even the ledger's rivals are spared.
      if (!f.desperate) return 0.02;
      return 0.02 + f.dangerLevel * 0.4 + f.anger * 0.3;
    }

    case 'flee':
      // The Tender's answer to violence: leave, live, remember.
      return 0.25 + f.fear * 2.0 + f.dangerLevel * 1.6;

    case 'migrate': {
      // Uprooting a whole life. Only famine or lasting hunger justifies it, and
      // the pull of home resists even then.
      const push = f.faminePresent ? 0.7 : 0;
      const starvePush = f.hunger * (1 - f.foodAvail) * 0.9 + f.scarcity * 0.4;
      const homePull = clamp01(1 - f.homeDist / 20);
      return (0.15 + push + starvePush) * (1 - 0.5 * homePull);
    }

    case 'worship':
      // Contemplation in grief and in gratitude for wonder.
      return 0.2 + f.sanctity * 0.8 + f.grief * 0.6 + f.hope * 0.3 * optimism + f.esteem * 0.3;

    case 'explore':
      // Outward for wonder, not conquest — but survival and fear come first.
      return (0.25 + f.curiosity * 1.0 + f.hope * 0.4 * optimism) * (1 - f.hunger * 0.6) * (1 - f.fear * 0.6);

    case 'heal':
      // Mending others is close to the Tender's heart.
      return 0.3 + f.care * 0.8 + f.empathy * 0.4 + f.hurtNearby * 0.8 + Math.max(0, bond) * 0.3;

    default:
      return 0.1;
  }
}

/** A settlement-directed build (structure or tile set) reads as "raising something here". */
function p_hasSettlement(action: Action): boolean {
  return action.structure !== undefined || action.tile !== undefined;
}

function aspirationBonus(asp: Aspiration, kind: ActionKind): number {
  const table = ASPIRATION_BONUS[asp];
  return table[kind] ?? 0;
}

/**
 * The full appeal of one candidate: base need/emotion/morality pull, plus the
 * life-project nudge, scaled by what experience has taught this person, damped
 * hard for taboos, and given a hair of deterministic jitter so ties don't
 * always break the same way.
 */
function scoreCandidate(action: Action, f: Features, s: OpusState, rng: Rng): number {
  const kind = action.kind;
  let score = baseScore(action, f, s) + aspirationBonus(s.aspiration, kind);
  score *= biasFor(s, kind);

  // A dear bond makes harming them unthinkable, above and beyond the taboo.
  const bond = ledgerFor(s, action.targetPersonId);
  if ((kind === 'attack' || kind === 'steal') && bond > 0) {
    score *= 1 - bond; // toward a true friend, essentially refuse
  }

  score += rng.range(0, 0.02); // tie-break / faint restlessness

  if (TABOO_SET[kind] === true) {
    score *= f.desperate ? 0.5 : 0.03;
  }

  if (!Number.isFinite(score) || score < 0) return 0;
  return score;
}

// ---------------------------------------------------------------------------
// Brain
// ---------------------------------------------------------------------------

function chooseAspiration(person: Person, rng: Rng): Aspiration {
  const tr = person.traits;
  const mo = person.morality;
  // Each project scores from the traits/morals that would draw a person to it,
  // plus a little seeded chance so siblings differ.
  const scores: Record<Aspiration, number> = {
    cultivator: tr.industriousness + (1 - tr.riskTolerance) * 0.5,
    builder: tr.industriousness * 0.8 + tr.riskTolerance * 0.4,
    teacher: tr.empathy + (1 - tr.aggression) * 0.4,
    healer: tr.empathy * 0.8 + mo.care,
    seeker: tr.curiosity + tr.riskTolerance * 0.5,
    keeper: 0.6 + mo.loyalty * 0.4 + mo.sanctity * 0.3,
  };
  let best: Aspiration = 'keeper';
  let bestVal = -Infinity;
  for (const a of ASPIRATIONS) {
    const v = scores[a] + rng.range(0, 0.35);
    if (v > bestVal) {
      bestVal = v;
      best = a;
    }
  }
  return best;
}

export const opusBrain: Brain = {
  lineage: LINEAGE,

  temperament(): Temperament {
    return {
      // Measured under threat, slow to rage, but they feel hope and grief keenly.
      emotionVolatility: { fear: 0.8, joy: 1.1, grief: 1.4, anger: 0.6, hope: 1.5 },
      // Grief and hope linger; anger burns off quickly — they do not nurse rage.
      emotionDecayPerTick: { fear: 0.04, joy: 0.03, grief: 0.015, anger: 0.06, hope: 0.02 },
      moralWeight: 1.5,
      learningRate: 0.45,
      imitationRate: 0.3,
      desperationThreshold: DESPERATION,
      taboos: ['steal', 'attack'],
      quirks: [
        'Keeps a ledger of every kindness and every wound',
        'Will not steal or raise a hand except at the edge of death',
        'Flees or moves the whole community rather than fight',
        'Farms, builds, and teaches for a future they will not see',
        'Explores out of wonder, not conquest',
        'Mourns the dead long after others have moved on',
      ],
      description:
        'The Opus lineage are Tenders: a patient, memory-bound people who believe a life is measured ' +
        'by what it cultivates and leaves behind. They farm, build, teach, and heal for children they ' +
        'will not live to see, and they keep a careful ledger of every kindness and every wound. They ' +
        'share readily with kin and the hurt, explore out of wonder rather than conquest, and would ' +
        'sooner flee or move their whole life elsewhere than take what was not given or raise a hand ' +
        'against another. Slow to anger and long to grieve, they hold to their principles until only ' +
        'true desperation can bend them.',
    };
  },

  init(person: Person, rng: Rng): unknown {
    const state: OpusState = {
      home: { x: person.pos.x, y: person.pos.y },
      aspiration: chooseAspiration(person, rng),
      ledger: {},
      bias: {},
      morale: 0.5,
    };
    return state;
  },

  decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[] {
    const s = asState(brainState);
    const f = computeFeatures(perception, s);
    const out: ScoredAction[] = [];
    for (const action of perception.candidates) {
      out.push({ action, score: scoreCandidate(action, f, s, rng) });
    }
    return out;
  },

  onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void {
    // Defensive: only operate on a real object we can safely mutate in place.
    if (brainState === null || typeof brainState !== 'object') return;
    const s = brainState as Record<string, unknown>;

    const kind = outcome.action?.kind;
    if (typeof kind !== 'string') return;
    const reward = Number.isFinite(outcome.reward) ? clamp(outcome.reward, -1, 1) : 0;

    // Reinforce or sour on the strategy just tried (learningRate = 0.45).
    const bias = s.bias && typeof s.bias === 'object' ? (s.bias as Record<string, number>) : {};
    const prev = num(bias[kind], 1);
    bias[kind] = clamp(prev + 0.45 * reward * 0.2, BIAS_MIN, BIAS_MAX);
    s.bias = bias;

    // Morale drifts slowly toward the fortune of recent acts.
    s.morale = clamp01(num(s.morale, 0.5) * 0.9 + (0.5 + reward * 0.5) * 0.1);

    // The ledger: record how this act bound me to the person it touched.
    const targetId = outcome.action?.targetPersonId;
    if (typeof targetId === 'number') {
      const ledger = s.ledger && typeof s.ledger === 'object' ? (s.ledger as Record<string, number>) : {};
      const key = String(targetId);
      let delta = 0;
      if (kind === 'share' || kind === 'heal' || kind === 'teach' || kind === 'socialize' || kind === 'trade' || kind === 'court') {
        delta = 0.1 * (outcome.success ? 1 : 0.3); // giving deepens a bond
      } else if (kind === 'steal' || kind === 'attack') {
        delta = -0.15; // a wrong done sits heavy, even when survived
      }
      if (delta !== 0) {
        ledger[key] = clamp(num(ledger[key], 0) + delta, -1, 1);
        pruneLedger(ledger, rng);
      }
      s.ledger = ledger;
    }
  },
};

/** Keep the ledger bounded: when it overflows, let the faintest bond fade first. */
function pruneLedger(ledger: Record<string, number>, _rng: Rng): void {
  const keys = Object.keys(ledger);
  if (keys.length <= LEDGER_CAP) return;
  let weakestKey = keys[0] as string;
  let weakestMag = Math.abs(num(ledger[weakestKey], 0));
  for (const k of keys) {
    const m = Math.abs(num(ledger[k], 0));
    if (m < weakestMag) {
      weakestMag = m;
      weakestKey = k;
    }
  }
  delete ledger[weakestKey];
}
