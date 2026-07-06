import { clamp01, dist, type Civ, type Person, type Settlement, type Tick } from '../../shared/types';
import type { Rng } from '../rng';

/** Deviation 1: the minimal structural subset of the eventual EngineCtx economy reads/writes. */
export interface EconomyCtxLike {
  people: Person[];
  personById: Map<number, Person>;
  civs: Civ[];
  settlements: Settlement[];
  tick: Tick;
  rng: Rng;
}

export const SHARE_DEPOSIT_FLOOR = 3;
export const SHARE_DRAW_HUNGER_THRESHOLD = 0.5;
export const TRADE_INTERVAL = 30;
export const TRADE_MAX_DISTANCE = 25;
export const TRADE_MAX_SWAP = 1;
export const TRADE_AFFINITY_BOOST = 0.05;

type TradeResource = 'food' | 'wood' | 'stone' | 'metal';
const TRADE_RESOURCES: TradeResource[] = ['food', 'wood', 'stone', 'metal'];

function shareRate(p: Person): number {
  return clamp01(0.5 + 0.25 * p.morality.care + 0.15 * p.morality.loyalty - 0.3 * p.morality.liberty);
}

/**
 * Members deposit surplus food above SHARE_DEPOSIT_FLOOR into their
 * settlement's stock, scaled by shareRate; hungry members (needs.hunger >
 * SHARE_DRAW_HUNGER_THRESHOLD) draw up to 1 food from stock when available.
 */
export function shareWithin(ctx: EconomyCtxLike): void {
  for (const s of [...ctx.settlements].sort((a, b) => a.id - b.id)) {
    const members = [...s.memberIds]
      .sort((a, b) => a - b)
      .map((id) => ctx.personById.get(id))
      .filter((p): p is Person => p !== undefined && p.alive);

    for (const p of members) {
      if (p.inventory.food > SHARE_DEPOSIT_FLOOR) {
        const rate = shareRate(p);
        const deposit = Math.min(p.inventory.food - SHARE_DEPOSIT_FLOOR, p.inventory.food * rate);
        p.inventory.food -= deposit;
        s.stock.food += deposit;
      }
      if (p.needs.hunger > SHARE_DRAW_HUNGER_THRESHOLD && s.stock.food > 0) {
        const draw = Math.min(1, s.stock.food);
        s.stock.food -= draw;
        p.inventory.food += draw;
      }
    }
  }
}

/** Direct clamp-and-upsert relationship affinity boost, scoped to leader pairs (see Task 31 notes). */
function boostAffinity(p: Person, otherId: number, delta: number): void {
  const existing = p.relationships.find((r) => r.otherId === otherId);
  if (existing !== undefined) {
    existing.affinity = Math.max(-1, Math.min(1, existing.affinity + delta));
  } else {
    p.relationships.push({ otherId, kind: 'friend', affinity: Math.max(-1, Math.min(1, delta)) });
  }
}

function leaderOfSettlement(s: Settlement, ctx: EconomyCtxLike): Person | null {
  let leader: Person | null = null;
  for (const id of [...s.memberIds].sort((a, b) => a - b)) {
    const p = ctx.personById.get(id);
    if (p === undefined || !p.alive) continue;
    if (leader === null || p.influence > leader.influence) leader = p;
  }
  return leader;
}

/**
 * Every TRADE_INTERVAL ticks: adjacent (dist < TRADE_MAX_DISTANCE), non-warring
 * settlement pairs (ascending id order) swap up to TRADE_MAX_SWAP units 1:1 of
 * a resource one has in surplus for a different resource the other has in
 * surplus, and boost leader-pair affinity on any successful swap.
 */
export function tradeBetween(ctx: EconomyCtxLike): void {
  if (ctx.tick % TRADE_INTERVAL !== 0) return;

  const settlements = [...ctx.settlements].sort((a, b) => a.id - b.id);
  for (let i = 0; i < settlements.length; i++) {
    for (let j = i + 1; j < settlements.length; j++) {
      const a = settlements[i] as Settlement;
      const b = settlements[j] as Settlement;
      if (dist(a.center, b.center) >= TRADE_MAX_DISTANCE) continue;

      const civA = ctx.civs.find((c) => c.id === a.civId);
      const civB = ctx.civs.find((c) => c.id === b.civId);
      if (civA === undefined || civB === undefined) continue;
      if (civA.atWarWith.includes(civB.id) || civB.atWarWith.includes(civA.id)) continue;

      const popA = a.memberIds.length;
      const popB = b.memberIds.length;
      let traded = false;

      for (const give of TRADE_RESOURCES) {
        for (const take of TRADE_RESOURCES) {
          if (give === take) continue;
          const aSurplusGive = a.stock[give] > 2 * popA;
          const bSurplusTake = b.stock[take] > 2 * popB;
          const aSurplusTake = a.stock[take] > 2 * popA;
          const bSurplusGive = b.stock[give] > 2 * popB;
          if (!aSurplusGive || !bSurplusTake || aSurplusTake || bSurplusGive) continue;

          const amount = Math.min(a.stock[give] - 2 * popA, b.stock[take] - 2 * popB, TRADE_MAX_SWAP);
          if (amount <= 0) continue;

          a.stock[give] -= amount;
          b.stock[take] -= amount;
          a.stock[take] += amount;
          b.stock[give] += amount;
          traded = true;
        }
      }

      if (traded) {
        const leaderA = leaderOfSettlement(a, ctx);
        const leaderB = leaderOfSettlement(b, ctx);
        if (leaderA !== null && leaderB !== null) {
          boostAffinity(leaderA, leaderB.id, TRADE_AFFINITY_BOOST);
          boostAffinity(leaderB, leaderA.id, TRADE_AFFINITY_BOOST);
        }
      }
    }
  }
}
