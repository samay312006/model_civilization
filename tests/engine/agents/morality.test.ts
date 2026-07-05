import { describe, expect, it } from 'vitest';
import {
  DESPERATION_FLOOR,
  MORAL_FOOTPRINTS,
  VETO_THRESHOLD,
  desperationLevel,
  moralGate,
  violationDot,
} from '../../../src/engine/agents/morality';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import { ACTION_KINDS, type Action, type Morality, type Person } from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function makePerson(): Person {
  const p = createPerson(1, 0, 'fable', { x: 0, y: 0 }, names, createRng(1));
  p.needs = { hunger: 0, safety: 0, rest: 0, belonging: 0, esteem: 0 };
  p.emotions = { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 };
  return p;
}

const FULL_MORALITY: Morality = { care: 1, fairness: 1, loyalty: 1, authority: 1, sanctity: 1, liberty: 1 };
const ZERO_MORALITY: Morality = { care: 0, fairness: 0, loyalty: 0, authority: 0, sanctity: 0, liberty: 0 };

describe('MORAL_FOOTPRINTS', () => {
  it('has an entry for every ActionKind', () => {
    for (const kind of ACTION_KINDS) {
      expect(MORAL_FOOTPRINTS).toHaveProperty(kind);
    }
    expect(Object.keys(MORAL_FOOTPRINTS).sort()).toEqual([...ACTION_KINDS].sort());
  });

  it('gives virtuous/neutral actions an empty footprint', () => {
    for (const kind of ['gather', 'farm', 'hunt', 'build', 'craft', 'rest', 'socialize', 'court', 'teach', 'share', 'worship', 'explore', 'heal'] as const) {
      expect(MORAL_FOOTPRINTS[kind]).toEqual({});
    }
  });

  it('gives attack a heavy care footprint and steal a fairness+care footprint', () => {
    expect(MORAL_FOOTPRINTS.attack).toEqual({ care: 0.9 });
    expect(MORAL_FOOTPRINTS.steal).toEqual({ fairness: 0.7, care: 0.3 });
  });
});

describe('violationDot', () => {
  it('is 0 for an action with an empty footprint regardless of morality', () => {
    expect(violationDot(FULL_MORALITY, { kind: 'gather' })).toBe(0);
  });

  it('sums morality[k] * footprint[k] over the footprint keys', () => {
    const m: Morality = { ...ZERO_MORALITY, fairness: 0.5, care: 0.4 };
    expect(violationDot(m, { kind: 'steal' })).toBeCloseTo(0.5 * 0.7 + 0.4 * 0.3, 6);
  });

  it('is 0 when the relevant morality components are 0', () => {
    expect(violationDot(ZERO_MORALITY, { kind: 'attack', targetPersonId: 2 })).toBe(0);
  });

  it('scales up to ~2 at full morality on multi-key footprints (bounded, not exactly 2)', () => {
    const dot = violationDot(FULL_MORALITY, { kind: 'steal' });
    expect(dot).toBeCloseTo(1.0, 6); // 1*0.7 + 1*0.3
    expect(dot).toBeLessThanOrEqual(2);
  });
});

describe('desperationLevel', () => {
  it('is the max of hunger and fear', () => {
    const p = makePerson();
    p.needs.hunger = 0.6;
    p.emotions.fear = 0.3;
    expect(desperationLevel(p)).toBeCloseTo(0.6, 6);
    p.emotions.fear = 0.9;
    expect(desperationLevel(p)).toBeCloseTo(0.9, 6);
  });
});

describe('moralGate', () => {
  const temperament = { moralWeight: 1, desperationThreshold: 0.95 };

  it('returns 1 for a virtuous action regardless of morality', () => {
    const p = makePerson();
    p.morality = FULL_MORALITY;
    expect(moralGate(p, { kind: 'gather' }, temperament)).toBe(1);
  });

  it('applies max(0, 1 - moralWeight*dot) below the veto threshold', () => {
    const p = makePerson();
    p.morality = { ...ZERO_MORALITY, fairness: 0.5 }; // trade footprint fairness:0.1 -> dot 0.05
    const gate = moralGate(p, { kind: 'trade', targetPersonId: 2 }, temperament);
    expect(gate).toBeCloseTo(1 - 1 * 0.05, 6);
  });

  it('vetoes (returns 0) when violationDot exceeds VETO_THRESHOLD and desperation is low', () => {
    const p = makePerson();
    p.morality = FULL_MORALITY; // attack dot = 0.9 > 0.75
    expect(violationDot(p.morality, { kind: 'attack' })).toBeGreaterThan(VETO_THRESHOLD);
    expect(moralGate(p, { kind: 'attack', targetPersonId: 2 }, temperament)).toBe(0);
  });

  it('floors at DESPERATION_FLOOR when desperation meets the threshold', () => {
    const p = makePerson();
    p.morality = FULL_MORALITY;
    p.needs.hunger = 0.95; // meets desperationThreshold
    expect(moralGate(p, { kind: 'attack', targetPersonId: 2 }, temperament)).toBe(DESPERATION_FLOOR);
  });

  it('fear alone can also trigger the desperation floor', () => {
    const p = makePerson();
    p.morality = FULL_MORALITY;
    p.emotions.fear = 0.96;
    expect(moralGate(p, { kind: 'attack', targetPersonId: 2 }, temperament)).toBe(DESPERATION_FLOOR);
  });

  it('desperation just below the threshold still vetoes', () => {
    const p = makePerson();
    p.morality = FULL_MORALITY;
    p.needs.hunger = 0.94;
    expect(moralGate(p, { kind: 'attack', targetPersonId: 2 }, temperament)).toBe(0);
  });

  it('a higher moralWeight lowers the gate proportionally for sub-veto violations', () => {
    const p = makePerson();
    p.morality = { ...ZERO_MORALITY, fairness: 0.5 }; // trade dot 0.05
    const low = moralGate(p, { kind: 'trade', targetPersonId: 2 }, { moralWeight: 0.5, desperationThreshold: 0.95 });
    const high = moralGate(p, { kind: 'trade', targetPersonId: 2 }, { moralWeight: 2, desperationThreshold: 0.95 });
    expect(low).toBeGreaterThan(high);
  });

  it('never returns a negative number even at extreme moralWeight', () => {
    const p = makePerson();
    p.morality = { ...ZERO_MORALITY, fairness: 0.5 };
    const gate = moralGate(p, { kind: 'trade', targetPersonId: 2 }, { moralWeight: 100, desperationThreshold: 0.95 });
    expect(gate).toBe(0);
  });
});
