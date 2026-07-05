import {
  ACTION_KINDS,
  LINEAGES,
  SKILL_NAMES,
  YEAR_TICKS,
  clamp,
  clamp01,
  type ActionKind,
  type Civ,
  type Inventory,
  type Lineage,
  type Morality,
  type Person,
  type SimConfig,
  type Skills,
  type Traits,
  type Vec2,
} from '../../shared/types';
import type { Rng } from '../rng';
import type { NameGen } from '../names';
import { isHabitable, type World } from '../world/terrain';

export const ADULT_MIN_AGE_YEARS = 16;
export const ADULT_MAX_AGE_YEARS = 40;
export const TRAIT_MIN = 0.15;
export const TRAIT_MAX = 0.85;
export const MORALITY_MIN = 0.2;
export const MORALITY_MAX = 0.9;
export const INITIAL_NEEDS_LEVEL = 0.15; // uniform ceiling for freshly-created adults' needs
export const INITIAL_SKILL_MIN = 0.05;
export const INITIAL_SKILL_MAX = 0.3;
export const LIFESPAN_MEAN_YEARS = 62;
export const LIFESPAN_SD_YEARS = 8;
export const LIFESPAN_MIN_YEARS = 40;
export const LIFESPAN_MAX_YEARS = 90;
export const CHILD_MUTATION_SD = 0.05;
export const CHILD_SKILL_MAX = 0.02; // children start with a faint skill trace, not zero
export const SCATTER_RADIUS = 6;

/** UI palette + names for mode 'civs' (contract, index-aligned with LINEAGES). */
export const CIV_PALETTE: readonly string[] = ['#e4572e', '#3d9be9', '#76b041', '#b76ce9'];
export const CIV_NAMES: readonly string[] = [
  'Opus Dominion',
  'Sonnet Commonwealth',
  'Haiku Enclave',
  'Fable Wandering',
];

/** A fresh empty inventory. Always returns a new object (never shared). */
export function initialInventory(): Inventory {
  return { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 };
}

function sampleTraits(rng: Rng): Traits {
  return {
    curiosity: rng.range(TRAIT_MIN, TRAIT_MAX),
    aggression: rng.range(TRAIT_MIN, TRAIT_MAX),
    empathy: rng.range(TRAIT_MIN, TRAIT_MAX),
    industriousness: rng.range(TRAIT_MIN, TRAIT_MAX),
    riskTolerance: rng.range(TRAIT_MIN, TRAIT_MAX),
  };
}

function sampleMorality(rng: Rng): Morality {
  return {
    care: rng.range(MORALITY_MIN, MORALITY_MAX),
    fairness: rng.range(MORALITY_MIN, MORALITY_MAX),
    loyalty: rng.range(MORALITY_MIN, MORALITY_MAX),
    authority: rng.range(MORALITY_MIN, MORALITY_MAX),
    sanctity: rng.range(MORALITY_MIN, MORALITY_MAX),
    liberty: rng.range(MORALITY_MIN, MORALITY_MAX),
  };
}

function sampleAdultSkills(rng: Rng): Skills {
  const skills = {} as Skills;
  for (const s of SKILL_NAMES) skills[s] = rng.range(INITIAL_SKILL_MIN, INITIAL_SKILL_MAX);
  return skills;
}

function sampleChildSkills(rng: Rng): Skills {
  const skills = {} as Skills;
  for (const s of SKILL_NAMES) skills[s] = rng.range(0, CHILD_SKILL_MAX);
  return skills;
}

function sampleLifespanTicks(rng: Rng): number {
  const years = clamp(
    rng.gaussian(LIFESPAN_MEAN_YEARS, LIFESPAN_SD_YEARS),
    LIFESPAN_MIN_YEARS,
    LIFESPAN_MAX_YEARS,
  );
  return Math.round(years * YEAR_TICKS);
}

function freshActionWeights(): Record<ActionKind, number> {
  const weights = {} as Record<ActionKind, number>;
  for (const k of ACTION_KINDS) weights[k] = 1.0;
  return weights;
}

/**
 * Contract factory: an adult person (16-40y), traits/morality sampled
 * uniformly, needs low, skills faint, action weights all 1.0, a name from
 * the seeded generator. brainState is left as {} — Task 20/33's registry
 * assigns the real per-lineage initial state after creation.
 */
export function createPerson(
  id: number,
  civId: number,
  lineage: Lineage,
  pos: Vec2,
  names: NameGen,
  rng: Rng,
): Person {
  const sex: 'm' | 'f' = rng.chance(0.5) ? 'm' : 'f';
  const ageYears = rng.range(ADULT_MIN_AGE_YEARS, ADULT_MAX_AGE_YEARS);
  return {
    id,
    alive: true,
    ageTicks: Math.round(ageYears * YEAR_TICKS),
    sex,
    name: names.person(sex),
    pos: { x: pos.x, y: pos.y },
    civId,
    settlementId: null,
    lineage,
    traits: sampleTraits(rng),
    emotions: { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0.1 },
    morality: sampleMorality(rng),
    needs: {
      hunger: rng.range(0, INITIAL_NEEDS_LEVEL),
      safety: rng.range(0, INITIAL_NEEDS_LEVEL),
      rest: rng.range(0, INITIAL_NEEDS_LEVEL),
      belonging: rng.range(0, INITIAL_NEEDS_LEVEL),
      esteem: rng.range(0, INITIAL_NEEDS_LEVEL),
    },
    skills: sampleAdultSkills(rng),
    health: 1,
    lifespanTicks: sampleLifespanTicks(rng),
    memory: [],
    relationships: [],
    inventory: initialInventory(),
    actionWeights: freshActionWeights(),
    brainState: {},
    influence: 0,
    beliefIds: [],
    partnerId: null,
    pregnantUntil: null,
    parentIds: null,
    causeOfDeath: null,
  };
}

function blendTrait(rng: Rng, a: number, b: number): number {
  const avg = (a + b) / 2;
  return clamp01(avg + rng.gaussian(0, CHILD_MUTATION_SD));
}

/**
 * Contract factory: blend of parents' traits/morality (average + gaussian
 * mutation sd 0.05, clamped 0..1), lineage = rng.pick of the two parents'
 * lineages, age 0, skills near 0 (uniform 0..CHILD_SKILL_MAX). Spawns at the
 * mother's position and civ.
 */
export function createChild(id: number, mother: Person, father: Person, names: NameGen, rng: Rng): Person {
  const traits: Traits = {
    curiosity: blendTrait(rng, mother.traits.curiosity, father.traits.curiosity),
    aggression: blendTrait(rng, mother.traits.aggression, father.traits.aggression),
    empathy: blendTrait(rng, mother.traits.empathy, father.traits.empathy),
    industriousness: blendTrait(rng, mother.traits.industriousness, father.traits.industriousness),
    riskTolerance: blendTrait(rng, mother.traits.riskTolerance, father.traits.riskTolerance),
  };
  const morality: Morality = {
    care: blendTrait(rng, mother.morality.care, father.morality.care),
    fairness: blendTrait(rng, mother.morality.fairness, father.morality.fairness),
    loyalty: blendTrait(rng, mother.morality.loyalty, father.morality.loyalty),
    authority: blendTrait(rng, mother.morality.authority, father.morality.authority),
    sanctity: blendTrait(rng, mother.morality.sanctity, father.morality.sanctity),
    liberty: blendTrait(rng, mother.morality.liberty, father.morality.liberty),
  };
  const lineage = rng.pick([mother.lineage, father.lineage]);
  const sex: 'm' | 'f' = rng.chance(0.5) ? 'm' : 'f';

  return {
    id,
    alive: true,
    ageTicks: 0,
    sex,
    name: names.person(sex),
    pos: { x: mother.pos.x, y: mother.pos.y },
    civId: mother.civId,
    settlementId: mother.settlementId,
    lineage,
    traits,
    emotions: { fear: 0, joy: 0.2, grief: 0, anger: 0, hope: 0.2 },
    morality,
    needs: { hunger: 0, safety: 0, rest: 0, belonging: 0, esteem: 0 },
    skills: sampleChildSkills(rng),
    health: 1,
    lifespanTicks: sampleLifespanTicks(rng),
    memory: [],
    relationships: [],
    inventory: initialInventory(),
    actionWeights: freshActionWeights(),
    brainState: {},
    influence: 0,
    beliefIds: [],
    partnerId: null,
    pregnantUntil: null,
    parentIds: [mother.id, father.id],
    causeOfDeath: null,
  };
}

/** Euclidean distance without importing shared/types' dist (keeps this file's helper local and inlineable). */
function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Every habitable (plains/forest) tile coordinate in the world. */
function habitableTiles(world: World): Vec2[] {
  const out: Vec2[] = [];
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      if (isHabitable(world.tileAt(x, y).terrain)) out.push({ x, y });
    }
  }
  return out;
}

/**
 * Picks `count` habitable centroids that are as mutually separated as
 * possible: greedily seed with a random habitable tile, then repeatedly add
 * the habitable tile that maximizes the minimum distance to all already-
 * chosen centroids (a standard farthest-point sampling heuristic).
 */
function pickSeparatedCentroids(world: World, count: number, rng: Rng): Vec2[] {
  const pool = habitableTiles(world);
  if (pool.length === 0) throw new Error('initPopulation: world has no habitable tiles');
  const chosen: Vec2[] = [rng.pick(pool)];
  while (chosen.length < count) {
    let best: Vec2 = pool[0] as Vec2;
    let bestMinDist = -1;
    for (const candidate of pool) {
      let minDist = Infinity;
      for (const c of chosen) {
        const d = distance(candidate, c);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        best = candidate;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

/** A habitable tile within `radius` of `center`, scanning outward rings; falls back to `center`. */
function nearestHabitableWithin(world: World, center: Vec2, radius: number, rng: Rng): Vec2 {
  const candidates: Vec2[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (!world.inBounds(x, y)) continue;
      if (Math.hypot(dx, dy) > radius) continue;
      if (isHabitable(world.tileAt(x, y).terrain)) candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return { x: center.x, y: center.y };
  return rng.pick(candidates);
}

function freshCiv(id: number, name: string, color: string): Civ {
  return {
    id,
    name,
    color,
    knowledge: { fire: 0, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
    techs: [],
    atWarWith: [],
    warWeariness: 0,
  };
}

/**
 * Contract factory. Mode 'civs': 4 civilizations, one per LINEAGES entry, in
 * the contract UI palette order, spawned around the 4 most mutually
 * separated habitable centroids on the map; each civ's people scatter within
 * SCATTER_RADIUS tiles of its centroid (re-picking the nearest habitable
 * tile per person so nobody lands in water). Mode 'mixed': a single civ,
 * lineages assigned round-robin across the population in LINEAGES order,
 * everyone scattered around one centroid.
 */
export function initPopulation(
  config: SimConfig,
  world: World,
  names: NameGen,
  rng: Rng,
): { people: Person[]; civs: Civ[] } {
  const people: Person[] = [];
  let nextId = 0;

  if (config.mode === 'civs') {
    const civs: Civ[] = LINEAGES.map((lineage, i) =>
      freshCiv(i, CIV_NAMES[i] as string, CIV_PALETTE[i] as string),
    );
    const centroids = pickSeparatedCentroids(world, LINEAGES.length, rng.split('spawn-regions'));
    const perCiv = Math.floor(config.startPopulation / LINEAGES.length);
    const remainder = config.startPopulation - perCiv * LINEAGES.length;

    for (let civIdx = 0; civIdx < LINEAGES.length; civIdx++) {
      const lineage = LINEAGES[civIdx] as Lineage;
      const centroid = centroids[civIdx] as Vec2;
      const count = perCiv + (civIdx < remainder ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const pos = nearestHabitableWithin(world, centroid, SCATTER_RADIUS, rng);
        people.push(createPerson(nextId, civIdx, lineage, pos, names, rng));
        nextId += 1;
      }
    }
    return { people, civs };
  }

  // mode 'mixed': one civ, lineages round-robin.
  const civ = freshCiv(0, names.civ(), CIV_PALETTE[0] as string);
  const centroid = pickSeparatedCentroids(world, 1, rng.split('spawn-regions'))[0] as Vec2;
  for (let i = 0; i < config.startPopulation; i++) {
    const lineage = LINEAGES[i % LINEAGES.length] as Lineage;
    const pos = nearestHabitableWithin(world, centroid, SCATTER_RADIUS, rng);
    people.push(createPerson(nextId, 0, lineage, pos, names, rng));
    nextId += 1;
  }
  return { people, civs: [civ] };
}
