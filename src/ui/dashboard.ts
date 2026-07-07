import { el } from './dom';
import { lineChart, stackedAreaChart } from './charts';
import { civColor } from './map';
import { LINEAGES, TECH_IDS, type Emotions, type Lineage, type Morality } from '../shared/types';
import type { CivMetrics, Snapshot } from '../shared/protocol';

export const METRICS_HISTORY_CAP = 2000;

const MORALITY_AXES: (keyof Morality)[] = ['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty'];

/**
 * UI-local, contract-faithful stand-in for the contract's cultureDistance
 * (culture.ts, Task 28), which takes an EngineCtx that never crosses the
 * worker boundary and therefore cannot be called from dashboard.ts. Mean
 * absolute difference across the six Morality axes, clamped to [0, 1] —
 * restricted to the Morality half of CultureVector, which is all a
 * Snapshot's CivMetrics.avgMorality carries.
 */
export function moralityDistance(a: Morality, b: Morality): number {
  let sum = 0;
  for (const axis of MORALITY_AXES) sum += Math.abs(a[axis] - b[axis]);
  return Math.max(0, Math.min(1, sum / MORALITY_AXES.length));
}

export interface DashboardHandle {
  root: HTMLElement;
  onSnapshot(snapshot: Snapshot): void;
}

const EMOTION_KEYS: (keyof Emotions)[] = ['fear', 'joy', 'grief', 'anger', 'hope'];
const EMOTION_COLORS: Record<keyof Emotions, string> = {
  fear: '#e4572e',
  joy: '#76b041',
  grief: '#3d9be9',
  anger: '#e4572e',
  hope: '#d4a24e',
};
const LINEAGE_CHART_COLORS: Record<Lineage, string> = {
  opus: '#d4a24e',
  sonnet: '#3d9be9',
  haiku: '#76b041',
  fable: '#b76ce9',
};

export function renderDashboard(container: HTMLElement): DashboardHandle {
  container.innerHTML = '';

  const history = new Map<number, CivMetrics[]>();
  let civOrder: number[] = [];
  let isMixedMode: boolean | null = null;
  let activeTabCivId: number | 'lineage-share' | null = null;

  const root = el('div', { class: 'dashboard' });
  container.appendChild(root);

  function pushHistory(metrics: CivMetrics[]): void {
    for (const m of metrics) {
      const list = history.get(m.civId) ?? [];
      list.push(m);
      if (list.length > METRICS_HISTORY_CAP) list.splice(0, list.length - METRICS_HISTORY_CAP);
      history.set(m.civId, list);
    }
  }

  function latestFor(civId: number): CivMetrics | undefined {
    const list = history.get(civId);
    return list !== undefined ? list[list.length - 1] : undefined;
  }

  function renderTechChips(techCount: number): HTMLElement {
    const chips = TECH_IDS.map((_, i) =>
      el('span', { class: `tech-chip${i < techCount ? ' filled' : ''}`, 'data-testid': 'tech-chip' }, ''),
    );
    return el(
      'div',
      { class: 'panel' },
      el('h4', { class: 'panel-title' }, `Technologies (${techCount} / ${TECH_IDS.length})`),
      el('div', { class: 'tech-chips' }, ...chips),
    );
  }

  function renderCivTab(civId: number): HTMLElement {
    const metricsHistory = history.get(civId) ?? [];
    const current = metricsHistory[metricsHistory.length - 1];
    if (current === undefined) return el('div', {}, 'No data yet.');

    const popCanvas = el('canvas', { width: '320', height: '120' }) as HTMLCanvasElement;
    lineChart(popCanvas, [{ label: current.name, color: current.color, points: metricsHistory.map((m) => m.population) }]);

    const emotionCanvas = el('canvas', { width: '320', height: '120' }) as HTMLCanvasElement;
    lineChart(
      emotionCanvas,
      EMOTION_KEYS.map((key) => ({
        label: key,
        color: EMOTION_COLORS[key],
        points: metricsHistory.map((m) => m.avgEmotions[key]),
      })),
      { yMax: 1 },
    );

    const baseline = metricsHistory[0]?.avgMorality;
    const cultureDriftCanvas = el('canvas', { width: '320', height: '120', 'data-testid': 'culture-drift-chart' }) as HTMLCanvasElement;
    lineChart(
      cultureDriftCanvas,
      [
        {
          label: 'Culture drift',
          color: current.color,
          points: baseline === undefined ? [] : metricsHistory.map((m) => moralityDistance(baseline, m.avgMorality)),
        },
      ],
      { yMax: 1 },
    );

    const warBanner = current.atWar
      ? el('div', { class: 'panel', 'data-testid': 'war-banner' }, 'At war')
      : el('div', {});

    return el(
      'div',
      { class: 'civ-tab-content' },
      el('h3', {}, current.name),
      warBanner,
      el(
        'div',
        { class: 'panel', 'data-testid': 'births-deaths' },
        `Births: ${current.births}  Deaths: ${current.deaths}`,
      ),
      renderTechChips(current.techCount),
      el('div', { class: 'panel' }, el('h4', { class: 'panel-title' }, 'Population'), popCanvas),
      el('div', { class: 'panel' }, el('h4', { class: 'panel-title' }, 'Average Emotions'), emotionCanvas),
      el('div', { class: 'panel' }, el('h4', { class: 'panel-title' }, 'Culture Drift'), cultureDriftCanvas),
    );
  }

  function renderLineageShareTab(civId: number): HTMLElement {
    const metricsHistory = history.get(civId) ?? [];
    const canvas = el('canvas', { width: '320', height: '160' }) as HTMLCanvasElement;
    stackedAreaChart(
      canvas,
      LINEAGES.map((lineage) => ({
        label: lineage,
        color: LINEAGE_CHART_COLORS[lineage],
        points: metricsHistory.map((m) => m.lineageShare[lineage]),
      })),
    );
    return el(
      'div',
      { class: 'civ-tab-content' },
      el('h3', {}, 'Lineage Share'),
      el('div', { class: 'panel' }, canvas),
    );
  }

  function rebuild(snapshot: Snapshot): void {
    if (isMixedMode === null) isMixedMode = snapshot.metrics.length === 1;
    civOrder = snapshot.metrics.map((m) => m.civId).sort((a, b) => a - b);
    if (activeTabCivId === null) {
      activeTabCivId = civOrder[0] ?? null;
    }

    root.innerHTML = '';
    const tabsRow = el('div', { class: 'tabs' });

    if (isMixedMode) {
      const lineageTab = el(
        'button',
        { class: `tab${activeTabCivId === 'lineage-share' ? ' active' : ''}`, type: 'button', 'data-testid': 'lineage-share-tab' },
        'Lineage Share',
      );
      lineageTab.addEventListener('click', () => {
        activeTabCivId = 'lineage-share';
        rebuild(snapshot);
      });
      tabsRow.appendChild(lineageTab);
    }

    const civTabs = civOrder.map((civId) => {
      const metrics = latestFor(civId);
      const label = metrics?.name ?? `Civ ${civId}`;
      const btn = el(
        'button',
        { class: `tab${activeTabCivId === civId ? ' active' : ''}`, type: 'button', 'data-testid': 'civ-tab' },
        label,
      );
      btn.addEventListener('click', () => {
        activeTabCivId = civId;
        rebuild(snapshot);
      });
      return btn;
    });
    for (const btn of civTabs) tabsRow.appendChild(btn);

    root.appendChild(tabsRow);

    if (activeTabCivId === 'lineage-share') {
      root.appendChild(renderLineageShareTab(civOrder[0] ?? 0));
    } else if (activeTabCivId !== null) {
      root.appendChild(renderCivTab(activeTabCivId));
    }
  }

  let lastSnapshot: Snapshot | null = null;

  return {
    root,
    onSnapshot(snapshot: Snapshot): void {
      pushHistory(snapshot.metrics);
      lastSnapshot = snapshot;
      rebuild(lastSnapshot);
    },
  };
}

// civColor is imported for future per-civ chart tinting consistency with
// map.ts's territory rendering; population line charts currently use each
// CivMetrics.color directly (already matching civColor's own output for
// the fixed-palette civs), so this import is kept for the schism-civ case
// where CivMetrics.color is expected to already carry the generated hue.
void civColor;
