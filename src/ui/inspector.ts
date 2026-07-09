import { el } from './dom';
import { radarChart } from './charts';
import { LINEAGE_COLORS } from './map';
import type { PersonDetail } from '../shared/protocol';
import { SKILL_NAMES } from '../shared/types';
import type { Emotions } from '../shared/types';

export interface InspectorHandle {
  root: HTMLElement;
  show(detail: PersonDetail | null): void;
}

/** Task 45 fix: Follow now hands back the full detail (not just personId) so callers can read `.person.pos` to center the map. */
export type OnFollow = (detail: PersonDetail) => void;

const EMOTION_ORDER: (keyof Emotions)[] = ['fear', 'joy', 'grief', 'anger', 'hope'];
const MORALITY_AXES = ['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty'] as const;
const YEAR_TICKS_LOCAL = 360;

function affinityColor(affinity: number): string {
  if (affinity > 0) return '#76b041';
  if (affinity < 0) return '#e4572e';
  return 'var(--color-text-dim)';
}

export function renderInspector(container: HTMLElement, opts: { onFollow: OnFollow }): InspectorHandle {
  const root = el('div', { class: 'inspector' });
  container.innerHTML = '';
  container.appendChild(root);

  function renderEmpty(): void {
    root.innerHTML = '';
    root.appendChild(el('p', { 'data-testid': 'inspector-empty' }, 'Click a person on the map to inspect them.'));
  }

  function renderDetail(detail: PersonDetail): void {
    root.innerHTML = '';
    const { person, memoriesText, relationshipsNamed, temperament, settlementName, civName } = detail;

    const header = el(
      'div',
      { class: 'inspector-header' },
      el('h3', {}, person.name),
      el('span', { class: `badge-lineage ${person.lineage}`, 'data-testid': 'lineage-badge' }, person.lineage),
    );

    const meta = el(
      'p',
      { class: 'inspector-meta' },
      `${civName}${settlementName !== null ? ` — ${settlementName}` : ''}`,
    );

    const gaugeRows = EMOTION_ORDER.map((key) => {
      const pct = Math.round(Math.max(0, Math.min(1, person.emotions[key])) * 100);
      return el(
        'div',
        { class: 'gauge-row' },
        el('span', { class: 'gauge-label' }, key),
        el(
          'div',
          { class: 'gauge-track' },
          el('div', { class: `gauge-fill ${key}`, style: `width:${pct}%` }),
        ),
      );
    });
    const gaugesPanel = el('div', { class: 'panel' }, el('h4', { class: 'panel-title' }, 'Emotions'), ...gaugeRows);

    const skillRows = SKILL_NAMES.map((name) => {
      const pct = Math.round(Math.max(0, Math.min(1, person.skills[name])) * 100);
      return el(
        'div',
        { class: 'gauge-row', 'data-testid': 'skill-bar' },
        el('span', { class: 'gauge-label' }, name),
        el(
          'div',
          { class: 'gauge-track' },
          el('div', { class: `gauge-fill ${name}`, style: `width:${pct}%` }),
        ),
      );
    });
    const skillsPanel = el(
      'div',
      { class: 'panel', 'data-testid': 'skills-panel' },
      el('h4', { class: 'panel-title' }, 'Skills'),
      ...skillRows,
    );

    const radarCanvas = el('canvas', {
      width: '200',
      height: '200',
      'data-testid': 'morality-radar',
    }) as HTMLCanvasElement;
    const moralityValues = MORALITY_AXES.map((axis) => person.morality[axis]);
    radarChart(radarCanvas, [...MORALITY_AXES], moralityValues, LINEAGE_COLORS[person.lineage]);
    const radarPanel = el('div', { class: 'panel' }, el('h4', { class: 'panel-title' }, 'Morality'), radarCanvas);

    const memoryItems = person.memory.map((m, i) => {
      const year = Math.floor(m.tick / YEAR_TICKS_LOCAL);
      const text = memoriesText[i] ?? '';
      return el('li', {}, `Year ${year}: ${text}`);
    });
    const memoryPanel = el(
      'div',
      { class: 'panel' },
      el('h4', { class: 'panel-title' }, 'Memories'),
      el('ul', { 'data-testid': 'memory-list' }, ...memoryItems),
    );

    const relationshipItems = relationshipsNamed.map((r) =>
      el(
        'li',
        {},
        el('span', {}, `${r.name} (${r.kind}) `),
        el('span', { style: `color:${affinityColor(r.affinity)}` }, r.affinity.toFixed(2)),
      ),
    );
    const relationshipsPanel = el(
      'div',
      { class: 'panel' },
      el('h4', { class: 'panel-title' }, 'Relationships'),
      el('ul', { 'data-testid': 'relationships-list' }, ...relationshipItems),
    );

    const temperamentPanel = el(
      'div',
      { class: 'panel' },
      el('h4', { class: 'panel-title' }, 'Temperament'),
      el('p', {}, temperament.description),
      el('p', {}, `Quirks: ${temperament.quirks.join(', ')}`),
    );

    const followButton = el('button', { class: 'btn', type: 'button', 'data-testid': 'follow-button' }, 'Follow');
    followButton.addEventListener('click', () => opts.onFollow(detail));

    root.appendChild(header);
    root.appendChild(meta);
    root.appendChild(followButton);
    root.appendChild(gaugesPanel);
    root.appendChild(skillsPanel);
    root.appendChild(radarPanel);
    root.appendChild(memoryPanel);
    root.appendChild(relationshipsPanel);
    root.appendChild(temperamentPanel);
  }

  renderEmpty();

  return {
    root,
    show(detail: PersonDetail | null): void {
      if (detail === null) renderEmpty();
      else renderDetail(detail);
    },
  };
}
