import {
  PERCEPTION_RADIUS,
  dist,
  type Action,
  type ActionKind,
  type Civ,
  type Lineage,
  type Person,
  type Season,
  type Settlement,
  type TechId,
  type Terrain,
  type Tick,
  type Vec2,
} from '../../shared/types';
import type { World } from '../world/terrain';
import { isEventActive, seasonOf, type NaturalEvent } from '../world/climate';
import type { SpatialIndex } from '../world/spatial';
import { dominantEmotion } from './emotions';
import { affinityTo, isKin } from './relationships';
import { legalActions, type ActionsCtxLike } from './actions';

export const NEARBY_SETTLEMENT_RADIUS_MULTIPLIER = 5;
export const DANGER_RADIUS_MULTIPLIER = 5;
export const SETTLEMENT_ATTACK_MEMORY_WINDOW = 5;
export const SETTLEMENT_ATTACK_MIN_VICTIMS = 2;
export const RAID_DANGER_INTENSITY = 0.5;

export interface PersonGlimpse {
  id: number;
  lineage: Lineage;
  civId: number;
  settlementId: number | null;
  pos: Vec2;
  influence: number;
  healthy: boolean;
  visibleEmotion: ReturnType<typeof dominantEmotion>;
  affinity: number;
  kin: boolean;
}

export interface TileGlimpse {
  pos: Vec2;
  terrain: Terrain;
  food: number;
  wood: number;
  stone: number;
  metal: number;
}

export interface SettlementGlimpse {
  id: number;
  civId: number;
  center: Vec2;
  population: number;
  foodStock: number;
  hasGranary: boolean;
  hasWall: boolean;
  underAttack: boolean;
}

export interface CivGlimpse {
  id: number;
  population: number;
  atWarWith: number[];
  techs: TechId[];
  season: Season;
  foodPerCapita: number;
}

export interface DangerGlimpse {
  kind: 'raid' | 'disease' | 'famine';
  pos: Vec2 | null;
  intensity: number;
}

export interface Perception {
  tick: Tick;
  self: Person;
  candidates: Action[];
  nearbyPeople: PersonGlimpse[];
  nearbyTiles: TileGlimpse[];
  settlement: SettlementGlimpse | null;
  nearbySettlements: SettlementGlimpse[];
  civ: CivGlimpse;
  dangers: DangerGlimpse[];
}

/**
 * Deviation 1: the minimal structural subset of the eventual EngineCtx this
 * file (and the ActionsCtxLike it forwards to legalActions) reads. Every
 * field ActionsCtxLike needs is present, so it is passed straight through.
 */
export interface PerceptionCtxLike {
  world: World;
  people: Person[];
  personById: Map<number, Person>;
  civs: Civ[];
  settlements: Settlement[];
  spatial: SpatialIndex;
  tick: Tick;
  naturalEvents: NaturalEvent[];
}

function toActionsCtx(ctx: PerceptionCtxLike): ActionsCtxLike {
  return {
    world: ctx.world,
    personById: ctx.personById,
    spatial: ctx.spatial,
    settlements: ctx.settlements,
    tick: ctx.tick,
  };
}

function personGlimpse(p: Person, other: Person): PersonGlimpse {
  return {
    id: other.id,
    lineage: other.lineage,
    civId: other.civId,
    settlementId: other.settlementId,
    pos: { x: other.pos.x, y: other.pos.y },
    influence: other.influence,
    healthy: other.health >= 0.5,
    visibleEmotion: dominantEmotion(other),
    affinity: affinityTo(p, other.id),
    kin: isKin(p, other.id),
  };
}

function buildNearbyPeople(p: Person, ctx: PerceptionCtxLike): PersonGlimpse[] {
  const out: PersonGlimpse[] = [];
  for (const id of ctx.spatial.near(p.pos, PERCEPTION_RADIUS)) {
    if (id === p.id) continue;
    const other = ctx.personById.get(id);
    if (other !== undefined && other.alive) out.push(personGlimpse(p, other));
  }
  return out;
}

function buildNearbyTiles(p: Person, ctx: PerceptionCtxLike): TileGlimpse[] {
  const out: TileGlimpse[] = [];
  const r = Math.ceil(PERCEPTION_RADIUS);
  for (let y = p.pos.y - r; y <= p.pos.y + r; y++) {
    for (let x = p.pos.x - r; x <= p.pos.x + r; x++) {
      if (!ctx.world.inBounds(x, y)) continue;
      if (dist({ x, y }, p.pos) > PERCEPTION_RADIUS) continue;
      const t = ctx.world.tileAt(x, y);
      out.push({ pos: { x, y }, terrain: t.terrain, food: t.food, wood: t.wood, stone: t.stone, metal: t.metal });
    }
  }
  return out; // already row-major (y ascending, then x ascending) by construction
}

function isUnderAttack(s: Settlement, ctx: PerceptionCtxLike): boolean {
  let victims = 0;
  for (const memberId of s.memberIds) {
    const member = ctx.personById.get(memberId);
    if (member === undefined || !member.alive) continue;
    const recent = member.memory.some(
      (m) => m.kind === 'harmed' && ctx.tick - m.tick <= SETTLEMENT_ATTACK_MEMORY_WINDOW,
    );
    if (recent) victims += 1;
  }
  return victims >= SETTLEMENT_ATTACK_MIN_VICTIMS;
}

function settlementGlimpse(s: Settlement, ctx: PerceptionCtxLike): SettlementGlimpse {
  const population = s.memberIds.filter((id) => ctx.personById.get(id)?.alive === true).length;
  return {
    id: s.id,
    civId: s.civId,
    center: { x: s.center.x, y: s.center.y },
    population,
    foodStock: s.stock.food,
    hasGranary: s.structures.granary > 0,
    hasWall: s.structures.wall > 0,
    underAttack: isUnderAttack(s, ctx),
  };
}

function buildCivGlimpse(p: Person, ctx: PerceptionCtxLike): CivGlimpse {
  const civ = ctx.civs.find((c) => c.id === p.civId);
  const season = seasonOf(ctx.tick);
  if (civ === undefined) {
    return { id: p.civId, population: 0, atWarWith: [], techs: [], season, foodPerCapita: 0 };
  }
  const members = ctx.people.filter((person) => person.alive && person.civId === civ.id);
  let totalFood = members.reduce((sum, person) => sum + person.inventory.food, 0);
  for (const s of ctx.settlements) {
    if (s.civId === civ.id) totalFood += s.stock.food;
  }
  return {
    id: civ.id,
    population: members.length,
    atWarWith: civ.atWarWith,
    techs: civ.techs,
    season,
    foodPerCapita: totalFood / Math.max(1, members.length),
  };
}

function buildDangers(p: Person, ctx: PerceptionCtxLike, nearbySettlements: SettlementGlimpse[], ownSettlement: SettlementGlimpse | null): DangerGlimpse[] {
  const out: DangerGlimpse[] = [];
  for (const ev of ctx.naturalEvents) {
    if (!isEventActive(ev, ctx.tick)) continue;
    if (ev.center !== null && dist(p.pos, ev.center) > PERCEPTION_RADIUS * DANGER_RADIUS_MULTIPLIER) continue;
    const kind: 'famine' | 'disease' = ev.kind === 'disease' ? 'disease' : 'famine';
    out.push({ kind, pos: ev.center, intensity: ev.intensity });
  }
  const all = ownSettlement !== null ? [ownSettlement, ...nearbySettlements] : nearbySettlements;
  for (const s of all) {
    if (s.underAttack) out.push({ kind: 'raid', pos: s.center, intensity: RAID_DANGER_INTENSITY });
  }
  return out;
}

/**
 * Contract function (PerceptionCtxLike per deviation 1; taboos explicit
 * since Temperament is Task 20). Assembles the full Perception the brain
 * decides against.
 */
export function buildPerception(p: Person, ctx: PerceptionCtxLike, taboos: ActionKind[]): Perception {
  const nearbyPeople = buildNearbyPeople(p, ctx);
  const nearbyTiles = buildNearbyTiles(p, ctx);

  const ownSettlementRaw = p.settlementId !== null ? ctx.settlements.find((s) => s.id === p.settlementId) : undefined;
  const settlement = ownSettlementRaw !== undefined ? settlementGlimpse(ownSettlementRaw, ctx) : null;

  const nearbySettlements = ctx.settlements
    .filter((s) => s.id !== p.settlementId)
    .filter((s) => dist(p.pos, s.center) <= PERCEPTION_RADIUS * NEARBY_SETTLEMENT_RADIUS_MULTIPLIER)
    .map((s) => settlementGlimpse(s, ctx));

  const civ = buildCivGlimpse(p, ctx);
  const dangers = buildDangers(p, ctx, nearbySettlements, settlement);
  const candidates = legalActions(p, toActionsCtx(ctx), taboos);

  return {
    tick: ctx.tick,
    self: p,
    candidates,
    nearbyPeople,
    nearbyTiles,
    settlement,
    nearbySettlements,
    civ,
    dangers,
  };
}
