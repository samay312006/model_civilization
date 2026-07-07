// Replay is deterministic re-simulation from the save's seed, not stored
// per-tick frames — scrubbing to tick N re-runs the simulation from tick 0
// to N every time the slider moves. There is no per-tick frame cache.

import { el } from './dom';
import { civColor, TERRAIN_COLORS } from './map';
import { Simulation } from '../engine/sim/simulation';
import { deserialize } from '../engine/sim/save';
import { takeSnapshot } from '../engine/sim/snapshot';
import type { SimConfig } from '../shared/types';

export interface ReplayHandle {
  root: HTMLElement;
  scrubTo(targetTick: number): Promise<void>;
}

const PREVIEW_SIZE_PX = 240;

function drawPreview(canvas: HTMLCanvasElement, worldSize: number, snapshotIds: Int32Array, xs: Float32Array, ys: Float32Array, civIds: Int16Array): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.save();
  ctx.fillStyle = TERRAIN_COLORS.plains;
  ctx.fillRect(0, 0, PREVIEW_SIZE_PX, PREVIEW_SIZE_PX);
  const scale = PREVIEW_SIZE_PX / worldSize;
  for (let i = 0; i < snapshotIds.length; i++) {
    const x = (xs[i] as number) * scale;
    const y = (ys[i] as number) * scale;
    ctx.fillStyle = civColor(civIds[i] as number);
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Additive (contract names the file/role only). Deterministic-re-simulation
 * scrubber: every scrubTo() call constructs a brand-new Simulation from the
 * save's original config and ticks it forward from 0 — see this file's
 * header comment.
 */
export function renderReplay(container: HTMLElement, savedJson: string): ReplayHandle {
  container.innerHTML = '';

  const savedSim = deserialize(savedJson);
  const config: SimConfig = savedSim.config;
  const maxTick = savedSim.ctx.tick;

  const canvas = el('canvas', {
    width: String(PREVIEW_SIZE_PX),
    height: String(PREVIEW_SIZE_PX),
    'data-testid': 'replay-canvas',
  }) as HTMLCanvasElement;

  const readout = el('div', { 'data-testid': 'replay-readout' }, `Tick 0 / ${maxTick}`);

  const slider = el('input', {
    type: 'range',
    min: '0',
    max: String(maxTick),
    value: '0',
    'data-testid': 'replay-slider',
  }) as HTMLInputElement;

  async function scrubTo(targetTick: number): Promise<void> {
    const clamped = Math.max(0, Math.min(targetTick, maxTick));
    const sim = new Simulation(config);
    for (let i = 0; i < clamped; i++) sim.tick();
    const snap = takeSnapshot(sim, false);
    drawPreview(canvas, snap.worldSize, snap.ids, snap.xs, snap.ys, snap.civIds);
    readout.textContent = `Tick ${clamped} / ${maxTick} (year ${Math.floor(clamped / 360)}, population ${snap.population})`;
    slider.value = String(clamped);
  }

  slider.addEventListener('input', () => {
    void scrubTo(Number(slider.value));
  });

  const root = el('div', { class: 'replay panel' }, el('h4', { class: 'panel-title' }, 'Replay'), canvas, slider, readout);
  container.appendChild(root);

  return { root, scrubTo };
}
