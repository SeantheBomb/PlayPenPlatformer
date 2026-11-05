// Characters/enemies/Warden/objects keep their art's own shape (Sean,
// 2026-11-04: a 32×32 player squeezed into its 12×14 box read tall and thin).
import { describe, expect, it } from "vitest";
import { spriteRect } from "../src/engine/renderer";

describe("spriteRect", () => {
  it("fill stretches to the box exactly (tiles, items, portraits)", () => {
    expect(spriteRect(32, 32, 10, 20, 12, 14, "fill")).toEqual({ x: 10, y: 20, w: 12, h: 14 });
  });

  it("height-fit keeps the art's shape: square art in the 12×14 player box is 14×14, centered", () => {
    expect(spriteRect(32, 32, 10, 20, 12, 14, "height")).toEqual({ x: 9, y: 20, w: 14, h: 14 });
  });

  it("feet stay planted: the bottom edge is the box's bottom edge", () => {
    const r = spriteRect(40, 20, 0, 100, 16, 32, "height");
    expect(r.y + r.h).toBe(132);
  });

  it("art already at the box's shape lands exactly in the box", () => {
    expect(spriteRect(24, 28, 5, 5, 12, 14, "height")).toEqual({ x: 5, y: 5, w: 12, h: 14 });
  });

  it("squash & stretch still applies horizontally on top", () => {
    const r = spriteRect(32, 32, 0, 0, 12, 14, "height", 1.2);
    expect(r.w).toBeCloseTo(16.8);
    expect(r.x).toBeCloseTo((12 - 16.8) / 2);
  });
});
