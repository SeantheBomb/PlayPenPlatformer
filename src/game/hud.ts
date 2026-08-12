// In-game HUD and simple overlays. Pure drawing — state lives in Game.
// Layout numbers come from content/game.json's `hud` block (editable live
// in the editor's "game" tab) so Sean can rearrange/restyle the HUD without
// touching code.
import type { GameConfig, WardenEmotion } from "../data/types";
import { drawItemIcon, drawWardenPortrait, roundRect } from "../engine/renderer";
import { simNow } from "../engine/simclock";
import type { RunState } from "./state";
import type { TauntManager } from "./taunts";
import { wrapText } from "./craftui";

export type HudLayout = GameConfig["hud"];

export interface Floaty {
  text: string;
  x: number;
  y: number;
  bornAt: number;
  color: string;
}

export function drawHearts(
  ctx: CanvasRenderingContext2D, health: number, max: number, hud: HudLayout,
  uiScale = 1
): void {
  ctx.save();
  ctx.translate(hud.heartsX, hud.heartsY);
  ctx.scale(uiScale, uiScale);
  for (let i = 0; i < max; i++) {
    const x = i * hud.heartSpacing;
    ctx.fillStyle = i < health ? hud.heartColor : hud.heartEmptyColor;
    ctx.beginPath();
    ctx.arc(x + 3, 3, 3.4, 0, Math.PI * 2);
    ctx.arc(x + 9, 3, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 0.5, 4.5);
    ctx.lineTo(x + 6, 12);
    ctx.lineTo(x + 12.5, 4.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Breath bubbles beside the hearts — shown while underwater / not full. */
export function drawAir(
  ctx: CanvasRenderingContext2D, air: number, max: number, hud: HudLayout,
  uiScale = 1
): void {
  ctx.save();
  ctx.translate(hud.airX, hud.airY);
  ctx.scale(uiScale, uiScale);
  for (let i = 0; i < max; i++) {
    const x = i * hud.airSpacing;
    const full = i < air;
    ctx.fillStyle = full ? hud.airColor : hud.airEmptyColor;
    ctx.beginPath();
    ctx.arc(x + 5, 5, 4.6, 0, Math.PI * 2);
    ctx.fill();
    if (full) {
      // a little shine so it reads "bubble", not "dot"
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.arc(x + 3.4, 3.2, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Prominent climb-stamina bar — shown only while goo-climbing. Ticks from
 *  green through amber to red as time runs out, plus a numeric readout, so
 *  "how long before you fall" reads at a glance (explicit design ask). */
export function drawClimbTimer(
  ctx: CanvasRenderingContext2D, timeLeft: number, maxTime: number, hud: HudLayout,
  uiScale = 1
): void {
  if (maxTime <= 0) return;
  const ratio = Math.max(0, Math.min(1, timeLeft / maxTime));
  const x = hud.climbX * uiScale;
  const y = hud.climbY * uiScale;
  const w = hud.climbWidth * uiScale;
  const h = hud.climbHeight * uiScale;
  ctx.save();
  ctx.fillStyle = "rgba(16,12,24,0.75)";
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  const color = ratio > 0.5 ? "#8bd44f" : ratio > 0.2 ? "#ffd166" : "#ff5470";
  ctx.fillStyle = color;
  roundRect(ctx, x, y, Math.max(h, w * ratio), h, h / 2);
  ctx.fill();
  // Flash the whole bar once time is nearly up — impossible to miss.
  if (ratio <= 0.2 && Math.floor(simNow() / 120) % 2 === 0) {
    ctx.fillStyle = "rgba(255,84,112,0.5)";
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
  }
  ctx.fillStyle = "#f4ead8";
  ctx.font = `bold ${Math.round(8 * uiScale)}px monospace`;
  ctx.textAlign = "center";
  ctx.fillText(timeLeft.toFixed(1) + "s", x + w / 2, y + h + 10 * uiScale);
  ctx.textAlign = "left";
  ctx.restore();
}

export function drawToolbelt(
  ctx: CanvasRenderingContext2D, state: RunState, viewW: number, hud: HudLayout, uiScale = 1
): void {
  // Passive tools only — anything usable lives in the hotbar instead.
  const tools = state.ownedTools().filter((t) => !t.useMode);
  tools.forEach((t, i) => {
    const x = viewW - hud.toolbeltRightOffset * uiScale - i * hud.toolbeltSpacing * uiScale;
    const y = hud.toolbeltTopOffset * uiScale;
    ctx.fillStyle = "rgba(28,24,40,0.85)";
    roundRect(ctx, x - 10 * uiScale, y, 20 * uiScale, 20 * uiScale, 4 * uiScale);
    ctx.fill();
    drawItemIcon(ctx, t, x, y + 10 * uiScale, 1.1 * uiScale);
  });
}

/** Screen-space rect for hotbar slot `i` — shared by drawing and tap hit-testing. */
export function hotbarSlotRect(
  hud: HudLayout, viewH: number, i: number, uiScale = 1
): { x: number; y: number; w: number; h: number } {
  const size = hud.hotbarSlotSize * uiScale;
  const spacing = hud.hotbarSpacing * uiScale;
  return {
    x: hud.hotbarLeftOffset + i * (size + spacing),
    y: viewH - hud.hotbarBottomOffset * uiScale,
    w: size, h: size,
  };
}

export function drawHotbar(
  ctx: CanvasRenderingContext2D, state: RunState, viewH: number, hud: HudLayout,
  hint = "Q cycle · F use", uiScale = 1
): void {
  const cons = state.usableItems();
  if (cons.length === 0) return;
  const sel = Math.min(state.selectedConsumable, cons.length - 1);
  cons.forEach((c, i) => {
    const r = hotbarSlotRect(hud, viewH, i, uiScale);
    ctx.fillStyle = i === sel ? "rgba(61,53,86,0.95)" : "rgba(28,24,40,0.85)";
    roundRect(ctx, r.x, r.y, r.w, r.h, 4 * uiScale);
    ctx.fill();
    if (i === sel) {
      ctx.strokeStyle = hud.hotbarSelectedColor;
      ctx.lineWidth = uiScale;
      ctx.stroke();
    }
    drawItemIcon(ctx, c, r.x + r.w / 2, r.y + r.h / 2 - 1, 1.1 * uiScale);
    if (c.kind === "consumable") {
      ctx.fillStyle = hud.hotbarSelectedColor;
      ctx.font = `${Math.round(8 * uiScale)}px monospace`;
      ctx.fillText(String(state.count(c.id)), r.x + r.w - 8 * uiScale, r.y + r.h - 2);
    }
  });
  ctx.fillStyle = "#8f87ad";
  ctx.font = "8px monospace";
  ctx.fillText(hint, hud.hotbarLeftOffset, viewH - hud.hotbarBottomOffset * uiScale - 4);
}

export function drawTauntBanner(
  ctx: CanvasRenderingContext2D,
  taunts: TauntManager,
  antagonist: {
    name: string;
    color: string;
    portraits?: Partial<Record<WardenEmotion, string>>;
  },
  viewW: number,
  bannerTopOffset = 8
): void {
  if (!taunts.active) return;
  const text = taunts.visibleText();
  const emotion = taunts.active.emotion;
  ctx.font = "10px monospace";
  const w = Math.min(viewW - 40, Math.max(240, ctx.measureText(taunts.active.line).width + 78));
  const x = (viewW - w) / 2;
  const y = bannerTopOffset;
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

/** One queued fanfare card (pickup or craft-ready) — state lives in Game,
 *  this module only draws. `bornAt` is sim time, like floaties. */
export interface Toast {
  itemId: string;
  title: string;
  subtitle: string;
  accent: string;   // border/title color: item color for pickups, gold for craft-ready
  bornAt: number;
}

export const TOAST_MS = 2400;
const TOAST_SLIDE_MS = 220;

/** Slide-in card front and center: big item icon + GOT/CRAFT READY text.
 *  Draws only the head of the queue; Game pops expired ones. */
export function drawToast(
  ctx: CanvasRenderingContext2D,
  toast: Toast,
  viewW: number,
  yTop: number,
  drawIcon: (ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number) => void
): void {
  const age = simNow() - toast.bornAt;
  if (age < 0 || age > TOAST_MS) return;
  // Slide down on entry, lift + fade on exit.
  const tIn = Math.min(1, age / TOAST_SLIDE_MS);
  const tOut = Math.max(0, (age - (TOAST_MS - TOAST_SLIDE_MS)) / TOAST_SLIDE_MS);
  const ease = 1 - (1 - tIn) * (1 - tIn);
  const y = yTop - 30 + ease * 30 - tOut * 12;
  ctx.save();
  ctx.globalAlpha = Math.min(1, tIn * 1.5) * (1 - tOut);

  ctx.font = "bold 10px monospace";
  const titleW = ctx.measureText(toast.title).width;
  ctx.font = "8px monospace";
  const subW = ctx.measureText(toast.subtitle).width;
  const w = Math.max(titleW, subW) + 52;
  const x = (viewW - w) / 2;

  ctx.fillStyle = "rgba(16,12,24,0.92)";
  roundRect(ctx, x, y, w, 34, 6);
  ctx.fill();
  ctx.strokeStyle = toast.accent;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Big icon in a subtle well, with a brief entry "pop" scale.
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  roundRect(ctx, x + 5, y + 5, 24, 24, 4);
  ctx.fill();
  const pop = 1 + Math.max(0, 1 - age / 350) * 0.35;
  drawIcon(ctx, x + 17, y + 17, 1.7 * pop);

  ctx.fillStyle = toast.accent;
  ctx.font = "bold 10px monospace";
  ctx.fillText(toast.title, x + 36, y + 14);
  ctx.fillStyle = "#e8e2f4";
  ctx.font = "8px monospace";
  ctx.fillText(toast.subtitle, x + 36, y + 26);
  ctx.restore();
}

export function drawFloaties(ctx: CanvasRenderingContext2D, floaties: Floaty[]): void {
  const now = simNow();
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
