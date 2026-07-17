// Mobile touch controls v4 (revised with Sean 2026-07-17):
//   · discrete ◀ ▶ movement buttons + small ▼ (drop through) bottom-left
//   · discrete E (interact) and F (use) buttons + big A (jump) bottom-right —
//     E lights up gold with a context verb when something is in reach,
//     F shows the held item's icon
//   · a prominent branded CRAFT toggle and a small pause chip, top-right
//   · minimal overlay: low opacity, fading further while moving
// Sizes are CSS px converted to canvas px so buttons keep a physical size.
//
// Input-routing rule that fixes the "hold to keep craft open" bug: a touch
// that begins on a button STAYS a button interaction until it ends, no matter
// what overlay opens mid-press — its release never leaks into overlay taps.
import type { ItemDef } from "../data/types";
import type { Input } from "../engine/input";
import { drawItemIcon } from "../engine/renderer";

export type OverlayMode = "none" | "craft" | "other";

/** Context for decorating the E/F buttons (game recomputes each frame). */
export interface SmartContext {
  kind: "interact" | "use" | "none";
  label: string;
  item?: ItemDef | null;
}

interface Viewport {
  ox: number;
  oy: number;
  cw: number;
  ch: number;
  pxRatio: number;
}

export class TouchControls {
  /** Called with a logical-space tap that didn't hit any control. */
  onTap?: (x: number, y: number) => void;
  /** Called while the craft workbench owns touch input. Coords are logical. */
  onCraftPointer?: (phase: "down" | "move" | "up", x: number, y: number) => void;
  /** Interact-context for the E button label; held item for the F button. */
  smartContext: SmartContext = { kind: "none", label: "" };

  private vp: Viewport = { ox: 0, oy: 0, cw: 640, ch: 360, pxRatio: 1 };
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
    this.vp = { ox, oy, cw, ch, pxRatio: rect.width > 0 ? cw / rect.width : 1 };
  }

  private px(cssPx: number): number {
    return cssPx * this.vp.pxRatio;
  }

  // ---------- button geometry (canvas-pixel space) ----------

  private buttons(): { code: string; x: number; y: number; r: number }[] {
    const { cw, ch } = this.vp;
    const p = (n: number) => this.px(n);
    return [
      // Left thumb: movement
      { code: "TouchLeft", x: p(52), y: ch - p(56), r: p(30) },
      { code: "TouchRight", x: p(128), y: ch - p(56), r: p(30) },
      { code: "TouchDown", x: p(90), y: ch - p(112), r: p(17) },
      // Right thumb: jump hugs the corner; E and F arc inward
      { code: "TouchJump", x: cw - p(50), y: ch - p(56), r: p(33) },
      { code: "TouchUse", x: cw - p(126), y: ch - p(44), r: p(25) },
      { code: "TouchInteract", x: cw - p(110), y: ch - p(112), r: p(25) },
      // Top-right: the workbench is core loop — prominent; pause is a chip
      { code: "TouchCraft", x: cw - p(44), y: p(42), r: p(24) },
      { code: "TouchPause", x: cw - p(100), y: p(36), r: p(12) },
    ];
  }

  private buttonAt(x: number, y: number): { code: string } | null {
    for (const b of this.buttons()) {
      if (Math.hypot(x - b.x, y - b.y) <= b.r * 1.25) return b;
    }
    return null;
  }

  // ---------- touch handling ----------

  private press(id: number, code: string): void {
    this.buttonTouches.set(id, code);
    this.input.setVirtual(code, true);
  }

  private releaseButton(id: number): boolean {
    const code = this.buttonTouches.get(id);
    if (!code) return false;
    this.buttonTouches.delete(id);
    if (![...this.buttonTouches.values()].includes(code)) {
      this.input.setVirtual(code, false);
    }
    return true;
  }

  private onStart(e: TouchEvent): void {
    e.preventDefault();
    this.input.setVirtual("TouchAny", true);
    this.input.setVirtual("TouchAny", false);
    const mode = this.overlayMode();
    for (const t of Array.from(e.changedTouches)) {
      const sp = this.toCanvasPixel(t.clientX, t.clientY);
      if (mode === "craft") {
        // The CRAFT button still works as a toggle while the menu is open.
        const btn = this.buttonAt(sp.x, sp.y);
        if (btn?.code === "TouchCraft") {
          this.press(t.identifier, btn.code);
        } else {
          const p = this.toLogical(t.clientX, t.clientY);
          this.onCraftPointer?.("down", p.x, p.y);
        }
        continue;
      }
      if (mode === "other") {
        const p = this.toLogical(t.clientX, t.clientY);
        this.tapStart.set(t.identifier, { x: p.x, y: p.y, at: performance.now() });
        continue;
      }
      const btn = this.buttonAt(sp.x, sp.y);
      if (btn) {
        this.press(t.identifier, btn.code);
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
      // Button touches remain button touches — allow sliding ◀ <-> ▶.
      const current = this.buttonTouches.get(t.identifier);
      if (current) {
        const sp = this.toCanvasPixel(t.clientX, t.clientY);
        const now = this.buttonAt(sp.x, sp.y)?.code;
        if (now !== current) {
          this.releaseButton(t.identifier);
          const movement = now === "TouchLeft" || now === "TouchRight" || now === "TouchDown";
          if (now && movement) this.press(t.identifier, now);
        }
        continue;
      }
      if (mode === "craft") {
        const p = this.toLogical(t.clientX, t.clientY);
        this.onCraftPointer?.("move", p.x, p.y);
      }
    }
  }

  private onEnd(e: TouchEvent): void {
    e.preventDefault();
    const mode = this.overlayMode();
    for (const t of Array.from(e.changedTouches)) {
      // Releasing a button never leaks into overlay/tap handling.
      if (this.releaseButton(t.identifier)) continue;
      if (mode === "craft") {
        const p = this.toLogical(t.clientX, t.clientY);
        this.onCraftPointer?.("up", p.x, p.y);
        continue;
      }
      const start = this.tapStart.get(t.identifier);
      this.tapStart.delete(t.identifier);
      if (start && performance.now() - start.at < 400) {
        this.onTap?.(start.x, start.y);
      }
    }
  }

  // ---------- drawing (raw canvas-pixel space, identity transform) ----------

  draw(ctx: CanvasRenderingContext2D): void {
    const held = new Set(this.buttonTouches.values());
    const moving = held.has("TouchLeft") || held.has("TouchRight");
    const baseAlpha = moving ? 0.16 : 0.28;

    for (const b of this.buttons()) {
      const isHeld = held.has(b.code);
      switch (b.code) {
        case "TouchLeft":
        case "TouchRight":
        case "TouchDown": {
          const arrows: Record<string, string> = {
            TouchLeft: "◀", TouchRight: "▶", TouchDown: "▼",
          };
          this.circle(ctx, b.x, b.y, b.r, "#e8e2f4", isHeld ? 0.5 : baseAlpha);
          this.label(ctx, arrows[b.code], b.x, b.y, b.r * 0.62, "#12101c", isHeld ? 0.9 : 0.6);
          break;
        }
        case "TouchJump": {
          this.circle(ctx, b.x, b.y, b.r, "#e8e2f4", isHeld ? 0.5 : baseAlpha);
          this.label(ctx, "A", b.x, b.y, b.r * 0.8, "#12101c", isHeld ? 0.9 : 0.6);
          break;
        }
        case "TouchInteract": {
          const c = this.smartContext;
          const active = c.kind === "interact";
          this.circle(ctx, b.x, b.y, b.r, active ? "#ffd166" : "#e8e2f4",
            isHeld ? 0.55 : active ? baseAlpha + 0.16 : baseAlpha * 0.8);
          this.label(ctx, active ? c.label : "E",
            b.x, b.y, active ? b.r * 0.4 : b.r * 0.62,
            "#12101c", isHeld ? 0.9 : 0.7);
          break;
        }
        case "TouchUse": {
          const item = this.smartContext.item;
          this.circle(ctx, b.x, b.y, b.r, "#e8e2f4", isHeld ? 0.5 : baseAlpha);
          if (item) {
            ctx.globalAlpha = isHeld ? 0.95 : 0.7;
            drawItemIcon(ctx, item, b.x, b.y, this.px(1.4));
            ctx.globalAlpha = 1;
          } else {
            this.label(ctx, "F", b.x, b.y, b.r * 0.62, "#12101c", isHeld ? 0.9 : 0.6);
          }
          break;
        }
        case "TouchCraft": {
          this.circle(ctx, b.x, b.y, b.r, "#ffd166", isHeld ? 0.85 : 0.55);
          ctx.globalAlpha = isHeld ? 1 : 0.85;
          ctx.strokeStyle = "#12101c";
          ctx.lineWidth = this.px(2);
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
          this.circle(ctx, b.x, b.y, b.r, "#e8e2f4", isHeld ? 0.5 : 0.2);
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
