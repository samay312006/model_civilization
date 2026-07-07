// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { SimClient } from '../../src/ui/client';
import type { SimConfig } from '../../src/shared/types';
import type { UiToWorker, WorkerToUi } from '../../src/shared/protocol';

/** Minimal fake Worker: records every posted message and lets the test push replies. */
class FakeWorker {
  sent: UiToWorker[] = [];
  onmessage: ((ev: MessageEvent<WorkerToUi>) => void) | null = null;
  terminated = false;

  postMessage(msg: UiToWorker): void {
    this.sent.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(msg: WorkerToUi): void {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerToUi>);
  }
}

const config: SimConfig = { seed: 1, mode: 'civs', mapSize: 'small', startPopulation: 200 };

// Deviation from the brief's literal helper: the original reassigned an
// outer `let worker` inside workerFactory and returned `{ client, worker }`
// immediately — but object-literal properties are evaluated at return time,
// so the destructured `worker` in every test was captured as `undefined`
// (workerFactory hadn't run yet). Every test using this helper calls
// `client.start(config)` exactly once, so creating the FakeWorker eagerly
// and always returning that same instance from workerFactory is behaviorally
// identical while fixing the capture-before-assignment bug.
function makeClient(): { client: SimClient; worker: FakeWorker } {
  const worker = new FakeWorker();
  const client = new SimClient({
    workerFactory: () => worker as unknown as Worker,
  });
  return { client, worker };
}

describe('SimClient.start / send', () => {
  it('start(config) constructs a worker and posts an init message', () => {
    const { client, worker } = makeClient();
    client.start(config);
    expect(worker.sent).toEqual([{ type: 'init', config }]);
  });

  it('send(msg) forwards to the underlying worker verbatim', () => {
    const { client, worker } = makeClient();
    client.start(config);
    client.send({ type: 'setSpeed', ticksPerSecond: 60 });
    expect(worker.sent[1]).toEqual({ type: 'setSpeed', ticksPerSecond: 60 });
  });
});

describe('SimClient subscriptions', () => {
  it('onSnapshot fires for snapshot messages only', () => {
    const { client, worker } = makeClient();
    client.start(config);
    const cb = vi.fn();
    client.onSnapshot(cb);
    const fakeSnapshot = { tick: 1 } as unknown as Parameters<typeof cb>[0];
    worker.emit({ type: 'snapshot', snapshot: fakeSnapshot });
    worker.emit({ type: 'ready' });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(fakeSnapshot);
  });

  it('onInspect fires with the detail payload, including null', () => {
    const { client, worker } = makeClient();
    client.start(config);
    const cb = vi.fn();
    client.onInspect(cb);
    worker.emit({ type: 'inspect', detail: null });
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('onSerialized fires with the json string', () => {
    const { client, worker } = makeClient();
    client.start(config);
    const cb = vi.fn();
    client.onSerialized(cb);
    worker.emit({ type: 'serialized', json: '{"v":1}' });
    expect(cb).toHaveBeenCalledWith('{"v":1}');
  });

  it('onError fires with the message string', () => {
    const { client, worker } = makeClient();
    client.start(config);
    const cb = vi.fn();
    client.onError(cb);
    worker.emit({ type: 'error', message: 'boom' });
    expect(cb).toHaveBeenCalledWith('boom');
  });

  it('onTerrain fires with the tiles array and worldSize', () => {
    const { client, worker } = makeClient();
    client.start(config);
    const cb = vi.fn();
    client.onTerrain(cb);
    const tiles = [{ terrain: 'plains' as const }, { terrain: 'water' as const }];
    worker.emit({ type: 'terrain', tiles, worldSize: 96 });
    expect(cb).toHaveBeenCalledWith(tiles, 96);
  });

  it('supports multiple subscribers to the same event', () => {
    const { client, worker } = makeClient();
    client.start(config);
    const a = vi.fn();
    const b = vi.fn();
    client.onError(a);
    client.onError(b);
    worker.emit({ type: 'error', message: 'x' });
    expect(a).toHaveBeenCalledWith('x');
    expect(b).toHaveBeenCalledWith('x');
  });
});

describe('SimClient auto-restart-from-autosave on worker error', () => {
  it('without a recover hook, an error only notifies onError and does not restart', async () => {
    const { client, worker } = makeClient();
    client.start(config);
    const errCb = vi.fn();
    client.onError(errCb);
    worker.emit({ type: 'error', message: 'crash' });
    await Promise.resolve();
    await Promise.resolve();
    expect(errCb).toHaveBeenCalledWith('crash');
    expect(worker.terminated).toBe(false);
  });

  it('with a recover hook returning a save, restarts a fresh worker and sends load', async () => {
    const workers: FakeWorker[] = [];
    const client = new SimClient({
      workerFactory: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      recover: async () => '{"v":1,"tick":5}',
    });
    client.start(config);
    const firstWorker = workers[0]!;
    firstWorker.emit({ type: 'error', message: 'crash' });
    // allow the recover() promise microtask + subsequent synchronous work to flush
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(firstWorker.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1]!.sent).toEqual([{ type: 'load', json: '{"v":1,"tick":5}' }]);
  });

  it('with a recover hook returning null, does not restart', async () => {
    const workers: FakeWorker[] = [];
    const client = new SimClient({
      workerFactory: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      recover: async () => null,
    });
    client.start(config);
    workers[0]!.emit({ type: 'error', message: 'crash' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(workers).toHaveLength(1);
  });
});
