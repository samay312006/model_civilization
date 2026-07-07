import type {
  Emotions,
  Lineage,
  Morality,
  RelationKind,
  Season,
  StructureKind,
  Tick,
} from './types';
import type { NarrativeEvent } from '../engine/sim/events';
import type { Temperament } from '../engine/brains/types';
import type { Person } from './types';

export interface CivMetrics {
  civId: number;
  name: string;
  color: string;
  population: number;
  births: number;
  deaths: number;
  techCount: number;
  atWar: boolean;
  lineageShare: Record<Lineage, number>;
  avgMorality: Morality;
  avgEmotions: Emotions;
  foodPerCapita: number;
}

export interface SettlementView {
  id: number;
  civId: number;
  x: number;
  y: number;
  population: number;
  name: string;
  structures: Record<StructureKind, number>;
}

export interface Snapshot {
  tick: Tick;
  year: number;
  season: Season;
  population: number;
  worldSize: number;
  ids: Int32Array;
  xs: Float32Array;
  ys: Float32Array;
  civIds: Int16Array;
  lineages: Int8Array;
  healths: Uint8Array;
  moods: Uint8Array;
  settlements: SettlementView[];
  territory: Int16Array | null;
  recentEvents: NarrativeEvent[];
  metrics: CivMetrics[];
}

/** Mood-to-int encoding table for Snapshot.moods: index = stored value. */
export const MOOD_ORDER: readonly ('calm' | 'afraid' | 'angry' | 'joyful' | 'grieving')[] = [
  'calm',
  'afraid',
  'angry',
  'joyful',
  'grieving',
];

/** Nearest-settlement-within-N-tiles radius used by territory ownership. */
export const TERRITORY_RADIUS = 20;

export interface PersonDetail {
  person: Person;
  memoriesText: string[];
  relationshipsNamed: { name: string; kind: RelationKind; affinity: number }[];
  temperament: Temperament;
  settlementName: string | null;
  civName: string;
}
