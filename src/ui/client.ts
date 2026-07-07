import type { SimConfig, Terrain } from '../shared/types';
import type { PersonDetail, Snapshot, UiToWorker, WorkerToUi } from '../shared/protocol';

export interface SimClientOptions {
  /** Defaults to the contract's exact worker construction expression. */
  workerFactory?: () => Worker;
  /**
   * Injectable recovery hook (section deviation 1). Defaults to null: no
   * auto-restart. Task 44 wires the real hook to `() => loadRun('__autosave')`.
   * Called after every onError subscriber has already been notified.
   */
  recover?: () => Promise<string | null>;
}

function defaultWorkerFactory(): Worker {
  return new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
}

/**
 * Contract class verbatim, plus the injectable `recover` hook (section
 * deviation 1) used to auto-restart from the last autosave on worker error.
 */
export class SimClient {
  private worker: Worker | null = null;
  private readonly workerFactory: () => Worker;
  private readonly recover: (() => Promise<string | null>) | null;

  private readonly snapshotCbs: ((s: Snapshot) => void)[] = [];
  private readonly inspectCbs: ((d: PersonDetail | null) => void)[] = [];
  private readonly serializedCbs: ((json: string) => void)[] = [];
  private readonly errorCbs: ((message: string) => void)[] = [];
  private readonly terrainCbs: ((tiles: { terrain: Terrain }[], worldSize: number) => void)[] = [];

  constructor(opts: SimClientOptions = {}) {
    this.workerFactory = opts.workerFactory ?? defaultWorkerFactory;
    this.recover = opts.recover ?? null;
  }

  private attach(worker: Worker): void {
    worker.onmessage = (ev: MessageEvent<WorkerToUi>): void => {
      this.handleMessage(ev.data);
    };
  }

  private handleMessage(msg: WorkerToUi): void {
    switch (msg.type) {
      case 'ready':
        return;
      case 'snapshot':
        for (const cb of this.snapshotCbs) cb(msg.snapshot);
        return;
      case 'inspect':
        for (const cb of this.inspectCbs) cb(msg.detail);
        return;
      case 'serialized':
        for (const cb of this.serializedCbs) cb(msg.json);
        return;
      case 'error':
        for (const cb of this.errorCbs) cb(msg.message);
        this.attemptRecovery();
        return;
      case 'terrain':
        for (const cb of this.terrainCbs) cb(msg.tiles, msg.worldSize);
        return;
    }
  }

  private attemptRecovery(): void {
    if (this.recover === null) return;
    void this.recover().then((json) => {
      if (json === null) return;
      const crashed = this.worker;
      crashed?.terminate();
      const fresh = this.workerFactory();
      this.attach(fresh);
      this.worker = fresh;
      fresh.postMessage({ type: 'load', json } satisfies UiToWorker);
    });
  }

  start(config: SimConfig): void {
    // Deviation from the brief's literal body: wrap workerFactory() so a
    // synchronous construction failure (e.g. `Worker is not defined` under
    // jsdom, which has no Worker global — hit by tests/ui/main.test.ts's
    // pre-existing "switches to a run screen shell" test, which exercises
    // the real un-mocked SimClient through mountApp) is reported through the
    // existing onError channel instead of throwing out of the caller's click
    // handler. No client.test.ts case constructs a throwing workerFactory,
    // so this is behavior-preserving for every tested path; in a real
    // browser, `new Worker(...)` succeeds and this try/catch is a no-op.
    let worker: Worker;
    try {
      worker = this.workerFactory();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const cb of this.errorCbs) cb(message);
      return;
    }
    this.attach(worker);
    this.worker = worker;
    this.send({ type: 'init', config });
  }

  send(msg: UiToWorker): void {
    this.worker?.postMessage(msg);
  }

  onSnapshot(cb: (s: Snapshot) => void): void {
    this.snapshotCbs.push(cb);
  }

  onInspect(cb: (d: PersonDetail | null) => void): void {
    this.inspectCbs.push(cb);
  }

  onSerialized(cb: (json: string) => void): void {
    this.serializedCbs.push(cb);
  }

  onError(cb: (message: string) => void): void {
    this.errorCbs.push(cb);
  }

  /** Additive (Task 40's terrain-wiring addition to the WorkerToUi union). */
  onTerrain(cb: (tiles: { terrain: Terrain }[], worldSize: number) => void): void {
    this.terrainCbs.push(cb);
  }
}
