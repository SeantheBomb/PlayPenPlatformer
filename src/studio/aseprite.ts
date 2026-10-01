// Native .aseprite / .ase reader for the Art Studio — the PlayPen take on the
// Unity Aseprite importer (Sean, 2026-10-01). She drops her SOURCE file and the
// studio flattens it the way Aseprite's own export would, then slices the
// timeline by tag. Pure TypeScript, no DOM and no dependencies: zlib comes from
// the platform's DecompressionStream, and compositing is plain math on RGBA
// buffers (so it's testable in Node and every blend mode matches exactly,
// including Subtract/Divide which have no canvas equivalent).
//
// Format reference: aseprite/docs/ase-file-specs.md. Little-endian throughout.
//
// Supported: RGBA / grayscale / indexed color, raw + compressed + linked cels,
// cel offsets/opacity/z-index, layer visibility (incl. hidden parent groups),
// layer + group opacity, all 19 blend modes, per-frame durations, tags with
// direction, palettes that change mid-animation. Deliberately skipped (with a
// warning, never silently): tilemap layers, reference layers, slices.

export interface AseLayer {
  name: string;
  visible: boolean;
  /** 0 normal, 1 group, 2 tilemap */
  type: number;
  childLevel: number;
  blend: number;
  /** 0..1, already including "opacity valid" header flag handling */
  opacity: number;
  background: boolean;
  reference: boolean;
}

export interface AseCel {
  layer: number;
  x: number;
  y: number;
  /** 0..1 */
  opacity: number;
  zIndex: number;
  /** Decoded pixels in the file's color depth, or a link to another frame. */
  image?: { w: number; h: number; data: Uint8Array };
  linkFrame?: number;
  tilemap?: boolean;
}

export interface AseTag {
  name: string;
  from: number;
  to: number;
  /** 0 forward, 1 reverse, 2 ping-pong, 3 ping-pong reverse */
  direction: number;
  /** 0 = loop forever (Aseprite default), N = play N times */
  repeat: number;
}

export interface AseFile {
  width: number;
  height: number;
  /** 32 RGBA, 16 grayscale, 8 indexed */
  depth: number;
  transparentIndex: number;
  frames: { duration: number; cels: AseCel[] }[];
  layers: AseLayer[];
  tags: AseTag[];
  /** RGBA palette as of each frame (palette chunks can change it mid-file). */
  palettes: Uint8ClampedArray[];
  /** Artist-toned notes about anything skipped or approximated. */
  warnings: string[];
}

const BLEND_NAMES = [
  "Normal", "Multiply", "Screen", "Overlay", "Darken", "Lighten", "Color Dodge",
  "Color Burn", "Hard Light", "Soft Light", "Difference", "Exclusion", "Hue",
  "Saturation", "Color", "Luminosity", "Addition", "Subtract", "Divide",
];

/** zlib (RFC 1950) inflate via the platform — browsers and Node 18+. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

class Reader {
  private dv: DataView;
  constructor(public bytes: Uint8Array, public pos = 0) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8() { return this.dv.getUint8(this.pos++); }
  u16() { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  skip(n: number) { this.pos += n; }
  str() {
    const n = this.u16();
    const s = new TextDecoder().decode(this.bytes.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
}

/** Parse a whole .aseprite file. Throws (artist-toned) on a file it can't read. */
export async function parseAseprite(bytes: Uint8Array): Promise<AseFile> {
  if (bytes.length < 128) throw new Error("this file is too short to be an Aseprite file");
  const r = new Reader(bytes);
  r.skip(4); // file size
  if (r.u16() !== 0xa5e0) throw new Error("this doesn't look like an Aseprite file");
  const frameCount = r.u16();
  const width = r.u16();
  const height = r.u16();
  const depth = r.u16();
  const flags = r.u32();
  r.skip(2 + 8); // deprecated speed + reserved
  const transparentIndex = r.u8();
  r.skip(3);
  r.u16(); // num colors
  const pixW = r.u8(), pixH = r.u8();
  if (![32, 16, 8].includes(depth)) throw new Error(`unsupported color depth (${depth}-bit)`);
  const layerOpacityValid = (flags & 1) !== 0;
  const groupOpacityValid = (flags & 2) !== 0;

  const warnings: string[] = [];
  if (pixW && pixH && pixW !== pixH) {
    warnings.push(`This sprite uses non-square pixels (${pixW}:${pixH}) — it's imported as square pixels, so it may look stretched.`);
  }

  const layers: AseLayer[] = [];
  const tags: AseTag[] = [];
  const frames: AseFile["frames"] = [];
  const palettes: Uint8ClampedArray[] = [];
  let palette = new Uint8ClampedArray(256 * 4);
  // Inflate jobs run after the scan so the parse stays a single pass.
  const pending: Promise<void>[] = [];

  r.pos = 128;
  for (let f = 0; f < frameCount; f++) {
    const frameStart = r.pos;
    const frameSize = r.u32();
    if (r.u16() !== 0xf1fa) throw new Error(`frame ${f + 1} is damaged`);
    const oldChunks = r.u16();
    const duration = r.u16();
    r.skip(2);
    const newChunks = r.u32();
    const chunkCount = newChunks || oldChunks; // spec: new field unless it's 0
    const cels: AseCel[] = [];
    let sawNewPalette = false;

    for (let c = 0; c < chunkCount; c++) {
      const chunkStart = r.pos;
      const chunkSize = r.u32();
      const type = r.u16();
      const end = chunkStart + chunkSize;
      if (type === 0x2004) {
        const lflags = r.u16();
        const ltype = r.u16();
        const childLevel = r.u16();
        r.skip(4); // default w/h, ignored
        const blend = r.u16();
        const op = r.u8();
        r.skip(3);
        const name = r.str();
        const isGroup = ltype === 1;
        const opacityValid = isGroup ? groupOpacityValid : layerOpacityValid;
        layers.push({
          name, type: ltype, childLevel, blend,
          visible: (lflags & 1) !== 0,
          background: (lflags & 8) !== 0,
          reference: (lflags & 64) !== 0,
          opacity: opacityValid ? op / 255 : 1,
        });
      } else if (type === 0x2005) {
        const layer = r.u16();
        const x = r.i16(), y = r.i16();
        const opacity = r.u8() / 255;
        const celType = r.u16();
        const zIndex = r.i16();
        r.skip(5);
        const cel: AseCel = { layer, x, y, opacity, zIndex };
        if (celType === 0 || celType === 2) {
          const w = r.u16(), h = r.u16();
          const payload = bytes.subarray(r.pos, end);
          if (celType === 0) cel.image = { w, h, data: payload };
          else pending.push(inflate(payload).then((data) => { cel.image = { w, h, data }; }));
        } else if (celType === 1) {
          cel.linkFrame = r.u16();
        } else if (celType === 3) {
          cel.tilemap = true;
        }
        cels.push(cel);
      } else if (type === 0x2018) {
        const n = r.u16();
        r.skip(8);
        for (let i = 0; i < n; i++) {
          const from = r.u16(), to = r.u16();
          const direction = r.u8();
          const repeat = r.u16();
          r.skip(6 + 3 + 1);
          tags.push({ name: r.str(), from, to, direction, repeat });
        }
      } else if (type === 0x2019) {
        sawNewPalette = true;
        const total = r.u32();
        const first = r.u32(), last = r.u32();
        r.skip(8);
        if (total * 4 > palette.length) {
          const grown = new Uint8ClampedArray(total * 4);
          grown.set(palette);
          palette = grown;
        } else {
          palette = new Uint8ClampedArray(palette); // copy-on-write per frame
        }
        for (let i = first; i <= last; i++) {
          const pflags = r.u16();
          palette[i * 4] = r.u8(); palette[i * 4 + 1] = r.u8();
          palette[i * 4 + 2] = r.u8(); palette[i * 4 + 3] = r.u8();
          if (pflags & 1) r.str();
        }
      } else if ((type === 0x0004 || type === 0x0011) && !sawNewPalette) {
        // Old palettes exist only for backwards compatibility; ignore them
        // whenever the new chunk is present in the same frame.
        const scale = type === 0x0011 ? 255 / 63 : 1;
        palette = new Uint8ClampedArray(palette);
        let idx = 0;
        const packets = r.u16();
        for (let p = 0; p < packets; p++) {
          idx += r.u8();
          let count = r.u8();
          if (count === 0) count = 256;
          for (let i = 0; i < count; i++, idx++) {
            palette[idx * 4] = Math.round(r.u8() * scale);
            palette[idx * 4 + 1] = Math.round(r.u8() * scale);
            palette[idx * 4 + 2] = Math.round(r.u8() * scale);
            palette[idx * 4 + 3] = 255;
          }
        }
      }
      r.pos = end;
    }
    frames.push({ duration: duration || 100, cels });
    palettes.push(palette);
    r.pos = frameStart + frameSize;
  }
  await Promise.all(pending);

  const tilemapLayers = layers.filter((l) => l.type === 2 && effectiveVisible(layers, layers.indexOf(l)));
  if (tilemapLayers.length) {
    warnings.push(`Tilemap layers aren't supported yet, so ${tilemapLayers.map((l) => `“${l.name}”`).join(", ")} ${tilemapLayers.length === 1 ? "was" : "were"} left out. Convert ${tilemapLayers.length === 1 ? "it" : "them"} to a normal layer in Aseprite to include ${tilemapLayers.length === 1 ? "it" : "them"}.`);
  }
  const odd = new Set(
    layers.filter((l, i) => l.type === 1 && l.blend !== 0 && effectiveVisible(layers, i)).map((l) => l.name)
  );
  if (odd.size) {
    warnings.push(`Group blend modes are approximated (groups ${[...odd].map((n) => `“${n}”`).join(", ")}) — the layers inside still blend exactly.`);
  }
  return { width, height, depth, transparentIndex, frames, layers, tags, palettes, warnings };
}

/** Index of each layer's parent group, from the flat child-level list. */
function parentOf(layers: AseLayer[], i: number): number {
  const level = layers[i].childLevel;
  for (let j = i - 1; j >= 0; j--) if (layers[j].childLevel < level) return j;
  return -1;
}

/** Visible only if the layer and every enclosing group is visible. */
function effectiveVisible(layers: AseLayer[], i: number): boolean {
  for (let j = i; j >= 0; j = parentOf(layers, j)) if (!layers[j].visible) return false;
  return true;
}

function effectiveOpacity(layers: AseLayer[], i: number): number {
  let o = 1;
  for (let j = i; j >= 0; j = parentOf(layers, j)) o *= layers[j].opacity;
  return o;
}

/** The frame order a tag plays in, with direction applied. */
export function tagSequence(tag: Pick<AseTag, "from" | "to" | "direction">): number[] {
  const fwd: number[] = [];
  for (let i = Math.min(tag.from, tag.to); i <= Math.max(tag.from, tag.to); i++) fwd.push(i);
  const rev = [...fwd].reverse();
  // Ping-pong doesn't repeat the turn-around frames, matching Aseprite.
  switch (tag.direction) {
    case 1: return rev;
    case 2: return [...fwd, ...fwd.slice(1, -1).reverse()];
    case 3: return [...rev, ...rev.slice(1, -1).reverse()];
    default: return fwd;
  }
}

// ---- Compositing ----

/** W3C/Aseprite separable blend functions on 0..1 channel values. */
function blendChannel(mode: number, b: number, s: number): number {
  switch (mode) {
    case 1: return b * s;
    case 2: return b + s - b * s;
    case 3: return hardLight(s, b);
    case 4: return Math.min(b, s);
    case 5: return Math.max(b, s);
    case 6: return b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s));
    case 7: return b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s);
    case 8: return hardLight(b, s);
    case 9: {
      if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
      return b + (2 * s - 1) * (d - b);
    }
    case 10: return Math.abs(b - s);
    case 11: return b + s - 2 * b * s;
    case 16: return Math.min(1, b + s);
    case 17: return Math.max(0, b - s);
    case 18: return s === 0 ? (b === 0 ? 0 : 1) : Math.min(1, b / s);
    default: return s;
  }
}

function hardLight(b: number, s: number): number {
  return s <= 0.5 ? b * 2 * s : b + (2 * s - 1) - b * (2 * s - 1);
}

const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c: number[]): number[] {
  const l = lum(c), n = Math.min(...c), x = Math.max(...c);
  let out = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n));
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l));
  return out;
}
const setLum = (c: number[], l: number) => { const d = l - lum(c); return clipColor(c.map((v) => v + d)); };
const sat = (c: number[]) => Math.max(...c) - Math.min(...c);
function setSat(c: number[], s: number): number[] {
  const mx = Math.max(...c), mn = Math.min(...c);
  if (mx === mn) return [0, 0, 0];
  return c.map((v) => ((v - mn) * s) / (mx - mn));
}

/** Blend source over backdrop for one pixel (non-premultiplied, 0..1). */
function blendRgb(mode: number, b: number[], s: number[]): number[] {
  switch (mode) {
    case 12: return setLum(setSat(s, sat(b)), lum(b));
    case 13: return setLum(setSat(b, sat(s)), lum(b));
    case 14: return setLum(s, lum(b));
    case 15: return setLum(b, lum(s));
    default: return [blendChannel(mode, b[0], s[0]), blendChannel(mode, b[1], s[1]), blendChannel(mode, b[2], s[2])];
  }
}

/** Source pixel → RGBA (0..255) for the file's color depth. */
function readPixel(
  file: AseFile, data: Uint8Array, i: number, palette: Uint8ClampedArray, background: boolean
): [number, number, number, number] {
  if (file.depth === 32) return [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
  if (file.depth === 16) { const v = data[i * 2]; return [v, v, v, data[i * 2 + 1]]; }
  const idx = data[i];
  if (idx === file.transparentIndex && !background) return [0, 0, 0, 0];
  return [palette[idx * 4], palette[idx * 4 + 1], palette[idx * 4 + 2], palette[idx * 4 + 3]];
}

/**
 * Flatten one frame to an RGBA buffer the size of the sprite, the way
 * Aseprite's own export does: visible layers only (hidden layers, children of
 * hidden groups, reference layers and tilemaps excluded), bottom to top with
 * cel z-index applied, layer × group × cel opacity, and each layer's blend
 * mode. Linked cels resolve to the frame they point at.
 */
export function composeFrame(file: AseFile, frameIndex: number): Uint8ClampedArray {
  const { width: W, height: H } = file;
  const out = new Float32Array(W * H * 4); // straight alpha, 0..1
  const frame = file.frames[frameIndex];
  const palette = file.palettes[frameIndex] ?? file.palettes[0] ?? new Uint8ClampedArray(1024);

  const order = [...frame.cels].sort(
    (a, b) => a.layer + a.zIndex - (b.layer + b.zIndex) || a.zIndex - b.zIndex
  );
  for (const cel0 of order) {
    const layer = file.layers[cel0.layer];
    if (!layer || layer.type !== 0 || layer.reference || !effectiveVisible(file.layers, cel0.layer)) continue;
    // A linked cel borrows the image (and position/opacity) of another frame.
    let cel = cel0;
    for (let hop = 0; cel.linkFrame !== undefined && hop < 8; hop++) {
      const target = file.frames[cel.linkFrame]?.cels.find((c) => c.layer === cel0.layer);
      if (!target) break;
      cel = target;
    }
    if (!cel.image) continue;
    const alphaScale = effectiveOpacity(file.layers, cel0.layer) * cel.opacity;
    if (alphaScale <= 0) continue;
    const mode = layer.blend;
    const { w, h, data } = cel.image;
    for (let yy = 0; yy < h; yy++) {
      const dy = cel.y + yy;
      if (dy < 0 || dy >= H) continue;
      for (let xx = 0; xx < w; xx++) {
        const dx = cel.x + xx;
        if (dx < 0 || dx >= W) continue;
        const [sr, sg, sb, sa0] = readPixel(file, data, yy * w + xx, palette, layer.background);
        const sa = (sa0 / 255) * alphaScale;
        if (sa <= 0) continue;
        const o = (dy * W + dx) * 4;
        const ba = out[o + 3];
        let s = [sr / 255, sg / 255, sb / 255];
        if (mode !== 0 && ba > 0) {
          // W3C "blend then composite": mix toward the blended colour by how
          // much backdrop there is to blend against.
          const b = [out[o], out[o + 1], out[o + 2]];
          const m = blendRgb(mode, b, s);
          s = s.map((v, k) => (1 - ba) * v + ba * Math.min(1, Math.max(0, m[k])));
        }
        const ra = sa + ba * (1 - sa);
        for (let k = 0; k < 3; k++) out[o + k] = (s[k] * sa + out[o + k] * ba * (1 - sa)) / ra;
        out[o + 3] = ra;
      }
    }
  }
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    if (a <= 0) continue;
    px[i] = Math.round(out[i] * 255);
    px[i + 1] = Math.round(out[i + 1] * 255);
    px[i + 2] = Math.round(out[i + 2] * 255);
    px[i + 3] = Math.round(a * 255);
  }
  return px;
}

export const blendModeName = (id: number) => BLEND_NAMES[id] ?? `mode ${id}`;

// ---- Choosing what lands in a slot (pure; the modal lives in asepick.ts) ----

/** A parsed + flattened file, ready to route into art slots. */
export interface AseImport<F = string> {
  fileName: string;
  width: number;
  height: number;
  /** Every frame of the timeline, flattened, in file order. */
  frames: F[];
  durations: number[];
  tags: AseTag[];
}

/** The frames (and their ms) a choice plays: one tag in its direction, or —
 *  `null` — the whole timeline in order. */
export function choiceFrames<F>(ase: AseImport<F>, tagName: string | null): { frames: F[]; durations: number[] } {
  const tag = tagName === null ? null : ase.tags.find((t) => t.name === tagName);
  const order = tag ? tagSequence(tag) : ase.frames.map((_, i) => i);
  return { frames: order.map((i) => ase.frames[i]), durations: order.map((i) => ase.durations[i] ?? 100) };
}

/**
 * Turn Aseprite timing into PlayPen's: an exact whole-number fps when every
 * frame lasts the same (so the studio's speed slider still describes it),
 * otherwise per-frame durations with the nearest fps as a fallback for
 * anything that only understands a single speed.
 */
export function timingFor(durations: number[]): { fps: number; durations?: number[] } {
  if (durations.length <= 1) return { fps: 6 };
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const fallback = Math.max(1, Math.min(60, Math.round(1000 / avg)));
  const uniform = durations.every((d) => d === durations[0]);
  const exactFps = 1000 / durations[0];
  if (uniform && Math.abs(exactFps - Math.round(exactFps)) < 0.01) return { fps: Math.round(exactFps) };
  return { fps: fallback, durations };
}

/** "player.aseprite#run", or just the file name for a whole timeline. */
export const sourceRef = (fileName: string, tagName: string | null) =>
  tagName === null ? fileName : `${fileName}#${tagName}`;

/**
 * Re-import memory: if this slot last came from the same FILE and that tag
 * still exists, return it (null = it was the whole timeline). `undefined`
 * means there's nothing to reuse, so ask. Matching on file name (not path —
 * browsers don't expose one) is what makes "save in Aseprite, drop it again"
 * re-apply silently.
 */
export function rememberedChoice(
  source: string | undefined, fileName: string, tags: AseTag[]
): string | null | undefined {
  if (!source) return undefined;
  const hash = source.lastIndexOf("#");
  const file = hash < 0 ? source : source.slice(0, hash);
  if (file.toLowerCase() !== fileName.toLowerCase()) return undefined;
  if (hash < 0) return null; // last time it was the whole timeline
  const tag = source.slice(hash + 1);
  return tags.some((t) => t.name === tag) ? tag : undefined;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Tags whose name matches a slot's label — "open" for a door's "Open" look,
 *  "unlit" for a brazier's "Unlit / cold". Whole-word, case-insensitive. */
export function tagsMatchingLabel(label: string, tags: AseTag[]): AseTag[] {
  const labelWords = words(label);
  const joined = labelWords.join("");
  return tags.filter((t) => {
    const tw = words(t.name).join("");
    return tw.length > 0 && (tw === joined || labelWords.includes(tw));
  });
}
