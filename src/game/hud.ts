// In-game HUD and simple overlays. Pure drawing — state lives in Game.
import type { Content, WardenEmotion } from "../data/types";
import { drawItemIcon, drawWardenPortrait, roundRect } from "../engine/renderer";
import type { RunState } from "./state";
import type { TauntManager } from "./taunts";
import { wrapText } from "./craftui";

export interface Floaty {
  text: string;
  x: number;
  y: number;
  bornAt: number;
  color: string;
}

export function drawHearts(ctx: CanvasRenderingContext2D, health: number, max: number): void {
  for (let i = 0; i < max; i++) {
    const x = 12 + i * 16;
    const y = 12;
    ctx.fillStyle = i < health ? "#ff5470" : "#3a3049";
    ctx.beginPath();
    ctx.arc(x + 3, y + 3, 3.4, 0, Math.PI * 2);
    ctx.arc(x + 9, y + 3, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 0.5, y + 4.5);
    ctx.lineTo(x + 6, y + 12);
    ctx.lineTo(x + 12.5, y + 4.5);
    ctx.closePath();
    ctx.fill();
  }
}

export function drawToolbelt(
  ctx: CanvasRenderingContext2D, state: RunState, viewW: number
): void {
  // Passive tools only — anything usable lives in the hotbar instead.
  const tools = state.ownedTools().filter((t) => !t.useMode);
  tools.forEach((t, i) => {
    const x = viewW - 24 - i * 22;
    ctx.fillStyle = "rgba(28,24,40,0.85)";
    roundRect(ctx, x - 10, 8, 20, 20, 4);
    ctx.fill();
    drawItemIcon(ctx, t, x, 18, 1.1);
  });
}

export function drawHotbar(
  ctx: CanvasRenderingContext2D, state: RunState, viewH: number,
  hint = "Q cycle · F use"
): void {
  const cons = state.usableItems();
  if (cons.length === 0) return;
  const sel = Math.min(state.selectedConsumable, cons.length - 1);
  cons.forEach((c, i) => {
    const x = 14 + i * 26;
    const y = viewH - 34;
    ctx.fillStyle = i === sel ? "rgba(61,53,86,0.95)" : "rgba(28,24,40,0.85)";
    roundRect(ctx, x, y, 22, 22, 4);
    ctx.fill();
    if (i === sel) {
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    drawItemIcon(ctx, c, x + 11, y + 10, 1.1);
    if (c.kind === "consumable") {
      ctx.fillStyle = "#ffd166";
      ctx.font = "8px monospace";
      ctx.fillText(String(state.count(c.id)), x + 14, y + 20);
    }
  });
  ctx.fillStyle = "#8f87ad";
  ctx.font = "8px monospace";
  ctx.fillText(hint, 14, viewH - 38);
}

export function drawTauntBanner(
  ctx: CanvasRenderingContext2D,
  taunts: TauntManager,
  antagonist: {
    name: string;
    color: string;
    portraits?: Partial<Record<WardenEmotion, string>>;
  },
  viewW: number
): void {
  if (!taunts.active) return;
  const text = taunts.visibleText();
  const emotion = taunts.active.emotion;
  ctx.font = "10px monospace";
  const w = Math.min(viewW - 40, Math.max(240, ctx.measureText(taunts.active.line).width + 78));
  const x = (viewW - w) / 2;
  const y = 8;
  ctx.fillStyle = "rgba(16,12,24,0.92)";
  roundRect(ctx, x, y, w, 44, 6);
  ctx.fill();
  ctx.strokeStyle = antagonist.color;
  ctx.lineWidth = 1;
  ctx.stroke();
  drawWardenPortrait(
    ctx, emotion, antagonist.color,
    x + 6, y + 6, 32,
    antagonist.portraits?.[emotion]
  );
  ctx.fillStyle = antagonist.color;
  ctx.font = "bold 8px monospace";
  ctx.fillText(antagonist.name.toUpperCase(), x + 46, y + 15);
  ctx.fillStyle = "#e8e2f4";
  ctx.font = "10px monospace";
  wrapText(ctx, text, x + 46, y + 27, w - 58, 11);
}

export function drawFloaties(ctx: CanvasRenderingContext2D, floaties: Floaty[]): void {
  const now = performance.now();
  for (const f of floaties) {
    const age = (now - f.bornAt) / 1000;
    ctx.globalAlpha = Math.max(0, 1 - age / 1.1);
    ctx.fillStyle = f.color;
    ctx.font = "bold 9px monospace";
    ctx.fillText(f.text, f.x - ctx.measureText(f.text).width / 2, f.y - age * 26);
  }
  ctx.globalAlpha = 1;
}

export function drawPrompt(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number
): void {
  ctx.font = "9px monospace";
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = "rgba(16,12,24,0.85)";
  roundRect(ctx, x - w / 2, y - 12, w, 14, 3);
  ctx.fill();
  ctx.fillStyle = "#ffd166";
  ctx.fillText(text, x - w / 2 + 5, y - 2);
}

function measureWrapped(ctx: CanvasRenderingContext2D, text: string, maxW: number): number {
  const words = text.split(" ");
  let line = "";
  let lines = 1;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines++;
      line = w;
    } else {
      line = test;
    }
  }
  return lines;
}

export interface OverlayButton {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
}

export function drawTextOverlay(
  ctx: CanvasRenderingContext2D,
  opts: {
    title: string;
    titleColor: string;
    body: string;
    footer: string;
    viewW: number;
    viewH: number;
    portrait?: (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => void;
    buttons?: { label: string; action: string; primary?: boolean }[];
  }
): OverlayButton[] {
  const { viewW, viewH } = opts;
  ctx.fillStyle = "rgba(8,6,14,0.8)";
  ctx.fillRect(0, 0, viewW, viewH);
  const w = 420;
  const portraitPad = opts.portrait ? 56 : 0;
  const textX = 20 + portraitPad;
  ctx.font = "10px monospace";
  const bodyLines = measureWrapped(ctx, opts.body, w - textX - 20);
  const h = Math.max(120, bodyLines * 13 + 74 + (opts.buttons ? 30 : 0));
  const x = (viewW - w) / 2;
  const y = (viewH - h) / 2;
  ctx.fillStyle = "#f4ead8";
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  if (opts.portrait) {
    ctx.fillStyle = "#252134";
    roundRect(ctx, x + 14, y + 16, 44, 44, 5);
    ctx.fill();
    opts.portrait(ctx, x + 16, y + 18, 40);
  }
  ctx.fillStyle = "#252134";
  ctx.font = "bold 11px monospace";
  ctx.fillText(opts.title, x + textX, y + 24);
  ctx.fillStyle = opts.titleColor;
  ctx.fillRect(x + textX, y + 30, 40, 2);
  ctx.fillStyle = "#3a3345";
  ctx.font = "10px monospace";
  wrapText(ctx, opts.body, x + textX, y + 46, w - textX - 20, 13);
  const rects: OverlayButton[] = [];
  if (opts.buttons) {
    let bx = x + textX;
    const by = y + h - 36;
    for (const b of opts.buttons) {
      ctx.font = "bold 10px monospace";
      const bw = ctx.measureText(b.label).width + 24;
      ctx.fillStyle = b.primary ? "#2c5140" : "#3a3345";
      roundRect(ctx, bx, by, bw, 22, 4);
      ctx.fill();
      ctx.fillStyle = b.primary ? "#9be8b0" : "#cfc8e6";
      ctx.fillText(b.label, bx + 12, by + 15);
      rects.push({ x: bx, y: by, w: bw, h: 22, action: b.action });
      bx += bw + 10;
    }
  }
  ctx.fillStyle = "#8f87ad";
  ctx.font = "9px monospace";
  ctx.fillText(opts.footer, x + textX, y + h - 10);
  return rects;
}
