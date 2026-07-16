// Player controller. All feel numbers come from content/game.json.
import type { GameConfig } from "../data/types";
import type { Input } from "../engine/input";
import { TileMap, type TileHit } from "../engine/tilemap";
import { clamp, lerp } from "../engine/math";
import { drawBlob } from "../engine/renderer";
import type { RunState } from "./state";

export interface PlayerFrameEvents {
  jumped: boolean;
  landed: boolean;
  landSpeed: number;
  broke: TileHit[];
  bounced?: TileHit;
  spikeDamage: number;
  inGoo: boolean;
}

export class Player {
  x = 0;
  y = 0;
  w: number;
  h: number;
  vx = 0;
  vy = 0;
  facing = 1;
  onGround = false;
  hiddenIn: number | null = null; // entity index of locker
  invulnUntil = 0;

  private coyoteUntil = 0;
  private jumpBufferedUntil = 0;
  private jumpHeld = false;
  private wasOnGround = false;
  // Juice
  squashX = 1;
  squashY = 1;
  private blinkAt = performance.now() + 2000;
  private blinking = false;

  constructor(private cfg: GameConfig["player"]) {
    this.w = cfg.width;
    this.h = cfg.height;
  }

  setConfig(cfg: GameConfig["player"]): void {
    this.cfg = cfg;
    this.w = cfg.width;
    this.h = cfg.height;
  }

  get centerX() { return this.x + this.w / 2; }
  get centerY() { return this.y + this.h / 2; }
  get feetY() { return this.y + this.h; }

  placeFeetAt(cx: number, feetY: number): void {
    this.x = cx - this.w / 2;
    this.y = feetY - this.h;
    this.vx = 0;
    this.vy = 0;
  }

  get invulnerable() {
    return performance.now() < this.invulnUntil || this.hiddenIn !== null;
  }

  hurt(fromX: number, invulnMs: number): void {
    this.invulnUntil = performance.now() + invulnMs;
    this.vx = Math.sign(this.centerX - fromX || 1) * this.cfg.knockbackX;
    this.vy = -this.cfg.knockbackY;
  }

  update(dt: number, input: Input, map: TileMap, state: RunState): PlayerFrameEvents {
    const cfg = this.cfg;
    const now = performance.now();
    const ev: PlayerFrameEvents = {
      jumped: false, landed: false, landSpeed: 0,
      broke: [], spikeDamage: 0, inGoo: false,
    };

    if (this.hiddenIn !== null) {
      // Fully stowed in a locker: no physics.
      this.vx = 0;
      this.vy = 0;
      return ev;
    }

    // ---- Horizontal intent ----
    const want = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (want !== 0) this.facing = want;
    const control = this.onGround ? 1 : cfg.airControl;
    if (want !== 0) {
      this.vx += want * cfg.acceleration * control * dt;
    } else {
      const f = cfg.friction * control * dt;
      if (Math.abs(this.vx) <= f) this.vx = 0;
      else this.vx -= Math.sign(this.vx) * f;
    }

    // ---- Jump: buffer + coyote + variable height ----
    if (this.onGround) this.coyoteUntil = now + cfg.coyoteTimeMs;
    if (input.jumpPressed) this.jumpBufferedUntil = now + cfg.jumpBufferMs;
    if (now < this.jumpBufferedUntil && now < this.coyoteUntil) {
      this.vy = -cfg.jumpVelocity * state.jumpMultiplier();
      this.jumpBufferedUntil = 0;
      this.coyoteUntil = 0;
      this.jumpHeld = true;
      ev.jumped = true;
      this.squashX = 0.72;
      this.squashY = 1.32;
    }
    if (this.jumpHeld && !input.jumpDown && this.vy < 0) {
      this.vy *= cfg.jumpCutMultiplier;
      this.jumpHeld = false;
    }
    if (this.vy >= 0) this.jumpHeld = false;

    // ---- Gravity ----
    this.vy = Math.min(this.vy + cfg.gravity * dt, cfg.maxFallSpeed);

    // ---- Goo slow (sample where we stand before moving) ----
    let speedCap = cfg.runSpeed;

    const res = map.move(
      this.x, this.y, this.w, this.h,
      clamp(this.vx, -speedCap, speedCap), this.vy, dt,
      { breakCaps: state.breakCaps(), dropThrough: input.downHeld }
    );

    for (const hit of res.overlapping) {
      if (hit.def.slow) {
        ev.inGoo = true;
        speedCap = cfg.runSpeed * hit.def.slow;
        // Re-apply cap immediately so goo actually feels sticky.
        this.vx = clamp(this.vx, -speedCap, speedCap);
      }
      if (hit.def.damage && !this.invulnerable) {
        ev.spikeDamage = Math.max(ev.spikeDamage, hit.def.damage);
      }
    }

    this.x = res.x;
    this.y = res.y;
    this.vx = clamp(res.vx, -speedCap, speedCap);
    const fallSpeed = this.vy;
    this.vy = res.vy;
    ev.broke = res.broken;

    if (res.bounced && res.bounced.def.bounce) {
      this.vy = -res.bounced.def.bounce;
      ev.bounced = res.bounced;
      this.squashX = 0.6;
      this.squashY = 1.45;
    }

    if (res.onGround && !this.wasOnGround) {
      ev.landed = true;
      ev.landSpeed = fallSpeed;
      const hard = clamp(fallSpeed / 500, 0, 1);
      this.squashX = 1 + 0.45 * hard;
      this.squashY = 1 - 0.4 * hard;
    }
    this.onGround = res.onGround;
    this.wasOnGround = res.onGround;

    // ---- Squash recovery + blink ----
    this.squashX = lerp(this.squashX, 1, 1 - Math.pow(0.0001, dt));
    this.squashY = lerp(this.squashY, 1, 1 - Math.pow(0.0001, dt));
    if (now > this.blinkAt) {
      this.blinking = true;
      if (now > this.blinkAt + 120) {
        this.blinking = false;
        this.blinkAt = now + 1800 + Math.random() * 2600;
      }
    }

    return ev;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.hiddenIn !== null) return;
    const flicker = this.invulnerable && Math.floor(performance.now() / 80) % 2 === 0;
    if (flicker) ctx.globalAlpha = 0.35;
    drawBlob(
      ctx, this.x, this.y, this.w, this.h,
      this.cfg.color, this.cfg.eyeColor, this.facing,
      { squashX: this.squashX, squashY: this.squashY, blink: this.blinking }
    );
    ctx.globalAlpha = 1;
  }
}
