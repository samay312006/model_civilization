// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  CIV_COLORS,
  LINEAGE_COLORS,
  TERRAIN_COLORS,
  MapView,
  clampZoom,
  pickPerson,
  pickSettlement,
  schismColor,
  screenToWorld,
  worldToScreen,
  type Camera,
} from '../../src/ui/map';
import type { Snapshot } from '../../src/shared/protocol';

describe('worldToScreen / screenToWorld', () => {
  const camera: Camera = { x: 50, y: 50, zoom: 4 };

  it('maps the camera center to the viewport center', () => {
    const screen = worldToScreen({ x: 50, y: 50 }, camera, 800, 600);
    expect(screen.x).toBeCloseTo(400, 10);
    expect(screen.y).toBeCloseTo(300, 10);
  });

  it('scales offsets by zoom', () => {
    const screen = worldToScreen({ x: 51, y: 50 }, camera, 800, 600);
    expect(screen.x).toBeCloseTo(404, 10);
  });

  it('screenToWorld is the exact inverse of worldToScreen', () => {
    const world = { x: 73.5, y: 12.25 };
    const screen = worldToScreen(world, camera, 800, 600);
    const back = screenToWorld(screen, camera, 800, 600);
    expect(back.x).toBeCloseTo(world.x, 8);
    expect(back.y).toBeCloseTo(world.y, 8);
  });

  it('round-trips across a range of zoom levels', () => {
    for (const zoom of [0.5, 1, 4, 12, 24]) {
      const cam: Camera = { x: 10, y: 20, zoom };
      const world = { x: 33, y: 44 };
      const screen = worldToScreen(world, cam, 1000, 700);
      const back = screenToWorld(screen, cam, 1000, 700);
      expect(back.x).toBeCloseTo(world.x, 6);
      expect(back.y).toBeCloseTo(world.y, 6);
    }
  });
});

describe('clampZoom', () => {
  it('clamps into [0.5, 24]', () => {
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(100)).toBe(24);
    expect(clampZoom(5)).toBe(5);
    expect(clampZoom(0.5)).toBe(0.5);
    expect(clampZoom(24)).toBe(24);
  });
});

describe('pickPerson', () => {
  const camera: Camera = { x: 0, y: 0, zoom: 10 };
  const agents = [
    { id: 1, pos: { x: 0, y: 0 } },
    { id: 2, pos: { x: 1, y: 0 } },
    { id: 3, pos: { x: 5, y: 5 } },
  ];

  it('picks the nearest agent within maxScreenDist', () => {
    // viewport 400x400, camera centered at (0,0) zoom 10 -> world (0,0) is screen (200,200)
    const picked = pickPerson(agents, { x: 200, y: 200 }, camera, 400, 400, 8);
    expect(picked).toBe(1);
  });

  it('returns null when nothing is within range', () => {
    const picked = pickPerson(agents, { x: 0, y: 0 }, camera, 400, 400, 8);
    expect(picked).toBeNull();
  });

  it('breaks ties by lowest id', () => {
    const tied = [
      { id: 9, pos: { x: 0, y: 0 } },
      { id: 2, pos: { x: 0, y: 0 } },
    ];
    const picked = pickPerson(tied, { x: 200, y: 200 }, camera, 400, 400, 8);
    expect(picked).toBe(2);
  });

  it('respects the maxScreenDist boundary (agent at exactly 1 tile = 10px away at zoom 10 is out of an 8px radius)', () => {
    const picked = pickPerson(agents, { x: 200, y: 200 }, camera, 400, 400, 8);
    expect(picked).not.toBe(2); // agent 2 is 10 screen px away, radius is 8
  });
});

describe('pickSettlement', () => {
  const camera: Camera = { x: 0, y: 0, zoom: 10 };
  const settlements = [
    { id: 100, pos: { x: 0, y: 0 } },
    { id: 200, pos: { x: 2, y: 0 } }, // 20 screen px away at zoom 10
  ];

  it('picks within a 12px radius', () => {
    const picked = pickSettlement(settlements, { x: 200, y: 200 }, camera, 400, 400, 12);
    expect(picked).toBe(100);
  });

  it('returns null outside the radius', () => {
    const picked = pickSettlement(settlements, { x: 400, y: 400 }, camera, 400, 400, 12);
    expect(picked).toBeNull();
  });
});

describe('schismColor', () => {
  it('is deterministic in civId alone', () => {
    expect(schismColor(7)).toBe(schismColor(7));
  });

  it('differs across most civIds (spot check a handful of distinct ids)', () => {
    const colors = new Set([4, 5, 6, 7, 8].map(schismColor));
    expect(colors.size).toBeGreaterThan(1);
  });

  it('is a valid hsl() css string', () => {
    expect(schismColor(4)).toMatch(/^hsl\(\d+, 55%, 55%\)$/);
  });
});

describe('CIV_COLORS / LINEAGE_COLORS / TERRAIN_COLORS constants', () => {
  it('match the contract palette exactly', () => {
    expect(CIV_COLORS).toEqual(['#e4572e', '#3d9be9', '#76b041', '#b76ce9']);
    expect(LINEAGE_COLORS).toEqual({ opus: '#d4a24e', sonnet: '#3d9be9', haiku: '#76b041', fable: '#b76ce9' });
    expect(TERRAIN_COLORS).toEqual({
      water: '#1a2f4a',
      plains: '#2e4a2b',
      forest: '#1f3d1f',
      mountain: '#4a4a52',
      desert: '#7a6a45',
    });
  });
});

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: 0,
    year: 0,
    season: 'spring',
    population: 2,
    worldSize: 96,
    ids: Int32Array.from([1, 2]),
    xs: Float32Array.from([10, 20]),
    ys: Float32Array.from([10, 20]),
    civIds: Int16Array.from([0, 1]),
    lineages: Int8Array.from([0, 1]),
    healths: Uint8Array.from([255, 200]),
    moods: Uint8Array.from([0, 1]),
    settlements: [],
    territory: null,
    recentEvents: [],
    metrics: [],
    ...overrides,
  };
}

/** Minimal 2D context stub: every canvas.getContext('2d') call in MapView routes through this so render() never throws under jsdom (which has no real canvas backend). */
function stubCanvasContext(canvas: HTMLCanvasElement): void {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
}

describe('MapView — construction and rendering do not throw', () => {
  it('constructs against a canvas with a stubbed 2D context', () => {
    const canvas = document.createElement('canvas');
    stubCanvasContext(canvas);
    expect(() => new MapView(canvas)).not.toThrow();
  });

  it('render(snapshot) does not throw and is safe to call repeatedly', () => {
    const canvas = document.createElement('canvas');
    stubCanvasContext(canvas);
    const view = new MapView(canvas);
    expect(() => {
      view.render(makeSnapshot());
      view.render(makeSnapshot({ tick: 1 }));
    }).not.toThrow();
  });

  it('onPickPerson / onPickSettlement register without throwing', () => {
    const canvas = document.createElement('canvas');
    stubCanvasContext(canvas);
    const view = new MapView(canvas);
    expect(() => {
      view.onPickPerson(() => {});
      view.onPickSettlement(() => {});
    }).not.toThrow();
  });

  it('a click that resolves to a nearby agent fires onPickPerson with that id', () => {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 400, configurable: true });
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => '' });
    stubCanvasContext(canvas);
    const view = new MapView(canvas);
    view.render(makeSnapshot({ xs: Float32Array.from([48]), ys: Float32Array.from([48]), ids: Int32Array.from([42]), civIds: Int16Array.from([0]), lineages: Int8Array.from([0]), healths: Uint8Array.from([255]), moods: Uint8Array.from([0]), population: 1 }));
    const picked = vi.fn();
    view.onPickPerson(picked);
    // MapView's default camera centers on the world midpoint at a zoom that
    // fits the 96x96 world in a 400x400 canvas on construction (see Step 3);
    // clicking the exact canvas center should hit the single agent placed at
    // the world center (48, 48).
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 200 }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 200 }));
    expect(picked).toHaveBeenCalledWith(42);
  });
});
