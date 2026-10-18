import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/engine/sim/simulation';
import { checkInvariants } from '../../src/engine/sim/invariants';
import { checksum } from '../../src/engine/sim/save';
import type { SimConfig } from '../../src/shared/types';

// Scale reconciliation (Task 45, per the plan's own reduction clause): the
// task brief's literal scale is 5000 ticks x 2 modes x 2 seeds x 400-person
// medium map, with a settlement-formation checkpoint at tick 1000 (a 1:5
// checkpoint:total ratio). A timed probe on this dev machine (documented in
// task-45-report.md) measured, at pop=400/medium under test-mode invariant
// checking:
//   - civs mode:  ~130-220ms/tick (declining as population settles, ~365 ->
//     ~245 alive over the first 500 ticks)
//   - mixed mode: ~400-505ms/tick (declining more slowly, ~380 -> ~325 alive
//     over the first 500 ticks)
// Extrapolated, the literal 5000-tick scale would put at least one mixed-mode
// case past the brief's own >10-minutes-per-run infeasibility bar (and the
// four cases combined well past an hour), so per the plan's reconciliation
// instructions this file preserves every semantic of the brief (both modes,
// both seeds, same map size, same population, same per-tick invariant +
// checksum assertions, a settlement-by-checkpoint assertion) at 1/5 scale:
// 5000 -> 1000 total ticks, 1000 -> 200 checkpoint tick, keeping the original
// 1:5 checkpoint:total ratio exactly. The probe additionally confirmed (all
// 4 mode/seed combinations at pop=400/medium) that at least one settlement
// already exists at tick 1 in every case — the population starts spatially
// clustered by construction — so a checkpoint of 200 is not a coincidental
// pass; it has over 100x the empirically observed margin. The full 5000-tick
// literal scale remains available for a manual run: see
// tests/smoke/balance.test.ts, and re-run this file's constants directly for
// an ad hoc full-scale check if ever needed.
const LONG_RUN_TICKS = 1000;
const SETTLEMENT_CHECK_TICK = 200;
const SEEDS = [101, 202] as const;
const MODES: SimConfig['mode'][] = ['civs', 'mixed'];

interface RunResult {
  mode: SimConfig['mode'];
  seed: number;
  finalPopulation: number;
  hadSettlementByTick1000: boolean;
  survived: boolean;
}

function runLong(mode: SimConfig['mode'], seed: number): RunResult {
  const config: SimConfig = { seed, mode, mapSize: 'medium', startPopulation: 400 };
  const sim = new Simulation(config);
  let hadSettlementByTick1000 = false;

  for (let tick = 1; tick <= LONG_RUN_TICKS; tick++) {
    sim.tick();

    const violations = checkInvariants(sim);
    if (violations.length > 0) {
      throw new Error(`Invariant violation at tick ${tick} (mode=${mode}, seed=${seed}): ${violations.join('; ')}`);
    }

    const c = checksum(sim);
    if (!Number.isFinite(c)) {
      throw new Error(`Non-finite checksum at tick ${tick} (mode=${mode}, seed=${seed})`);
    }

    if (tick === SETTLEMENT_CHECK_TICK) {
      hadSettlementByTick1000 = sim.ctx.settlements.length >= 1;
    }
  }

  const finalPopulation = sim.ctx.people.filter((p) => p.alive).length;
  return {
    mode,
    seed,
    finalPopulation,
    hadSettlementByTick1000,
    survived: finalPopulation > 0,
  };
}

describe(`longrun smoke — ${LONG_RUN_TICKS} ticks (1/5-scale reconciliation of the brief's 5000), both modes, 2 seeds, medium map, 400 pop`, () => {
  for (const mode of MODES) {
    for (const seed of SEEDS) {
      it(`mode=${mode} seed=${seed}: no invariant violations, no NaN checksum, plausible population, settlement by tick ${SETTLEMENT_CHECK_TICK} if surviving`, () => {
        const result = runLong(mode, seed);

        expect(result.finalPopulation).toBeGreaterThanOrEqual(0);
        expect(result.finalPopulation).toBeLessThanOrEqual(6000);

        if (result.survived) {
          expect(result.hadSettlementByTick1000).toBe(true);
        }
      }, 600000);
    }
  }
});
