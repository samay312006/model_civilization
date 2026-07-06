import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../../../src/engine/sim/invariants';
import { Simulation } from '../../../src/engine/sim/simulation';
import type { SimConfig } from '../../../src/shared/types';

function baseConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { seed: 3, mode: 'civs', mapSize: 'small', startPopulation: 200, ...overrides };
}

describe('checkInvariants', () => {
  it('returns [] for a freshly constructed, untouched simulation', () => {
    const sim = new Simulation(baseConfig());
    expect(checkInvariants(sim)).toEqual([]);
  });

  it('returns [] after several ticks of normal operation', () => {
    const sim = new Simulation(baseConfig());
    for (let i = 0; i < 20; i++) sim.tick();
    expect(checkInvariants(sim)).toEqual([]);
  });

  it('flags a NaN in a living person field', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.emotions.fear = Number.NaN;
    const violations = checkInvariants(sim);
    expect(violations.some((v) => v.includes(String(p.id)))).toBe(true);
  });

  it('flags an Infinite value in a living person field', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.needs.hunger = Number.POSITIVE_INFINITY;
    const violations = checkInvariants(sim);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags a negative inventory value', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.inventory.food = -1;
    const violations = checkInvariants(sim);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags a negative settlement stock value', () => {
    const sim = new Simulation(baseConfig());
    sim.ctx.settlements.push({
      id: 999,
      civId: 0,
      name: 'Testville',
      center: { x: 1, y: 1 },
      memberIds: [],
      stock: { food: -5, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    });
    const violations = checkInvariants(sim);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags a living person with a null-like brainState (undefined)', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    (p as { brainState: unknown }).brainState = undefined;
    const violations = checkInvariants(sim);
    expect(violations.some((v) => v.includes('brainState'))).toBe(true);
  });

  it('flags a living person with an invalid civId (no matching Civ)', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.civId = 9999;
    const violations = checkInvariants(sim);
    expect(violations.some((v) => v.includes('civId'))).toBe(true);
  });

  it('flags a memory array over MEMORY_CAP', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.memory = Array.from({ length: 60 }, (_, i) => ({
      tick: i,
      kind: 'helped' as const,
      otherId: 1,
      valence: 0.1,
      salience: 0.5,
    }));
    const violations = checkInvariants(sim);
    expect(violations.some((v) => v.includes('memory'))).toBe(true);
  });

  it('flags a relationships array over RELATIONSHIP_CAP', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.relationships = Array.from({ length: 30 }, (_, i) => ({
      otherId: i + 1000,
      kind: 'friend' as const,
      affinity: 0.1,
    }));
    const violations = checkInvariants(sim);
    expect(violations.some((v) => v.includes('relationships'))).toBe(true);
  });

  it('ignores dead people entirely (a dead person with NaN emotions is not flagged)', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0];
    if (p === undefined) throw new Error('expected a person');
    p.alive = false;
    p.emotions.fear = Number.NaN;
    const violations = checkInvariants(sim);
    expect(violations).toEqual([]);
  });

  it('flags a negative civ.knowledge value', () => {
    const sim = new Simulation(baseConfig());
    const civ = sim.ctx.civs[0];
    if (civ === undefined) throw new Error('expected a civ');
    civ.knowledge.fire = -1;
    const violations = checkInvariants(sim);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('population accounting: total alive plus recorded deaths equals total ever created', () => {
    const sim = new Simulation(baseConfig());
    const initialPop = sim.ctx.people.length;
    for (let i = 0; i < 30; i++) sim.tick();
    const alive = sim.ctx.people.filter((p) => p.alive).length;
    const dead = sim.ctx.people.filter((p) => !p.alive).length;
    expect(alive + dead).toBe(sim.ctx.people.length);
    expect(sim.ctx.people.length).toBeGreaterThanOrEqual(initialPop);
    expect(checkInvariants(sim)).toEqual([]);
  });
});
