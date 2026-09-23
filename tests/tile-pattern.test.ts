// World-aligned tile patterns (Casey's request via Sean, 2026-09-23): one
// sprite spread across a spanX×spanY block of tiles; each placed tile draws
// the slice for its world position so neighbours join into the full design.
import { describe, expect, it } from "vitest";
import { tilePattern, tilePatternCell, MAX_TILE_SPAN } from "../src/engine/renderer";
import { overlayArtBundle } from "../functions/api/_artscope.js";

describe("tilePatternCell", () => {
  it("a plain tile (no span) has no region — whole image per tile, as before", () => {
    expect(tilePatternCell({}, 3, 7)).toBeNull();
    expect(tilePatternCell({ spriteSpanX: 1, spriteSpanY: 1 }, 3, 7)).toBeNull();
  });

  it("a 2×2 block of tiles shows the four quarters of the image", () => {
    const def = { spriteSpanX: 2, spriteSpanY: 2 };
    const cell = (tx: number, ty: number) => {
      const r = tilePatternCell(def, tx, ty)!;
      return [r.col, r.row];
    };
    expect(cell(0, 0)).toEqual([0, 0]);
    expect(cell(1, 0)).toEqual([1, 0]);
    expect(cell(0, 1)).toEqual([0, 1]);
    expect(cell(1, 1)).toEqual([1, 1]);
    // and it repeats
    expect(cell(2, 2)).toEqual([0, 0]);
    expect(cell(5, 4)).toEqual([1, 0]);
  });

  it("negative coordinates wrap continuously (no mirrored seam at 0)", () => {
    const def = { spriteSpanX: 3, spriteSpanY: 2 };
    expect(tilePatternCell(def, -1, -1)).toMatchObject({ col: 2, row: 1 });
    expect(tilePatternCell(def, -3, 0)).toMatchObject({ col: 0, row: 0 });
  });

  it("rectangular spans slice independently per axis", () => {
    const r = tilePatternCell({ spriteSpanX: 2, spriteSpanY: 1 }, 3, 9)!;
    expect(r).toEqual({ col: 1, row: 0, cols: 2, rows: 1 });
  });

  it("offsets shift where the pattern starts, in whole tiles", () => {
    const def = { spriteSpanX: 2, spriteSpanY: 2, spriteOffsetX: 1, spriteOffsetY: 1 };
    expect(tilePatternCell(def, 1, 1)).toMatchObject({ col: 0, row: 0 });
    expect(tilePatternCell(def, 0, 0)).toMatchObject({ col: 1, row: 1 });
  });

  it("tolerates junk values from hand edits / stale saves", () => {
    expect(tilePattern({ spriteSpanX: 0, spriteSpanY: -4 })).toMatchObject({ spanX: 1, spanY: 1 });
    expect(tilePattern({ spriteSpanX: 99 }).spanX).toBe(MAX_TILE_SPAN);
    expect(tilePattern({ spriteSpanX: 2.7 }).spanX).toBe(2);
    expect(tilePattern({ spriteSpanX: 3, spriteOffsetX: 7 }).offsetX).toBe(1);
    expect(tilePattern({ spriteSpanX: 3, spriteOffsetX: -1 }).offsetX).toBe(2);
  });
});

describe("pattern fields are artist-publishable", () => {
  it("span/offset overlay per tile entry; gameplay values stay live", () => {
    const live = {
      "tiles.json": [{ id: "wall", char: "#", solid: true, color: "#333" }],
    };
    const artist = {
      "tiles.json": [{
        id: "wall", solid: false, sprite: "data:image/png;base64,x",
        spriteSpanX: 2, spriteSpanY: 2, spriteOffsetX: 1, spriteOffsetY: 0,
      }],
    };
    const wall = (overlayArtBundle(live, artist) as any)["tiles.json"][0];
    expect(wall).toMatchObject({ spriteSpanX: 2, spriteSpanY: 2, spriteOffsetX: 1, spriteOffsetY: 0, solid: true });
  });

  it("dropping the fields (back to 1×1) publishes as a removal", () => {
    const live = { "tiles.json": [{ id: "wall", char: "#", spriteSpanX: 2, spriteSpanY: 2 }] };
    const artist = { "tiles.json": [{ id: "wall", sprite: "data:image/png;base64,x" }] };
    const wall = (overlayArtBundle(live, artist) as any)["tiles.json"][0];
    expect(wall.spriteSpanX).toBeUndefined();
    expect(wall.spriteSpanY).toBeUndefined();
  });
});

describe("layoutOptions (what an imported image size could mean)", async () => {
  const { layoutOptions } = await import("../src/studio/tilepattern");
  const spans = (w: number, h: number) => layoutOptions(w, h).map((o) => `${o.spanX}x${o.spanY}`);

  it("32×32 = one detailed tile, or a 2×2 pattern — never 3×3 (10.67px) or blown-up 8px pieces", () => {
    expect(spans(32, 32)).toEqual(["1x1", "2x2"]);
  });

  it("64×64 = one tile at 4× detail, a 2×2 at 2× detail, or a 4×4 at 1×", () => {
    expect(spans(64, 64)).toEqual(["1x1", "2x2", "4x4"]);
  });

  it("a wide 32×16 image offers the 2×1 pattern", () => {
    expect(spans(32, 16)).toEqual(["2x1"]);
  });

  it("a plain 16×16 has only one reading, so no question gets asked", () => {
    expect(spans(16, 16)).toEqual(["1x1"]);
  });
});
