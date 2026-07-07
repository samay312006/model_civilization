// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('../../src/ui/client', () => {
  class FakeSimClient {
    snapshotCb: ((s: unknown) => void) | null = null;
    start(): void {}
    send(): void {}
    onSnapshot(cb: (s: unknown) => void): void {
      this.snapshotCb = cb;
    }
    onInspect(): void {}
    onSerialized(): void {}
    onError(): void {}
    onTerrain(): void {}
  }
  return { SimClient: FakeSimClient };
});

vi.mock('../../src/ui/map', async () => {
  const actual = await vi.importActual<typeof import('../../src/ui/map')>('../../src/ui/map');
  class FakeMapView {
    render(): void {}
    onPickPerson(): void {}
    onPickSettlement(): void {}
    setTerrain(): void {}
  }
  return { ...actual, MapView: FakeMapView };
});

describe('main.ts wires the dashboard to every snapshot', () => {
  it('feeding a snapshot through the client populates dashboard tab content', async () => {
    const mod = await import('../../src/ui/main');
    const root = document.createElement('div');
    mod.mountApp(root);
    (root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();

    const client = mod.activeClient as unknown as { snapshotCb: ((s: unknown) => void) | null };
    client.snapshotCb?.({
      tick: 360,
      year: 1,
      season: 'spring',
      population: 100,
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
      metrics: [
        {
          civId: 0,
          name: 'Opus Dominion',
          color: '#e4572e',
          population: 100,
          births: 1,
          deaths: 0,
          techCount: 1,
          atWar: false,
          lineageShare: { opus: 1, sonnet: 0, haiku: 0, fable: 0 },
          avgMorality: { care: 0.5, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0.5 },
          avgEmotions: { fear: 0.1, joy: 0.5, grief: 0.1, anger: 0.1, hope: 0.5 },
          foodPerCapita: 1,
        },
      ],
    });

    expect(root.querySelector('#dock-dashboard')?.textContent).toContain('Opus Dominion');
  });
});
