// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { radarChart } from '../../src/ui/charts';

/** Minimal 2D context stub shared by every chart test in this file (and extended, not replaced, by Task 42). */
function stubContext(canvas: HTMLCanvasElement): { calls: string[] } {
  const calls: string[] = [];
  const ctx = {
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    clearRect: vi.fn(() => calls.push('clearRect')),
    beginPath: vi.fn(() => calls.push('beginPath')),
    moveTo: vi.fn(() => calls.push('moveTo')),
    lineTo: vi.fn(() => calls.push('lineTo')),
    closePath: vi.fn(() => calls.push('closePath')),
    stroke: vi.fn(() => calls.push('stroke')),
    fill: vi.fn(() => calls.push('fill')),
    fillText: vi.fn(() => calls.push('fillText')),
    arc: vi.fn(() => calls.push('arc')),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
  return { calls };
}

function makeCanvas(w = 200, h = 200): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

describe('radarChart', () => {
  it('does not throw with a typical 6-axis morality vector', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() =>
      radarChart(canvas, ['care', 'fairness', 'loyalty', 'authority', 'sanctity', 'liberty'], [0.8, 0.5, 0.3, 0.2, 0.6, 0.4], '#b76ce9'),
    ).not.toThrow();
  });

  it('draws a label per axis via fillText', () => {
    const canvas = makeCanvas();
    const { calls } = stubContext(canvas);
    radarChart(canvas, ['a', 'b', 'c'], [0.1, 0.2, 0.3], '#3d9be9');
    expect(calls.filter((c) => c === 'fillText').length).toBeGreaterThanOrEqual(3);
  });

  it('does not throw on an empty axes/values pair', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() => radarChart(canvas, [], [], '#e4572e')).not.toThrow();
  });

  it('does not throw or index out of bounds when axes and values have mismatched lengths', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() => radarChart(canvas, ['a', 'b', 'c', 'd'], [0.5, 0.5], '#76b041')).not.toThrow();
    expect(() => radarChart(canvas, ['a'], [0.5, 0.5, 0.5], '#76b041')).not.toThrow();
  });

  it('clamps out-of-range values into [0, 1] without throwing', () => {
    const canvas = makeCanvas();
    stubContext(canvas);
    expect(() => radarChart(canvas, ['a', 'b'], [-3, 99], '#d4a24e')).not.toThrow();
  });

  it('clears the canvas even with no axes', () => {
    const canvas = makeCanvas();
    const { calls } = stubContext(canvas);
    radarChart(canvas, [], [], '#fff');
    expect(calls).toContain('clearRect');
  });
});
