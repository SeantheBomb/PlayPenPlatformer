// On-screen touch controls. Buttons live in the letterbox margins (screen-
// pixel space) when the device has room for them, so gameplay isn't covered;
// they fall back to overlaying the bottom of the game view on narrow
// devices. Any modal overlay (craft, dialogs, pause...) takes over touch
// input entirely instead of it being swallowed by invisible button hitboxes.
import type { Input } from "../engine/input";

export type OverlayMode = "none" | "craft" | "other";

interface TouchButton {
  code: string;
  label: string;
  x: number; // screen-pixel (canvas) coords, center
  y: number;
  r: number;
}

interface Viewport {
  scale: number;
  ox: number;
  oy: number;
  cw: number;
  ch: number;
}

// Fallback layout, defined in logical 640x360 units (original design),
// converted to screen-pixel space when there's no room in the margins.
const FALLBACK: [code: string, label: string, lx: number, ly: number, lr: number][] = [
  ["TouchLeft", "◀", 36, 314, 26],
  ["TouchRight", "▶", 102, 314, 26],
  ["TouchDown", "▼", 69, 268, 15],
  ["TouchJump", "A", 602, 314, 30],
  ["TouchUse", "F", 542, 330, 20],
  ["TouchInteract", "E", 556, 272, 20],
  ["TouchCraft", "⚒", 618, 96, 14],
  ["TouchPause", "❚❚", 618, 56, 14],
];

const MARGIN_THRESHOLD = 90; // screen px; below this, fall back to overlay layout

export class TouchControls {
  /** Called with a logical-space tap that didn't hit any button. */
  onTap?: (x: number, y: number) => void;
  /** Called while the craft workbench owns touch input. Coords are logical. */
  onCraftPointer?: (phase: "down" | "move" | "up", x: number, y: number) => void;

  private touchToCode = new Map<number, string>();
  private tapStart = new Map<number, { x: number; y: number; at: number }>();
  private viewport: Viewport = { scale: 1, ox: 0, oy: 0, cw: 640, ch: 360 };

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

  setViewport(scale: number, ox: number, oy: number, cw: number, ch: number): void {
    this.viewport = { scale, ox, oy, cw, ch };
  }

  private buttons(): TouchButton[] {
    const { scale, ox, oy, cw, ch } = this.viewport;
    const leftMargin = ox;
    const rightMargin = cw - (ox + 640 * scale);

    if (leftMargin >= MARGIN_THRESHOLD && rightMargin >= MARGIN_THRESHOLD) {
      const midY = oy + (360 * scale) / 2;
      const lr = Math.min(34, leftMargin * 0.3);
      const rr = Math.min(36, rightMargin * 0.28);
      return [
        { code: "TouchLeft", label: "◀", x: leftMargin * 0.32, y: midY - lr * 1.3, r: lr },
        { code: "TouchRight", label: "▶", x: leftMargin * 0.68, y: midY - lr * 1.3, r: lr },
        { code: "TouchDown", label: "▼", x: leftMargin * 0.5, y: midY + lr * 1.4, r: lr * 0.6 },
        { code: "TouchJump", label: "A", x: cw - rightMargin * 0.32, y: midY, r: rr },
        { code: "TouchUse", label: "F", x: cw - rightMargin * 0.68, y: midY + rr * 1.3, r: rr * 0.7 },
        { code: "TouchInteract", label: "E", x: cw - rightMargin * 0.68, y: midY - rr * 1.3, r: rr * 0.7 },
        { code: "TouchCraft", label: "⚒", x: cw - rightMargin * 0.5, y: oy + 26, r: Math.min(16, rightMargin * 0.14) },
        { code: "TouchPause", label: "❚❚", x: cw - rightMargin * 0.5, y: oy + 62, r: Math.min(16, rightMargin * 0.14) },
      ];
    }

    // Fallback: original overlay-on-game-view layout, scaled into screen space.
    return FALLBACK.map(([code, label, lx, ly, lr]) => ({
      code, label,
      x: lx * scale + ox, y: ly * scale + oy, r: lr * scale,
    }));
  }

  private buttonAt(x: number, y: number): TouchButton | null {
    for (const b of this.buttons()) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d <= b.r * 1.35) return b;
    }
    return null;
  }

  private press(id: number, code: string): void {
    this.release(id);
    this.touchToCode.set(id, code);
    this.input.setVirtual(code, true);
  }

  private release(id: number): void {
    const code = this.touchToCode.get(id);
    if (code) {
      this.touchToCode.delete(id);
      if (![...this.touchToCode.values()].includes(code)) {
        this.input.setVirtual(code, false);
      }
    }
  }

  private onStart(e: TouchEvent): void {
    e.preventDefault();
    // Any touch at all marks the scheme as touch (so the controls appear),
    // even when the touch itself is just a tap on empty space.
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
        // A modal overlay owns the screen — never let it double as a button
        // press just because a (now-hidden) button hitbox happens to be there.
        const p = this.toLogical(t.clientX, t.clientY);
        this.tapStart.set(t.identifier, { x: p.x, y: p.y, at: performance.now() });
        continue;
      }
      const sp = this.toCanvasPixel(t.clientX, t.clientY);
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
      if (mode === "craft") {
        const p = this.toLogical(t.clientX, t.clientY);
        this.onCraftPointer?.("move", p.x, p.y);
        continue;
      }
      if (mode === "other") continue; // taps don't drag in modal overlays
      if (!this.touchToCode.has(t.identifier)) continue; // taps don't drag
      const sp = this.toCanvasPixel(t.clientX, t.clientY);
      const btn = this.buttonAt(sp.x, sp.y);
      const current = this.touchToCode.get(t.identifier);
      if (btn?.code !== current) {
        this.release(t.identifier);
        if (btn) this.press(t.identifier, btn.code); // slide ◀ -> ▶ works
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
      this.release(t.identifier);
      const start = this.tapStart.get(t.identifier);
      this.tapStart.delete(t.identifier);
      if (start && performance.now() - start.at < 400) {
        this.onTap?.(start.x, start.y);
      }
    }
  }

  /** Draw the control overlay in raw screen-pixel space (call outside any
   * logical-view transform, only while playing with no overlay active). */
  draw(ctx: CanvasRenderingContext2D): void {
    for (const b of this.buttons()) {
      const held = [...this.touchToCode.values()].includes(b.code);
      ctx.globalAlpha = held ? 0.55 : 0.28;
      ctx.fillStyle = "#e8e2f4";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = held ? 0.9 : 0.55;
      ctx.fillStyle = "#12101c";
      ctx.font = `bold ${Math.max(10, b.r * 0.7)}px monospace`;
      const tw = ctx.measureText(b.label).width;
      ctx.fillText(b.label, b.x - tw / 2, b.y + b.r * 0.26);
      ctx.globalAlpha = 1;
    }
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
