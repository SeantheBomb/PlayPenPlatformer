// Player controller. All feel numbers come from content/game.json.
import type { GameConfig } from "../data/types";
import type { Input } from "../engine/input";
import { TileMap, type TileHit } from "../engine/tilemap";
import { clamp, lerp } from "../engine/math";
import { drawBlob } from "../engine/renderer";
import { simNow } from "../engine/simclock";
import type { RunState } from "./state";

export interface PlayerFrameEvents {
  jumped: boolean;
  landed: boolean;
  landSpeed: number;
  bounced?: TileHit;
  spikeDamage: number;
  inLiquidOrGoo: boolean;
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

  swingUntil = 0; // swing-tool animation window
  private onIce = false; // standing on a slippery tile last frame
  private coyoteUntil = 0;
  private jumpBufferedUntil = 0;
  private jumpHeld = false;
  private wasOnGround = false;
  // Juice
  squashX = 1;
  squashY = 1;
  private blinkAt = simNow() + 2000;
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
    return simNow() < this.invulnUntil || this.hiddenIn !== null;
  }

  hurt(fromX: number, invulnMs: number): void {
    this.invulnUntil = simNow() + invulnMs;
    this.vx = Math.sign(this.centerX - fromX || 1) * this.cfg.knockbackX;
    this.vy = -this.cfg.knockbackY;
  }

  update(dt: number, input: Input, map: TileMap, state: RunState): PlayerFrameEvents {
    const cfg = this.cfg;
    const now = simNow();
    const ev: PlayerFrameEvents = {
      jumped: false, landed: false, landSpeed: 0,
      spikeDamage: 0, inLiquidOrGoo: false,
    };

    if (this.hiddenIn !== null) {
      // Fully stowed in a locker: no physics.
      this.vx = 0;
      this.vy = 0;
      return ev;
    }

    // ---- Horizontal intent (ice makes everything mushy) ----
    const want = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (want !== 0) this.facing = want;
    const iceAccel = this.onIce && this.onGround ? 0.45 : 1;
    const iceFriction = this.onIce && this.onGround ? 0.1 : 1;
    const control = this.onGround ? 1 : cfg.airControl;
    if (want !== 0) {
      this.vx += want * cfg.acceleration * control * iceAccel * dt;
    } else {
      const f = cfg.friction * control * iceFriction * dt;
      if (Math.abs(this.vx) <= f) this.vx = 0;
      else this.vx -= Math.sign(this.vx) * f;
    }

    // ---- Jump: buffer + coyote + variable height ----
    if (this.onGround) this.coyoteUntil = now + cfg.coyoteTimeMs;
    if (input.jumpPressed) this.jumpBufferedUntil = now + cfg.jumpBufferMs;
    if (now < this.jumpBufferedUntil && now < this.coyoteUntil) {
      this.vy = -cfg.jumpVelocity;
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
      { dropThrough: input.downHeld }
    );

    for (const hit of res.overlapping) {
      const mult = hit.def.slow ?? hit.def.wade;
      if (mult) {
        ev.inLiquidOrGoo = true;
        speedCap = cfg.runSpeed * mult;
        // Re-apply cap immediately so goo/water actually drag.
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

    // Slippery check for next frame's friction
    if (res.onGround) {
      const below = map.at(
        Math.floor(this.centerX / 16),
        Math.floor((this.y + this.h + 2) / 16)
      );
      this.onIce = !!below?.slippery;
    } else {
      this.onIce = false;
    }

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

  /** Kick off the swing-tool visual (breaking logic lives in Game). */
  swing(): void {
    this.swingUntil = simNow() + 160;
    this.squashX = 1.18;
    this.squashY = 0.88;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.hiddenIn !== null) return;
    const flicker = this.invulnerable && Math.floor(simNow() / 80) % 2 === 0;
    if (flicker) ctx.globalAlpha = 0.35;
    drawBlob(
      ctx, this.x, this.y, this.w, this.h,
      this.cfg.color, this.cfg.eyeColor, this.facing,
      { squashX: this.squashX, squashY: this.squashY, blink: this.blinking, sprite: this.cfg }
    );
    // Swing swoosh arc in front of the player
    const swingLeft = this.swingUntil - simNow();
    if (swingLeft > 0) {
      const t = 1 - swingLeft / 160; // 0..1 through the swing
      ctx.save();
      ctx.translate(this.centerX, this.centerY);
      ctx.scale(this.facing >= 0 ? 1 : -1, 1);
      ctx.strokeStyle = `rgba(255,255,255,${0.8 - t * 0.7})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(4, 0, 14 + t * 4, -Math.PI / 2 + t * 0.8, 0.6 + t * 0.8);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
