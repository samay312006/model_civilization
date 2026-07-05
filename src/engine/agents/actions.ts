import {
  ADULT_AGE_TICKS,
  PERCEPTION_RADIUS,
  dist,
  type Action,
  type ActionKind,
  type Person,
  type Settlement,
  type Tick,
  type Vec2,
} from '../../shared/types';
import { isHabitable, type World } from '../world/terrain';
import type { SpatialIndex } from '../world/spatial';
import { desperationLevel } from './morality';
import { isKin } from './relationships';

/** Deviation 1: the minimal structural subset of the eventual EngineCtx candidate generation reads. */
export interface ActionsCtxLike {
  world: World;
  personById: Map<number, Person>;
  spatial: SpatialIndex;
  settlements: Settlement[];
  tick: Tick;
}

export const MIGRATE_RADIUS_MULTIPLIER = 3;
export const MIGRATE_CANDIDATE_CAP = 4;
export const EXPLORE_RING_OFFSET = 1;
export const FARM_MIN_FERTILITY = 0.3;
export const DESPERATION_TABOO_OVERRIDE = 0.95;

/** The reduced action set available to a person below ADULT_AGE_TICKS. */
export const CHILD_ACTION_KINDS: readonly ActionKind[] = ['gather', 'rest', 'socialize', 'explore', 'flee', 'teach'];

function isAdult(p: Person): boolean {
  return p.ageTicks >= ADULT_AGE_TICKS;
}

function tilesWithin(world: World, center: Vec2, radius: number): Vec2[] {
  const out: Vec2[] = [];
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (!world.inBounds(x, y)) continue;
      if (Math.hypot(dx, dy) > radius) continue;
      out.push({ x, y });
    }
  }
  return out;
}

function nearbyLivingPeople(p: Person, ctx: ActionsCtxLike): Person[] {
  const out: Person[] = [];
  for (const id of ctx.spatial.near(p.pos, PERCEPTION_RADIUS)) {
    if (id === p.id) continue;
    const other = ctx.personById.get(id);
    if (other !== undefined && other.alive) out.push(other);
  }
  return out;
}

function inventorySum(inv: { food: number; wood: number; stone: number; metal: number; tools: number }): number {
  return inv.food + inv.wood + inv.stone + inv.metal + inv.tools;
}

function farthestPointSubset(tiles: Vec2[], center: Vec2, cap: number): Vec2[] {
  if (tiles.length <= cap) return tiles;
  // Seed with the tile farthest from center, then greedily add the tile
  // farthest from all chosen so far (same heuristic as person.ts spawn regions).
  let seed = tiles[0] as Vec2;
  let seedDist = -1;
  for (const t of tiles) {
    const d = dist(t, center);
    if (d > seedDist) {
      seedDist = d;
      seed = t;
    }
  }
  const chosen: Vec2[] = [seed];
  while (chosen.length < cap) {
    let best = tiles[0] as Vec2;
    let bestMinDist = -1;
    for (const t of tiles) {
      let minDist = Infinity;
      for (const c of chosen) {
        const d = dist(t, c);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        best = t;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

function generateForAdultAndChild(p: Person, ctx: ActionsCtxLike): Action[] {
  const actions: Action[] = [];

  // rest, flee: always available.
  actions.push({ kind: 'rest' });
  actions.push({ kind: 'flee' });

  // gather: any tile within PERCEPTION_RADIUS with food > 0.
  for (const tile of tilesWithin(ctx.world, p.pos, PERCEPTION_RADIUS)) {
    if (ctx.world.tileAt(tile.x, tile.y).food > 0) actions.push({ kind: 'gather', tile });
  }

  // socialize: every nearby living person.
  for (const other of nearbyLivingPeople(p, ctx)) {
    actions.push({ kind: 'socialize', targetPersonId: other.id });
  }

  // explore: 8 compass tiles at PERCEPTION_RADIUS + EXPLORE_RING_OFFSET.
  const exploreDist = PERCEPTION_RADIUS + EXPLORE_RING_OFFSET;
  const compass: Vec2[] = [
    { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
  ];
  for (const dir of compass) {
    const tile: Vec2 = {
      x: p.pos.x + Math.round((dir.x * exploreDist) / Math.max(1, Math.hypot(dir.x, dir.y))),
      y: p.pos.y + Math.round((dir.y * exploreDist) / Math.max(1, Math.hypot(dir.x, dir.y))),
    };
    if (!ctx.world.inBounds(tile.x, tile.y)) continue;
    if (!isHabitable(ctx.world.tileAt(tile.x, tile.y).terrain)) continue;
    actions.push({ kind: 'explore', tile });
  }

  // teach: every nearby living person (receivable by a child target too, per
  // the acting-side gate applied below in legalActions).
  for (const other of nearbyLivingPeople(p, ctx)) {
    actions.push({ kind: 'teach', targetPersonId: other.id });
  }

  return actions;
}

function generateAdultOnly(p: Person, ctx: ActionsCtxLike): Action[] {
  const actions: Action[] = [];

  // farm: habitable tiles within PERCEPTION_RADIUS with fertility > FARM_MIN_FERTILITY.
  for (const tile of tilesWithin(ctx.world, p.pos, PERCEPTION_RADIUS)) {
    const t = ctx.world.tileAt(tile.x, tile.y);
    if (isHabitable(t.terrain) && t.fertility > FARM_MIN_FERTILITY) actions.push({ kind: 'farm', tile });
  }

  // hunt: one untargeted candidate.
  actions.push({ kind: 'hunt' });

  // build: one candidate per structure kind, only with a settlement.
  if (p.settlementId !== null) {
    for (const structure of ['shelter', 'granary', 'wall', 'shrine'] as const) {
      actions.push({ kind: 'build', structure });
    }
  }

  // craft: needs wood or stone.
  if (p.inventory.wood > 0 || p.inventory.stone > 0) actions.push({ kind: 'craft' });

  const neighbors = nearbyLivingPeople(p, ctx);

  // court: opposite sex, adult, unpartnered, not kin, not already partnered to self.
  for (const other of neighbors) {
    if (!isAdult(other)) continue;
    if (other.sex === p.sex) continue;
    if (other.partnerId !== null) continue;
    if (isKin(p, other.id)) continue;
    if (p.partnerId === other.id) continue;
    actions.push({ kind: 'court', targetPersonId: other.id });
  }

  // trade: non-empty target inventory.
  for (const other of neighbors) {
    if (inventorySum(other.inventory) > 0) actions.push({ kind: 'trade', targetPersonId: other.id });
  }

  // share: every nearby living person.
  for (const other of neighbors) {
    actions.push({ kind: 'share', targetPersonId: other.id });
  }

  // steal: non-empty target inventory, or a nearby foreign settlement with stock.
  for (const other of neighbors) {
    if (inventorySum(other.inventory) > 0) actions.push({ kind: 'steal', targetPersonId: other.id });
  }
  for (const settlement of ctx.settlements) {
    if (settlement.id === p.settlementId) continue;
    if (dist(p.pos, settlement.center) > PERCEPTION_RADIUS) continue;
    if (inventorySum(settlement.stock) > 0) actions.push({ kind: 'steal', tile: settlement.center });
  }

  // attack: not kin.
  for (const other of neighbors) {
    if (isKin(p, other.id)) continue;
    actions.push({ kind: 'attack', targetPersonId: other.id });
  }

  // migrate: habitable tiles beyond PERCEPTION_RADIUS but within
  // PERCEPTION_RADIUS * MIGRATE_RADIUS_MULTIPLIER, capped via farthest-point subset.
  const migrateOuter = tilesWithin(ctx.world, p.pos, PERCEPTION_RADIUS * MIGRATE_RADIUS_MULTIPLIER).filter(
    (t) => dist(t, p.pos) > PERCEPTION_RADIUS && isHabitable(ctx.world.tileAt(t.x, t.y).terrain),
  );
  for (const tile of farthestPointSubset(migrateOuter, p.pos, MIGRATE_CANDIDATE_CAP)) {
    actions.push({ kind: 'migrate', tile });
  }

  // worship: requires at least one belief.
  if (p.beliefIds.length > 0) actions.push({ kind: 'worship' });

  // heal: nearby living person with health < 1.
  for (const other of neighbors) {
    if (other.health < 1) actions.push({ kind: 'heal', targetPersonId: other.id });
  }

  return actions;
}

/**
 * Contract signature (ActionsCtxLike per deviation 1; taboos passed
 * explicitly since Temperament is Task 20). Generates every legal candidate
 * action for p, removes taboo kinds unless desperation reaches
 * DESPERATION_TABOO_OVERRIDE, and restricts children to CHILD_ACTION_KINDS
 * regardless of taboos or desperation.
 */
export function legalActions(p: Person, ctx: ActionsCtxLike, taboos: ActionKind[]): Action[] {
  let actions = generateForAdultAndChild(p, ctx);
  if (isAdult(p)) actions = actions.concat(generateAdultOnly(p, ctx));

  if (!isAdult(p)) {
    // Restrict to the reduced child set. 'teach' is listed in
    // CHILD_ACTION_KINDS to document that a child can be a teach *target* of
    // someone else's candidate, but a child never generates a 'teach'
    // candidate as the acting person, so it is dropped here too.
    actions = actions.filter((a) => CHILD_ACTION_KINDS.includes(a.kind) && a.kind !== 'teach');
  }

  if (taboos.length === 0) return actions;
  const desperate = desperationLevel(p) >= DESPERATION_TABOO_OVERRIDE;
  if (desperate) return actions;
  const tabooSet = new Set(taboos);
  return actions.filter((a) => !tabooSet.has(a.kind));
}
