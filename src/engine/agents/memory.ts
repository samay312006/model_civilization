import { MEMORY_CAP, clamp, type MemoryEventRec, type Person } from '../../shared/types';

export const FADE_RATE = 0.999;
export const FADE_MIN = 0.05;

/**
 * Contract signature verbatim: newest-first insertion; evicts the
 * lowest-salience entry among everything except the just-inserted record
 * whenever the cap is exceeded. Ties break toward the older memory (the
 * later index, since the list is newest-first).
 */
export function remember(p: Person, rec: MemoryEventRec): void {
  p.memory.unshift(rec);
  if (p.memory.length <= MEMORY_CAP) return;

  // Search indices [1, length) only — index 0 is the record just inserted
  // and must never be evicted by its own insertion.
  let evictIndex = 1;
  let lowestSalience = p.memory[1]?.salience ?? Infinity;
  for (let i = 2; i < p.memory.length; i++) {
    const salience = (p.memory[i] as MemoryEventRec).salience;
    if (salience <= lowestSalience) {
      lowestSalience = salience;
      evictIndex = i; // <= keeps the later (older) index on ties
    }
  }
  p.memory.splice(evictIndex, 1);
}

/**
 * Contract signature verbatim: every salience *= FADE_RATE, then drop
 * anything below FADE_MIN. Order is preserved among survivors.
 */
export function fadeMemories(p: Person): void {
  for (const m of p.memory) m.salience *= FADE_RATE;
  p.memory = p.memory.filter((m) => m.salience >= FADE_MIN);
}

/**
 * Contract signature verbatim: clamp(sum(valence*salience) over memories
 * about otherId, -1, 1).
 */
export function memoryBias(p: Person, otherId: number): number {
  let sum = 0;
  for (const m of p.memory) {
    if (m.otherId === otherId) sum += m.valence * m.salience;
  }
  return clamp(sum, -1, 1);
}
