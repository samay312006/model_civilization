import type {
  Emotions,
  Lineage,
  Morality,
  RelationKind,
  Season,
  StructureKind,
  Terrain,
  Tick,
  SimConfig,
} from './types';
import type { NarrativeEvent } from '../engine/sim/events';
import type { Temperament } from '../engine/brains/types';
import type { Person } from './types';
import { Simulation } from '../engine/sim/simulation';
import { takeSnapshot, personDetail } from '../engine/sim/snapshot';
import { serialize, deserialize } from '../engine/sim/save';

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
  /** Mirrors sim.config.mode (Task 45 fix); replaces the fragile `metrics.length <= 1` mixed-mode heuristic. */
  mode: 'civs' | 'mixed';
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

export type UiToWorker =
  | { type: 'init'; config: SimConfig }
  | { type: 'setSpeed'; ticksPerSecond: number }
  | { type: 'step'; n: number }
  | { type: 'inspect'; personId: number }
  | { type: 'serialize' }
  | { type: 'load'; json: string };

export type WorkerToUi =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'inspect'; detail: PersonDetail | null }
  | { type: 'serialized'; json: string }
  | { type: 'error'; message: string }
  /** Sent once by handleMessage's 'init'/'load' branches (Task 40), immediately
   * ahead of 'ready'/the first snapshot, so MapView can paint the terrain layer. */
  | { type: 'terrain'; tiles: { terrain: Terrain }[]; worldSize: number };

/** Contract speed presets; 0 = paused. */
export const SPEED_PRESETS: readonly number[] = [0, 1, 10, 60, 360, 1000];
/** 'skip-generation' = 7200 ticks = 20 years at YEAR_TICKS = 360. */
export const SKIP_GENERATION_TICKS = 7200;
/** The interval loop batches ticks every 100ms (10 batches/sec). */
export const BATCH_INTERVAL_MS = 100;
/** ~5 snapshots/sec while running. */
export const SNAPSHOT_INTERVAL_MS = 200;
/** Territory is included on every 10th snapshot. */
export const TERRITORY_SNAPSHOT_EVERY = 10;

export interface WorkerState {
  sim: Simulation | null;
  ticksPerSecond: number;
  ticksSinceLastSnapshot: number;
  snapshotsTaken: number;
  msAccumulatorSinceSnapshot: number;
  /**
   * Fractional engine ticks carried between batches (mandated fix, Task 39).
   * At ticksPerSecond=1, each 100ms batch owes 0.1 ticks; Math.round(0.1)=0
   * would never advance the sim. Accumulating the remainder here lets 1 t/s
   * emit exactly one tick every 10th batch instead of freezing forever.
   */
  tickRemainder: number;
  /** True once the current sim's terrain has been sent to the UI (Task 40). */
  terrainSent: boolean;
}

function terrainReply(sim: Simulation): WorkerToUi {
  return {
    type: 'terrain',
    tiles: sim.ctx.world.tiles.map((t) => ({ terrain: t.terrain })),
    worldSize: sim.ctx.world.size,
  };
}

function snapshotReply(state: WorkerState, includeTerritory: boolean): { state: WorkerState; reply: WorkerToUi } {
  if (state.sim === null) throw new Error('snapshotReply called with no simulation');
  const snapshot = takeSnapshot(state.sim, includeTerritory);
  const nextSnapshotsTaken = state.snapshotsTaken + 1;
  return {
    state: { ...state, snapshotsTaken: nextSnapshotsTaken, ticksSinceLastSnapshot: 0 },
    reply: { type: 'snapshot', snapshot },
  };
}

/**
 * Pure protocol reducer. Never throws: any failure inside a branch is caught
 * and turned into a { type: 'error' } reply instead.
 */
export function handleMessage(state: WorkerState, msg: UiToWorker): { state: WorkerState; replies: WorkerToUi[] } {
  try {
    switch (msg.type) {
      case 'init': {
        const sim = new Simulation(msg.config);
        const next: WorkerState = {
          sim,
          ticksPerSecond: 0,
          ticksSinceLastSnapshot: 0,
          snapshotsTaken: 0,
          msAccumulatorSinceSnapshot: 0,
          tickRemainder: 0,
          terrainSent: true,
        };
        const { state: withSnap, reply } = snapshotReply(next, true);
        return { state: withSnap, replies: [terrainReply(sim), { type: 'ready' }, reply] };
      }

      case 'setSpeed': {
        const next: WorkerState = { ...state, ticksPerSecond: msg.ticksPerSecond };
        if (next.sim === null) return { state: next, replies: [] };
        const { state: withSnap, reply } = snapshotReply(next, false);
        return { state: withSnap, replies: [reply] };
      }

      case 'step': {
        if (state.sim === null) {
          return { state, replies: [{ type: 'error', message: 'no simulation to step' }] };
        }
        const n = msg.n === -1 ? SKIP_GENERATION_TICKS : msg.n;
        for (let i = 0; i < n; i++) state.sim.tick();
        const { state: withSnap, reply } = snapshotReply(state, true);
        return { state: withSnap, replies: [reply] };
      }

      case 'inspect': {
        if (state.sim === null) {
          return { state, replies: [{ type: 'inspect', detail: null }] };
        }
        const detail = personDetail(state.sim, msg.personId);
        return { state, replies: [{ type: 'inspect', detail }] };
      }

      case 'serialize': {
        if (state.sim === null) {
          return { state, replies: [{ type: 'error', message: 'no simulation to serialize' }] };
        }
        const json = serialize(state.sim);
        return { state, replies: [{ type: 'serialized', json }] };
      }

      case 'load': {
        const sim = deserialize(msg.json);
        const next: WorkerState = {
          sim,
          ticksPerSecond: 0,
          ticksSinceLastSnapshot: 0,
          snapshotsTaken: 0,
          msAccumulatorSinceSnapshot: 0,
          tickRemainder: 0,
          terrainSent: true,
        };
        const { state: withSnap, reply } = snapshotReply(next, true);
        return { state: withSnap, replies: [terrainReply(sim), reply] };
      }
    }
  } catch (err) {
    return { state, replies: [{ type: 'error', message: err instanceof Error ? err.message : String(err) }] };
  }
}

/**
 * The interval-loop tick: at ticksPerSecond ticks/sec, BATCH_INTERVAL_MS of
 * wall time owes `ticksPerSecond * BATCH_INTERVAL_MS / 1000` engine ticks
 * per batch (100 ticks per call at the 1000 tick/s preset). That quantity is
 * fractional below 10 ticks/sec (e.g. 0.1 at the 1 tick/s preset), so the
 * whole-number part is taken with the fractional remainder carried forward
 * in `state.tickRemainder` and added into the next batch's owed amount —
 * this is what lets 1 tick/sec advance one tick every 10th batch instead of
 * Math.round-ing down to 0 forever (mandated fix, Task 39/controller ruling
 * on Task 37's speed-batching review). A tiny epsilon guards against
 * floating-point drift (e.g. ten additions of 0.1 landing a hair under 1)
 * rounding a due tick down to the wrong batch. Emits a snapshot (with
 * territory every TERRITORY_SNAPSHOT_EVERY-th snapshot) whenever the
 * accumulator reaches SNAPSHOT_INTERVAL_MS.
 */
export function advanceByBatch(state: WorkerState): { state: WorkerState; replies: WorkerToUi[] } {
  if (state.sim === null || state.ticksPerSecond === 0) {
    return { state, replies: [] };
  }
  const owedTicks = state.tickRemainder + (state.ticksPerSecond * BATCH_INTERVAL_MS) / 1000;
  const ticksThisBatch = Math.floor(owedTicks + 1e-9);
  const tickRemainder = owedTicks - ticksThisBatch;
  for (let i = 0; i < ticksThisBatch; i++) state.sim.tick();

  let next: WorkerState = {
    ...state,
    tickRemainder,
    ticksSinceLastSnapshot: state.ticksSinceLastSnapshot + ticksThisBatch,
    msAccumulatorSinceSnapshot: state.msAccumulatorSinceSnapshot + BATCH_INTERVAL_MS,
  };

  const replies: WorkerToUi[] = [];
  if (next.msAccumulatorSinceSnapshot >= SNAPSHOT_INTERVAL_MS) {
    next = { ...next, msAccumulatorSinceSnapshot: next.msAccumulatorSinceSnapshot - SNAPSHOT_INTERVAL_MS };
    const includeTerritory = next.snapshotsTaken % TERRITORY_SNAPSHOT_EVERY === 0;
    const { state: withSnap, reply } = snapshotReply(next, includeTerritory);
    next = withSnap;
    replies.push(reply);
  }

  return { state: next, replies };
}
