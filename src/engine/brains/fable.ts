import type { Brain, Outcome, Perception } from './types';
import type { Person, ScoredAction } from '../../shared/types';
import type { Rng } from '../rng';

// placeholder — replaced by model authoring in Task 21-24
export const fableBrain: Brain = {
  lineage: 'fable',
  temperament: () => ({
    emotionVolatility: { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 },
    emotionDecayPerTick: { fear: 0.02, joy: 0.02, grief: 0.02, anger: 0.02, hope: 0.02 },
    moralWeight: 1,
    learningRate: 0.5,
    imitationRate: 0.1,
    desperationThreshold: 0.9,
    taboos: [],
    quirks: [],
    description: 'placeholder — replaced by model authoring in Task 21-24',
  }),
  init: (_person: Person, _rng: Rng): unknown => ({}),
  decide: (perception: Perception, _brainState: unknown, _rng: Rng): ScoredAction[] =>
    perception.candidates.map((action) => ({ action, score: 1.0 })),
  onOutcome: (_outcome: Outcome, _brainState: unknown, _rng: Rng): void => {
    // placeholder — replaced by model authoring in Task 21-24
  },
};
