import { describe, expect, it } from 'vitest';
import { FADE_MIN, FADE_RATE, fadeMemories, memoryBias, remember } from '../../../src/engine/agents/memory';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import { MEMORY_CAP, type MemoryEventRec, type Person } from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function makePerson(): Person {
  const p = createPerson(1, 0, 'fable', { x: 0, y: 0 }, names, createRng(1));
  p.memory = [];
  return p;
}

function rec(overrides: Partial<MemoryEventRec> = {}): MemoryEventRec {
  return { tick: 0, kind: 'helped', otherId: 1, valence: 0.5, salience: 0.5, ...overrides };
}

describe('remember', () => {
  it('inserts newest-first', () => {
    const p = makePerson();
    remember(p, rec({ tick: 1 }));
    remember(p, rec({ tick: 2 }));
    expect(p.memory[0]?.tick).toBe(2);
    expect(p.memory[1]?.tick).toBe(1);
  });

  it('does not evict while under the cap', () => {
    const p = makePerson();
    for (let i = 0; i < MEMORY_CAP; i++) remember(p, rec({ tick: i }));
    expect(p.memory).toHaveLength(MEMORY_CAP);
  });

  it('evicts the lowest-salience entry (never the just-inserted one) beyond the cap', () => {
    const p = makePerson();
    for (let i = 0; i < MEMORY_CAP; i++) remember(p, rec({ tick: i, salience: 0.5 }));
    // insert one more low-salience memory that would itself be the minimum;
    // it must survive (it's index 0), and some existing 0.5-salience entry
    // is evicted instead.
    remember(p, rec({ tick: 999, salience: 0.01, otherId: 777 }));
    expect(p.memory).toHaveLength(MEMORY_CAP);
    expect(p.memory[0]?.otherId).toBe(777); // the new memory is never evicted by its own insertion
  });

  it('breaks eviction ties toward the older memory', () => {
    const p = makePerson();
    for (let i = 0; i < MEMORY_CAP; i++) {
      remember(p, rec({ tick: i, salience: i === 3 || i === 10 ? 0.1 : 0.9, otherId: i }));
    }
    // two entries tie at salience 0.1: original insertion order made tick=3
    // older than tick=10 (tick=3 was pushed first, so after all unshifts it
    // sits at a higher array index than tick=10).
    remember(p, rec({ tick: 999, salience: 0.5, otherId: 998 }));
    const survivorIds = p.memory.map((m) => m.otherId);
    expect(survivorIds).toContain(10); // the newer of the tied pair survives
    expect(survivorIds).not.toContain(3); // the older of the tied pair is evicted
  });
});

describe('fadeMemories', () => {
  it('multiplies every salience by FADE_RATE', () => {
    const p = makePerson();
    remember(p, rec({ salience: 0.5 }));
    fadeMemories(p);
    expect(p.memory[0]?.salience).toBeCloseTo(0.5 * FADE_RATE, 6);
  });

  it('drops memories whose salience falls below FADE_MIN', () => {
    const p = makePerson();
    remember(p, rec({ salience: FADE_MIN / FADE_RATE + 0.0001 })); // survives one fade
    remember(p, rec({ salience: FADE_MIN * 0.99, otherId: 2 })); // already effectively below after *FADE_RATE
    fadeMemories(p);
    const ids = p.memory.map((m) => m.otherId);
    expect(ids).toContain(1);
    expect(ids).not.toContain(2);
  });

  it('preserves order among survivors', () => {
    const p = makePerson();
    remember(p, rec({ tick: 1, otherId: 1, salience: 0.9 }));
    remember(p, rec({ tick: 2, otherId: 2, salience: 0.8 }));
    remember(p, rec({ tick: 3, otherId: 3, salience: 0.7 }));
    fadeMemories(p);
    expect(p.memory.map((m) => m.otherId)).toEqual([3, 2, 1]);
  });
});

describe('memoryBias', () => {
  it('sums valence*salience for memories about the given person', () => {
    const p = makePerson();
    remember(p, rec({ otherId: 5, valence: 0.5, salience: 0.5 }));
    remember(p, rec({ otherId: 5, valence: -0.2, salience: 0.5 }));
    remember(p, rec({ otherId: 9, valence: 1, salience: 1 })); // different person, ignored
    expect(memoryBias(p, 5)).toBeCloseTo(0.5 * 0.5 + -0.2 * 0.5, 6);
  });

  it('is 0 for a person with no memories', () => {
    const p = makePerson();
    expect(memoryBias(p, 42)).toBe(0);
  });

  it('clamps to [-1, 1]', () => {
    const p = makePerson();
    for (let i = 0; i < 10; i++) remember(p, rec({ otherId: 5, valence: 1, salience: 1 }));
    expect(memoryBias(p, 5)).toBe(1);
    const q = makePerson();
    for (let i = 0; i < 10; i++) remember(q, rec({ otherId: 5, valence: -1, salience: 1 }));
    expect(memoryBias(q, 5)).toBe(-1);
  });
});
