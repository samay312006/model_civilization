import { describe, expect, it } from 'vitest';
import {
  DOMINANT_EMOTION_THRESHOLD,
  applyEmotionImpulse,
  decayEmotions,
  dominantEmotion,
  emotionBaseline,
} from '../../../src/engine/agents/emotions';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import type { Emotions, Person, Traits } from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function makePerson(): Person {
  const p = createPerson(1, 0, 'fable', { x: 0, y: 0 }, names, createRng(1));
  p.emotions = { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 };
  return p;
}

const NEUTRAL_VOLATILITY: Emotions = { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 };

describe('applyEmotionImpulse', () => {
  it('adds impulse*volatility to only the given keys', () => {
    const p = makePerson();
    applyEmotionImpulse(p, { fear: 0.3, anger: 0.2 }, NEUTRAL_VOLATILITY);
    expect(p.emotions.fear).toBeCloseTo(0.3, 6);
    expect(p.emotions.anger).toBeCloseTo(0.2, 6);
    expect(p.emotions.joy).toBe(0);
    expect(p.emotions.grief).toBe(0);
    expect(p.emotions.hope).toBe(0);
  });

  it('scales the impulse by volatility', () => {
    const p = makePerson();
    applyEmotionImpulse(p, { fear: 0.3 }, { ...NEUTRAL_VOLATILITY, fear: 2 });
    expect(p.emotions.fear).toBeCloseTo(0.6, 6);
  });

  it('clamps to [0, 1]', () => {
    const p = makePerson();
    p.emotions.joy = 0.9;
    applyEmotionImpulse(p, { joy: 0.5 }, NEUTRAL_VOLATILITY);
    expect(p.emotions.joy).toBe(1);
    p.emotions.grief = 0.1;
    applyEmotionImpulse(p, { grief: -0.5 }, NEUTRAL_VOLATILITY);
    expect(p.emotions.grief).toBe(0);
  });
});

describe('emotionBaseline', () => {
  it('derives baselines from traits', () => {
    const traits: Traits = { curiosity: 1, aggression: 0, empathy: 1, industriousness: 0.5, riskTolerance: 1 };
    const baseline = emotionBaseline(traits);
    expect(baseline.fear).toBeCloseTo(0.1, 6); // 0.5 - 0.4*1
    expect(baseline.joy).toBeCloseTo(0.4, 6); // 0.2 + 0.2*1
    expect(baseline.grief).toBeCloseTo(0.05, 6);
    expect(baseline.anger).toBeCloseTo(0, 6); // 0.15*0
    expect(baseline.hope).toBeCloseTo(0.4, 6); // 0.15 + 0.25*1
  });
});

describe('decayEmotions', () => {
  it('moves each component toward its baseline by at most decayPerTick', () => {
    const p = makePerson();
    p.traits = { curiosity: 0, aggression: 0, empathy: 0, industriousness: 0.5, riskTolerance: 0 };
    // baseline: fear 0.5, joy 0.2, grief 0.05, anger 0, hope 0.15
    p.emotions = { fear: 0, joy: 1, grief: 0.5, anger: 0.3, hope: 0.15 };
    decayEmotions(p, { fear: 0.1, joy: 0.1, grief: 0.1, anger: 0.1, hope: 0.1 });
    expect(p.emotions.fear).toBeCloseTo(0.1, 6); // moves up toward 0.5
    expect(p.emotions.joy).toBeCloseTo(0.9, 6); // moves down toward 0.2
    expect(p.emotions.grief).toBeCloseTo(0.4, 6); // moves down toward 0.05
    expect(p.emotions.anger).toBeCloseTo(0.2, 6); // moves down toward 0
    expect(p.emotions.hope).toBeCloseTo(0.15, 6); // already at baseline
  });

  it('never overshoots the baseline', () => {
    const p = makePerson();
    p.traits = { curiosity: 0, aggression: 0, empathy: 0, industriousness: 0.5, riskTolerance: 0 };
    p.emotions = { fear: 0.48, joy: 0, grief: 0, anger: 0, hope: 0 };
    decayEmotions(p, { fear: 0.5, joy: 0.5, grief: 0.5, anger: 0.5, hope: 0.5 });
    expect(p.emotions.fear).toBeCloseTo(0.5, 6); // baseline, not 0.98
  });
});

describe('dominantEmotion', () => {
  it('is calm below the threshold', () => {
    const p = makePerson();
    p.emotions = { fear: 0.4, joy: 0.4, grief: 0.4, anger: 0.4, hope: 0.9 };
    expect(dominantEmotion(p)).toBe('calm');
  });

  it('picks the max of fear/anger/joy/grief above the threshold', () => {
    const p = makePerson();
    p.emotions = { fear: 0.1, joy: 0.1, grief: 0.1, anger: 0.6, hope: 0 };
    expect(dominantEmotion(p)).toBe('angry');
  });

  it('ignores hope entirely', () => {
    const p = makePerson();
    p.emotions = { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0.99 };
    expect(dominantEmotion(p)).toBe('calm');
  });

  it('breaks ties in fixed order: fear, anger, joy, grief', () => {
    const p = makePerson();
    p.emotions = { fear: 0.6, joy: 0.6, grief: 0.6, anger: 0.6, hope: 0 };
    expect(dominantEmotion(p)).toBe('afraid');
    p.emotions = { fear: 0, joy: 0.6, grief: 0.6, anger: 0.6, hope: 0 };
    expect(dominantEmotion(p)).toBe('angry');
    p.emotions = { fear: 0, joy: 0.6, grief: 0.6, anger: 0, hope: 0 };
    expect(dominantEmotion(p)).toBe('joyful');
    p.emotions = { fear: 0, joy: 0, grief: 0.6, anger: 0, hope: 0 };
    expect(dominantEmotion(p)).toBe('grieving');
  });

  it('uses exactly the DOMINANT_EMOTION_THRESHOLD boundary (exclusive)', () => {
    const p = makePerson();
    p.emotions = { fear: DOMINANT_EMOTION_THRESHOLD, joy: 0, grief: 0, anger: 0, hope: 0 };
    expect(dominantEmotion(p)).toBe('calm'); // exactly at threshold does not count
    p.emotions.fear = DOMINANT_EMOTION_THRESHOLD + 0.001;
    expect(dominantEmotion(p)).toBe('afraid');
  });
});
