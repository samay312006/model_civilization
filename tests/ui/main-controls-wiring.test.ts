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
  }
  return { SimClient: FakeSimClient };
});

describe('main.ts wires SimClient and controls together on Begin', () => {
  it('starts the client with the configured SimConfig and updates the readout on snapshot', async () => {
    const mod = await import('../../src/ui/main');
    const root = document.createElement('div');
    mod.mountApp(root);
    (root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();

    expect(mod.activeClient).not.toBeNull();
    const readout = root.querySelector('[data-testid="readout"]');
    expect(readout).not.toBeNull();

    const client = mod.activeClient as unknown as { snapshotCb: ((s: unknown) => void) | null };
    client.snapshotCb?.({ year: 3, season: 'winter', population: 210, tick: 1080 });
    expect(readout?.textContent).toContain('3');
    expect(readout?.textContent).toContain('winter');
    expect(readout?.textContent).toContain('210');
  });
});
