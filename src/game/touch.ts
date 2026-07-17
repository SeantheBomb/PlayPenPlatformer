// On-screen touch controls. Buttons feed virtual codes into Input; taps that
// miss every button surface as UI taps (menu start, closing overlays, hotbar).
import type { Input } from "../engine/input";
import { roundRect } from "../engine/renderer";

interface TouchButton {
  code: string;
  label: string;
  x: number; // logical 640x360 coords, center
  y: number;
  r: number;
}

const BUTTONS: TouchButton[] = [
  { code: "TouchLeft", label: "◀", x: 36, y: 314, r: 26 },
  { code: "TouchRight", label: "▶", x: 102, y: 314, r: 26 },
  { code: "TouchDown", label: "▼", x: 69, y: 268, r: 15 },
  { code: "TouchJump", label: "A", x: 602, y: 314, r: 30 },
  { code: "TouchUse", label: "F", x: 542, y: 330, r: 20 },
  { code: "TouchInteract", label: "E", x: 556, y: 272, r: 20 },
  { code: "TouchCraft", label: "⚒", x: 618, y: 96, r: 14 },
  { code: "TouchPause", label: "❚❚", x: 618, y: 56, r: 14 },
];

export class TouchControls {
  /** Called with a logical-space tap that didn't hit any button. */
  onTap?: (x: number, y: number) => void;
  private touchToCode = new Map<number, string>();
  private tapStart = new Map<number, { x: number; y: number; at: number }>();

  constructor(
    private canvas: HTMLCanvasElement,
    private input: Input,
    private toLogical: (clientX: number, clientY: number) => { x: number; y: number },
    private isCaptured: () => boolean = () => false
  ) {
    const opts = { passive: false } as AddEventListenerOptions;
    canvas.addEventListener("touchstart", (e) => this.onStart(e), opts);
    canvas.addEventListener("touchmove", (e) => this.onMove(e), opts);
    canvas.addEventListener("touchend", (e) => this.onEnd(e), opts);
    canvas.addEventListener("touchcancel", (e) => this.onEnd(e), opts);
  }

  private buttonAt(x: number, y: number): TouchButton | null {
    for (const b of BUTTONS) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d <= b.r * 1.35) return b; // generous hit area
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
      // Only release if no other finger holds the same button
      this.touchToCode.delete(id);
      if (![...this.touchToCode.values()].includes(code)) {
        this.input.setVirtual(code, false);
      }
    }
  }

  private onStart(e: TouchEvent): void {
    e.preventDefault();
    if (this.isCaptured()) return; // another surface (craft UI) owns input
    for (const t of Array.from(e.changedTouches)) {
      const p = this.toLogical(t.clientX, t.clientY);
      const btn = this.buttonAt(p.x, p.y);
      if (btn) {
        this.press(t.identifier, btn.code);
      } else {
        this.tapStart.set(t.identifier, { x: p.x, y: p.y, at: performance.now() });
      }
      this.input.setVirtual("TouchAny", true);
      this.input.setVirtual("TouchAny", false);
    }
  }

  private onMove(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (!this.touchToCode.has(t.identifier)) continue; // taps don't drag
      const p = this.toLogical(t.clientX, t.clientY);
      const btn = this.buttonAt(p.x, p.y);
      const current = this.touchToCode.get(t.identifier);
      if (btn?.code !== current) {
        this.release(t.identifier);
        if (btn) this.press(t.identifier, btn.code); // slide ◀ -> ▶ works
      }
    }
  }

  private onEnd(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      this.release(t.identifier);
      const start = this.tapStart.get(t.identifier);
      this.tapStart.delete(t.identifier);
      if (start && performance.now() - start.at < 400) {
        this.onTap?.(start.x, start.y);
      }
    }
  }

  /** Draw the control overlay (call while playing, touch scheme active). */
  draw(ctx: CanvasRenderingContext2D): void {
    for (const b of BUTTONS) {
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
