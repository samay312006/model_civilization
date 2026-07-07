import { describe, expect, it } from 'vitest';
import { checksum, deserialize, serialize } from '../../../src/engine/sim/save';
import { Simulation } from '../../../src/engine/sim/simulation';
import type { SimConfig } from '../../../src/shared/types';

const config: SimConfig = { seed: 99, mode: 'civs', mapSize: 'small', startPopulation: 200 };

describe('determinism (seed 99, 300 ticks)', () => {
  it('two fresh sims with the same seed produce identical checksums after 300 ticks', () => {
    const a = new Simulation(config);
    const b = new Simulation(config);
    for (let i = 0; i < 300; i++) {
      a.tick();
      b.tick();
    }
    expect(checksum(a)).toBe(checksum(b));
  });

  it('serialize at tick 150, deserialize, run 150 more: checksum equals a straight-through 300-tick run', () => {
    const straightThrough = new Simulation(config);
    for (let i = 0; i < 300; i++) straightThrough.tick();
    const straightChecksum = checksum(straightThrough);

    const staged = new Simulation(config);
    for (let i = 0; i < 150; i++) staged.tick();
    const json = serialize(staged);
    const resumed = deserialize(json);
    for (let i = 0; i < 150; i++) resumed.tick();
    const resumedChecksum = checksum(resumed);

    expect(resumedChecksum).toBe(straightChecksum);
  });
}, 120000);
