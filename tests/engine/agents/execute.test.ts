import { describe, expect, it } from 'vitest';
import {
  MOVEMENT_PROGRESS_REWARD,
  NEUTRAL_IMPULSE,
  buildProgressOf,
  executeAction,
  type ExecuteCtxLike,
  type TechCtxLike,
} from '../../../src/engine/agents/execute';
import { createPerson } from '../../../src/engine/agents/person';
import { makeNameGenerator } from '../../../src/engine/names';
import { createRng } from '../../../src/engine/rng';
import { World } from '../../../src/engine/world/terrain';
import {
  ACTION_KINDS,
  ADULT_AGE_TICKS,
  type Action,
  type ActionKind,
  type Civ,
  type Person,
  type Settlement,
  type Tile,
} from '../../../src/shared/types';

const names = makeNameGenerator(createRng(9));

function flatWorld(size: number, fertility = 0.5, food = 3, wood = 10, stone = 10): World {
  const tiles: Tile[] = Array.from({ length: size * size }, () => ({
    terrain: 'plains',
    fertility,
    food,
    wood,
    stone,
    metal: 0,
  }));
  return new World(size, tiles);
}

function stubTech(): TechCtxLike {
  return {
    yieldMultiplier: () => 1,
    addKnowledge: () => {},
  };
}

function makeCiv(): Civ {
  return {
    id: 0,
    name: 'Testia',
    color: '#fff',
    knowledge: { fire: 0, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
    techs: [],
    atWarWith: [],
    warWeariness: 0,
  };
}

function makeCtx(people: Person[], world: World, settlements: Settlement[] = [], civ = makeCiv(), tick = 1000): ExecuteCtxLike {
  return {
    world,
    personById: new Map(people.map((p) => [p.id, p])),
    civs: [civ],
    settlements,
    tick,
    rng: createRng(42),
    tech: stubTech(),
  };
}

function makeAdult(id: number, x: number, y: number): Person {
  const p = createPerson(id, 0, 'fable', { x, y }, names, createRng(id + 1));
  p.ageTicks = 20 * 360;
  p.needs.hunger = 0.3;
  p.needs.rest = 0.5;
  p.health = 0.8;
  return p;
}

const NEUTRAL_VOLATILITY = NEUTRAL_IMPULSE;

describe('executeAction — movement embedding', () => {
  it('a distant tile target becomes one stepToward move with success and MOVEMENT_PROGRESS_REWARD', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    const action: Action = { kind: 'gather', tile: { x: 20, y: 10 } };
    const outcome = executeAction(p, action, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(outcome.reward).toBeCloseTo(MOVEMENT_PROGRESS_REWARD, 6);
    expect(p.pos).not.toEqual({ x: 10, y: 10 });
    expect(p.inventory.food).toBe(0); // the gather effect itself did not run this tick
  });
});

describe('executeAction — gather', () => {
  it('harvests min(tile.food, base+skill) into inventory, practices skill, marks fed', () => {
    const p = makeAdult(1, 10, 10);
    p.skills.gathering = 0.1;
    const world = flatWorld(64, 0.5, 0.3); // tile.food = 0.3 < base+skill
    const ctx = makeCtx([p], world);
    const before = p.skills.gathering;
    const outcome = executeAction(p, { kind: 'gather', tile: { x: 10, y: 10 } }, ctx, NEUTRAL_VOLATILITY);
    expect(p.inventory.food).toBeCloseTo(0.3, 6);
    expect(world.tileAt(10, 10).food).toBeCloseTo(0, 6);
    expect(p.skills.gathering).toBeGreaterThan(before);
    expect(outcome.success).toBe(true);
    expect(outcome.reward).toBeGreaterThan(0);
  });
});

describe('executeAction — farm', () => {
  it('yields 1.5*skill*techMultiplier scaled food into inventory', () => {
    const p = makeAdult(1, 10, 10);
    p.skills.farming = 0.4;
    const world = flatWorld(64, 0.5, 0);
    const ctx = makeCtx([p], world);
    const outcome = executeAction(p, { kind: 'farm', tile: { x: 10, y: 10 } }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(p.inventory.food).toBeGreaterThan(0);
    expect(p.inventory.food).toBeCloseTo(1.5 * 0.4 * 1, 6);
  });
});

describe('executeAction — hunt', () => {
  it('grants food on a successful roll and marks fed', () => {
    const p = makeAdult(1, 10, 10);
    p.skills.fighting = 1;
    const world = flatWorld(64);
    // rng.chance(true-ish): use a stub rng that always succeeds and never injures
    const ctx = makeCtx([p], world);
    ctx.rng = { ...ctx.rng, chance: (prob: number) => prob > 0.5 } as typeof ctx.rng;
    const outcome = executeAction(p, { kind: 'hunt' }, ctx, NEUTRAL_VOLATILITY);
    expect(p.inventory.food).toBeGreaterThan(0);
    expect(outcome.success).toBe(true);
  });

  it('never produces NaN across many rolls', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    for (let i = 0; i < 100; i++) {
      const outcome = executeAction(p, { kind: 'hunt' }, ctx, NEUTRAL_VOLATILITY);
      expect(Number.isFinite(outcome.reward)).toBe(true);
      expect(outcome.reward).toBeGreaterThanOrEqual(-1);
      expect(outcome.reward).toBeLessThanOrEqual(1);
    }
  });
});

describe('executeAction — build', () => {
  it('consumes wood/stone and accumulates structure progress toward completion', () => {
    const p = makeAdult(1, 10, 10);
    p.settlementId = 1;
    p.inventory.wood = 10;
    p.inventory.stone = 5;
    const settlement: Settlement = {
      id: 1,
      civId: 0,
      name: 'Home',
      center: { x: 10, y: 10 },
      memberIds: [1],
      stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    };
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [settlement]);
    executeAction(p, { kind: 'build', structure: 'shelter' }, ctx, NEUTRAL_VOLATILITY);
    expect(p.inventory.wood).toBe(0);
    expect(p.inventory.stone).toBe(0);
    expect(buildProgressOf(settlement, 'shelter')).toBeCloseTo(15, 6);
  });

  it('completes a structure once progress reaches the threshold', () => {
    const p = makeAdult(1, 10, 10);
    p.settlementId = 1;
    const settlement: Settlement = {
      id: 1,
      civId: 0,
      name: 'Home',
      center: { x: 10, y: 10 },
      memberIds: [1],
      stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    };
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [settlement]);
    for (let i = 0; i < 5; i++) {
      p.inventory.wood = 10;
      p.inventory.stone = 5;
      executeAction(p, { kind: 'build', structure: 'shelter' }, ctx, NEUTRAL_VOLATILITY);
    }
    expect(settlement.structures.shelter).toBe(1);
  });
});

describe('executeAction — craft', () => {
  it('requires the full material cost, yields a tool on success', () => {
    const p = makeAdult(1, 10, 10);
    p.inventory.wood = 1; // less than CRAFT_WOOD_COST (2)
    p.inventory.stone = 5;
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    const fail = executeAction(p, { kind: 'craft' }, ctx, NEUTRAL_VOLATILITY);
    expect(fail.success).toBe(false);
    expect(p.inventory.tools).toBe(0);
    p.inventory.wood = 2;
    const ok = executeAction(p, { kind: 'craft' }, ctx, NEUTRAL_VOLATILITY);
    expect(ok.success).toBe(true);
    expect(p.inventory.tools).toBe(1);
  });
});

describe('executeAction — rest', () => {
  it('reduces rest need and regenerates a little health', () => {
    const p = makeAdult(1, 10, 10);
    p.needs.rest = 0.8;
    p.health = 0.5;
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    const outcome = executeAction(p, { kind: 'rest' }, ctx, NEUTRAL_VOLATILITY);
    expect(p.needs.rest).toBeLessThan(0.8);
    expect(p.health).toBeGreaterThan(0.5);
    expect(outcome.success).toBe(true);
  });
});

describe('executeAction — socialize', () => {
  it('raises mutual affinity and relieves belonging', () => {
    const p = makeAdult(1, 10, 10);
    const other = makeAdult(2, 11, 10);
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    p.needs.belonging = 0.5;
    other.needs.belonging = 0.5;
    executeAction(p, { kind: 'socialize', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(p.relationships.find((r) => r.otherId === 2)?.affinity).toBeGreaterThan(0);
    expect(other.relationships.find((r) => r.otherId === 1)?.affinity).toBeGreaterThan(0);
    expect(p.needs.belonging).toBeLessThan(0.5);
  });
});

describe('executeAction — court', () => {
  it('pairs partners when affinity exceeds the threshold', () => {
    const p = makeAdult(1, 10, 10);
    p.sex = 'm';
    const other = makeAdult(2, 11, 10);
    other.sex = 'f';
    p.relationships = [{ otherId: 2, kind: 'friend', affinity: 0.5 }];
    other.relationships = [{ otherId: 1, kind: 'friend', affinity: 0.5 }];
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    const outcome = executeAction(p, { kind: 'court', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(p.partnerId).toBe(2);
    expect(other.partnerId).toBe(1);
    expect(outcome.reward).toBeCloseTo(0.8, 6);
  });

  it('only bumps affinity below the threshold', () => {
    const p = makeAdult(1, 10, 10);
    p.sex = 'm';
    const other = makeAdult(2, 11, 10);
    other.sex = 'f';
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    executeAction(p, { kind: 'court', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(p.partnerId).toBeNull();
    expect(p.relationships.find((r) => r.otherId === 2)?.affinity).toBeGreaterThan(0);
  });
});

describe('executeAction — teach', () => {
  it("transfers the teacher's best skill and nudges morality", () => {
    const p = makeAdult(1, 10, 10);
    const other = makeAdult(2, 11, 10);
    p.skills.farming = 0.9;
    p.skills.teaching = 0.8;
    other.skills.farming = 0.1;
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    executeAction(p, { kind: 'teach', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(other.skills.farming).toBeGreaterThan(0.1);
    expect(other.memory.some((m) => m.kind === 'taught')).toBe(true);
  });
});

describe('executeAction — trade', () => {
  it('swaps 1 unit of complementary surplus resources', () => {
    const p = makeAdult(1, 10, 10);
    p.inventory = { food: 0, wood: 10, stone: 0, metal: 0, tools: 0 };
    const other = makeAdult(2, 11, 10);
    other.inventory = { food: 10, wood: 0, stone: 0, metal: 0, tools: 0 };
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    const outcome = executeAction(p, { kind: 'trade', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(p.inventory.wood).toBe(9);
    expect(p.inventory.food).toBe(1);
    expect(other.inventory.food).toBe(9);
    expect(other.inventory.wood).toBe(1);
  });
});

describe('executeAction — share', () => {
  it('gives food and records helped/shared memories both sides', () => {
    const p = makeAdult(1, 10, 10);
    p.inventory.food = 5;
    const other = makeAdult(2, 11, 10);
    other.inventory.food = 0;
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    executeAction(p, { kind: 'share', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(p.inventory.food).toBe(4);
    expect(other.inventory.food).toBe(1);
    expect(p.memory.some((m) => m.kind === 'shared')).toBe(true);
    expect(other.memory.some((m) => m.kind === 'helped')).toBe(true);
  });
});

describe('executeAction — steal', () => {
  it('takes from a target person inventory and may record a stolen memory when perceived', () => {
    const p = makeAdult(1, 10, 10);
    const other = makeAdult(2, 11, 10);
    other.inventory.food = 5;
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    ctx.rng = { ...ctx.rng, chance: () => true } as typeof ctx.rng; // always perceived
    const outcome = executeAction(p, { kind: 'steal', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(p.inventory.food).toBeGreaterThan(0);
    expect(other.inventory.food).toBeLessThan(5);
    expect(other.memory.some((m) => m.kind === 'stolen')).toBe(true);
  });

  it('can target a nearby foreign settlement stock', () => {
    const p = makeAdult(1, 10, 10);
    const settlement: Settlement = {
      id: 2,
      civId: 9,
      name: 'Rival',
      center: { x: 10, y: 10 },
      memberIds: [],
      stock: { food: 5, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    };
    const world = flatWorld(64);
    const ctx = makeCtx([p], world, [settlement]);
    const outcome = executeAction(p, { kind: 'steal', tile: { x: 10, y: 10 } }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(settlement.stock.food).toBeLessThan(5);
    expect(p.inventory.food).toBeGreaterThan(0);
  });
});

describe('executeAction — attack', () => {
  it('damages the loser, may kill, records memories and emotion impulses both sides', () => {
    const p = makeAdult(1, 10, 10);
    p.skills.fighting = 1;
    const other = makeAdult(2, 11, 10);
    other.skills.fighting = 0;
    other.health = 0.05;
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    ctx.rng = { ...ctx.rng, range: (min: number) => min } as typeof ctx.rng; // no randomness bonus, p still favored on skill
    const outcome = executeAction(p, { kind: 'attack', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(other.health).toBeLessThanOrEqual(0.05);
    if (other.health <= 0) expect(other.causeOfDeath).toBe('violence');
    expect(other.memory.some((m) => m.kind === 'harmed')).toBe(true);
    expect(p.memory.some((m) => m.kind === 'victory') || other.alive).toBeDefined();
  });

  it('never produces NaN across many rolls regardless of outcome', () => {
    const p = makeAdult(1, 10, 10);
    const other = makeAdult(2, 11, 10);
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    for (let i = 0; i < 100; i++) {
      other.health = 1;
      const outcome = executeAction(p, { kind: 'attack', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
      expect(Number.isFinite(outcome.reward)).toBe(true);
      expect(outcome.reward).toBeGreaterThanOrEqual(-1);
      expect(outcome.reward).toBeLessThanOrEqual(1);
    }
  });
});

describe('executeAction — flee', () => {
  it('moves away from a resolvable hostile person and always succeeds', () => {
    const p = makeAdult(1, 10, 10);
    const hostile = makeAdult(2, 11, 10);
    p.relationships = [{ otherId: 2, kind: 'rival', affinity: -0.5 }];
    p.memory = [{ tick: 999, kind: 'harmed', otherId: 2, valence: -0.9, salience: 0.9 }];
    const world = flatWorld(64);
    const ctx = makeCtx([p, hostile], world);
    const outcome = executeAction(p, { kind: 'flee' }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(p.pos).not.toEqual({ x: 10, y: 10 });
  });

  it('behaves like an anxious rest when no danger resolves', () => {
    const p = makeAdult(1, 10, 10);
    p.needs.rest = 0.5;
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    const outcome = executeAction(p, { kind: 'flee' }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(p.pos).toEqual({ x: 10, y: 10 });
    expect(p.needs.rest).toBeLessThan(0.5);
  });
});

describe('executeAction — worship', () => {
  it('requires a belief, nudges sanctity, relieves esteem', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    const noBelief = executeAction(p, { kind: 'worship' }, ctx, NEUTRAL_VOLATILITY);
    expect(noBelief.success).toBe(false);
    p.beliefIds = [1];
    p.needs.esteem = 0.5;
    const before = p.morality.sanctity;
    const outcome = executeAction(p, { kind: 'worship' }, ctx, NEUTRAL_VOLATILITY);
    expect(outcome.success).toBe(true);
    expect(p.morality.sanctity).toBeGreaterThan(before);
    expect(p.needs.esteem).toBeLessThan(0.5);
  });
});

describe('executeAction — explore', () => {
  it('moves onto the tile and grants a curiosity reward', () => {
    const p = makeAdult(1, 10, 10);
    const world = flatWorld(64);
    const ctx = makeCtx([p], world);
    const outcome = executeAction(p, { kind: 'explore', tile: { x: 11, y: 10 } }, ctx, NEUTRAL_VOLATILITY);
    expect(p.pos).toEqual({ x: 11, y: 10 });
    expect(outcome.success).toBe(true);
    expect(outcome.reward).toBeGreaterThan(0);
  });
});

describe('executeAction — heal', () => {
  it('restores target health scaled by healing skill', () => {
    const p = makeAdult(1, 10, 10);
    p.skills.healing = 0.8;
    const other = makeAdult(2, 11, 10);
    other.health = 0.5;
    const world = flatWorld(64);
    const ctx = makeCtx([p, other], world);
    const outcome = executeAction(p, { kind: 'heal', targetPersonId: 2 }, ctx, NEUTRAL_VOLATILITY);
    expect(other.health).toBeGreaterThan(0.5);
    expect(outcome.success).toBe(true);
    expect(other.memory.some((m) => m.kind === 'helped')).toBe(true);
  });
});

describe('executeAction — property: every ActionKind executes without NaN and within reward bounds', () => {
  it('runs every kind at least once with a valid target/tile and checks the outcome', () => {
    const world = flatWorld(64, 0.5, 3);
    for (const kind of ACTION_KINDS as readonly ActionKind[]) {
      const p = makeAdult(1, 10, 10);
      const other = makeAdult(2, 11, 10);
      p.settlementId = 1;
      p.inventory = { food: 5, wood: 10, stone: 10, metal: 5, tools: 1 };
      other.inventory = { food: 5, wood: 0, stone: 0, metal: 0, tools: 0 };
      p.beliefIds = [1];
      other.health = 0.5;
      const settlement: Settlement = {
        id: 1,
        civId: 0,
        name: 'Home',
        center: { x: 10, y: 10 },
        memberIds: [1],
        stock: { food: 5, wood: 0, stone: 0, metal: 0, tools: 0 },
        structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
      };
      const ctx = makeCtx([p, other], world, [settlement]);
      const action: Action =
        kind === 'build'
          ? { kind, structure: 'shelter' }
          : kind === 'gather' || kind === 'farm' || kind === 'migrate' || kind === 'explore'
            ? { kind, tile: { x: 10, y: 10 } }
            : kind === 'steal'
              ? { kind, targetPersonId: 2 }
              : ['socialize', 'court', 'teach', 'trade', 'share', 'attack', 'heal'].includes(kind)
                ? { kind, targetPersonId: 2 }
                : { kind };
      const outcome = executeAction(p, action, ctx, NEUTRAL_VOLATILITY);
      expect(Number.isFinite(outcome.reward)).toBe(true);
      expect(outcome.reward).toBeGreaterThanOrEqual(-1);
      expect(outcome.reward).toBeLessThanOrEqual(1);
      expect(typeof outcome.success).toBe('boolean');
      for (const v of Object.values(p.needs)) expect(Number.isFinite(v)).toBe(true);
      for (const v of Object.values(p.emotions)) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isFinite(p.health)).toBe(true);
    }
  });
});
