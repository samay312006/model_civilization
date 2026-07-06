import {
  TECH_IDS,
  TECH_THRESHOLDS,
  type ActionKind,
  type Civ,
  type Person,
  type SkillName,
  type TechId,
  type Tick,
} from '../../shared/types';

/** Deviation 1: the minimal structural subset of the eventual EngineCtx technology reads. */
export interface TechnologyCtxLike {
  people: Person[];
  civs: Civ[];
  tick: Tick;
}

export const KNOWLEDGE_DECAY_PER_TICK = 0.1;
export const TECH_ACTIVE_MIN_MEMBERS = 3;
export const TECH_ACTIVE_MIN_SKILL = 0.4;

export const TECH_SKILL_MAP: Record<TechId, SkillName> = {
  fire: 'gathering',
  agriculture: 'farming',
  construction: 'building',
  metallurgy: 'crafting',
  writing: 'teaching',
  medicine: 'healing',
};

/** civ.knowledge[domain] += points, floored at 0. */
export function addKnowledge(civ: Civ, domain: TechId, points: number): void {
  civ.knowledge[domain] = Math.max(0, civ.knowledge[domain] + points);
}

/** True iff >= TECH_ACTIVE_MIN_MEMBERS living civ members have the mapped skill >= TECH_ACTIVE_MIN_SKILL. */
export function isActive(civ: Civ, domain: TechId, ctx: TechnologyCtxLike): boolean {
  const skill = TECH_SKILL_MAP[domain];
  let count = 0;
  for (const p of ctx.people) {
    if (!p.alive || p.civId !== civ.id) continue;
    if (p.skills[skill] >= TECH_ACTIVE_MIN_SKILL) count += 1;
    if (count >= TECH_ACTIVE_MIN_MEMBERS) return true;
  }
  return count >= TECH_ACTIVE_MIN_MEMBERS;
}

/**
 * Per civ (ascending id), per TechId (TECH_IDS order): unlock at threshold
 * while active; mark lost when active membership drops below the minimum;
 * decay knowledge 0.1/tick per domain unless the civ has active writing
 * (writing freezes decay for every domain, including itself).
 */
export function updateTechnology(ctx: TechnologyCtxLike): void {
  const civs = [...ctx.civs].sort((a, b) => a.id - b.id);
  for (const civ of civs) {
    const writingFrozen = civ.techs.includes('writing');
    for (const domain of TECH_IDS) {
      const active = isActive(civ, domain, ctx);
      const unlocked = civ.knowledge[domain] >= TECH_THRESHOLDS[domain];
      const hasIt = civ.techs.includes(domain);

      if (unlocked && active && !hasIt) {
        civ.techs.push(domain);
      } else if (hasIt && !active) {
        civ.techs = civ.techs.filter((t) => t !== domain);
      }

      if (!writingFrozen) {
        civ.knowledge[domain] = Math.max(0, civ.knowledge[domain] - KNOWLEDGE_DECAY_PER_TICK);
      }
    }
  }
}

/**
 * agriculture doubles 'farm'; metallurgy boosts 'craft' x1.5 and 'attack'
 * x1.3; medicine doubles 'heal'. Multipliers compose multiplicatively so
 * future overlapping techs remain correct; unrelated action/tech pairs are 1.
 */
export function techYieldMultiplier(civ: Civ, action: ActionKind): number {
  let mult = 1;
  if (civ.techs.includes('agriculture') && action === 'farm') mult *= 2;
  if (civ.techs.includes('metallurgy') && action === 'craft') mult *= 1.5;
  if (civ.techs.includes('metallurgy') && action === 'attack') mult *= 1.3;
  if (civ.techs.includes('medicine') && action === 'heal') mult *= 2;
  return mult;
}
