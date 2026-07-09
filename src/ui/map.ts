import type { Lineage, Terrain, Vec2 } from '../shared/types';
import type { Snapshot } from '../shared/protocol';

export const CIV_COLORS: readonly string[] = ['#e4572e', '#3d9be9', '#76b041', '#b76ce9'];

export const LINEAGE_COLORS: Record<Lineage, string> = {
  opus: '#d4a24e',
  sonnet: '#3d9be9',
  haiku: '#76b041',
  fable: '#b76ce9',
};

export const TERRAIN_COLORS: Record<Terrain, string> = {
  water: '#1a2f4a',
  plains: '#2e4a2b',
  forest: '#1f3d1f',
  mountain: '#4a4a52',
  desert: '#7a6a45',
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 24;
const CLICK_MAX_DRAG_PX = 3;
const PICK_PERSON_RADIUS_PX = 8;
const PICK_SETTLEMENT_RADIUS_PX = 12;
const SETTLEMENT_LABEL_MIN_ZOOM = 4;
const MOOD_RING_MIN_ZOOM = 8;
const TERRITORY_ALPHA = 0.25;

/** Deterministic hue-wheel color for schism civs beyond the fixed CIV_COLORS palette. */
export function schismColor(civId: number): string {
  const hue = (civId * 47) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

export function civColor(civId: number): string {
  return civId >= 0 && civId < CIV_COLORS.length ? (CIV_COLORS[civId] as string) : schismColor(civId);
}

/**
 * Whether agent dots should be colored by lineage (mixed mode) rather than
 * civ (civs mode). Keyed off Snapshot.mode, not `metrics.length` — a schism
 * (culture.ts secede) can push a 2nd civ mid-run while the sim is still in
 * mixed mode, and the old `metrics.length <= 1` heuristic silently flipped
 * every agent to civ coloring the instant that happened.
 */
export function useLineageColor(snap: Pick<Snapshot, 'mode'>): boolean {
  return snap.mode === 'mixed';
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function worldToScreen(world: Vec2, camera: Camera, viewportWidth: number, viewportHeight: number): Vec2 {
  return {
    x: (world.x - camera.x) * camera.zoom + viewportWidth / 2,
    y: (world.y - camera.y) * camera.zoom + viewportHeight / 2,
  };
}

export function screenToWorld(screen: Vec2, camera: Camera, viewportWidth: number, viewportHeight: number): Vec2 {
  return {
    x: (screen.x - viewportWidth / 2) / camera.zoom + camera.x,
    y: (screen.y - viewportHeight / 2) / camera.zoom + camera.y,
  };
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export interface PickableAgent {
  id: number;
  pos: Vec2;
}

export function pickPerson(
  agents: readonly PickableAgent[],
  screenPoint: Vec2,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  maxScreenDist: number,
): number | null {
  let bestId: number | null = null;
  let bestDist = Infinity;
  for (const agent of agents) {
    const screen = worldToScreen(agent.pos, camera, viewportWidth, viewportHeight);
    const d = Math.hypot(screen.x - screenPoint.x, screen.y - screenPoint.y);
    if (d > maxScreenDist) continue;
    if (d < bestDist || (d === bestDist && (bestId === null || agent.id < bestId))) {
      bestDist = d;
      bestId = agent.id;
    }
  }
  return bestId;
}

export interface PickableSettlement {
  id: number;
  pos: Vec2;
}

export function pickSettlement(
  settlements: readonly PickableSettlement[],
  screenPoint: Vec2,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  maxScreenDist: number,
): number | null {
  let bestId: number | null = null;
  let bestDist = Infinity;
  for (const s of settlements) {
    const screen = worldToScreen(s.pos, camera, viewportWidth, viewportHeight);
    const d = Math.hypot(screen.x - screenPoint.x, screen.y - screenPoint.y);
    if (d > maxScreenDist) continue;
    if (d < bestDist || (d === bestDist && (bestId === null || s.id < bestId))) {
      bestDist = d;
      bestId = s.id;
    }
  }
  return bestId;
}

export class MapView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private terrainCanvas: HTMLCanvasElement | null = null;
  private terrainWorldSize = -1;

  private camera: Camera;
  private snapshot: Snapshot | null = null;
  private dirty = true;

  private dragging = false;
  private dragStart: Vec2 = { x: 0, y: 0 };
  private dragTotal = 0;
  private cameraAtDragStart: Camera = { x: 0, y: 0, zoom: 1 };

  private readonly pickPersonCbs: ((id: number) => void)[] = [];
  private readonly pickSettlementCbs: ((id: number) => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('MapView: 2D canvas context unavailable');
    this.ctx = ctx;
    this.camera = { x: 48, y: 48, zoom: 4 };

    canvas.addEventListener('mousedown', (ev) => this.onMouseDown(ev));
    canvas.addEventListener('mousemove', (ev) => this.onMouseMove(ev));
    canvas.addEventListener('mouseup', (ev) => this.onMouseUp(ev));
    canvas.addEventListener('wheel', (ev) => this.onWheel(ev), { passive: false });

    const loop = (): void => {
      if (this.dirty) {
        this.draw();
        this.dirty = false;
      }
      requestAnimationFrame(loop);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(loop);
  }

  /** Supplies terrain tiles once per world (see Task 40's wiring note: Snapshot carries no per-tile terrain). */
  setTerrain(tiles: readonly { terrain: Terrain }[], worldSize: number): void {
    const off = document.createElement('canvas');
    off.width = worldSize;
    off.height = worldSize;
    const offCtx = off.getContext('2d');
    if (offCtx !== null) {
      for (let y = 0; y < worldSize; y++) {
        for (let x = 0; x < worldSize; x++) {
          const tile = tiles[y * worldSize + x];
          offCtx.fillStyle = tile !== undefined ? TERRAIN_COLORS[tile.terrain] : TERRAIN_COLORS.plains;
          offCtx.fillRect(x, y, 1, 1);
        }
      }
    }
    this.terrainCanvas = off;
    this.terrainWorldSize = worldSize;
    this.dirty = true;
  }

  render(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    if (this.terrainWorldSize !== snapshot.worldSize && this.terrainCanvas === null) {
      // No terrain supplied yet for this world size: leave the placeholder
      // (solid plains fill) drawn each frame in draw() below.
      this.terrainWorldSize = snapshot.worldSize;
    }
    this.dirty = true;
  }

  /** Recenters the camera on a world position (e.g. the Inspector's Follow button); zoom is unchanged. */
  centerOn(x: number, y: number): void {
    this.camera = { ...this.camera, x, y };
    this.dirty = true;
  }

  onPickPerson(cb: (id: number) => void): void {
    this.pickPersonCbs.push(cb);
  }

  onPickSettlement(cb: (id: number) => void): void {
    this.pickSettlementCbs.push(cb);
  }

  private viewportSize(): { w: number; h: number } {
    const w = this.canvas.clientWidth || this.canvas.width || 800;
    const h = this.canvas.clientHeight || this.canvas.height || 600;
    return { w, h };
  }

  private onMouseDown(ev: MouseEvent): void {
    this.dragging = true;
    this.dragTotal = 0;
    this.dragStart = { x: ev.clientX, y: ev.clientY };
    this.cameraAtDragStart = { ...this.camera };
  }

  private onMouseMove(ev: MouseEvent): void {
    if (!this.dragging) return;
    const dx = ev.clientX - this.dragStart.x;
    const dy = ev.clientY - this.dragStart.y;
    this.dragTotal = Math.hypot(dx, dy);
    this.camera = {
      ...this.camera,
      x: this.cameraAtDragStart.x - dx / this.camera.zoom,
      y: this.cameraAtDragStart.y - dy / this.camera.zoom,
    };
    this.dirty = true;
  }

  private onMouseUp(ev: MouseEvent): void {
    this.dragging = false;
    if (this.dragTotal < CLICK_MAX_DRAG_PX) {
      this.handleClick(ev);
    }
  }

  private handleClick(ev: MouseEvent): void {
    if (this.snapshot === null) return;
    const rect = this.canvas.getBoundingClientRect();
    const screenPoint: Vec2 = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    const { w, h } = this.viewportSize();

    const agents: PickableAgent[] = [];
    const snap = this.snapshot;
    for (let i = 0; i < snap.ids.length; i++) {
      agents.push({ id: snap.ids[i] as number, pos: { x: snap.xs[i] as number, y: snap.ys[i] as number } });
    }
    const personId = pickPerson(agents, screenPoint, this.camera, w, h, PICK_PERSON_RADIUS_PX);
    if (personId !== null) {
      for (const cb of this.pickPersonCbs) cb(personId);
      return;
    }

    const settlements: PickableSettlement[] = snap.settlements.map((s) => ({ id: s.id, pos: { x: s.x, y: s.y } }));
    const settlementId = pickSettlement(settlements, screenPoint, this.camera, w, h, PICK_SETTLEMENT_RADIUS_PX);
    if (settlementId !== null) {
      for (const cb of this.pickSettlementCbs) cb(settlementId);
    }
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const screenPoint: Vec2 = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    const { w, h } = this.viewportSize();
    const worldBefore = screenToWorld(screenPoint, this.camera, w, h);

    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = clampZoom(this.camera.zoom * factor);
    this.camera = { ...this.camera, zoom: newZoom };

    const screenAfter = worldToScreen(worldBefore, this.camera, w, h);
    this.camera = {
      x: this.camera.x + (screenAfter.x - screenPoint.x) / this.camera.zoom,
      y: this.camera.y + (screenAfter.y - screenPoint.y) / this.camera.zoom,
      zoom: this.camera.zoom,
    };
    this.dirty = true;
  }

  private draw(): void {
    const snap = this.snapshot;
    const { w, h } = this.viewportSize();
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, w, h);

    if (snap === null) {
      ctx.restore();
      return;
    }

    this.drawTerrain(w, h);
    if (snap.territory !== null) this.drawTerritory(snap, w, h);
    this.drawSettlements(snap, w, h);
    this.drawAgents(snap, w, h);

    ctx.restore();
  }

  private drawTerrain(w: number, h: number): void {
    const ctx = this.ctx;
    if (this.terrainCanvas === null) {
      ctx.fillStyle = TERRAIN_COLORS.plains;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const topLeft = screenToWorld({ x: 0, y: 0 }, this.camera, w, h);
    const bottomRight = screenToWorld({ x: w, y: h }, this.camera, w, h);
    const sx = Math.max(0, Math.floor(topLeft.x));
    const sy = Math.max(0, Math.floor(topLeft.y));
    const sw = Math.min(this.terrainCanvas.width, Math.ceil(bottomRight.x)) - sx;
    const sh = Math.min(this.terrainCanvas.height, Math.ceil(bottomRight.y)) - sy;
    const dest = worldToScreen({ x: sx, y: sy }, this.camera, w, h);
    ctx.drawImage(this.terrainCanvas, sx, sy, Math.max(1, sw), Math.max(1, sh), dest.x, dest.y, Math.max(1, sw) * this.camera.zoom, Math.max(1, sh) * this.camera.zoom);
  }

  private drawTerritory(snap: Snapshot, w: number, h: number): void {
    const ctx = this.ctx;
    const territory = snap.territory;
    if (territory === null) return;
    const prevAlpha = ctx.globalAlpha ?? 1;
    ctx.globalAlpha = TERRITORY_ALPHA;
    const topLeft = screenToWorld({ x: 0, y: 0 }, this.camera, w, h);
    const bottomRight = screenToWorld({ x: w, y: h }, this.camera, w, h);
    const minX = Math.max(0, Math.floor(topLeft.x));
    const minY = Math.max(0, Math.floor(topLeft.y));
    const maxX = Math.min(snap.worldSize - 1, Math.ceil(bottomRight.x));
    const maxY = Math.min(snap.worldSize - 1, Math.ceil(bottomRight.y));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const owner = territory[y * snap.worldSize + x] ?? -1;
        if (owner < 0) continue;
        ctx.fillStyle = civColor(owner);
        const screen = worldToScreen({ x, y }, this.camera, w, h);
        ctx.fillRect(screen.x, screen.y, this.camera.zoom, this.camera.zoom);
      }
    }
    ctx.globalAlpha = prevAlpha;
  }

  private drawSettlements(snap: Snapshot, w: number, h: number): void {
    const ctx = this.ctx;
    for (const s of snap.settlements) {
      const screen = worldToScreen({ x: s.x, y: s.y }, this.camera, w, h);
      const size = Math.max(4, Math.min(24, 4 + Math.sqrt(s.population)));
      ctx.fillStyle = civColor(s.civId);
      ctx.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);
      if (this.camera.zoom > SETTLEMENT_LABEL_MIN_ZOOM) {
        ctx.fillStyle = '#e6e9f0';
        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(s.name, screen.x, screen.y - size / 2 - 4);
      }
    }
  }

  private drawAgents(snap: Snapshot, w: number, h: number): void {
    const ctx = this.ctx;
    const lineageColored = useLineageColor(snap);
    for (let i = 0; i < snap.ids.length; i++) {
      const screen = worldToScreen({ x: snap.xs[i] as number, y: snap.ys[i] as number }, this.camera, w, h);
      const radius = Math.max(2, Math.min(4, 2 + this.camera.zoom / 12));
      const civId = snap.civIds[i] as number;
      const lineageIdx = snap.lineages[i] as number;
      const lineage = (['opus', 'sonnet', 'haiku', 'fable'] as const)[lineageIdx] ?? 'opus';
      ctx.fillStyle = lineageColored ? LINEAGE_COLORS[lineage] : civColor(civId);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      ctx.fill();

      const mood = (['calm', 'afraid', 'angry', 'joyful', 'grieving'] as const)[snap.moods[i] as number];
      if (this.camera.zoom > MOOD_RING_MIN_ZOOM && (mood === 'afraid' || mood === 'angry')) {
        ctx.strokeStyle = mood === 'afraid' ? '#3d9be9' : '#e4572e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}
