import { clamp01, type Emotions, type Person, type Traits } from '../../shared/types';

export const DOMINANT_EMOTION_THRESHOLD = 0.45;

/** Trait-derived resting emotion state, exported for UI "resting" displays. */
export function emotionBaseline(traits: Traits): Emotions {
  return {
    fear: clamp01(0.5 - 0.4 * traits.riskTolerance),
    joy: clamp01(0.2 + 0.2 * traits.empathy),
    grief: 0.05,
    anger: clamp01(0.15 * traits.aggression),
    hope: clamp01(0.15 + 0.25 * traits.curiosity),
  };
}

/**
 * Contract signature verbatim: p.emotions[k] += impulse[k] * volatility[k]
 * for every key present in impulse, clamped to [0, 1]. Keys absent from
 * impulse are untouched.
 */
export function applyEmotionImpulse(p: Person, impulse: Partial<Emotions>, volatility: Emotions): void {
  for (const key of Object.keys(impulse) as (keyof Emotions)[]) {
    const delta = impulse[key];
    if (delta === undefined) continue;
    p.emotions[key] = clamp01(p.emotions[key] + delta * volatility[key]);
  }
}

/**
 * Contract signature verbatim: every component moves toward its
 * trait-derived baseline by at most decayPerTick[k] per call (never
 * overshoots the baseline).
 */
export function decayEmotions(p: Person, decayPerTick: Emotions): void {
  const baseline = emotionBaseline(p.traits);
  const keys: (keyof Emotions)[] = ['fear', 'joy', 'grief', 'anger', 'hope'];
  for (const key of keys) {
    const gap = baseline[key] - p.emotions[key];
    const step = Math.sign(gap) * Math.min(decayPerTick[key], Math.abs(gap));
    p.emotions[key] = clamp01(p.emotions[key] + step);
  }
}

/**
 * Contract signature verbatim: the max of fear/anger/joy/grief (in that
 * fixed tie-break order) if it exceeds DOMINANT_EMOTION_THRESHOLD, else
 * 'calm'. hope never drives this label.
 */
export function dominantEmotion(p: Person): 'calm' | 'afraid' | 'angry' | 'joyful' | 'grieving' {
  const ordered: { value: number; label: 'afraid' | 'angry' | 'joyful' | 'grieving' }[] = [
    { value: p.emotions.fear, label: 'afraid' },
    { value: p.emotions.anger, label: 'angry' },
    { value: p.emotions.joy, label: 'joyful' },
    { value: p.emotions.grief, label: 'grieving' },
  ];
  let best = ordered[0] as { value: number; label: 'afraid' | 'angry' | 'joyful' | 'grieving' };
  for (const entry of ordered) {
    if (entry.value > best.value) best = entry;
  }
  return best.value > DOMINANT_EMOTION_THRESHOLD ? best.label : 'calm';
}
