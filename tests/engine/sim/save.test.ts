import { describe, expect, it } from 'vitest';
import { checksum, deserialize, SAVE_FORMAT_VERSION, serialize } from '../../../src/engine/sim/save';
import { Simulation } from '../../../src/engine/sim/simulation';
import { checkInvariants } from '../../../src/engine/sim/invariants';
import type { SimConfig } from '../../../src/shared/types';

function baseConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { seed: 21, mode: 'mixed', mapSize: 'small', startPopulation: 200, ...overrides };
}

describe('serialize / deserialize', () => {
  it('round-trips tick, population, and civ count', () => {
    const sim = new Simulation(baseConfig());
    for (let i = 0; i < 10; i++) sim.tick();
    const json = serialize(sim);
    const restored = deserialize(json);
    expect(restored.ctx.tick).toBe(sim.ctx.tick);
    expect(restored.currentTick).toBe(sim.currentTick);
    expect(restored.ctx.people).toHaveLength(sim.ctx.people.length);
    expect(restored.ctx.civs).toHaveLength(sim.ctx.civs.length);
  });

  it('the envelope carries v = SAVE_FORMAT_VERSION = 1', () => {
    const sim = new Simulation(baseConfig());
    const json = serialize(sim);
    const parsed = JSON.parse(json) as { v: number };
    expect(parsed.v).toBe(1);
    expect(SAVE_FORMAT_VERSION).toBe(1);
  });

  it('deserialize throws on an unsupported version', () => {
    const sim = new Simulation(baseConfig());
    const json = serialize(sim);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed.v = 2;
    expect(() => deserialize(JSON.stringify(parsed))).toThrow();
  });

  it('a restored simulation ticks cleanly with no invariant violations', () => {
    const sim = new Simulation(baseConfig());
    for (let i = 0; i < 10; i++) sim.tick();
    const restored = deserialize(serialize(sim));
    for (let i = 0; i < 10; i++) restored.tick();
    expect(checkInvariants(restored)).toEqual([]);
  });

  it('a restored simulation continues its random stream (does not repeat draws)', () => {
    const sim = new Simulation(baseConfig());
    for (let i = 0; i < 20; i++) sim.tick();
    const beforeSaveChecksum = checksum(sim);
    const restored = deserialize(serialize(sim));
    const afterLoadChecksum = checksum(restored);
    expect(afterLoadChecksum).toBe(beforeSaveChecksum); // identical state right after load
    sim.tick();
    restored.tick();
    expect(checksum(restored)).toBe(checksum(sim)); // and they continue identically together
  });
});

describe('checksum', () => {
  it('is a finite number', () => {
    const sim = new Simulation(baseConfig());
    expect(Number.isFinite(checksum(sim))).toBe(true);
  });

  it('differs after a tick advances state', () => {
    const sim = new Simulation(baseConfig());
    const c0 = checksum(sim);
    sim.tick();
    const c1 = checksum(sim);
    expect(c1).not.toBe(c0);
  });
});
