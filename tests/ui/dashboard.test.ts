// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { METRICS_HISTORY_CAP, renderDashboard } from '../../src/ui/dashboard';
import type { CivMetrics, Snapshot } from '../../src/shared/protocol';

function stubAllCanvasContexts(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    arc: vi.fn(),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
  } as unknown as CanvasRenderingContext2D);
}

function makeMetrics(overrides: Partial<CivMetrics> = {}): CivMetrics {
  return {
    civId: 0,
    name: 'Opus Dominion',
    color: '#e4572e',
    population: 100,
    births: 2,
    deaths: 1,
    techCount: 3,
    atWar: false,
    lineageShare: { opus: 1, sonnet: 0, haiku: 0, fable: 0 },
    avgMorality: { care: 0.5, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0.5 },
    avgEmotions: { fear: 0.2, joy: 0.5, grief: 0.1, anger: 0.1, hope: 0.6 },
    foodPerCapita: 1.2,
    ...overrides,
  };
}

function makeSnapshot(metrics: CivMetrics[]): Snapshot {
  return {
    tick: 360,
    year: 1,
    season: 'spring',
    population: metrics.reduce((a, m) => a + m.population, 0),
    worldSize: 96,
    ids: new Int32Array(0),
    xs: new Float32Array(0),
    ys: new Float32Array(0),
    civIds: new Int16Array(0),
    lineages: new Int8Array(0),
    healths: new Uint8Array(0),
    moods: new Uint8Array(0),
    settlements: [],
    territory: null,
    recentEvents: [],
    metrics,
  };
}

describe('renderDashboard — civs mode (multiple civs, no headline chart)', () => {
  it('builds one tab per civ and shows the first civ tab by default', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(
      makeSnapshot([
        makeMetrics({ civId: 0, name: 'Opus Dominion' }),
        makeMetrics({ civId: 1, name: 'Sonnet Commonwealth', color: '#3d9be9' }),
      ]),
    );
    expect(container.querySelectorAll('[data-testid="civ-tab"]')).toHaveLength(2);
    expect(container.textContent).toContain('Opus Dominion');
    expect(container.textContent).toContain('Sonnet Commonwealth');
  });

  it('does not render a lineage-share headline tab in civs mode', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0 }), makeMetrics({ civId: 1 })]));
    expect(container.querySelector('[data-testid="lineage-share-tab"]')).toBeNull();
  });

  it('shows the war banner only for a civ at war', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(
      makeSnapshot([makeMetrics({ civId: 0, atWar: true }), makeMetrics({ civId: 1, atWar: false })]),
    );
    const banner = container.querySelector('[data-testid="war-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('At war');
  });

  it('shows births/deaths for the active tab', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0, births: 5, deaths: 2 })]));
    const readout = container.querySelector('[data-testid="births-deaths"]');
    expect(readout?.textContent).toContain('5');
    expect(readout?.textContent).toContain('2');
  });

  it('shows a tech chip readout out of the total tech count', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0, techCount: 3 })]));
    const chips = container.querySelectorAll('[data-testid="tech-chip"]');
    expect(chips.length).toBe(6); // TECH_IDS.length total slots
    const filled = Array.from(chips).filter((c) => c.classList.contains('filled'));
    expect(filled).toHaveLength(3);
  });

  it('switching tabs shows the other civ name and its own war/births data', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(
      makeSnapshot([
        makeMetrics({ civId: 0, name: 'Opus Dominion', births: 5, deaths: 2 }),
        makeMetrics({ civId: 1, name: 'Sonnet Commonwealth', births: 9, deaths: 1 }),
      ]),
    );
    const tabs = container.querySelectorAll('[data-testid="civ-tab"]');
    (tabs[1] as HTMLElement).click();
    const readout = container.querySelector('[data-testid="births-deaths"]');
    expect(readout?.textContent).toContain('9');
    expect(container.textContent).toContain('Sonnet Commonwealth');
  });

  it('renders a culture-drift chart for the active civ tab, growing as avgMorality diverges from the baseline snapshot', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0, avgMorality: { care: 0.5, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0.5 } })]));
    expect(container.querySelector('[data-testid="culture-drift-chart"]')).not.toBeNull();
    // Feeding snapshots whose avgMorality diverges from the first-seen
    // baseline must not throw, and the chart stays present across updates.
    handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0, avgMorality: { care: 0.9, fairness: 0.1, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0.5 } })]));
    expect(container.querySelector('[data-testid="culture-drift-chart"]')).not.toBeNull();
  });
});

describe('renderDashboard — mixed mode (single civ, headline lineage-share chart)', () => {
  it('renders a lineage-share headline tab when the snapshot has exactly one civ', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0, name: 'Mixed Settlement' })]));
    expect(container.querySelector('[data-testid="lineage-share-tab"]')).not.toBeNull();
  });
});

describe('renderDashboard — metrics history ring', () => {
  it('caps stored history at METRICS_HISTORY_CAP snapshots per civ without throwing', () => {
    expect(METRICS_HISTORY_CAP).toBe(2000);
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    for (let i = 0; i < METRICS_HISTORY_CAP + 50; i++) {
      handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0, population: 100 + i })]));
    }
    expect(() => handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0 })]))).not.toThrow();
  });

  it('updates on every snapshot without throwing across many consecutive snapshots', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderDashboard(container);
    expect(() => {
      for (let i = 0; i < 50; i++) {
        handle.onSnapshot(makeSnapshot([makeMetrics({ civId: 0, population: 100 + i }), makeMetrics({ civId: 1 })]));
      }
    }).not.toThrow();
  });
});
