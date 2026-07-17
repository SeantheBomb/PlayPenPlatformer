// The Warden, in person: a huge blob-creature that phases through walls.
// Idle mode: punishes AFK players with a one-heart slap, then dissipates.
// Boss mode (room.wardenChase): relentless pursuit, touch = death.
import type { GameConfig } from "../data/types";
import { drawBlob, drawSprite, shade } from "../engine/renderer";
import { dist } from "../engine/math";

export type WardenMode = "idle" | "boss";

const W = 52;
const H = 44;

export class Warden {
  active = false;
  mode: WardenMode = "idle";
  x = 0;
  y = 0;
  speed = 70;
  private facing = 1;
  private spawnedAt = 0;

  spawn(mode: WardenMode, x: number, y: number, speed: number): void {
    this.active = true;
    this.mode = mode;
    this.x = x;
    this.y = y;
    this.speed = speed;
    this.spawnedAt = performance.now();
  }

  dissipate(): void {
    this.active = false;
  }

  get centerX() { return this.x + W / 2; }
  get centerY() { return this.y + H / 2; }

  /** Glide toward the player; the building does not respect walls. */
  update(dt: number, targetX: number, targetY: number): void {
    if (!this.active) return;
    const dx = targetX - this.centerX;
    const dy = targetY - this.centerY;
    const d = Math.hypot(dx, dy) || 1;
    this.x += (dx / d) * this.speed * dt;
    this.y += (dy / d) * this.speed * dt * 0.8; // slightly floatier vertically
    if (Math.abs(dx) > 4) this.facing = Math.sign(dx);
  }

  touching(px: number, py: number, radius = 24): boolean {
    return this.active && dist(this.centerX, this.centerY, px, py) < radius;
  }

  distanceTo(px: number, py: number): number {
    return dist(this.centerX, this.centerY, px, py);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    antagonist: GameConfig["antagonist"],
    animT: number
  ): void {
    if (!this.active) return;
    const t = Math.min(1, (performance.now() - this.spawnedAt) / 800); // fade in
    const wob = Math.sin(animT * 5) * 0.06;
    ctx.globalAlpha = 0.25 * t;
    // Dark aura
    ctx.fillStyle = "#0d0b14";
    ctx.beginPath();
    ctx.ellipse(this.centerX, this.centerY, W * 0.9, H * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = t;
    if (!drawSprite(ctx, antagonist, this.x, this.y, W, H, this.facing)) {
      // Blob-creature body with the Warden's signature lidded eye
      drawBlob(
        ctx, this.x, this.y, W, H,
        antagonist.color, "#0d0b14", this.facing,
        { squashX: 1 + wob, squashY: 1 - wob }
      );
      // Oversized single eye replaces the blob's default dots
      const eyeX = this.centerX + this.facing * 6;
      const eyeY = this.y + H * 0.34;
      ctx.fillStyle = "#f4ead8";
      ctx.beginPath();
      ctx.ellipse(eyeX, eyeY, 12, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0d0b14";
      ctx.beginPath();
      ctx.arc(eyeX + this.facing * 3, eyeY, 4, 0, Math.PI * 2);
      ctx.fill();
      // Heavy lid
      ctx.fillStyle = shade(antagonist.color, -30);
      ctx.fillRect(eyeX - 13, eyeY - 9, 26, 5);
      // Grin
      ctx.strokeStyle = "#0d0b14";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.centerX - 10, this.y + H * 0.68);
      ctx.quadraticCurveTo(this.centerX, this.y + H * 0.78, this.centerX + 12, this.y + H * 0.66);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Red closing-in vignette; intensity grows as he gets near. */
  drawVignette(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, distPx: number): void {
    if (!this.active) return;
    const closeness = Math.max(0, 1 - distPx / 380);
    if (closeness <= 0) return;
    const g = ctx.createRadialGradient(
      viewW / 2, viewH / 2, viewH * 0.35,
      viewW / 2, viewH / 2, viewH * 0.75
    );
    g.addColorStop(0, "rgba(255,84,112,0)");
    g.addColorStop(1, `rgba(160,20,50,${0.38 * closeness})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, viewH);
  }
}
