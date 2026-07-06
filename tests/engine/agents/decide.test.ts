import { describe, expect, it } from 'vitest';
import { chooseAction, type BrainLike } from '../../../src/engine/agents/decide';
import { createPerson } from '../../../src/engine/agents/person';
import type { Perception } from '../../../src/engine/agents/perception';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import {
  ACTION_KINDS,
  type Action,
  type Person,
  type ScoredAction,
} from '../../../src/shared/types';
import { makeTestBrain } from '../../helpers/testBrain';

const names = makeNameGenerator(createRng(9));

function makePerson(id: number): Person {
  const p = createPerson(id, 0, 'fable', { x: 5, y: 5 }, names, createRng(1000 + id));
  p.alive = true;
  p.needs.hunger = 0;
  p.emotions = { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 };
  for (const k of ACTION_KINDS) p.actionWeights[k] = 1;
  return p;
}

function makePerception(p: Person, candidates: Action[]): Perception {
  return {
    tick: 0,
    self: p,
    candidates,
    nearbyPeople: [],
    nearbyTiles: [],
    settlement: null,
    nearbySettlements: [],
    civ: { id: 0, population: 1, atWarWith: [], techs: [], season: 'spring', foodPerCapita: 1 },
    dangers: [],
  };
}

/** A BrainLike with the neutral temperament and a custom decide. */
function stubBrain(decideFn: (perception: Perception) => ScoredAction[]): BrainLike {
  const base = makeTestBrain();
  return {
    temperament: () => base.temperament(),
    decide: (perception, _brainState, _rng) => decideFn(perception),
  };
}

const GATHER: Action = { kind: 'gather' };
const REST: Action = { kind: 'rest' };
const FARM: Action = { kind: 'farm' };
const SOCIALIZE: Action = { kind: 'socialize' };

describe('makeTestBrain', () => {
  it('scores every candidate 1.0 with a neutral temperament and {} state', () => {
    const brain = makeTestBrain();
    const p = makePerson(1);
    const scored = brain.decide(makePerception(p, [GATHER, REST, FARM]), {}, createRng(1));
    expect(scored).toHaveLength(3);
    for (const s of scored) expect(s.score).toBe(1);
    expect(brain.lineage).toBe('fable');
    expect(makeTestBrain('opus').lineage).toBe('opus');
    expect(brain.init(p, createRng(1))).toEqual({});
    const t = brain.temperament();
    expect(t.moralWeight).toBe(1);
    expect(t.desperationThreshold).toBe(0.95);
    expect(t.taboos).toEqual([]);
  });
});

describe('chooseAction', () => {
  it('falls back to rest when the brain returns nothing', () => {
    const p = makePerson(1);
    const perc = makePerception(p, [GATHER, REST]);
    expect(chooseAction(p, perc, stubBrain(() => []), createRng(1))).toEqual({ kind: 'rest' });
  });

  it('falls back to rest when every score is invalid (NaN, negative, Infinity)', () => {
    const p = makePerson(1);
    const perc = makePerception(p, [GATHER, REST]);
    const bad = stubBrain(() => [
      { action: GATHER, score: Number.NaN },
      { action: REST, score: -1 },
      { action: GATHER, score: Number.POSITIVE_INFINITY },
    ]);
    expect(chooseAction(p, perc, bad, createRng(1))).toEqual({ kind: 'rest' });
  });

  it('filters actions that are not in the candidate list', () => {
    const p = makePerson(1);

    // only invalid entries -> rest fallback
    const rogue = stubBrain(() => [{ action: { kind: 'steal', targetPersonId: 7 }, score: 100 }]);
    expect(chooseAction(p, makePerception(p, [GATHER]), rogue, createRng(1))).toEqual({ kind: 'rest' });

    // the non-candidate entry is dropped even at a huge score; the valid one always wins
    const mixed = stubBrain(() => [
      { action: { kind: 'attack', targetPersonId: 9 }, score: 100 },
      { action: GATHER, score: 1 },
    ]);
    for (let i = 0; i < 50; i++) {
      expect(chooseAction(p, makePerception(p, [GATHER, REST]), mixed, createRng(i))).toEqual(GATHER);
    }
  });

  it('falls back to rest on an empty candidate list even with a generous brain', () => {
    const p = makePerson(1);
    expect(chooseAction(p, makePerception(p, []), makeTestBrain(), createRng(1))).toEqual({ kind: 'rest' });
  });

  it('moral veto gives a forbidden action exactly zero probability', () => {
    const p = makePerson(1);
    p.morality = { care: 1, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0.5 };
    // desperation = max(hunger, fear) = 0 < 0.95, so the veto holds:
    // violationDot(attack) = care 1 * 0.9 = 0.9 > 0.75 -> moralGate = 0
    const attack: Action = { kind: 'attack', targetPersonId: 2 };
    const perc = makePerception(p, [attack, GATHER]);
    const rng = createRng(5);
    let attacks = 0;
    for (let i = 0; i < 500; i++) {
      if (chooseAction(p, perc, makeTestBrain(), rng).kind === 'attack') attacks += 1;
    }
    expect(attacks).toBe(0);
  });

  it('learned weights bias selection measurably over 1000 samples', () => {
    const biased = makePerson(1);
    biased.actionWeights.gather = 3;
    const neutral = makePerson(2);
    const brain = makeTestBrain();
    const countGathers = (person: Person, seed: number): number => {
      const rng = createRng(seed);
      let n = 0;
      for (let i = 0; i < 1000; i++) {
        if (chooseAction(person, makePerception(person, [GATHER, REST]), brain, rng).kind === 'gather') {
          n += 1;
        }
      }
      return n;
    };
    const biasedGathers = countGathers(biased, 11);
    const neutralGathers = countGathers(neutral, 11);
    // equal eff -> P(gather) = 0.5 (~500); eff 3 vs 1 -> softmax(1/0.35 vs 0.333/0.35) ~ 0.87 (~870)
    expect(neutralGathers).toBeGreaterThan(380);
    expect(neutralGathers).toBeLessThan(620);
    expect(biasedGathers).toBeGreaterThan(750);
    expect(biasedGathers - neutralGathers).toBeGreaterThan(150);
  });

  it('is deterministic for a given seed', () => {
    const brain = makeTestBrain();
    const run = (): string => {
      const p = makePerson(1);
      p.actionWeights.farm = 2;
      const rng = createRng(777);
      const kinds: string[] = [];
      for (let i = 0; i < 100; i++) {
        kinds.push(chooseAction(p, makePerception(p, [GATHER, REST, FARM, SOCIALIZE]), brain, rng).kind);
      }
      return kinds.join(',');
    };
    expect(run()).toBe(run());
  });
});
