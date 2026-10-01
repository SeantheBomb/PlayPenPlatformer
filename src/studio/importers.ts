// Art Studio import pipeline: turns whatever the artist drops on us —
// PNG/WebP stills, Aseprite horizontal-strip sheets, numbered frame
// sequences, GIFs, SVGs, and native .aseprite source files — into clean
// sprite frames (data URIs). All the format smarts live here so the studio
// UI can stay a dumb drop target.
import { composeFrame, parseAseprite, type AseImport } from "./aseprite";

export interface ImportResult {
  /** Ready-to-use frames (data URIs). One entry = a still. */
  frames: string[];
  /** Human-readable, artist-toned notes about what we did or fixed. */
  notes: string[];
  /** Hard problems, artist-toned. If non-empty, frames may be empty too. */
  errors: string[];
  /** Set when a single PNG looks like a horizontal strip (width divides
   *  evenly by height): the studio offers "split into N frames?" */
  stripCandidate?: { uri: string; count: number };
  /** Set for a native .aseprite/.ase drop: the whole flattened timeline plus
   *  its tags and per-frame timing. `frames` above holds the whole timeline
   *  too, so slots that only want a still keep working unchanged; slots that
   *  animate ask which tag to use (asepick.ts). */
  aseprite?: AseImport;
}

const WARN_BYTES = 300 * 1024; // ~300KB: worth a heads-up (bundle size)
const BLOCK_BYTES = 3 * 1024 * 1024; // 3MB: refuse — would bloat the game for every player

/** Decode one dropped/browsed FileList into frames, in a stable order. */
export async function importFiles(files: File[]): Promise<ImportResult> {
  const out: ImportResult = { frames: [], notes: [], errors: [] };
  // Numbered sequences ("run1.png, run2.png, …") should animate in order
  // regardless of pick order in the file dialog.
  const sorted = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
  for (const f of sorted) {
    if (f.size > BLOCK_BYTES) {
      out.errors.push(
        `"${f.name}" is ${mb(f.size)} — that's too big to ship inside the game ` +
        `(every player downloads all art on load). Try exporting it smaller.`
      );
      continue;
    }
    const name = f.name.toLowerCase();
    try {
      if (name.endsWith(".aseprite") || name.endsWith(".ase")) {
        if (sorted.length > 1) {
          out.errors.push(`Drop "${f.name}" on its own — an Aseprite file already holds every frame, so it can't be mixed with other files.`);
          continue;
        }
        const one = await importAseprite(f);
        out.frames.push(...one.frames);
        out.notes.push(...one.notes);
        out.errors.push(...one.errors);
        out.aseprite = one.aseprite;
      } else if (name.endsWith(".svg") || f.type === "image/svg+xml") {
        const one = await importSvg(f);
        out.frames.push(...one.frames);
        out.notes.push(...one.notes);
        out.errors.push(...one.errors);
      } else if (name.endsWith(".gif") || f.type === "image/gif") {
        const one = await importGif(f);
        out.frames.push(...one.frames);
        out.notes.push(...one.notes);
        out.errors.push(...one.errors);
      } else if (f.type.startsWith("image/")) {
        const uri = await fileToDataUri(f);
        const dims = await imageSize(uri);
        // A lone wide image with an exact-multiple width reads as an
        // Aseprite horizontal strip export — offer to split it.
        if (
          sorted.length === 1 && dims && dims.h > 0 &&
          dims.w > dims.h && dims.w % dims.h === 0
        ) {
          out.stripCandidate = { uri, count: dims.w / dims.h };
        }
        out.frames.push(uri);
      } else {
        out.errors.push(`"${f.name}" isn't an image file I understand (PNG, GIF, WebP, SVG, or .aseprite).`);
      }
      if (f.size > WARN_BYTES && f.size <= BLOCK_BYTES) {
        out.notes.push(`"${f.name}" is ${mb(f.size)} — it'll work, but smaller exports keep the game loading fast.`);
      }
    } catch (e) {
      out.errors.push(`Couldn't read "${f.name}" (${(e as Error).message ?? "unknown error"}).`);
    }
  }
  return out;
}

/**
 * A native Aseprite source file: parse, flatten every frame the way
 * Aseprite's own export does (visible layers only — verified pixel-exact
 * against a real export), and hand back the timeline plus its tags. Which tag
 * lands in which slot is the studio's call, not ours.
 */
async function importAseprite(f: File): Promise<ImportResult & { aseprite?: AseImport }> {
  const out: ImportResult & { aseprite?: AseImport } = { frames: [], notes: [], errors: [] };
  let file;
  try {
    file = await parseAseprite(new Uint8Array(await f.arrayBuffer()));
  } catch (e) {
    out.errors.push(`Couldn't read "${f.name}" as an Aseprite file — ${(e as Error).message}.`);
    return out;
  }
  const cv = document.createElement("canvas");
  cv.width = file.width;
  cv.height = file.height;
  const g = cv.getContext("2d")!;
  const frames: string[] = [];
  let bytes = 0;
  for (let i = 0; i < file.frames.length; i++) {
    const px = composeFrame(file, i);
    g.putImageData(new ImageData(new Uint8ClampedArray(px), file.width, file.height), 0, 0);
    const uri = cv.toDataURL("image/png");
    bytes += uri.length * 0.75;
    frames.push(uri);
  }
  out.frames = frames;
  out.aseprite = {
    fileName: f.name, width: file.width, height: file.height,
    frames, durations: file.frames.map((fr) => fr.duration), tags: file.tags,
  };
  const tagText = file.tags.length
    ? ` — tags: ${file.tags.map((t) => `${t.name} (${t.to - t.from + 1})`).join(", ")}`
    : "";
  out.notes.push(`Read “${f.name}”: ${file.frames.length} frame${file.frames.length === 1 ? "" : "s"} at ${file.width}×${file.height}${tagText}.`);
  const hidden = file.layers.filter((l) => l.type === 0 && !l.visible).map((l) => `“${l.name}”`);
  if (hidden.length) {
    out.notes.push(`Hidden layers were left out, same as Aseprite's own export: ${hidden.join(", ")}. Show them in Aseprite to include them.`);
  }
  out.notes.push(...file.warnings);
  if (bytes > WARN_BYTES) {
    out.notes.push(`All frames together come to ${mb(bytes)} — it'll work, but cropping the canvas tighter in Aseprite keeps the game loading fast.`);
  }
  return out;
}

/** Slice a horizontal strip into square frames. */
export async function sliceStrip(uri: string, count: number): Promise<string[]> {
  const img = await loadImage(uri);
  const fw = Math.floor(img.naturalWidth / count);
  const frames: string[] = [];
  const cv = document.createElement("canvas");
  cv.width = fw;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext("2d")!;
  for (let i = 0; i < count; i++) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, i * fw, 0, fw, img.naturalHeight, 0, 0, fw, img.naturalHeight);
    frames.push(cv.toDataURL("image/png"));
  }
  return frames;
}

// ---- SVG: sanitize before it ever touches the game ----
// - must end up with root width/height (else it never draws: naturalWidth 0)
// - <foreignObject> would taint the canvas and break player bug-report
//   screenshots for everyone — hard reject
// - scripts/event handlers stripped (defense in depth; <img> wouldn't run
//   them anyway)
// - external references (href to http/file) can't load inside an <img> —
//   warn, since the art would render with holes
async function importSvg(f: File): Promise<ImportResult> {
  const out: ImportResult = { frames: [], notes: [], errors: [] };
  const text = await f.text();
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (root.tagName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) {
    out.errors.push(`"${f.name}" doesn't look like a valid SVG file.`);
    return out;
  }
  if (doc.querySelector("foreignObject")) {
    out.errors.push(
      `"${f.name}" contains a <foreignObject>, which the game can't safely draw. ` +
      `Re-export it as plain shapes/paths (most apps have a "flatten" or "outline" option).`
    );
    return out;
  }
  for (const s of [...doc.querySelectorAll("script")]) s.remove();
  for (const el of [...doc.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
    }
  }
  const external = [...doc.querySelectorAll("[href], [*|href]")].some((el) => {
    const href = el.getAttribute("href") ?? el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "";
    return /^(https?:|file:|\/)/i.test(href);
  });
  if (external) {
    out.notes.push(
      `"${f.name}" links to outside files (images or fonts) — those won't show up in-game. ` +
      `Embed images and convert text to outlines when exporting.`
    );
  }
  if (doc.querySelector("text")) {
    out.notes.push(
      `"${f.name}" has live text — if the font isn't embedded it'll draw differently in-game. ` +
      `Converting text to outlines/paths is safest.`
    );
  }
  // Inject width/height from viewBox if missing (the silent never-draws bug).
  if (!root.getAttribute("width") || !root.getAttribute("height")) {
    const vb = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      root.setAttribute("width", String(vb[2]));
      root.setAttribute("height", String(vb[3]));
      out.notes.push(`Set "${f.name}"'s size to ${vb[2]}×${vb[3]} (from its viewBox) so the game can draw it.`);
    } else {
      out.errors.push(
        `"${f.name}" has no size (no width/height or viewBox) — the game wouldn't be able to draw it. ` +
        `Set an artboard/document size and re-export.`
      );
      return out;
    }
  }
  const cleaned = new XMLSerializer().serializeToString(root);
  const uri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(cleaned)))}`;
  // Prove it decodes before accepting it.
  const dims = await imageSize(uri);
  if (!dims) {
    out.errors.push(`"${f.name}" couldn't be drawn by the browser after cleanup — try re-exporting it.`);
    return out;
  }
  out.frames.push(uri);
  return out;
}

// ---- GIF: decode frames where the browser can (ImageDecoder — Chrome/Edge);
// otherwise fall back to the first frame as a still. ----
async function importGif(f: File): Promise<ImportResult> {
  const out: ImportResult = { frames: [], notes: [], errors: [] };
  type ImageDecoderCtor = new (init: { data: ArrayBuffer; type: string }) => {
    tracks: { ready: Promise<void>; selectedTrack?: { frameCount: number } | null };
    decode(opts: { frameIndex: number }): Promise<{ image: ImageBitmap & { displayWidth: number; displayHeight: number } }>;
  };
  const Decoder = (window as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  if (Decoder) {
    const dec = new Decoder({ data: await f.arrayBuffer(), type: "image/gif" });
    await dec.tracks.ready;
    const count = dec.tracks.selectedTrack?.frameCount ?? 1;
    const cv = document.createElement("canvas");
    for (let i = 0; i < count; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      cv.width = image.displayWidth;
      cv.height = image.displayHeight;
      const ctx = cv.getContext("2d")!;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(image, 0, 0);
      out.frames.push(cv.toDataURL("image/png"));
    }
    if (count > 1) out.notes.push(`Split "${f.name}" into ${count} animation frames.`);
  } else {
    out.frames.push(await fileToDataUri(f));
    out.notes.push(`This browser can't split GIF frames — "${f.name}" imported as a still image.`);
  }
  return out;
}

// ---- small shared helpers ----

export function fileToDataUri(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(f);
  });
}

export function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = uri;
  });
}

export async function imageSize(uri: string): Promise<{ w: number; h: number } | null> {
  try {
    const img = await loadImage(uri);
    return img.naturalWidth > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  } catch {
    return null;
  }
}

function mb(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${Math.round(bytes / 1024)}KB`;
}
