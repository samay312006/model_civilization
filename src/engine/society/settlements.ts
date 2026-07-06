import type { Civ, Person, Settlement, Terrain, Tick, Vec2 } from '../../shared/types';
import type { Rng } from '../rng';
import { isHabitable, type World } from '../world/terrain';
import type { SpatialIndex } from '../world/spatial';
import type { NameGen } from '../names';

/** Deviation 1: the minimal structural subset of the eventual EngineCtx settlements reads/writes. */
export interface SettlementsCtxLike {
  world: World;
  people: Person[];
  personById: Map<number, Person>;
  civs: Civ[];
  settlements: Settlement[];
  spatial: SpatialIndex;
  names: NameGen;
  tick: Tick;
  rng: Rng;
}

export const CLUSTER_MIN_MEMBERS = 5;
export const CLUSTER_RADIUS = 3;
export const DISSOLUTION_MIN_MEMBERS = 3;
export const OVERFLOW_SAFETY_PRESSURE = 0.1;

/** capacity = 10 + 8*shelters, doubled while the civ has active construction tech. */
export function settlementCapacity(s: Settlement, civ: Civ): number {
  const base = 10 + 8 * s.structures.shelter;
  return civ.techs.includes('construction') ? base * 2 : base;
}

function civOf(ctx: SettlementsCtxLike, civId: number): Civ | undefined {
  return ctx.civs.find((c) => c.id === civId);
}

function nextSettlementId(ctx: SettlementsCtxLike): number {
  let max = 0;
  for (const s of ctx.settlements) if (s.id > max) max = s.id;
  return max + 1;
}

/**
 * Full contract behavior, run once per tick (Simulation tick step 5, first
 * among the society calls):
 *   1. prune dead members out of every settlement's memberIds
 *   2. dissolve any settlement now under DISSOLUTION_MIN_MEMBERS, returning
 *      its stock evenly to its (former) members
 *   3. form new settlements from spatial clusters of >=5 unsettled alive
 *      people within CLUSTER_RADIUS of a habitable, non-water center
 *   4. apply overflow pressure: members beyond capacity (by ascending id)
 *      get needs.safety += OVERFLOW_SAFETY_PRESSURE this tick
 */
export function updateSettlements(ctx: SettlementsCtxLike): void {
  pruneDeadMembers(ctx);
  dissolveUndersized(ctx);
  formNewSettlements(ctx);
  applyOverflowPressure(ctx);
}

function pruneDeadMembers(ctx: SettlementsCtxLike): void {
  for (const s of ctx.settlements) {
    s.memberIds = s.memberIds.filter((id) => {
      const p = ctx.personById.get(id);
      return p !== undefined && p.alive;
    });
  }
}

function dissolveUndersized(ctx: SettlementsCtxLike): void {
  const surviving: Settlement[] = [];
  for (const s of [...ctx.settlements].sort((a, b) => a.id - b.id)) {
    if (s.memberIds.length >= DISSOLUTION_MIN_MEMBERS || s.memberIds.length === 0) {
      if (s.memberIds.length > 0) surviving.push(s);
      // a settlement that dropped to 0 members simply vanishes with no stock to return
      continue;
    }
    const members = s.memberIds
      .map((id) => ctx.personById.get(id))
      .filter((p): p is Person => p !== undefined && p.alive)
      .sort((a, b) => a.id - b.id);
    const n = members.length;
    if (n > 0) {
      const foodShare = s.stock.food / n;
      const woodShare = s.stock.wood / n;
      const stoneShare = s.stock.stone / n;
      const metalShare = s.stock.metal / n;
      const toolsShare = s.stock.tools / n;
      for (const p of members) {
        p.inventory.food += foodShare;
        p.inventory.wood += woodShare;
        p.inventory.stone += stoneShare;
        p.inventory.metal += metalShare;
        p.inventory.tools += toolsShare;
        p.settlementId = null;
      }
    }
  }
  // Mutate ctx.settlements in place (rather than reassigning the property) so
  // any other reference to the same array (e.g. a caller that captured it
  // before this call) observes the same final contents.
  ctx.settlements.length = 0;
  ctx.settlements.push(...surviving);
}

function formNewSettlements(ctx: SettlementsCtxLike): void {
  const unsettled = ctx.people
    .filter((p) => p.alive && p.settlementId === null)
    .sort((a, b) => a.id - b.id);
  const claimed = new Set<number>();

  for (const p of unsettled) {
    if (claimed.has(p.id)) continue;
    const x = Math.floor(p.pos.x);
    const y = Math.floor(p.pos.y);
    if (x < 0 || x >= ctx.world.size || y < 0 || y >= ctx.world.size) continue;
    if (!isHabitable(ctx.world.tileAt(x, y).terrain)) continue;

    const nearbyIds = ctx.spatial
      .near(p.pos, CLUSTER_RADIUS)
      .filter((id) => !claimed.has(id))
      .map((id) => ctx.personById.get(id))
      .filter((q): q is Person => q !== undefined && q.alive && q.settlementId === null)
      .sort((a, b) => a.id - b.id);

    if (nearbyIds.length < CLUSTER_MIN_MEMBERS) continue;

    const center: Vec2 = { x, y };
    const id = nextSettlementId(ctx);
    const settlement: Settlement = {
      id,
      civId: p.civId,
      name: ctx.names.place(),
      center,
      memberIds: nearbyIds.map((q) => q.id),
      stock: { food: 0, wood: 0, stone: 0, metal: 0, tools: 0 },
      structures: { shelter: 0, granary: 0, wall: 0, shrine: 0 },
    };
    for (const q of nearbyIds) {
      q.settlementId = id;
      claimed.add(q.id);
    }
    ctx.settlements.push(settlement);
  }
}

function applyOverflowPressure(ctx: SettlementsCtxLike): void {
  for (const s of [...ctx.settlements].sort((a, b) => a.id - b.id)) {
    const civ = civOf(ctx, s.civId);
    if (civ === undefined) continue;
    const capacity = settlementCapacity(s, civ);
    const members = [...s.memberIds].sort((a, b) => a - b);
    if (members.length <= capacity) continue;
    const overflow = members.slice(capacity);
    for (const id of overflow) {
      const p = ctx.personById.get(id);
      if (p === undefined || !p.alive) continue;
      p.needs.safety = Math.min(1, p.needs.safety + OVERFLOW_SAFETY_PRESSURE);
    }
  }
}
