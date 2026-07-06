import { describe, expect, it } from 'vitest';
import { getBrain } from '../../../src/engine/brains/registry';
import type { Temperament } from '../../../src/engine/brains/types';
import { createPerson } from '../../../src/engine/agents/person';
import { updateNeeds } from '../../../src/engine/agents/needs';
import { decayEmotions } from '../../../src/engine/agents/emotions';
import { buildPerception, type PerceptionCtxLike } from '../../../src/engine/agents/perception';
import { executeAction } from '../../../src/engine/agents/execute';
import { chooseAction } from '../../../src/engine/agents/decide';
import { updateLifecycle, type LifecycleCtx } from '../../../src/engine/agents/lifecycle';
import { reinforce } from '../../../src/engine/agents/learning';
import type { TechCtxLike } from '../../../src/engine/agents/execute';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng, type Rng } from '../../../src/engine/rng';
import { SpatialIndex } from '../../../src/engine/world/spatial';
import { generateWorld, type World } from '../../../src/engine/world/terrain';
import type { NaturalEvent } from '../../../src/engine/world/climate';
import {
  LINEAGES,
  type Civ,
  type Lineage,
  type Person,
  type Settlement,
} from '../../../src/shared/types';

const POPULATION = 60;
const TICKS = 500;
const WORLD_SIZE = 48;

interface MiniCtx extends PerceptionCtxLike, LifecycleCtx {
  world: World;
  people: Person[];
  personById: Map<number, Person>;
  civs: Civ[];
  settlements: Settlement[];
  spatial: SpatialIndex;
  names: ReturnType<typeof makeNameGenerator>;
  tick: number;
  rng: Rng;
  naturalEvents: NaturalEvent[];
  counters: { births: number; deaths: number };
  tech: TechCtxLike;
}

const STUB_TECH: TechCtxLike = {
  yieldMultiplier: () => 1,
  addKnowledge: () => {
    // no-op: technology.ts (Task 29) is out of scope for this simplified loop
  },
};

function makeMiniWorld(seed: number): { ctx: MiniCtx; decideCounts: Record<Lineage, number> } {
  const rng = createRng(seed);
  const names = makeNameGenerator(rng.split('names'));
  const world = generateWorld(WORLD_SIZE, rng.split('world'));

  const civ: Civ = {
    id: 0,
    name: 'Mixed Testia',
    color: '#ffffff',
    knowledge: { fire: 0, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
    techs: [],
    atWarWith: [],
    warWeariness: 0,
  };

  const people: Person[] = [];
  for (let i = 0; i < POPULATION; i++) {
    const lineage = LINEAGES[i % LINEAGES.length] as Lineage;
    // Scatter within a habitable-ish central box; person creation doesn't
    // require habitability, and executeAction/legalActions tolerate any
    // in-bounds tile for this simplified loop.
    const x = 10 + (i % 10);
    const y = 10 + Math.floor(i / 10);
    const p = createPerson(i + 1, 0, lineage, { x, y }, names, rng.split(`person-${i}`));
    p.brainState = getBrain(lineage).init(p, rng.split(`init-${i}`));
    people.push(p);
  }

  const spatial = new SpatialIndex();
  spatial.rebuild(people);

  const ctx: MiniCtx = {
    world,
    people,
    personById: new Map(people.map((p) => [p.id, p])),
    civs: [civ],
    settlements: [],
    spatial,
    names,
    tick: 0,
    rng: rng.split('tick'),
    naturalEvents: [],
    counters: { births: 0, deaths: 0 },
    tech: STUB_TECH,
  };

  const decideCounts = { opus: 0, sonnet: 0, haiku: 0, fable: 0 } as Record<Lineage, number>;
  return { ctx, decideCounts };
}

/** One simplified tick: no society modules (settlements/religion/tech/conflict). */
function simplifiedTick(ctx: MiniCtx, decideCounts: Record<Lineage, number>): void {
  ctx.spatial.rebuild(ctx.people);

  for (const p of [...ctx.people]) {
    if (!p.alive) continue;
    const brain = getBrain(p.lineage);
    const temperament = brain.temperament();

    updateNeeds(p, ctx.tick);
    decayEmotions(p, temperament.emotionDecayPerTick);

    const perception = buildPerception(p, ctx, temperament.taboos);
    const action = chooseAction(p, perception, brain, ctx.rng);
    decideCounts[p.lineage] += 1;

    const outcome = executeAction(p, action, ctx, temperament.emotionVolatility);
    reinforce(p, outcome, temperament.learningRate);
    brain.onOutcome(outcome, p.brainState, ctx.rng);
  }

  for (const p of [...ctx.people]) {
    updateLifecycle(p, ctx, (child, rng) => getBrain(child.lineage).init(child, rng));
  }

  ctx.tick += 1;
}

function hasNaN(p: Person): boolean {
  const numericGroups = [p.traits, p.emotions, p.morality, p.needs, p.skills, p.inventory, p.actionWeights];
  for (const group of numericGroups) {
    for (const v of Object.values(group as Record<string, number>)) {
      if (typeof v === 'number' && !Number.isFinite(v)) return true;
    }
  }
  if (!Number.isFinite(p.health) || !Number.isFinite(p.ageTicks) || !Number.isFinite(p.influence)) return true;
  return false;
}

describe('brain integration: 60-person 4-lineage mini world over 500 ticks', () => {
  it('every lineage keeps making decisions across the run', () => {
    const { ctx, decideCounts } = makeMiniWorld(2024);
    for (let t = 0; t < TICKS; t++) {
      simplifiedTick(ctx, decideCounts);
    }
    for (const lineage of LINEAGES) {
      expect(decideCounts[lineage]).toBeGreaterThan(0);
    }
  });

  it('pairwise temperaments differ in at least 2 fields per pair', () => {
    const temperaments: { lineage: Lineage; t: Temperament }[] = LINEAGES.map((l) => ({
      lineage: l,
      t: getBrain(l).temperament(),
    }));
    const scalarFields: (keyof Pick<Temperament, 'moralWeight' | 'learningRate' | 'imitationRate' | 'desperationThreshold'>)[] = [
      'moralWeight',
      'learningRate',
      'imitationRate',
      'desperationThreshold',
    ];
    const emotionFields = ['fear', 'joy', 'grief', 'anger', 'hope'] as const;

    for (let i = 0; i < temperaments.length; i++) {
      for (let j = i + 1; j < temperaments.length; j++) {
        const a = temperaments[i] as { lineage: Lineage; t: Temperament };
        const b = temperaments[j] as { lineage: Lineage; t: Temperament };
        let diffCount = 0;
        for (const f of scalarFields) {
          if (a.t[f] !== b.t[f]) diffCount += 1;
        }
        for (const f of emotionFields) {
          if (a.t.emotionVolatility[f] !== b.t.emotionVolatility[f]) diffCount += 1;
          if (a.t.emotionDecayPerTick[f] !== b.t.emotionDecayPerTick[f]) diffCount += 1;
        }
        if (a.t.taboos.length !== b.t.taboos.length || a.t.taboos.some((x, k) => x !== b.t.taboos[k])) diffCount += 1;
        if (a.t.description !== b.t.description) diffCount += 1;
        expect(diffCount, `${a.lineage} vs ${b.lineage} temperament too similar`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('children born inherit only parental lineages, never a third lineage', () => {
    const { ctx, decideCounts } = makeMiniWorld(4242);

    // Force reproduction odds up: pair a same-index opposite-sex adjacent
    // sample of people as partners so conception has candidates to work with
    // over 500 ticks (maybeConceive still gates on age/hunger/chance).
    for (let i = 0; i + 1 < ctx.people.length; i += 2) {
      const a = ctx.people[i] as Person;
      const b = ctx.people[i + 1] as Person;
      a.sex = 'f';
      b.sex = 'm';
      a.partnerId = b.id;
      b.partnerId = a.id;
      a.needs.hunger = 0;
      b.needs.hunger = 0;
    }

    const startIds = new Set(ctx.people.map((p) => p.id));
    const parentLineageById = new Map(ctx.people.map((p) => [p.id, p.lineage]));

    for (let t = 0; t < TICKS; t++) {
      simplifiedTick(ctx, decideCounts);
    }

    const children = ctx.people.filter((p) => !startIds.has(p.id));
    for (const child of children) {
      expect(child.parentIds).not.toBeNull();
      const [motherId, fatherId] = child.parentIds as [number, number];
      const motherLineage = parentLineageById.get(motherId);
      const fatherLineage = parentLineageById.get(fatherId);
      expect([motherLineage, fatherLineage]).toContain(child.lineage);
    }
  });

  it('no NaN appears in any person numeric field after 500 ticks', () => {
    const { ctx, decideCounts } = makeMiniWorld(99);
    for (let t = 0; t < TICKS; t++) {
      simplifiedTick(ctx, decideCounts);
    }
    for (const p of ctx.people) {
      expect(hasNaN(p), `person ${p.id} (${p.lineage}) has a non-finite numeric field`).toBe(false);
    }
  });
});
