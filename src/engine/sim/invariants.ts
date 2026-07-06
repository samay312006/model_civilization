import { MEMORY_CAP, RELATIONSHIP_CAP, type Person } from '../../shared/types';
import type { Simulation } from './simulation';

const PERSON_SCALAR_FIELDS: readonly (keyof Person)[] = ['ageTicks', 'health', 'lifespanTicks', 'influence'];

function checkFinite(value: number, label: string, out: string[]): void {
  if (!Number.isFinite(value)) out.push(`${label} is not finite (${value})`);
}

function checkNonNegative(value: number, label: string, out: string[]): void {
  if (!Number.isFinite(value) || value < 0) out.push(`${label} is negative or non-finite (${value})`);
}

function checkPerson(p: Person, civIds: Set<number>, out: string[]): void {
  const prefix = `person ${p.id}`;

  for (const field of PERSON_SCALAR_FIELDS) {
    checkFinite(p[field] as number, `${prefix}.${String(field)}`, out);
  }

  for (const [key, value] of Object.entries(p.traits)) checkFinite(value, `${prefix}.traits.${key}`, out);
  for (const [key, value] of Object.entries(p.emotions)) checkFinite(value, `${prefix}.emotions.${key}`, out);
  for (const [key, value] of Object.entries(p.morality)) checkFinite(value, `${prefix}.morality.${key}`, out);
  for (const [key, value] of Object.entries(p.needs)) checkFinite(value, `${prefix}.needs.${key}`, out);
  for (const [key, value] of Object.entries(p.skills)) checkFinite(value, `${prefix}.skills.${key}`, out);

  for (const [key, value] of Object.entries(p.inventory)) {
    checkNonNegative(value as number, `${prefix}.inventory.${key}`, out);
  }

  for (let i = 0; i < p.memory.length; i++) {
    const m = p.memory[i];
    if (m === undefined) continue;
    checkFinite(m.valence, `${prefix}.memory[${i}].valence`, out);
    checkFinite(m.salience, `${prefix}.memory[${i}].salience`, out);
  }
  if (p.memory.length > MEMORY_CAP) out.push(`${prefix}.memory exceeds MEMORY_CAP (${p.memory.length})`);

  for (let i = 0; i < p.relationships.length; i++) {
    const r = p.relationships[i];
    if (r === undefined) continue;
    checkFinite(r.affinity, `${prefix}.relationships[${i}].affinity`, out);
  }
  if (p.relationships.length > RELATIONSHIP_CAP) {
    out.push(`${prefix}.relationships exceeds RELATIONSHIP_CAP (${p.relationships.length})`);
  }

  if (p.brainState === undefined || p.brainState === null) {
    out.push(`${prefix}.brainState is missing (${String(p.brainState)})`);
  }

  if (!civIds.has(p.civId)) {
    out.push(`${prefix}.civId ${p.civId} does not match any known Civ`);
  }
}

/**
 * Contract signature verbatim: [] when healthy. Checks population
 * accounting, NaN/Inf across every numeric leaf of every alive Person,
 * non-negative stocks/inventory, valid brainState/civId on every alive
 * person, and memory/relationship caps. Dead people are never inspected.
 */
export function checkInvariants(sim: Simulation): string[] {
  const out: string[] = [];
  const ctx = sim.ctx;
  const civIds = new Set(ctx.civs.map((c) => c.id));

  for (const p of ctx.people) {
    if (!p.alive) continue;
    checkPerson(p, civIds, out);
  }

  for (const civ of ctx.civs) {
    for (const [domain, points] of Object.entries(civ.knowledge)) {
      checkNonNegative(points, `civ ${civ.id}.knowledge.${domain}`, out);
    }
    checkFinite(civ.warWeariness, `civ ${civ.id}.warWeariness`, out);
  }

  for (const s of ctx.settlements) {
    for (const [key, value] of Object.entries(s.stock)) {
      checkNonNegative(value as number, `settlement ${s.id}.stock.${key}`, out);
    }
  }

  const totalEverCreated = ctx.people.length;
  const alive = ctx.people.filter((p) => p.alive).length;
  const dead = ctx.people.filter((p) => !p.alive).length;
  if (alive + dead !== totalEverCreated) {
    out.push(`population accounting mismatch: alive(${alive}) + dead(${dead}) != total(${totalEverCreated})`);
  }

  return out;
}
