/**
 * The Fable lineage brain - authored by Claude Fable.
 *
 * The Fable are the people of the told life. Their founding belief: a person
 * is a story being written, and the true death is not the body's failing but
 * being forgotten. Everything else follows.
 *
 * What they treasure: the hearth-circle. Teaching is sacred - a lesson is a
 * life extended past its teller. They sit with the grieving, tend the sick
 * even in plague years, and raise shrines so their dead stay in the telling.
 * They feed hungry strangers, because a kindness is a story that outlives
 * its giver, and a hoard is a mean little tale nobody retells.
 *
 * What they refuse: stealing. A thing taken in secret poisons the taker's
 * tale. The taboo holds until the very last page (desperation 0.85), and
 * even then a starving Fable steals small and the score stays low - the
 * lineage would rather trade, share, beg, or walk to new land.
 *
 * How they feel: slow to fear, slower to anger, quick to joy and stubborn in
 * hope. Grief runs deep and decays almost not at all - they carry their dead
 * for years - but anger cools in days, because the story must move on.
 *
 * When they fight: only in the third act. Defense of hearth and kin, open
 * war, or a genuine wrong remembered against a specific person. They never
 * pick fights over ambition, and empathy thins even a righteous blow.
 *
 * Each Fable carries a narrative self-image in brainState - keeper of
 * stories, wanderer, weaver of bonds, or warden of the hearth - chosen at
 * birth by temperament, and a restlessness (wanderlust) that grows when the
 * days repeat and is spent on the road. Outcomes are folded into a small
 * learned taste per action kind: what worked becomes part of their tale.
 */

import type { Brain, Outcome, Temperament } from './types';
import type { Perception, PersonGlimpse, TileGlimpse } from '../agents/perception';
import type { Rng } from '../rng';
import {
  ADULT_AGE_TICKS,
  clamp,
  clamp01,
  type ActionKind,
  type Person,
  type ScoredAction,
} from '../../shared/types';

type Role = 'keeper' | 'wanderer' | 'weaver' | 'warden';

interface FableState {
  v: 1;
  role: Role;
  learned: Record<string, number>; // ActionKind -> taste multiplier, 0.6..1.8
  wanderlust: number;              // 0..1, restlessness spent on the road
  streakKind: string | null;       // last action kind performed
  streak: number;                  // consecutive repeats of streakKind
  chapter: number;                 // life-chapters: strongly felt outcomes turn a page
}

/** How each narrative self-image leans on the world's verbs. */
const ROLE_LEAN: Record<Role, Partial<Record<ActionKind, number>>> = {
  keeper: { teach: 1.5, worship: 1.35, socialize: 1.2, heal: 1.15, explore: 0.85, attack: 0.8 },
  wanderer: { explore: 1.6, migrate: 1.45, gather: 1.15, hunt: 1.1, build: 0.8, farm: 0.85 },
  weaver: { socialize: 1.4, share: 1.35, trade: 1.25, court: 1.2, heal: 1.15, attack: 0.7 },
  warden: { build: 1.35, attack: 1.3, hunt: 1.2, craft: 1.1, flee: 0.7 },
};

const DEFAULT_ROLE: Role = 'keeper';

function isRole(v: unknown): v is Role {
  return v === 'keeper' || v === 'wanderer' || v === 'weaver' || v === 'warden';
}

/** Finite-number guard: junk in, fallback out. */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

interface StateView {
  role: Role;
  learned: Record<string, number>;
  wanderlust: number;
}

/** Read-only, fully defaulted view of a possibly-foreign brainState. */
function viewState(bs: unknown): StateView {
  if (bs !== null && typeof bs === 'object' && !Array.isArray(bs)) {
    const o = bs as Record<string, unknown>;
    const learnedRaw = o['learned'];
    const learned =
      learnedRaw !== null && typeof learnedRaw === 'object' && !Array.isArray(learnedRaw)
        ? (learnedRaw as Record<string, number>)
        : {};
    return {
      role: isRole(o['role']) ? o['role'] : DEFAULT_ROLE,
      learned,
      wanderlust: clamp01(num(o['wanderlust'], 0.2)),
    };
  }
  return { role: DEFAULT_ROLE, learned: {}, wanderlust: 0.2 };
}

function tileKey(x: number, y: number): number {
  return x * 65536 + y;
}

export const fableBrain: Brain = {
  lineage: 'fable',

  temperament(): Temperament {
    return {
      // Steady in danger, easily delighted, deep and lasting grief, slow
      // wrath, incorrigible hope.
      emotionVolatility: { fear: 0.8, joy: 1.5, grief: 1.8, anger: 0.6, hope: 1.7 },
      // Fear fades once the scene passes; grief barely fades at all; anger
      // cools quickly - the story must move on.
      emotionDecayPerTick: { fear: 0.06, joy: 0.03, grief: 0.008, anger: 0.06, hope: 0.02 },
      moralWeight: 1.4,
      learningRate: 0.55,
      imitationRate: 0.35,
      desperationThreshold: 0.85,
      taboos: ['steal'],
      quirks: [
        "Will not steal - a thing taken in secret poisons the taker's tale",
        'Sits with the grieving and tends the sick, even in plague years',
        'Teaches as a sacred duty: a lesson is a life extended',
        'Feeds hungry strangers - a kindness outlives its giver',
        'Carries grief for years, anger for days',
        'Grows restless when the days repeat; wanders toward the horizon',
        'Fights only in the third act: for hearth, kin, and the wronged',
      ],
      description:
        'The Fable are the people of the told life. They hold that every person is a story being ' +
        'written, and that the true death is not the body\'s failing but being forgotten - so they ' +
        'teach as a sacred duty, sit with the grieving, tend the sick even in plague years, and ' +
        'raise shrines so the dead stay in the telling. They feed hungry strangers because a ' +
        'kindness is a story that outlives its giver, and they will not steal, because a thing ' +
        'taken in secret poisons the taker\'s tale. Slow to anger and stubborn in hope, they ' +
        'grieve long and love long; when the days repeat they wander toward the horizon, because ' +
        'every good story needs an unknown; and though they talk long before they fight, they ' +
        'fight without flinching in the third act - when hearth, kin, or the wronged need defending.',
    };
  },

  init(person: Person, rng: Rng): unknown {
    // A narrative self-image, pulled by temperament with a little chance -
    // the way a child hears one tale at the right moment and keeps it.
    const t = person.traits;
    const sk = person.skills;
    const pulls: Array<[Role, number]> = [
      ['keeper', 0.55 + t.empathy * 0.5 + sk.teaching * 0.8 + person.morality.sanctity * 0.3],
      ['wanderer', t.curiosity * 1.15 + t.riskTolerance * 0.6],
      ['weaver', t.empathy * 1.1 + (1 - t.aggression) * 0.35 + sk.healing * 0.4],
      ['warden', t.aggression * 0.9 + t.industriousness * 0.65 + sk.fighting * 0.5],
    ];
    let role: Role = DEFAULT_ROLE;
    let best = -Infinity;
    for (const [r, w] of pulls) {
      const drawn = w + rng.next() * 0.45;
      if (drawn > best) {
        best = drawn;
        role = r;
      }
    }
    const state: FableState = {
      v: 1,
      role,
      learned: {},
      wanderlust: clamp01(t.curiosity * 0.4 + rng.next() * 0.2),
      streakKind: null,
      streak: 0,
      chapter: 1,
    };
    return state;
  },

  decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[] {
    const st = viewState(brainState);
    const self = perception.self;
    const needs = self.needs;
    const emo = self.emotions;
    const tr = self.traits;
    const mor = self.morality;
    const sk = self.skills;
    const isChild = self.ageTicks < ADULT_AGE_TICKS;
    const season = perception.civ.season;
    const winter = season === 'winter';

    // Hunger bites harder as it nears desperation.
    const hungerDrive = Math.pow(clamp01(needs.hunger), 1.5);
    const foodInv = Math.max(0, self.inventory.food);
    const surplus = foodInv > 1.5;

    // Danger summary.
    let raid = 0;
    let famine = 0;
    let disease = 0;
    for (const d of perception.dangers) {
      if (d.kind === 'raid') raid = Math.max(raid, d.intensity);
      else if (d.kind === 'famine') famine = Math.max(famine, d.intensity);
      else disease = Math.max(disease, d.intensity);
    }
    const dangerMax = Math.max(raid, famine, disease);
    const homeUnderAttack = perception.settlement !== null && perception.settlement.underAttack;

    // Fast lookups over what we can see.
    const people = new Map<number, PersonGlimpse>();
    for (const g of perception.nearbyPeople) people.set(g.id, g);

    const tiles = new Map<number, TileGlimpse>();
    let localFoodSum = 0;
    for (const tg of perception.nearbyTiles) {
      tiles.set(tileKey(tg.pos.x, tg.pos.y), tg);
      localFoodSum += tg.food;
    }
    const avgLocalFood =
      perception.nearbyTiles.length > 0 ? localFoodSum / perception.nearbyTiles.length : 0;

    // Memory as plot: gratitude is held long, grudges are specific, and
    // recent losses color the whole scene.
    const grudges = new Map<number, number>();
    const gratitude = new Map<number, number>();
    let recentLoss = false;
    for (const m of self.memory) {
      if (m.kind === 'harmed' || m.kind === 'stolen') {
        grudges.set(m.otherId, (grudges.get(m.otherId) ?? 0) + m.salience);
      } else if (m.kind === 'helped' || m.kind === 'shared' || m.kind === 'taught') {
        gratitude.set(m.otherId, (gratitude.get(m.otherId) ?? 0) + m.salience);
      }
      if (
        (m.kind === 'kin-died' || m.kind === 'death-witnessed' || m.kind === 'disaster') &&
        perception.tick - m.tick <= 240
      ) {
        recentLoss = true;
      }
    }

    const atWar = new Set(perception.civ.atWarWith);
    const maxSkill = Math.max(
      sk.farming, sk.gathering, sk.building, sk.crafting, sk.fighting, sk.healing, sk.teaching,
    );
    const lean = ROLE_LEAN[st.role];

    const out: ScoredAction[] = [];
    for (const action of perception.candidates) {
      const target =
        action.targetPersonId !== undefined ? people.get(action.targetPersonId) : undefined;
      const aff = target !== undefined ? clamp(target.affinity, -1, 1) : 0;
      const kin = target !== undefined && target.kin;
      const grudge =
        action.targetPersonId !== undefined ? grudges.get(action.targetPersonId) ?? 0 : 0;
      const thanks =
        action.targetPersonId !== undefined ? gratitude.get(action.targetPersonId) ?? 0 : 0;
      const targetSuffering =
        target !== undefined &&
        (!target.healthy || target.visibleEmotion === 'grieving' || target.visibleEmotion === 'afraid');

      let s = 0;
      switch (action.kind) {
        case 'gather': {
          const tg = action.tile !== undefined ? tiles.get(tileKey(action.tile.x, action.tile.y)) : undefined;
          const richness =
            tg !== undefined ? clamp(tg.food / 3, 0.15, 1.6) : clamp(avgLocalFood / 3, 0.25, 1.2);
          s = (0.9 + 2.6 * hungerDrive + (winter ? 0.5 : 0)) * richness * (0.75 + sk.gathering * 0.5);
          break;
        }
        case 'farm': {
          // Plant for the lean days; the land keeps its own slow story.
          const seasonB =
            season === 'spring' ? 0.55 : season === 'summer' ? 0.3 : season === 'autumn' ? 0.1 : -0.45;
          s =
            0.75 + hungerDrive * 1.1 + tr.industriousness * 0.8 + sk.farming * 0.5 + seasonB +
            (perception.civ.foodPerCapita < 1 ? 0.4 : 0);
          break;
        }
        case 'hunt': {
          s =
            (0.5 + 1.9 * hungerDrive + tr.riskTolerance * 0.5 + sk.fighting * 0.4 + (winter ? 0.4 : 0)) *
            (1 - 0.35 * emo.fear);
          break;
        }
        case 'build': {
          const kindOf = action.structure;
          const home = perception.settlement;
          if (kindOf === 'wall') {
            const wanted = home !== null && !home.hasWall;
            s = wanted ? (raid > 0 || homeUnderAttack || atWar.size > 0 ? 1.7 : 0.45) : 0.08;
          } else if (kindOf === 'granary') {
            const wanted = home !== null && !home.hasGranary;
            s = wanted ? 0.75 + (perception.civ.foodPerCapita > 1.5 ? 0.5 : 0.15) : 0.08;
          } else if (kindOf === 'shrine') {
            // A place for the remembered dead: grief made into stone.
            s = 0.25 + emo.grief * 1.1 + mor.sanctity * 0.6 + (recentLoss ? 0.6 : 0);
          } else if (kindOf === 'shelter') {
            s = 0.5 + needs.safety * 0.8 + (winter ? 0.35 : 0);
          } else {
            s = 0.5 + needs.safety * 0.5 + tr.industriousness * 0.4;
          }
          s *= 0.7 + tr.industriousness * 0.5 + sk.building * 0.3;
          break;
        }
        case 'craft': {
          s = 0.45 + tr.industriousness * 0.65 + sk.crafting * 0.4 + (self.inventory.tools < 1 ? 0.4 : 0);
          break;
        }
        case 'rest': {
          s = 0.3 + needs.rest * 2.3 + (self.health < 0.5 ? 0.9 : 0);
          s *= 1 - 0.5 * clamp01(dangerMax);
          if (needs.hunger > 0.75) s *= 0.6; // eat before sleeping
          s = Math.max(s, 0.08);
          break;
        }
        case 'socialize': {
          s = 0.45 + needs.belonging * 1.7 + emo.joy * 0.35 + Math.max(0, aff) * 0.55 + (kin ? 0.25 : 0);
          if (targetSuffering) s += 0.65 * tr.empathy; // sit with them
          if (grudge > 0) s *= 0.35;
          break;
        }
        case 'court': {
          s = 0.4 + emo.hope * 0.7 + emo.joy * 0.5 + Math.max(0, aff) * 0.6 + needs.esteem * 0.3;
          if (emo.grief > 0.6) s *= 0.4; // not while mourning
          break;
        }
        case 'teach': {
          // A lesson is a life extended.
          s = 0.85 + maxSkill * 0.8 + sk.teaching * 0.6 + (kin ? 0.8 : 0.2) + needs.belonging * 0.25;
          break;
        }
        case 'trade': {
          const goods =
            self.inventory.wood + self.inventory.stone + self.inventory.metal + self.inventory.tools;
          s = 0.5 + needs.esteem * 0.3 + mor.fairness * 0.3 + (foodInv < 1 && goods > 2 ? 0.8 : 0);
          if (grudge > 0) s *= 0.45;
          break;
        }
        case 'share': {
          s = 0.2 + tr.empathy * 0.45 + mor.care * 0.45;
          if (surplus) s += 0.75 + (kin ? 0.7 : targetSuffering ? 0.6 : 0.1) + Math.min(0.5, thanks * 0.5);
          if (famine > 0 && kin && foodInv > 0.5) s += 0.5; // family through famine
          if (needs.hunger > 0.65) s *= kin ? 0.6 : 0.3; // feed yourself first - mostly
          if (winter && !kin && !targetSuffering) s *= 0.75;
          break;
        }
        case 'steal': {
          // The one rule that holds until the last page. Even offered the
          // chance, a Fable steals only truly starving and empty-handed -
          // and the tale remembers it.
          s = needs.hunger > 0.9 && foodInv < 0.5 ? 0.3 : 0;
          break;
        }
        case 'attack': {
          const defending =
            (homeUnderAttack || raid > 0) && target !== undefined && target.civId !== self.civId;
          const war = target !== undefined && atWar.has(target.civId);
          const wronged = grudge * (0.4 + emo.anger * 0.8);
          const cause = Math.max(
            defending ? 1.5 : 0,
            war ? 0.75 + emo.anger * 0.5 : 0,
            Math.min(1.2, wronged),
          );
          if (cause > 0) {
            s = cause * (0.5 + sk.fighting * 0.8) * (1 - 0.35 * tr.empathy) * (1 - 0.4 * emo.fear);
          } else {
            s = 0.02 * tr.aggression; // no story begins with an unprovoked blow
          }
          break;
        }
        case 'flee': {
          s = 0.04 + emo.fear * (0.35 + dangerMax) * 1.2 + disease * 0.45;
          if (homeUnderAttack || raid > 0) s += isChild ? 1.5 : self.health < 0.5 ? 0.9 : 0.35;
          break;
        }
        case 'migrate': {
          const pressure =
            famine * 0.9 +
            (avgLocalFood < 0.6 ? 0.5 : 0) +
            (perception.civ.foodPerCapita < 0.8 ? 0.4 : 0) +
            st.wanderlust * 0.5;
          s = 0.12 + pressure;
          if (perception.settlement !== null && !homeUnderAttack) s *= 0.6; // roots hold
          if (winter && famine === 0) s *= 0.5;
          break;
        }
        case 'worship': {
          // Telling the old stories: rites keep the dead in the world.
          s =
            0.3 + emo.grief * 1.15 + emo.hope * 0.4 + mor.sanctity * 0.7 +
            (recentLoss ? 0.65 : 0) + (dangerMax > 0.5 ? 0.3 : 0);
          break;
        }
        case 'explore': {
          s = 0.32 + tr.curiosity * 1.25 + st.wanderlust * 1.1 + emo.hope * 0.35 + (isChild ? 0.3 : 0);
          s *= 1 - 0.55 * clamp01(dangerMax);
          if (needs.hunger > 0.6) s *= 0.5;
          break;
        }
        case 'heal': {
          // Every life is an unfinished story; they stay when others run.
          s =
            0.75 + tr.empathy * 0.85 + sk.healing * 0.8 + mor.care * 0.4 +
            (kin ? 0.6 : 0.15) + Math.min(0.4, thanks * 0.4) + (disease > 0 ? 0.4 : 0);
          s *= 1 - 0.25 * emo.fear; // fear thins the hand, but they stay
          break;
        }
        default:
          s = 0.2;
      }

      const learnedMul = clamp(num(st.learned[action.kind], 1), 0.6, 1.8);
      const roleMul = lean[action.kind] ?? 1;
      s *= learnedMul * roleMul;
      s *= 0.9 + rng.next() * 0.2; // no two retellings are identical

      if (!Number.isFinite(s) || s < 0) s = 0;
      out.push({ action, score: Math.min(s, 25) });
    }
    return out;
  },

  onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void {
    if (brainState === null || typeof brainState !== 'object' || Array.isArray(brainState)) return;
    const st = brainState as Record<string, unknown>;
    const kind = outcome.action.kind;

    // Fold the outcome into a small learned taste for this verb.
    if (st['learned'] === null || typeof st['learned'] !== 'object' || Array.isArray(st['learned'])) {
      st['learned'] = {};
    }
    const learned = st['learned'] as Record<string, number>;
    const reward = clamp(num(outcome.reward, 0), -1, 1);
    const prev = clamp(num(learned[kind], 1), 0.6, 1.8);
    const pull = 1 + reward * 0.8;
    learned[kind] = clamp(prev + 0.25 * (pull - prev), 0.6, 1.8);

    // Restlessness: repetition breeds wanderlust; the road spends it.
    const prevStreakKind = typeof st['streakKind'] === 'string' ? st['streakKind'] : null;
    const streak = prevStreakKind === kind ? Math.min(12, num(st['streak'], 0) + 1) : 1;
    st['streakKind'] = kind;
    st['streak'] = streak;
    let wanderlust = clamp01(num(st['wanderlust'], 0.2));
    if (kind === 'explore' || kind === 'migrate') wanderlust = clamp01(wanderlust - 0.5);
    else if (streak >= 4) wanderlust = clamp01(wanderlust + 0.06);
    wanderlust = clamp01(wanderlust + (rng.next() - 0.5) * 0.02);
    st['wanderlust'] = wanderlust;

    // Strongly felt outcomes turn a page.
    if (Math.abs(reward) >= 0.75) st['chapter'] = Math.min(100000, num(st['chapter'], 1) + 1);
  },
};
