import {
  ADULT_AGE_TICKS,
  SKILL_NAMES,
  clamp,
  clamp01,
  dist,
  type Action,
  type ActionKind,
  type Civ,
  type Emotions,
  type Inventory,
  type Person,
  type Settlement,
  type SkillName,
  type StructureKind,
  type TechId,
  type Tick,
  type Vec2,
} from '../../shared/types';
import type { Rng } from '../rng';
import { isHabitable, type World } from '../world/terrain';
import { stepToward } from '../world/spatial';
import { markFed } from './needs';
import { applyEmotionImpulse } from './emotions';
import { remember } from './memory';
import { adjustRelationship, affinityTo } from './relationships';

/** Deviation 2: structural stand-in for the not-yet-written Task 29 technology.ts. */
export interface TechCtxLike {
  yieldMultiplier(civ: Civ, action: ActionKind): number;
  addKnowledge(civ: Civ, domain: TechId, points: number): void;
}

/** Deviation 1: the minimal structural subset of the eventual EngineCtx execution reads. */
export interface ExecuteCtxLike {
  world: World;
  personById: Map<number, Person>;
  civs: Civ[];
  settlements: Settlement[];
  tick: Tick;
  rng: Rng;
  tech: TechCtxLike;
}

/** Contract signature verbatim. reward always in [-1, 1]. */
export interface Outcome {
  action: Action;
  success: boolean;
  reward: number;
  tick: Tick;
}

export const MOVEMENT_PROGRESS_REWARD = 0.05;
export const GATHER_SKILL_PRACTICE = 0.002;
export const GATHER_BASE_YIELD = 0.5;
export const FARM_YIELD_BASE = 1.5;
export const HUNT_BASE_CHANCE = 0.35;
export const HUNT_SKILL_BONUS = 0.4;
export const HUNT_FOOD_YIELD = 2.0;
export const HUNT_INJURY_CHANCE = 0.25;
export const HUNT_INJURY_HEALTH = 0.1;
export const BUILD_WOOD_COST = 10;
export const BUILD_STONE_COST = 5;
export const BUILD_PROGRESS_PER_TICK = 1;
export const STRUCTURE_COMPLETE_PROGRESS = 60;
export const CRAFT_WOOD_COST = 2;
export const CRAFT_STONE_COST = 1;
export const CRAFT_TOOLS_YIELD = 1;
export const REST_RECOVERY = 0.3;
export const REST_HEALTH_REGEN = 0.01;
export const SOCIALIZE_AFFINITY_GAIN = 0.02;
export const SOCIALIZE_BELONGING_RELIEF = 0.05;
export const BELIEF_SPREAD_CHANCE_BASE = 0.1;
export const COURT_AFFINITY_THRESHOLD = 0.3;
export const COURT_AFFINITY_BUMP = 0.05;
export const TEACH_SKILL_RATE = 0.05;
export const TEACH_MORALITY_NUDGE = 0.02;
export const TRADE_SWAP_AMOUNT = 1;
export const SHARE_AMOUNT = 1;
export const STEAL_PERSON_AMOUNT = 1;
export const STEAL_SETTLEMENT_AMOUNT = 2;
export const STEAL_PERCEIVED_CHANCE_BASE = 0.5;
export const ATTACK_DAMAGE_MIN = 0.15;
export const ATTACK_DAMAGE_MAX = 0.4;
export const FLEE_STEPS = 2;
export const WORSHIP_ZEAL_UPKEEP = 0.01;
export const WORSHIP_SANCTITY_NUDGE = 0.01;
export const WORSHIP_ESTEEM_RELIEF = 0.03;
export const EXPLORE_CURIOSITY_REWARD = 0.1;
export const EXPLORE_WONDER_CHANCE = 0.02;
export const HEAL_BASE_RECOVERY = 0.1;
export const HEAL_MEDICINE_MULTIPLIER = 1.5; // reserved for tech.yieldMultiplier callers; heal reads the multiplier via ctx.tech directly

/** Neutral per-component multiplier for impulses applied to someone other than the acting person. */
export const NEUTRAL_IMPULSE: Emotions = { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 };

/** Extension property backing per-structure build progress on a Settlement (mirrors lifecycle.ts's pattern). */
interface WithBuildProgress {
  _buildProgress?: Record<StructureKind, number>;
}

export function buildProgressOf(s: Settlement, structure: StructureKind): number {
  return (s as Settlement & WithBuildProgress)._buildProgress?.[structure] ?? 0;
}

export function setBuildProgress(s: Settlement, structure: StructureKind, value: number): void {
  const ext = s as Settlement & WithBuildProgress;
  if (ext._buildProgress === undefined) {
    ext._buildProgress = { shelter: 0, granary: 0, wall: 0, shrine: 0 };
  }
  ext._buildProgress[structure] = value;
}

function finiteReward(reward: number): number {
  return Number.isFinite(reward) ? clamp(reward, -1, 1) : 0;
}

function outcomeOf(action: Action, success: boolean, reward: number, tick: Tick): Outcome {
  return { action, success, reward: finiteReward(reward), tick };
}

function civOf(ctx: ExecuteCtxLike, p: Person): Civ | undefined {
  return ctx.civs.find((c) => c.id === p.civId);
}

function resourceKeys(): (keyof Inventory)[] {
  return ['food', 'wood', 'stone', 'metal'];
}

function largestResource(inv: Inventory, exclude?: keyof Inventory): keyof Inventory | null {
  let best: keyof Inventory | null = null;
  let bestAmount = 0;
  for (const key of resourceKeys()) {
    if (key === exclude) continue;
    if (inv[key] > bestAmount) {
      bestAmount = inv[key];
      best = key;
    }
  }
  return best;
}

function bestSkill(p: Person): SkillName {
  let best: SkillName = SKILL_NAMES[0];
  for (const s of SKILL_NAMES) {
    if (p.skills[s] > p.skills[best]) best = s;
  }
  return best;
}

const NEEDS_ADJACENT = Math.SQRT2 + 1e-9;

/**
 * Contract function (ExecuteCtxLike per deviation 1; emotionVolatility
 * injected per deviation 5). Movement is embedded generically for any
 * tile-targeted action farther than one adjacent step; every ActionKind's
 * own effect is implemented in the switch below.
 */
export function executeAction(p: Person, a: Action, ctx: ExecuteCtxLike, emotionVolatility: Emotions): Outcome {
  if (a.tile !== undefined && dist(p.pos, a.tile) > NEEDS_ADJACENT) {
    const next = stepToward(p.pos, a.tile, ctx.world);
    p.pos = next;
    return outcomeOf(a, true, MOVEMENT_PROGRESS_REWARD, ctx.tick);
  }

  switch (a.kind) {
    case 'gather':
      return execGather(p, a, ctx);
    case 'farm':
      return execFarm(p, a, ctx);
    case 'hunt':
      return execHunt(p, ctx, emotionVolatility);
    case 'build':
      return execBuild(p, a, ctx);
    case 'craft':
      return execCraft(p, ctx);
    case 'rest':
      return execRest(p, ctx);
    case 'socialize':
      return execSocialize(p, a, ctx);
    case 'court':
      return execCourt(p, a, ctx, emotionVolatility);
    case 'teach':
      return execTeach(p, a, ctx);
    case 'trade':
      return execTrade(p, a, ctx);
    case 'share':
      return execShare(p, a, ctx, emotionVolatility);
    case 'steal':
      return execSteal(p, a, ctx, emotionVolatility);
    case 'attack':
      return execAttack(p, a, ctx, emotionVolatility);
    case 'flee':
      return execFlee(p, ctx, emotionVolatility);
    case 'migrate':
      return execMigrate(p, a, ctx);
    case 'worship':
      return execWorship(p, ctx, emotionVolatility);
    case 'explore':
      return execExplore(p, a, ctx, emotionVolatility);
    case 'heal':
      return execHeal(p, a, ctx);
  }
}

function execGather(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const tile = a.tile as Vec2;
  const t = ctx.world.tileAt(tile.x, tile.y);
  const amount = Math.min(t.food, GATHER_BASE_YIELD + p.skills.gathering);
  t.food -= amount;
  p.inventory.food += amount;
  if (amount > 0) markFed(p);
  p.skills.gathering = clamp01(p.skills.gathering + GATHER_SKILL_PRACTICE);
  const civ = civOf(ctx, p);
  if (civ !== undefined) {
    ctx.tech.addKnowledge(civ, 'fire', amount);
    ctx.tech.addKnowledge(civ, 'agriculture', amount * 0.2);
  }
  return outcomeOf(a, amount > 0, amount / 2, ctx.tick);
}

function execFarm(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const tile = a.tile as Vec2;
  const t = ctx.world.tileAt(tile.x, tile.y);
  if (!isHabitable(t.terrain)) return outcomeOf(a, false, -0.1, ctx.tick);
  const civ = civOf(ctx, p);
  const multiplier = civ !== undefined ? ctx.tech.yieldMultiplier(civ, 'farm') : 1;
  const grown = FARM_YIELD_BASE * p.skills.farming * multiplier;
  t.food += grown;
  const amount = Math.min(t.food, grown);
  t.food -= amount;
  p.inventory.food += amount;
  if (amount > 0) markFed(p);
  p.skills.farming = clamp01(p.skills.farming + GATHER_SKILL_PRACTICE);
  if (civ !== undefined) ctx.tech.addKnowledge(civ, 'agriculture', amount);
  return outcomeOf(a, amount > 0, amount / 3, ctx.tick);
}

function execHunt(p: Person, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const action: Action = { kind: 'hunt' };
  const chance = clamp01(HUNT_BASE_CHANCE + HUNT_SKILL_BONUS * p.skills.fighting);
  const success = ctx.rng.chance(chance);
  let reward = success ? 0.6 : -0.2;
  if (success) {
    p.inventory.food += HUNT_FOOD_YIELD;
    markFed(p);
  }
  if (ctx.rng.chance(HUNT_INJURY_CHANCE)) {
    p.health = clamp01(p.health - HUNT_INJURY_HEALTH);
    applyEmotionImpulse(p, { fear: 0.2 }, volatility);
    reward -= 0.1;
  }
  p.skills.fighting = clamp01(p.skills.fighting + GATHER_SKILL_PRACTICE);
  return outcomeOf(action, success, reward, ctx.tick);
}

function execBuild(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const structure = a.structure as StructureKind;
  const settlement = ctx.settlements.find((s) => s.id === p.settlementId);
  if (settlement === undefined) return outcomeOf(a, false, -0.1, ctx.tick);

  const woodSpend = Math.min(p.inventory.wood, BUILD_WOOD_COST);
  const stoneSpend = Math.min(p.inventory.stone, BUILD_STONE_COST);
  if (woodSpend === 0 && stoneSpend === 0) return outcomeOf(a, false, -0.05, ctx.tick);

  p.inventory.wood -= woodSpend;
  p.inventory.stone -= stoneSpend;
  const gained = (woodSpend + stoneSpend) * BUILD_PROGRESS_PER_TICK;
  let progress = buildProgressOf(settlement, structure) + gained;
  if (progress >= STRUCTURE_COMPLETE_PROGRESS) {
    settlement.structures[structure] += 1;
    progress = 0;
  }
  setBuildProgress(settlement, structure, progress);
  p.skills.building = clamp01(p.skills.building + GATHER_SKILL_PRACTICE);
  const civ = civOf(ctx, p);
  if (civ !== undefined) ctx.tech.addKnowledge(civ, 'construction', woodSpend + stoneSpend);
  return outcomeOf(a, true, (woodSpend + stoneSpend) / 15, ctx.tick);
}

function execCraft(p: Person, ctx: ExecuteCtxLike): Outcome {
  const action: Action = { kind: 'craft' };
  if (p.inventory.wood < CRAFT_WOOD_COST || p.inventory.stone < CRAFT_STONE_COST) {
    return outcomeOf(action, false, -0.05, ctx.tick);
  }
  p.inventory.wood -= CRAFT_WOOD_COST;
  p.inventory.stone -= CRAFT_STONE_COST;
  p.inventory.tools += CRAFT_TOOLS_YIELD;
  p.skills.crafting = clamp01(p.skills.crafting + GATHER_SKILL_PRACTICE);
  const civ = civOf(ctx, p);
  if (civ !== undefined) ctx.tech.addKnowledge(civ, 'metallurgy', CRAFT_TOOLS_YIELD);
  return outcomeOf(action, true, 0.3, ctx.tick);
}

function execRest(p: Person, ctx: ExecuteCtxLike): Outcome {
  const action: Action = { kind: 'rest' };
  const priorRest = p.needs.rest;
  p.needs.rest = clamp01(p.needs.rest - REST_RECOVERY);
  p.health = clamp01(p.health + REST_HEALTH_REGEN);
  return outcomeOf(action, true, 0.3 * priorRest, ctx.tick);
}

function relationshipKind(p: Person, otherId: number): 'kin' | 'friend' | 'rival' | 'partner' {
  return p.relationships.find((r) => r.otherId === otherId)?.kind ?? 'friend';
}

function execSocialize(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);

  adjustRelationship(p, target.id, relationshipKind(p, target.id), SOCIALIZE_AFFINITY_GAIN);
  adjustRelationship(target, p.id, relationshipKind(target, p.id), SOCIALIZE_AFFINITY_GAIN);
  p.needs.belonging = clamp01(p.needs.belonging - SOCIALIZE_BELONGING_RELIEF);
  target.needs.belonging = clamp01(target.needs.belonging - SOCIALIZE_BELONGING_RELIEF);

  if (p.beliefIds.length > 0) {
    const belief = p.beliefIds[0] as number;
    if (!target.beliefIds.includes(belief) && ctx.rng.chance(BELIEF_SPREAD_CHANCE_BASE)) {
      target.beliefIds.push(belief);
    }
  }
  return outcomeOf(a, true, 0.2, ctx.tick);
}

function execCourt(p: Person, a: Action, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);

  const bothAdult = p.ageTicks >= ADULT_AGE_TICKS && target.ageTicks >= ADULT_AGE_TICKS;
  if (affinityTo(p, target.id) > COURT_AFFINITY_THRESHOLD && p.partnerId === null && target.partnerId === null && bothAdult) {
    p.partnerId = target.id;
    target.partnerId = p.id;
    adjustRelationship(p, target.id, 'partner', 0.2);
    adjustRelationship(target, p.id, 'partner', 0.2);
    applyEmotionImpulse(p, { joy: 0.4, hope: 0.2 }, volatility);
    applyEmotionImpulse(target, { joy: 0.4, hope: 0.2 }, NEUTRAL_IMPULSE);
    return outcomeOf(a, true, 0.8, ctx.tick);
  }

  adjustRelationship(p, target.id, 'friend', COURT_AFFINITY_BUMP);
  adjustRelationship(target, p.id, 'friend', COURT_AFFINITY_BUMP);
  return outcomeOf(a, true, 0.15, ctx.tick);
}

function execTeach(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);

  const skill = bestSkill(p);
  target.skills[skill] = clamp01(target.skills[skill] + TEACH_SKILL_RATE * p.skills.teaching);
  const foundations: (keyof Person['morality'])[] = ['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty'];
  for (const f of foundations) {
    target.morality[f] = clamp01(target.morality[f] + TEACH_MORALITY_NUDGE * (p.morality[f] - target.morality[f]));
  }
  remember(target, { tick: ctx.tick, kind: 'taught', otherId: p.id, valence: 0.5, salience: 0.4 });
  p.skills.teaching = clamp01(p.skills.teaching + GATHER_SKILL_PRACTICE);
  const civ = civOf(ctx, p);
  if (civ !== undefined) ctx.tech.addKnowledge(civ, 'writing', 1);
  return outcomeOf(a, true, 0.3, ctx.tick);
}

function execTrade(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);

  const give = largestResource(p.inventory);
  if (give === null) return outcomeOf(a, false, -0.05, ctx.tick);
  const receive = largestResource(target.inventory, give);
  if (receive === null) return outcomeOf(a, false, -0.05, ctx.tick);
  if (p.inventory[give] < TRADE_SWAP_AMOUNT || target.inventory[receive] < TRADE_SWAP_AMOUNT) {
    return outcomeOf(a, false, -0.05, ctx.tick);
  }

  p.inventory[give] -= TRADE_SWAP_AMOUNT;
  target.inventory[give] += TRADE_SWAP_AMOUNT;
  target.inventory[receive] -= TRADE_SWAP_AMOUNT;
  p.inventory[receive] += TRADE_SWAP_AMOUNT;
  if (receive === 'food') markFed(p);
  if (give === 'food') markFed(target);

  adjustRelationship(p, target.id, relationshipKind(p, target.id), 0.03);
  adjustRelationship(target, p.id, relationshipKind(target, p.id), 0.03);
  return outcomeOf(a, true, 0.3, ctx.tick);
}

function execShare(p: Person, a: Action, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);
  if (p.inventory.food < SHARE_AMOUNT) return outcomeOf(a, false, -0.05, ctx.tick);

  p.inventory.food -= SHARE_AMOUNT;
  target.inventory.food += SHARE_AMOUNT;
  markFed(target);
  remember(p, { tick: ctx.tick, kind: 'shared', otherId: target.id, valence: 0.6, salience: 0.4 });
  remember(target, { tick: ctx.tick, kind: 'helped', otherId: p.id, valence: 0.6, salience: 0.5 });
  adjustRelationship(p, target.id, relationshipKind(p, target.id), 0.05);
  adjustRelationship(target, p.id, relationshipKind(target, p.id), 0.05);
  applyEmotionImpulse(p, { joy: 0.15 }, volatility);
  return outcomeOf(a, true, 0.4 * p.traits.empathy + 0.1, ctx.tick);
}

function execSteal(p: Person, a: Action, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  if (a.targetPersonId !== undefined) {
    const target = ctx.personById.get(a.targetPersonId);
    if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);
    const resource = largestResource(target.inventory);
    if (resource === null || target.inventory[resource] < STEAL_PERSON_AMOUNT) {
      return outcomeOf(a, false, -0.05, ctx.tick);
    }
    target.inventory[resource] -= STEAL_PERSON_AMOUNT;
    p.inventory[resource] += STEAL_PERSON_AMOUNT;
    if (resource === 'food') markFed(p);
    const perceivedChance = clamp01(STEAL_PERCEIVED_CHANCE_BASE - 0.3 * p.skills.fighting + 0.3 * target.skills.fighting);
    if (ctx.rng.chance(perceivedChance)) {
      remember(target, { tick: ctx.tick, kind: 'stolen', otherId: p.id, valence: -0.7, salience: 0.6 });
      applyEmotionImpulse(target, { anger: 0.3 }, NEUTRAL_IMPULSE);
      adjustRelationship(target, p.id, 'rival', -0.2);
      applyEmotionImpulse(p, { fear: 0.1 }, volatility);
    }
    return outcomeOf(a, true, 0.35, ctx.tick);
  }

  // Settlement form (a.tile set).
  const tile = a.tile as Vec2;
  const settlement = ctx.settlements.find((s) => s.id !== p.settlementId && dist(tile, s.center) <= 1);
  if (settlement === undefined) return outcomeOf(a, false, -0.1, ctx.tick);
  const resource = largestResource(settlement.stock);
  if (resource === null || settlement.stock[resource] < STEAL_SETTLEMENT_AMOUNT) {
    return outcomeOf(a, false, -0.05, ctx.tick);
  }
  settlement.stock[resource] -= STEAL_SETTLEMENT_AMOUNT;
  p.inventory[resource] += STEAL_SETTLEMENT_AMOUNT;
  if (resource === 'food') markFed(p);
  for (const memberId of settlement.memberIds) {
    const member = ctx.personById.get(memberId);
    if (member === undefined || !member.alive) continue;
    if (ctx.rng.chance(STEAL_PERCEIVED_CHANCE_BASE)) {
      applyEmotionImpulse(member, { anger: 0.15 }, NEUTRAL_IMPULSE);
    }
  }
  return outcomeOf(a, true, 0.5, ctx.tick);
}

function execAttack(p: Person, a: Action, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.1, ctx.tick);

  const pCiv = civOf(ctx, p);
  const metallurgyBonus = pCiv !== undefined ? ctx.tech.yieldMultiplier(pCiv, 'attack') : 1;
  const pRoll = p.skills.fighting + 0.3 * metallurgyBonus - 0.3 + ctx.rng.range(0, 0.5);
  const tRoll = target.skills.fighting + ctx.rng.range(0, 0.5);

  if (pRoll > tRoll) {
    const damage = ATTACK_DAMAGE_MIN + (ATTACK_DAMAGE_MAX - ATTACK_DAMAGE_MIN) * clamp01(pRoll - tRoll);
    target.health = clamp01(target.health - damage);
    if (target.health <= 0) target.causeOfDeath = 'violence';
    remember(target, { tick: ctx.tick, kind: 'harmed', otherId: p.id, valence: -0.9, salience: 0.9 });
    applyEmotionImpulse(target, { fear: 0.4, anger: 0.3 }, NEUTRAL_IMPULSE);
    adjustRelationship(target, p.id, 'rival', -0.4);
    applyEmotionImpulse(p, { anger: -0.1 }, volatility);
    if (target.health <= 0) {
      remember(p, { tick: ctx.tick, kind: 'victory', otherId: target.id, valence: 0.5, salience: 0.6 });
    }
    return outcomeOf(a, true, 0.5 + 0.3 * (target.health <= 0 ? 1 : 0), ctx.tick);
  }

  const damage = ATTACK_DAMAGE_MIN + (ATTACK_DAMAGE_MAX - ATTACK_DAMAGE_MIN) * clamp01(tRoll - pRoll);
  p.health = clamp01(p.health - damage);
  if (p.health <= 0) p.causeOfDeath = 'violence';
  applyEmotionImpulse(p, { fear: 0.4, anger: 0.2 }, volatility);
  remember(p, { tick: ctx.tick, kind: 'defeat', otherId: target.id, valence: -0.6, salience: 0.6 });
  return outcomeOf(a, false, -0.5, ctx.tick);
}

/** Resolves the nearest known danger position from recent harmed/witnessed memories, or null. */
function nearestDanger(p: Person, ctx: ExecuteCtxLike): Vec2 | null {
  for (const rec of p.memory) {
    if (rec.kind !== 'harmed' && rec.kind !== 'death-witnessed') continue;
    const other = ctx.personById.get(rec.otherId);
    if (other === undefined || !other.alive) continue;
    if (dist(p.pos, other.pos) <= FLEE_STEPS * 2) return other.pos;
  }
  return null;
}

function execFlee(p: Person, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const action: Action = { kind: 'flee' };
  const danger = nearestDanger(p, ctx);
  if (danger === null) {
    p.needs.rest = clamp01(p.needs.rest - 0.1);
    return outcomeOf(action, true, 0.05, ctx.tick);
  }
  const away: Vec2 = { x: p.pos.x + (p.pos.x - danger.x), y: p.pos.y + (p.pos.y - danger.y) };
  for (let i = 0; i < FLEE_STEPS; i++) {
    p.pos = stepToward(p.pos, away, ctx.world);
  }
  applyEmotionImpulse(p, { fear: -0.1 }, volatility);
  return outcomeOf(action, true, 0.1, ctx.tick);
}

function execMigrate(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const tile = a.tile as Vec2;
  p.pos = { x: tile.x, y: tile.y };
  if (p.settlementId !== null) p.settlementId = null;
  return outcomeOf(a, true, 0.1, ctx.tick);
}

function execWorship(p: Person, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const action: Action = { kind: 'worship' };
  if (p.beliefIds.length === 0) return outcomeOf(action, false, -0.05, ctx.tick);
  p.morality.sanctity = clamp01(p.morality.sanctity + WORSHIP_SANCTITY_NUDGE);
  p.needs.esteem = clamp01(p.needs.esteem - WORSHIP_ESTEEM_RELIEF);
  applyEmotionImpulse(p, { hope: WORSHIP_ZEAL_UPKEEP }, volatility);
  return outcomeOf(action, true, 0.15, ctx.tick);
}

function execExplore(p: Person, a: Action, ctx: ExecuteCtxLike, volatility: Emotions): Outcome {
  const tile = a.tile as Vec2;
  p.pos = { x: tile.x, y: tile.y };
  applyEmotionImpulse(p, { hope: 0.1 }, volatility);
  let reward = EXPLORE_CURIOSITY_REWARD;
  if (ctx.rng.chance(EXPLORE_WONDER_CHANCE)) {
    remember(p, { tick: ctx.tick, kind: 'wonder', otherId: p.id, valence: 0.8, salience: 0.7 });
    applyEmotionImpulse(p, { joy: 0.2 }, volatility);
    reward += 0.1;
  }
  return outcomeOf(a, true, reward, ctx.tick);
}

function execHeal(p: Person, a: Action, ctx: ExecuteCtxLike): Outcome {
  const target = a.targetPersonId !== undefined ? ctx.personById.get(a.targetPersonId) : undefined;
  if (target === undefined || !target.alive) return outcomeOf(a, false, -0.05, ctx.tick);

  const civ = civOf(ctx, p);
  const multiplier = civ !== undefined ? ctx.tech.yieldMultiplier(civ, 'heal') : 1;
  const recovery = HEAL_BASE_RECOVERY * p.skills.healing * multiplier;
  target.health = clamp01(target.health + recovery);
  remember(target, { tick: ctx.tick, kind: 'helped', otherId: p.id, valence: 0.7, salience: 0.5 });
  p.skills.healing = clamp01(p.skills.healing + GATHER_SKILL_PRACTICE);
  if (civ !== undefined) ctx.tech.addKnowledge(civ, 'medicine', recovery * 10);
  adjustRelationship(p, target.id, relationshipKind(p, target.id), 0.05);
  adjustRelationship(target, p.id, relationshipKind(target, p.id), 0.05);
  return outcomeOf(a, true, recovery * 2, ctx.tick);
}
