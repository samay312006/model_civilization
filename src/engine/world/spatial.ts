import { dist } from '../../shared/types';
import type { Person, Vec2 } from '../../shared/types';

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
