import { describe, it, expect } from 'vitest';
import {
  YEAR_TICKS, SEASON_TICKS, MAP_SIZES, PERCEPTION_RADIUS, MEMORY_CAP, RELATIONSHIP_CAP,
  ADULT_AGE_TICKS, GESTATION_TICKS, SOFTMAX_TEMP, ACTION_WEIGHT_MIN, ACTION_WEIGHT_MAX,
  LINEAGES, SKILL_NAMES, ACTION_KINDS, TECH_IDS, TECH_THRESHOLDS,
  clamp, clamp01, dist,
} from '../../src/shared/types';
import type {
  ActionKind, Civ, MemoryEventRec, Person, Relationship, Religion, ScoredAction,
  Settlement, SimConfig, Skills, Tile, Vec2,
} from '../../src/shared/types';

describe('clamp', () => {
  it('returns the value when inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('clamps values below the range to lo', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(-1000, -5, 5)).toBe(-5);
  });

  it('clamps values above the range to hi', () => {
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(0.75, 0.2, 0.5)).toBe(0.5);
  });
});

describe('clamp01', () => {
  it('clamps into [0, 1]', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(1.7)).toBe(1);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
  });
});

describe('dist', () => {
  it('computes euclidean distance (3-4-5 triangle)', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, 10);
  });

  it('is zero for identical points', () => {
    expect(dist({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });

  it('handles negative coordinates and is symmetric', () => {
    const a: Vec2 = { x: -1, y: -1 };
    const b: Vec2 = { x: 2, y: 3 };
    expect(dist(a, b)).toBeCloseTo(5, 10);
    expect(dist(b, a)).toBeCloseTo(dist(a, b), 10);
  });
});

describe('contract constants', () => {
  it('time and tuning constants match the contract', () => {
    expect(YEAR_TICKS).toBe(360);
    expect(SEASON_TICKS).toBe(90);
    expect(PERCEPTION_RADIUS).toBe(4);
    expect(MEMORY_CAP).toBe(48);
    expect(RELATIONSHIP_CAP).toBe(24);
    expect(ADULT_AGE_TICKS).toBe(16 * 360);
    expect(GESTATION_TICKS).toBe(270);
    expect(SOFTMAX_TEMP).toBe(0.35);
    expect(ACTION_WEIGHT_MIN).toBe(0.2);
    expect(ACTION_WEIGHT_MAX).toBe(3.0);
  });

  it('map sizes and catalogs match the contract', () => {
    expect(MAP_SIZES).toEqual({ small: 96, medium: 144, large: 192 });
    expect(LINEAGES).toEqual(['opus', 'sonnet', 'haiku', 'fable']);
    expect(SKILL_NAMES).toEqual(['farming', 'gathering', 'building', 'crafting', 'fighting', 'healing', 'teaching']);
    expect(ACTION_KINDS).toEqual(['gather', 'farm', 'hunt', 'build', 'craft', 'rest', 'socialize', 'court', 'teach', 'trade', 'share', 'steal', 'attack', 'flee', 'migrate', 'worship', 'explore', 'heal']);
    expect(TECH_IDS).toEqual(['fire', 'agriculture', 'construction', 'metallurgy', 'writing', 'medicine']);
  });

  it('tech thresholds match the contract', () => {
    expect(TECH_THRESHOLDS).toEqual({ fire: 50, agriculture: 200, construction: 400, metallurgy: 800, writing: 1200, medicine: 1600 });
  });
});

describe('compile-usage of core interfaces', () => {
  const allOneWeights: Record<ActionKind, number> = {
    gather: 1, farm: 1, hunt: 1, build: 1, craft: 1, rest: 1, socialize: 1, court: 1, teach: 1,
    trade: 1, share: 1, steal: 1, attack: 1, flee: 1, migrate: 1, worship: 1, explore: 1, heal: 1,
  };
  const skills: Skills = { farming: 0.2, gathering: 0.5, building: 0.1, crafting: 0, fighting: 0.3, healing: 0, teaching: 0.05 };

  it('a fully-populated Person literal type-checks and holds its values', () => {
    const memoryRec: MemoryEventRec = { tick: 100, kind: 'helped', otherId: 2, valence: 0.5, salience: 0.8 };
    const friendship: Relationship = { otherId: 2, kind: 'friend', affinity: 0.6 };
    const person: Person = {
      id: 1, alive: true, ageTicks: 20 * YEAR_TICKS, sex: 'f', name: 'Mira',
      pos: { x: 10, y: 12 }, civId: 0, settlementId: null, lineage: 'fable',
      traits: { curiosity: 0.7, aggression: 0.2, empathy: 0.8, industriousness: 0.6, riskTolerance: 0.4 },
      emotions: { fear: 0.1, joy: 0.5, grief: 0, anger: 0.05, hope: 0.6 },
      morality: { care: 0.8, fairness: 0.7, loyalty: 0.5, authority: 0.3, sanctity: 0.2, liberty: 0.6 },
      needs: { hunger: 0.3, safety: 0.1, rest: 0.2, belonging: 0.4, esteem: 0.5 },
      skills,
      health: 0.95,
      lifespanTicks: 70 * YEAR_TICKS,
      memory: [memoryRec],
      relationships: [friendship],
      inventory: { food: 3, wood: 0, stone: 0, metal: 0, tools: 1 },
      actionWeights: allOneWeights,
      brainState: {},
      influence: 0.1,
      beliefIds: [],
      partnerId: null,
      pregnantUntil: null,
      parentIds: null,
      causeOfDeath: null,
    };
    expect(person.alive).toBe(true);
    expect(person.lineage).toBe('fable');
    expect(person.memory[0].valence).toBeCloseTo(0.5, 10);
    expect(person.relationships[0].kind).toBe('friend');
  });

  it('actionWeights keys are exactly ACTION_KINDS', () => {
    expect(Object.keys(allOneWeights).sort()).toEqual([...ACTION_KINDS].sort());
  });

  it('Civ, Settlement, and Religion literals type-check and hold their values', () => {
    const civ: Civ = {
      id: 0, name: 'Fablemark', color: '#b76ce9',
      knowledge: { fire: 10, agriculture: 0, construction: 0, metallurgy: 0, writing: 0, medicine: 0 },
      techs: ['fire'], atWarWith: [], warWeariness: 0,
    };
    const settlement: Settlement = {
      id: 0, civId: 0, name: 'Kavale', center: { x: 10, y: 12 }, memberIds: [1],
      stock: { food: 20, wood: 5, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 2, granary: 0, wall: 0, shrine: 1 },
    };
    const religion: Religion = { id: 0, name: 'Soleon', founderId: 1, civId: 0, moralityBias: { sanctity: 0.2, loyalty: 0.1 }, zeal: 0.5 };
    expect(civ.techs).toContain('fire');
    expect(settlement.structures.shrine).toBe(1);
    expect(religion.moralityBias.sanctity).toBeCloseTo(0.2, 10);
  });

  it('SimConfig, Tile, and ScoredAction literals type-check and hold their values', () => {
    const config: SimConfig = { seed: 42, mode: 'mixed', mapSize: 'small', startPopulation: 200 };
    const tile: Tile = { terrain: 'plains', fertility: 0.8, food: 4, wood: 0, stone: 1, metal: 0 };
    const restAct: ScoredAction = { action: { kind: 'rest' }, score: 1 };
    const buildAct: ScoredAction = { action: { kind: 'build', tile: { x: 1, y: 2 }, structure: 'granary' }, score: 0.4 };
    const attackAct: ScoredAction = { action: { kind: 'attack', targetPersonId: 9 }, score: 0.2 };
    expect(MAP_SIZES[config.mapSize]).toBe(96);
    expect(tile.terrain).toBe('plains');
    expect(restAct.score).toBe(1);
    expect(buildAct.action.structure).toBe('granary');
    expect(attackAct.action.targetPersonId).toBe(9);
  });
});
