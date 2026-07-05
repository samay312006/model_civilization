import { dist } from '../../shared/types';
import type { Person, Vec2 } from '../../shared/types';
import type { World } from './terrain';

/** Grid bucket edge length in tiles. */
export const SPATIAL_CELL_SIZE = 8;

interface SpatialEntry {
  id: number;
  x: number;
  y: number;
}

/**
 * Grid-bucket index over alive people. rebuild() is called once per tick
 * (Simulation step 2); near() answers radius queries in ascending-id order
 * so results never depend on Map iteration order.
 */
export class SpatialIndex {
  private cells = new Map<number, SpatialEntry[]>();

  private static key(cx: number, cy: number): number {
    return cx * 65536 + cy;
  }

  rebuild(people: Person[]): void {
    this.cells.clear();
    for (const p of people) {
      if (!p.alive) continue;
      const cx = Math.floor(p.pos.x / SPATIAL_CELL_SIZE);
      const cy = Math.floor(p.pos.y / SPATIAL_CELL_SIZE);
      const key = SpatialIndex.key(cx, cy);
      let bucket = this.cells.get(key);
      if (!bucket) {
        bucket = [];
        this.cells.set(key, bucket);
      }
      bucket.push({ id: p.id, x: p.pos.x, y: p.pos.y });
    }
  }

  /** Ids of indexed people within euclidean `radius` of `pos`, ascending. */
  near(pos: Vec2, radius: number): number[] {
    const minCx = Math.floor((pos.x - radius) / SPATIAL_CELL_SIZE);
    const maxCx = Math.floor((pos.x + radius) / SPATIAL_CELL_SIZE);
    const minCy = Math.floor((pos.y - radius) / SPATIAL_CELL_SIZE);
    const maxCy = Math.floor((pos.y + radius) / SPATIAL_CELL_SIZE);
    const ids: number[] = [];
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.cells.get(SpatialIndex.key(cx, cy));
        if (!bucket) continue;
        for (const e of bucket) {
          if (dist({ x: e.x, y: e.y }, pos) <= radius) ids.push(e.id);
        }
      }
    }
    ids.sort((a, b) => a - b);
    return ids;
  }
}

/**
 * One-tile 8-directional step from `from` toward `to`. Candidates are tried
 * in a fixed deterministic order: the direct (possibly diagonal) direction
 * first, then sidesteps. Never returns a water or out-of-bounds tile;
 * returns a copy of `from` when fully blocked or already at the target.
 *
 * NOTE (recorded contract deviation): the contract listed
 * stepToward(from, to) but water avoidance requires terrain access, so
 * `world` is a required third parameter. Callers pass ctx.world.
 */
export function stepToward(from: Vec2, to: Vec2, world: World): Vec2 {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === 0) return { x: from.x, y: from.y };
  let offsets: [number, number][];
  if (dx !== 0 && dy !== 0) {
    offsets = [[dx, dy], [dx, 0], [0, dy]];
  } else if (dx !== 0) {
    offsets = [[dx, 0], [dx, 1], [dx, -1]];
  } else {
    offsets = [[0, dy], [1, dy], [-1, dy]];
  }
  for (const [ox, oy] of offsets) {
    const x = from.x + ox;
    const y = from.y + oy;
    if (world.inBounds(x, y) && world.tileAt(x, y).terrain !== 'water') {
      return { x, y };
    }
  }
  return { x: from.x, y: from.y };
}
