import {
  ADULT_AGE_TICKS,
  GESTATION_TICKS,
  YEAR_TICKS,
  dist,
  type Civ,
  type Emotions,
  type Person,
  type Tick,
} from '../../shared/types';
import type { Rng } from '../rng';
import type { NameGen } from '../names';
import { isEventActive, type NaturalEvent } from '../world/climate';
import { applyHungerHealth } from './needs';
import { applyEmotionImpulse } from './emotions';
import { remember } from './memory';
import { adjustRelationship } from './relationships';
import { createChild } from './person';

/**
 * Structural subset of the Task 33 EngineCtx containing only what lifecycle
 * reads. EngineCtx is a superset, so Simulation passes its ctx directly.
 */
export interface LifecycleCtx {
  people: Person[];
  personById: Map<number, Person>;
  civs: Civ[];
  names: NameGen;
  tick: Tick;
  rng: Rng;
  naturalEvents: NaturalEvent[];
  counters: { births: number; deaths: number };
}

// Tuning constants (exported so tests and later balance passes can assert them).
export const DISEASE_RADIUS = 10;
export const INFECTION_CHANCE_PER_INTENSITY = 0.002; // per tick: 0.002 * event.intensity
export const DISEASE_HEALTH_DRAIN = 0.008; // health per tick while infected (halved by medicine)
export const FERTILE_MIN_AGE_TICKS = ADULT_AGE_TICKS; // 16 years
export const FERTILE_MAX_AGE_TICKS = 45 * YEAR_TICKS; // 45 years
export const CONCEPTION_HUNGER_MAX = 0.7; // needs.hunger must be strictly below this
export const CONCEPTION_CHANCE = 0.004; // per eligible tick
export const GRIEF_IMPULSE = 0.5;

/**
 * Volatility-neutral multiplier for impulses lifecycle applies itself:
 * lifecycle has no access to per-lineage temperament (only brainInit is
 * injected), so grief and birth-joy land at face value.
 */
const NEUTRAL_VOLATILITY: Emotions = { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 };

/**
 * Infection is tracked as an extension property on the Person object rather
 * than a new field in the frozen shared Person type (deviation 4). It is a
 * plain number, so JSON serialization of a person (Task 36) carries it, and
 * it is only ever touched through the helpers below.
 */
interface WithInfection {
  infectedUntil?: Tick;
}

/** True while the person carries an infection that has not yet run out. */
export function isInfected(p: Person, tick: Tick): boolean {
  const until = (p as Person & WithInfection).infectedUntil;
  return until !== undefined && tick < until;
}

/** Mark the person infected until untilTick (exclusive). */
export function setInfected(p: Person, untilTick: Tick): void {
  (p as Person & WithInfection).infectedUntil = untilTick;
}

function clearInfection(p: Person): void {
  delete (p as Person & WithInfection).infectedUntil;
}

/**
 * Per-person lifecycle update, run once per tick for every person
 * (Simulation tick step 4, ascending id). Internal order: aging -> hunger
 * health drain -> disease -> death check -> birth -> conception. A person
 * who dies this tick neither gives birth nor conceives.
 *
 * brainInit is injected to avoid a circular dependency on the brain registry
 * (Task 20). Task 33 passes:
 *   (person, rng) => getBrain(person.lineage).init(person, rng)
 */
export function updateLifecycle(
  p: Person,
  ctx: LifecycleCtx,
  brainInit: (p: Person, rng: Rng) => unknown,
): void {
  if (!p.alive) return;

  p.ageTicks += 1; // aging: +1 tick
  applyHungerHealth(p); // starvation drain owned by needs.ts (hunger > 0.85 -> -0.01/tick)
  updateDisease(p, ctx);

  if (p.health <= 0 || p.ageTicks > p.lifespanTicks) {
    die(p, ctx);
    return;
  }

  if (p.sex === 'f' && p.pregnantUntil !== null && p.pregnantUntil <= ctx.tick) {
    giveBirth(p, ctx, brainInit);
  }
  maybeConceive(p, ctx);
}

function updateDisease(p: Person, ctx: LifecycleCtx): void {
  // Recovery: the infection window has passed.
  const ext = p as Person & WithInfection;
  if (ext.infectedUntil !== undefined && ctx.tick >= ext.infectedUntil) {
    clearInfection(p);
  }

  // Exposure: any active disease event within DISEASE_RADIUS can infect,
  // chance 0.002 * intensity per tick. The infection lasts until the event
  // ends (startTick + durationTicks).
  if (!isInfected(p, ctx.tick)) {
    for (const ev of ctx.naturalEvents) {
      if (ev.kind !== 'disease' || ev.center === null) continue;
      if (!isEventActive(ev, ctx.tick)) continue;
      if (dist(p.pos, ev.center) > DISEASE_RADIUS) continue;
      if (ctx.rng.chance(INFECTION_CHANCE_PER_INTENSITY * ev.intensity)) {
        setInfected(p, ev.startTick + ev.durationTicks);
        break;
      }
    }
  }

  // Sickness: drain health, halved when the person's civ has active medicine.
  if (isInfected(p, ctx.tick)) {
    const civ = ctx.civs.find((c) => c.id === p.civId);
    const drain =
      civ !== undefined && civ.techs.includes('medicine')
        ? DISEASE_HEALTH_DRAIN / 2
        : DISEASE_HEALTH_DRAIN;
    p.health = Math.max(0, p.health - drain);
  }
}

function die(p: Person, ctx: LifecycleCtx): void {
  // Cause precedence: execute.ts may already have set 'violence' — never
  // overwrite an existing cause. Otherwise: disease, then starvation, then
  // old-age (which also covers any residual health<=0 case).
  if (p.causeOfDeath === null) {
    if (p.health <= 0 && isInfected(p, ctx.tick)) p.causeOfDeath = 'disease';
    else if (p.health <= 0 && p.needs.hunger > 0.85) p.causeOfDeath = 'starvation';
    else p.causeOfDeath = 'old-age';
  }
  p.alive = false;
  p.health = 0;
  clearInfection(p);
  ctx.counters.deaths += 1;

  // Grief: the partner, everyone the deceased recorded as kin/partner, and
  // the deceased's parents. Settlement member removal is deliberately
  // deferred to society/settlements.ts updateSettlements (Task 26).
  const mourners = new Set<number>();
  if (p.partnerId !== null) mourners.add(p.partnerId);
  if (p.parentIds !== null) {
    mourners.add(p.parentIds[0]);
    mourners.add(p.parentIds[1]);
  }
  for (const rel of p.relationships) {
    if (rel.kind === 'kin' || rel.kind === 'partner') mourners.add(rel.otherId);
  }
  for (const id of mourners) {
    const other = ctx.personById.get(id);
    if (other === undefined || !other.alive) continue;
    applyEmotionImpulse(other, { grief: GRIEF_IMPULSE }, NEUTRAL_VOLATILITY);
    remember(other, { tick: ctx.tick, kind: 'kin-died', otherId: p.id, valence: -0.9, salience: 0.9 });
    if (other.partnerId === p.id) other.partnerId = null; // widowed; may court again later
  }
}

function giveBirth(
  p: Person,
  ctx: LifecycleCtx,
  brainInit: (p: Person, rng: Rng) => unknown,
): void {
  const father = p.partnerId !== null ? ctx.personById.get(p.partnerId) : undefined;
  p.pregnantUntil = null; // the pregnancy ends whether or not a child arrives
  if (father === undefined || !father.alive) return; // no living father: no birth

  // Ids are never reused (the dead stay in ctx.people), so max+1 is safe and
  // deterministic. Births are rare, so the O(n) scan is fine.
  let maxId = 0;
  for (const q of ctx.people) {
    if (q.id > maxId) maxId = q.id;
  }

  const child = createChild(maxId + 1, p, father, ctx.names, ctx.rng);
  child.brainState = brainInit(child, ctx.rng);
  ctx.people.push(child);
  ctx.personById.set(child.id, child);
  ctx.counters.births += 1;

  // Kin wiring in both directions. adjustRelationship creates-or-adjusts, so
  // this is safe even if createChild (Task 8) already linked them.
  adjustRelationship(p, child.id, 'kin', 0.9);
  adjustRelationship(child, p.id, 'kin', 0.9);
  adjustRelationship(father, child.id, 'kin', 0.9);
  adjustRelationship(child, father.id, 'kin', 0.9);

  remember(p, { tick: ctx.tick, kind: 'birth', otherId: child.id, valence: 0.9, salience: 0.8 });
  remember(father, { tick: ctx.tick, kind: 'birth', otherId: child.id, valence: 0.9, salience: 0.8 });
  applyEmotionImpulse(p, { joy: 0.3 }, NEUTRAL_VOLATILITY);
  applyEmotionImpulse(father, { joy: 0.3 }, NEUTRAL_VOLATILITY);
}

function maybeConceive(p: Person, ctx: LifecycleCtx): void {
  if (p.sex !== 'f' || p.pregnantUntil !== null || p.partnerId === null) return;
  if (p.ageTicks < FERTILE_MIN_AGE_TICKS || p.ageTicks > FERTILE_MAX_AGE_TICKS) return;
  if (p.needs.hunger >= CONCEPTION_HUNGER_MAX) return;
  const partner = ctx.personById.get(p.partnerId);
  if (partner === undefined || !partner.alive) return;
  if (ctx.rng.chance(CONCEPTION_CHANCE)) {
    p.pregnantUntil = ctx.tick + GESTATION_TICKS;
  }
}
