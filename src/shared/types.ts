// Core shared types & constants for Genesis.
// This file is the frozen contract's Core Types block, reproduced verbatim
// (docs/superpowers/plans/2026-07-04-genesis-contract.md), plus implemented
// clamp / clamp01 / dist. Every other module builds on these names; nothing
// here may be changed without changing the contract itself. DOM-free and
// dependency-free: safe to import from the engine, the worker, tests, and
// the UI alike.

export const YEAR_TICKS = 360;           // 1 tick = 1 day
export const SEASON_TICKS = 90;
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Tick = number;

export const MAP_SIZES = { small: 96, medium: 144, large: 192 } as const;
export type MapSize = keyof typeof MAP_SIZES;

export const PERCEPTION_RADIUS = 4;
export const MEMORY_CAP = 48;
export const RELATIONSHIP_CAP = 24;
export const ADULT_AGE_TICKS = 16 * YEAR_TICKS;
export const GESTATION_TICKS = 270;
export const SOFTMAX_TEMP = 0.35;
export const ACTION_WEIGHT_MIN = 0.2;
export const ACTION_WEIGHT_MAX = 3.0;

export interface Vec2 { x: number; y: number }

export type Terrain = 'water' | 'plains' | 'forest' | 'mountain' | 'desert';

export interface Tile {
  terrain: Terrain;
  fertility: number;  // 0..1 regrowth quality
  food: number;       // >= 0 forageable units
  wood: number;       // >= 0
  stone: number;      // >= 0
  metal: number;      // >= 0
}

export type Lineage = 'opus' | 'sonnet' | 'haiku' | 'fable';
export const LINEAGES: readonly Lineage[] = ['opus', 'sonnet', 'haiku', 'fable'];
// int encoding for snapshots: opus=0 sonnet=1 haiku=2 fable=3 (index in LINEAGES)

export interface Traits { curiosity: number; aggression: number; empathy: number; industriousness: number; riskTolerance: number }        // all 0..1
export interface Emotions { fear: number; joy: number; grief: number; anger: number; hope: number }                                       // all 0..1
export interface Morality { care: number; fairness: number; loyalty: number; authority: number; sanctity: number; liberty: number }       // all 0..1
export interface Needs { hunger: number; safety: number; rest: number; belonging: number; esteem: number }                                 // all 0..1, 1 = desperate

export const SKILL_NAMES = ['farming', 'gathering', 'building', 'crafting', 'fighting', 'healing', 'teaching'] as const;
export type SkillName = typeof SKILL_NAMES[number];
export type Skills = Record<SkillName, number>;   // 0..1

export const ACTION_KINDS = ['gather', 'farm', 'hunt', 'build', 'craft', 'rest', 'socialize', 'court', 'teach', 'trade', 'share', 'steal', 'attack', 'flee', 'migrate', 'worship', 'explore', 'heal'] as const;
export type ActionKind = typeof ACTION_KINDS[number];

export type StructureKind = 'shelter' | 'granary' | 'wall' | 'shrine';

export interface Action { kind: ActionKind; targetPersonId?: number; tile?: Vec2; structure?: StructureKind }
export interface ScoredAction { action: Action; score: number }   // score finite, >= 0

export type MemoryKind = 'helped' | 'harmed' | 'shared' | 'stolen' | 'death-witnessed' | 'kin-died' | 'disaster' | 'victory' | 'defeat' | 'birth' | 'taught' | 'wonder';
export interface MemoryEventRec { tick: Tick; kind: MemoryKind; otherId: number; valence: number; salience: number }  // valence -1..1, salience 0..1

export type RelationKind = 'kin' | 'friend' | 'rival' | 'partner';
export interface Relationship { otherId: number; kind: RelationKind; affinity: number }  // affinity -1..1

export interface Inventory { food: number; wood: number; stone: number; metal: number; tools: number }

export type TechId = 'fire' | 'agriculture' | 'construction' | 'metallurgy' | 'writing' | 'medicine';
export const TECH_IDS: readonly TechId[] = ['fire', 'agriculture', 'construction', 'metallurgy', 'writing', 'medicine'];
export const TECH_THRESHOLDS: Record<TechId, number> = { fire: 50, agriculture: 200, construction: 400, metallurgy: 800, writing: 1200, medicine: 1600 };

export interface Person {
  id: number;
  alive: boolean;
  ageTicks: number;
  sex: 'm' | 'f';
  name: string;
  pos: Vec2;                       // integer tile coords
  civId: number;
  settlementId: number | null;
  lineage: Lineage;
  traits: Traits;
  emotions: Emotions;
  morality: Morality;
  needs: Needs;
  skills: Skills;
  health: number;                  // 0..1, 0 = dead
  lifespanTicks: number;           // sampled at birth
  memory: MemoryEventRec[];        // newest first, length <= MEMORY_CAP
  relationships: Relationship[];   // length <= RELATIONSHIP_CAP
  inventory: Inventory;
  actionWeights: Record<ActionKind, number>;  // init 1.0, clamped to [ACTION_WEIGHT_MIN, ACTION_WEIGHT_MAX]
  brainState: unknown;             // JSON-serializable plain object owned by the brain
  influence: number;               // 0..1
  beliefIds: number[];
  partnerId: number | null;
  pregnantUntil: Tick | null;
  parentIds: [number, number] | null;
  causeOfDeath: string | null;
}

export interface Civ {
  id: number;
  name: string;
  color: string;                   // css hex
  knowledge: Record<TechId, number>;
  techs: TechId[];                 // currently ACTIVE techs
  atWarWith: number[];
  warWeariness: number;            // 0..1
}

export interface Settlement {
  id: number;
  civId: number;
  name: string;
  center: Vec2;
  memberIds: number[];
  stock: Inventory;                // communal stores
  structures: Record<StructureKind, number>;  // counts
}

export interface Religion {
  id: number;
  name: string;
  founderId: number;
  civId: number;
  moralityBias: Partial<Morality>;
  zeal: number;                    // 0..1
}

export interface SimConfig {
  seed: number;
  mode: 'civs' | 'mixed';          // 'civs' = 4 one-lineage civilizations; 'mixed' = 1 civ, lineages mixed
  mapSize: MapSize;
  startPopulation: number;         // 200 | 400 | 600
}

/**
 * Clamp v into [lo, hi]. A NaN input propagates as NaN by design — the
 * dev-build invariant checks (Task 33) are the tripwire for NaN, so clamp
 * must not mask one.
 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamp v into [0, 1]. */
export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Euclidean distance between two points. */
export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
