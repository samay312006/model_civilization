// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderControls } from '../../src/ui/controls';
import { SimClient } from '../../src/ui/client';
import type { SimConfig } from '../../src/shared/types';
import type { UiToWorker, WorkerToUi } from '../../src/shared/protocol';

class FakeWorker {
  sent: UiToWorker[] = [];
  onmessage: ((ev: MessageEvent<WorkerToUi>) => void) | null = null;
  postMessage(msg: UiToWorker): void {
    this.sent.push(msg);
  }
  terminate(): void {}
}

const config: SimConfig = { seed: 1, mode: 'civs', mapSize: 'small', startPopulation: 200 };

function makeClientAndWorker(): { client: SimClient; worker: FakeWorker } {
  let worker!: FakeWorker;
  const client = new SimClient({
    workerFactory: () => {
      worker = new FakeWorker();
      return worker as unknown as Worker;
    },
  });
  client.start(config);
  return { client, worker };
}

describe('renderControls — speed buttons', () => {
  it('renders one button per SPEED_PRESETS entry plus skip-generation', () => {
    const { client } = makeClientAndWorker();
    const container = document.createElement('div');
    renderControls(container, client);
    for (const id of ['speed-0', 'speed-1', 'speed-10', 'speed-60', 'speed-360', 'speed-1000']) {
      expect(container.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    }
    expect(container.querySelector('[data-testid="skip-generation"]')).not.toBeNull();
  });

  it('clicking each speed button sends the matching setSpeed message', () => {
    const { client, worker } = makeClientAndWorker();
    const container = document.createElement('div');
    renderControls(container, client);
    const cases: [string, number][] = [
      ['speed-0', 0],
      ['speed-1', 1],
      ['speed-10', 10],
      ['speed-60', 60],
      ['speed-360', 360],
      ['speed-1000', 1000],
    ];
    for (const [testId, ticksPerSecond] of cases) {
      worker.sent.length = 0;
      (container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();
      expect(worker.sent).toEqual([{ type: 'setSpeed', ticksPerSecond }]);
    }
  });

  it('clicking skip-generation sends { type: "step", n: -1 } (the SKIP_GENERATION_TICKS sentinel)', () => {
    const { client, worker } = makeClientAndWorker();
    const container = document.createElement('div');
    renderControls(container, client);
    worker.sent.length = 0;
    (container.querySelector('[data-testid="skip-generation"]') as HTMLButtonElement).click();
    expect(worker.sent).toEqual([{ type: 'step', n: -1 }]);
  });

  it('marks the clicked speed button active and clears the others', () => {
    const { client } = makeClientAndWorker();
    const container = document.createElement('div');
    renderControls(container, client);
    (container.querySelector('[data-testid="speed-60"]') as HTMLButtonElement).click();
    expect(container.querySelector('[data-testid="speed-60"]')?.classList.contains('active')).toBe(true);
    (container.querySelector('[data-testid="speed-1"]') as HTMLButtonElement).click();
    expect(container.querySelector('[data-testid="speed-1"]')?.classList.contains('active')).toBe(true);
    expect(container.querySelector('[data-testid="speed-60"]')?.classList.contains('active')).toBe(false);
  });
});

describe('renderControls — readout', () => {
  it('setReadout updates the visible year/season/population text', () => {
    const { client } = makeClientAndWorker();
    const container = document.createElement('div');
    const handle = renderControls(container, client);
    handle.setReadout(12, 'autumn', 345);
    const readout = container.querySelector('[data-testid="readout"]');
    expect(readout?.textContent).toContain('12');
    expect(readout?.textContent).toContain('autumn');
    expect(readout?.textContent).toContain('345');
  });
});

describe('renderControls does not throw when client has no callback subscribers', () => {
  it('renders cleanly with a bare SimClient', () => {
    const client = new SimClient({ workerFactory: () => new FakeWorker() as unknown as Worker });
    client.start(config);
    expect(() => renderControls(document.createElement('div'), client)).not.toThrow();
  });
  void vi;
});
