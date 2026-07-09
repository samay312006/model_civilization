import {
  LINEAGES,
  TECH_IDS,
  type Morality,
  type Emotions,
  type Lineage,
  type RelationKind,
  type StructureKind,
} from '../../shared/types';
import { seasonOf } from '../world/climate';
import { dominantEmotion } from '../agents/emotions';
import { getBrain } from '../brains/registry';
import type { Simulation } from './simulation';
import {
  MOOD_ORDER,
  TERRITORY_RADIUS,
  type CivMetrics,
  type PersonDetail,
  type SettlementView,
  type Snapshot,
} from '../../shared/protocol';

const YEAR_TICKS_LOCAL = 360;

interface WithLastSnapshotTick {
  _lastSnapshotTick?: number;
}

function moralityZero(): Morality {
  return { care: 0, fairness: 0, loyalty: 0, authority: 0, sanctity: 0, liberty: 0 };
}

function emotionsZero(): Emotions {
  return { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 };
}

function structuresZero(): Record<StructureKind, number> {
  return { shelter: 0, granary: 0, wall: 0, shrine: 0 };
}

function moodIndex(p: Parameters<typeof dominantEmotion>[0]): number {
  const mood = dominantEmotion(p);
  const idx = MOOD_ORDER.indexOf(mood);
  return idx >= 0 ? idx : 0;
}

/**
 * Contract signature verbatim. Typed arrays cover alive people only, in
 * ascending id order. territory is null unless includeTerritory is true.
 * recentEvents returns only events appended since the previous call on this
 * Simulation instance (tracked via a per-instance extension property).
 */
export function takeSnapshot(sim: Simulation, includeTerritory: boolean): Snapshot {
  const ctx = sim.ctx;
  const alive = ctx.people.filter((p) => p.alive).sort((a, b) => a.id - b.id);
  const n = alive.length;

  const ids = new Int32Array(n);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const civIds = new Int16Array(n);
  const lineages = new Int8Array(n);
  const healths = new Uint8Array(n);
  const moods = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const p = alive[i]!;
    ids[i] = p.id;
    xs[i] = p.pos.x;
    ys[i] = p.pos.y;
    civIds[i] = p.civId;
    lineages[i] = LINEAGES.indexOf(p.lineage);
    healths[i] = Math.round(Math.max(0, Math.min(1, p.health)) * 255);
    moods[i] = moodIndex(p);
  }

  const settlements: SettlementView[] = ctx.settlements
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((s) => ({
      id: s.id,
      civId: s.civId,
      x: s.center.x,
      y: s.center.y,
      population: s.memberIds.filter((id) => ctx.personById.get(id)?.alive === true).length,
      name: s.name,
      structures: { ...s.structures },
    }));

  const territory = includeTerritory ? computeTerritory(sim) : null;

  const ext = sim as Simulation & WithLastSnapshotTick;
  const since = ext._lastSnapshotTick ?? -1;
  const recentEvents = ctx.events.filter((e) => e.tick > since);
  ext._lastSnapshotTick = ctx.tick;

  const metrics = computeMetrics(sim);

  return {
    tick: ctx.tick,
    year: Math.floor(ctx.tick / YEAR_TICKS_LOCAL),
    season: seasonOf(ctx.tick),
    population: n,
    worldSize: ctx.world.size,
    mode: sim.config.mode,
    ids,
    xs,
    ys,
    civIds,
    lineages,
    healths,
    moods,
    settlements,
    territory,
    recentEvents,
    metrics,
  };
}

/** Nearest-settlement-within-TERRITORY_RADIUS-tiles ownership, ties broken by lowest settlement id. */
function computeTerritory(sim: Simulation): Int16Array {
  const ctx = sim.ctx;
  const size = ctx.world.size;
  const territory = new Int16Array(size * size).fill(-1);
  const settlements = ctx.settlements.slice().sort((a, b) => a.id - b.id);
  if (settlements.length === 0) return territory;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bestCivId = -1;
      let bestDist = Infinity;
      for (const s of settlements) {
        const d = Math.hypot(x - s.center.x, y - s.center.y);
        if (d > TERRITORY_RADIUS) continue;
        if (d < bestDist) {
          bestDist = d;
          bestCivId = s.civId;
        }
      }
      territory[y * size + x] = bestCivId;
    }
  }
  return territory;
}

function computeMetrics(sim: Simulation): CivMetrics[] {
  const ctx = sim.ctx;
  const out: CivMetrics[] = [];
  for (const civ of [...ctx.civs].sort((a, b) => a.id - b.id)) {
    const members = ctx.people.filter((p) => p.alive && p.civId === civ.id);
    const population = members.length;

    const lineageCounts: Record<Lineage, number> = { opus: 0, sonnet: 0, haiku: 0, fable: 0 };
    for (const p of members) lineageCounts[p.lineage] += 1;
    const lineageShare: Record<Lineage, number> = { opus: 0, sonnet: 0, haiku: 0, fable: 0 };
    for (const lineage of LINEAGES) {
      lineageShare[lineage] = population > 0 ? lineageCounts[lineage] / population : 0;
    }

    const avgMorality = moralityZero();
    const avgEmotions = emotionsZero();
    if (population > 0) {
      for (const p of members) {
        for (const key of Object.keys(avgMorality) as (keyof Morality)[]) avgMorality[key] += p.morality[key];
        for (const key of Object.keys(avgEmotions) as (keyof Emotions)[]) avgEmotions[key] += p.emotions[key];
      }
      for (const key of Object.keys(avgMorality) as (keyof Morality)[]) avgMorality[key] /= population;
      for (const key of Object.keys(avgEmotions) as (keyof Emotions)[]) avgEmotions[key] /= population;
    }

    let totalFood = members.reduce((sum, p) => sum + p.inventory.food, 0);
    for (const s of ctx.settlements) if (s.civId === civ.id) totalFood += s.stock.food;

    out.push({
      civId: civ.id,
      name: civ.name,
      color: civ.color,
      population,
      births: ctx.counters.births,
      deaths: ctx.counters.deaths,
      techCount: civ.techs.length,
      atWar: civ.atWarWith.length > 0,
      lineageShare,
      avgMorality,
      avgEmotions,
      foodPerCapita: population > 0 ? totalFood / population : 0,
    });
  }
  return out;
}

/** Contract signature verbatim. null for an unknown id. */
export function personDetail(sim: Simulation, id: number): PersonDetail | null {
  const ctx = sim.ctx;
  const person = ctx.personById.get(id);
  if (person === undefined) return null;

  const nameOf = (otherId: number): string => ctx.personById.get(otherId)?.name ?? 'someone';

  const memoriesText = person.memory.map((m) => `${m.kind} involving ${nameOf(m.otherId)} (tick ${m.tick})`);
  const relationshipsNamed: { name: string; kind: RelationKind; affinity: number }[] = person.relationships.map(
    (r) => ({ name: nameOf(r.otherId), kind: r.kind, affinity: r.affinity }),
  );

  const temperament = getBrain(person.lineage).temperament();

  const settlement =
    person.settlementId !== null ? ctx.settlements.find((s) => s.id === person.settlementId) : undefined;
  const settlementName = settlement !== undefined ? settlement.name : null;

  const civ = ctx.civs.find((c) => c.id === person.civId);
  const civName = civ !== undefined ? civ.name : 'unknown';

  return { person, memoriesText, relationshipsNamed, temperament, settlementName, civName };
}

// TECH_IDS is imported to keep this module's dependency surface explicit for
// future metrics extensions (e.g. per-tech adoption counts); no current
// field uses it directly beyond civ.techs.length above.
void TECH_IDS;
