export {};

import {
  BATCH_INTERVAL_MS,
  advanceByBatch,
  handleMessage,
  type UiToWorker,
  type WorkerState,
  type WorkerToUi,
} from '../shared/protocol';

let workerState: WorkerState = {
  sim: null,
  ticksPerSecond: 0,
  ticksSinceLastSnapshot: 0,
  snapshotsTaken: 0,
  msAccumulatorSinceSnapshot: 0,
};

function transferablesOf(reply: WorkerToUi): Transferable[] {
  if (reply.type !== 'snapshot') return [];
  const s = reply.snapshot;
  const buffers: Transferable[] = [s.ids.buffer, s.xs.buffer, s.ys.buffer, s.civIds.buffer, s.lineages.buffer, s.healths.buffer, s.moods.buffer];
  if (s.territory !== null) buffers.push(s.territory.buffer);
  return buffers;
}

function postReply(reply: WorkerToUi): void {
  postMessage(reply, { transfer: transferablesOf(reply) });
}

self.onmessage = (ev: MessageEvent<UiToWorker>): void => {
  try {
    const { state, replies } = handleMessage(workerState, ev.data);
    workerState = state;
    for (const reply of replies) postReply(reply);
  } catch (err) {
    postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerToUi);
  }
};

self.onerror = (event: string | Event): void => {
  const message = typeof event === 'string' ? event : 'unknown worker error';
  postMessage({ type: 'error', message } satisfies WorkerToUi);
};

setInterval(() => {
  try {
    const { state, replies } = advanceByBatch(workerState);
    workerState = state;
    for (const reply of replies) postReply(reply);
  } catch (err) {
    postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerToUi);
  }
}, BATCH_INTERVAL_MS);
