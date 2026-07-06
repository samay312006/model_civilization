import type { Action, ActionKind, Emotions, Lineage, Person, ScoredAction } from '../../shared/types';
import type { Rng } from '../rng';
import type { Outcome } from '../agents/execute';
import type { Perception } from '../agents/perception';

/**
 * Lineage-specific tuning returned by Brain.temperament(). Must be constant
 * across calls (the same lineage always returns the same Temperament by
 * value) and must satisfy the documented ranges:
 *   emotionVolatility: each field 0.25..4 (multiplier on emotion impulses)
 *   emotionDecayPerTick: each field 0..0.2 (decay toward baseline per tick)
 *   moralWeight: 0..2
 *   learningRate: 0..1
 *   imitationRate: 0..1
 *   desperationThreshold: 0..1 (1 = morality never breaks under desperation)
 */
export interface Temperament {
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

/**
 * A Brain is a pure decision policy: it reads a Perception and a per-agent
 * brainState and returns scored candidate actions. Brains may not touch the
 * network, the DOM, or any global mutable state, and may hold no state of
 * their own beyond the JSON-serializable brainState object threaded through
 * init/decide/onOutcome by the caller.
 */
export interface Brain {
  readonly lineage: Lineage;
  /** Must be constant per lineage: repeated calls return equal values. */
  temperament(): Temperament;
  /** Returns a fresh JSON-serializable plain object: the agent's initial brainState. */
  init(person: Person, rng: Rng): unknown;
  /** Returns scored actions; only those present in perception.candidates with finite score >= 0 are used. */
  decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[];
  /** May mutate brainState only; must never throw. */
  onOutcome(outcome: Outcome, brainState: unknown, rng: Rng): void;
}

// Re-exported for brief authors who only import from this file.
export type { Action, ActionKind, Outcome, Perception, ScoredAction };
