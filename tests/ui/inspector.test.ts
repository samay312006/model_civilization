// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderInspector } from '../../src/ui/inspector';
import type { PersonDetail } from '../../src/shared/protocol';
import type { Person } from '../../src/shared/types';

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

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 7,
    alive: true,
    ageTicks: 7200,
    sex: 'f',
    name: 'Mira',
    pos: { x: 10, y: 10 },
    civId: 0,
    settlementId: null,
    lineage: 'fable',
    traits: { curiosity: 0.5, aggression: 0.2, empathy: 0.7, industriousness: 0.6, riskTolerance: 0.3 },
    emotions: { fear: 0.2, joy: 0.6, grief: 0.1, anger: 0.05, hope: 0.7 },
    morality: { care: 0.8, fairness: 0.5, loyalty: 0.4, authority: 0.2, sanctity: 0.3, liberty: 0.6 },
    needs: { hunger: 0.3, safety: 0.2, rest: 0.4, belonging: 0.5, esteem: 0.5 },
    skills: { farming: 0.2, gathering: 0.5, building: 0.1, crafting: 0, fighting: 0.1, healing: 0, teaching: 0.1 },
    health: 0.9,
    lifespanTicks: 25200,
    memory: [{ tick: 720, kind: 'helped', otherId: 8, valence: 0.5, salience: 0.8 }],
    relationships: [{ otherId: 8, kind: 'friend', affinity: 0.6 }],
    inventory: { food: 2, wood: 0, stone: 0, metal: 0, tools: 0 },
    actionWeights: {
      gather: 1, farm: 1, hunt: 1, build: 1, craft: 1, rest: 1, socialize: 1, court: 1, teach: 1,
      trade: 1, share: 1, steal: 1, attack: 1, flee: 1, migrate: 1, worship: 1, explore: 1, heal: 1,
    },
    brainState: {},
    influence: 0.2,
    beliefIds: [],
    partnerId: null,
    pregnantUntil: null,
    parentIds: null,
    causeOfDeath: null,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<PersonDetail> = {}): PersonDetail {
  return {
    person: makePerson(),
    memoriesText: ['helped involving Boren (tick 720)'],
    relationshipsNamed: [{ name: 'Boren', kind: 'friend', affinity: 0.6 }],
    temperament: {
      emotionVolatility: { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 },
      emotionDecayPerTick: { fear: 0.01, joy: 0.01, grief: 0.01, anger: 0.01, hope: 0.01 },
      moralWeight: 1,
      learningRate: 0.1,
      imitationRate: 0.05,
      desperationThreshold: 0.9,
      taboos: ['steal'],
      quirks: ['tells long stories', 'names every tool'],
      description: 'A wandering philosophy of improvisation and empathy.',
    },
    settlementName: 'Rivermeet',
    civName: 'Fable Wandering',
    ...overrides,
  };
}

describe('renderInspector — empty state', () => {
  it('shows the empty-state message when detail is null', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(null);
    expect(container.querySelector('[data-testid="inspector-empty"]')?.textContent).toContain(
      'Click a person on the map to inspect them.',
    );
  });

  it('clears a previous person render when passed null afterward', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail());
    handle.show(null);
    expect(container.querySelector('[data-testid="lineage-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="inspector-empty"]')).not.toBeNull();
  });
});

describe('renderInspector — populated state', () => {
  it('renders emotion gauge bars for all five emotions', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail());
    for (const emotion of ['fear', 'joy', 'grief', 'anger', 'hope']) {
      expect(container.querySelector(`.gauge-fill.${emotion}`)).not.toBeNull();
    }
  });

  it('renders the morality radar chart canvas', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail());
    expect(container.querySelector('[data-testid="morality-radar"]')).not.toBeNull();
  });

  it('renders a skill bar for every SKILL_NAMES entry with the person\'s skill values', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(
      makeDetail({
        person: makePerson({
          skills: { farming: 0.2, gathering: 0.5, building: 0.1, crafting: 0, fighting: 0.9, healing: 0, teaching: 0.1 },
        }),
      }),
    );
    const panel = container.querySelector('[data-testid="skills-panel"]');
    expect(panel).not.toBeNull();
    const bars = container.querySelectorAll('[data-testid="skill-bar"]');
    expect(bars).toHaveLength(7); // SKILL_NAMES.length
    expect(panel?.textContent).toContain('farming');
    expect(panel?.textContent).toContain('fighting');
    const fightingFill = container.querySelector('[data-testid="skill-bar"] .gauge-fill.fighting') as HTMLElement;
    expect(fightingFill?.getAttribute('style')).toContain('width:90%');
  });

  it('renders the memory list newest-first (unmodified order from PersonDetail)', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(
      makeDetail({
        memoriesText: ['newest event', 'older event'],
        person: makePerson({
          memory: [
            { tick: 900, kind: 'helped', otherId: 8, valence: 0.5, salience: 0.8 },
            { tick: 100, kind: 'shared', otherId: 9, valence: 0.3, salience: 0.5 },
          ],
        }),
      }),
    );
    const items = container.querySelectorAll('[data-testid="memory-list"] li');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('newest event');
    expect(items[0]?.textContent).toContain('Year 2'); // floor(900/360)
    expect(items[1]?.textContent).toContain('older event');
    expect(items[1]?.textContent).toContain('Year 0'); // floor(100/360)
  });

  it('renders relationships with names and affinity-colored text', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail());
    const item = container.querySelector('[data-testid="relationships-list"] li');
    expect(item?.textContent).toContain('Boren');
    expect(item?.textContent).toContain('friend');
  });

  it('renders the lineage badge with the correct lineage class and quirks/description', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail());
    const badge = container.querySelector('[data-testid="lineage-badge"]');
    expect(badge?.className).toContain('badge-lineage');
    expect(badge?.className).toContain('fable');
    expect(container.textContent).toContain('tells long stories');
    expect(container.textContent).toContain('A wandering philosophy of improvisation and empathy.');
  });

  it('renders an empty memory list gracefully (no memories yet)', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail({ memoriesText: [], person: makePerson({ memory: [] }) }));
    expect(container.querySelectorAll('[data-testid="memory-list"] li')).toHaveLength(0);
  });

  it('renders an empty relationships list gracefully', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderInspector(container, { onFollow: () => {} });
    handle.show(makeDetail({ relationshipsNamed: [] }));
    expect(container.querySelectorAll('[data-testid="relationships-list"] li')).toHaveLength(0);
  });

  it('clicking Follow calls onFollow with the person id', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const onFollow = vi.fn();
    const handle = renderInspector(container, { onFollow });
    handle.show(makeDetail());
    (container.querySelector('[data-testid="follow-button"]') as HTMLButtonElement).click();
    expect(onFollow).toHaveBeenCalledWith(7);
  });
});
