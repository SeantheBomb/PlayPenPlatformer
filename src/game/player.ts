// Player controller. All feel numbers come from content/game.json.
import type { GameConfig } from "../data/types";
import type { Input } from "../engine/input";
import { TILE, TileMap, type TileHit } from "../engine/tilemap";
import { clamp, lerp } from "../engine/math";
import { drawBlob } from "../engine/renderer";
import { simNow } from "../engine/simclock";
import type { RunState } from "./state";
import type { GooFace } from "./room";

/** Looks up whether (tx,ty)'s given face carries a sticky-bomb goo splat —
 *  supplied by RoomRuntime, since goo overlays live there, not on TileMap. */
export type GooLookup = (tx: number, ty: number, face: GooFace) => boolean;

export interface PlayerSnapshot {
  x: number; y: number; vx: number; vy: number; facing: number;
  invulnUntil: number; hiddenIn: number | null; swimState: "none" | "surface" | "under";
  climbState: "none" | "wall" | "ceiling"; climbFacing: -1 | 1; climbTimeLeft: number;
}

export interface PlayerFrameEvents {
  jumped: boolean;
  landed: boolean;
  landSpeed: number;
  bounced?: TileHit;
  spikeDamage: number;
  /** Center-x of a repelling hazard tile overlapped this frame — knockback
   *  should push away from HERE, not from the player's own center. */
  repelFromX?: number;
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
  /** Deep-water (≥3 tiles) state this frame: "under" drains air, "surface"
   *  allows a full normal jump out. Shallow water never engages this. */
  swimState: "none" | "surface" | "under" = "none";
  /** BOTW-style stamina climb on goo-covered surfaces. "wall": climbFacing
   *  is which side the wall is on (-1 = wall to the left, 1 = wall to the
   *  right). "ceiling": climbFacing is unused. */
  climbState: "none" | "wall" | "ceiling" = "none";
  climbFacing: -1 | 1 = 1;
  climbTimeLeft = 0;

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

  /** Heartbeat ground truth — physics state, not the sub-frame juice/input
   *  timers (coyote/jump-buffer/blink/squash): those windows are at most a
   *  few frames long and will have already resolved by the time a heartbeat
   *  (seconds apart) is captured or applied. */
  snapshot(): PlayerSnapshot {
    return {
      x: this.x, y: this.y, vx: this.vx, vy: this.vy, facing: this.facing,
      invulnUntil: this.invulnUntil, hiddenIn: this.hiddenIn, swimState: this.swimState,
      climbState: this.climbState, climbFacing: this.climbFacing, climbTimeLeft: this.climbTimeLeft,
    };
  }

  restore(snap: PlayerSnapshot): void {
    this.x = snap.x; this.y = snap.y; this.vx = snap.vx; this.vy = snap.vy;
    this.facing = snap.facing;
    this.invulnUntil = snap.invulnUntil;
    this.hiddenIn = snap.hiddenIn;
    this.swimState = snap.swimState;
    this.climbState = snap.climbState;
    this.climbFacing = snap.climbFacing;
    this.climbTimeLeft = snap.climbTimeLeft;
  }

  /** Is (tx,ty)'s face touching the player's left/right edge goo-covered?
   *  dir -1 checks the wall just left of the player, +1 just right. */
  private touchingWallGoo(gooAt: GooLookup, dir: -1 | 1): boolean {
    const tx = dir < 0 ? Math.floor((this.x - 1) / TILE) : Math.floor((this.x + this.w + 1) / TILE);
    const face: GooFace = dir < 0 ? "right" : "left";
    const topTy = Math.floor(this.y / TILE);
    const botTy = Math.floor((this.y + this.h - 1) / TILE);
    return gooAt(tx, topTy, face) || gooAt(tx, botTy, face);
  }

  private touchingCeilingGoo(gooAt: GooLookup): boolean {
    const ty = Math.floor((this.y - 1) / TILE);
    const leftTx = Math.floor(this.x / TILE);
    const rightTx = Math.floor((this.x + this.w - 1) / TILE);
    return gooAt(leftTx, ty, "bottom") || gooAt(rightTx, ty, "bottom");
  }

  get invulnerable() {
    return simNow() < this.invulnUntil || this.hiddenIn !== null;
  }

  /**
   * Deep-water detection: the body sits in a column of water-style tiles at
   * least 3 tall ("deeper than two tiles" — shallow pools keep plain wading).
   * "surface" = head within a few px of the waterline (jump leaps out);
   * "under" = properly submerged (strokes, sinking, air drain).
   * Style "water" only — waterfalls stay pass-through, not swimmable.
   */
  private waterStateAt(map: TileMap): "none" | "surface" | "under" {
    const cx = Math.floor(this.centerX / 16);
    const midY = Math.floor((this.y + this.h * 0.6) / 16);
    const isWater = (tx: number, ty: number) => map.at(tx, ty)?.style === "water";
    // Grates are transparent to fluid everywhere else in the sim — a body
    // touching or resting on one shouldn't "surface" just because the
    // grate's own tile isn't itself styled water; scan through it the same
    // way, and still require real water somewhere in the resulting column.
    const isPassable = (tx: number, ty: number) => {
      const t = map.at(tx, ty);
      return t?.style === "water" || t?.style === "platform";
    };
    if (!isPassable(cx, midY)) return "none";
    let top = midY;
    while (top > 0 && isPassable(cx, top - 1)) top--;
    let bot = midY;
    while (isPassable(cx, bot + 1)) bot++;
    if (bot - top + 1 < 3) return "none";
    let hasWater = false;
    for (let ty = top; ty <= bot && !hasWater; ty++) hasWater = isWater(cx, ty);
    if (!hasWater) return "none";
    return this.y - top * 16 > 4 ? "under" : "surface";
  }

  hurt(fromX: number, invulnMs: number): void {
    this.invulnUntil = simNow() + invulnMs;
    this.vx = Math.sign(this.centerX - fromX || 1) * this.cfg.knockbackX;
    this.vy = -this.cfg.knockbackY;
  }

  update(dt: number, input: Input, map: TileMap, state: RunState, gooAt: GooLookup): PlayerFrameEvents {
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

    this.swimState = this.waterStateAt(map);
    const swim = cfg.swim;
    const under = this.swimState === "under";
    const inDeepWater = this.swimState !== "none";

    // ---- Goo climb (sticky bomb): engage on movement into a goo surface,
    // axis-lock movement to it, dismount on movement away or timeout. ----
    const climb = cfg.climb;
    if (this.climbState === "none" && !inDeepWater) {
      if (input.left && this.touchingWallGoo(gooAt, -1)) {
        this.climbState = "wall"; this.climbFacing = -1; this.climbTimeLeft = climb.wallSeconds;
      } else if (input.right && this.touchingWallGoo(gooAt, 1)) {
        this.climbState = "wall"; this.climbFacing = 1; this.climbTimeLeft = climb.wallSeconds;
      } else if (this.vy < 0 && this.touchingCeilingGoo(gooAt)) {
        this.climbState = "ceiling"; this.climbTimeLeft = climb.ceilingSeconds;
      }
    }
    if (this.climbState !== "none") {
      const stillGoo = this.climbState === "wall"
        ? this.touchingWallGoo(gooAt, this.climbFacing)
        : this.touchingCeilingGoo(gooAt);
      const movingAway = this.climbState === "wall"
        ? (this.climbFacing < 0 ? input.right : input.left)
        : (input.downHeld || input.jumpPressed);
      this.climbTimeLeft -= dt;
      if (!stillGoo || movingAway || this.climbTimeLeft <= 0) {
        this.climbState = "none";
        this.vy = 0; // hang for a beat rather than snapping into a fall mid-frame
      } else {
        if (this.climbState === "wall") {
          const up = input.jumpDown ? 1 : (input.downHeld ? -1 : 0);
          this.vx = 0;
          this.vy = -up * climb.speed;
          this.facing = -this.climbFacing;
        } else {
          const lat = (input.right ? 1 : 0) - (input.left ? 1 : 0);
          this.vx = lat * climb.speed;
          this.vy = 0;
          if (lat !== 0) this.facing = lat;
        }
        const res = map.move(this.x, this.y, this.w, this.h, this.vx, this.vy, dt, { dropThrough: false });
        this.x = res.x;
        this.y = res.y;
        this.onGround = res.onGround;
        this.wasOnGround = res.onGround;
        return ev;
      }
    }

    // ---- Horizontal intent (ice makes everything mushy, water floaty) ----
    const want = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (want !== 0) this.facing = want;
    const iceAccel = this.onIce && this.onGround ? 0.45 : 1;
    const iceFriction = this.onIce && this.onGround ? 0.1 : 1;
    const swimAccel = inDeepWater ? swim.accelFactor : 1;
    const swimFriction = inDeepWater ? swim.frictionFactor : 1;
    const control = this.onGround || inDeepWater ? 1 : cfg.airControl;
    if (want !== 0) {
      this.vx += want * cfg.acceleration * control * iceAccel * swimAccel * dt;
    } else {
      const f = cfg.friction * control * iceFriction * swimFriction * dt;
      if (Math.abs(this.vx) <= f) this.vx = 0;
      else this.vx -= Math.sign(this.vx) * f;
    }

    // ---- Jump: buffer + coyote + variable height ----
    // At the surface of deep water the player counts as grounded for jump
    // purposes — a full-strength leap out, Mario-style.
    if (this.onGround || this.swimState === "surface") this.coyoteUntil = now + cfg.coyoteTimeMs;
    if (input.jumpPressed) this.jumpBufferedUntil = now + cfg.jumpBufferMs;
    if (under) {
      // Submerged: jump presses are swim strokes, not jumps.
      if (input.jumpPressed) {
        this.vy = -swim.stroke;
        this.jumpBufferedUntil = 0;
        ev.jumped = true;
        this.squashX = 0.85;
        this.squashY = 1.15;
      }
      if (input.jumpDown) this.vy -= swim.holdLift * dt;
    } else if (now < this.jumpBufferedUntil && now < this.coyoteUntil) {
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

    // ---- Gravity (a slow settling pull while swimming) ----
    if (inDeepWater && !this.jumpHeld) {
      this.vy = Math.min(this.vy + swim.gravity * dt, swim.maxSink);
    } else {
      this.vy = Math.min(this.vy + cfg.gravity * dt, cfg.maxFallSpeed);
    }

    // ---- Goo slow (sample where we stand before moving) ----
    let speedCap = cfg.runSpeed;

    const res = map.move(
      this.x, this.y, this.w, this.h,
      clamp(this.vx, -speedCap, speedCap), this.vy, dt,
      { dropThrough: input.downHeld }
    );

    let repelHit: TileHit | null = null;
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
      if (hit.def.repels) repelHit = hit;
    }

    this.x = res.x;
    this.y = res.y;
    this.vx = clamp(res.vx, -speedCap, speedCap);
    const fallSpeed = this.vy;
    this.vy = res.vy;

    // Repelling hazards (fire) are walls of heat, not damage floors: shove
    // the player back out every frame they overlap — invuln frames don't
    // let you tank through. Put the fire out instead.
    if (repelHit) {
      const tcx = repelHit.tx * 16 + 8;
      ev.repelFromX = tcx;
      this.vx = (Math.sign(this.centerX - tcx) || -this.facing || 1) * cfg.knockbackX;
      if (fallSpeed > 40) this.vy = -cfg.knockbackY * 0.6; // fell in — pop back up
    }

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
      {
        squashX: this.squashX, squashY: this.squashY, blink: this.blinking,
        sprite: this.cfg, sketch: this.cfg.sketch,
      }
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
