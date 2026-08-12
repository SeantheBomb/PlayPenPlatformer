// Built-in vector shape editor — the SVG sibling of the pixel editor, with
// the same contract: it edits its OWN representation (a flat list of simple
// shapes), not arbitrary foreign SVGs. Frames it authored round-trip
// losslessly via an embedded shape-list attribute; opening a foreign SVG
// imports the primitives it understands and honestly reports what it drops.
// Output frames are self-contained, sanitized-by-construction SVG data URIs.
import { el, toast } from "../editor/forms";

const PALETTE = [
  "#12101c", "#3d3a52", "#6e5c8a", "#b9bdd4", "#f4ead8", "#ffd166",
  "#ff7043", "#c84b6a", "#8bd44f", "#5ad1a5", "#4fc3f7", "#7fd8e8",
  "#b08757", "#8a97a8", "#59627f", "#e8a2b4",
];

type Tool = "select" | "rect" | "ellipse" | "line" | "polygon" | "draw";

interface Shape {
  kind: "rect" | "ellipse" | "line" | "polygon" | "path";
  // rect/ellipse: x,y,w,h box. line: x,y -> x2,y2. polygon/path: pts.
  x: number; y: number; w: number; h: number;
  x2?: number; y2?: number;
  pts?: [number, number][];
  fill: string | null;
  stroke: string | null;
  sw: number; // stroke width
}

interface Frame { shapes: Shape[] }

export interface SvgEditorOptions {
  title: string;
  width: number;   // logical canvas units = the in-game drawn box
  height: number;
  frames: string[]; // existing art (data URIs) to load
  fps: number;
  multiFrame: boolean;
  onSave: (frames: string[], fps: number) => void;
  /** Draws the asset's CURRENT in-game look into a cell×cell box. When the
   *  existing frames can't be shape-edited (procedural art, or raster
   *  PNGs), the editor rasterizes this and converts it into editable
   *  colored blocks — tweaking the current look is the whole point. */
  seedDraw?: (ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) => void;
}

const SHAPES_ATTR = "data-pp-shapes";

export function openSvgEditor(opts: SvgEditorOptions): void {
  const W = opts.width, H = opts.height;
  const SCALE = Math.max(8, Math.floor(340 / Math.max(W, H)));
  let frames: Frame[] = [];
  let current = 0;
  let fps = opts.fps || 6;
  let tool: Tool = "rect";
  let fill: string | null = PALETTE[5];
  let stroke: string | null = null;
  let sw = 1;
  let selected = -1;
  let dragging: { mode: "move" | "resize" | "new"; startX: number; startY: number; orig?: Shape } | null = null;
  let polyPts: [number, number][] = [];
  const undoStack: string[] = [];

  // ---- load existing frames ----
  let droppedForeign = 0;
  for (const uri of opts.frames) {
    const f = loadFrameFromUri(uri);
    if (f) { frames.push(f.frame); droppedForeign += f.dropped; }
  }
  const loadedForeign = droppedForeign > 0 || (opts.frames.length > 0 && frames.length < opts.frames.length);
  // Nothing shape-editable? Seed from the CURRENT in-game look, converted
  // into editable colored blocks — so "tweak what's there" always works,
  // never a blank canvas (Sean, 2026-08-12).
  let seeded = false;
  if (!frames.length && opts.seedDraw) {
    const shapes = vectorizeCurrentLook(opts.seedDraw, W, H);
    if (shapes.length) {
      frames = [{ shapes }];
      seeded = true;
    }
  }
  if (!frames.length) frames = [{ shapes: [] }];

  const shapes = () => frames[current].shapes;
  const pushUndo = () => {
    undoStack.push(JSON.stringify(frames[current].shapes));
    if (undoStack.length > 40) undoStack.shift();
  };

  // ---- DOM ----
  const grid = el("canvas", {
    className: "st-svggrid", width: W * SCALE, height: H * SCALE,
  }) as HTMLCanvasElement;
  const preview = el("canvas", { className: "pp-pixpreview", width: 64, height: 64 }) as HTMLCanvasElement;
  const frameStrip = el("div", { className: "pp-framestrip" });
  const toolRow = el("div", { className: "st-row" });
  const paletteRow = el("div", { className: "pp-paletterow" });
  const hintLine = el("div", { className: "st-hint" }, "");

  const modal = el(
    "div", { className: "pp-pixmodal" },
    el(
      "div", { className: "pp-pixpanel" },
      el("b", {}, `Shape editor — ${opts.title} (${W}×${H})`),
      loadedForeign ? el("div", { className: "st-note" },
        "This art wasn't made in this editor — you're editing a copy. Shapes I understood were kept" +
        (droppedForeign ? `; ${droppedForeign} thing(s) I couldn't read were left out.` : ".") +
        " Your original file is untouched.") : el("span", {}),
      seeded ? el("div", { className: "st-note" },
        "Started from the current look, converted into colored blocks you can select, recolor, move, or delete. " +
        "Feel free to clear it all and draw fresh instead.") : el("span", {}),
      toolRow,
      paletteRow,
      el("div", { className: "pp-pixcols" },
        el("div", {}, grid, hintLine),
        el("div", { className: "pp-pixside" },
          el("span", { className: "pp-hint" }, "preview"),
          preview,
          opts.multiFrame ? el("span", { className: "pp-hint" }, "frames") : el("span", {}),
          opts.multiFrame ? frameStrip : el("span", {}),
          el("div", { className: "st-row" },
            el("button", { className: "pp-btn", onclick: () => { undo(); } }, "↩ Undo"),
            el("button", {
              className: "pp-btn", title: "Delete the selected shape (or press Delete)",
              onclick: () => { deleteSelected(); },
            }, "🗑 Delete")),
          el("div", { className: "st-row" },
            el("button", { className: "pp-btn", title: "Send the selected shape behind everything", onclick: () => reorder(-1) }, "⤓ Back"),
            el("button", { className: "pp-btn", title: "Bring the selected shape in front", onclick: () => reorder(1) }, "⤒ Front")),
          el("div", { className: "pp-btnrow" },
            el("button", { className: "pp-btn pp-primary", onclick: () => { save(); } }, "Save"),
            el("button", { className: "pp-btn", onclick: () => close() }, "Cancel"))
        ))
    )
  );

  const close = () => modal.remove();

  // ---- toolbar ----
  const TOOLS: [Tool, string, string][] = [
    ["select", "☝ select", "Click a shape to select; drag to move; corners to resize"],
    ["rect", "▭ box", "Drag to draw a rectangle"],
    ["ellipse", "◯ circle", "Drag to draw a circle/ellipse"],
    ["line", "／ line", "Drag to draw a line"],
    ["polygon", "⬠ polygon", "Click corners, double-click to finish"],
    ["draw", "✎ freehand", "Draw freely"],
  ];
  const renderTools = () => {
    toolRow.replaceChildren(
      ...TOOLS.map(([t, label, tip]) => el("button", {
        className: `st-chip ${tool === t ? "st-on" : ""}`, title: tip,
        onclick: () => { tool = t; polyPts = []; selected = -1; renderTools(); paint(); },
      }, label)),
      el("span", { className: "st-spacer" }),
      el("label", { className: "st-hint" }, "outline "),
      el("input", {
        type: "number", min: 0, max: 8, value: sw, style: "width:44px",
        title: "Outline thickness (0 = filled only)",
        oninput: (ev: Event) => { sw = Number((ev.target as HTMLInputElement).value); applyStyleToSelection(); },
      })
    );
    hintLine.textContent = TOOLS.find(([t]) => t === tool)?.[2] ?? "";
  };

  // ---- palette ----
  let paintTarget: "fill" | "stroke" = "fill";
  const renderPalette = () => {
    paletteRow.replaceChildren(
      el("button", {
        className: `st-chip ${paintTarget === "fill" ? "st-on" : ""}`, title: "Colors set the shape's fill",
        onclick: () => { paintTarget = "fill"; renderPalette(); },
      }, `fill ${fill ?? "—"}`),
      el("button", {
        className: `st-chip ${paintTarget === "stroke" ? "st-on" : ""}`, title: "Colors set the shape's outline",
        onclick: () => { paintTarget = "stroke"; renderPalette(); },
      }, `outline ${stroke ?? "—"}`),
      ...PALETTE.map((c) => el("div", {
        className: "pp-swatch", style: `background:${c}`, title: c,
        onclick: () => { setColor(c); },
      })),
      el("div", {
        className: "pp-swatch", title: "No color (transparent)",
        style: "background:repeating-conic-gradient(#333 0% 25%, #555 0% 50%) 0 0 / 8px 8px",
        onclick: () => { setColor(null); },
      }),
      (() => {
        const inp = el("input", { type: "color", title: "Custom color" }) as HTMLInputElement;
        inp.addEventListener("input", () => setColor(inp.value));
        return inp;
      })()
    );
  };
  const setColor = (c: string | null) => {
    if (paintTarget === "fill") fill = c;
    else stroke = c;
    applyStyleToSelection();
    renderPalette();
  };
  const applyStyleToSelection = () => {
    if (selected < 0) return;
    pushUndo();
    const s = shapes()[selected];
    s.fill = fill;
    s.stroke = stroke;
    s.sw = sw;
    paint();
  };

  // ---- canvas interactions ----
  const toLogical = (ev: MouseEvent): [number, number] => {
    const r = grid.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    const y = ((ev.clientY - r.top) / r.height) * H;
    // Snap to half-units: fine control that still lands on crisp pixels.
    return [Math.round(x * 2) / 2, Math.round(y * 2) / 2];
  };

  const hitTest = (x: number, y: number): number => {
    for (let i = shapes().length - 1; i >= 0; i--) {
      const s = shapes()[i];
      const bb = bounds(s);
      if (x >= bb.x - 1 && x <= bb.x + bb.w + 1 && y >= bb.y - 1 && y <= bb.y + bb.h + 1) return i;
    }
    return -1;
  };

  grid.addEventListener("mousedown", (ev) => {
    const [x, y] = toLogical(ev);
    if (tool === "select") {
      selected = hitTest(x, y);
      if (selected >= 0) {
        const s = shapes()[selected];
        fill = s.fill; stroke = s.stroke; sw = s.sw;
        renderPalette(); renderTools();
        const bb = bounds(s);
        const nearCorner = Math.abs(x - (bb.x + bb.w)) < 2 && Math.abs(y - (bb.y + bb.h)) < 2;
        pushUndo();
        dragging = {
          mode: nearCorner && (s.kind === "rect" || s.kind === "ellipse") ? "resize" : "move",
          startX: x, startY: y, orig: JSON.parse(JSON.stringify(s)),
        };
      }
      paint();
      return;
    }
    if (tool === "polygon") {
      polyPts.push([x, y]);
      paint();
      return;
    }
    pushUndo();
    const base: Shape = { kind: "rect", x, y, w: 0, h: 0, fill, stroke, sw };
    if (tool === "rect") shapes().push({ ...base, kind: "rect" });
    else if (tool === "ellipse") shapes().push({ ...base, kind: "ellipse" });
    else if (tool === "line") shapes().push({ ...base, kind: "line", x2: x, y2: y, stroke: stroke ?? fill ?? "#fff", sw: Math.max(1, sw) });
    else if (tool === "draw") shapes().push({ ...base, kind: "path", pts: [[x, y]], stroke: stroke ?? fill ?? "#fff", fill: null, sw: Math.max(1, sw) });
    selected = shapes().length - 1;
    dragging = { mode: "new", startX: x, startY: y };
    paint();
  });

  grid.addEventListener("dblclick", () => {
    if (tool === "polygon" && polyPts.length >= 3) {
      pushUndo();
      shapes().push({
        kind: "polygon", x: 0, y: 0, w: 0, h: 0, pts: [...polyPts], fill, stroke, sw,
      });
      selected = shapes().length - 1;
      polyPts = [];
      paint();
    }
  });

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  function onMove(ev: MouseEvent): void {
    if (!dragging || selected < 0) return;
    const [x, y] = toLogical(ev);
    const s = shapes()[selected];
    const dx = x - dragging.startX, dy = y - dragging.startY;
    if (dragging.mode === "new") {
      if (s.kind === "line") { s.x2 = x; s.y2 = y; }
      else if (s.kind === "path") s.pts!.push([x, y]);
      else {
        s.x = Math.min(dragging.startX, x); s.y = Math.min(dragging.startY, y);
        s.w = Math.abs(dx); s.h = Math.abs(dy);
      }
    } else if (dragging.mode === "move") {
      const o = dragging.orig!;
      s.x = o.x + dx; s.y = o.y + dy;
      if (s.kind === "line") { s.x2 = (o.x2 ?? 0) + dx; s.y2 = (o.y2 ?? 0) + dy; }
      if (s.pts && o.pts) s.pts = o.pts.map(([px, py]) => [px + dx, py + dy] as [number, number]);
    } else if (dragging.mode === "resize") {
      const o = dragging.orig!;
      s.w = Math.max(0.5, o.w + dx); s.h = Math.max(0.5, o.h + dy);
    }
    paint();
  }
  function onUp(): void {
    if (dragging?.mode === "new" && selected >= 0) {
      const s = shapes()[selected];
      // A no-drag click leaves a degenerate speck — drop it.
      if ((s.kind === "rect" || s.kind === "ellipse") && (s.w < 0.5 || s.h < 0.5)) {
        shapes().pop();
        selected = -1;
      }
    }
    dragging = null;
    paint();
  }

  window.addEventListener("keydown", onKey);
  function onKey(ev: KeyboardEvent): void {
    if (!document.body.contains(modal)) {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      return;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") deleteSelected();
    if (ev.key === "z" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); undo(); }
    if (ev.key === "Escape") { polyPts = []; selected = -1; paint(); }
  }

  const deleteSelected = () => {
    if (selected < 0) return;
    pushUndo();
    shapes().splice(selected, 1);
    selected = -1;
    paint();
  };
  const undo = () => {
    const prev = undoStack.pop();
    if (prev === undefined) return;
    frames[current].shapes = JSON.parse(prev);
    selected = -1;
    paint();
  };
  const reorder = (dir: -1 | 1) => {
    if (selected < 0) return;
    pushUndo();
    const arr = shapes();
    const [s] = arr.splice(selected, 1);
    if (dir < 0) { arr.unshift(s); selected = 0; }
    else { arr.push(s); selected = arr.length - 1; }
    paint();
  };

  // ---- painting ----
  function paint(): void {
    const ctx = grid.getContext("2d")!;
    ctx.clearRect(0, 0, grid.width, grid.height);
    // checker + unit grid
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        ctx.fillStyle = (gx + gy) % 2 ? "#221c38" : "#2a2342";
        ctx.fillRect(gx * SCALE, gy * SCALE, SCALE, SCALE);
      }
    }
    ctx.save();
    ctx.scale(SCALE, SCALE);
    for (const s of shapes()) drawShape(ctx, s);
    // polygon-in-progress preview
    if (polyPts.length) {
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 1 / SCALE;
      ctx.beginPath();
      polyPts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
    }
    ctx.restore();
    // selection box + resize handle
    if (selected >= 0 && shapes()[selected]) {
      const bb = bounds(shapes()[selected]);
      ctx.strokeStyle = "#ffd166";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(bb.x * SCALE - 2, bb.y * SCALE - 2, bb.w * SCALE + 4, bb.h * SCALE + 4);
      ctx.setLineDash([]);
      const s = shapes()[selected];
      if (s.kind === "rect" || s.kind === "ellipse") {
        ctx.fillStyle = "#ffd166";
        ctx.fillRect((bb.x + bb.w) * SCALE - 3, (bb.y + bb.h) * SCALE - 3, 6, 6);
      }
    }
    paintPreview();
    renderFrameStrip();
  }

  function paintPreview(): void {
    const ctx = preview.getContext("2d")!;
    ctx.clearRect(0, 0, 64, 64);
    const s = Math.min(64 / W, 64 / H);
    ctx.save();
    ctx.translate((64 - W * s) / 2, (64 - H * s) / 2);
    ctx.scale(s, s);
    for (const sh of shapes()) drawShape(ctx, sh);
    ctx.restore();
  }

  function renderFrameStrip(): void {
    if (!opts.multiFrame) return;
    frameStrip.replaceChildren(
      ...frames.map((f, i) => {
        const cv = el("canvas", {
          className: `pp-framethumb ${i === current ? "pp-active" : ""}`, width: 32, height: 32,
          onclick: () => { current = i; selected = -1; undoStack.length = 0; paint(); },
        }) as HTMLCanvasElement;
        const ctx = cv.getContext("2d")!;
        const sc = Math.min(32 / W, 32 / H);
        ctx.save();
        ctx.translate((32 - W * sc) / 2, (32 - H * sc) / 2);
        ctx.scale(sc, sc);
        for (const sh of f.shapes) drawShape(ctx, sh);
        ctx.restore();
        return cv;
      }),
      el("button", {
        className: "pp-btn", title: "Add an empty frame",
        onclick: () => { frames.push({ shapes: [] }); current = frames.length - 1; selected = -1; paint(); },
      }, "+"),
      el("button", {
        className: "pp-btn", title: "Duplicate this frame",
        onclick: () => {
          frames.splice(current + 1, 0, JSON.parse(JSON.stringify(frames[current])));
          current++; paint();
        },
      }, "⧉"),
      frames.length > 1 ? el("button", {
        className: "pp-btn", title: "Delete this frame",
        onclick: () => { frames.splice(current, 1); current = Math.max(0, current - 1); paint(); },
      }, "−") : el("span", {}),
      (() => {
        const inp = el("input", {
          type: "number", min: 1, max: 24, value: fps, style: "width:44px", title: "frames per second",
        }) as HTMLInputElement;
        inp.addEventListener("input", () => (fps = Math.max(1, Math.min(24, Number(inp.value) || 6))));
        return inp;
      })()
    );
  }

  function save(): void {
    const out = frames
      .filter((f) => f.shapes.length > 0 || frames.length === 1)
      .map((f) => frameToUri(f, W, H));
    if (!out.length || frames.every((f) => !f.shapes.length)) {
      toast("Nothing drawn yet — add some shapes first.", false);
      return;
    }
    opts.onSave(out, fps);
    close();
  }

  renderTools();
  renderPalette();
  paint();
  document.body.append(modal);
}

// ---- shape drawing (canvas mirror of the SVG output) ----

function drawShape(ctx: CanvasRenderingContext2D, s: Shape): void {
  ctx.beginPath();
  if (s.kind === "rect") ctx.rect(s.x, s.y, s.w, s.h);
  else if (s.kind === "ellipse") ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
  else if (s.kind === "line") { ctx.moveTo(s.x, s.y); ctx.lineTo(s.x2 ?? s.x, s.y2 ?? s.y); }
  else if (s.pts?.length) {
    s.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    if (s.kind === "polygon") ctx.closePath();
  }
  if (s.fill && s.kind !== "line" && s.kind !== "path") { ctx.fillStyle = s.fill; ctx.fill(); }
  if (s.stroke && s.sw > 0) { ctx.strokeStyle = s.stroke; ctx.lineWidth = s.sw; ctx.stroke(); }
}

function bounds(s: Shape): { x: number; y: number; w: number; h: number } {
  if (s.kind === "line") {
    const x = Math.min(s.x, s.x2 ?? s.x), y = Math.min(s.y, s.y2 ?? s.y);
    return { x, y, w: Math.abs((s.x2 ?? s.x) - s.x), h: Math.abs((s.y2 ?? s.y) - s.y) };
  }
  if (s.pts?.length) {
    const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

// ---- SVG serialization + round-trip ----

function frameToUri(f: Frame, W: number, H: number): string {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const attr = (s: Shape) =>
    `fill="${s.fill ?? "none"}" stroke="${s.stroke ?? "none"}" stroke-width="${s.sw}" stroke-linecap="round" stroke-linejoin="round"`;
  const body = f.shapes.map((s) => {
    if (s.kind === "rect") return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" ${attr(s)}/>`;
    if (s.kind === "ellipse") return `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${s.w / 2}" ry="${s.h / 2}" ${attr(s)}/>`;
    if (s.kind === "line") return `<line x1="${s.x}" y1="${s.y}" x2="${s.x2 ?? s.x}" y2="${s.y2 ?? s.y}" ${attr(s)}/>`;
    const pts = (s.pts ?? []).map(([x, y]) => `${x},${y}`).join(" ");
    if (s.kind === "polygon") return `<polygon points="${pts}" ${attr(s)}/>`;
    return `<polyline points="${pts}" ${attr(s)}/>`;
  }).join("");
  const shapesJson = esc(JSON.stringify(f.shapes));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${SHAPES_ATTR}="${shapesJson}">${body}</svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

/** Load a data URI back into an editable frame. Own SVGs restore exactly
 *  (embedded shape list); foreign SVGs get a best-effort primitive import;
 *  raster art can't be shape-edited (returns null → caller starts empty). */
function loadFrameFromUri(uri: string): { frame: Frame; dropped: number } | null {
  if (!uri.startsWith("data:image/svg")) return null;
  try {
    const b64 = uri.slice(uri.indexOf(",") + 1);
    const text = decodeURIComponent(escape(atob(b64)));
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const root = doc.documentElement;
    const own = root.getAttribute(SHAPES_ATTR);
    if (own) return { frame: { shapes: JSON.parse(own) as Shape[] }, dropped: 0 };
    // Foreign SVG: harvest primitives we understand; count the rest.
    const shapes: Shape[] = [];
    let dropped = 0;
    const num = (el: Element, a: string) => Number(el.getAttribute(a) ?? 0);
    const style = (el: Element): Pick<Shape, "fill" | "stroke" | "sw"> => ({
      fill: normColor(el.getAttribute("fill")),
      stroke: normColor(el.getAttribute("stroke")),
      sw: Number(el.getAttribute("stroke-width") ?? 1),
    });
    for (const node of root.querySelectorAll("rect,ellipse,circle,line,polygon,polyline")) {
      const t = node.tagName.toLowerCase();
      if (t === "rect") shapes.push({ kind: "rect", x: num(node, "x"), y: num(node, "y"), w: num(node, "width"), h: num(node, "height"), ...style(node) });
      else if (t === "ellipse") shapes.push({ kind: "ellipse", x: num(node, "cx") - num(node, "rx"), y: num(node, "cy") - num(node, "ry"), w: num(node, "rx") * 2, h: num(node, "ry") * 2, ...style(node) });
      else if (t === "circle") shapes.push({ kind: "ellipse", x: num(node, "cx") - num(node, "r"), y: num(node, "cy") - num(node, "r"), w: num(node, "r") * 2, h: num(node, "r") * 2, ...style(node) });
      else if (t === "line") shapes.push({ kind: "line", x: num(node, "x1"), y: num(node, "y1"), x2: num(node, "x2"), y2: num(node, "y2"), w: 0, h: 0, ...style(node) });
      else {
        const pts = (node.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
        const pairs: [number, number][] = [];
        for (let i = 0; i + 1 < pts.length; i += 2) pairs.push([pts[i], pts[i + 1]]);
        if (pairs.length) shapes.push({ kind: t === "polygon" ? "polygon" : "path", x: 0, y: 0, w: 0, h: 0, pts: pairs, ...style(node) });
      }
    }
    dropped = root.querySelectorAll("path,g,image,text,use,defs").length;
    return { frame: { shapes }, dropped };
  } catch {
    return null;
  }
}

function normColor(v: string | null): string | null {
  if (!v || v === "none" || v === "transparent") return null;
  return v;
}

/** Rasterize the asset's current look at its in-game box size and convert
 *  it into flat colored rects (greedy run + downward merge), so procedural
 *  art and PNGs become a tweakable starting point instead of a blank
 *  canvas. Colors are lightly quantized so anti-aliased edges don't shatter
 *  into hundreds of one-pixel specks. */
function vectorizeCurrentLook(
  seedDraw: (ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) => void,
  W: number,
  H: number
): Shape[] {
  // Supersample small boxes: at 12×16 raw, a plush bear's ears and face
  // melt into a blob — rasterizing finer (then scaling shape coords back
  // down) keeps the features recognizable and individually editable.
  const SS = Math.max(1, Math.min(4, Math.ceil(48 / Math.max(W, H))));
  const RW = W * SS, RH = H * SS;
  const cell = Math.max(RW, RH);
  const cv = document.createElement("canvas");
  cv.width = RW;
  cv.height = RH;
  const ctx = cv.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  // seedDraw centers the art inside a square cell; shift so the fitted art
  // lands exactly on our canvas.
  seedDraw(ctx, -(cell - RW) / 2, -(cell - RH) / 2, cell);
  const data = ctx.getImageData(0, 0, RW, RH).data;
  const q = (v: number) => Math.min(255, Math.round(v / 17) * 17); // 16-level quantize
  const colorAt = (x: number, y: number): string | null => {
    const i = (y * RW + x) * 4;
    if (data[i + 3] < 96) return null; // transparent-ish: background
    return `#${[q(data[i]), q(data[i + 1]), q(data[i + 2])]
      .map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  };
  const used = new Uint8Array(RW * RH);
  const shapes: Shape[] = [];
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < RW; x++) {
      if (used[y * RW + x]) continue;
      const c = colorAt(x, y);
      if (!c) { used[y * RW + x] = 1; continue; }
      // Extend the run rightward…
      let w = 1;
      while (x + w < RW && !used[y * RW + x + w] && colorAt(x + w, y) === c) w++;
      // …then extend the whole run downward while every pixel matches.
      let h = 1;
      down: while (y + h < RH) {
        for (let dx = 0; dx < w; dx++) {
          if (used[(y + h) * RW + x + dx] || colorAt(x + dx, y + h) !== c) break down;
        }
        h++;
      }
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) used[(y + dy) * RW + x + dx] = 1;
      }
      // Back to logical (in-game box) coordinates.
      shapes.push({ kind: "rect", x: x / SS, y: y / SS, w: w / SS, h: h / SS, fill: c, stroke: null, sw: 0 });
    }
  }
  return shapes;
}
