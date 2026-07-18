// Built-in pixel sprite editor: paint frames on a small grid, animate, save
// as data-URI PNGs back into content. Opens as a modal over the editor.
import { el } from "./forms";

type Cell = string; // css color, "" = transparent
type Frame = Cell[]; // size*size cells

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
  size?: number; // grid size (default 16)
  frames: string[]; // existing data-URIs to load ([] for new)
  fps: number;
  multiFrame: boolean;
  onSave: (frames: string[], fps: number) => void;
}

export function openPixelEditor(opts: PixelEditorOptions): void {
  const size = opts.size ?? 16;
  const CELL = Math.max(10, Math.floor(320 / size));
  let frames: Frame[] = [];
  let current = 0;
  let color = "#ffd166";
  let erasing = false;
  let fps = opts.fps || 6;
  let painting = false;

  const blankFrame = (): Frame => new Array(size * size).fill("");

  // ---- Load existing frames (draw data-URI to canvas, read pixels) ----
  const loadFrame = (uri: string): Promise<Frame> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = size;
        cv.height = size;
        const c2 = cv.getContext("2d")!;
        c2.imageSmoothingEnabled = false;
        c2.drawImage(img, 0, 0, size, size);
        const data = c2.getImageData(0, 0, size, size).data;
        const frame = blankFrame();
        for (let i = 0; i < size * size; i++) {
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
    cv.width = size;
    cv.height = size;
    const c2 = cv.getContext("2d")!;
    for (let i = 0; i < size * size; i++) {
      if (!frame[i]) continue;
      c2.fillStyle = frame[i];
      c2.fillRect(i % size, Math.floor(i / size), 1, 1);
    }
    return cv.toDataURL("image/png");
  };

  // ---- DOM ----
  const gridCanvas = el("canvas", {
    width: size * CELL, height: size * CELL, className: "pp-pixgrid",
  });
  const previewCanvas = el("canvas", { width: 64, height: 64, className: "pp-pixpreview" });
  const frameStrip = el("div", { className: "pp-framestrip" });
  const paletteRow = el("div", { className: "pp-paletterow" });

  const drawGrid = () => {
    const ctx = gridCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, size * CELL, size * CELL);
    // checker background
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = (x + y) % 2 ? "#221e30" : "#1a1626";
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    const frame = frames[current];
    for (let i = 0; i < size * size; i++) {
      if (!frame[i]) continue;
      ctx.fillStyle = frame[i];
      ctx.fillRect((i % size) * CELL, Math.floor(i / size) * CELL, CELL, CELL);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i <= size; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, size * CELL); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(size * CELL, i * CELL); ctx.stroke();
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
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    frames[current][y * size + x] = erasing ? "" : color;
    drawGrid();
  };
  gridCanvas.addEventListener("mousedown", (e) => { painting = true; paintCell(e); });
  gridCanvas.addEventListener("mousemove", (e) => { if (painting) paintCell(e); });
  window.addEventListener("mouseup", () => (painting = false));

  // Animated preview
  const previewTimer = window.setInterval(() => {
    const pc = previewCanvas.getContext("2d")!;
    pc.imageSmoothingEnabled = false;
    pc.clearRect(0, 0, 64, 64);
    const idx = opts.multiFrame && frames.length > 0
      ? Math.floor((performance.now() / 1000) * fps) % frames.length
      : current;
    const f = frames[idx];
    if (!f) return;
    const s = 64 / size;
    for (let i = 0; i < size * size; i++) {
      if (!f[i]) continue;
      pc.fillStyle = f[i];
      pc.fillRect((i % size) * s, Math.floor(i / size) * s, s, s);
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
      el("div", { className: "pp-pixcols" },
        el("div", {}, gridCanvas, paletteRow),
        el("div", { className: "pp-pixside" },
          el("div", { className: "pp-hint" }, "preview"),
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
