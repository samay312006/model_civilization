// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_INTERVAL_MS,
  AUTOSAVE_NAME,
  DB_NAME,
  STORE_NAME,
  deleteRun,
  listRuns,
  loadRun,
  makeInMemoryIDBFactory,
  saveRun,
  startAutosave,
} from '../../src/ui/storage';
import { SimClient } from '../../src/ui/client';
import type { SimConfig } from '../../src/shared/types';
import type { UiToWorker, WorkerToUi } from '../../src/shared/protocol';

describe('makeInMemoryIDBFactory — fake roundtrip', () => {
  it('save then load returns the same json', async () => {
    const factory = makeInMemoryIDBFactory();
    await saveRun('run-a', '{"tick":1}', factory);
    const loaded = await loadRun('run-a', factory);
    expect(loaded).toBe('{"tick":1}');
  });

  it('loading an absent name returns null', async () => {
    const factory = makeInMemoryIDBFactory();
    const loaded = await loadRun('nope', factory);
    expect(loaded).toBeNull();
  });

  it('list returns every saved run, sorted by savedAt descending', async () => {
    const factory = makeInMemoryIDBFactory();
    await saveRun('older', '{"a":1}', factory);
    await saveRun('newer', '{"b":2}', factory);
    const runs = await listRuns(factory);
    expect(runs.map((r) => r.name)).toEqual(['newer', 'older']);
    expect(runs[0]?.bytes).toBe('{"b":2}'.length);
  });

  it('delete removes a run so it no longer loads or lists', async () => {
    const factory = makeInMemoryIDBFactory();
    await saveRun('temp', '{"x":1}', factory);
    await deleteRun('temp', factory);
    expect(await loadRun('temp', factory)).toBeNull();
    expect(await listRuns(factory)).toHaveLength(0);
  });

  it('saving under the same name twice overwrites the previous value', async () => {
    const factory = makeInMemoryIDBFactory();
    await saveRun('same', '{"v":1}', factory);
    await saveRun('same', '{"v":2}', factory);
    expect(await loadRun('same', factory)).toBe('{"v":2}');
    expect(await listRuns(factory)).toHaveLength(1);
  });

  it('DB_NAME/STORE_NAME/AUTOSAVE_NAME/AUTOSAVE_INTERVAL_MS have the documented values', () => {
    expect(DB_NAME).toBe('genesis');
    expect(STORE_NAME).toBe('saves');
    expect(AUTOSAVE_NAME).toBe('__autosave');
    expect(AUTOSAVE_INTERVAL_MS).toBe(60000);
  });
});

class FakeWorker {
  sent: UiToWorker[] = [];
  onmessage: ((ev: MessageEvent<WorkerToUi>) => void) | null = null;
  postMessage(msg: UiToWorker): void {
    this.sent.push(msg);
  }
  terminate(): void {}
  emit(msg: WorkerToUi): void {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerToUi>);
  }
}

const config: SimConfig = { seed: 1, mode: 'civs', mapSize: 'small', startPopulation: 200 };

describe('startAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a serialize message every AUTOSAVE_INTERVAL_MS while active', () => {
    let worker!: FakeWorker;
    const client = new SimClient({
      workerFactory: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
    });
    client.start(config);
    const factory = makeInMemoryIDBFactory();
    const handle = startAutosave(client, factory);

    worker.sent.length = 0;
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    expect(worker.sent).toEqual([{ type: 'serialize' }]);

    worker.sent.length = 0;
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS * 2);
    expect(worker.sent).toEqual([{ type: 'serialize' }, { type: 'serialize' }]);

    handle.stop();
  });

  it('writes the resulting serialized json to AUTOSAVE_NAME via saveRun', async () => {
    let worker!: FakeWorker;
    const client = new SimClient({
      workerFactory: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
    });
    client.start(config);
    const factory = makeInMemoryIDBFactory();
    const handle = startAutosave(client, factory);

    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    worker.emit({ type: 'serialized', json: '{"v":1,"tick":42}' });
    await vi.waitFor(async () => {
      const loaded = await loadRun(AUTOSAVE_NAME, factory);
      expect(loaded).toBe('{"v":1,"tick":42}');
    });

    handle.stop();
  });

  it('stop() halts future autosave ticks', () => {
    let worker!: FakeWorker;
    const client = new SimClient({
      workerFactory: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
    });
    client.start(config);
    const factory = makeInMemoryIDBFactory();
    const handle = startAutosave(client, factory);
    handle.stop();
    worker.sent.length = 0;
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS * 3);
    expect(worker.sent).toEqual([]);
  });
});
