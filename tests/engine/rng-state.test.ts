import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/engine/rng';

describe('Rng.getState / setState', () => {
  it('setState followed by continued draws matches a fresh rng seeded to that state', () => {
    const a = createRng(123);
    for (let i = 0; i < 50; i++) a.next();
    const state = a.getState();

    const b = createRng(999); // arbitrary different seed
    b.setState(state);

    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqB).toEqual(seqA);
  });

  it('setState does not change what split(label) derives (split is a function of the creation seed, not draw position)', () => {
    const a = createRng(42);
    const childBefore = a.split('x').next();

    const b = createRng(42);
    for (let i = 0; i < 30; i++) b.next(); // advance b's internal state
    const childAfterAdvancing = b.split('x').next();

    expect(childAfterAdvancing).toBe(childBefore);
  });
});
