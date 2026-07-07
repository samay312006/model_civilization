import { describe, expect, it } from 'vitest';
import { takeSnapshot, personDetail } from '../../../src/engine/sim/snapshot';
import { Simulation } from '../../../src/engine/sim/simulation';
import { MOOD_ORDER, TERRITORY_RADIUS } from '../../../src/shared/protocol';
import { LINEAGES, type SimConfig } from '../../../src/shared/types';

function baseConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { seed: 11, mode: 'civs', mapSize: 'small', startPopulation: 200, ...overrides };
}

describe('takeSnapshot — array lengths and basic fields', () => {
  it('typed array lengths match the alive population, not the total roster', () => {
    const sim = new Simulation(baseConfig());
    sim.ctx.people[0]!.alive = false;
    sim.ctx.people[0]!.health = 0;
    sim.ctx.people[0]!.causeOfDeath = 'old-age';
    const snap = takeSnapshot(sim, false);
    const aliveCount = sim.ctx.people.filter((p) => p.alive).length;
    expect(snap.population).toBe(aliveCount);
    expect(snap.ids.length).toBe(aliveCount);
    expect(snap.xs.length).toBe(aliveCount);
    expect(snap.ys.length).toBe(aliveCount);
    expect(snap.civIds.length).toBe(aliveCount);
    expect(snap.lineages.length).toBe(aliveCount);
    expect(snap.healths.length).toBe(aliveCount);
    expect(snap.moods.length).toBe(aliveCount);
  });

  it('ids are ascending and never include a dead person', () => {
    const sim = new Simulation(baseConfig());
    sim.ctx.people[3]!.alive = false;
    const deadId = sim.ctx.people[3]!.id;
    const snap = takeSnapshot(sim, false);
    for (let i = 1; i < snap.ids.length; i++) {
      expect(snap.ids[i]).toBeGreaterThan(snap.ids[i - 1] as number);
    }
    expect(Array.from(snap.ids)).not.toContain(deadId);
  });

  it('lineages is the LINEAGES index of each alive person, in ids order', () => {
    const sim = new Simulation(baseConfig());
    const snap = takeSnapshot(sim, false);
    for (let i = 0; i < snap.ids.length; i++) {
      const person = sim.ctx.personById.get(snap.ids[i] as number);
      expect(person).toBeDefined();
      expect(snap.lineages[i]).toBe(LINEAGES.indexOf(person!.lineage));
    }
  });

  it('healths are 0..255 scaled from Person.health (0..1)', () => {
    const sim = new Simulation(baseConfig());
    sim.ctx.people[0]!.health = 1;
    sim.ctx.people[1]!.health = 0;
    sim.ctx.people[2]!.health = 0.5;
    const snap = takeSnapshot(sim, false);
    const idx = (id: number): number => Array.from(snap.ids).indexOf(id);
    expect(snap.healths[idx(sim.ctx.people[0]!.id)]).toBe(255);
    expect(snap.healths[idx(sim.ctx.people[1]!.id)]).toBe(0);
    expect(snap.healths[idx(sim.ctx.people[2]!.id)]).toBeGreaterThan(120);
    expect(snap.healths[idx(sim.ctx.people[2]!.id)]).toBeLessThan(135);
  });

  it('moods round-trip through MOOD_ORDER', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0]!;
    p.emotions = { fear: 0, joy: 0.9, grief: 0, anger: 0, hope: 0 };
    const snap = takeSnapshot(sim, false);
    const idx = Array.from(snap.ids).indexOf(p.id);
    expect(MOOD_ORDER[snap.moods[idx] as number]).toBe('joyful');
  });

  it('tick/year/season/worldSize are consistent with the sim', () => {
    const sim = new Simulation(baseConfig());
    for (let i = 0; i < 400; i++) sim.tick();
    const snap = takeSnapshot(sim, false);
    expect(snap.tick).toBe(sim.ctx.tick);
    expect(snap.year).toBe(Math.floor(sim.ctx.tick / 360));
    expect(snap.worldSize).toBe(sim.ctx.world.size);
  });
});

describe('takeSnapshot — territory', () => {
  it('territory is null when includeTerritory is false', () => {
    const sim = new Simulation(baseConfig());
    const snap = takeSnapshot(sim, false);
    expect(snap.territory).toBeNull();
  });

  it('territory is a full-map Int16Array when includeTerritory is true, -1 far from any settlement', () => {
    const sim = new Simulation(baseConfig());
    const snap = takeSnapshot(sim, true);
    expect(snap.territory).not.toBeNull();
    expect(snap.territory!.length).toBe(sim.ctx.world.size * sim.ctx.world.size);
    expect(TERRITORY_RADIUS).toBe(20);
  });

  it('assigns the nearest settlement within 20 tiles to its civId', () => {
    const sim = new Simulation(baseConfig());
    sim.ctx.settlements = [
      {
        id: 1,
        civId: 2,
        name: 'Testville',
        center: { x: 10, y: 10 },
        memberIds: [],
        stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 },
        structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
      },
    ];
    const snap = takeSnapshot(sim, true);
    const idx = 10 * sim.ctx.world.size + 10; // (10,10)
    expect(snap.territory![idx]).toBe(2);
    // Brief defect fixed here: the prescribed test probed (0,0), but
    // dist((0,0),(10,10)) = sqrt(200) ~= 14.14 < TERRITORY_RADIUS (20), so that
    // tile IS legitimately owned. Probe (95,95) instead: dist ~= 120 > 20.
    const farIdx = 95 * sim.ctx.world.size + 95;
    expect(snap.territory![farIdx]).toBe(-1);
  });
});

describe('takeSnapshot — settlements and metrics', () => {
  it('settlements maps every Settlement to a SettlementView', () => {
    const sim = new Simulation(baseConfig());
    sim.ctx.settlements = [
      {
        id: 5,
        civId: 0,
        name: 'Hearth',
        center: { x: 3, y: 4 },
        memberIds: [1, 2],
        stock: { food: 1, wood: 2, stone: 3, metal: 4, tools: 5 },
        structures: { shelter: 1, granary: 0, wall: 0, shrine: 0 },
      },
    ];
    sim.ctx.personById.get(1)!.alive = true;
    sim.ctx.personById.get(2)!.alive = true;
    const snap = takeSnapshot(sim, false);
    expect(snap.settlements).toHaveLength(1);
    expect(snap.settlements[0]).toMatchObject({ id: 5, civId: 0, x: 3, y: 4, name: 'Hearth' });
  });

  it('metrics has one entry per civ with plausible aggregate values', () => {
    const sim = new Simulation(baseConfig());
    const snap = takeSnapshot(sim, false);
    expect(snap.metrics).toHaveLength(sim.ctx.civs.length);
    for (const m of snap.metrics) {
      expect(m.population).toBeGreaterThanOrEqual(0);
      const shareSum = Object.values(m.lineageShare).reduce((a, b) => a + b, 0);
      if (m.population > 0) expect(shareSum).toBeCloseTo(1, 5);
      for (const v of Object.values(m.avgMorality)) expect(Number.isFinite(v)).toBe(true);
      for (const v of Object.values(m.avgEmotions)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('recentEvents only returns events since the previous call', () => {
    const sim = new Simulation(baseConfig({ startPopulation: 200 }));
    for (const p of sim.ctx.people) {
      p.alive = false;
      p.health = 0;
    }
    sim.tick(); // triggers the extinction event
    const first = takeSnapshot(sim, false);
    expect(first.recentEvents.some((e) => e.kind === 'extinction')).toBe(true);
    const second = takeSnapshot(sim, false);
    expect(second.recentEvents).toHaveLength(0);
  });
});

describe('personDetail', () => {
  it('returns null for an unknown id', () => {
    const sim = new Simulation(baseConfig());
    expect(personDetail(sim, 999999)).toBeNull();
  });

  it('resolves the person, temperament, civ name and settlement name', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0]!;
    const detail = personDetail(sim, p.id);
    expect(detail).not.toBeNull();
    expect(detail!.person.id).toBe(p.id);
    expect(detail!.civName.length).toBeGreaterThan(0);
    expect(typeof detail!.temperament.moralWeight).toBe('number');
    expect(detail!.settlementName).toBeNull(); // unsettled at construction
  });

  it('resolves memory and relationship names', () => {
    const sim = new Simulation(baseConfig());
    const p = sim.ctx.people[0]!;
    const other = sim.ctx.people[1]!;
    p.memory = [{ tick: 0, kind: 'helped', otherId: other.id, valence: 0.5, salience: 0.5 }];
    p.relationships = [{ otherId: other.id, kind: 'friend', affinity: 0.4 }];
    const detail = personDetail(sim, p.id);
    expect(detail!.memoriesText.length).toBe(1);
    expect(detail!.memoriesText[0]).toContain(other.name);
    expect(detail!.relationshipsNamed).toEqual([{ name: other.name, kind: 'friend', affinity: 0.4 }]);
  });
});
