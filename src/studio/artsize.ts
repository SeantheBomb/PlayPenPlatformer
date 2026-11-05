// Art Studio: "Size in game" for slots drawn at the art's own size
// (characters, enemies, the Warden, objects — SpriteFit "natural").
//
// Sean, 2026-11-04: the collision box should follow the artwork, not the
// other way round; art is unscaled by default, and a per-asset art scale is
// the knob for bringing something back down if it reads too big. So this
// card shows, live: the art at its real in-game size next to a 16×16 tile
// and the current collision box, the scale control, and plain numbers.
// Drawing goes through spriteRect — the same mapping drawSprite uses.
import type { Content } from "../data/types";
import { el } from "../editor/forms";
import { getImage, spriteRect, type SpriteBounds } from "../engine/renderer";
import { playerHitbox } from "../game/player";
import type { ArtAsset } from "./assets";

const SCALES: [number, string][] = [[1, "1:1 (unscaled)"], [1.5, "⅔ size"], [2, "½ size"], [3, "⅓ size"], [4, "¼ size"]];
const TILE = 16;

export interface ArtSizeContext {
  asset: ArtAsset;
  content: Content;
  /** The image to preview right now (current animation frame), if any. */
  frameUri: () => string | null;
  changed: () => void;
}

/** The collision box the game uses for this slot today. */
export function collisionBox(a: ArtAsset, content: Content): { w: number; h: number; followsArt: boolean } {
  if (a.key === "player") {
    const cfg = content.game.player;
    const hb = playerHitbox(cfg);
    return { ...hb, followsArt: !!cfg.hitboxFromArt && !!cfg.spriteBounds };
  }
  return { w: a.drawnW, h: a.drawnH, followsArt: false };
}

const fmt = (n: number) => String(+n.toFixed(1));

export function artSizeCard(ctx: ArtSizeContext): HTMLElement {
  const a = ctx.asset;
  const nat = a.natural!;
  const scale = nat.scale();
  const bounds = nat.bounds();
  const box = collisionBox(a, ctx.content);
  const hasArt = !!ctx.frameUri();

  // ---- Numbers ----
  const size = bounds ? { w: bounds[2] / scale, h: bounds[3] / scale } : null;
  const facts = el("div", { className: "st-hint", style: "margin:6px 0" });
  if (!hasArt) {
    facts.append(`No custom art yet. Art is drawn at its own size — 1 pixel of your art = 1 game pixel — standing on the floor. A tile is ${TILE}×${TILE}.`);
  } else if (size) {
    const tiles = `${fmt(size.w / TILE)}×${fmt(size.h / TILE)} tiles`;
    facts.append(
      el("b", {}, `In game: ${fmt(size.w)}×${fmt(size.h)} px`),
      ` (the visible part of your art${scale !== 1 ? `, at ${SCALES.find(([s]) => s === scale)?.[1] ?? `1/${scale}`}` : ", unscaled"}) — about ${tiles}. `,
      a.key === "player"
        ? (box.followsArt
          ? `The collision box follows your art: ${box.w}×${box.h}.`
          : `The collision box is ${box.w}×${box.h} (dashed gold) — Sean sets that in the editor; it can be switched to follow your art.`)
        : `Its box in the level is ${box.w}×${box.h} (dashed gold).`
    );
  }

  // ---- Scale control ----
  const custom = el("input", {
    type: "number", min: 0.25, max: 8, step: 0.25, value: scale,
    className: "st-search", style: "width:70px;min-width:0",
    title: "Art pixels per game pixel — 2 means your art is drawn at half size",
    onchange: (ev: Event) => {
      const v = Number((ev.target as HTMLInputElement).value);
      if (v > 0 && v <= 8) void nat.setScale(v).then(ctx.changed);
    },
  });
  const scaleRow = el("div", { className: "st-row" },
    el("span", { className: "st-hint" }, "Art scale:"),
    ...SCALES.map(([s, label]) => el("button", {
      className: `st-chip ${scale === s ? "st-on" : ""}`,
      onclick: () => void nat.setScale(s).then(ctx.changed),
    }, label)),
    el("span", { className: "st-hint" }, "or"), custom,
    el("span", { className: "st-hint" }, "art px per game px"));

  // ---- Live stage: floor, a reference tile, the collision box, the art ----
  const Z = 4;
  const extentW = Math.max(size?.w ?? 0, box.w, TILE) , extentH = Math.max(size?.h ?? 0, box.h, TILE);
  const W = Math.ceil((extentW * 2 + TILE * 2 + 24) * Z), H = Math.ceil((extentH + 12) * Z);
  const cv = el("canvas", {
    className: "st-previewbig", width: W, height: H,
    style: `width:100%;max-width:${W}px;display:block`,
    title: "Your art at its real in-game size (4× zoom), standing next to one 16×16 tile",
  }) as HTMLCanvasElement;
  const paint = () => {
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    g.save();
    g.scale(Z, Z);
    const floor = extentH + 6;
    g.fillStyle = "#3d3a52";
    g.fillRect(0, floor, W / Z, 6);
    // reference tile
    g.fillStyle = "rgba(185,189,212,0.35)";
    g.fillRect(4, floor - TILE, TILE, TILE);
    g.strokeStyle = "rgba(185,189,212,0.8)";
    g.lineWidth = 1 / Z;
    g.strokeRect(4, floor - TILE, TILE, TILE);
    g.fillStyle = "#b9bdd4";
    g.font = "4px monospace";
    g.fillText("1 tile", 6, floor - TILE - 2);
    // collision box, centered on the stage
    const cx = TILE + 12 + extentW;
    const bx = cx - box.w / 2, by = floor - box.h;
    const uri = ctx.frameUri();
    const img = uri ? getImage(uri) : null;
    if (img) {
      const r = spriteRect(img.naturalWidth, img.naturalHeight, bx, by, box.w, box.h, {
        fit: "natural", scale, bounds: bounds as SpriteBounds | undefined,
      });
      g.drawImage(img, r.x, r.y, r.w, r.h);
    }
    g.strokeStyle = "rgba(255,209,102,0.95)";
    g.lineWidth = 0.5;
    g.setLineDash([1.5, 1]);
    g.strokeRect(bx + 0.25, by + 0.25, box.w - 0.5, box.h - 0.5);
    g.restore();
  };
  (cv as unknown as { ppDraw: () => void }).ppDraw = paint;
  paint();

  return el("div", { className: "st-card" },
    el("b", {}, "Size in game"),
    el("p", { className: "st-hint", style: "margin:4px 0 6px" },
      "Your art is drawn at its own size: 1 pixel of your art = 1 game pixel, its visible part standing on the floor, centered. ",
      "Draw it as big as you want it to look. If it ends up too big (or small), change the art scale here instead of redrawing. ",
      "Leave no empty rows under the feet, or it'll float."),
    facts,
    scaleRow,
    cv,
    el("div", { className: "st-hint" }, "Live, 4× zoom — gold dashes = the collision box, grey = one 16×16 tile."));
}
