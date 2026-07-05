import { describe, expect, it } from 'vitest';
import {
  BELONGING_ADAPT_RATE,
  ESTEEM_ADAPT_RATE,
  HUNGER_HEALTH_DRAIN,
  HUNGER_RATE,
  HUNGER_RATE_FED,
  REST_RATE,
  SAFETY_DECAY,
  applyHungerHealth,
  markFed,
  updateNeeds,
  wasFedToday,
} from '../../../src/engine/agents/needs';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import type { Person } from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function makePerson(): Person {
  const p = createPerson(1, 0, 'fable', { x: 0, y: 0 }, names, createRng(1));
  p.needs = { hunger: 0, safety: 0, rest: 0, belonging: 0, esteem: 0 };
  p.memory = [];
  p.relationships = [];
  p.influence = 0;
  return p;
}

describe('updateNeeds — hunger', () => {
  it('increases hunger by HUNGER_RATE when not fed', () => {
    const p = makePerson();
    updateNeeds(p, 100);
    expect(p.needs.hunger).toBeCloseTo(HUNGER_RATE, 6);
  });

  it('increases hunger by only HUNGER_RATE_FED when markFed was called this tick, and consumes the flag', () => {
    const p = makePerson();
    markFed(p);
    updateNeeds(p, 100);
    expect(p.needs.hunger).toBeCloseTo(HUNGER_RATE_FED, 6);
    updateNeeds(p, 101); // fed flag consumed; back to the full rate
    expect(p.needs.hunger).toBeCloseTo(HUNGER_RATE_FED + HUNGER_RATE, 6);
  });

  it('wasFedToday can peek without consuming', () => {
    const p = makePerson();
    markFed(p);
    expect(wasFedToday(p, false)).toBe(true);
    expect(wasFedToday(p, false)).toBe(true); // still set
    expect(wasFedToday(p, true)).toBe(true); // now consumed
    expect(wasFedToday(p, false)).toBe(false);
  });

  it('clamps hunger at 1', () => {
    const p = makePerson();
    p.needs.hunger = 0.995;
    updateNeeds(p, 1);
    expect(p.needs.hunger).toBe(1);
  });
});

describe('updateNeeds — rest', () => {
  it('increases rest by REST_RATE per tick', () => {
    const p = makePerson();
    updateNeeds(p, 1);
    expect(p.needs.rest).toBeCloseTo(REST_RATE, 6);
  });
});

describe('updateNeeds — safety', () => {
  it('decays toward 0 with no recent threat memories', () => {
    const p = makePerson();
    p.needs.safety = 0.5;
    updateNeeds(p, 1000);
    expect(p.needs.safety).toBeCloseTo(0.49, 6);
  });

  it('is raised by a recent harmed memory within the window', () => {
    const p = makePerson();
    p.needs.safety = 0;
    p.memory = [{ tick: 950, kind: 'harmed', otherId: 9, valence: -0.8, salience: 0.9 }];
    updateNeeds(p, 1000); // within SAFETY_MEMORY_WINDOW (90)
    expect(p.needs.safety).toBeCloseTo(0.035, 6); // -0.01 + 0.05*0.9
  });

  it('ignores threat memories outside the window', () => {
    const p = makePerson();
    p.needs.safety = 0.2;
    p.memory = [{ tick: 800, kind: 'harmed', otherId: 9, valence: -0.8, salience: 0.9 }];
    updateNeeds(p, 1000); // 200 ticks old, outside SAFETY_MEMORY_WINDOW
    expect(p.needs.safety).toBeCloseTo(0.19, 6);
  });

  it('caps the total threat contribution at 1.0 worth of salience', () => {
    const p = makePerson();
    p.needs.safety = 0;
    p.memory = Array.from({ length: 5 }, (_, i) => ({
      tick: 999,
      kind: 'harmed' as const,
      otherId: i,
      valence: -0.5,
      salience: 0.9,
    }));
    updateNeeds(p, 1000); // sum salience 4.5 -> capped to 1.0 contribution
    expect(p.needs.safety).toBeCloseTo(0.04, 6); // -0.01 + 0.05*1.0
  });
});

describe('updateNeeds — belonging and esteem', () => {
  it('belonging relaxes toward a lower target with more relationships', () => {
    const lonely = makePerson();
    lonely.needs.belonging = 0;
    updateNeeds(lonely, 1);
    // target = 0.9 - 0.15*0 = 0.9; belonging += 0.05*(0.9-0) = 0.045
    expect(lonely.needs.belonging).toBeCloseTo(0.045, 6);

    const social = makePerson();
    social.needs.belonging = 0;
    social.relationships = Array.from({ length: 6 }, (_, i) => ({
      otherId: i,
      kind: 'friend' as const,
      affinity: 0.5,
    }));
    updateNeeds(social, 1);
    // target = 0.9 - 0.15*6 = 0; belonging += 0.05*(0-0) = 0
    expect(social.needs.belonging).toBeCloseTo(0, 6);
  });

  it('esteem relaxes toward a lower target with more influence', () => {
    const p = makePerson();
    p.influence = 0.9;
    p.needs.esteem = 0.5;
    updateNeeds(p, 1);
    // target = 0.9 - 0.9 = 0; esteem += 0.05*(0-0.5) = -0.025
    expect(p.needs.esteem).toBeCloseTo(0.475, 6);
  });
});

describe('applyHungerHealth', () => {
  it('does nothing at or below the 0.85 threshold', () => {
    const p = makePerson();
    p.needs.hunger = 0.85;
    p.health = 1;
    applyHungerHealth(p);
    expect(p.health).toBe(1);
  });

  it('drains health by HUNGER_HEALTH_DRAIN above the threshold', () => {
    const p = makePerson();
    p.needs.hunger = 0.9;
    p.health = 1;
    applyHungerHealth(p);
    expect(p.health).toBeCloseTo(1 - HUNGER_HEALTH_DRAIN, 6);
  });

  it('clamps health at 0', () => {
    const p = makePerson();
    p.needs.hunger = 1;
    p.health = 0.005;
    applyHungerHealth(p);
    expect(p.health).toBe(0);
  });
});
