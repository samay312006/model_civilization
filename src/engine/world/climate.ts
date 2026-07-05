import { SEASON_TICKS, YEAR_TICKS } from '../../shared/types';
import type { Season, Tick, Vec2 } from '../../shared/types';
import type { Rng } from '../rng';
import { FOREST_WOOD_CAP } from './terrain';
import type { World } from './terrain';

export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Season of a tick: 90-tick quarters of the 360-tick year, starting at spring on tick 0. */
export function seasonOf(tick: Tick): Season {
  return SEASONS[Math.floor((tick % YEAR_TICKS) / SEASON_TICKS)];
}

/** Contract-fixed food yield multipliers per season. */
export function seasonYieldMultiplier(season: Season): number {
  switch (season) {
    case 'spring': return 1.1;
    case 'summer': return 1.25;
    case 'autumn': return 1.0;
    case 'winter': return 0.45;
  }
}

/** Per-tick fraction of the gap to the seasonal cap that food regrows. */
export const FOOD_REGROWTH_RATE = 0.02;
/** Per-tick fraction of the gap to FOREST_WOOD_CAP that forest wood regrows. */
export const WOOD_REGROWTH_RATE = 0.001;

export interface NaturalEvent {
  kind: 'drought' | 'harsh-winter' | 'disease';
  startTick: Tick;
  durationTicks: number;
  /** null = map-wide (drought, harsh-winter); disease is centered on a land tile. */
  center: Vec2 | null;
  /** 0..1; consumed by regrowth here and by needs/lifecycle in later tasks. */
  intensity: number;
}

/** True while tick lies inside [startTick, startTick + durationTicks). */
export function isEventActive(e: NaturalEvent, tick: Tick): boolean {
  return tick >= e.startTick && tick < e.startTick + e.durationTicks;
}

/**
 * Move each tile's food toward fertility * 3 * seasonYieldMultiplier at
 * FOOD_REGROWTH_RATE of the remaining gap per tick (downward too, so a
 * winter cap gently drains surplus), and forest wood toward FOREST_WOOD_CAP
 * at WOOD_REGROWTH_RATE. An active drought suppresses all regrowth to zero.
 *
 * NOTE (recorded contract deviation): `activeEvents` extends the contract
 * signature as an optional trailing parameter. The Simulation (Task 33) must
 * run updateNaturalEvents first and pass ctx.naturalEvents here; calls that
 * omit it simply get no drought suppression.
 */
export function regenerateResources(world: World, tick: Tick, _rng: Rng, activeEvents: NaturalEvent[] = []): void {
  for (const e of activeEvents) {
    if (e.kind === 'drought' && isEventActive(e, tick)) return;
  }
  const mult = seasonYieldMultiplier(seasonOf(tick));
  for (const t of world.tiles) {
    if (t.fertility > 0) {
      const foodCap = t.fertility * 3 * mult;
      t.food += (foodCap - t.food) * FOOD_REGROWTH_RATE;
    }
    if (t.terrain === 'forest' && t.wood < FOREST_WOOD_CAP) {
      t.wood += (FOREST_WOOD_CAP - t.wood) * WOOD_REGROWTH_RATE;
    }
  }
}

export const MAX_ACTIVE_EVENTS = 2;
export const EVENT_MIN_DURATION = 30;
export const EVENT_MAX_DURATION = 120;
/** Per summer tick (~one drought every 4 years). */
export const DROUGHT_CHANCE = 1 / (4 * YEAR_TICKS);
/** Per winter tick (~one harsh winter every 3 years). */
export const HARSH_WINTER_CHANCE = 1 / (3 * YEAR_TICKS);
/** Per tick, any season (~one outbreak every 5 years). */
export const DISEASE_CHANCE = 1 / (5 * YEAR_TICKS);

/** Uniform duration in [EVENT_MIN_DURATION, EVENT_MAX_DURATION]. */
function rollDuration(rng: Rng): number {
  return EVENT_MIN_DURATION + rng.int(EVENT_MAX_DURATION - EVENT_MIN_DURATION + 1);
}

/** Pick a non-water tile: bounded retries, deterministic fallback to the map center. */
function pickLandTile(world: World, rng: Rng): Vec2 {
  for (let i = 0; i < 50; i++) {
    const x = rng.int(world.size);
    const y = rng.int(world.size);
    if (world.tileAt(x, y).terrain !== 'water') return { x, y };
  }
  return { x: Math.floor(world.size / 2), y: Math.floor(world.size / 2) };
}

/**
 * Expire finished events and roll new ones in a fixed order (drought,
 * harsh-winter, disease). At most MAX_ACTIVE_EVENTS are active at once and
 * at most one of each kind. Returns a new array; never mutates `active`.
 * Drought suppresses regrowth (see regenerateResources); harsh-winter and
 * disease intensity are consumed by needs/lifecycle in Tasks 9 and 17.
 */
export function updateNaturalEvents(active: NaturalEvent[], world: World, tick: Tick, rng: Rng): NaturalEvent[] {
  const next = active.filter((e) => isEventActive(e, tick));
  const season = seasonOf(tick);
  const hasKind = (k: NaturalEvent['kind']): boolean => next.some((e) => e.kind === k);

  if (next.length < MAX_ACTIVE_EVENTS && season === 'summer' && !hasKind('drought') && rng.chance(DROUGHT_CHANCE)) {
    next.push({ kind: 'drought', startTick: tick, durationTicks: rollDuration(rng), center: null, intensity: rng.range(0.5, 1) });
  }
  if (next.length < MAX_ACTIVE_EVENTS && season === 'winter' && !hasKind('harsh-winter') && rng.chance(HARSH_WINTER_CHANCE)) {
    next.push({ kind: 'harsh-winter', startTick: tick, durationTicks: rollDuration(rng), center: null, intensity: rng.range(0.5, 1) });
  }
  if (next.length < MAX_ACTIVE_EVENTS && !hasKind('disease') && rng.chance(DISEASE_CHANCE)) {
    next.push({ kind: 'disease', startTick: tick, durationTicks: rollDuration(rng), center: pickLandTile(world, rng), intensity: rng.range(0.3, 1) });
  }
  return next;
}
