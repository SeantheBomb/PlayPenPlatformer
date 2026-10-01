// Line editing for the Writers Studio: a text field, the voice lint under
// it, and a preview drawn by the REAL in-game renderer — drawTextOverlay for
// dialog and notes, drawTauntBanner (typewriter and all) for the Warden.
// Never a re-implementation: if the game's box or banner changes, the
// preview changes with it.
import type { RoomEntity, WardenEmotion } from "../data/types";
import { el } from "../editor/forms";
import { drawNpcAvatar, drawSprite } from "../engine/renderer";
import { drawTauntBanner, drawTextOverlay, type BannerState } from "../game/hud";
import { VIEW_H, VIEW_W } from "../game/game";
import { lintLine, type LineKind, type LintFlag } from "./voice";

type Antagonist = { name: string; color: string; portraits?: Partial<Record<WardenEmotion, string>> };

/** Every banner preview runs a rAF typewriter; a view swap must stop them
 *  or they pile up drawing into detached canvases (same rule as the
 *  environments preview). */
const running = new Set<() => void>();
export function stopLinePreviews(): void {
  for (const stop of running) stop();
  running.clear();
}

/** The dialog portrait exactly as Game.npcPortrait draws it: custom art
 *  through the shared image cache, else the signature avatar blown up. */
export function npcPortraitDrawer(e: RoomEntity): (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => void {
  return (ctx, x, y, size) => {
    if (e.portrait && drawSprite(ctx, { sprite: e.portrait }, x, y, size, size)) return;
    const color = e.color ?? "#7fd8e8";
    if (e.avatar) {
      const aw = size * 0.75;
      drawNpcAvatar(ctx, e.avatar, x + (size - aw) / 2, y + size * 0.02, aw, size * 0.96, color, 1, {});
      return;
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size * 0.42, 0, Math.PI * 2);
    ctx.fill();
  };
}

export interface DialogPreviewOpts {
  title: string;
  titleColor?: string;
  footer?: string;
  portrait?: (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => void;
  /** Show the Give/Keep choice, as the "has the item" stage does in play. */
  confirmButtons?: boolean;
}

/** A 640×360 frame with the real dialog box over a dark room. */
export function dialogPreview(opts: DialogPreviewOpts, body: string): { canvas: HTMLCanvasElement; update: (body: string) => void } {
  const canvas = el("canvas", { width: VIEW_W, height: VIEW_H }) as HTMLCanvasElement;
  const draw = (text: string) => {
    const c = canvas.getContext("2d");
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#17131f";
    c.fillRect(0, 0, VIEW_W, VIEW_H);
    drawTextOverlay(c, {
      title: opts.title,
      titleColor: opts.titleColor ?? "#7fd8e8",
      body: text || " ",
      footer: opts.footer ?? "E / Enter — close",
      viewW: VIEW_W, viewH: VIEW_H,
      portrait: opts.portrait,
      buttons: opts.confirmButtons
        ? [{ label: "Hand it over", action: "give", primary: true }, { label: "Keep it", action: "keep" }]
        : undefined,
    });
  };
  draw(body);
  return { canvas, update: draw };
}

/** The real Warden banner, typing the line out and looping, so the writer
 *  sees exactly how it lands — including whether it fits. */
export function bannerPreview(
  antagonist: Antagonist, line: string, emotion: WardenEmotion
): { canvas: HTMLCanvasElement; update: (line: string, emotion: WardenEmotion) => void; stop: () => void } {
  const H = 64;
  const canvas = el("canvas", { width: VIEW_W, height: H }) as HTMLCanvasElement;
  let current = line, currentEmotion = emotion;
  let startedAt = performance.now();
  /** When set, draw exactly this instead of the typewriter's slice. */
  let shown: string | null = null;
  const state: BannerState = {
    active: null,
    visibleText() {
      if (shown !== null) return shown;
      const elapsed = performance.now() - startedAt;
      return current.slice(0, Math.floor(elapsed / 18)); // same 18ms/char as TauntManager
    },
  };
  const paint = () => {
    const c = canvas.getContext("2d");
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#17131f";
    c.fillRect(0, 0, VIEW_W, H);
    state.active = current ? { line: current, emotion: currentEmotion } : null;
    drawTauntBanner(c, state, antagonist, VIEW_W, 8);
  };
  // Draw the finished banner immediately — the typewriter is a nicety that
  // only runs when the tab gets animation frames. A background or throttled
  // tab (or a writer who just glances) must still see the whole line.
  shown = current;
  paint();
  let raf = 0;
  const frame = () => {
    shown = null;
    paint();
    // Fully typed + a beat to read it, then play again.
    if (performance.now() - startedAt > current.length * 18 + 1800) startedAt = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const stop = () => { cancelAnimationFrame(raf); running.delete(stop); };
  running.add(stop);
  raf = requestAnimationFrame(frame);
  return {
    canvas,
    update: (l, e) => {
      current = l; currentEmotion = e; startedAt = performance.now();
      shown = current;
      paint(); // the new line, complete, right now; rAF retypes it if it can
    },
    stop,
  };
}

export function lintStrip(flags: LintFlag[]): HTMLElement {
  return el("div", { className: "wr-lint" },
    ...flags.map((f) => el("span", { className: f.level === "ok" ? "ok" : f.level }, f.text)));
}

export interface LineFieldOpts {
  label: string;
  hint?: string;
  value: string;
  kind: LineKind;
  required?: boolean;
  roomId?: string;
  rows?: number;
  onInput: (v: string) => void;
  /** Which real renderer previews this line. */
  preview?:
    | { type: "dialog"; opts: DialogPreviewOpts }
    | { type: "banner"; antagonist: Antagonist; emotion: () => WardenEmotion };
}

/** Textarea + live lint + live preview, side by side. The single building
 *  block every writing surface is made of. */
export function lineField(o: LineFieldOpts): HTMLElement {
  const area = el("textarea", { rows: o.rows ?? 3, value: o.value }) as HTMLTextAreaElement;
  const lint = lintStrip(lintLine(o.value, o.kind, { roomId: o.roomId, required: o.required }));
  const left = el("div", { className: "wr-form" },
    el("div", { className: "pp-questfieldlabel" }, o.label),
    area,
    o.hint ? el("div", { className: "pp-questfieldhint" }, o.hint) : el("span", {}),
    lint);
  let update: ((v: string) => void) | null = null;
  let right: HTMLElement = el("span", {});
  if (o.preview?.type === "dialog") {
    const p = dialogPreview(o.preview.opts, o.value);
    update = p.update;
    right = p.canvas;
  } else if (o.preview?.type === "banner") {
    const pv = o.preview;
    const p = bannerPreview(pv.antagonist, o.value, pv.emotion());
    update = (v) => p.update(v, pv.emotion());
    right = p.canvas;
  }
  area.addEventListener("input", () => {
    const v = area.value;
    o.onInput(v);
    lint.replaceChildren(...lintStrip(lintLine(v, o.kind, { roomId: o.roomId, required: o.required })).childNodes);
    update?.(v);
  });
  return el("div", { className: "wr-line" }, left, right);
}
