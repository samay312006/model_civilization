import { describe, expect, it } from 'vitest';
import {
  INFLUENCE_DECAY,
  INFLUENCE_RECOMPUTE_INTERVAL,
  computeRawInfluence,
  leaderOf,
  updateInfluence,
} from '../../../src/engine/society/influence';
import { createPerson } from '../../../src/engine/agents/person';
import { makeTestCtx, makeTestSettlement } from '../../helpers/testCtx';
import type { Person } from '../../../src/shared/types';

function makePerson(id: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, 0, 'fable', { x: 10, y: 10 }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  p.influence = 0;
  for (const k of ['farming', 'gathering', 'building', 'crafting', 'fighting', 'healing', 'teaching'] as const) {
    p.skills[k] = 0;
  }
  p.relationships = [];
  p.memory = [];
  return p;
}

describe('computeRawInfluence', () => {
  it('is 0 for a person with no esteem relief, no skills, no affinity, no victories', () => {
    const ctx = makeTestCtx();
    const p = makePerson(1, ctx);
    p.needs.esteem = 1; // max desperation -> 0 relief
    expect(computeRawInfluence(p)).toBe(0);
  });

  it('rewards low esteem need (relief), high skills, positive affinity, and victory memories', () => {
    const ctx = makeTestCtx();
    const p = makePerson(1, ctx);
    p.needs.esteem = 0; // full relief -> 0.3 * 1
    for (const k of ['farming', 'gathering', 'building', 'crafting', 'fighting', 'healing', 'teaching'] as const) {
      p.skills[k] = 1; // avgSkill 1 -> 0.2 * 1
    }
    p.relationships = [{ otherId: 2, kind: 'friend', affinity: 1 }]; // -> 0.3 * 1
    p.memory = [{ tick: 0, kind: 'victory', otherId: 2, valence: 1, salience: 1 }]; // -> 0.2 * 1
    expect(computeRawInfluence(p)).toBeCloseTo(1, 6);
  });

  it('ignores negative affinities in the positive-affinity average', () => {
    const ctx = makeTestCtx();
    const p = makePerson(1, ctx);
    p.needs.esteem = 1; // no relief so we isolate the affinity component
    p.relationships = [
      { otherId: 2, kind: 'rival', affinity: -1 },
      { otherId: 3, kind: 'friend', affinity: 0.6 },
    ];
    // Only the +0.6 relationship counts; average of positives = 0.6 -> 0.3*0.6 = 0.18
    expect(computeRawInfluence(p)).toBeCloseTo(0.18, 6);
  });
});

describe('updateInfluence', () => {
  it('recomputes and blends with 0.98 decay every 30 ticks', () => {
    const ctx = makeTestCtx({ tick: INFLUENCE_RECOMPUTE_INTERVAL });
    const p = makePerson(1, ctx);
    p.influence = 0.5;
    p.needs.esteem = 0;
    for (const k of ['farming', 'gathering', 'building', 'crafting', 'fighting', 'healing', 'teaching'] as const) {
      p.skills[k] = 1;
    }
    p.relationships = [{ otherId: 2, kind: 'friend', affinity: 1 }];
    p.memory = [{ tick: 0, kind: 'victory', otherId: 2, valence: 1, salience: 1 }];
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);

    updateInfluence(ctx);

    const raw = computeRawInfluence(p); // 1.0 per the case above
    const expected = 0.5 * INFLUENCE_DECAY + raw * (1 - INFLUENCE_DECAY);
    expect(p.influence).toBeCloseTo(expected, 6);
  });

  it('is a no-op off the 30-tick interval', () => {
    const ctx = makeTestCtx({ tick: INFLUENCE_RECOMPUTE_INTERVAL + 1 });
    const p = makePerson(1, ctx);
    p.influence = 0.42;
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);

    updateInfluence(ctx);

    expect(p.influence).toBe(0.42);
  });

  it('skips dead people', () => {
    const ctx = makeTestCtx({ tick: 0 });
    const p = makePerson(1, ctx);
    p.alive = false;
    p.influence = 0.7;
    ctx.people = [p];
    ctx.personById = new Map([[1, p]]);

    updateInfluence(ctx);

    expect(p.influence).toBe(0.7);
  });
});

describe('leaderOf', () => {
  it('returns the living member with the highest influence', () => {
    const ctx = makeTestCtx();
    const a = makePerson(1, ctx);
    const b = makePerson(2, ctx);
    const c = makePerson(3, ctx);
    a.influence = 0.4;
    b.influence = 0.9;
    c.influence = 0.6;
    ctx.people = [a, b, c];
    ctx.personById = new Map([[1, a], [2, b], [3, c]]);
    const s = makeTestSettlement({ memberIds: [1, 2, 3] });

    expect(leaderOf(s, ctx)?.id).toBe(2);
  });

  it('breaks ties by lowest id', () => {
    const ctx = makeTestCtx();
    const a = makePerson(1, ctx);
    const b = makePerson(2, ctx);
    a.influence = 0.5;
    b.influence = 0.5;
    ctx.people = [a, b];
    ctx.personById = new Map([[1, a], [2, b]]);
    const s = makeTestSettlement({ memberIds: [2, 1] });

    expect(leaderOf(s, ctx)?.id).toBe(1);
  });

  it('excludes dead members and returns null when none remain (no-op boundary)', () => {
    const ctx = makeTestCtx();
    const a = makePerson(1, ctx);
    a.alive = false;
    ctx.people = [a];
    ctx.personById = new Map([[1, a]]);
    const s = makeTestSettlement({ memberIds: [1] });

    expect(leaderOf(s, ctx)).toBeNull();
  });
});
