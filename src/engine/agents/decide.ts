import { SOFTMAX_TEMP, type Action, type Person, type ScoredAction } from '../../shared/types';
import type { Rng } from '../rng';
import { moralGate } from './morality';
import type { Perception } from './perception';

/**
 * The temperament shape moralGate (Task 11) accepts — extracted from the
 * function itself so this file stays correct whichever structural subset of
 * the Task 20 Temperament morality.ts declared. The full Task 20 Temperament
 * is assignable to it.
 */
export type GateTemperament = Parameters<typeof moralGate>[2];

/**
 * Structural subset of the Task 20 Brain contract — the only two
 * capabilities the decision pipeline needs (deviation 3). Every real Brain
 * (opus/sonnet/haiku/fable and the test brain) is assignable, so Task 33
 * passes getBrain(p.lineage) directly.
 */
export interface BrainLike {
  temperament(): GateTemperament;
  decide(perception: Perception, brainState: unknown, rng: Rng): ScoredAction[];
}

/**
 * Stable identity for an Action so brain output can be matched against the
 * legal candidate list even when the brain built new action objects.
 */
function actionKey(a: Action): string {
  const target = a.targetPersonId ?? 'none';
  const tile = a.tile ? `${a.tile.x},${a.tile.y}` : 'none';
  const structure = a.structure ?? 'none';
  return `${a.kind}|${target}|${tile}|${structure}`;
}

/**
 * The 3-step decision pipeline (contract):
 *  1. scored = brain.decide(perception, p.brainState, rng); keep only
 *     entries whose action is one of perception.candidates (structural
 *     match) with a finite score >= 0, deduplicated (first occurrence wins);
 *     nothing left -> { kind: 'rest' }.
 *  2. eff = score * p.actionWeights[kind] * moralGate(p, action,
 *     brain.temperament()). Entries with eff <= 0 (e.g. moral veto) are
 *     dropped entirely so they end at exactly zero probability; all dropped
 *     -> { kind: 'rest' }.
 *  3. One rng.next() samples softmax at temperature SOFTMAX_TEMP over
 *     eff / max(eff). Max-normalization bounds the exponent (raw scores are
 *     unbounded above) and makes the sampling scale-invariant.
 */
export function chooseAction(p: Person, perception: Perception, brain: BrainLike, rng: Rng): Action {
  // Step 1 — score and validate.
  const candidateKeys = new Set<string>();
  for (const c of perception.candidates) candidateKeys.add(actionKey(c));

  const scored = brain.decide(perception, p.brainState, rng);
  const seen = new Set<string>();
  const valid: ScoredAction[] = [];
  for (const s of scored) {
    if (!s || !s.action) continue;
    if (typeof s.score !== 'number' || !Number.isFinite(s.score) || s.score < 0) continue;
    const key = actionKey(s.action);
    if (!candidateKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    valid.push(s);
  }
  if (valid.length === 0) return { kind: 'rest' };

  // Step 2 — effective desirability: learned weight and moral gate.
  const temperament = brain.temperament();
  const actions: Action[] = [];
  const effs: number[] = [];
  let maxEff = 0;
  for (const s of valid) {
    const eff = s.score * p.actionWeights[s.action.kind] * moralGate(p, s.action, temperament);
    if (eff > 0) {
      actions.push(s.action);
      effs.push(eff);
      if (eff > maxEff) maxEff = eff;
    }
  }
  if (actions.length === 0) return { kind: 'rest' };

  // Step 3 — softmax sample at SOFTMAX_TEMP over max-normalized eff.
  let total = 0;
  const cumulative: number[] = [];
  for (const eff of effs) {
    total += Math.exp(eff / maxEff / SOFTMAX_TEMP);
    cumulative.push(total);
  }
  const roll = rng.next() * total;
  for (let i = 0; i < cumulative.length; i++) {
    if (roll < (cumulative[i] as number)) return actions[i] as Action;
  }
  return actions[actions.length - 1] as Action; // roll landed on the upper edge
}
