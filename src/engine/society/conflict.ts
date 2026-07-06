import { clamp01, dist, type Civ, type Person, type Settlement, type Tick } from '../../shared/types';
import { leaderOf, type InfluenceCtxLike } from './influence';

/** Deviation 1: extends InfluenceCtxLike so leaderOf(s, ctx) is directly callable. */
export interface ConflictCtxLike extends InfluenceCtxLike {
  civs: Civ[];
  settlements: Settlement[];
}

export interface RaidResult {
  attackerWon: boolean;
  attackerCasualties: number[];
  defenderCasualties: number[];
  foodStolen: number;
}

export const RAID_CHECK_INTERVAL = 15;
export const RAID_AGGRESSION_THRESHOLD = 0.6;
export const RAID_FOOD_THRESHOLD = 0.5;
export const RAID_REVENGE_THRESHOLD = 0.5;
export const RAID_TARGET_MAX_DISTANCE = 30;
export const RAID_PARTY_MAX_SIZE = 8;
export const RAID_WILLING_AGGRESSION = 0.4;
export const RAID_WILLING_LOYALTY = 0.7;
export const RAID_CASUALTY_MIN = 1;
export const RAID_CASUALTY_MAX = 3;
export const RAID_CASUALTY_HEALTH_HIT = 0.4;
export const RAID_STEAL_FRACTION = 0.3;
export const RAID_WEARINESS_PER_CASUALTY = 0.02;
export const WAR_DECLARATION_WINDOW = 360; // 1 year at YEAR_TICKS = 360
export const WAR_DECLARATION_MIN_RAIDS = 3;
export const PEACE_WEARINESS_THRESHOLD = 0.7;
export const ALLIANCE_LOOKBACK_WINDOW = 720; // 2 years at YEAR_TICKS = 360
export const ALLIANCE_MAX_WEARINESS = 0.3;
export const ALLIANCE_FORM_CHANCE = 0.05;

interface WithRaidHistory {
  _raidHistory?: { otherCivId: number; timestamps: Tick[] }[];
}

/** Deviation 3: alliance membership tracked outside the frozen Civ contract type. */
interface WithAlliance {
  _alliedWith?: number[];
}

/** True iff civB.id is present in civA's alliance list (absent treated as empty). */
export function isAllied(civA: Civ, civB: Civ): boolean {
  const ext = civA as Civ & WithAlliance;
  return (ext._alliedWith ?? []).includes(civB.id);
}

function foodPerCapita(s: Settlement): number {
  const pop = s.memberIds.length;
  if (pop === 0) return 0;
  return s.stock.food / pop;
}

function revengeMemorySum(p: Person): number {
  const relevantKinds = new Set(['harmed', 'kin-died', 'defeat']);
  let sum = 0;
  for (const m of p.memory) {
    if (relevantKinds.has(m.kind)) sum += -m.valence * m.salience;
  }
  return clamp01(sum);
}

function nearestOtherCivSettlement(
  from: Settlement,
  ctx: ConflictCtxLike,
): Settlement | null {
  const fromCiv = ctx.civs.find((c) => c.id === from.civId);
  let best: Settlement | null = null;
  let bestDist = Infinity;
  for (const s of [...ctx.settlements].sort((a, b) => a.id - b.id)) {
    if (s.civId === from.civId) continue;
    if (fromCiv !== undefined) {
      const targetCiv = ctx.civs.find((c) => c.id === s.civId);
      if (targetCiv !== undefined && isAllied(fromCiv, targetCiv)) continue; // never raid an ally
    }
    const d = dist(from.center, s.center);
    if (d > RAID_TARGET_MAX_DISTANCE) continue;
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/**
 * Combat resolution: attackPower = sum(fighting) * (1 + 0.3 metallurgy);
 * defensePower = sum(fighting) * (1 + 0.5 walls). Higher power wins (ties
 * favor the defender). The losing side takes 1-3 casualties (0.4 health hit
 * each, dying at <=0). Winning attackers steal up to 30% of the defender's
 * food stock. Both sides gain matching memories/emotions; own-side
 * casualties raise that side's civ warWeariness by 0.02 each.
 */
export function resolveRaid(
  attackers: Person[],
  defenders: Person[],
  attackerCiv: Civ,
  defenderCiv: Civ,
  defenderSettlement: Settlement,
  ctx: ConflictCtxLike,
): RaidResult {
  const attackPower =
    attackers.reduce((sum, p) => sum + p.skills.fighting, 0) *
    (attackerCiv.techs.includes('metallurgy') ? 1.3 : 1);
  const defensePower =
    defenders.reduce((sum, p) => sum + p.skills.fighting, 0) *
    (defenderSettlement.structures.wall > 0 ? 1.5 : 1);

  const attackerWon = attackPower > defensePower;
  const losers = (attackerWon ? defenders : attackers).slice().sort((a, b) => a.id - b.id);
  const loserCiv = attackerWon ? defenderCiv : attackerCiv;

  const casualtyRoll = ctx.rng.split(`raid-casualties-${ctx.tick}-${defenderSettlement.id}`);
  const casualtyCount = Math.min(
    losers.length,
    RAID_CASUALTY_MIN + casualtyRoll.int(RAID_CASUALTY_MAX - RAID_CASUALTY_MIN + 1),
  );
  const casualties = losers.slice(0, casualtyCount);

  for (const p of casualties) {
    p.health = Math.max(0, p.health - RAID_CASUALTY_HEALTH_HIT);
    if (p.health <= 0) {
      p.alive = false;
      p.causeOfDeath = 'violence';
    }
  }
  loserCiv.warWeariness = clamp01(loserCiv.warWeariness + casualties.length * RAID_WEARINESS_PER_CASUALTY);

  let foodStolen = 0;
  if (attackerWon) {
    foodStolen = defenderSettlement.stock.food * RAID_STEAL_FRACTION;
    defenderSettlement.stock.food -= foodStolen;
  }

  for (const p of attackers) {
    p.emotions.anger = clamp01(p.emotions.anger + (attackerWon ? 0.1 : 0.3));
    p.memory.unshift({
      tick: ctx.tick,
      kind: attackerWon ? 'victory' : 'defeat',
      otherId: defenders[0]?.id ?? -1,
      valence: attackerWon ? 0.6 : -0.6,
      salience: 0.7,
    });
  }
  for (const p of defenders) {
    p.emotions.fear = clamp01(p.emotions.fear + (attackerWon ? 0.4 : 0.1));
    p.emotions.anger = clamp01(p.emotions.anger + 0.2);
    p.memory.unshift({
      tick: ctx.tick,
      kind: attackerWon ? 'defeat' : 'victory',
      otherId: attackers[0]?.id ?? -1,
      valence: attackerWon ? -0.6 : 0.6,
      salience: 0.7,
    });
  }
  for (const p of casualties) {
    p.memory.unshift({ tick: ctx.tick, kind: 'harmed', otherId: -1, valence: -0.8, salience: 0.9 });
  }

  return {
    attackerWon,
    attackerCasualties: attackerWon ? [] : casualties.map((p) => p.id).sort((a, b) => a - b),
    defenderCasualties: attackerWon ? casualties.map((p) => p.id).sort((a, b) => a - b) : [],
    foodStolen,
  };
}

function recordRaid(attackerCiv: Civ, defenderCiv: Civ, tick: Tick): void {
  const a = attackerCiv as Civ & WithRaidHistory;
  const b = defenderCiv as Civ & WithRaidHistory;
  a._raidHistory = a._raidHistory ?? [];
  b._raidHistory = b._raidHistory ?? [];
  let entryA = a._raidHistory.find((e) => e.otherCivId === defenderCiv.id);
  if (entryA === undefined) {
    entryA = { otherCivId: defenderCiv.id, timestamps: [] };
    a._raidHistory.push(entryA);
  }
  entryA.timestamps.push(tick);
  let entryB = b._raidHistory.find((e) => e.otherCivId === attackerCiv.id);
  if (entryB === undefined) {
    entryB = { otherCivId: attackerCiv.id, timestamps: [] };
    b._raidHistory.push(entryB);
  }
  entryB.timestamps.push(tick);
}

/**
 * Every RAID_CHECK_INTERVAL ticks, per settlement (ascending id): an
 * aggressive leader (traits.aggression > 0.6) facing scarcity
 * (foodPerCapita < 0.5) or a grudge (revenge memory sum > 0.5) raids the
 * nearest other-civ settlement within RAID_TARGET_MAX_DISTANCE, fielding up
 * to RAID_PARTY_MAX_SIZE willing fighters (aggression > 0.4 or
 * morality.loyalty > 0.7).
 */
export function updateConflict(ctx: ConflictCtxLike): void {
  if (ctx.tick % RAID_CHECK_INTERVAL !== 0) return;

  for (const s of [...ctx.settlements].sort((a, b) => a.id - b.id)) {
    const leader = leaderOf(s, ctx);
    if (leader === null) continue;
    if (leader.traits.aggression <= RAID_AGGRESSION_THRESHOLD) continue;

    const scarce = foodPerCapita(s) < RAID_FOOD_THRESHOLD;
    const vengeful = revengeMemorySum(leader) > RAID_REVENGE_THRESHOLD;
    if (!scarce && !vengeful) continue;

    const target = nearestOtherCivSettlement(s, ctx);
    if (target === null) continue;

    const attackerCiv = ctx.civs.find((c) => c.id === s.civId);
    const defenderCiv = ctx.civs.find((c) => c.id === target.civId);
    if (attackerCiv === undefined || defenderCiv === undefined) continue;

    const willing = [...s.memberIds]
      .sort((a, b) => a - b)
      .map((id) => ctx.personById.get(id))
      .filter(
        (p): p is Person =>
          p !== undefined &&
          p.alive &&
          (p.traits.aggression > RAID_WILLING_AGGRESSION || p.morality.loyalty > RAID_WILLING_LOYALTY),
      )
      .slice(0, RAID_PARTY_MAX_SIZE);
    if (willing.length === 0) continue;

    const defenders = [...target.memberIds]
      .sort((a, b) => a - b)
      .map((id) => ctx.personById.get(id))
      .filter((p): p is Person => p !== undefined && p.alive);
    if (defenders.length === 0) continue;

    resolveRaid(willing, defenders, attackerCiv, defenderCiv, target, ctx);
    recordRaid(attackerCiv, defenderCiv, ctx.tick);
  }

  updateWarState(ctx);
}

/**
 * War declared once 3+ raids occur between the same civ pair within
 * WAR_DECLARATION_WINDOW ticks; peace declared once both civs' warWeariness
 * exceed PEACE_WEARINESS_THRESHOLD, resetting weariness and raid history for
 * that pair.
 */
export function updateWarState(ctx: ConflictCtxLike): void {
  const civs = [...ctx.civs].sort((a, b) => a.id - b.id);
  for (const civ of civs) {
    const ext = civ as Civ & WithRaidHistory;
    if (ext._raidHistory === undefined) continue;
    for (const entry of ext._raidHistory) {
      const recent = entry.timestamps.filter((t) => ctx.tick - t <= WAR_DECLARATION_WINDOW);
      entry.timestamps = recent;
      if (recent.length >= WAR_DECLARATION_MIN_RAIDS && !civ.atWarWith.includes(entry.otherCivId)) {
        civ.atWarWith.push(entry.otherCivId);
        const other = civs.find((c) => c.id === entry.otherCivId);
        if (other !== undefined && !other.atWarWith.includes(civ.id)) {
          other.atWarWith.push(civ.id);
        }
        entry.timestamps = [];
        const otherExt = other as (Civ & WithRaidHistory) | undefined;
        const otherEntry = otherExt?._raidHistory?.find((e) => e.otherCivId === civ.id);
        if (otherEntry !== undefined) otherEntry.timestamps = [];

        // Declaring war immediately dissolves any standing alliance between the pair.
        const civAlliance = civ as Civ & WithAlliance;
        civAlliance._alliedWith = (civAlliance._alliedWith ?? []).filter((id) => id !== entry.otherCivId);
        if (other !== undefined) {
          const otherAlliance = other as Civ & WithAlliance;
          otherAlliance._alliedWith = (otherAlliance._alliedWith ?? []).filter((id) => id !== civ.id);
        }
      }
    }
  }

  for (const civ of civs) {
    for (const otherId of [...civ.atWarWith]) {
      if (otherId < civ.id) continue; // process each pair once (lower id drives it)
      const other = civs.find((c) => c.id === otherId);
      if (other === undefined) continue;
      if (civ.warWeariness > PEACE_WEARINESS_THRESHOLD && other.warWeariness > PEACE_WEARINESS_THRESHOLD) {
        civ.atWarWith = civ.atWarWith.filter((id) => id !== other.id);
        other.atWarWith = other.atWarWith.filter((id) => id !== civ.id);
        civ.warWeariness = 0;
        other.warWeariness = 0;
      }
    }
  }

  maybeFormAlliances(ctx);
}

/**
 * Spec section 6 "alliances" coverage: for every distinct civ pair (ascending
 * id, each pair evaluated once) that is not at war, not already allied, has
 * no raids against each other within ALLIANCE_LOOKBACK_WINDOW, and both
 * sides have warWeariness below ALLIANCE_MAX_WEARINESS, roll
 * ALLIANCE_FORM_CHANCE per tick this function runs; on success both civs add
 * each other to their _alliedWith list (deviation 3 extension property).
 */
export function maybeFormAlliances(ctx: ConflictCtxLike): void {
  const civs = [...ctx.civs].sort((a, b) => a.id - b.id);
  for (const civA of civs) {
    for (const civB of civs) {
      if (civB.id <= civA.id) continue; // each unordered pair once, lower id drives it

      if (civA.atWarWith.includes(civB.id) || civB.atWarWith.includes(civA.id)) continue;
      if (isAllied(civA, civB) || isAllied(civB, civA)) continue;

      const historyA = (civA as Civ & WithRaidHistory)._raidHistory?.find((e) => e.otherCivId === civB.id);
      const historyB = (civB as Civ & WithRaidHistory)._raidHistory?.find((e) => e.otherCivId === civA.id);
      const recentRaid =
        (historyA?.timestamps.some((t) => ctx.tick - t <= ALLIANCE_LOOKBACK_WINDOW) ?? false) ||
        (historyB?.timestamps.some((t) => ctx.tick - t <= ALLIANCE_LOOKBACK_WINDOW) ?? false);
      if (recentRaid) continue;

      if (civA.warWeariness >= ALLIANCE_MAX_WEARINESS || civB.warWeariness >= ALLIANCE_MAX_WEARINESS) continue;

      const roll = ctx.rng.split(`alliance-${civA.id}-${civB.id}-${ctx.tick}`);
      if (!roll.chance(ALLIANCE_FORM_CHANCE)) continue;

      const extA = civA as Civ & WithAlliance;
      const extB = civB as Civ & WithAlliance;
      extA._alliedWith = [...(extA._alliedWith ?? []), civB.id].filter((id, i, arr) => arr.indexOf(id) === i);
      extB._alliedWith = [...(extB._alliedWith ?? []), civA.id].filter((id, i, arr) => arr.indexOf(id) === i);
    }
  }
}
