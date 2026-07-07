// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/client', () => {
  class FakeSimClient {
    static lastRecover: (() => Promise<string | null>) | undefined;
    sentMessages: unknown[] = [];
    serializedCbs: ((json: string) => void)[] = [];
    constructor(opts?: { recover?: () => Promise<string | null> }) {
      FakeSimClient.lastRecover = opts?.recover;
    }
    start(): void {}
    send(msg: unknown): void {
      this.sentMessages.push(msg);
    }
    onSnapshot(): void {}
    onInspect(): void {}
    onSerialized(cb: (json: string) => void): void {
      this.serializedCbs.push(cb);
    }
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

vi.mock('../../src/ui/storage', async () => {
  const saved = new Map<string, string>();
  return {
    DB_NAME: 'genesis',
    STORE_NAME: 'saves',
    AUTOSAVE_NAME: '__autosave',
    AUTOSAVE_INTERVAL_MS: 60000,
    saveRun: vi.fn(async (name: string, json: string) => {
      saved.set(name, json);
    }),
    loadRun: vi.fn(async (name: string) => saved.get(name) ?? null),
    listRuns: vi.fn(async () => []),
    deleteRun: vi.fn(async () => {}),
    startAutosave: vi.fn(() => ({ stop: () => {} })),
    makeInMemoryIDBFactory: vi.fn(),
  };
});

describe('main.ts wires SimClient with a real recover hook and renders IO buttons', () => {
  it('constructs SimClient with a recover function that delegates to storage.loadRun(AUTOSAVE_NAME)', async () => {
    const clientMod = await import('../../src/ui/client');
    const mod = await import('../../src/ui/main');
    const root = document.createElement('div');
    mod.mountApp(root);
    await Promise.resolve();
    await Promise.resolve();

    const beginButton = root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement | null;
    expect(beginButton).not.toBeNull();
    beginButton?.click();

    const FakeSimClient = clientMod.SimClient as unknown as { lastRecover?: () => Promise<string | null> };
    expect(typeof FakeSimClient.lastRecover).toBe('function');
  });

  it('renders save/load/export/import controls in the topbar after Begin', async () => {
    const mod = await import('../../src/ui/main');
    const root = document.createElement('div');
    mod.mountApp(root);
    await Promise.resolve();
    await Promise.resolve();
    (root.querySelector('[data-testid="begin-button"]') as HTMLButtonElement).click();

    expect(root.querySelector('[data-testid="save-button"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="load-button"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="export-button"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="import-button"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="import-file-input"]')).not.toBeNull();
  });
});
