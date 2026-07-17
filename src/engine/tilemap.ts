import type { RoomDef, TileDef } from "../data/types";

export const TILE = 16;

export interface TileHit {
  tx: number;
  ty: number;
  def: TileDef;
}

export interface MoveResult {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  hitHead: boolean;
  hitWall: boolean;
  bounced?: TileHit;   // spring tile landed on
  overlapping: TileHit[]; // non-solid special tiles overlapped after the move
}

export class TileMap {
  width: number;
  height: number;
  private grid: (TileDef | null)[];
  private byChar = new Map<string, TileDef>();
  /** Runtime tile replacements (elemental transformations, shattering...). */
  overrides = new Map<number, TileDef | null>();

  constructor(room: RoomDef, tileDefs: TileDef[]) {
    this.width = room.width;
    this.height = room.height;
    for (const def of tileDefs) this.byChar.set(def.char, def);
    this.grid = new Array(this.width * this.height).fill(null);
    for (let y = 0; y < this.height; y++) {
      const row = room.tiles[y] ?? "";
      for (let x = 0; x < this.width; x++) {
        const def = this.byChar.get(row[x] ?? ".");
        if (def) this.grid[y * this.width + x] = def;
      }
    }
  }

  get pixelWidth() { return this.width * TILE; }
  get pixelHeight() { return this.height * TILE; }

  index(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  at(tx: number, ty: number): TileDef | null {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return null;
    const idx = ty * this.width + tx;
    if (this.overrides.has(idx)) return this.overrides.get(idx)!;
    return this.grid[idx];
  }

  setTile(tx: number, ty: number, def: TileDef | null): void {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return;
    this.overrides.set(this.index(tx, ty), def);
  }

  isSolidAt(tx: number, ty: number): boolean {
    // Out-of-bounds counts as solid so nothing escapes the room.
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return true;
    return !!this.at(tx, ty)?.solid;
  }

  /** Axis-separated AABB move. */
  move(
    x: number, y: number, w: number, h: number,
    vx: number, vy: number, dt: number,
    opts: { dropThrough?: boolean } = {}
  ): MoveResult {
    const res: MoveResult = {
      x, y, vx, vy,
      onGround: false, hitHead: false, hitWall: false,
      overlapping: [],
    };
    const eps = 0.001;

    // ---- X axis ----
    let nx = res.x + vx * dt;
    if (vx !== 0) {
      const dir = Math.sign(vx);
      const edge = dir > 0 ? nx + w : nx;
      const tx = Math.floor(edge / TILE);
      const ty0 = Math.floor(res.y / TILE);
      const ty1 = Math.floor((res.y + h - eps) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        const def = this.at(tx, ty);
        const oob = tx < 0 || tx >= this.width;
        if (oob || (def?.solid && !def.oneWay)) {
          nx = dir > 0 ? tx * TILE - w - eps : (tx + 1) * TILE + eps;
          res.vx = 0;
          res.hitWall = true;
          break;
        }
      }
    }
    res.x = nx;

    // ---- Y axis ----
    let ny = res.y + vy * dt;
    if (vy !== 0) {
      const dir = Math.sign(vy);
      const edge = dir > 0 ? ny + h : ny;
      const ty = Math.floor(edge / TILE);
      const tx0 = Math.floor(res.x / TILE);
      const tx1 = Math.floor((res.x + w - eps) / TILE);
      for (let tx = tx0; tx <= tx1; tx++) {
        const def = this.at(tx, ty);
        const oob = ty < 0 || ty >= this.height;
        let blocks = false;
        if (oob) {
          blocks = true;
        } else if (def?.solid && !def.oneWay) {
          blocks = true;
        } else if (def?.oneWay && dir > 0 && !opts.dropThrough) {
          // One-way platform: only if we were fully above it before the move.
          const prevBottom = res.y + h;
          if (prevBottom <= ty * TILE + eps + 1) blocks = true;
        }
        if (blocks) {
          ny = dir > 0 ? ty * TILE - h - eps : (ty + 1) * TILE + eps;
          if (dir > 0) {
            res.onGround = true;
            if (def?.bounce) res.bounced = { tx, ty, def };
          } else {
            res.hitHead = true;
          }
          res.vy = 0;
          break;
        }
      }
    }
    res.y = ny;

    // ---- Overlaps with non-solid special tiles (spikes, goo) ----
    const tx0 = Math.floor(res.x / TILE);
    const tx1 = Math.floor((res.x + w - eps) / TILE);
    const ty0 = Math.floor(res.y / TILE);
    const ty1 = Math.floor((res.y + h - eps) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const def = this.at(tx, ty);
        if (def && !def.solid) res.overlapping.push({ tx, ty, def });
      }
    }
    return res;
  }

  /** Simple tile-grid line of sight (for enemy vision). */
  lineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (TILE / 2));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const tx = Math.floor((x1 + (x2 - x1) * t) / TILE);
      const ty = Math.floor((y1 + (y2 - y1) * t) / TILE);
      const def = this.at(tx, ty);
      if (def?.solid && !def.oneWay) return false;
    }
    return true;
  }

  /** Is there solid ground just below this point? (patrol edge detection) */
  groundBelow(x: number, y: number): boolean {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const def = this.at(tx, ty);
    return !!def?.solid;
  }
}
