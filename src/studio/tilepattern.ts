// Art Studio: the "Pattern" panel on a tile's page — world-aligned pattern
// tiling (Casey's ask via Sean, 2026-09-23): one image spread across a block
// of tiles, each placed tile showing the slice for its world position.
//
// UX contract (Sean): always clear about how it works, every setting exposed
// so she can dial it in, and a REAL-TIME preview of every choice so there are
// no surprises. The previews draw through the game's own drawTile/drawMap —
// never a studio re-implementation — so what she sees here is what ships.
import type { Content, RoomDef, TileDef } from "../data/types";
import { el } from "../editor/forms";
import { drawMap, getImage, MAX_TILE_SPAN, type TilePattern } from "../engine/renderer";
import { TILE, TileMap } from "../engine/tilemap";
import type { ArtAsset } from "./assets";

export interface PatternPanelContext {
  asset: ArtAsset;
  content: Content;
  /** Re-render the whole tile page (sizes shown elsewhere depend on span). */
  changed: () => void;
  playRoom: (roomId: string) => void;
  /** Rebuilds every frame as the current image repeated across the block. */
  repeatArtToFill: () => Promise<void>;
  /** Set right after an import whose size fits more than one layout. */
  justImported: { w: number; h: number } | null;
  dismissImport: () => void;
}

const probed = new Set<string>();

/** Per-tile preview choices, kept across re-renders for the session. */
const viewState = new Map<string, { source: string; grid: boolean; outline: boolean }>();

/** Every (spanX, spanY) this image size splits into square, whole-pixel,
 *  ≥16px pieces —
 *  what "a 32×32 image" could reasonably mean for a 16×16 tile. */
export function layoutOptions(w: number, h: number): { spanX: number; spanY: number; piece: number }[] {
  const out: { spanX: number; spanY: number; piece: number }[] = [];
  for (let sy = 1; sy <= MAX_TILE_SPAN; sy++) {
    for (let sx = 1; sx <= MAX_TILE_SPAN; sx++) {
      // Whole-pixel, square pieces only — a 10.67px piece can't be drawn
      // cleanly, so it's never offered as a sensible reading.
      if (w % sx || h % sy) continue;
      const pw = w / sx, ph = h / sy;
      // Pieces below the tile's own 16px would be blown up — a plain 16×16
      // import must never trigger a "which did you mean?" question.
      if (pw !== ph || pw < 16) continue;
      out.push({ spanX: sx, spanY: sy, piece: pw });
    }
  }
  return out.sort((a, b) => a.spanX * a.spanY - b.spanX * b.spanY).slice(0, 5);
}

/** Rooms that actually use this tile, most-used first. */
function roomsUsing(content: Content, t: TileDef): { room: RoomDef; count: number }[] {
  const out: { room: RoomDef; count: number }[] = [];
  for (const id of [...content.campaign.rooms, ...Object.keys(content.rooms)]) {
    const room = content.rooms[id];
    if (!room || out.some((o) => o.room.id === room.id)) continue;
    let count = 0;
    for (const row of room.tiles) for (const ch of row) if (ch === t.char) count++;
    if (count) out.push({ room, count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 6);
}

/** The window of a room (in tiles) where this tile does the most visible
 *  work — scored by its EXPOSED cells (touching something else), not raw
 *  count, which just frames a solid slab of wall with nothing to judge the
 *  pattern against. */
function bestWindow(room: RoomDef, ch: string, cols: number, rows: number): { x: number; y: number } {
  const w = Math.min(cols, room.width), h = Math.min(rows, room.height);
  const at = (x: number, y: number) => (room.tiles[y] ?? "")[x];
  const exposed = new Uint8Array(room.width * room.height);
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      if (at(x, y) !== ch) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < room.width && ny < room.height && at(nx, ny) !== ch;
      });
      if (edge) exposed[y * room.width + x] = 1;
    }
  }
  let best = { x: 0, y: 0 }, bestN = -1;
  for (let y = 0; y <= room.height - h; y++) {
    for (let x = 0; x <= room.width - w; x++) {
      let n = 0;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) n += exposed[yy * room.width + xx];
      if (n > bestN) { bestN = n; best = { x, y }; }
    }
  }
  return best;
}

export function patternPanel(ctx: PatternPanelContext): HTMLElement {
  const a = ctx.asset;
  const pat = a.pattern!;
  const t = ctx.content.tiles.find((x) => `tile:${x.id}` === a.key)!;
  const p = pat.read();
  const isPattern = p.spanX > 1 || p.spanY > 1;
  const view = viewState.get(a.key) ?? { source: "wall", grid: true, outline: true };
  viewState.set(a.key, view);

  const set = async (next: Partial<TilePattern>) => {
    const cur = pat.read();
    const merged = { ...cur, ...next };
    merged.spanX = Math.max(1, Math.min(MAX_TILE_SPAN, merged.spanX));
    merged.spanY = Math.max(1, Math.min(MAX_TILE_SPAN, merged.spanY));
    merged.offsetX = ((merged.offsetX % merged.spanX) + merged.spanX) % merged.spanX;
    merged.offsetY = ((merged.offsetY % merged.spanY) + merged.spanY) % merged.spanY;
    await pat.write(merged);
    ctx.changed();
  };

  // ---- Explanation (always visible — this is the part that's unusual) ----
  const intro = el("p", { className: "st-hint", style: "margin:4px 0 10px" },
    "In the game every tile is 16×16. Normally each tile shows your whole image, so the same picture repeats on every tile. ",
    "A pattern spreads ONE bigger image across a block of tiles instead: each tile shows just its own piece, picked by where it sits in the room, ",
    "so neighbouring tiles join up into the full design — checkerboards, brick courses, big stone textures. Tiles stay 16×16 and play exactly the same; this only changes which part of your image each one shows.");

  // ---- Controls ----
  const stepper = (label: string, value: number, min: number, max: number, onSet: (v: number) => void, title: string) =>
    el("span", { className: "st-row", style: "margin:0;gap:4px", title },
      el("span", { className: "st-hint" }, label),
      el("button", { className: "st-btn", style: "padding:4px 10px", disabled: value <= min, onclick: () => onSet(value - 1) }, "−"),
      el("b", { style: "min-width:18px;text-align:center" }, String(value)),
      el("button", { className: "st-btn", style: "padding:4px 10px", disabled: value >= max, onclick: () => onSet(value + 1) }, "+"));

  const presets: [number, number, string][] = [[1, 1, "Off (1×1)"], [2, 2, "2×2"], [3, 3, "3×3"], [4, 4, "4×4"], [2, 1, "2×1 wide"], [1, 2, "1×2 tall"]];
  const presetRow = el("div", { className: "st-row" },
    el("span", { className: "st-hint" }, "Quick pick:"),
    ...presets.map(([sx, sy, label]) => el("button", {
      className: `st-chip ${p.spanX === sx && p.spanY === sy ? "st-on" : ""}`,
      onclick: () => void set({ spanX: sx, spanY: sy, offsetX: 0, offsetY: 0 }),
    }, label)));

  const sizeRow = el("div", { className: "st-row" },
    el("span", {}, "One image covers"),
    stepper("across", p.spanX, 1, MAX_TILE_SPAN, (v) => void set({ spanX: v }), "How many tiles wide one copy of your image is"),
    stepper("down", p.spanY, 1, MAX_TILE_SPAN, (v) => void set({ spanY: v }), "How many tiles tall one copy of your image is"),
    el("span", { className: "st-hint" }, `→ draw it at ${16 * p.spanX}×${16 * p.spanY} (or any multiple, e.g. ${32 * p.spanX}×${32 * p.spanY} for extra detail)`));

  const shiftRow = isPattern ? el("div", { className: "st-row" },
    el("span", {}, "Shift the pattern"),
    stepper("across", p.offsetX, 0, p.spanX - 1, (v) => void set({ offsetX: v }), "Slide the pattern sideways by whole tiles"),
    stepper("down", p.offsetY, 0, p.spanY - 1, (v) => void set({ offsetY: v }), "Slide the pattern up/down by whole tiles"),
    el("span", { className: "st-hint" }, "slides where the design starts, so it lines up nicely with the rooms' walls and floors")) : null;

  // ---- Live status: does the current image fit these settings? ----
  const status = el("div", {});
  const art = a.read();
  const firstUri = art.frames[0];
  const img = firstUri ? getImage(firstUri) : null;
  if (firstUri && !img && !probed.has(firstUri)) {
    // Not decoded yet (first visit this session) — re-render once it is,
    // so the size check below never silently goes missing.
    probed.add(firstUri);
    const probe = new Image();
    probe.onload = () => ctx.changed();
    probe.src = firstUri;
  }
  if (!firstUri) {
    status.append(el("div", { className: "st-note" },
      isPattern
        ? `No custom art yet — the pattern applies to your image, so for now the game keeps its built-in look on every tile. Drop in a ${16 * p.spanX}×${16 * p.spanY} image below, or open the pixel/shape editor: it gives you a ${16 * p.spanX}×${16 * p.spanY} canvas with gold lines showing where each tile's piece falls, starting from the built-in look.`
        : "No custom art yet. Turn on a pattern above if you want one image to spread across several tiles — or just draw a single tile as usual."));
  } else if (img) {
    const pw = img.naturalWidth / p.spanX, ph = img.naturalHeight / p.spanY;
    const isSvg = firstUri.startsWith("data:image/svg");
    const piece = isSvg ? "a piece" : `a ${+pw.toFixed(1)}×${+ph.toFixed(1)} piece`;
    const lines: [string, boolean][] = [];
    lines.push([`Your image: ${img.naturalWidth}×${img.naturalHeight}. ${isPattern ? `Split ${p.spanX}×${p.spanY}, each tile shows ${piece}, drawn at 16×16.` : "Each tile shows the whole image, drawn at 16×16."}`, false]);
    if (Math.abs(pw - ph) > 0.5) {
      const fits = layoutOptions(img.naturalWidth, img.naturalHeight).filter((o) => o.spanX > 1 || o.spanY > 1);
      lines.push([`The pieces aren't square (${+pw.toFixed(1)}×${+ph.toFixed(1)}), so they'll look stretched ${pw > ph ? "thin" : "wide"} in the game. ` +
        (fits.length ? `This image fits a ${fits[0].spanX}×${fits[0].spanY} pattern without stretching.` : `Resize the image to a ${p.spanX}:${p.spanY} shape.`), true]);
    } else if (!isSvg && isPattern && pw < 16) {
      lines.push([`Each piece is only ${+pw.toFixed(1)}px, so it gets blown up to fill 16px — pixels will look chunky. ` +
        `For crisp results make the image ${16 * p.spanX}×${16 * p.spanY} or bigger` +
        (pw <= 16 / Math.max(p.spanX, p.spanY) + 0.01 ? ", or use “Repeat my art” below if this was meant as a single tile." : "."), true]);
    }
    status.append(...lines.map(([m, warn]) => el("div", { className: `st-note${warn ? " st-err" : ""}` }, warn ? `⚠ ${m}` : m)));
    if (isPattern && !isSvg && pw <= 16 / Math.max(p.spanX, p.spanY) + 0.01) {
      status.append(el("div", { className: "st-row" },
        el("button", {
          className: "st-btn",
          title: "Rebuilds your art as a copy of the current image repeated across the whole block — a starting point for adding variety",
          onclick: () => void ctx.repeatArtToFill(),
        }, `🔁 Repeat my art to fill ${p.spanX}×${p.spanY}`),
        el("span", { className: "st-hint" }, "turns your one-tile image into a full-size pattern you can then vary tile by tile")));
    }
  }

  // ---- Just-imported: ask what the image is meant to be ----
  let importChoice: HTMLElement | null = null;
  if (ctx.justImported) {
    const opts = layoutOptions(ctx.justImported.w, ctx.justImported.h);
    if (opts.length > 1) {
      importChoice = el("div", { className: "st-note", style: "border-left-color:#5ad1a5" },
        el("b", {}, `You just brought in a ${ctx.justImported.w}×${ctx.justImported.h} image — how should the game use it?`),
        el("div", { className: "st-row" },
          ...opts.map((o) => el("button", {
            className: `st-btn ${o.spanX === p.spanX && o.spanY === p.spanY ? "st-on" : ""}`,
            onclick: () => { ctx.dismissImport(); void set({ spanX: o.spanX, spanY: o.spanY, offsetX: 0, offsetY: 0 }); },
          }, o.spanX === 1 && o.spanY === 1
            ? `One tile, extra detail (${o.piece}px)`
            : `${o.spanX}×${o.spanY} pattern (${o.piece}px per tile)`)),
          el("button", { className: "st-btn st-quiet", onclick: () => { ctx.dismissImport(); ctx.changed(); } }, "Keep current setting")),
        el("div", { className: "st-hint" }, "Watch the preview below — you can change this any time with the controls above."));
    }
  }

  // ---- Live preview ----
  const rooms = roomsUsing(ctx.content, t);
  if (view.source !== "wall" && !rooms.some((r) => r.room.id === view.source)) view.source = "wall";
  const sourceRow = el("div", { className: "st-row" },
    el("span", { className: "st-hint" }, "Preview on:"),
    el("button", {
      className: `st-chip ${view.source === "wall" ? "st-on" : ""}`,
      title: "A plain block of this tile — the clearest view of how the pattern repeats",
      onclick: () => { view.source = "wall"; ctx.changed(); },
    }, "Test wall"),
    ...rooms.map(({ room, count }) => el("button", {
      className: `st-chip ${view.source === room.id ? "st-on" : ""}`,
      title: `The part of this room with the most of this tile (${count} placed) — tiles only, no characters or objects`,
      onclick: () => { view.source = room.id; ctx.changed(); },
    }, room.name ?? room.id)),
    rooms.length ? null : el("span", { className: "st-hint" }, "(not placed in any room yet)"));

  const toggles = el("div", { className: "st-row" },
    el("label", { className: "st-hint", title: "Thin lines between every tile" },
      el("input", { type: "checkbox", checked: view.grid, onchange: (ev: Event) => { view.grid = (ev.target as HTMLInputElement).checked; } }),
      " tile grid"),
    isPattern ? el("label", { className: "st-hint", title: "Gold lines where each full copy of your image begins" },
      el("input", { type: "checkbox", checked: view.outline, onchange: (ev: Event) => { view.outline = (ev.target as HTMLInputElement).checked; } }),
      " pattern repeats") : null,
    el("span", { className: "st-spacer" }),
    view.source !== "wall" ? el("button", {
      className: "st-btn", title: "Close the studio and play this room with your draft art",
      onclick: () => ctx.playRoom(view.source),
    }, "▶ Play this room") : null);

  const TP = view.source === "wall" ? 32 : 20; // screen px per tile in the preview
  const cols = view.source === "wall" ? 12 : 26, rows = view.source === "wall" ? 6 : 13;
  const room = rooms.find((r) => r.room.id === view.source)?.room;
  const win = room ? bestWindow(room, t.char, cols, rows) : { x: 0, y: 0 };
  const vCols = room ? Math.min(cols, room.width) : cols, vRows = room ? Math.min(rows, room.height) : rows;
  const map = room ? new TileMap(room, ctx.content.tiles) : null;
  const cv = el("canvas", {
    className: "st-previewbig", width: vCols * TP, height: vRows * TP,
    style: "width:100%;max-width:" + vCols * TP + "px;display:block",
  }) as HTMLCanvasElement;
  const paint = () => {
    const g = cv.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    if (map && room) {
      g.fillStyle = room.background || "#141020";
      g.fillRect(0, 0, cv.width, cv.height);
      g.save();
      g.scale(TP / TILE, TP / TILE);
      g.translate(-win.x * TILE, -win.y * TILE);
      drawMap(g, map, win.x * TILE, win.y * TILE, vCols * TILE, vRows * TILE, performance.now() / 1000);
      g.restore();
    } else {
      pat.drawWorld(g, 0, 0, TP, vCols, vRows, 0, 0);
    }
    const cur = pat.read();
    if (view.grid) {
      g.strokeStyle = "rgba(255,255,255,0.14)";
      g.lineWidth = 1;
      for (let x = 1; x < vCols; x++) { g.beginPath(); g.moveTo(x * TP + 0.5, 0); g.lineTo(x * TP + 0.5, cv.height); g.stroke(); }
      for (let y = 1; y < vRows; y++) { g.beginPath(); g.moveTo(0, y * TP + 0.5); g.lineTo(cv.width, y * TP + 0.5); g.stroke(); }
    }
    if (view.outline && (cur.spanX > 1 || cur.spanY > 1)) {
      // A repeat starts where the tile's slice is column/row 0.
      g.strokeStyle = "rgba(255,209,102,0.85)";
      g.setLineDash([6, 4]);
      g.lineWidth = 2;
      for (let x = 0; x <= vCols; x++) {
        const wx = win.x + x;
        if ((((wx - cur.offsetX) % cur.spanX) + cur.spanX) % cur.spanX !== 0) continue;
        g.beginPath(); g.moveTo(x * TP, 0); g.lineTo(x * TP, cv.height); g.stroke();
      }
      for (let y = 0; y <= vRows; y++) {
        const wy = win.y + y;
        if ((((wy - cur.offsetY) % cur.spanY) + cur.spanY) % cur.spanY !== 0) continue;
        g.beginPath(); g.moveTo(0, y * TP); g.lineTo(cv.width, y * TP); g.stroke();
      }
      g.setLineDash([]);
    }
  };
  (cv as unknown as { ppDraw: () => void }).ppDraw = paint;
  paint();

  return el("div", { className: "st-card" },
    el("b", {}, "Pattern — spread one image across several tiles"),
    intro,
    importChoice,
    presetRow,
    sizeRow,
    shiftRow,
    status,
    el("div", { style: "margin-top:12px" },
      el("b", { style: "font-size:13px" }, "Live preview "),
      el("span", { className: "st-hint" }, "— drawn by the game's own tile code, updates the moment you change anything"),
      sourceRow,
      cv,
      toggles));
}
