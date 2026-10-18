// Balance-tuning harness. Skipped by default (it is slow and prints to the
// console rather than asserting fine-grained expectations) — this file is
// meant to be run manually during a balance pass, not on every CI run.
//
// To unskip for a tuning run: change `describe.skip` to `describe` below,
// run `npx vitest run tests/smoke/balance.test.ts`, and read the per-civ
// metrics logged to the console every 500 ticks. Re-skip before committing
// unless you are intentionally changing this file's own assertions.
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/engine/sim/simulation';
import { takeSnapshot } from '../../src/engine/sim/snapshot';
import type { SimConfig } from '../../src/shared/types';

const BALANCE_RUN_TICKS = 5000;
const LOG_EVERY_TICKS = 500;

describe.skip('balance harness — manual tuning runs only (unskip to use)', () => {
  it('logs per-civ metrics every 500 ticks across a 5000-tick civs-mode run', () => {
    const config: SimConfig = { seed: 12345, mode: 'civs', mapSize: 'medium', startPopulation: 400 };
    const sim = new Simulation(config);

    for (let tick = 1; tick <= BALANCE_RUN_TICKS; tick++) {
      sim.tick();
      if (tick % LOG_EVERY_TICKS === 0) {
        const snap = takeSnapshot(sim, false);
        // eslint-disable-next-line no-console
        console.log(`--- tick ${tick} (year ${snap.year}, season ${snap.season}) ---`);
        for (const m of snap.metrics) {
          // eslint-disable-next-line no-console
          console.log(
            `  ${m.name}: pop=${m.population} births=${m.births} deaths=${m.deaths} techs=${m.techCount} atWar=${m.atWar} food/cap=${m.foodPerCapita.toFixed(2)}`,
          );
        }
      }
    }

    expect(sim.ctx.tick).toBe(BALANCE_RUN_TICKS);
  }, 120000);

  it('logs lineage-share drift every 500 ticks across a 5000-tick mixed-mode run', () => {
    const config: SimConfig = { seed: 54321, mode: 'mixed', mapSize: 'medium', startPopulation: 400 };
    const sim = new Simulation(config);

    for (let tick = 1; tick <= BALANCE_RUN_TICKS; tick++) {
      sim.tick();
      if (tick % LOG_EVERY_TICKS === 0) {
        const snap = takeSnapshot(sim, false);
        const civMetrics = snap.metrics[0];
        if (civMetrics === undefined) continue;
        // eslint-disable-next-line no-console
        console.log(
          `tick ${tick}: pop=${civMetrics.population} lineageShare=${JSON.stringify(civMetrics.lineageShare)}`,
        );
      }
    }

    expect(sim.ctx.tick).toBe(BALANCE_RUN_TICKS);
  }, 120000);
});
