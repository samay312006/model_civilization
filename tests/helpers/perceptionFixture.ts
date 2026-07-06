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
  type Terrain,
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

/** All five documented terrains — the fixture must exercise every one of these over many iterations. */
const ALL_TERRAINS: Terrain[] = ['water', 'plains', 'forest', 'mountain', 'desert'];

/** The three danger kinds DangerGlimpse documents. */
const ALL_DANGER_KINDS: Array<DangerGlimpse['kind']> = ['famine', 'raid', 'disease'];

/** A deterministic, plausible-looking settlement glimpse near (10, 10). */
function randomSettlementGlimpse(rng: Rng, id: number, civId: number): SettlementGlimpse {
  return {
    id,
    civId,
    center: { x: 10 + rng.int(9) - 4, y: 10 + rng.int(9) - 4 },
    population: 1 + rng.int(80),
    foodStock: rng.range(0, 300),
    hasGranary: rng.chance(0.5),
    hasWall: rng.chance(0.3),
    underAttack: rng.chance(0.15),
  };
}

/**
 * Deterministic tiny-world Person + Perception builder for brain tests.
 * Does not depend on World/SpatialIndex/Settlement machinery — it hand-rolls
 * a small neighborhood and a handful of candidate actions so brain
 * conformance tests stay fast and self-contained.
 *
 * Diversity (deterministic, driven entirely by `rng`): nearby tiles are
 * drawn across all five Terrain kinds; the person's own settlement is
 * sometimes present (with plausible population/stock/structure fields), 0-3
 * nearbySettlements are generated the same way, and dangers are drawn from
 * famine/raid/disease.
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
      const terrain = rng.pick(ALL_TERRAINS);
      const foodRaw = rng.range(0, 5);
      const woodRaw = rng.range(0, 5);
      const stoneRaw = rng.range(0, 5);
      const metalRaw = rng.range(0, 2);
      const isWater = terrain === 'water';
      nearbyTiles.push({
        pos: { x: 10 + dx, y: 10 + dy },
        terrain,
        food: isWater ? 0 : foodRaw,
        wood: isWater ? 0 : woodRaw,
        stone: isWater ? 0 : stoneRaw,
        metal: isWater ? 0 : metalRaw,
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

  const numDangers = rng.int(3); // 0, 1, or 2
  const dangers: DangerGlimpse[] = [];
  for (let i = 0; i < numDangers; i++) {
    const kind = rng.pick(ALL_DANGER_KINDS);
    const hasPos = rng.chance(0.85);
    dangers.push({
      kind,
      pos: hasPos ? { x: 10 + rng.int(9) - 4, y: 10 + rng.int(9) - 4 } : null,
      intensity: rng.next(),
    });
  }

  const settlement: SettlementGlimpse | null = rng.chance(0.4)
    ? randomSettlementGlimpse(rng, 100, 0)
    : null;

  const numNearbySettlements = rng.int(4); // 0, 1, 2, or 3
  const nearbySettlements: SettlementGlimpse[] = [];
  for (let i = 0; i < numNearbySettlements; i++) {
    nearbySettlements.push(randomSettlementGlimpse(rng, 200 + i, 1 + rng.int(3)));
  }

  const perception: Perception = {
    tick: rng.int(100000),
    self: person,
    candidates,
    nearbyPeople,
    nearbyTiles,
    settlement,
    nearbySettlements,
    civ,
    dangers,
  };

  return { person, perception };
}
