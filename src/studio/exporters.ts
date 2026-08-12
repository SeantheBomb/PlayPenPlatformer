// Art Studio export helpers: hand art back to the artist's own tools.
import { loadImage } from "./importers";

function download(uri: string, filename: string): void {
  const a = document.createElement("a");
  a.href = uri;
  a.download = filename;
  a.click();
}

/** One frame, at its stored (native) resolution. */
export function downloadFrame(uri: string, name: string): void {
  const ext = uri.startsWith("data:image/svg") ? "svg" : "png";
  download(uri, `${name}.${ext}`);
}

/** All frames side-by-side as one horizontal strip PNG — re-imports
 *  losslessly here AND opens straight in Aseprite as a sheet. */
export async function downloadStrip(frames: string[], name: string): Promise<void> {
  if (frames.length === 1) return downloadFrame(frames[0], name);
  const imgs = await Promise.all(frames.map(loadImage));
  const fw = Math.max(...imgs.map((i) => i.naturalWidth));
  const fh = Math.max(...imgs.map((i) => i.naturalHeight));
  const cv = document.createElement("canvas");
  cv.width = fw * imgs.length;
  cv.height = fh;
  const ctx = cv.getContext("2d")!;
  imgs.forEach((img, i) => ctx.drawImage(img, i * fw, 0));
  download(cv.toDataURL("image/png"), `${name}-strip${frames.length}.png`);
}

export interface SheetEntry {
  label: string;
  size: string; // "16×16" — the in-game drawn size, printed under the art
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) => void;
}

/** A labeled contact sheet of everything — reference material for
 *  Photoshop/Aseprite, drawn at 4x so small art is actually legible. */
export function downloadContactSheet(entries: SheetEntry[], title: string): void {
  const CELL = 64, PAD = 10, LABEL_H = 22, COLS = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(entries.length))));
  const rows = Math.ceil(entries.length / COLS);
  const cv = document.createElement("canvas");
  cv.width = COLS * (CELL + PAD) + PAD;
  cv.height = rows * (CELL + LABEL_H + PAD) + PAD + 26;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#17131f";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#ffd166";
  ctx.font = "bold 13px monospace";
  ctx.fillText(`PlayPen — ${title} (${new Date().toISOString().slice(0, 10)})`, PAD, 17);
  entries.forEach((e, i) => {
    const cx = PAD + (i % COLS) * (CELL + PAD);
    const cy = 26 + PAD + Math.floor(i / COLS) * (CELL + LABEL_H + PAD);
    ctx.fillStyle = "#221e30";
    ctx.fillRect(cx, cy, CELL, CELL);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, CELL, CELL);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    e.draw(ctx, cx, cy, CELL);
    ctx.restore();
    ctx.fillStyle = "#d8d2ec";
    ctx.font = "9px monospace";
    ctx.fillText(e.label.slice(0, 11), cx, cy + CELL + 10);
    ctx.fillStyle = "#8f87ad";
    ctx.fillText(e.size, cx, cy + CELL + 19);
  });
  download(cv.toDataURL("image/png"), `playpen-${title.toLowerCase().replace(/\W+/g, "-")}.png`);
}
