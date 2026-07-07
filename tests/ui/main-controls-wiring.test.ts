// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/client', () => {
  class FakeSimClient {
    static instances: FakeSimClient[] = [];
    startedWith: unknown = null;
    snapshotCb: ((s: unknown) => void) | null = null;
    constructor() {
      FakeSimClient.instances.push(this);
    }
    start(config: unknown): void {
      this.startedWith = config;
    }
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

// Mirrors the FakeMapView already used by main-dashboard-wiring.test.ts,
// main-feed-wiring.test.ts, and main-inspector-wiring.test.ts. Needed here
// too as of Task 44: main.ts's mountApp now registers every client.onSnapshot
// listener (controls readout included) in one consolidated block after
// constructing controlsHandle/mapView/inspectorHandle/dashboardHandle/
// feedHandle (see beginRun), rather than one onSnapshot call per view
// immediately after each view's own construction. A real `new MapView(...)`
// throws under jsdom (no canvas.getContext implementation without the
// `canvas` npm package), which — before this fix — aborted beginRun() before
// the consolidated onSnapshot listener was ever registered, so the readout
// never updated. This was previously masked only by incidental ordering
// (controls' onSnapshot used to be registered before MapView's construction
// in the old, per-view-registration mountApp).
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

// mountApp's Task 44 resume-on-startup check (listRuns() against the real,
// unmocked storage.ts) is asynchronous — jsdom has no real indexedDB, so the
// real listRuns() call rejects a few microtask hops later and mountApp's
// .catch() is what renders the setup screen. A macrotask flush reliably
// waits past that regardless of the exact microtask hop count.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('main.ts wires SimClient and controls together on Begin', () => {
  it('starts the client with the configured SimConfig and updates the readout on snapshot', async () => {
    const mod = await import('../../src/ui/main');
    const root = document.createElement('div');
    mod.mountApp(root);
    await flushMicrotasks();
    (root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();

    expect(mod.activeClient).not.toBeNull();
    const readout = root.querySelector('[data-testid="readout"]');
    expect(readout).not.toBeNull();

    const client = mod.activeClient as unknown as { snapshotCb: ((s: unknown) => void) | null };
    client.snapshotCb?.({ year: 3, season: 'winter', population: 210, tick: 1080, metrics: [], recentEvents: [] });
    expect(readout?.textContent).toContain('3');
    expect(readout?.textContent).toContain('winter');
    expect(readout?.textContent).toContain('210');
  });
});
