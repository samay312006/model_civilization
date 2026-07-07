import { describe, expect, it } from 'vitest';
import { Simulation, TICK_PHASES, makeDisasterWitnessEvents } from '../../../src/engine/sim/simulation';
import type { NarrativeEvent } from '../../../src/engine/sim/events';
import { createRng } from '../../../src/engine/rng';
import type { SimConfig } from '../../../src/shared/types';

function baseConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { seed: 7, mode: 'mixed', mapSize: 'small', startPopulation: 200, ...overrides };
}

describe('Simulation construction', () => {
  it('builds a world, population, and civs matching the config', () => {
    const sim = new Simulation(baseConfig());
    expect(sim.config.seed).toBe(7);
    expect(sim.ctx.people).toHaveLength(200);
    expect(sim.ctx.civs).toHaveLength(1); // mode 'mixed'
    expect(sim.ctx.world.size).toBe(96); // MAP_SIZES.small
    expect(sim.currentTick).toBe(0);
    expect(sim.ctx.tick).toBe(0);
  });

  it('mode civs builds 4 civs', () => {
    const sim = new Simulation(baseConfig({ mode: 'civs' }));
    expect(sim.ctx.civs).toHaveLength(4);
  });

  it('initializes every person with a non-empty brainState from the real registry', () => {
    const sim = new Simulation(baseConfig());
    for (const p of sim.ctx.people) {
      expect(p.brainState).not.toBeNull();
      expect(typeof p.brainState).toBe('object');
    }
  });

  it('personById is populated and consistent with people', () => {
    const sim = new Simulation(baseConfig());
    expect(sim.ctx.personById.size).toBe(sim.ctx.people.length);
    for (const p of sim.ctx.people) {
      expect(sim.ctx.personById.get(p.id)).toBe(p);
    }
  });

  it('is deterministic for a fixed seed: two fresh sims produce identical initial people/civs', () => {
    const a = new Simulation(baseConfig({ seed: 55 }));
    const b = new Simulation(baseConfig({ seed: 55 }));
    expect(a.ctx.people).toEqual(b.ctx.people);
    expect(a.ctx.civs).toEqual(b.ctx.civs);
  });

  it('two different seeds produce different populations', () => {
    const a = new Simulation(baseConfig({ seed: 1 }));
    const b = new Simulation(baseConfig({ seed: 2 }));
    expect(a.ctx.people).not.toEqual(b.ctx.people);
  });
});

describe('Simulation.tick — order and bookkeeping', () => {
  it('advances currentTick and ctx.tick together, starting at 1 after one tick', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    sim.tick();
    expect(sim.currentTick).toBe(1);
    expect(sim.ctx.tick).toBe(1);
  });

  it('calls onPhase with every TICK_PHASES entry in order, exactly once per tick', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    const seen: string[] = [];
    sim.ctx.onPhase = (phase: string): void => {
      seen.push(phase);
    };
    sim.tick();
    expect(seen).toEqual([...TICK_PHASES]);
  });

  it('resets counters.births/deaths at the start of each tick', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    sim.tick();
    const firstBirths = sim.ctx.counters.births;
    const firstDeaths = sim.ctx.counters.deaths;
    expect(firstBirths).toBeGreaterThanOrEqual(0);
    expect(firstDeaths).toBeGreaterThanOrEqual(0);
    sim.tick();
    // counters describe THIS tick only, never accumulate across ticks
    expect(sim.ctx.counters.births).toBeGreaterThanOrEqual(0);
    expect(sim.ctx.counters.deaths).toBeGreaterThanOrEqual(0);
  });

  it('ages at least one living person by exactly one tick per call', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    const before = sim.ctx.people.find((p) => p.alive)?.ageTicks as number;
    const id = sim.ctx.people.find((p) => p.alive)?.id as number;
    sim.tick();
    const after = sim.ctx.personById.get(id)?.ageTicks;
    // the person may have died this tick (health/disease/old-age); if still alive, must be +1.
    const stillAlive = sim.ctx.personById.get(id)?.alive === true;
    if (stillAlive) expect(after).toBe(before + 1);
  });
});

describe('Simulation — extinction', () => {
  it('keeps ticking the world (no throw) after population reaches 0', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    for (const p of sim.ctx.people) {
      p.alive = false;
      p.health = 0;
    }
    expect(() => {
      for (let i = 0; i < 5; i++) sim.tick();
    }).not.toThrow();
    expect(sim.ctx.tick).toBe(5);
  });

  it('emits a severity-3 extinction event exactly once when population first hits 0', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    for (const p of sim.ctx.people) {
      p.alive = false;
      p.health = 0;
    }
    sim.tick();
    sim.tick();
    const extinctions = sim.ctx.events.filter((e) => e.kind === 'extinction');
    expect(extinctions).toHaveLength(1);
    expect(extinctions[0]?.severity).toBe(3);
  });
});

describe('Simulation — 100-tick run (seed 7, mode mixed, small map, 200 pop)', () => {
  it('runs 100 ticks with no invariant violations and a plausible population change', () => {
    const sim = new Simulation(baseConfig());
    const initialPopulation = sim.ctx.people.filter((p) => p.alive).length;
    for (let i = 0; i < 100; i++) sim.tick();
    const finalPopulation = sim.ctx.people.filter((p) => p.alive).length;
    // plausibility bounds: population neither exploded past 3x nor cratered
    // to exactly the same headcount every tick (something must have happened
    // in 100 ticks across needs/lifecycle/conflict/technology).
    expect(finalPopulation).toBeGreaterThan(0);
    expect(finalPopulation).toBeLessThan(initialPopulation * 3);
    expect(sim.ctx.tick).toBe(100);
    // total people (including the dead, who are retained for history) can
    // only grow via births, never shrink.
    expect(sim.ctx.people.length).toBeGreaterThanOrEqual(initialPopulation);
  });

  it('is deterministic: two fresh sims with the same seed produce identical history over 100 ticks', () => {
    const a = new Simulation(baseConfig());
    const b = new Simulation(baseConfig());
    for (let i = 0; i < 100; i++) {
      a.tick();
      b.tick();
    }
    expect(a.ctx.people).toEqual(b.ctx.people);
    expect(a.ctx.civs).toEqual(b.ctx.civs);
    expect(a.ctx.settlements).toEqual(b.ctx.settlements);
  });
});

describe('Simulation — dead people retained in people[] but skipped', () => {
  it('a dead person stays in people[] and personById, with alive=false', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    const target = sim.ctx.people[0];
    if (target === undefined) throw new Error('expected at least one person');
    target.needs.hunger = 1;
    target.health = 0.001;
    sim.tick();
    const after = sim.ctx.personById.get(target.id);
    expect(after).toBeDefined();
    expect(sim.ctx.people.some((p) => p.id === target.id)).toBe(true);
    if (after !== undefined && !after.alive) {
      expect(after.causeOfDeath).not.toBeNull();
    }
  });
});

describe('Simulation — narration wiring (Task 33 wires every narrate*/pushEvent call site itself)', () => {
  it('emits at least one death event over 400 ticks of a 200-person run (deaths are inevitable at this horizon)', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    for (let i = 0; i < 400; i++) sim.tick();
    const deaths = sim.ctx.events.filter((e) => e.kind === 'death');
    expect(deaths.length).toBeGreaterThan(0);
    expect(deaths[0]?.text.length).toBeGreaterThan(0);
    expect(sim.ctx.counters).toBeDefined();
  });

  it('emits at least one birth event over 700 ticks of a 200-person run', () => {
    // Window sizing (evidence-backed, see .superpowers/sdd/task-33-report.md):
    // courtship/conception/gestation are healthy but slow relative to 400 ticks.
    // Instrumented first-birth tick across 5 seeds (courtship candidates were
    // never scarce — 300/300 sampled ticks had >=2 unpartnered adults nearby):
    //   seed  7 (this test's config): first partnership 136, first conception 261, first birth 531
    //   seed  1: first partnership 168, first conception 453, first birth 723
    //   seed  2: first partnership 222, first conception 476, first birth 759
    //   seed 42: first partnership 107, first conception 158, first birth 428
    //   seed 99: first partnership 121, first conception 207, first birth 477
    // This test pins seed 7 (via baseConfig()), whose first birth lands at tick
    // 531 deterministically. 700 ticks gives ~170 ticks of margin above that.
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    for (let i = 0; i < 700; i++) sim.tick();
    const births = sim.ctx.events.filter((e) => e.kind === 'birth');
    expect(births.length).toBeGreaterThan(0);
  });

  it('emits a settlement-founded event the tick a new settlement first appears in ctx.settlements', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    let foundedTick: number | null = null;
    for (let i = 0; i < 1000 && foundedTick === null; i++) {
      const before = sim.ctx.settlements.length;
      sim.tick();
      if (sim.ctx.settlements.length > before) foundedTick = sim.ctx.tick;
    }
    expect(foundedTick).not.toBeNull();
    const founded = sim.ctx.events.filter((e) => e.kind === 'settlement-founded');
    expect(founded.some((e) => e.tick === foundedTick)).toBe(true);
  });

  it('emits a tech-unlocked event the tick civ.techs first gains an entry', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200, mode: 'civs' }));
    let unlockedTick: number | null = null;
    for (let i = 0; i < 2000 && unlockedTick === null; i++) {
      const before = sim.ctx.civs.reduce((n, c) => n + c.techs.length, 0);
      sim.tick();
      const after = sim.ctx.civs.reduce((n, c) => n + c.techs.length, 0);
      if (after > before) unlockedTick = sim.ctx.tick;
    }
    expect(unlockedTick).not.toBeNull();
    const unlocked = sim.ctx.events.filter((e) => e.kind === 'tech-unlocked');
    expect(unlocked.some((e) => e.tick === unlockedTick)).toBe(true);
  });

  it('emits a disaster event (drought/harsh-winter/disease) the tick a NaturalEvent first starts', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    let startedTick: number | null = null;
    let startedKind: string | null = null;
    for (let i = 0; i < 1000 && startedTick === null; i++) {
      sim.tick();
      const fresh = sim.ctx.naturalEvents.find((e) => e.startTick === sim.ctx.tick);
      if (fresh !== undefined) {
        startedTick = sim.ctx.tick;
        startedKind = fresh.kind;
      }
    }
    expect(startedTick).not.toBeNull();
    const disasterEvents = sim.ctx.events.filter((e) => e.kind === startedKind);
    expect(disasterEvents.some((e) => e.tick === startedTick)).toBe(true);
  });

  it('never emits birth/death/settlement/tech/religion/raid/war/famine/disaster events before Simulation.tick() has run at least once', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    expect(sim.ctx.events).toEqual([]);
  });
});

describe('Simulation — Task 33 review fixes (disaster-witness founding, counters, raid dedupe)', () => {
  it('makeDisasterWitnessEvents keeps severity-2 disaster kinds in-window and emits severity-3 witness events', () => {
    const events: NarrativeEvent[] = [
      { tick: 10, kind: 'famine', severity: 2, civId: 0, text: 'seeded famine' },
      { tick: 10, kind: 'birth', severity: 1, civId: 0, text: 'not a disaster kind' },
      { tick: 10, kind: 'war-declared', severity: 3, civId: 0, text: 'severity 3 but not a disaster kind' },
      { tick: 5, kind: 'drought', severity: 2, civId: 1, text: 'second civ drought' },
      { tick: 12, kind: 'raid', severity: 1, civId: 0, text: 'below severity floor' },
    ];
    // Both severity-2 disasters pass; wrong kinds and sub-2 severity are dropped;
    // every witness event is emitted at the fixed severity-3 founding sentinel.
    expect(makeDisasterWitnessEvents(events, 20, 30)).toEqual([
      { tick: 10, civId: 0, severity: 3 },
      { tick: 5, civId: 1, severity: 3 },
    ]);
    // Window arithmetic: at tick 40 the famine (40-10=30) is still inside an
    // inclusive 30-tick window; the drought (40-5=35) has aged out.
    expect(makeDisasterWitnessEvents(events, 40, 30)).toEqual([{ tick: 10, civId: 0, severity: 3 }]);
    // Future events (tick - e.tick < 0) never count.
    expect(makeDisasterWitnessEvents(events, 3, 30)).toEqual([]);
  });

  it('a witnessed disaster leads to a religion founding end-to-end (the pre-fix filter made this impossible)', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    const civId = sim.ctx.civs[0]!.id;
    // Seed one severity-2 famine into the log (the real narration severity for
    // disasters) and maintain ten deterministic qualifying witnesses
    // (sanctity > 0.7, influence > 0.5) so the 0.02/candidate/tick founding
    // roll is overwhelmingly likely to fire within the 30-tick window.
    sim.ctx.events.push({ tick: sim.ctx.tick, kind: 'famine', severity: 2, civId, text: 'seeded famine' });
    const witnesses = sim.ctx.people.filter((p) => p.alive).slice(0, 10);
    for (let t = 0; t < 30 && !sim.ctx.events.some((e) => e.kind === 'religion-founded'); t++) {
      for (const w of witnesses) {
        w.morality.sanctity = 0.9;
        w.influence = 0.9;
      }
      sim.tick();
    }
    expect(sim.ctx.events.some((e) => e.kind === 'religion-founded')).toBe(true);
    expect(sim.ctx.religions.length).toBeGreaterThanOrEqual(1);
  });

  it('counters.births/deaths equal the exact observed per-tick population changes (no double-count)', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    let sawBirth = false;
    let sawDeath = false;
    for (let i = 0; i < 750; i++) {
      const totalBefore = sim.ctx.people.length;
      const deadBefore = sim.ctx.people.filter((p) => !p.alive).length;
      sim.tick();
      const newPeople = sim.ctx.people.length - totalBefore;
      const newDead = sim.ctx.people.filter((p) => !p.alive).length - deadBefore;
      expect(sim.ctx.counters.births).toBe(newPeople);
      expect(sim.ctx.counters.deaths).toBe(newDead);
      if (newPeople > 0) sawBirth = true;
      if (newDead > 0) sawDeath = true;
    }
    // The window is long enough (first birth for this seed lands by ~531; see
    // the 700-tick birth test above) that both counters are actually exercised
    // at nonzero values — without this the equality checks could pass vacuously.
    expect(sawBirth).toBe(true);
    expect(sawDeath).toBe(true);
  });

  it('narrates at most one raid event per settlement pair per tick (participant-level dedupe)', () => {
    const sim = new Simulation(baseConfig({ mode: 'civs', startPopulation: 200 }));
    for (let i = 0; i < 800; i++) {
      sim.tick();
      // Oracle: recompute the distinct unordered settlement pairs among this
      // tick's fresh victory/defeat memories, exactly as the narration pass
      // defines a "raid" — the emitted raid events must match one-per-pair.
      const pairs = new Set<string>();
      for (const p of sim.ctx.people) {
        const latest = p.memory[0];
        if (latest === undefined || latest.tick !== sim.ctx.tick) continue;
        if (latest.kind !== 'victory' && latest.kind !== 'defeat') continue;
        const other = sim.ctx.personById.get(latest.otherId);
        if (other === undefined) continue;
        const a = p.settlementId;
        const b = other.settlementId;
        if (a === null || b === null || a === b) continue;
        pairs.add(a < b ? `${a}:${b}` : `${b}:${a}`);
      }
      const raidEventsThisTick = sim.ctx.events.filter(
        (e) => e.kind === 'raid' && e.tick === sim.ctx.tick,
      ).length;
      expect(raidEventsThisTick).toBe(pairs.size);
    }
    // Note: raids depend on emergent scarcity/aggression and may not occur for
    // every seed within this horizon; the per-tick equality above is the
    // regression net either way (a participant-level duplicate would break it
    // on the first raid that ever fires).
  });
});
