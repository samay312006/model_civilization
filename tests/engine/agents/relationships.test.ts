import { describe, expect, it } from 'vitest';
import { adjustRelationship, affinityTo, isKin } from '../../../src/engine/agents/relationships';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import { RELATIONSHIP_CAP, type Person } from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function makePerson(): Person {
  const p = createPerson(1, 0, 'fable', { x: 0, y: 0 }, names, createRng(1));
  p.relationships = [];
  return p;
}

describe('adjustRelationship', () => {
  it('creates a new relationship when none exists', () => {
    const p = makePerson();
    adjustRelationship(p, 5, 'friend', 0.3);
    expect(p.relationships).toEqual([{ otherId: 5, kind: 'friend', affinity: 0.3 }]);
  });

  it('adjusts affinity and overwrites kind on an existing relationship', () => {
    const p = makePerson();
    adjustRelationship(p, 5, 'friend', 0.3);
    adjustRelationship(p, 5, 'rival', -0.5);
    expect(p.relationships).toHaveLength(1);
    expect(p.relationships[0]?.kind).toBe('rival');
    expect(p.relationships[0]?.affinity).toBeCloseTo(-0.2, 6);
  });

  it('clamps affinity to [-1, 1]', () => {
    const p = makePerson();
    adjustRelationship(p, 5, 'friend', 0.9);
    adjustRelationship(p, 5, 'friend', 0.9);
    expect(p.relationships[0]?.affinity).toBe(1);
    adjustRelationship(p, 5, 'rival', -3);
    expect(p.relationships[0]?.affinity).toBe(-1);
  });

  it('evicts the least-invested relationship (lowest |affinity|) when the cap is reached', () => {
    const p = makePerson();
    for (let i = 0; i < RELATIONSHIP_CAP; i++) {
      adjustRelationship(p, i, 'friend', i === 3 ? 0.01 : 0.5); // id 3 is least invested
    }
    expect(p.relationships).toHaveLength(RELATIONSHIP_CAP);
    adjustRelationship(p, 999, 'friend', 0.4);
    expect(p.relationships).toHaveLength(RELATIONSHIP_CAP);
    expect(p.relationships.some((r) => r.otherId === 3)).toBe(false);
    expect(p.relationships.some((r) => r.otherId === 999)).toBe(true);
  });

  it('breaks eviction ties toward the earliest-created relationship', () => {
    const p = makePerson();
    for (let i = 0; i < RELATIONSHIP_CAP; i++) {
      adjustRelationship(p, i, 'friend', i === 2 || i === 7 ? 0.1 : 0.5);
    }
    adjustRelationship(p, 999, 'friend', 0.4);
    // id 2 was created before id 7; the tie-break evicts the earliest.
    expect(p.relationships.some((r) => r.otherId === 2)).toBe(false);
    expect(p.relationships.some((r) => r.otherId === 7)).toBe(true);
  });
});

describe('affinityTo', () => {
  it('returns the matching affinity', () => {
    const p = makePerson();
    adjustRelationship(p, 5, 'friend', 0.4);
    expect(affinityTo(p, 5)).toBeCloseTo(0.4, 6);
  });

  it('returns 0 when no relationship exists', () => {
    const p = makePerson();
    expect(affinityTo(p, 42)).toBe(0);
  });
});

describe('isKin', () => {
  it('is true only for kind kin', () => {
    const p = makePerson();
    adjustRelationship(p, 5, 'kin', 0.5);
    adjustRelationship(p, 6, 'friend', 0.5);
    expect(isKin(p, 5)).toBe(true);
    expect(isKin(p, 6)).toBe(false);
    expect(isKin(p, 999)).toBe(false);
  });
});
