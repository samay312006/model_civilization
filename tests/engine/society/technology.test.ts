import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_DECAY_PER_TICK,
  TECH_ACTIVE_MIN_MEMBERS,
  TECH_ACTIVE_MIN_SKILL,
  TECH_SKILL_MAP,
  addKnowledge,
  isActive,
  techYieldMultiplier,
  updateTechnology,
} from '../../../src/engine/society/technology';
import { createPerson } from '../../../src/engine/agents/person';
import { makeTestCiv, makeTestCtx } from '../../helpers/testCtx';
import { TECH_THRESHOLDS, type Person } from '../../../src/shared/types';

function makePerson(id: number, civId: number, ctx: ReturnType<typeof makeTestCtx>): Person {
  const p = createPerson(id, civId, 'fable', { x: 10, y: 10 }, ctx.names, ctx.rng.split(`p${id}`));
  p.alive = true;
  return p;
}

describe('addKnowledge', () => {
  it('adds points to the domain, floored at 0', () => {
    const civ = makeTestCiv();
    addKnowledge(civ, 'fire', 10);
    expect(civ.knowledge.fire).toBe(10);
    addKnowledge(civ, 'fire', -50);
    expect(civ.knowledge.fire).toBe(0); // floored, never negative
  });
});

describe('TECH_SKILL_MAP', () => {
  it('maps every tech to its skill exactly as specified', () => {
    expect(TECH_SKILL_MAP).toEqual({
      fire: 'gathering',
      agriculture: 'farming',
      construction: 'building',
      metallurgy: 'crafting',
      writing: 'teaching',
      medicine: 'healing',
    });
  });
});

describe('isActive', () => {
  it('requires >=3 living members with the mapped skill >= 0.4', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const people = [1, 2, 3].map((id) => {
      const p = makePerson(id, 0, ctx);
      p.skills.farming = TECH_ACTIVE_MIN_SKILL;
      return p;
    });
    ctx.people = people;
    expect(isActive(civ, 'agriculture', ctx)).toBe(true);
    expect(TECH_ACTIVE_MIN_MEMBERS).toBe(3);
  });

  it('is false with only 2 qualifying members (no-op boundary)', () => {
    const civ = makeTestCiv();
    const ctx = makeTestCtx({ civs: [civ] });
    const people = [1, 2].map((id) => {
      const p = makePerson(id, 0, ctx);
      p.skills.farming = 0.9;
      return p;
    });
    const belowSkill = makePerson(3, 0, ctx);
    belowSkill.skills.farming = 0.39; // below threshold
    ctx.people = [...people, belowSkill];
    expect(isActive(civ, 'agriculture', ctx)).toBe(false);
  });

  it('ignores dead members and members of other civs', () => {
    const civ = makeTestCiv({ id: 0 });
    const ctx = makeTestCtx({ civs: [civ] });
    const dead = makePerson(1, 0, ctx);
    dead.alive = false;
    dead.skills.farming = 1;
    const otherCiv = makePerson(2, 1, ctx);
    otherCiv.skills.farming = 1;
    const alive = [makePerson(3, 0, ctx), makePerson(4, 0, ctx)];
    for (const p of alive) p.skills.farming = 1;
    ctx.people = [dead, otherCiv, ...alive];
    expect(isActive(civ, 'agriculture', ctx)).toBe(false); // only 2 qualifying in-civ living members
  });
});

describe('updateTechnology', () => {
  it('unlocks a tech once knowledge crosses its threshold and it is active', () => {
    const civ = makeTestCiv();
    civ.knowledge.fire = TECH_THRESHOLDS.fire;
    const ctx = makeTestCtx({ civs: [civ], tick: 1 });
    const people = [1, 2, 3].map((id) => {
      const p = makePerson(id, 0, ctx);
      p.skills.gathering = 1;
      return p;
    });
    ctx.people = people;

    updateTechnology(ctx);

    expect(civ.techs).toContain('fire');
  });

  it('does not unlock below threshold (no-op boundary)', () => {
    const civ = makeTestCiv();
    civ.knowledge.fire = TECH_THRESHOLDS.fire - 1;
    const ctx = makeTestCtx({ civs: [civ], tick: 1 });
    const people = [1, 2, 3].map((id) => {
      const p = makePerson(id, 0, ctx);
      p.skills.gathering = 1;
      return p;
    });
    ctx.people = people;

    updateTechnology(ctx);

    expect(civ.techs).not.toContain('fire');
  });

  it('marks a tech lost when it falls inactive (fewer than 3 skilled members)', () => {
    const civ = makeTestCiv({ techs: ['fire'] });
    civ.knowledge.fire = TECH_THRESHOLDS.fire;
    const ctx = makeTestCtx({ civs: [civ], tick: 1 });
    const p = makePerson(1, 0, ctx);
    p.skills.gathering = 1; // only 1 qualifying member, below TECH_ACTIVE_MIN_MEMBERS
    ctx.people = [p];

    updateTechnology(ctx);

    expect(civ.techs).not.toContain('fire');
  });

  it('decays knowledge by 0.1/tick per domain without active writing', () => {
    const civ = makeTestCiv();
    civ.knowledge.agriculture = 5;
    const ctx = makeTestCtx({ civs: [civ], tick: 1 });
    ctx.people = [];

    updateTechnology(ctx);

    expect(civ.knowledge.agriculture).toBeCloseTo(5 - KNOWLEDGE_DECAY_PER_TICK, 6);
  });

  it('freezes knowledge decay entirely when writing is active', () => {
    const civ = makeTestCiv({ techs: ['writing'] });
    civ.knowledge.agriculture = 5;
    civ.knowledge.writing = TECH_THRESHOLDS.writing;
    const ctx = makeTestCtx({ civs: [civ], tick: 1 });
    const people = [1, 2, 3].map((id) => {
      const p = makePerson(id, 0, ctx);
      p.skills.teaching = 1; // keeps writing itself active
      return p;
    });
    ctx.people = people;

    updateTechnology(ctx);

    expect(civ.knowledge.agriculture).toBe(5); // frozen, no decay
  });

  it('floors decayed knowledge at 0', () => {
    const civ = makeTestCiv();
    civ.knowledge.fire = 0.05;
    const ctx = makeTestCtx({ civs: [civ], tick: 1 });
    ctx.people = [];

    updateTechnology(ctx);

    expect(civ.knowledge.fire).toBe(0);
  });
});

describe('techYieldMultiplier', () => {
  it('doubles farm with agriculture', () => {
    const civ = makeTestCiv({ techs: ['agriculture'] });
    expect(techYieldMultiplier(civ, 'farm')).toBe(2);
    expect(techYieldMultiplier(civ, 'gather')).toBe(1); // unaffected
  });

  it('boosts craft x1.5 and attack x1.3 with metallurgy', () => {
    const civ = makeTestCiv({ techs: ['metallurgy'] });
    expect(techYieldMultiplier(civ, 'craft')).toBeCloseTo(1.5, 6);
    expect(techYieldMultiplier(civ, 'attack')).toBeCloseTo(1.3, 6);
  });

  it('doubles heal with medicine', () => {
    const civ = makeTestCiv({ techs: ['medicine'] });
    expect(techYieldMultiplier(civ, 'heal')).toBe(2);
  });

  it('returns 1 with no relevant tech (no-op boundary)', () => {
    const civ = makeTestCiv();
    expect(techYieldMultiplier(civ, 'farm')).toBe(1);
    expect(techYieldMultiplier(civ, 'craft')).toBe(1);
    expect(techYieldMultiplier(civ, 'attack')).toBe(1);
    expect(techYieldMultiplier(civ, 'heal')).toBe(1);
  });
});
