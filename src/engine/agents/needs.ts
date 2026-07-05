import { clamp01, type Person, type Tick } from '../../shared/types';

export const HUNGER_RATE = 0.02;
export const HUNGER_RATE_FED = 0.01;
export const REST_RATE = 0.015;
export const SAFETY_DECAY = 0.01;
export const RECENT_THREAT_CONTRIBUTION = 0.05;
export const SAFETY_MEMORY_WINDOW = 90;
export const BELONGING_ADAPT_RATE = 0.05;
export const ESTEEM_ADAPT_RATE = 0.05;
export const HUNGER_HEALTH_DRAIN = 0.01;
export const HUNGER_HEALTH_THRESHOLD = 0.85;

const THREAT_MEMORY_KINDS = new Set(['harmed', 'death-witnessed', 'kin-died', 'disaster']);

/**
 * Extension property backing the "ate this tick" flag, mirroring the
 * infection-extension-property pattern used by lifecycle.ts (Section 4).
 * Plain boolean, so it survives JSON serialization for free.
 */
interface WithFed {
  ateThisTick?: boolean;
}

/** Marks the person as having eaten this tick; halves the next updateNeeds hunger gain. */
export function markFed(p: Person): void {
  (p as Person & WithFed).ateThisTick = true;
}

/**
 * Reads the fed flag. When consume is true, clears it (the canonical use
 * inside updateNeeds, so the discount only ever applies to the tick it was
 * set on). When false, only peeks — safe for tests/UI to call any time.
 */
export function wasFedToday(p: Person, consume: boolean): boolean {
  const ext = p as Person & WithFed;
  const fed = ext.ateThisTick === true;
  if (consume) ext.ateThisTick = false;
  return fed;
}

/**
 * Per-tick need drift for one living person (Task 33 tick step 3, before
 * decayEmotions). Hunger and rest rise; safety and belonging/esteem relax
 * toward moving targets. All five fields end clamped to [0, 1].
 */
export function updateNeeds(p: Person, tick: Tick): void {
  const fed = wasFedToday(p, true);
  p.needs.hunger = clamp01(p.needs.hunger + (fed ? HUNGER_RATE_FED : HUNGER_RATE));

  p.needs.rest = clamp01(p.needs.rest + REST_RATE);

  let threatSalience = 0;
  for (const rec of p.memory) {
    if (!THREAT_MEMORY_KINDS.has(rec.kind)) continue;
    if (tick - rec.tick > SAFETY_MEMORY_WINDOW) continue;
    threatSalience += rec.salience;
  }
  const threatContribution = RECENT_THREAT_CONTRIBUTION * Math.min(1, threatSalience);
  p.needs.safety = clamp01(p.needs.safety - SAFETY_DECAY + threatContribution);

  const belongingTarget = clamp01(0.9 - 0.15 * Math.min(6, p.relationships.length));
  p.needs.belonging = clamp01(p.needs.belonging + BELONGING_ADAPT_RATE * (belongingTarget - p.needs.belonging));

  const esteemTarget = clamp01(0.9 - p.influence);
  p.needs.esteem = clamp01(p.needs.esteem + ESTEEM_ADAPT_RATE * (esteemTarget - p.needs.esteem));
}

/**
 * Contract signature verbatim: hunger above 0.85 drains health by
 * HUNGER_HEALTH_DRAIN per call, clamped at 0. Eating (reducing hunger,
 * consuming inventory/stock food) is handled entirely in execute.ts.
 */
export function applyHungerHealth(p: Person): void {
  if (p.needs.hunger > HUNGER_HEALTH_THRESHOLD) {
    p.health = Math.max(0, p.health - HUNGER_HEALTH_DRAIN);
  }
}
