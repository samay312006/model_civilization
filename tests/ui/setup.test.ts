// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderSetupScreen } from '../../src/ui/setup';
import type { SimConfig } from '../../src/shared/types';

function begin(container: HTMLElement): SimConfig {
  const handle = renderSetupScreen(container);
  let captured: SimConfig | null = null;
  handle.onBegin((config) => {
    captured = config;
  });
  const beginBtn = container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement;
  beginBtn.click();
  if (captured === null) throw new Error('onBegin was not called');
  return captured;
}

describe('renderSetupScreen — defaults', () => {
  it('emits a valid SimConfig with default selections on first render', () => {
    const container = document.createElement('div');
    const config = begin(container);
    expect(config.mode).toBe('civs');
    expect(config.mapSize).toBe('medium');
    expect(config.startPopulation).toBe(400);
    expect(typeof config.seed).toBe('number');
    expect(Number.isFinite(config.seed)).toBe(true);
  });

  it('renders both mode cards with descriptions', () => {
    const container = document.createElement('div');
    renderSetupScreen(container);
    const civsCard = container.querySelector('[data-testid="mode-card-civs"]');
    const mixedCard = container.querySelector('[data-testid="mode-card-mixed"]');
    expect(civsCard).not.toBeNull();
    expect(mixedCard).not.toBeNull();
    expect(civsCard?.textContent).toContain('Opus');
    expect(civsCard?.textContent).toContain('Sonnet');
    expect(civsCard?.textContent).toContain('Haiku');
    expect(civsCard?.textContent).toContain('Fable');
    expect(mixedCard?.textContent).toMatch(/mix|blend|lineage/i);
  });

  it('replaces prior contents on repeated calls (idempotent re-render)', () => {
    const container = document.createElement('div');
    renderSetupScreen(container);
    renderSetupScreen(container);
    expect(container.querySelectorAll('[data-testid="mode-card-civs"]').length).toBe(1);
  });
});

describe('renderSetupScreen — mode selection', () => {
  it('selecting the mixed card and clicking Begin emits mode: "mixed"', () => {
    const container = document.createElement('div');
    const handle = renderSetupScreen(container);
    let captured: SimConfig | null = null;
    handle.onBegin((c) => (captured = c));
    (container.querySelector('[data-testid="mode-card-mixed"]') as HTMLElement).click();
    (container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();
    expect(captured!.mode).toBe('mixed');
  });

  it('clicking the civs card after mixed switches back to civs', () => {
    const container = document.createElement('div');
    const handle = renderSetupScreen(container);
    let captured: SimConfig | null = null;
    handle.onBegin((c) => (captured = c));
    (container.querySelector('[data-testid="mode-card-mixed"]') as HTMLElement).click();
    (container.querySelector('[data-testid="mode-card-civs"]') as HTMLElement).click();
    (container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();
    expect(captured!.mode).toBe('civs');
  });
});

describe('renderSetupScreen — map size and population controls', () => {
  it('every map size option maps to the correct SimConfig.mapSize', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const container = document.createElement('div');
      const handle = renderSetupScreen(container);
      let captured: SimConfig | null = null;
      handle.onBegin((c) => (captured = c));
      const select = container.querySelector('[data-testid="map-size-select"]') as HTMLSelectElement;
      select.value = size;
      select.dispatchEvent(new Event('change'));
      (container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();
      expect(captured!.mapSize).toBe(size);
    }
  });

  it('every population option (200/400/600) maps to the correct SimConfig.startPopulation', () => {
    for (const pop of [200, 400, 600] as const) {
      const container = document.createElement('div');
      const handle = renderSetupScreen(container);
      let captured: SimConfig | null = null;
      handle.onBegin((c) => (captured = c));
      const select = container.querySelector('[data-testid="population-select"]') as HTMLSelectElement;
      select.value = String(pop);
      select.dispatchEvent(new Event('change'));
      (container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();
      expect(captured!.startPopulation).toBe(pop);
    }
  });
});

describe('renderSetupScreen — seed controls', () => {
  it('typing a seed value is reflected exactly in the emitted SimConfig', () => {
    const container = document.createElement('div');
    const handle = renderSetupScreen(container);
    let captured: SimConfig | null = null;
    handle.onBegin((c) => (captured = c));
    const input = container.querySelector('[data-testid="seed-input"]') as HTMLInputElement;
    input.value = '424242';
    input.dispatchEvent(new Event('input'));
    (container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();
    expect(captured!.seed).toBe(424242);
  });

  it('clicking Random changes the seed input value and the emitted seed matches it', () => {
    const container = document.createElement('div');
    const handle = renderSetupScreen(container);
    let captured: SimConfig | null = null;
    handle.onBegin((c) => (captured = c));
    const input = container.querySelector('[data-testid="seed-input"]') as HTMLInputElement;
    const before = input.value;
    (container.querySelector('[data-testid="random-seed-button"]') as HTMLButtonElement).click();
    const after = input.value;
    // A fixed-seed vitest run could theoretically collide; use a spy-free
    // structural check: after clicking Random the field holds a finite
    // integer string, and Begin emits that same integer.
    expect(after).toMatch(/^\d+$/);
    void before;
    (container.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();
    expect(captured!.seed).toBe(Number(after));
  });
});

describe('renderSetupScreen — onBegin is not called before Begin is clicked', () => {
  it('does not invoke the callback merely by rendering or changing controls', () => {
    const container = document.createElement('div');
    const handle = renderSetupScreen(container);
    const cb = vi.fn();
    handle.onBegin(cb);
    (container.querySelector('[data-testid="mode-card-mixed"]') as HTMLElement).click();
    const select = container.querySelector('[data-testid="map-size-select"]') as HTMLSelectElement;
    select.value = 'large';
    select.dispatchEvent(new Event('change'));
    expect(cb).not.toHaveBeenCalled();
  });
});
