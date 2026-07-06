import { createPerson } from '../../src/engine/agents/person';
import { makeNameGenerator } from '../../src/engine/names';
import type { Rng } from '../../src/engine/rng';
import type {
  CivGlimpse,
  DangerGlimpse,
  Perception,
  PersonGlimpse,
  SettlementGlimpse,
  TileGlimpse,
} from '../../src/engine/agents/perception';
import {
  ACTION_KINDS,
  type Action,
  type ActionKind,
  type Lineage,
  type Person,
} from '../../src/shared/types';

/** Overrides accepted by makePerceptionFixture; every field optional. */
export interface FixtureOverrides {
  lineage: Lineage;
  hunger: number;
  fear: number;
  numCandidates: number;
  numNearbyPeople: number;
}

const ALL_LINEAGES: Lineage[] = ['opus', 'sonnet', 'haiku', 'fable'];

/**
 * Deterministic tiny-world Person + Perception builder for brain tests.
 * Does not depend on World/SpatialIndex/Settlement machinery — it hand-rolls
 * a flat plains neighborhood and a handful of candidate actions so brain
 * conformance tests stay fast and self-contained.
 */
export function makePerceptionFixture(
  rng: Rng,
  overrides: Partial<FixtureOverrides> = {},
): { person: Person; perception: Perception } {
  const names = makeNameGenerator(rng.split('fixture-names'));
  const lineage = overrides.lineage ?? ALL_LINEAGES[rng.int(ALL_LINEAGES.length)] as Lineage;
  const person = createPerson(1, 0, lineage, { x: 10, y: 10 }, names, rng.split('fixture-person'));

  const hunger = overrides.hunger ?? rng.next();
  const fear = overrides.fear ?? rng.next();
  person.needs.hunger = hunger;
  person.emotions.fear = fear;

  const numCandidates = overrides.numCandidates ?? 1 + rng.int(ACTION_KINDS.length);
  const numNearbyPeople = overrides.numNearbyPeople ?? rng.int(6);

  // Candidates: a deterministic-but-varied subset of ACTION_KINDS, always
  // including 'rest' so decide() always has at least one safe option.
  const candidateKinds = new Set<ActionKind>(['rest']);
  const shuffled = [...ACTION_KINDS];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = shuffled[i] as ActionKind;
    shuffled[i] = shuffled[j] as ActionKind;
    shuffled[j] = tmp;
  }
  for (const kind of shuffled) {
    if (candidateKinds.size >= numCandidates) break;
    candidateKinds.add(kind);
  }
  const candidates: Action[] = [...candidateKinds].map((kind) => {
    if (kind === 'attack' || kind === 'steal' || kind === 'share' || kind === 'trade' || kind === 'heal' || kind === 'teach' || kind === 'court') {
      return { kind, targetPersonId: 2 };
    }
    if (kind === 'migrate' || kind === 'build') {
      return { kind, tile: { x: 11, y: 10 } };
    }
    return { kind };
  });

  const nearbyPeople: PersonGlimpse[] = [];
  for (let i = 0; i < numNearbyPeople; i++) {
    const otherLineage = ALL_LINEAGES[rng.int(ALL_LINEAGES.length)] as Lineage;
    nearbyPeople.push({
      id: 2 + i,
      lineage: otherLineage,
      civId: 0,
      settlementId: null,
      pos: { x: 10 + (i % 3) - 1, y: 10 },
      influence: rng.next(),
      healthy: rng.chance(0.8),
      visibleEmotion: 'calm',
      affinity: rng.range(-1, 1),
      kin: rng.chance(0.2),
    });
  }

  const nearbyTiles: TileGlimpse[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      nearbyTiles.push({
        pos: { x: 10 + dx, y: 10 + dy },
        terrain: 'plains',
        food: rng.range(0, 5),
        wood: rng.range(0, 5),
        stone: rng.range(0, 5),
        metal: rng.range(0, 2),
      });
    }
  }

  const civ: CivGlimpse = {
    id: 0,
    population: 1 + numNearbyPeople,
    atWarWith: [],
    techs: [],
    season: 'spring',
    foodPerCapita: rng.range(0, 3),
  };

  const dangers: DangerGlimpse[] = rng.chance(0.3)
    ? [{ kind: 'famine', pos: { x: 10, y: 10 }, intensity: rng.next() }]
    : [];

  const settlement: SettlementGlimpse | null = null;

  const perception: Perception = {
    tick: rng.int(100000),
    self: person,
    candidates,
    nearbyPeople,
    nearbyTiles,
    settlement,
    nearbySettlements: [],
    civ,
    dangers,
  };

  return { person, perception };
}
