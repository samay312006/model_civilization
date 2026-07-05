import { SEASON_TICKS, YEAR_TICKS } from '../../shared/types';
import type { Season, Tick } from '../../shared/types';

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
