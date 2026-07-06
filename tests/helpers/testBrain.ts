import type { Outcome } from '../../src/engine/agents/execute';
import type { Perception } from '../../src/engine/agents/perception';
import type { Rng } from '../../src/engine/rng';
import type {
  ActionKind,
  Emotions,
  Lineage,
  Person,
  ScoredAction,
} from '../../src/shared/types';

/**
 * Structural mirror of the Task 20 `Temperament` contract — brains/types.ts
 * does not exist yet when this helper is created (Task 19). Field-for-field
 * identical to the contract, so once Task 20 lands, TestTemperament and
 * Temperament are mutually assignable.
 */
export interface TestTemperament {
  emotionVolatility: Emotions;
  emotionDecayPerTick: Emotions;
  moralWeight: number;
  learningRate: number;
  imitationRate: number;
  desperationThreshold: number;
  taboos: ActionKind[];
  quirks: string[];
  description: string;
}

/** Structural mirror of the Task 20 `Brain` contract. */
export interface TestBrain {
  readonly lineage: Lineage;
  temperament(): TestTemperament;
  init(person: Person, rng: Rng): unknown;
  decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[];
  onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void;
}

/**
 * The neutral test brain (contract, Task 19): scores every candidate 1.0,
 * neutral temperament, `{}` state, learns nothing. Every test that needs a
 * brain before the real ones exist (Tasks 21-24) uses this.
 */
export function makeTestBrain(lineage: Lineage = 'fable'): TestBrain {
  return {
    lineage,
    temperament: (): TestTemperament => ({
      emotionVolatility: { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 },
      emotionDecayPerTick: { fear: 0.01, joy: 0.01, grief: 0.01, anger: 0.01, hope: 0.01 },
      moralWeight: 1,
      learningRate: 0.5,
      imitationRate: 0.1,
      desperationThreshold: 0.95,
      taboos: [],
      quirks: [],
      description: 'Neutral test brain: scores every legal candidate 1.0 and never learns.',
    }),
    init: (_person: Person, _rng: Rng): unknown => ({}),
    decide: (perception: Perception, _brainState: unknown, _rng: Rng): ScoredAction[] =>
      perception.candidates.map((action) => ({ action, score: 1 })),
    onOutcome: (_outcome: Outcome, _brainState: unknown, _rng: Rng): void => {
      // The test brain never learns.
    },
  };
}
