// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/client', () => {
  class FakeSimClient {
    snapshotCallbacks: ((s: unknown) => void)[] = [];
    snapshotCb: ((s: unknown) => void) | null = null;
    start(): void {}
    send(): void {}
    onSnapshot(cb: (s: unknown) => void): void {
      this.snapshotCallbacks.push(cb);
      this.snapshotCb = cb; // Keep the last one for direct test access
    }
    fireSnapshot(s: unknown): void {
      for (const cb of this.snapshotCallbacks) {
        cb(s);
      }
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

describe('main.ts wires the event feed to every snapshot', () => {
  it('feeding a snapshot with recentEvents populates the feed panel', async () => {
    const mod = await import('../../src/ui/main');
    const root = document.createElement('div');
    mod.mountApp(root);
    (root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();

    const client = mod.activeClient as unknown as { fireSnapshot: (s: unknown) => void };
    client.fireSnapshot({
      tick: 360,
      year: 1,
      season: 'spring',
      population: 1,
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
      recentEvents: [{ tick: 300, kind: 'birth', severity: 1, civId: 0, text: 'A child is born to Mira and Boren.' }],
      metrics: [
        {
          civId: 0,
          name: 'Opus Dominion',
          color: '#e4572e',
          population: 1,
          births: 1,
          deaths: 0,
          techCount: 0,
          atWar: false,
          lineageShare: { opus: 1, sonnet: 0, haiku: 0, fable: 0 },
          avgMorality: { care: 0.5, fairness: 0.5, loyalty: 0.5, authority: 0.5, sanctity: 0.5, liberty: 0.5 },
          avgEmotions: { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 },
          foodPerCapita: 1,
        },
      ],
    });

    expect(root.querySelector('#dock-feed')?.textContent).toContain('A child is born to Mira and Boren.');
    expect(root.querySelector('#dock-feed')?.textContent).toContain('Opus Dominion');
  });
});
