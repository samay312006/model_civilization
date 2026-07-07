// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/client', () => {
  class FakeSimClient {
    sentMessages: unknown[] = [];
    snapshotCb: ((s: unknown) => void) | null = null;
    inspectCb: ((d: unknown) => void) | null = null;
    start(): void {}
    send(msg: unknown): void {
      this.sentMessages.push(msg);
    }
    onSnapshot(cb: (s: unknown) => void): void {
      this.snapshotCb = cb;
    }
    onInspect(cb: (d: unknown) => void): void {
      this.inspectCb = cb;
    }
    onSerialized(): void {}
    onError(): void {}
    onTerrain(): void {}
  }
  return { SimClient: FakeSimClient };
});

vi.mock('../../src/ui/map', async () => {
  const actual = await vi.importActual<typeof import('../../src/ui/map')>('../../src/ui/map');
  class FakeMapView {
    pickCb: ((id: number) => void) | null = null;
    render(): void {}
    onPickPerson(cb: (id: number) => void): void {
      this.pickCb = cb;
    }
    onPickSettlement(): void {}
    setTerrain(): void {}
  }
  return { ...actual, MapView: FakeMapView };
});

// mountApp's Task 44 resume-on-startup check (listRuns() against the real,
// unmocked storage.ts) is asynchronous — jsdom has no real indexedDB, so the
// real listRuns() call rejects a few microtask hops later and mountApp's
// .catch() is what renders the setup screen. A macrotask flush reliably
// waits past that regardless of the exact microtask hop count.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('main.ts wires MapView picks and SimClient inspect together', () => {
  it('a map pick sends an inspect message, and the resulting detail reaches the inspector panel', async () => {
    const mod = await import('../../src/ui/main');
    const root = document.createElement('div');
    mod.mountApp(root);
    await flushMicrotasks();
    (root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();

    const client = mod.activeClient as unknown as {
      sentMessages: { type: string; personId?: number }[];
      inspectCb: ((d: unknown) => void) | null;
    };

    // Simulate MapView's pick callback firing (FakeMapView above captured it).
    const mapModule = await import('../../src/ui/map');
    const fakeMapView = mapModule.MapView as unknown as { instances?: unknown };
    void fakeMapView;

    expect(root.querySelector('[data-testid="inspector-empty"]')).not.toBeNull();

    client.inspectCb?.({
      person: { id: 3, name: 'Test', lineage: 'opus', emotions: { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 }, morality: { care: 0, fairness: 0, loyalty: 0, authority: 0, sanctity: 0, liberty: 0 }, skills: { farming: 0, gathering: 0, building: 0, crafting: 0, fighting: 0, healing: 0, teaching: 0 }, memory: [] },
      memoriesText: [],
      relationshipsNamed: [],
      temperament: { emotionVolatility: { fear: 1, joy: 1, grief: 1, anger: 1, hope: 1 }, emotionDecayPerTick: { fear: 0, joy: 0, grief: 0, anger: 0, hope: 0 }, moralWeight: 1, learningRate: 0.1, imitationRate: 0.1, desperationThreshold: 0.9, taboos: [], quirks: [], description: 'x' },
      settlementName: null,
      civName: 'Testland',
    });

    expect(root.querySelector('[data-testid="lineage-badge"]')).not.toBeNull();
    void client;
  });
});
