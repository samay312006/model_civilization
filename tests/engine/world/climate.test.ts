import { describe, expect, it } from 'vitest';
import { SEASON_TICKS } from '../../../src/shared/types';
import { seasonOf, seasonYieldMultiplier } from '../../../src/engine/world/climate';

describe('seasons', () => {
  it('cycles spring/summer/autumn/winter at SEASON_TICKS boundaries, repeating yearly', () => {
    expect(SEASON_TICKS).toBe(90);
    expect(seasonOf(0)).toBe('spring');
    expect(seasonOf(89)).toBe('spring');
    expect(seasonOf(90)).toBe('summer');
    expect(seasonOf(179)).toBe('summer');
    expect(seasonOf(180)).toBe('autumn');
    expect(seasonOf(269)).toBe('autumn');
    expect(seasonOf(270)).toBe('winter');
    expect(seasonOf(359)).toBe('winter');
    expect(seasonOf(360)).toBe('spring');
    expect(seasonOf(360 * 5 + 90)).toBe('summer');
  });

  it('returns the exact contract yield multipliers', () => {
    expect(seasonYieldMultiplier('spring')).toBe(1.1);
    expect(seasonYieldMultiplier('summer')).toBe(1.25);
    expect(seasonYieldMultiplier('autumn')).toBe(1.0);
    expect(seasonYieldMultiplier('winter')).toBe(0.45);
  });
});
