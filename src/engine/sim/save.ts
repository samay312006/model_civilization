import type { Civ, Person, Religion, Settlement, SimConfig, Tick } from '../../shared/types';
import type { NaturalEvent } from '../world/climate';
import type { World } from '../world/terrain';
import type { NarrativeEvent } from './events';
import { Simulation, type NameCallKind } from './simulation';

export const SAVE_FORMAT_VERSION = 1;

export interface SaveEnvelope {
  v: 1;
  config: SimConfig;
  tick: Tick;
  rngState: number;
  people: Person[];
  civs: Civ[];
  settlements: Settlement[];
  religions: Religion[];
  naturalEvents: NaturalEvent[];
  eventLog: NarrativeEvent[];
  /**
   * The world's mutable per-tile resource state (food/wood/stone/metal
   * deplete via foraging/gathering and regrow every tick via
   * regenerateResources — see world/terrain.ts and world/climate.ts). Not
   * part of the plan's original envelope field list, but required for
   * resume-equivalence: reconstructing the world via a fresh generateWorld()
   * call reproduces only the tick-0 pristine terrain, discarding every
   * tick's worth of consumption/regrowth history, which then desyncs
   * checksums a few ticks after any restore. See task-36-report.md.
   */
  world: World;
  /**
   * Ordered log of every ctx.names.*() call made since Simulation
   * construction (see NameCallKind in simulation.ts). Also not part of the
   * plan's original envelope field list, but required for the same reason
   * as `world`: NameGen (src/engine/names.ts) wraps a private Rng stream
   * with no getState()/setState() of its own, so a restored run must
   * replay this log against a fresh NameGen (discarding outputs) to land
   * back at the same stream position before generating any *new* names —
   * otherwise names assigned to post-restore births/settlements/civs/
   * religions diverge from what a continuous run would have produced. See
   * task-36-report.md.
   */
  nameCallLog: NameCallKind[];
}

/** Contract signature verbatim: a versioned JSON envelope including rng state, people (with brainStates), and config. */
export function serialize(sim: Simulation): string {
  const ctx = sim.ctx;
  const envelope: SaveEnvelope = {
    v: SAVE_FORMAT_VERSION,
    config: sim.config,
    tick: ctx.tick,
    rngState: ctx.rng.getState(),
    people: ctx.people,
    civs: ctx.civs,
    settlements: ctx.settlements,
    religions: ctx.religions,
    naturalEvents: ctx.naturalEvents,
    eventLog: ctx.events,
    world: ctx.world,
    nameCallLog: ctx.nameCallLog,
  };
  return JSON.stringify(envelope);
}

/** Contract signature verbatim: reconstructs a Simulation without rerunning init. */
export function deserialize(json: string): Simulation {
  const parsed = JSON.parse(json) as SaveEnvelope;
  if (parsed.v !== SAVE_FORMAT_VERSION) {
    throw new Error(`save.ts: unsupported save version ${String(parsed.v)}`);
  }
  return Simulation.fromEnvelope(parsed);
}

/** Contract signature verbatim: FNV-1a over a stable serialization of the mutable simulation state. */
export function checksum(sim: Simulation): number {
  const ctx = sim.ctx;
  const stable = JSON.stringify({
    tick: ctx.tick,
    rngState: ctx.rng.getState(),
    people: ctx.people,
    civs: ctx.civs,
    settlements: ctx.settlements,
    religions: ctx.religions,
  });
  let hash = 0x811c9dc5;
  for (let i = 0; i < stable.length; i++) {
    hash ^= stable.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
