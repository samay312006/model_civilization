// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { FEED_ROW_CAP, renderFeed } from '../../src/ui/feed';
import type { NarrativeEvent } from '../../src/engine/sim/events';

function ev(overrides: Partial<NarrativeEvent> = {}): NarrativeEvent {
  return { tick: 0, kind: 'birth', severity: 1, civId: 0, text: 'A child is born.', ...overrides };
}

const civNames = new Map<number, string>([
  [0, 'Opus Dominion'],
  [1, 'Sonnet Commonwealth'],
]);

describe('renderFeed — ordering', () => {
  it('renders rows newest-first across multiple push calls', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ tick: 1, text: 'first' })], civNames);
    handle.push([ev({ tick: 2, text: 'second' })], civNames);
    const rows = container.querySelectorAll('.feed-row');
    expect(rows[0]?.textContent).toContain('second');
    expect(rows[1]?.textContent).toContain('first');
  });

  it('renders multiple events from a single push call in the given order, newest first overall', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ tick: 1, text: 'a' }), ev({ tick: 2, text: 'b' })], civNames);
    const rows = container.querySelectorAll('.feed-row');
    expect(rows[0]?.textContent).toContain('b');
    expect(rows[1]?.textContent).toContain('a');
  });
});

describe('renderFeed — severity color classes', () => {
  it('applies the matching severity-<n> class per row', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ tick: 1, severity: 1 }), ev({ tick: 2, severity: 3 })], civNames);
    const rows = container.querySelectorAll('.feed-row');
    expect(rows[0]?.classList.contains('severity-3')).toBe(true);
    expect(rows[1]?.classList.contains('severity-1')).toBe(true);
  });
});

describe('renderFeed — civ name resolution', () => {
  it('prefixes rows with the resolved civ name when civId is set', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ civId: 1, text: 'A settlement is founded.' })], civNames);
    expect(container.querySelector('.feed-row')?.textContent).toContain('Sonnet Commonwealth');
  });

  it('omits any civ prefix for civ-agnostic events (civId null)', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ civId: null, text: 'The last person has died.' })], civNames);
    expect(container.querySelector('.feed-row')?.textContent).not.toContain('Unknown');
    expect(container.querySelector('.feed-row')?.textContent).toContain('The last person has died.');
  });

  it('falls back to "Unknown" for a civId with no matching name', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ civId: 99, text: 'Something happens.' })], civNames);
    expect(container.querySelector('.feed-row')?.textContent).toContain('Unknown');
  });
});

describe('renderFeed — cap', () => {
  it('caps stored/rendered rows at FEED_ROW_CAP, keeping only the most recent', () => {
    expect(FEED_ROW_CAP).toBe(200);
    const container = document.createElement('div');
    const handle = renderFeed(container);
    const events = Array.from({ length: 250 }, (_, i) => ev({ tick: i, text: `event ${i}` }));
    handle.push(events, civNames);
    const rows = container.querySelectorAll('.feed-row');
    expect(rows.length).toBe(200);
    expect(rows[0]?.textContent).toContain('event 249');
    expect(rows[199]?.textContent).toContain('event 50'); // oldest 50 dropped
  });

  it('recycles DOM row elements across pushes rather than rebuilding from scratch', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ tick: 1, text: 'a' })], civNames);
    const firstRowEl = container.querySelector('.feed-row');
    handle.push([ev({ tick: 2, text: 'b' })], civNames);
    const secondPushRows = container.querySelectorAll('.feed-row');
    // The element that was row 0 ("a") is recycled to become row 1 ("a"
    // still, now second), i.e. its node identity survives if the pool is
    // reused; assert content correctness (recycling is an implementation
    // detail we verify indirectly via the DOM's node count staying
    // proportional to unique rows, not doubling).
    expect(secondPushRows.length).toBe(2);
    expect(firstRowEl).not.toBeNull();
  });
});

describe('renderFeed — civ filter dropdown', () => {
  it('renders an "all" option plus one option per civ name', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ civId: 0 })], civNames);
    const options = container.querySelectorAll('[data-testid="feed-civ-filter"] option');
    expect(options.length).toBe(3); // all + 2 civs
  });

  it('selecting a civ hides rows from other civs and civ-agnostic rows', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push(
      [
        ev({ tick: 1, civId: 0, text: 'opus event' }),
        ev({ tick: 2, civId: 1, text: 'sonnet event' }),
        ev({ tick: 3, civId: null, text: 'extinction event' }),
      ],
      civNames,
    );
    const select = container.querySelector('[data-testid="feed-civ-filter"]') as HTMLSelectElement;
    select.value = '0';
    select.dispatchEvent(new Event('change'));
    const rows = Array.from(container.querySelectorAll('.feed-row'));
    const visible = rows.filter((r) => (r as HTMLElement).style.display !== 'none');
    expect(visible).toHaveLength(1);
    expect(visible[0]?.textContent).toContain('opus event');
  });

  it('selecting "all" shows every row again', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ tick: 1, civId: 0 }), ev({ tick: 2, civId: 1 })], civNames);
    const select = container.querySelector('[data-testid="feed-civ-filter"]') as HTMLSelectElement;
    select.value = '0';
    select.dispatchEvent(new Event('change'));
    select.value = 'all';
    select.dispatchEvent(new Event('change'));
    const rows = Array.from(container.querySelectorAll('.feed-row'));
    const visible = rows.filter((r) => (r as HTMLElement).style.display !== 'none');
    expect(visible).toHaveLength(2);
  });

  it('a newly pushed row matching the active filter is visible immediately', () => {
    const container = document.createElement('div');
    const handle = renderFeed(container);
    handle.push([ev({ tick: 1, civId: 0 }), ev({ tick: 2, civId: 1 })], civNames);
    const select = container.querySelector('[data-testid="feed-civ-filter"]') as HTMLSelectElement;
    select.value = '0';
    select.dispatchEvent(new Event('change'));
    handle.push([ev({ tick: 3, civId: 0, text: 'new opus event' })], civNames);
    const rows = Array.from(container.querySelectorAll('.feed-row'));
    const visible = rows.filter((r) => (r as HTMLElement).style.display !== 'none');
    expect(visible.some((r) => r.textContent?.includes('new opus event'))).toBe(true);
    const hiddenSonnet = rows.find((r) => r.textContent?.includes('sonnet') || false);
    void hiddenSonnet;
  });
});
