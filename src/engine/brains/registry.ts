import type { Lineage } from '../../shared/types';
import type { Brain } from './types';
import { opusBrain } from './opus';
import { sonnetBrain } from './sonnet';
import { haikuBrain } from './haiku';
import { fableBrain } from './fable';

const REGISTRY: Record<Lineage, Brain> = {
  opus: opusBrain,
  sonnet: sonnetBrain,
  haiku: haikuBrain,
  fable: fableBrain,
};

/** Returns the Brain implementation for a lineage. */
export function getBrain(lineage: Lineage): Brain {
  return REGISTRY[lineage];
}

/** Returns all four brains in LINEAGES order (opus, sonnet, haiku, fable). */
export function allBrains(): Brain[] {
  return [REGISTRY.opus, REGISTRY.sonnet, REGISTRY.haiku, REGISTRY.fable];
}
