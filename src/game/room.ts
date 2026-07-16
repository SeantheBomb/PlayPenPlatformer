// Runtime instantiation of a RoomDef: tilemap, entities, enemies, traps, drops.
import type { Content, EnemyDef, RoomDef, RoomEntity } from "../data/types";
import { TILE, TileMap } from "../engine/tilemap";
import { drawBlob, drawItemIcon, roundRect, shade } from "../engine/renderer";
import { dist, rectsOverlap, type Rect } from "../engine/math";
import type { RoomMutations } from "./state";

export interface EntityInstance extends Rect {
  index: number;
  def: RoomEntity;
  kind: RoomEntity["type"];
  collected?: boolean;
  open?: boolean;
  helped?: boolean;
  occupied?: boolean; // locker with player inside
}

export interface EnemyInstance {
  index: number;
  def: EnemyDef;
  x: number; y: number;
  vx: number; vy: number;
  facing: number;
  state: "patrol" | "chase" | "return" | "stunned" | "trapped";
  stunUntil: number;
  lastSawPlayerAt: number;
  homeX: number;
  patrolMin: number;
  patrolMax: number;
}

export interface PlacedTrap extends Rect {
  used: boolean;
}

export interface DropBundle extends Rect {
  items: [string, number][];
}

const ENTITY_SIZES: Partial<Record<RoomEntity["type"], [number, number]>> = {
  pickup: [14, 14],
  note: [12, 12],
  door: [16, 32],
  locker: [16, 32],
  npc: [12, 16],
  checkpoint: [8, 24],
  exit: [28, 44],
};

export class RoomRuntime {
  map: TileMap;
  entities: EntityInstance[] = [];
  enemies: EnemyInstance[] = [];
  traps: PlacedTrap[] = [];
  bundles: DropBundle[] = [];
  spawnX = 32;
  spawnY = 32;

  constructor(
    public room: RoomDef,
    private content: Content,
    private muts: RoomMutations
  ) {
    this.map = new TileMap(room, content.tiles);
    for (const idx of muts.brokenTiles) this.map.broken.add(idx);

    room.entities.forEach((def, index) => {
      const cx = def.x * TILE + TILE / 2;
      const feetY = (def.y + 1) * TILE;
      if (def.type === "spawn") {
        this.spawnX = cx;
        this.spawnY = feetY;
        return;
      }
      if (def.type === "enemy") {
        if (muts.disabledEnemies.has(index)) return;
        const edef = content.enemies.find((e) => e.id === def.enemy);
        if (!edef) return;
        this.enemies.push({
          index, def: edef,
          x: cx - edef.width / 2,
          y: feetY - edef.height,
          vx: 0, vy: 0, facing: 1,
          state: edef.behavior === "patrol" ? "patrol" : "return",
          stunUntil: 0, lastSawPlayerAt: 0,
          homeX: cx,
          patrolMin: (def.patrolMinX ?? def.x - 3) * TILE,
          patrolMax: (def.patrolMaxX ?? def.x + 3) * TILE,
        });
        return;
      }
      const [w, h] = ENTITY_SIZES[def.type] ?? [16, 16];
      this.entities.push({
        index, def, kind: def.type,
        x: cx - w / 2, y: feetY - h, w, h,
        collected: muts.collected.has(index),
        open: muts.openedDoors.has(index),
        helped: muts.helpedNpcs.has(index),
      });
    });

    for (const b of muts.bundles) {
      this.bundles.push({ x: b.x, y: b.y, w: 14, h: 12, items: b.items });
    }
  }

  /** Nearest interactable entity within reach of the player center. */
  interactableNear(px: number, py: number, range = 22): EntityInstance | null {
    let best: EntityInstance | null = null;
    let bestD = range;
    for (const e of this.entities) {
      if (e.collected) continue;
      if (!["note", "door", "locker", "npc", "exit"].includes(e.kind)) continue;
      // Distance to the entity's rect, not its center — tall doors/lockers
      // should be reachable while standing at their base.
      const nx = Math.max(e.x, Math.min(px, e.x + e.w));
      const ny = Math.max(e.y, Math.min(py, e.y + e.h));
      const d = dist(px, py, nx, ny);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  dropBundle(x: number, y: number, items: [string, number][]): void {
    if (items.length === 0) return;
    const b: DropBundle = { x: x - 7, y: y - 12, w: 14, h: 12, items };
    this.bundles.push(b);
    this.muts.bundles.push({ x: b.x, y: b.y, items });
  }

  removeBundle(b: DropBundle): void {
    this.bundles = this.bundles.filter((x) => x !== b);
    this.muts.bundles = this.muts.bundles.filter(
      (m) => !(m.x === b.x && m.y === b.y)
    );
  }

  /** Send every enemy back to its post (called on player respawn). */
  resetEnemies(): void {
    for (const en of this.enemies) {
      if (en.state === "trapped") continue;
      en.x = en.homeX - en.def.width / 2;
      en.vx = 0;
      en.vy = 0;
      en.state = en.def.behavior === "patrol" ? "patrol" : "return";
      en.lastSawPlayerAt = 0;
    }
  }

  stunEnemiesNear(x: number, y: number, radius: number, durationMs: number): number {
    let hit = 0;
    for (const en of this.enemies) {
      if (!en.def.stunnable || en.state === "trapped") continue;
      if (dist(x, y, en.x + en.def.width / 2, en.y + en.def.height / 2) <= radius) {
        en.state = "stunned";
        en.stunUntil = performance.now() + durationMs;
        hit++;
      }
    }
    return hit;
  }

  update(
    dt: number,
    player: { centerX: number; centerY: number; hidden: boolean } | null
  ): void {
    const now = performance.now();
    for (const en of this.enemies) {
      const d = en.def;
      if (en.state === "trapped") continue;
      if (en.state === "stunned") {
        if (now >= en.stunUntil) {
          en.state = d.behavior === "patrol" ? "patrol" : "return";
        }
        continue;
      }

      const cx = en.x + d.width / 2;
      const cy = en.y + d.height / 2;

      // Vision (chase behavior)
      if (d.behavior === "chase" && player && !player.hidden) {
        const inRange = dist(cx, cy, player.centerX, player.centerY) <= (d.sightRange ?? 120);
        if (inRange && this.map.lineOfSight(cx, cy, player.centerX, player.centerY)) {
          en.state = "chase";
          en.lastSawPlayerAt = now;
        }
      }
      if (en.state === "chase") {
        const lost =
          !player || player.hidden ||
          now - en.lastSawPlayerAt > (d.loseTargetMs ?? 2000);
        if (lost) en.state = d.returnsHome ? "return" : "patrol";
      }

      // Movement intent
      let want = 0;
      let speed = d.speed;
      if (en.state === "patrol") {
        want = en.facing;
        if (cx <= en.patrolMin) want = 1;
        else if (cx >= en.patrolMax) want = -1;
        // Turn at ledges and walls
        if (d.turnAtEdges) {
          const aheadX = want > 0 ? en.x + d.width + 2 : en.x - 2;
          if (!this.map.groundBelow(aheadX, en.y + d.height + 4)) want = -en.facing;
        }
      } else if (en.state === "chase" && player) {
        speed = d.chaseSpeed ?? d.speed * 2;
        const dx = player.centerX - cx;
        want = Math.abs(dx) > 4 ? Math.sign(dx) : 0;
      } else if (en.state === "return") {
        const dx = en.homeX - cx;
        if (Math.abs(dx) > 4) want = Math.sign(dx);
        else want = 0;
      }
      if (want !== 0) en.facing = want;
      en.vx = want * speed;
      en.vy = Math.min(en.vy + 1400 * dt, 460);

      const res = this.map.move(en.x, en.y, d.width, d.height, en.vx, en.vy, dt);
      if (res.hitWall && en.state === "patrol") en.facing = -en.facing;
      en.x = res.x;
      en.y = res.y;
      en.vy = res.vy;

      // Trap check
      const rect = { x: en.x, y: en.y, w: d.width, h: d.height };
      for (const trap of this.traps) {
        if (!trap.used && d.trappable && rectsOverlap(rect, trap)) {
          trap.used = true;
          en.state = "trapped";
          this.muts.disabledEnemies.add(en.index);
        }
      }
    }
  }

  // ---------- Drawing ----------

  draw(ctx: CanvasRenderingContext2D, animT: number): void {
    for (const e of this.entities) this.drawEntity(ctx, e, animT);
    for (const t of this.traps) this.drawTrap(ctx, t);
    for (const b of this.bundles) this.drawBundle(ctx, b, animT);
    for (const en of this.enemies) this.drawEnemy(ctx, en, animT);
  }

  private drawEntity(ctx: CanvasRenderingContext2D, e: EntityInstance, animT: number): void {
    const bob = Math.sin(animT * 2.6 + e.index) * 2;
    switch (e.kind) {
      case "pickup": {
        if (e.collected) return;
        const item = this.content.items.find((i) => i.id === e.def.item);
        if (!item) return;
        const cx = e.x + e.w / 2;
        const cy = e.y + e.h / 2 + bob;
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.beginPath();
        ctx.ellipse(cx, e.y + e.h + 3, 6, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        drawItemIcon(ctx, item, cx, cy);
        break;
      }
      case "note": {
        const cy = e.y + e.h / 2 + bob * 0.6;
        ctx.fillStyle = "#f4ead8";
        ctx.fillRect(e.x, cy - 6, 11, 12);
        ctx.fillStyle = "#a99f8a";
        ctx.fillRect(e.x + 2, cy - 3, 7, 1);
        ctx.fillRect(e.x + 2, cy, 7, 1);
        ctx.fillRect(e.x + 2, cy + 3, 5, 1);
        break;
      }
      case "door": {
        const c = e.open ? "#4f8a5e" : e.def.locked ? "#8a4f5e" : "#6e5c8a";
        ctx.fillStyle = shade(c, -25);
        ctx.fillRect(e.x - 2, e.y - 2, e.w + 4, e.h + 2);
        ctx.fillStyle = c;
        ctx.fillRect(e.x, e.y, e.w, e.h);
        if (e.open) {
          ctx.fillStyle = "#0d0b14";
          ctx.fillRect(e.x + 3, e.y + 3, e.w - 6, e.h - 3);
        } else {
          ctx.fillStyle = shade(c, 25);
          ctx.beginPath();
          ctx.arc(e.x + e.w - 5, e.y + e.h / 2, 1.8, 0, Math.PI * 2);
          ctx.fill();
          if (e.def.locked) {
            ctx.strokeStyle = "#e8c95a";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(e.x + 4, e.y + 12, 8, 7);
            ctx.beginPath();
            ctx.arc(e.x + 8, e.y + 12, 3, Math.PI, 0);
            ctx.stroke();
          }
        }
        break;
      }
      case "locker": {
        ctx.fillStyle = "#48506b";
        ctx.fillRect(e.x - 1, e.y - 1, e.w + 2, e.h + 1);
        ctx.fillStyle = e.occupied ? "#39415c" : "#59627f";
        ctx.fillRect(e.x, e.y, e.w, e.h);
        ctx.fillStyle = "#39415c";
        for (let i = 0; i < 3; i++) ctx.fillRect(e.x + 3, e.y + 4 + i * 3, e.w - 6, 1.4);
        ctx.fillRect(e.x + e.w - 5, e.y + e.h / 2, 2, 5);
        if (e.occupied) {
          // peeking eyes
          ctx.fillStyle = "#ffd166";
          ctx.fillRect(e.x + 4, e.y + 6, 2, 2);
          ctx.fillRect(e.x + 9, e.y + 6, 2, 2);
        }
        break;
      }
      case "npc": {
        drawBlob(
          ctx, e.x, e.y + bob * 0.3, e.w, e.h,
          e.def.color ?? "#7fd8e8", "#1a2530", -1,
          { eyeStyle: e.helped ? "sleepy" : "wide" }
        );
        if (!e.helped) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "8px monospace";
          ctx.fillText("?", e.x + e.w / 2 - 2, e.y - 4 + bob);
        }
        break;
      }
      case "checkpoint": {
        const active = !!e.open; // reuse `open` as "activated"
        ctx.fillStyle = "#5a5470";
        ctx.fillRect(e.x + e.w / 2 - 1, e.y, 2, e.h);
        ctx.fillStyle = active ? "#5ad1a5" : "#3a3550";
        ctx.beginPath();
        ctx.moveTo(e.x + e.w / 2 + 1, e.y + 2);
        ctx.lineTo(e.x + e.w / 2 + 11, e.y + 6 + (active ? Math.sin(animT * 4) : 0));
        ctx.lineTo(e.x + e.w / 2 + 1, e.y + 10);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "exit": {
        ctx.fillStyle = "#2b3a2e";
        ctx.fillRect(e.x - 3, e.y - 3, e.w + 6, e.h + 3);
        ctx.fillStyle = "#3e5c46";
        ctx.fillRect(e.x, e.y, e.w, e.h);
        ctx.fillStyle = "#89f0b1";
        ctx.font = "7px monospace";
        ctx.fillText("EXIT", e.x + 4, e.y + 10);
        const glow = 0.4 + Math.sin(animT * 3) * 0.2;
        ctx.fillStyle = `rgba(137,240,177,${glow * 0.25})`;
        ctx.fillRect(e.x - 6, e.y - 6, e.w + 12, e.h + 6);
        break;
      }
    }
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, en: EnemyInstance, animT: number): void {
    const d = en.def;
    if (en.state === "trapped") {
      ctx.globalAlpha = 0.8;
      drawBlob(ctx, en.x, en.y, d.width, d.height, shade(d.color, -50), d.eyeColor, en.facing, { eyeStyle: "sleepy" });
      ctx.fillStyle = "rgba(139,212,79,0.55)";
      roundRect(ctx, en.x - 3, en.y + d.height * 0.4, d.width + 6, d.height * 0.6 + 2, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    if (en.state === "stunned") {
      drawBlob(ctx, en.x, en.y, d.width, d.height, shade(d.color, -30), d.eyeColor, en.facing, { blink: true });
      ctx.fillStyle = "#ffffff";
      ctx.font = "8px monospace";
      const wob = Math.sin(animT * 8) * 3;
      ctx.fillText("zZ", en.x + d.width / 2 + wob, en.y - 4);
      return;
    }
    const chasing = en.state === "chase";
    const wobble = Math.sin(animT * (chasing ? 18 : 7) + en.index) * (chasing ? 0.12 : 0.05);
    drawBlob(
      ctx, en.x, en.y, d.width, d.height, d.color, d.eyeColor, en.facing,
      { squashX: 1 + wobble, squashY: 1 - wobble, eyeStyle: chasing ? "wide" : "dot" }
    );
    if (chasing) {
      ctx.fillStyle = "#ff5470";
      ctx.font = "9px monospace";
      ctx.fillText("!", en.x + d.width / 2 - 1, en.y - 4);
    }
  }

  private drawTrap(ctx: CanvasRenderingContext2D, t: PlacedTrap): void {
    ctx.fillStyle = "#8a6d47";
    ctx.fillRect(t.x, t.y + t.h - 3, t.w, 3);
    if (!t.used) {
      ctx.fillStyle = "rgba(139,212,79,0.8)";
      roundRect(ctx, t.x + 1, t.y + t.h - 7, t.w - 2, 5, 2);
      ctx.fill();
    }
  }

  private drawBundle(ctx: CanvasRenderingContext2D, b: DropBundle, animT: number): void {
    const glow = 0.5 + Math.sin(animT * 5) * 0.3;
    ctx.fillStyle = `rgba(255,209,102,${glow * 0.3})`;
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c9a86a";
    roundRect(ctx, b.x, b.y + 2, b.w, b.h - 2, 4);
    ctx.fill();
    ctx.fillStyle = "#8a744a";
    ctx.fillRect(b.x + b.w / 2 - 1, b.y, 2, 4);
  }
}
