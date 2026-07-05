// Seeded syllable name generator. All draws go through the provided Rng —
// internally re-split with the label 'names' — so generating names never
// consumes draws from (and never perturbs) the caller's stream.

import type { Rng } from './rng';

export interface NameGen { person(sex: 'm' | 'f'): string; place(): string; civ(): string; religion(): string }

// Syllable pools. Every entry is lowercase a-z. The length budget guarantees
// each generated name is 3..12 characters:
//   person   = start(2-3) [+ mid(2)] + ending(1-4)  -> 3..9 chars
//   place    = start(2-3) [+ mid(2)] + ending(4)    -> 6..9 chars
//   civ      = start(2-3) [+ mid(2)] + ending(2-4)  -> 4..9 chars
//   religion = start(2-3) [+ mid(2)] + ending(3)    -> 5..8 chars
const STARTS = ['ka', 'mi', 'ta', 'so', 'ren', 'da', 'lu', 'bel', 'ha', 'jor', 'ni', 'va', 'or', 'el', 'shi', 'gan', 'tes', 'ru', 'mar', 'fen'] as const;
const MIDS = ['ri', 'la', 'to', 'ne', 'mo', 'sa', 'vi', 'du'] as const;

// Sex-distinct ending pools. The two arrays are disjoint, and by construction
// no generated male name ends with any female ending string or vice versa
// (tested in tests/engine/names.test.ts).
export const MALE_ENDINGS: readonly string[] = ['on', 'ar', 'im', 'us', 'ek', 'or', 'an', 'eth'];
export const FEMALE_ENDINGS: readonly string[] = ['a', 'ia', 'ra', 'she', 'wen', 'lea', 'issa', 'yne'];

const PLACE_ENDINGS = ['ford', 'holm', 'vale', 'wick', 'dale', 'moor', 'crag', 'mere'] as const;
const CIV_ENDINGS = ['ia', 'land', 'mark', 'heim', 'aria', 'oth'] as const;
const RELIGION_ENDINGS = ['ism', 'ara', 'eon', 'yth', 'ael'] as const;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function makeNameGenerator(rng: Rng): NameGen {
  const r = rng.split('names');

  // start syllable, plus a middle syllable with probability midChance
  function stem(midChance: number): string {
    const start = r.pick(STARTS);
    return r.chance(midChance) ? start + r.pick(MIDS) : start;
  }

  return {
    person(sex: 'm' | 'f'): string {
      const base = stem(0.4);
      const ending = sex === 'f' ? r.pick(FEMALE_ENDINGS) : r.pick(MALE_ENDINGS);
      return capitalize(base + ending);
    },
    place(): string {
      return capitalize(stem(0.35) + r.pick(PLACE_ENDINGS));
    },
    civ(): string {
      return capitalize(stem(0.3) + r.pick(CIV_ENDINGS));
    },
    religion(): string {
      return capitalize(stem(0.3) + r.pick(RELIGION_ENDINGS));
    },
  };
}
