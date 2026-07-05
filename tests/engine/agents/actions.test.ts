import { describe, expect, it } from 'vitest';
import {
  CHILD_ACTION_KINDS,
  DESPERATION_TABOO_OVERRIDE,
  legalActions,
  type ActionsCtxLike,
} from '../../../src/engine/agents/actions';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import { SpatialIndex } from '../../../src/engine/world/spatial';
import { World } from '../../../src/engine/world/terrain';
import {
  ACTION_KINDS,
  ADULT_AGE_TICKS,
  type ActionKind,
  type Person,
  type Settlement,
  type Tile,
} from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function flatWorld(size: number, fertility = 0.5, food = 1): World {
  const tiles: Tile[] = Array.from({ length: size * size }, () => ({
    terrain: 'plains',
    fertility,
    food,
    wood: 5,
    stone: 5,
    metal: 0,
  }));
  return new World(size, tiles);
}

function makeCtx(people: Person[], world: World, settlements: Settlement[] = []): ActionsCtxLike {
  const spatial = new SpatialIndex();
  spatial.rebuild(people);
  return {
    world,
    personById: new Map(people.map((p) => [p.id, p])),
    spatial,
    settlements,
    tick: 1000,
  };
}

function makeAdult(id: number, x: number, y: number, sex: 'm' | 'f' = 'm'): Person {
  const p = createPerson(id, 0, 'fable', { x, y }, names, createRng(id + 1));
  p.sex = sex;
  p.needs.hunger = 0;
  p.emotions.fear = 0;
  return p;
}

function makeChild(id: number, x: number, y: number): Person {
  const p = makeAdult(id, x, y);
  p.ageTicks = 5 * 360;
  return p;
}

describe('legalActions — basics', () => {
  it('always includes rest and flee', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0, 0); // no food anywhere
    const actions = legalActions(p, makeCtx([p], world), []);
    expect(actions.some((a) => a.kind === 'rest')).toBe(true);
    expect(actions.some((a) => a.kind === 'flee')).toBe(true);
  });

  it('includes gather candidates only where food > 0', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0.5, 0);
    world.tileAt(10, 10).food = 2; // own tile has food
    const actions = legalActions(p, makeCtx([p], world), []);
    const gathers = actions.filter((a) => a.kind === 'gather');
    expect(gathers.length).toBeGreaterThan(0);
    for (const g of gathers) {
      expect(world.tileAt((g.tile as { x: number }).x, (g.tile as { y: number }).y).food).toBeGreaterThan(0);
    }
  });

  it('includes farm candidates only on fertile-enough habitable tiles', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0.5, 0); // fertility 0.5 > 0.3
    const actions = legalActions(p, makeCtx([p], world), []);
    expect(actions.some((a) => a.kind === 'farm')).toBe(true);
    const infertile = flatWorld(32, 0.1, 0);
    const noFarm = legalActions(p, makeCtx([p], infertile), []);
    expect(noFarm.some((a) => a.kind === 'farm')).toBe(false);
  });

  it('includes craft only with wood or stone in inventory', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0, 0);
    p.inventory = { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 };
    expect(legalActions(p, makeCtx([p], world), []).some((a) => a.kind === 'craft')).toBe(false);
    p.inventory.wood = 1;
    expect(legalActions(p, makeCtx([p], world), []).some((a) => a.kind === 'craft')).toBe(true);
  });

  it('includes worship only with at least one belief', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0, 0);
    expect(legalActions(p, makeCtx([p], world), []).some((a) => a.kind === 'worship')).toBe(false);
    p.beliefIds = [1];
    expect(legalActions(p, makeCtx([p], world), []).some((a) => a.kind === 'worship')).toBe(true);
  });

  it('build requires a settlement; one candidate per structure kind', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0, 0);
    expect(legalActions(p, makeCtx([p], world), []).some((a) => a.kind === 'build')).toBe(false);
    p.settlementId = 1;
    const builds = legalActions(p, makeCtx([p], world), []).filter((a) => a.kind === 'build');
    expect(builds.map((b) => b.structure).sort()).toEqual(['granary', 'shelter', 'shrine', 'wall']);
  });
});

describe('legalActions — social/targeted candidates', () => {
  it('socialize/teach/share/heal target every other nearby living person', () => {
    const p = makeAdult(1, 10, 10);
    const other = makeAdult(2, 11, 10);
    other.health = 0.5;
    const world = flatWorld(32, 0, 0);
    const actions = legalActions(p, makeCtx([p, other], world), []);
    expect(actions.some((a) => a.kind === 'socialize' && a.targetPersonId === 2)).toBe(true);
    expect(actions.some((a) => a.kind === 'teach' && a.targetPersonId === 2)).toBe(true);
    expect(actions.some((a) => a.kind === 'share' && a.targetPersonId === 2)).toBe(true);
    expect(actions.some((a) => a.kind === 'heal' && a.targetPersonId === 2)).toBe(true);
  });

  it('heal excludes full-health targets', () => {
    const p = makeAdult(1, 10, 10);
    const other = makeAdult(2, 11, 10);
    other.health = 1;
    const world = flatWorld(32, 0, 0);
    const actions = legalActions(p, makeCtx([p, other], world), []);
    expect(actions.some((a) => a.kind === 'heal')).toBe(false);
  });

  it('court excludes kin, same-sex, partnered and non-adult targets', () => {
    const p = makeAdult(1, 10, 10, 'm');
    const kinF = makeAdult(2, 11, 10, 'f');
    const sameSex = makeAdult(3, 9, 10, 'm');
    const partnered = makeAdult(4, 10, 11, 'f');
    partnered.partnerId = 999;
    const child = makeChild(5, 10, 9);
    const eligible = makeAdult(6, 12, 10, 'f');
    const world = flatWorld(32, 0, 0);
    const people = [p, kinF, sameSex, partnered, child, eligible];
    const ctx = makeCtx(people, world);
    // wire kinship after ctx build (isKin reads p.relationships, not ctx)
    p.relationships = [{ otherId: 2, kind: 'kin', affinity: 0.5 }];
    const targets = legalActions(p, ctx, [])
      .filter((a) => a.kind === 'court')
      .map((a) => a.targetPersonId);
    expect(targets).toEqual([6]);
  });

  it('attack excludes kin', () => {
    const p = makeAdult(1, 10, 10);
    const kin = makeAdult(2, 11, 10);
    const stranger = makeAdult(3, 9, 10);
    p.relationships = [{ otherId: 2, kind: 'kin', affinity: 0.5 }];
    const world = flatWorld(32, 0, 0);
    const targets = legalActions(p, makeCtx([p, kin, stranger], world), [])
      .filter((a) => a.kind === 'attack')
      .map((a) => a.targetPersonId);
    expect(targets).toEqual([3]);
  });

  it('trade/steal require a non-empty target inventory', () => {
    const p = makeAdult(1, 10, 10);
    const empty = makeAdult(2, 11, 10);
    const loaded = makeAdult(3, 9, 10);
    loaded.inventory.food = 5;
    const world = flatWorld(32, 0, 0);
    const actions = legalActions(p, makeCtx([p, empty, loaded], world), []);
    const tradeTargets = actions.filter((a) => a.kind === 'trade').map((a) => a.targetPersonId);
    const stealTargets = actions.filter((a) => a.kind === 'steal' && a.targetPersonId !== undefined).map((a) => a.targetPersonId);
    expect(tradeTargets).toEqual([3]);
    expect(stealTargets).toEqual([3]);
  });

  it('steal can also target a nearby foreign settlement with stock', () => {
    const p = makeAdult(1, 10, 10);
    p.settlementId = 1;
    const world = flatWorld(32, 0, 0);
    const foreign: Settlement = {
      id: 2,
      civId: 9,
      name: 'Rival Town',
      center: { x: 11, y: 10 },
      memberIds: [],
      stock: { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    };
    const actions = legalActions(p, makeCtx([p], world, [foreign]), []);
    expect(actions.some((a) => a.kind === 'steal' && a.tile !== undefined)).toBe(true);
  });
});

describe('legalActions — migrate and explore', () => {
  it('migrate targets only tiles beyond PERCEPTION_RADIUS, capped at 4', () => {
    const p = makeAdult(1, 32, 32);
    const world = flatWorld(64, 0.5, 0);
    const actions = legalActions(p, makeCtx([p], world), []).filter((a) => a.kind === 'migrate');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.length).toBeLessThanOrEqual(4);
  });

  it('explore proposes ring tiles at PERCEPTION_RADIUS+1', () => {
    const p = makeAdult(1, 32, 32);
    const world = flatWorld(64, 0.5, 0);
    const actions = legalActions(p, makeCtx([p], world), []).filter((a) => a.kind === 'explore');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.length).toBeLessThanOrEqual(8);
  });
});

describe('legalActions — taboos and desperation', () => {
  it('removes taboo kinds', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(32, 0, 0);
    const withTaboo = legalActions(p, makeCtx([p], world), ['rest']);
    expect(withTaboo.some((a) => a.kind === 'rest')).toBe(false);
  });

  it('restores taboo kinds once desperation reaches the override threshold', () => {
    const p = makeAdult(1, 10, 10);
    p.needs.hunger = DESPERATION_TABOO_OVERRIDE;
    const world = flatWorld(32, 0, 0);
    const withTaboo = legalActions(p, makeCtx([p], world), ['rest']);
    expect(withTaboo.some((a) => a.kind === 'rest')).toBe(true);
  });

  it('desperation just below the threshold still removes the taboo kind', () => {
    const p = makeAdult(1, 10, 10);
    p.needs.hunger = DESPERATION_TABOO_OVERRIDE - 0.01;
    const world = flatWorld(32, 0, 0);
    const withTaboo = legalActions(p, makeCtx([p], world), ['rest']);
    expect(withTaboo.some((a) => a.kind === 'rest')).toBe(false);
  });
});

describe('legalActions — children', () => {
  it('restricts children to the reduced action set regardless of taboos or desperation', () => {
    const child = makeChild(1, 10, 10);
    child.needs.hunger = 1;
    const other = makeAdult(2, 11, 10);
    const world = flatWorld(32, 0.5, 1);
    const actions = legalActions(child, makeCtx([child, other], world), []);
    const kinds = new Set(actions.map((a) => a.kind));
    for (const kind of kinds) {
      expect(CHILD_ACTION_KINDS).toContain(kind);
    }
    expect(kinds.has('attack')).toBe(false);
    expect(kinds.has('farm')).toBe(false);
    expect(kinds.has('hunt')).toBe(false);
  });
});

describe('legalActions — completeness sanity', () => {
  it('every produced action kind is one of ACTION_KINDS', () => {
    const p = makeAdult(1, 32, 32);
    p.settlementId = 1;
    p.beliefIds = [1];
    p.inventory.wood = 1;
    const other = makeAdult(2, 33, 32, 'f');
    other.health = 0.5;
    const world = flatWorld(64, 0.5, 1);
    const actions = legalActions(p, makeCtx([p, other], world), []);
    for (const a of actions) {
      expect(ACTION_KINDS as readonly ActionKind[]).toContain(a.kind);
    }
  });
});
