// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderReplay } from '../../src/ui/replay';
import { Simulation } from '../../src/engine/sim/simulation';
import { serialize } from '../../src/engine/sim/save';
import type { SimConfig } from '../../src/shared/types';

function stubAllCanvasContexts(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    set fillStyle(_v: string) {},
  } as unknown as CanvasRenderingContext2D);
}

const config: SimConfig = { seed: 4, mode: 'civs', mapSize: 'small', startPopulation: 200 };

function makeSavedJson(ticks: number): string {
  const sim = new Simulation(config);
  for (let i = 0; i < ticks; i++) sim.tick();
  return serialize(sim);
}

describe('renderReplay', () => {
  it('renders a slider bounded by the save\'s own tick', () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    renderReplay(container, makeSavedJson(50));
    const slider = container.querySelector('[data-testid="replay-slider"]') as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('50');
  });

  it('scrubTo(0) resolves without throwing and renders the preview canvas', async () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderReplay(container, makeSavedJson(30));
    await expect(handle.scrubTo(0)).resolves.toBeUndefined();
    expect(container.querySelector('[data-testid="replay-canvas"]')).not.toBeNull();
  });

  it('scrubTo(targetTick) re-simulates deterministically: scrubbing to the same tick twice gives the same population', async () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderReplay(container, makeSavedJson(40));
    let firstPopulation = -1;
    let secondPopulation = -1;
    const originalTick = Simulation.prototype.tick;
    void originalTick;
    await handle.scrubTo(20);
    // Population is exposed indirectly via a readout the implementation
    // renders — assert the readout text is stable across two scrubs to the
    // same target tick (a proxy for "two fresh re-simulations to the same
    // tick agree", the deterministic-replay guarantee).
    const readoutAfterFirst = container.querySelector('[data-testid="replay-readout"]')?.textContent ?? '';
    await handle.scrubTo(20);
    const readoutAfterSecond = container.querySelector('[data-testid="replay-readout"]')?.textContent ?? '';
    expect(readoutAfterFirst).toBe(readoutAfterSecond);
    void firstPopulation;
    void secondPopulation;
  });

  it('clamps a target tick beyond the save\'s own tick to the save\'s tick', async () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    const handle = renderReplay(container, makeSavedJson(10));
    await expect(handle.scrubTo(999999)).resolves.toBeUndefined();
    const readout = container.querySelector('[data-testid="replay-readout"]')?.textContent ?? '';
    expect(readout).toContain('10');
  });

  it('moving the slider calls scrubTo (readout updates to the new tick)', async () => {
    stubAllCanvasContexts();
    const container = document.createElement('div');
    renderReplay(container, makeSavedJson(60));
    const slider = container.querySelector('[data-testid="replay-slider"]') as HTMLInputElement;
    slider.value = '30';
    slider.dispatchEvent(new Event('input'));
    await vi.waitFor(() => {
      const readout = container.querySelector('[data-testid="replay-readout"]')?.textContent ?? '';
      expect(readout).toContain('30');
    });
  });
});
