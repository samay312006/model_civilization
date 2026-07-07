import { el } from './dom';
import type { NarrativeEvent } from '../engine/sim/events';

export const FEED_ROW_CAP = 200;

export interface FeedHandle {
  root: HTMLElement;
  push(events: NarrativeEvent[], civNames: Map<number, string>): void;
}

const YEAR_TICKS_LOCAL = 360;

function rowText(e: NarrativeEvent, civNames: Map<number, string>): string {
  const year = Math.floor(e.tick / YEAR_TICKS_LOCAL);
  if (e.civId === null) return `Year ${year}: ${e.text}`;
  const name = civNames.get(e.civId) ?? 'Unknown';
  return `Year ${year} [${name}]: ${e.text}`;
}

export function renderFeed(container: HTMLElement): FeedHandle {
  container.innerHTML = '';

  let rowsNewestFirst: NarrativeEvent[] = [];
  let rowPool: HTMLElement[] = [];
  let currentFilter: string = 'all';
  let lastCivNames: Map<number, string> = new Map();

  const filterSelect = el('select', { class: 'btn', 'data-testid': 'feed-civ-filter' }) as HTMLSelectElement;
  filterSelect.addEventListener('change', () => {
    currentFilter = filterSelect.value;
    applyFilter();
  });

  const rowsContainer = el('div', { class: 'feed-rows' });
  const root = el('div', { class: 'feed' }, filterSelect, rowsContainer);
  container.appendChild(root);

  function rebuildFilterOptions(civNames: Map<number, string>): void {
    const previousValue = filterSelect.value || 'all';
    filterSelect.innerHTML = '';
    filterSelect.appendChild(el('option', { value: 'all' }, 'All civilizations'));
    for (const [civId, name] of civNames) {
      filterSelect.appendChild(el('option', { value: String(civId) }, name));
    }
    filterSelect.value = previousValue;
    currentFilter = filterSelect.value || 'all';
  }

  function applyFilter(): void {
    for (let i = 0; i < rowsNewestFirst.length; i++) {
      const rowEl = rowPool[i];
      if (rowEl === undefined) continue;
      const e = rowsNewestFirst[i] as NarrativeEvent;
      const matches = currentFilter === 'all' || (e.civId !== null && String(e.civId) === currentFilter);
      rowEl.style.display = matches ? '' : 'none';
    }
  }

  function renderRow(rowEl: HTMLElement, e: NarrativeEvent, civNames: Map<number, string>): void {
    rowEl.className = `feed-row severity-${e.severity}`;
    rowEl.textContent = rowText(e, civNames);
  }

  return {
    root,
    push(events: NarrativeEvent[], civNames: Map<number, string>): void {
      lastCivNames = civNames;
      rebuildFilterOptions(civNames);

      // Newest-first: new events are prepended in the order given (already
      // tick-ascending), so reverse them before prepending to keep the
      // overall newest-first invariant.
      const toPrepend = [...events].reverse();
      rowsNewestFirst = [...toPrepend, ...rowsNewestFirst].slice(0, FEED_ROW_CAP);

      // Recycle the DOM pool: grow it to match, reusing existing nodes for
      // the overlap, removing any pool nodes beyond the new capped length.
      while (rowPool.length < rowsNewestFirst.length) {
        const rowEl = el('div', { class: 'feed-row' });
        rowsContainer.insertBefore(rowEl, rowsContainer.firstChild);
        rowPool.unshift(rowEl);
      }
      while (rowPool.length > rowsNewestFirst.length) {
        const removed = rowPool.pop();
        removed?.remove();
      }

      for (let i = 0; i < rowsNewestFirst.length; i++) {
        const rowEl = rowPool[i];
        const e = rowsNewestFirst[i];
        if (rowEl === undefined || e === undefined) continue;
        renderRow(rowEl, e, lastCivNames);
      }

      applyFilter();
    },
  };
}
