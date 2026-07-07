import { describe, expect, it } from 'vitest';
import {
  BATCH_INTERVAL_MS,
  SNAPSHOT_INTERVAL_MS,
  SKIP_GENERATION_TICKS,
  SPEED_PRESETS,
  TERRITORY_SNAPSHOT_EVERY,
  advanceByBatch,
  handleMessage,
  type WorkerState,
} from '../../src/shared/protocol';
import type { SimConfig } from '../../src/shared/types';

const config: SimConfig = { seed: 5, mode: 'mixed', mapSize: 'small', startPopulation: 200 };

function freshState(): WorkerState {
  return { sim: null, ticksPerSecond: 0, ticksSinceLastSnapshot: 0, snapshotsTaken: 0, msAccumulatorSinceSnapshot: 0 };
}

describe('handleMessage — init', () => {
  it('constructs a Simulation and replies ready + an initial snapshot with territory', () => {
    const { state, replies } = handleMessage(freshState(), { type: 'init', config });
    expect(state.sim).not.toBeNull();
    expect(replies).toHaveLength(2);
    expect(replies[0]).toEqual({ type: 'ready' });
    expect(replies[1]?.type).toBe('snapshot');
    if (replies[1]?.type === 'snapshot') {
      expect(replies[1].snapshot.territory).not.toBeNull();
      expect(replies[1].snapshot.tick).toBe(0);
    }
  });
});

describe('handleMessage — setSpeed', () => {
  it('updates ticksPerSecond and replies with one snapshot', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const { state, replies } = handleMessage(afterInit, { type: 'setSpeed', ticksPerSecond: 60 });
    expect(state.ticksPerSecond).toBe(60);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.type).toBe('snapshot');
    expect(SPEED_PRESETS).toContain(60);
  });

  it('setSpeed(0) pauses and still replies with a snapshot', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const { state, replies } = handleMessage(afterInit, { type: 'setSpeed', ticksPerSecond: 0 });
    expect(state.ticksPerSecond).toBe(0);
    expect(replies).toHaveLength(1);
  });

  it('is a no-op reply-wise before init (no sim yet) but still records the speed', () => {
    const { state, replies } = handleMessage(freshState(), { type: 'setSpeed', ticksPerSecond: 10 });
    expect(state.ticksPerSecond).toBe(10);
    expect(replies).toHaveLength(0);
  });
});

describe('handleMessage — step', () => {
  it('runs n ticks synchronously and replies with one snapshot including territory', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const tickBefore = afterInit.sim?.ctx.tick ?? -1;
    const { state, replies } = handleMessage(afterInit, { type: 'step', n: 5 });
    expect(state.sim?.ctx.tick).toBe(tickBefore + 5);
    expect(replies).toHaveLength(1);
    if (replies[0]?.type === 'snapshot') expect(replies[0].snapshot.territory).not.toBeNull();
  });

  // Reconciliation (controller ruling, Task 37 follow-up): the brief's literal
  // config here is startPopulation: 200, under which a single sim.tick() costs
  // ~170ms (NODE_ENV=test runs a full dev-mode invariant scan every tick), so
  // 7200 ticks takes 15-20+ minutes — far past any sane unit-test budget and
  // the 30s timeout below. n=-1 -> SKIP_GENERATION_TICKS is a fixed mapping in
  // the reducer (not a value this test chooses), so the only lever available
  // without touching implementation code is population. Dropping to
  // startPopulation: 20 preserves the exact thing this test proves — that
  // step({n:-1}) advances the tick counter by precisely SKIP_GENERATION_TICKS
  // (7200) real ticks through the reducer, no shortcuts — while cutting
  // per-tick cost enough to finish in ~11s (benchmarked). Full-scale
  // (200-person) generation-skip behavior is exercised by real usage and by
  // Task 45's long-run smoke tests, not by this unit test.
  it('n = -1 runs SKIP_GENERATION_TICKS ticks', () => {
    const smallConfig: SimConfig = { ...config, startPopulation: 20 };
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config: smallConfig });
    const { state } = handleMessage(afterInit, { type: 'step', n: -1 });
    expect(state.sim?.ctx.tick).toBe(SKIP_GENERATION_TICKS);
    expect(SKIP_GENERATION_TICKS).toBe(7200);
  }, 30000);

  it('replies with an error when there is no simulation yet', () => {
    const { replies } = handleMessage(freshState(), { type: 'step', n: 1 });
    expect(replies).toHaveLength(1);
    expect(replies[0]?.type).toBe('error');
  });
});

describe('handleMessage — inspect', () => {
  it('resolves a known person id', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const id = afterInit.sim?.ctx.people[0]?.id as number;
    const { replies } = handleMessage(afterInit, { type: 'inspect', personId: id });
    expect(replies).toHaveLength(1);
    expect(replies[0]?.type).toBe('inspect');
    if (replies[0]?.type === 'inspect') expect(replies[0].detail?.person.id).toBe(id);
  });

  it('returns a null detail for an unknown id', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const { replies } = handleMessage(afterInit, { type: 'inspect', personId: 999999 });
    expect(replies[0]).toEqual({ type: 'inspect', detail: null });
  });

  it('returns a null detail when there is no simulation yet', () => {
    const { replies } = handleMessage(freshState(), { type: 'inspect', personId: 1 });
    expect(replies[0]).toEqual({ type: 'inspect', detail: null });
  });
});

describe('handleMessage — serialize / load', () => {
  it('serialize replies with a JSON string', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const { replies } = handleMessage(afterInit, { type: 'serialize' });
    expect(replies).toHaveLength(1);
    expect(replies[0]?.type).toBe('serialized');
    if (replies[0]?.type === 'serialized') {
      const parsed = JSON.parse(replies[0].json) as { v: number };
      expect(parsed.v).toBe(1);
    }
  });

  it('serialize replies with an error when there is no simulation yet', () => {
    const { replies } = handleMessage(freshState(), { type: 'serialize' });
    expect(replies[0]?.type).toBe('error');
  });

  it('load replaces the simulation and replies with a fresh snapshot', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const { state: stepped } = handleMessage(afterInit, { type: 'step', n: 3 });
    const { replies: serializedReplies } = handleMessage(stepped, { type: 'serialize' });
    const json = serializedReplies[0]?.type === 'serialized' ? serializedReplies[0].json : '';

    const { state, replies } = handleMessage(freshState(), { type: 'load', json });
    expect(state.sim?.ctx.tick).toBe(3);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.type).toBe('snapshot');
  });

  it('load replies with an error on malformed json', () => {
    const { replies } = handleMessage(freshState(), { type: 'load', json: 'not json' });
    expect(replies[0]?.type).toBe('error');
  });
});

describe('advanceByBatch', () => {
  it('is a no-op with no simulation', () => {
    const { state, replies } = advanceByBatch(freshState());
    expect(state.sim).toBeNull();
    expect(replies).toEqual([]);
  });

  it('is a no-op when paused (ticksPerSecond 0)', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const { state, replies } = advanceByBatch(afterInit);
    expect(state.sim?.ctx.tick).toBe(0);
    expect(replies).toEqual([]);
  });

  it('at 1000 ticks/sec advances exactly 100 ticks per call (BATCH_INTERVAL_MS = 100)', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    const running = { ...afterInit, ticksPerSecond: 1000 };
    const { state } = advanceByBatch(running);
    expect(state.sim?.ctx.tick).toBe(100);
    expect(BATCH_INTERVAL_MS).toBe(100);
  });

  it('emits a snapshot roughly every SNAPSHOT_INTERVAL_MS of accumulated batch time', () => {
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config });
    let running = { ...afterInit, ticksPerSecond: 1000 };
    let sawSnapshot = false;
    for (let i = 0; i < 5; i++) {
      const { state, replies } = advanceByBatch(running);
      running = state;
      if (replies.some((r) => r.type === 'snapshot')) sawSnapshot = true;
    }
    expect(sawSnapshot).toBe(true);
    expect(SNAPSHOT_INTERVAL_MS).toBe(200);
  });

  // Reconciliation (controller ruling, Task 37 follow-up): at the brief's
  // literal startPopulation: 200, 30 iterations x 100 ticks/batch = 3000
  // ticks costs ~180s under NODE_ENV=test invariant scans, blowing the 120s
  // global timeout. The batch/snapshot/territory cadence math this test
  // proves (100 ticks per batch, a snapshot every ~200ms of accumulated
  // batch time, territory on every 10th snapshot) is entirely population-
  // independent, so dropping to startPopulation: 20 changes nothing about
  // what's asserted while cutting the same 3000 ticks to ~6s (benchmarked).
  // Full-scale generation-skip/territory behavior is covered by real usage
  // and Task 45's long-run smoke tests.
  it('includes territory exactly every TERRITORY_SNAPSHOT_EVERY-th snapshot', () => {
    const smallConfig: SimConfig = { ...config, startPopulation: 20 };
    const { state: afterInit } = handleMessage(freshState(), { type: 'init', config: smallConfig });
    let running = { ...afterInit, ticksPerSecond: 1000 };
    const territoryFlags: boolean[] = [];
    for (let i = 0; i < 30; i++) {
      const { state, replies } = advanceByBatch(running);
      running = state;
      for (const r of replies) {
        if (r.type === 'snapshot') territoryFlags.push(r.snapshot.territory !== null);
      }
    }
    expect(TERRITORY_SNAPSHOT_EVERY).toBe(10);
    expect(territoryFlags.some((f) => f)).toBe(true);
    // exactly every 10th recorded snapshot (1-indexed by snapshotsTaken) has territory.
    const territoryIndices = territoryFlags.reduce<number[]>((acc, has, i) => {
      if (has) acc.push(i);
      return acc;
    }, []);
    for (const idx of territoryIndices) {
      expect((idx + 1) % TERRITORY_SNAPSHOT_EVERY === 0 || idx === 0).toBe(true);
    }
  });
});
