// Mobile touch controls v3 — designed with Sean 2026-07-17:
//   · floating joystick: touch anywhere on the left half, stick appears under
//     the thumb; drag to move, pull down to drop through platforms
//   · two primary buttons: A (jump) and a SMART action that morphs between
//     "interact" (near notes/doors/NPCs/lockers) and "use held item"
//   · a prominent branded CRAFT button (core loop!) and a small pause chip
//   · minimal overlay: everything low-opacity, fading further while moving
// All geometry is computed in canvas-pixel space from CSS-px design sizes so
// buttons are the same physical size on every screen density.
import type { ItemDef } from "../data/types";
import type { Input } from "../engine/input";
import { drawItemIcon } from "../engine/renderer";

export type OverlayMode = "none" | "craft" | "other";

/** What the smart action button would do right now (game recomputes each frame). */
export interface SmartContext {
  kind: "interact" | "use" | "none";
  label: string;        // short verb: "read", "talk", "hide", "use"...
  item?: ItemDef | null; // held item to draw when kind === "use"
}

interface Viewport {
  ox: number;
  oy: number;
  cw: number;
  ch: number;
  pxRatio: number; // canvas pixels per CSS pixel
}

const STICK_RADIUS_CSS = 40;   // joystick base radius
const STICK_DEAD_CSS = 10;     // thumb wiggle before movement registers
const STICK_DROP_CSS = 30;     // pull this far down to drop through platforms

export class TouchControls {
  /** Called with a logical-space tap that didn't hit any control. */
  onTap?: (x: number, y: number) => void;
  /** Called while the craft workbench owns touch input. Coords are logical. */
  onCraftPointer?: (phase: "down" | "move" | "up", x: number, y: number) => void;
  /** The game sets this each frame so the smart button can label itself. */
  smartContext: SmartContext = { kind: "none", label: "" };

  private vp: Viewport = { ox: 0, oy: 0, cw: 640, ch: 360, pxRatio: 1 };
  private stickTouchId: number | null = null;
  private stickAnchor = { x: 0, y: 0 };  // canvas px
  private stickPos = { x: 0, y: 0 };
  private buttonTouches = new Map<number, string>(); // touch id -> button code
  private tapStart = new Map<number, { x: number; y: number; at: number }>();

  constructor(
    private canvas: HTMLCanvasElement,
    private input: Input,
    private toLogical: (clientX: number, clientY: number) => { x: number; y: number },
    private toCanvasPixel: (clientX: number, clientY: number) => { x: number; y: number },
    private overlayMode: () => OverlayMode = () => "none"
  ) {
    const opts = { passive: false } as AddEventListenerOptions;
    canvas.addEventListener("touchstart", (e) => this.onStart(e), opts);
    canvas.addEventListener("touchmove", (e) => this.onMove(e), opts);
    canvas.addEventListener("touchend", (e) => this.onEnd(e), opts);
    canvas.addEventListener("touchcancel", (e) => this.onEnd(e), opts);
  }

  setViewport(_scale: number, ox: number, oy: number, cw: number, ch: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.vp = {
      ox, oy, cw, ch,
      pxRatio: rect.width > 0 ? cw / rect.width : 1,
    };
  }

  /** cssPx -> canvas px, so controls are a consistent physical size. */
  private px(cssPx: number): number {
    return cssPx * this.vp.pxRatio;
  }

  // ---------- button geometry (canvas-pixel space) ----------

  private buttons(): { code: string; x: number; y: number; r: number }[] {
    const { cw, ch } = this.vp;
    const p = (n: number) => this.px(n);
    return [
      // Right-thumb arc: jump hugs the corner, smart action inward of it.
      { code: "TouchJump", x: cw - p(52), y: ch - p(58), r: p(34) },
      { code: "TouchSmart", x: cw - p(132), y: ch - p(44), r: p(27) },
      // The workbench is core loop — prominent, branded, top-right.
      { code: "TouchCraft", x: cw - p(44), y: p(42), r: p(24) },
      { code: "TouchPause", x: cw - p(100), y: p(36), r: p(12) },
    ];
  }

  private buttonAt(x: number, y: number): { code: string } | null {
    for (const b of this.buttons()) {
      if (Math.hypot(x - b.x, y - b.y) <= b.r * 1.3) return b;
    }
    return null;
  }

  private inStickZone(x: number, y: number): boolean {
    // Left 45% of the screen, below the HUD band.
    return x < this.vp.cw * 0.45 && y > this.px(70);
  }

  // ---------- touch handling ----------

  private setStickVirtuals(): void {
    const dx = this.stickPos.x - this.stickAnchor.x;
    const dy = this.stickPos.y - this.stickAnchor.y;
    const dead = this.px(STICK_DEAD_CSS);
    this.input.setVirtual("TouchLeft", dx < -dead);
    this.input.setVirtual("TouchRight", dx > dead);
    this.input.setVirtual("TouchDown", dy > this.px(STICK_DROP_CSS));
  }

  private clearStick(): void {
    this.stickTouchId = null;
    this.input.setVirtual("TouchLeft", false);
    this.input.setVirtual("TouchRight", false);
    this.input.setVirtual("TouchDown", false);
  }

  private onStart(e: TouchEvent): void {
    e.preventDefault();
    // Any touch marks the scheme as touch so the controls appear.
    this.input.setVirtual("TouchAny", true);
    this.input.setVirtual("TouchAny", false);
    const mode = this.overlayMode();
    for (const t of Array.from(e.changedTouches)) {
      if (mode === "craft") {
        const p = this.toLogical(t.clientX, t.clientY);
        this.onCraftPointer?.("down", p.x, p.y);
        continue;
      }
      if (mode === "other") {
        // Modal overlays own the screen: touches are taps, never buttons.
        const p = this.toLogical(t.clientX, t.clientY);
        this.tapStart.set(t.identifier, { x: p.x, y: p.y, at: performance.now() });
        continue;
      }
      const sp = this.toCanvasPixel(t.clientX, t.clientY);
      const btn = this.buttonAt(sp.x, sp.y);
      if (btn) {
        this.buttonTouches.set(t.identifier, btn.code);
        this.input.setVirtual(btn.code, true);
      } else if (this.stickTouchId === null && this.inStickZone(sp.x, sp.y)) {
        this.stickTouchId = t.identifier;
        this.stickAnchor = { ...sp };
        this.stickPos = { ...sp };
      } else {
        const p = this.toLogical(t.clientX, t.clientY);
        this.tapStart.set(t.identifier, { x: p.x, y: p.y, at: performance.now() });
      }
    }
  }

  private onMove(e: TouchEvent): void {
    e.preventDefault();
    const mode = this.overlayMode();
    for (const t of Array.from(e.changedTouches)) {
      if (mode === "craft") {
        const p = this.toLogical(t.clientX, t.clientY);
        this.onCraftPointer?.("move", p.x, p.y);
        continue;
      }
      if (t.identifier === this.stickTouchId) {
        this.stickPos = this.toCanvasPixel(t.clientX, t.clientY);
        this.setStickVirtuals();
      }
      // Buttons are press-and-hold in place; no slide-off tracking needed for
      // jump/action since they're momentary, but release if dragged far away.
      const code = this.buttonTouches.get(t.identifier);
      if (code) {
        const sp = this.toCanvasPixel(t.clientX, t.clientY);
        const still = this.buttonAt(sp.x, sp.y)?.code === code;
        if (!still) {
          this.buttonTouches.delete(t.identifier);
          this.input.setVirtual(code, false);
        }
      }
    }
  }

  private onEnd(e: TouchEvent): void {
    e.preventDefault();
    const mode = this.overlayMode();
    for (const t of Array.from(e.changedTouches)) {
      if (mode === "craft") {
        const p = this.toLogical(t.clientX, t.clientY);
        this.onCraftPointer?.("up", p.x, p.y);
        continue;
      }
      if (t.identifier === this.stickTouchId) this.clearStick();
      const code = this.buttonTouches.get(t.identifier);
      if (code) {
        this.buttonTouches.delete(t.identifier);
        this.input.setVirtual(code, false);
      }
      const start = this.tapStart.get(t.identifier);
      this.tapStart.delete(t.identifier);
      if (start && performance.now() - start.at < 400) {
        this.onTap?.(start.x, start.y);
      }
    }
  }

  get stickActive(): boolean {
    return this.stickTouchId !== null;
  }

  // ---------- drawing (raw canvas-pixel space, identity transform) ----------

  draw(ctx: CanvasRenderingContext2D): void {
    const moving = this.stickActive;
    const baseAlpha = moving ? 0.16 : 0.28; // fade while moving

    // Floating joystick (only while touched — otherwise a faint ghost hint)
    if (this.stickActive) {
      const r = this.px(STICK_RADIUS_CSS);
      const dx = this.stickPos.x - this.stickAnchor.x;
      const dy = this.stickPos.y - this.stickAnchor.y;
      const d = Math.hypot(dx, dy) || 1;
      const clampD = Math.min(d, r * 0.72);
      const kx = this.stickAnchor.x + (dx / d) * clampD;
      const ky = this.stickAnchor.y + (dy / d) * clampD;
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "#e8e2f4";
      ctx.beginPath();
      ctx.arc(this.stickAnchor.x, this.stickAnchor.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(kx, ky, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // Ghost hint where the thumb usually rests
      const gx = this.px(72);
      const gy = this.vp.ch - this.px(64);
      ctx.globalAlpha = 0.10;
      ctx.strokeStyle = "#e8e2f4";
      ctx.lineWidth = this.px(2);
      ctx.beginPath();
      ctx.arc(gx, gy, this.px(30), 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `${this.px(9)}px monospace`;
      ctx.fillStyle = "#e8e2f4";
      const t = "drag to move";
      ctx.fillText(t, gx - ctx.measureText(t).width / 2, gy + this.px(46));
      ctx.globalAlpha = 1;
    }

    for (const b of this.buttons()) {
      const held = [...this.buttonTouches.values()].includes(b.code);
      switch (b.code) {
        case "TouchJump": {
          this.circle(ctx, b.x, b.y, b.r, "#e8e2f4", held ? 0.5 : baseAlpha);
          this.label(ctx, "A", b.x, b.y, b.r * 0.8, "#12101c", held ? 0.9 : 0.6);
          break;
        }
        case "TouchSmart": {
          const c = this.smartContext;
          const active = c.kind !== "none";
          this.circle(ctx, b.x, b.y, b.r, active ? "#ffd166" : "#e8e2f4",
            held ? 0.55 : active ? baseAlpha + 0.14 : baseAlpha);
          if (c.kind === "use" && c.item) {
            ctx.globalAlpha = held ? 0.95 : 0.75;
            drawItemIcon(ctx, c.item, b.x, b.y, this.px(1.5));
            ctx.globalAlpha = 1;
          } else {
            this.label(ctx, c.kind === "interact" ? c.label : "·",
              b.x, b.y, b.r * 0.42, "#12101c", held ? 0.9 : 0.7);
          }
          break;
        }
        case "TouchCraft": {
          // Prominent: the workbench IS the game. Branded gold, always visible.
          this.circle(ctx, b.x, b.y, b.r, "#ffd166", held ? 0.85 : 0.55);
          ctx.globalAlpha = held ? 1 : 0.85;
          ctx.strokeStyle = "#12101c";
          ctx.lineWidth = this.px(2);
          // little crossed-tools glyph
          ctx.beginPath();
          ctx.moveTo(b.x - b.r * 0.4, b.y + b.r * 0.35);
          ctx.lineTo(b.x + b.r * 0.4, b.y - b.r * 0.35);
          ctx.moveTo(b.x - b.r * 0.4, b.y - b.r * 0.35);
          ctx.lineTo(b.x + b.r * 0.4, b.y + b.r * 0.35);
          ctx.stroke();
          ctx.font = `bold ${this.px(8)}px monospace`;
          ctx.fillStyle = "#ffd166";
          const t = "CRAFT";
          ctx.fillText(t, b.x - ctx.measureText(t).width / 2, b.y + b.r + this.px(11));
          ctx.globalAlpha = 1;
          break;
        }
        case "TouchPause": {
          this.circle(ctx, b.x, b.y, b.r, "#e8e2f4", held ? 0.5 : 0.2);
          this.label(ctx, "❚❚", b.x, b.y, b.r * 0.7, "#12101c", 0.6);
          break;
        }
      }
    }
  }

  private circle(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, r: number, color: string, alpha: number
  ): void {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private label(
    ctx: CanvasRenderingContext2D,
    text: string, x: number, y: number, size: number, color: string, alpha: number
  ): void {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.max(8, size)}px monospace`;
    ctx.fillText(text, x - ctx.measureText(text).width / 2, y + size * 0.36);
    ctx.globalAlpha = 1;
  }

  /** Simple full-screen nudge when the device is held the wrong way. */
  static drawRotateHint(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    ctx.fillStyle = "rgba(8,6,14,0.88)";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = "#ffd166";
    ctx.font = "bold 16px monospace";
    const msg = "↻ rotate your device";
    ctx.fillText(msg, (viewW - ctx.measureText(msg).width) / 2, viewH / 2);
    ctx.fillStyle = "#8f87ad";
    ctx.font = "10px monospace";
    const sub = "the PlayPen is wider than it is tall";
    ctx.fillText(sub, (viewW - ctx.measureText(sub).width) / 2, viewH / 2 + 20);
  }
}

/** Rough capability check — used to decide whether to hint at touch controls. */
export function isTouchCapable(): boolean {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}
