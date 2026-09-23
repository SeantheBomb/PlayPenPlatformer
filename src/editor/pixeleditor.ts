// Built-in pixel sprite editor: paint frames on a small grid, animate, save
// as data-URI PNGs back into content. Opens as a modal over the editor.
import { el } from "./forms";

type Cell = string; // css color, "" = transparent
type Frame = Cell[]; // GW*GH cells, row-major

const PALETTE = [
  "#000000", "#ffffff", "#9aa7b8", "#57536e", "#3d3a52",
  "#ffd166", "#e8b04b", "#b08757", "#c84b6a", "#ff5470",
  "#9b5de5", "#7fd8e8", "#5ad1a5", "#8bd44f", "#d98fb0", "#f4ead8",
];

/** Rasterize a procedural draw call into a data-URI (pixel editor seed). */
export function rasterize(size: number, draw: (ctx: CanvasRenderingContext2D) => void): string {
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  draw(cv.getContext("2d")!);
  return cv.toDataURL("image/png");
}

export interface PixelEditorOptions {
  title: string;
  size?: number; // square grid size (default 16)
  /** Non-square grid (overrides size per axis) — e.g. a 2×1 tile pattern. */
  width?: number;
  height?: number;
  /** Draw stronger guide lines every N cells — where each in-game tile's
   *  slice of a world-aligned tile pattern begins/ends. */
  tileLines?: { everyX: number; everyY: number };
  /** Preview the art REPEATED (as it tiles across the world) instead of a
   *  single copy, so seams show up while painting. */
  tiledPreview?: boolean;
  /** Extra explanatory line under the title. */
  note?: string;
  frames: string[]; // existing data-URIs to load ([] for new)
  fps: number;
  multiFrame: boolean;
  onSave: (frames: string[], fps: number) => void;
}

export function openPixelEditor(opts: PixelEditorOptions): void {
  const GW = opts.width ?? opts.size ?? 16;
  const GH = opts.height ?? opts.size ?? 16;
  const CELL = Math.max(3, Math.floor(320 / Math.max(GW, GH)));
  let frames: Frame[] = [];
  let current = 0;
  let color = "#ffd166";
  let erasing = false;
  let fps = opts.fps || 6;
  let painting = false;

  const blankFrame = (): Frame => new Array(GW * GH).fill("");

  // ---- Load existing frames (draw data-URI to canvas, read pixels) ----
  const loadFrame = (uri: string): Promise<Frame> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = GW;
        cv.height = GH;
        const c2 = cv.getContext("2d")!;
        c2.imageSmoothingEnabled = false;
        c2.drawImage(img, 0, 0, GW, GH);
        const data = c2.getImageData(0, 0, GW, GH).data;
        const frame = blankFrame();
        for (let i = 0; i < GW * GH; i++) {
          const a = data[i * 4 + 3];
          if (a > 20) {
            frame[i] = `rgba(${data[i * 4]},${data[i * 4 + 1]},${data[i * 4 + 2]},${(a / 255).toFixed(2)})`;
          }
        }
        resolve(frame);
      };
      img.onerror = () => resolve(blankFrame());
      img.src = uri;
    });

  const frameToUri = (frame: Frame): string => {
    const cv = document.createElement("canvas");
    cv.width = GW;
    cv.height = GH;
    const c2 = cv.getContext("2d")!;
    for (let i = 0; i < GW * GH; i++) {
      if (!frame[i]) continue;
      c2.fillStyle = frame[i];
      c2.fillRect(i % GW, Math.floor(i / GW), 1, 1);
    }
    return cv.toDataURL("image/png");
  };

  // ---- DOM ----
  const gridCanvas = el("canvas", {
    width: GW * CELL, height: GH * CELL, className: "pp-pixgrid",
  });
  const PREV = opts.tiledPreview ? 128 : 64;
  const previewCanvas = el("canvas", { width: PREV, height: PREV, className: "pp-pixpreview" });
  const frameStrip = el("div", { className: "pp-framestrip" });
  const paletteRow = el("div", { className: "pp-paletterow" });

  const drawGrid = () => {
    const ctx = gridCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, GW * CELL, GH * CELL);
    // checker background
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        ctx.fillStyle = (x + y) % 2 ? "#221e30" : "#1a1626";
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    const frame = frames[current];
    for (let i = 0; i < GW * GH; i++) {
      if (!frame[i]) continue;
      ctx.fillStyle = frame[i];
      ctx.fillRect((i % GW) * CELL, Math.floor(i / GW) * CELL, CELL, CELL);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i <= GW; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, GH * CELL); ctx.stroke();
    }
    for (let i = 0; i <= GH; i++) {
      ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(GW * CELL, i * CELL); ctx.stroke();
    }
    if (opts.tileLines) {
      // Each in-game tile's slice of the pattern — gold, dashed, so it
      // reads as a guide and not as part of the art.
      ctx.save();
      ctx.strokeStyle = "rgba(255,209,102,0.7)";
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      for (let x = opts.tileLines.everyX; x < GW; x += opts.tileLines.everyX) {
        ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, GH * CELL); ctx.stroke();
      }
      for (let y = opts.tileLines.everyY; y < GH; y += opts.tileLines.everyY) {
        ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(GW * CELL, y * CELL); ctx.stroke();
      }
      ctx.restore();
    }
  };

  const renderFrameStrip = () => {
    frameStrip.replaceChildren();
    if (!opts.multiFrame) return;
    frames.forEach((f, i) => {
      const thumb = el("canvas", {
        width: 32, height: 32,
        className: "pp-framethumb" + (i === current ? " pp-active" : ""),
        onclick: () => { current = i; drawGrid(); renderFrameStrip(); },
      });
      const tc = thumb.getContext("2d")!;
      tc.imageSmoothingEnabled = false;
      const img = new Image();
      img.onload = () => tc.drawImage(img, 0, 0, 32, 32);
      img.src = frameToUri(f);
      frameStrip.append(thumb);
    });
    frameStrip.append(
      el("button", {
        className: "pp-btn", title: "add empty frame",
        onclick: () => { frames.push(blankFrame()); current = frames.length - 1; drawGrid(); renderFrameStrip(); },
      }, "+"),
      el("button", {
        className: "pp-btn", title: "duplicate current frame",
        onclick: () => { frames.splice(current + 1, 0, [...frames[current]]); current++; drawGrid(); renderFrameStrip(); },
      }, "⧉"),
      el("button", {
        className: "pp-btn pp-danger", title: "delete current frame",
        onclick: () => {
          if (frames.length <= 1) return;
          frames.splice(current, 1);
          current = Math.max(0, current - 1);
          drawGrid(); renderFrameStrip();
        },
      }, "✕")
    );
  };

  const renderPalette = () => {
    paletteRow.replaceChildren();
    for (const c of PALETTE) {
      const b = el("button", {
        className: "pp-swatch" + (c === color && !erasing ? " pp-active" : ""),
        onclick: () => { color = c; erasing = false; renderPalette(); },
      });
      b.style.background = c;
      paletteRow.append(b);
    }
    const custom = el("input", {
      type: "color", value: color.startsWith("#") ? color : "#ffffff",
      oninput: (e) => { color = (e.target as HTMLInputElement).value; erasing = false; renderPalette(); },
    });
    const eraser = el("button", {
      className: "pp-btn" + (erasing ? " pp-active" : ""),
      onclick: () => { erasing = !erasing; renderPalette(); },
    }, "eraser");
    paletteRow.append(custom, eraser);
  };

  const paintCell = (e: MouseEvent) => {
    const r = gridCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / CELL);
    const y = Math.floor((e.clientY - r.top) / CELL);
    if (x < 0 || y < 0 || x >= GW || y >= GH) return;
    frames[current][y * GW + x] = erasing ? "" : color;
    drawGrid();
  };
  gridCanvas.addEventListener("mousedown", (e) => { painting = true; paintCell(e); });
  gridCanvas.addEventListener("mousemove", (e) => { if (painting) paintCell(e); });
  window.addEventListener("mouseup", () => (painting = false));

  // Animated preview
  const previewTimer = window.setInterval(() => {
    const pc = previewCanvas.getContext("2d")!;
    pc.imageSmoothingEnabled = false;
    pc.clearRect(0, 0, PREV, PREV);
    const idx = opts.multiFrame && frames.length > 0
      ? Math.floor((performance.now() / 1000) * fps) % frames.length
      : current;
    const f = frames[idx];
    if (!f) return;
    // Tiled: 2 repeats along the longer side, so every seam is visible.
    const reps = opts.tiledPreview ? 2 : 1;
    const s = PREV / (Math.max(GW, GH) * reps);
    const repsX = opts.tiledPreview ? Math.ceil(PREV / (GW * s)) : 1;
    const repsY = opts.tiledPreview ? Math.ceil(PREV / (GH * s)) : 1;
    for (let ry = 0; ry < repsY; ry++) {
      for (let rx = 0; rx < repsX; rx++) {
        const ox = rx * GW * s, oy = ry * GH * s;
        for (let i = 0; i < GW * GH; i++) {
          if (!f[i]) continue;
          pc.fillStyle = f[i];
          pc.fillRect(ox + (i % GW) * s, oy + Math.floor(i / GW) * s, s, s);
        }
      }
    }
  }, 80);

  const fpsInput = el("input", {
    type: "number", value: fps, min: 1, max: 24,
    oninput: (e) => { fps = Math.max(1, parseInt((e.target as HTMLInputElement).value) || 6); },
  });
  fpsInput.style.width = "52px";

  const close = () => {
    clearInterval(previewTimer);
    modal.remove();
  };

  const modal = el(
    "div", { className: "pp-pixmodal" },
    el("div", { className: "pp-pixpanel" },
      el("div", { className: "pp-sidehead" },
        opts.title,
        el("span", {}, "")
      ),
      opts.note ? el("div", { className: "pp-hint", style: "max-width:520px;margin-top:4px" }, opts.note) : null,
      el("div", { className: "pp-pixcols" },
        el("div", {}, gridCanvas, paletteRow),
        el("div", { className: "pp-pixside" },
          el("div", { className: "pp-hint" }, opts.tiledPreview ? "preview — repeated like in the world" : "preview"),
          previewCanvas,
          opts.multiFrame
            ? el("div", { className: "pp-hint", style: "margin-top:8px" }, "frames · fps:")
            : null,
          opts.multiFrame ? el("div", {}, fpsInput) : null,
          frameStrip
        )
      ),
      el("div", { className: "pp-btnrow" },
        el("button", {
          className: "pp-btn pp-primary",
          onclick: () => {
            opts.onSave(frames.map(frameToUri), fps);
            close();
          },
        }, "Save sprite"),
        el("button", { className: "pp-btn", onclick: close }, "Cancel")
      )
    )
  );

  // Load initial frames then show
  (async () => {
    if (opts.frames.length > 0) {
      frames = await Promise.all(opts.frames.map(loadFrame));
    } else {
      frames = [blankFrame()];
    }
    current = 0;
    drawGrid();
    renderFrameStrip();
    renderPalette();
  })();

  document.body.append(modal);
}
