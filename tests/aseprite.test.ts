// .aseprite import (Sean, 2026-10-01 — "like the Unity Aseprite importer").
// Fixtures are built byte-for-byte by a tiny encoder below, following
// aseprite/docs/ase-file-specs.md, so every chunk type the reader claims to
// support is exercised against real binary layout rather than mocks.
import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { composeFrame, parseAseprite, tagSequence, type AseFile } from "../src/studio/aseprite";

// ---- Minimal .aseprite encoder ----

class W {
  private parts: number[] = [];
  u8(v: number) { this.parts.push(v & 0xff); return this; }
  u16(v: number) { return this.u8(v).u8(v >> 8); }
  i16(v: number) { return this.u16(v & 0xffff); }
  u32(v: number) { return this.u16(v & 0xffff).u16((v >>> 16) & 0xffff); }
  zero(n: number) { for (let i = 0; i < n; i++) this.u8(0); return this; }
  bytes(b: ArrayLike<number>) { for (let i = 0; i < b.length; i++) this.u8(b[i]); return this; }
  str(s: string) { const b = Buffer.from(s, "utf8"); return this.u16(b.length).bytes(b); }
  get length() { return this.parts.length; }
  out() { return Uint8Array.from(this.parts); }
}

const chunk = (type: number, body: W) => {
  const b = body.out();
  return new W().u32(6 + b.length).u16(type).bytes(b).out();
};

interface LayerSpec { name: string; visible?: boolean; type?: number; level?: number; blend?: number; opacity?: number; background?: boolean }
interface CelSpec {
  layer: number; x?: number; y?: number; opacity?: number; z?: number;
  w?: number; h?: number; px?: number[]; raw?: boolean; link?: number;
}
interface FrameSpec { duration?: number; cels: CelSpec[]; palette?: { first: number; colors: number[][] } }

function layerChunk(l: LayerSpec) {
  const flags = (l.visible === false ? 0 : 1) | (l.background ? 8 : 0);
  return chunk(0x2004, new W().u16(flags).u16(l.type ?? 0).u16(l.level ?? 0).u16(0).u16(0)
    .u16(l.blend ?? 0).u8(l.opacity ?? 255).zero(3).str(l.name));
}

function celChunk(c: CelSpec) {
  const w = new W().u16(c.layer).i16(c.x ?? 0).i16(c.y ?? 0).u8(c.opacity ?? 255);
  if (c.link !== undefined) return chunk(0x2005, w.u16(1).i16(c.z ?? 0).zero(5).u16(c.link));
  w.u16(c.raw ? 0 : 2).i16(c.z ?? 0).zero(5).u16(c.w!).u16(c.h!);
  const px = Uint8Array.from(c.px!);
  return chunk(0x2005, w.bytes(c.raw ? px : deflateSync(px)));
}

function tagsChunk(tags: { name: string; from: number; to: number; dir?: number; repeat?: number }[]) {
  const w = new W().u16(tags.length).zero(8);
  for (const t of tags) w.u16(t.from).u16(t.to).u8(t.dir ?? 0).u16(t.repeat ?? 0).zero(6).zero(3).u8(0).str(t.name);
  return chunk(0x2018, w);
}

function paletteChunk(first: number, colors: number[][]) {
  const w = new W().u32(first + colors.length).u32(first).u32(first + colors.length - 1).zero(8);
  for (const c of colors) w.u16(0).u8(c[0]).u8(c[1]).u8(c[2]).u8(c[3] ?? 255);
  return chunk(0x2019, w);
}

function encode(opts: {
  w: number; h: number; depth?: number; transparentIndex?: number;
  layers: LayerSpec[]; frames: FrameSpec[];
  tags?: { name: string; from: number; to: number; dir?: number; repeat?: number }[];
}): Uint8Array {
  const frames: Uint8Array[] = opts.frames.map((f, i) => {
    const chunks: Uint8Array[] = [];
    if (i === 0) {
      for (const l of opts.layers) chunks.push(layerChunk(l));
      if (opts.tags) chunks.push(tagsChunk(opts.tags));
    }
    if (f.palette) chunks.push(paletteChunk(f.palette.first, f.palette.colors));
    for (const c of f.cels) chunks.push(celChunk(c));
    const body = new W();
    for (const c of chunks) body.bytes(c);
    const b = body.out();
    return new W().u32(16 + b.length).u16(0xf1fa).u16(chunks.length).u16(f.duration ?? 100).zero(2)
      .u32(chunks.length).bytes(b).out();
  });
  const frameBytes = frames.reduce((n, f) => n + f.length, 0);
  const head = new W().u32(128 + frameBytes).u16(0xa5e0).u16(frames.length).u16(opts.w).u16(opts.h)
    .u16(opts.depth ?? 32).u32(1).u16(100).zero(8).u8(opts.transparentIndex ?? 0).zero(3)
    .u16(0).u8(1).u8(1).i16(0).i16(0).u16(16).u16(16);
  head.zero(128 - head.length);
  const all = new W().bytes(head.out());
  for (const f of frames) all.bytes(f);
  return all.out();
}

const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255], CLEAR = [0, 0, 0, 0];
const solid = (w: number, h: number, c: number[]) => Array.from({ length: w * h }, () => c).flat();
const at = (px: Uint8ClampedArray, f: AseFile, x: number, y: number) => {
  const i = (y * f.width + x) * 4;
  return [px[i], px[i + 1], px[i + 2], px[i + 3]];
};

// ---- Tests ----

describe("reading the file", () => {
  it("reads size, frames, durations and tags", async () => {
    const f = await parseAseprite(encode({
      w: 4, h: 3,
      layers: [{ name: "Body" }],
      frames: [
        { duration: 80, cels: [{ layer: 0, w: 4, h: 3, px: solid(4, 3, RED) }] },
        { duration: 160, cels: [{ layer: 0, w: 4, h: 3, px: solid(4, 3, BLUE) }] },
      ],
      tags: [{ name: "idle", from: 0, to: 0 }, { name: "run", from: 0, to: 1, dir: 2, repeat: 3 }],
    }));
    expect([f.width, f.height, f.frames.length]).toEqual([4, 3, 2]);
    expect(f.frames.map((fr) => fr.duration)).toEqual([80, 160]);
    expect(f.tags).toEqual([
      { name: "idle", from: 0, to: 0, direction: 0, repeat: 0 },
      { name: "run", from: 0, to: 1, direction: 2, repeat: 3 },
    ]);
  });

  it("rejects something that isn't an Aseprite file, in plain words", async () => {
    await expect(parseAseprite(new Uint8Array(200))).rejects.toThrow(/doesn't look like an Aseprite file/);
  });
});

describe("cels", () => {
  it("decodes compressed and raw cels at their offsets", async () => {
    const f = await parseAseprite(encode({
      w: 4, h: 4,
      layers: [{ name: "a" }, { name: "b" }],
      frames: [{ cels: [
        { layer: 0, x: 0, y: 0, w: 1, h: 1, px: RED },                 // compressed
        { layer: 1, x: 2, y: 3, w: 1, h: 1, px: BLUE, raw: true },     // raw
      ] }],
    }));
    const px = composeFrame(f, 0);
    expect(at(px, f, 0, 0)).toEqual(RED);
    expect(at(px, f, 2, 3)).toEqual(BLUE);
    expect(at(px, f, 1, 1)).toEqual(CLEAR);
  });

  it("resolves a linked cel to the frame it points at", async () => {
    const f = await parseAseprite(encode({
      w: 2, h: 2,
      layers: [{ name: "a" }],
      frames: [
        { cels: [{ layer: 0, x: 1, y: 1, w: 1, h: 1, px: RED }] },
        { cels: [{ layer: 0, link: 0 }] },
      ],
    }));
    expect(at(composeFrame(f, 1), f, 1, 1)).toEqual(RED);
  });

  it("clips cels that hang off the canvas instead of wrapping them", async () => {
    const f = await parseAseprite(encode({
      w: 2, h: 2, layers: [{ name: "a" }],
      frames: [{ cels: [{ layer: 0, x: -1, y: -1, w: 2, h: 2, px: solid(2, 2, RED) }] }],
    }));
    const px = composeFrame(f, 0);
    expect(at(px, f, 0, 0)).toEqual(RED);
    expect(at(px, f, 1, 1)).toEqual(CLEAR);
  });

  it("orders cels by z-index, not just layer order", async () => {
    const f = await parseAseprite(encode({
      w: 1, h: 1, layers: [{ name: "below" }, { name: "above" }],
      // The lower layer is pushed in front with a z-index of +1.
      frames: [{ cels: [
        { layer: 0, w: 1, h: 1, px: RED, z: 1 },
        { layer: 1, w: 1, h: 1, px: BLUE },
      ] }],
    }));
    expect(at(composeFrame(f, 0), f, 0, 0)).toEqual(RED);
  });
});

describe("color modes", () => {
  it("indexed: palette lookup, with the transparent index cleared", async () => {
    const f = await parseAseprite(encode({
      w: 3, h: 1, depth: 8, transparentIndex: 0,
      layers: [{ name: "a" }],
      frames: [{
        palette: { first: 0, colors: [[9, 9, 9], [255, 0, 0], [0, 0, 255]] },
        cels: [{ layer: 0, w: 3, h: 1, px: [0, 1, 2] }],
      }],
    }));
    const px = composeFrame(f, 0);
    expect(at(px, f, 0, 0)).toEqual(CLEAR);
    expect(at(px, f, 1, 0)).toEqual(RED);
    expect(at(px, f, 2, 0)).toEqual(BLUE);
  });

  it("indexed: the transparent index is opaque on a background layer", async () => {
    const f = await parseAseprite(encode({
      w: 1, h: 1, depth: 8, transparentIndex: 0,
      layers: [{ name: "bg", background: true }],
      frames: [{ palette: { first: 0, colors: [[9, 9, 9]] }, cels: [{ layer: 0, w: 1, h: 1, px: [0] }] }],
    }));
    expect(at(composeFrame(f, 0), f, 0, 0)).toEqual([9, 9, 9, 255]);
  });

  it("indexed: a palette change mid-animation applies from that frame on", async () => {
    const f = await parseAseprite(encode({
      w: 1, h: 1, depth: 8, transparentIndex: 255,
      layers: [{ name: "a" }],
      frames: [
        { palette: { first: 0, colors: [[255, 0, 0]] }, cels: [{ layer: 0, w: 1, h: 1, px: [0] }] },
        { palette: { first: 0, colors: [[0, 0, 255]] }, cels: [{ layer: 0, w: 1, h: 1, px: [0] }] },
      ],
    }));
    expect(at(composeFrame(f, 0), f, 0, 0)).toEqual(RED);
    expect(at(composeFrame(f, 1), f, 0, 0)).toEqual(BLUE);
  });

  it("grayscale: value + alpha", async () => {
    const f = await parseAseprite(encode({
      w: 1, h: 1, depth: 16, layers: [{ name: "a" }],
      frames: [{ cels: [{ layer: 0, w: 1, h: 1, px: [128, 255] }] }],
    }));
    expect(at(composeFrame(f, 0), f, 0, 0)).toEqual([128, 128, 128, 255]);
  });
});

describe("layers flatten like Aseprite's own export", () => {
  it("leaves out hidden layers", async () => {
    const f = await parseAseprite(encode({
      w: 1, h: 1, layers: [{ name: "shown" }, { name: "sketch", visible: false }],
      frames: [{ cels: [{ layer: 0, w: 1, h: 1, px: RED }, { layer: 1, w: 1, h: 1, px: BLUE }] }],
    }));
    expect(at(composeFrame(f, 0), f, 0, 0)).toEqual(RED);
  });

  it("leaves out every layer inside a hidden group", async () => {
    const f = await parseAseprite(encode({
      w: 1, h: 1,
      layers: [
        { name: "base" },
        { name: "group", type: 1, visible: false },
        { name: "inside", level: 1 },
      ],
      frames: [{ cels: [{ layer: 0, w: 1, h: 1, px: RED }, { layer: 2, w: 1, h: 1, px: BLUE }] }],
    }));
    expect(at(composeFrame(f, 0), f, 0, 0)).toEqual(RED);
  });

  it("applies layer and cel opacity together", async () => {
    const f = await parseAseprite(encode({
      w: 1, h: 1, layers: [{ name: "half", opacity: 128 }],
      frames: [{ cels: [{ layer: 0, w: 1, h: 1, px: RED, opacity: 128 }] }],
    }));
    const a = at(composeFrame(f, 0), f, 0, 0)[3];
    expect(a).toBeGreaterThanOrEqual(63);
    expect(a).toBeLessThanOrEqual(65); // 255 × ½ × ½
  });

  it("blends: multiply darkens, screen lightens, subtract has no canvas equivalent but still works", async () => {
    const grey = [128, 128, 128, 255];
    const run = async (blend: number) => {
      const f = await parseAseprite(encode({
        w: 1, h: 1, layers: [{ name: "base" }, { name: "top", blend }],
        frames: [{ cels: [{ layer: 0, w: 1, h: 1, px: grey }, { layer: 1, w: 1, h: 1, px: grey }] }],
      }));
      return at(composeFrame(f, 0), f, 0, 0)[0];
    };
    expect(await run(0)).toBe(128);              // normal
    expect(await run(1)).toBeLessThan(70);        // multiply ≈ 64
    expect(await run(2)).toBeGreaterThan(185);    // screen ≈ 192
    expect(await run(17)).toBe(0);                // subtract: 128 − 128
  });

  it("warns (rather than silently dropping) about a visible tilemap layer", async () => {
    const f = await parseAseprite(encode({
      w: 1, h: 1, layers: [{ name: "Ground tiles", type: 2 }],
      frames: [{ cels: [] }],
    }));
    expect(f.warnings.join(" ")).toMatch(/Tilemap layers aren't supported yet.*Ground tiles/);
  });
});

describe("tag playback order", () => {
  it("forward and reverse", () => {
    expect(tagSequence({ from: 2, to: 5, direction: 0 })).toEqual([2, 3, 4, 5]);
    expect(tagSequence({ from: 2, to: 5, direction: 1 })).toEqual([5, 4, 3, 2]);
  });

  it("ping-pong doesn't repeat the turn-around frames, like Aseprite", () => {
    expect(tagSequence({ from: 0, to: 3, direction: 2 })).toEqual([0, 1, 2, 3, 2, 1]);
    expect(tagSequence({ from: 0, to: 3, direction: 3 })).toEqual([3, 2, 1, 0, 1, 2]);
  });

  it("ping-pong on one or two frames stays sensible", () => {
    expect(tagSequence({ from: 4, to: 4, direction: 2 })).toEqual([4]);
    expect(tagSequence({ from: 0, to: 1, direction: 2 })).toEqual([0, 1]);
  });
});

// ---- Routing a file into PlayPen's art slots ----
import { choiceFrames, rememberedChoice, sourceRef, tagsMatchingLabel, timingFor, type AseImport } from "../src/studio/aseprite";
import { timedFrameIndex } from "../src/engine/renderer";
import { withEditedFrames } from "../src/studio/assets";

const ase: AseImport = {
  fileName: "door.aseprite", width: 16, height: 32,
  frames: ["f0", "f1", "f2", "f3", "f4"],
  durations: [100, 100, 300, 50, 50],
  tags: [
    { name: "closed", from: 0, to: 1, direction: 0, repeat: 0 },
    { name: "Open", from: 2, to: 4, direction: 2, repeat: 0 },
  ],
};

describe("choosing what lands in a slot", () => {
  it("a tag plays in its direction, carrying each frame's own duration", () => {
    expect(choiceFrames(ase, "Open")).toEqual({ frames: ["f2", "f3", "f4", "f3"], durations: [300, 50, 50, 50] });
  });

  it("null means the whole timeline, in file order", () => {
    expect(choiceFrames(ase, null).frames).toEqual(ase.frames);
  });

  it("uniform timing becomes an exact fps; uneven timing keeps per-frame durations", () => {
    expect(timingFor([100, 100, 100])).toEqual({ fps: 10 });
    expect(timingFor([125, 125])).toEqual({ fps: 8 });
    // 1000/120 isn't whole, so the exact timing is kept rather than rounded.
    expect(timingFor([120, 120])).toEqual({ fps: 8, durations: [120, 120] });
    // 400ms over 3 frames = 7.5fps, so the single-speed fallback rounds to 7.
    expect(timingFor([300, 50, 50])).toEqual({ fps: 7, durations: [300, 50, 50] });
    expect(timingFor([100])).toEqual({ fps: 6 });
  });

  it("re-import: the same file brings back the same tag", () => {
    expect(rememberedChoice(sourceRef("door.aseprite", "Open"), "door.aseprite", ase.tags)).toBe("Open");
    expect(rememberedChoice(sourceRef("DOOR.aseprite", "Open"), "door.aseprite", ase.tags)).toBe("Open");
    expect(rememberedChoice(sourceRef("door.aseprite", null), "door.aseprite", ase.tags)).toBeNull();
  });

  it("re-import: a different file, or a renamed/deleted tag, asks again", () => {
    expect(rememberedChoice(sourceRef("crate.aseprite", "Open"), "door.aseprite", ase.tags)).toBeUndefined();
    expect(rememberedChoice(sourceRef("door.aseprite", "Ajar"), "door.aseprite", ase.tags)).toBeUndefined();
    expect(rememberedChoice(undefined, "door.aseprite", ase.tags)).toBeUndefined();
  });

  it("matches tag names to a second look's label, whole-word and case-insensitive", () => {
    expect(tagsMatchingLabel("Open", ase.tags).map((t) => t.name)).toEqual(["Open"]);
    const brazier = [{ name: "unlit", from: 0, to: 0, direction: 0, repeat: 0 }, { name: "lit", from: 1, to: 1, direction: 0, repeat: 0 }];
    expect(tagsMatchingLabel("Unlit / cold", brazier).map((t) => t.name)).toEqual(["unlit"]);
    // "lit" must not match inside "Unlit".
    expect(tagsMatchingLabel("Unlit / cold", brazier).some((t) => t.name === "lit")).toBe(false);
  });
});

describe("per-frame playback in the game", () => {
  it("holds each frame for exactly its duration, then loops", () => {
    const d = [300, 50, 50];
    // 400ms loop: 701ms is 301ms into the second pass, i.e. frame 1 again.
    expect([0, 299, 300, 349, 350, 399, 400, 701].map((t) => timedFrameIndex(d, 3, t))).toEqual([0, 0, 1, 1, 2, 2, 0, 1]);
  });

  it("refuses durations that don't line up with the frames, so playback falls back to fps", () => {
    expect(timedFrameIndex([100, 100], 3, 50)).toBe(-1);
    expect(timedFrameIndex([0, 0], 2, 50)).toBe(-1);
  });

  it("an editor touch-up keeps Aseprite timing only if the timeline is unchanged", () => {
    const prev = { frames: ["a", "b"], fps: 8, durations: [300, 50], source: "x.aseprite#run" };
    expect(withEditedFrames(prev, ["a2", "b2"], 8).durations).toEqual([300, 50]);
    expect(withEditedFrames(prev, ["a2", "b2", "c2"], 8).durations).toBeUndefined();
    expect(withEditedFrames(prev, ["a2", "b2"], 12).durations).toBeUndefined();
  });
});
