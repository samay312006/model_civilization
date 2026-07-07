import type { Tick } from '../../shared/types';

/** Contract signature verbatim. */
export interface NarrativeEvent {
  tick: Tick;
  kind: string;
  severity: 1 | 2 | 3;
  civId: number | null;
  text: string;
}

export const EVENT_LOG_CAP = 500;

/**
 * The minimal structural shape pushEvent needs — every real EngineCtx
 * satisfies this (assignable, not identical), avoiding a circular import on
 * simulation.ts (which itself imports pushEvent/NarrativeEvent from here).
 */
export interface EventLogLike {
  events: NarrativeEvent[];
  tick: Tick;
}

/** Appends an event at the log's current tick, then trims to EVENT_LOG_CAP from the front (oldest first). */
export function pushEvent(
  log: EventLogLike,
  kind: string,
  severity: 1 | 2 | 3,
  civId: number | null,
  text: string,
): void {
  log.events.push({ tick: log.tick, kind, severity, civId, text });
  if (log.events.length > EVENT_LOG_CAP) {
    log.events.splice(0, log.events.length - EVENT_LOG_CAP);
  }
}

export function narrateBirth(childName: string, motherName: string, fatherName: string): string {
  return `${childName} is born to ${motherName} and ${fatherName}.`;
}

export function narrateDeath(personName: string, cause: string): string {
  return `${personName} has died of ${cause}.`;
}

export function narrateSettlementFounded(settlementName: string, civName: string): string {
  return `${settlementName} is founded by the people of ${civName}.`;
}

export function narrateSettlementDissolved(settlementName: string): string {
  return `${settlementName} is abandoned; its people scatter.`;
}

export function narrateLeaderEmerged(personName: string, settlementName: string): string {
  return `${personName} rises to lead ${settlementName}.`;
}

export function narrateTechUnlocked(techId: string, civName: string): string {
  return `${civName} masters ${techId}.`;
}

export function narrateTechLost(techId: string, civName: string): string {
  return `${civName} loses the knowledge of ${techId}.`;
}

export function narrateReligionFounded(religionName: string, founderName: string, civName: string): string {
  return `${founderName} founds ${religionName} among the people of ${civName}.`;
}

export function narrateRaid(attackerCivName: string, defenderSettlementName: string, attackerWon: boolean): string {
  return attackerWon
    ? `${attackerCivName} raiders sack ${defenderSettlementName}.`
    : `${attackerCivName} raiders are repelled at ${defenderSettlementName}.`;
}

export function narrateWarDeclared(civAName: string, civBName: string): string {
  return `War breaks out between ${civAName} and ${civBName}.`;
}

export function narratePeace(civAName: string, civBName: string): string {
  return `${civAName} and ${civBName} make peace, weary of war.`;
}

export function narrateSchism(settlementName: string, newCivName: string, oldCivName: string): string {
  return `${settlementName} breaks away from ${oldCivName} and founds ${newCivName}.`;
}

export function narrateFamine(settlementName: string): string {
  return `Famine grips ${settlementName}.`;
}

export function narrateDisaster(kind: 'drought' | 'harsh-winter' | 'disease', regionDescription: string): string {
  const label = kind === 'harsh-winter' ? 'a harsh winter' : kind === 'drought' ? 'drought' : 'disease';
  return `${label[0]?.toUpperCase()}${label.slice(1)} strikes ${regionDescription}.`;
}

export function narrateExtinction(): string {
  return 'The last person has died. The world falls silent.';
}
