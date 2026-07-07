import { el } from './dom';
import type { MapSize, SimConfig } from '../shared/types';

export interface SetupScreenHandle {
  root: HTMLElement;
  onBegin(cb: (config: SimConfig) => void): void;
}

interface ModeCardSpec {
  mode: 'civs' | 'mixed';
  testId: string;
  title: string;
  description: string;
}

const MODE_CARDS: ModeCardSpec[] = [
  {
    mode: 'civs',
    testId: 'mode-card-civs',
    title: 'Four Civilizations',
    description:
      'Four separate one-model civilizations compete and coexist: Opus, Sonnet, Haiku, and Fable each field a population whose every person shares that model-authored way of thinking.',
  },
  {
    mode: 'mixed',
    testId: 'mode-card-mixed',
    title: 'Mixed Civilization',
    description:
      'A single civilization whose population is a blend of all four brain lineages. Watch which lineage way-of-thinking spreads or dies out over the generations.',
  },
];

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export function renderSetupScreen(container: HTMLElement): SetupScreenHandle {
  container.innerHTML = '';

  let selectedMode: 'civs' | 'mixed' = 'civs';
  let selectedMapSize: MapSize = 'medium';
  let selectedPopulation: 200 | 400 | 600 = 400;
  let seedValue = randomSeed();

  const listeners: ((config: SimConfig) => void)[] = [];

  const modeCardEls = new Map<string, HTMLElement>();

  function refreshCardSelection(): void {
    for (const spec of MODE_CARDS) {
      const cardEl = modeCardEls.get(spec.mode);
      if (cardEl === undefined) continue;
      if (spec.mode === selectedMode) cardEl.classList.add('selected');
      else cardEl.classList.remove('selected');
    }
  }

  const cardsRow = el(
    'div',
    { class: 'mode-cards' },
    ...MODE_CARDS.map((spec) => {
      const card = el(
        'div',
        { class: 'panel mode-card', 'data-testid': spec.testId },
        el('h3', { class: 'panel-title' }, spec.title),
        el('p', {}, spec.description),
      );
      card.addEventListener('click', () => {
        selectedMode = spec.mode;
        refreshCardSelection();
      });
      modeCardEls.set(spec.mode, card);
      return card;
    }),
  );

  const mapSizeSelect = el(
    'select',
    { class: 'btn', 'data-testid': 'map-size-select' },
    el('option', { value: 'small' }, 'Small (96x96)'),
    el('option', { value: 'medium', selected: 'selected' }, 'Medium (144x144)'),
    el('option', { value: 'large' }, 'Large (192x192)'),
  ) as HTMLSelectElement;
  mapSizeSelect.value = selectedMapSize;
  mapSizeSelect.addEventListener('change', () => {
    selectedMapSize = mapSizeSelect.value as MapSize;
  });

  const populationSelect = el(
    'select',
    { class: 'btn', 'data-testid': 'population-select' },
    el('option', { value: '200' }, '200'),
    el('option', { value: '400', selected: 'selected' }, '400'),
    el('option', { value: '600' }, '600'),
  ) as HTMLSelectElement;
  populationSelect.value = String(selectedPopulation);
  populationSelect.addEventListener('change', () => {
    selectedPopulation = Number(populationSelect.value) as 200 | 400 | 600;
  });

  const seedInput = el('input', {
    type: 'number',
    class: 'btn',
    'data-testid': 'seed-input',
    value: String(seedValue),
  }) as HTMLInputElement;
  seedInput.addEventListener('input', () => {
    const parsed = Number(seedInput.value);
    seedValue = Number.isFinite(parsed) ? parsed : seedValue;
  });

  const randomButton = el('button', { class: 'btn', type: 'button', 'data-testid': 'random-seed-button' }, 'Random');
  randomButton.addEventListener('click', () => {
    seedValue = randomSeed();
    seedInput.value = String(seedValue);
  });

  const beginButton = el(
    'button',
    { class: 'btn btn-primary', type: 'button', 'data-testid': 'begin-button' },
    'Begin',
  );
  beginButton.addEventListener('click', () => {
    const config: SimConfig = {
      seed: seedValue,
      mode: selectedMode,
      mapSize: selectedMapSize,
      startPopulation: selectedPopulation,
    };
    for (const cb of listeners) cb(config);
  });

  const root = el(
    'div',
    { class: 'setup-screen' },
    el('h1', {}, 'Genesis'),
    cardsRow,
    el(
      'div',
      { class: 'setup-field' },
      el('label', {}, 'Map size'),
      mapSizeSelect,
    ),
    el(
      'div',
      { class: 'setup-field' },
      el('label', {}, 'Starting population'),
      populationSelect,
    ),
    el(
      'div',
      { class: 'setup-field' },
      el('label', {}, 'Seed'),
      el('div', { class: 'setup-row' }, seedInput, randomButton),
    ),
    beginButton,
  );

  container.appendChild(root);
  refreshCardSelection();

  return {
    root,
    onBegin(cb: (config: SimConfig) => void): void {
      listeners.push(cb);
    },
  };
}
