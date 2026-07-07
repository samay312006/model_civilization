import { describe, expect, it } from 'vitest';
import {
  EVENT_LOG_CAP,
  narrateBirth,
  narrateDeath,
  narrateDisaster,
  narrateExtinction,
  narrateFamine,
  narrateLeaderEmerged,
  narratePeace,
  narrateRaid,
  narrateReligionFounded,
  narrateSchism,
  narrateSettlementDissolved,
  narrateSettlementFounded,
  narrateTechLost,
  narrateTechUnlocked,
  narrateWarDeclared,
  pushEvent,
  type NarrativeEvent,
} from '../../../src/engine/sim/events';

interface Log {
  events: NarrativeEvent[];
  tick: number;
}

function makeLog(tick = 0): Log {
  return { events: [], tick };
}

describe('pushEvent', () => {
  it('appends an event with the given fields and the log tick', () => {
    const log = makeLog(42);
    pushEvent(log, 'birth', 1, 3, 'A child is born.');
    expect(log.events).toHaveLength(1);
    expect(log.events[0]).toEqual({ tick: 42, kind: 'birth', severity: 1, civId: 3, text: 'A child is born.' });
  });

  it('accepts a null civId for civ-agnostic events', () => {
    const log = makeLog(1);
    pushEvent(log, 'extinction', 3, null, narrateExtinction());
    expect(log.events[0]?.civId).toBeNull();
  });

  it('caps the ring buffer at EVENT_LOG_CAP, dropping the oldest first', () => {
    expect(EVENT_LOG_CAP).toBe(500);
    const log = makeLog(0);
    for (let i = 0; i < 520; i++) {
      log.tick = i;
      pushEvent(log, 'birth', 1, 0, `event ${i}`);
    }
    expect(log.events).toHaveLength(500);
    expect(log.events[0]?.text).toBe('event 20'); // the first 20 were dropped
    expect(log.events[log.events.length - 1]?.text).toBe('event 519');
  });
});

describe('narration templates contain the names passed in', () => {
  it('narrateBirth', () => {
    const text = narrateBirth('Mira', 'Alda', 'Boren');
    expect(text).toContain('Mira');
    expect(text).toContain('Alda');
    expect(text).toContain('Boren');
  });

  it('narrateDeath', () => {
    const text = narrateDeath('Corin', 'starvation');
    expect(text).toContain('Corin');
    expect(text).toContain('starvation');
  });

  it('narrateSettlementFounded', () => {
    const text = narrateSettlementFounded('Rivermeet', 'Opus Dominion');
    expect(text).toContain('Rivermeet');
    expect(text).toContain('Opus Dominion');
  });

  it('narrateSettlementDissolved', () => {
    const text = narrateSettlementDissolved('Rivermeet');
    expect(text).toContain('Rivermeet');
  });

  it('narrateLeaderEmerged', () => {
    const text = narrateLeaderEmerged('Talia', 'Rivermeet');
    expect(text).toContain('Talia');
    expect(text).toContain('Rivermeet');
  });

  it('narrateTechUnlocked', () => {
    const text = narrateTechUnlocked('agriculture', 'Sonnet Commonwealth');
    expect(text).toContain('agriculture');
    expect(text).toContain('Sonnet Commonwealth');
  });

  it('narrateTechLost', () => {
    const text = narrateTechLost('writing', 'Haiku Enclave');
    expect(text).toContain('writing');
    expect(text).toContain('Haiku Enclave');
  });

  it('narrateReligionFounded', () => {
    const text = narrateReligionFounded('The Ember Path', 'Sera', 'Fable Wandering');
    expect(text).toContain('The Ember Path');
    expect(text).toContain('Sera');
    expect(text).toContain('Fable Wandering');
  });

  it('narrateRaid (attacker won)', () => {
    const text = narrateRaid('Opus Dominion', 'Rivermeet', true);
    expect(text).toContain('Opus Dominion');
    expect(text).toContain('Rivermeet');
  });

  it('narrateRaid (attacker lost)', () => {
    const text = narrateRaid('Opus Dominion', 'Rivermeet', false);
    expect(text).toContain('Opus Dominion');
    expect(text).toContain('Rivermeet');
  });

  it('narrateWarDeclared', () => {
    const text = narrateWarDeclared('Opus Dominion', 'Haiku Enclave');
    expect(text).toContain('Opus Dominion');
    expect(text).toContain('Haiku Enclave');
  });

  it('narratePeace', () => {
    const text = narratePeace('Opus Dominion', 'Haiku Enclave');
    expect(text).toContain('Opus Dominion');
    expect(text).toContain('Haiku Enclave');
  });

  it('narrateSchism', () => {
    const text = narrateSchism('Rivermeet', 'Rivermeet Free State', 'Opus Dominion');
    expect(text).toContain('Rivermeet');
    expect(text).toContain('Rivermeet Free State');
    expect(text).toContain('Opus Dominion');
  });

  it('narrateFamine', () => {
    const text = narrateFamine('Rivermeet');
    expect(text).toContain('Rivermeet');
  });

  it('narrateDisaster', () => {
    const text = narrateDisaster('drought', 'the river valley');
    expect(text).toContain('the river valley');
  });

  it('narrateExtinction contains no interpolated name (civ-agnostic) but is non-empty', () => {
    const text = narrateExtinction();
    expect(text.length).toBeGreaterThan(0);
  });
});
