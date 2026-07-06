import { describe, expect, it } from 'vitest';
import {
  CONCEPTION_HUNGER_MAX,
  DISEASE_HEALTH_DRAIN,
  GRIEF_IMPULSE,
  isInfected,
  setInfected,
  updateLifecycle,
  type LifecycleCtx,
} from '../../../src/engine/agents/lifecycle';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng, type Rng } from '../../../src/engine/rng';
import type { NaturalEvent } from '../../../src/engine/world/climate';
import {
  GESTATION_TICKS,
  YEAR_TICKS,
  type Civ,
  type Person,
  type TechId,
} from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

/** Deterministic Rng stub: chance() is always true, gaussian() returns the mean. */
const alwaysRng: Rng = {
  next: () => 0.5,
  int: (_maxExclusive: number) => 0,
  range: (min: number, _max: number) => min,
  pick: <T>(arr: readonly T[]): T => arr[0] as T,
  chance: (_p: number) => true,
  gaussian: (mean: number, _sd: number) => mean,
  split: (_label: string): Rng => alwaysRng,
};

/** A normalized adult: 20 years old, healthy, fed, calm, unattached. */
function makePerson(id: number): Person {
  const p = createPerson(id, 0, 'fable', { x: 5, y: 5 }, names, createRng(1000 + id));
  p.alive = true;
  p.ageTicks = 20 * YEAR_TICKS;
  p.lifespanTicks = 1_000_000;
  p.health = 1;
  p.needs.hunger = 0;
  p.emotions = { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 };
  p.memory = [];
  p.relationships = [];
  p.partnerId = null;
  p.pregnantUntil = null;
  p.parentIds = null;
  p.causeOfDeath = null;
  return p;
}

function makeCiv(techs: TechId[] = []): Civ {
  return {
    id: 0,
    name: 'Testia',
    color: '#ffffff',
    knowledge: { fire: 0, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
    techs,
    atWarWith: [],
    warWeariness: 0,
  };
}

interface CtxOpts {
  tick?: number;
  rng?: Rng;
  naturalEvents?: NaturalEvent[];
  civ?: Civ;
}

function makeCtx(people: Person[], opts: CtxOpts = {}): LifecycleCtx {
  return {
    people,
    personById: new Map(people.map((p) => [p.id, p])),
    civs: [opts.civ ?? makeCiv()],
    names,
    tick: opts.tick ?? 1000,
    rng: opts.rng ?? createRng(42),
    naturalEvents: opts.naturalEvents ?? [],
    counters: { births: 0, deaths: 0 },
  };
}

const noopInit = (): unknown => ({});

describe('updateLifecycle — aging and death', () => {
  it('ages a living person by exactly one tick', () => {
    const p = makePerson(1);
    const ctx = makeCtx([p]);
    updateLifecycle(p, ctx, noopInit);
    expect(p.ageTicks).toBe(20 * YEAR_TICKS + 1);
    expect(p.alive).toBe(true);
    expect(ctx.counters.deaths).toBe(0);
  });

  it('does nothing to the dead', () => {
    const p = makePerson(1);
    p.alive = false;
    p.ageTicks = 500;
    const ctx = makeCtx([p]);
    updateLifecycle(p, ctx, noopInit);
    expect(p.ageTicks).toBe(500);
    expect(ctx.counters.deaths).toBe(0);
  });

  it('starvation: sustained hunger drains health to death with causeOfDeath starvation', () => {
    const p = makePerson(1);
    p.needs.hunger = 1;
    p.health = 0.005; // one 0.01 hunger drain kills
    const ctx = makeCtx([p]);
    updateLifecycle(p, ctx, noopInit);
    expect(p.alive).toBe(false);
    expect(p.health).toBe(0);
    expect(p.causeOfDeath).toBe('starvation');
    expect(ctx.counters.deaths).toBe(1);
  });

  it('old age: dies when ageTicks pass lifespanTicks', () => {
    const p = makePerson(1);
    p.ageTicks = 50 * YEAR_TICKS;
    p.lifespanTicks = 50 * YEAR_TICKS; // the +1 aging this tick pushes past the limit
    const ctx = makeCtx([p]);
    updateLifecycle(p, ctx, noopInit);
    expect(p.alive).toBe(false);
    expect(p.causeOfDeath).toBe('old-age');
    expect(p.health).toBe(0);
    expect(ctx.counters.deaths).toBe(1);
  });

  it('honours a causeOfDeath already set by execute.ts (violence)', () => {
    const p = makePerson(1);
    p.health = 0;
    p.causeOfDeath = 'violence';
    const ctx = makeCtx([p]);
    updateLifecycle(p, ctx, noopInit);
    expect(p.alive).toBe(false);
    expect(p.causeOfDeath).toBe('violence');
    expect(ctx.counters.deaths).toBe(1);
  });

  it('grief propagates to partner and kin: impulse 0.5, kin-died memory, widowing', () => {
    const d = makePerson(1);
    const widow = makePerson(2);
    const kin = makePerson(3);
    const stranger = makePerson(4);
    d.partnerId = widow.id;
    widow.partnerId = d.id;
    d.relationships = [{ otherId: kin.id, kind: 'kin', affinity: 0.8 }];
    d.needs.hunger = 1;
    d.health = 0.005; // dies of starvation this tick
    const ctx = makeCtx([d, widow, kin, stranger]);
    updateLifecycle(d, ctx, noopInit);
    expect(d.alive).toBe(false);
    expect(widow.emotions.grief).toBeCloseTo(GRIEF_IMPULSE, 5);
    expect(kin.emotions.grief).toBeCloseTo(GRIEF_IMPULSE, 5);
    expect(stranger.emotions.grief).toBe(0);
    expect(widow.memory[0]).toMatchObject({ kind: 'kin-died', otherId: d.id, tick: ctx.tick });
    expect(kin.memory[0]).toMatchObject({ kind: 'kin-died', otherId: d.id, tick: ctx.tick });
    expect(widow.partnerId).toBeNull();
  });
});

describe('updateLifecycle — disease', () => {
  it('infects people within radius 10 of an active disease event, not beyond', () => {
    const near = makePerson(1);
    near.pos = { x: 5, y: 6 };
    const far = makePerson(2);
    far.pos = { x: 30, y: 30 };
    const disease: NaturalEvent = {
      kind: 'disease',
      startTick: 1000,
      durationTicks: 60,
      center: { x: 5, y: 5 },
      intensity: 1,
    };
    const ctx = makeCtx([near, far], { tick: 1000, rng: alwaysRng, naturalEvents: [disease] });
    updateLifecycle(near, ctx, noopInit);
    updateLifecycle(far, ctx, noopInit);
    expect(isInfected(near, ctx.tick)).toBe(true);
    expect(near.health).toBeCloseTo(1 - DISEASE_HEALTH_DRAIN, 5);
    expect(isInfected(far, ctx.tick)).toBe(false);
    expect(far.health).toBe(1);
  });

  it('medicine tech halves the disease drain', () => {
    const p = makePerson(1);
    setInfected(p, 1100);
    const ctx = makeCtx([p], { civ: makeCiv(['medicine']) }); // tick 1000
    updateLifecycle(p, ctx, noopInit);
    expect(p.health).toBeCloseTo(1 - DISEASE_HEALTH_DRAIN / 2, 5);
  });

  it('an infected person whose health reaches 0 dies of disease', () => {
    const p = makePerson(1);
    setInfected(p, 1100);
    p.health = 0.004; // one full 0.008 drain kills
    const ctx = makeCtx([p]);
    updateLifecycle(p, ctx, noopInit);
    expect(p.alive).toBe(false);
    expect(p.causeOfDeath).toBe('disease');
  });

  it('infection expires at its end tick with no further drain', () => {
    const p = makePerson(1);
    setInfected(p, 1000); // ends exactly at the current tick
    const ctx = makeCtx([p]); // tick 1000, no active events
    updateLifecycle(p, ctx, noopInit);
    expect(isInfected(p, ctx.tick)).toBe(false);
    expect(p.health).toBe(1);
  });
});

describe('updateLifecycle — reproduction', () => {
  it('an eligible partnered female conceives: pregnantUntil = tick + GESTATION_TICKS', () => {
    const mother = makePerson(1);
    mother.sex = 'f';
    const father = makePerson(2);
    father.sex = 'm';
    mother.partnerId = 2;
    father.partnerId = 1;
    const ctx = makeCtx([mother, father], { rng: alwaysRng }); // tick 1000
    updateLifecycle(mother, ctx, noopInit);
    expect(mother.pregnantUntil).toBe(1000 + GESTATION_TICKS);
  });

  it('conception is gated by age window, hunger, partner, sex and existing pregnancy', () => {
    const cases: { label: string; mutate: (mother: Person, father: Person) => void }[] = [
      { label: 'too young (15y)', mutate: (m) => { m.ageTicks = 15 * YEAR_TICKS; } },
      { label: 'too old (46y)', mutate: (m) => { m.ageTicks = 46 * YEAR_TICKS; } },
      { label: 'too hungry (hunger 0.7)', mutate: (m) => { m.needs.hunger = CONCEPTION_HUNGER_MAX; } },
      { label: 'no partner', mutate: (m) => { m.partnerId = null; } },
      { label: 'dead partner', mutate: (_m, f) => { f.alive = false; } },
      { label: 'male', mutate: (m) => { m.sex = 'm'; } },
    ];
    for (const c of cases) {
      const mother = makePerson(1);
      mother.sex = 'f';
      const father = makePerson(2);
      father.sex = 'm';
      mother.partnerId = 2;
      father.partnerId = 1;
      c.mutate(mother, father);
      const ctx = makeCtx([mother, father], { rng: alwaysRng });
      updateLifecycle(mother, ctx, noopInit);
      expect(mother.pregnantUntil, c.label).toBeNull();
    }

    // an existing pregnancy is never re-rolled
    const mother = makePerson(1);
    mother.sex = 'f';
    const father = makePerson(2);
    mother.partnerId = 2;
    mother.pregnantUntil = 5000; // due in the future
    const ctx = makeCtx([mother, father], { rng: alwaysRng });
    updateLifecycle(mother, ctx, noopInit);
    expect(mother.pregnantUntil).toBe(5000);
  });

  it('conception -> gestation -> birth over a tick loop; child inherits lineage, parents, kin and brainState', () => {
    const mother = makePerson(1);
    mother.sex = 'f';
    mother.lineage = 'opus';
    const father = makePerson(2);
    father.sex = 'm';
    father.lineage = 'haiku';
    mother.partnerId = 2;
    father.partnerId = 1;
    const ctx = makeCtx([mother, father], { tick: 0, rng: createRng(123) });
    const brainInit = (child: Person, _rng: Rng): unknown => ({ initializedFor: child.id });

    let conceptionTick = -1;
    let birthTick = -1;
    for (let t = 0; t < 12000 && birthTick === -1; t++) {
      ctx.tick = t;
      updateLifecycle(mother, ctx, brainInit);
      if (conceptionTick === -1 && mother.pregnantUntil !== null) conceptionTick = t;
      if (ctx.counters.births > 0) birthTick = t;
    }

    expect(conceptionTick).toBeGreaterThanOrEqual(0);
    expect(birthTick).toBe(conceptionTick + GESTATION_TICKS);
    expect(ctx.people).toHaveLength(3);
    expect(ctx.counters.births).toBe(1);

    const child = ctx.people[2] as Person;
    expect(child.id).toBe(3);
    expect(child.alive).toBe(true);
    expect(['opus', 'haiku']).toContain(child.lineage);
    expect(child.parentIds).not.toBeNull();
    expect([...(child.parentIds as [number, number])].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(child.brainState).toEqual({ initializedFor: child.id });
    expect(ctx.personById.get(child.id)).toBe(child);
    expect(mother.pregnantUntil).toBeNull();
    expect(mother.relationships.some((r) => r.otherId === child.id && r.kind === 'kin')).toBe(true);
    expect(child.relationships.some((r) => r.otherId === mother.id && r.kind === 'kin')).toBe(true);
    expect(mother.memory.some((m) => m.kind === 'birth' && m.otherId === child.id)).toBe(true);
  });

  it('no living father at term: the pregnancy ends without a birth', () => {
    const mother = makePerson(1);
    mother.sex = 'f';
    const father = makePerson(2);
    father.alive = false;
    mother.partnerId = 2;
    mother.pregnantUntil = 1000; // due exactly now
    const ctx = makeCtx([mother, father]); // tick 1000
    updateLifecycle(mother, ctx, noopInit);
    expect(ctx.counters.births).toBe(0);
    expect(ctx.people).toHaveLength(2);
    expect(mother.pregnantUntil).toBeNull();
  });
});
