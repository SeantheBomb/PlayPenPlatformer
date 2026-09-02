// Strip sizing advice shown in the Art Studio's Environments tab. This is
// guidance an artist will actually draw against, so the numbers have to be
// right — a wrong "needs 950px tall" costs her a redraw.
import { describe, expect, it } from "vitest";
import { adviceForRoom, firstPassPlan, stripGuidance, type StripRoom, type StripSettings } from "../src/studio/stripadvice";

const VIEW_W = 640, VIEW_H = 360;

// Real rooms: the widest, the tallest, and one that fits on a single screen.
const yard: StripRoom = { id: "the_yard", name: "The Playground", worldW: 72 * 16, worldH: 24 * 16 };
const mess: StripRoom = { id: "mess_hall", name: "Boiler Room", worldW: 56 * 16, worldH: 56 * 16 };
const tiny: StripRoom = { id: "tiny", name: "Tiny", worldW: 640, worldH: 360 };

const settings = (over: Partial<StripSettings> = {}): StripSettings => ({
  scrollX: 0.45, scrollY: 0.3, offsetY: 0, wrapX: true, wrapY: false, driftX: 0, driftY: 0, ...over,
});

describe("width advice", () => {
  it("is the view plus however far the layer travels", () => {
    // The Playground: 1152 world px wide, so 512px of camera travel.
    // A 0.45x layer travels 230px, so 870px crosses it without repeating.
    const a = adviceForRoom(yard, settings({ scrollX: 0.45 }), null, VIEW_W, VIEW_H);
    expect(a.width).toBe(640 + Math.ceil(512 * 0.45));
  });

  it("asks for MORE width the nearer the layer is", () => {
    const far = adviceForRoom(yard, settings({ scrollX: 0.15 }), null, VIEW_W, VIEW_H).width;
    const near = adviceForRoom(yard, settings({ scrollX: 1.25 }), null, VIEW_W, VIEW_H).width;
    expect(near).toBeGreaterThan(far);
  });

  it("needs only the view width for a layer pinned to the screen", () => {
    expect(adviceForRoom(yard, settings({ scrollX: 0 }), null, VIEW_W, VIEW_H).width).toBe(VIEW_W);
  });

  it("needs only the view width in a room with no camera travel", () => {
    expect(adviceForRoom(tiny, settings({ scrollX: 1 }), null, VIEW_W, VIEW_H).width).toBe(VIEW_W);
  });

  it("counts how many times the current strip repeats", () => {
    const a = adviceForRoom(yard, settings({ scrollX: 0.45 }), { w: 160, h: 360 }, VIEW_W, VIEW_H);
    expect(a.repeatsAcross).toBeCloseTo((640 + 512 * 0.45) / 160, 3);
  });
});

describe("height advice", () => {
  it("covers the tallest room's camera travel", () => {
    // Boiler Room: 896 tall, so 536px of vertical travel. A foreground layer
    // at 1.1x needs 360 + 590 = 950px. This is the case the placeholders hit.
    const a = adviceForRoom(mess, settings({ scrollY: 1.1 }), null, VIEW_W, VIEW_H);
    expect(a.height).toBe(360 + Math.ceil(536 * 1.1));
  });

  it("never asks for less than the view height", () => {
    expect(adviceForRoom(tiny, settings({ scrollY: 0 }), null, VIEW_W, VIEW_H).height).toBe(VIEW_H);
  });

  it("counts a negative offset as extra height needed below", () => {
    const flat = adviceForRoom(mess, settings({ scrollY: 0.3, offsetY: 0 }), null, VIEW_W, VIEW_H).height;
    const lifted = adviceForRoom(mess, settings({ scrollY: 0.3, offsetY: -80 }), null, VIEW_W, VIEW_H).height;
    expect(lifted).toBe(flat + 80);
  });

  it("flags a strip that falls short, but not one that repeats downwards", () => {
    const short = { w: 320, h: 360 };
    expect(adviceForRoom(mess, settings({ scrollY: 1.1 }), short, VIEW_W, VIEW_H).fallsShort).toBe(true);
    expect(adviceForRoom(mess, settings({ scrollY: 1.1, wrapY: true }), short, VIEW_W, VIEW_H).fallsShort).toBe(false);
  });
});

describe("guidance across a set's rooms", () => {
  const rooms = [yard, mess, tiny];

  it("reports the worst case over every room, naming which room drives it", () => {
    const g = stripGuidance(rooms, "the_yard", settings({ scrollX: 0.45, scrollY: 1.1 }), null, VIEW_W, VIEW_H);
    // Widest travel is The Playground; tallest is the Boiler Room.
    expect(g.worst.widthRoom).toBe("The Playground");
    expect(g.worst.heightRoom).toBe("Boiler Room");
    expect(g.worst.height).toBe(360 + Math.ceil(536 * 1.1));
    expect(g.worst.roomCount).toBe(3);
  });

  it("problem-flags a strip that repeats so often it must read as tiling", () => {
    // 1280px of travel over a 160px strip = 8x.
    const g = stripGuidance(rooms, "the_yard", settings({ scrollX: 1.25 }), { w: 160, h: 2000 }, VIEW_W, VIEW_H);
    expect(g.problems.some((p) => /Repeats/.test(p))).toBe(true);
  });

  it("reports a moderate repeat as a note, not a problem — it depends on the art", () => {
    // ~3.7x: obvious for a landmark, invisible for a soft texture.
    const g = stripGuidance(rooms, "the_yard", settings({ scrollX: 0.15 }), { w: 192, h: 2000 }, VIEW_W, VIEW_H);
    expect(g.problems.some((p) => /Repeats/.test(p))).toBe(false);
    expect(g.notes.some((n) => /Repeats/.test(n))).toBe(true);
  });

  it("stays quiet about repeats when the strip is wide enough", () => {
    const g = stripGuidance(rooms, "the_yard", settings({ scrollX: 0.45 }), { w: 900, h: 900 }, VIEW_W, VIEW_H);
    expect(g.problems.some((p) => /Repeats/.test(p))).toBe(false);
    expect(g.notes.some((n) => /Repeats/.test(n))).toBe(false);
  });

  it("ignores a shortfall of a couple of pixels", () => {
    // The Playground needs 362px at 0.08x; 360px is short but invisible.
    const g = stripGuidance(rooms, "the_yard", settings({ scrollY: 0.08 }), { w: 900, h: 360 }, VIEW_W, VIEW_H);
    expect(g.problems.some((p) => /Too short/.test(p))).toBe(false);
  });

  it("still flags a shortfall that would actually show background", () => {
    const g = stripGuidance(rooms, "mess_hall", settings({ scrollY: 1.1 }), { w: 900, h: 360 }, VIEW_W, VIEW_H);
    expect(g.problems.some((p) => /Too short/.test(p))).toBe(true);
  });

  it("says any height works once it repeats downwards", () => {
    const g = stripGuidance(rooms, "mess_hall", settings({ wrapY: true }), { w: 320, h: 360 }, VIEW_W, VIEW_H);
    expect(g.problems).toHaveLength(0);
    expect(g.notes.some((n) => /any height/.test(n))).toBe(true);
  });

  it("warns that drift makes the seam come around regardless of width", () => {
    const g = stripGuidance(rooms, "the_yard", settings({ driftX: -3 }), null, VIEW_W, VIEW_H);
    expect(g.notes.some((n) => /seam/.test(n))).toBe(true);
  });

  it("survives having no rooms bound at all", () => {
    const g = stripGuidance([], "nope", settings(), null, VIEW_W, VIEW_H);
    expect(g.room.width).toBe(VIEW_W);
    expect(g.worst.roomCount).toBe(0);
  });
});

describe("first-pass plan across the whole campaign", () => {
  const presets = {
    far: { scrollX: 0.15, scrollY: 0.08 },
    mid: { scrollX: 0.45, scrollY: 0.3 },
    near: { scrollX: 1.25, scrollY: 1.1 },
  };
  const rooms = [yard, mess, tiny];

  it("sizes width off the widest room and height off the tallest", () => {
    const plan = firstPassPlan(rooms, presets, VIEW_W, VIEW_H);
    const near = plan.find((p) => p.depth === "near")!;
    expect(near.width).toBe(640 + Math.ceil(512 * 1.25)); // The Playground is widest
    expect(near.height).toBe(360 + Math.ceil(536 * 1.1)); // Boiler Room is tallest
  });

  it("also reports what dropping the single widest room would save", () => {
    const plan = firstPassPlan(rooms, presets, VIEW_W, VIEW_H);
    const near = plan.find((p) => p.depth === "near")!;
    // Second-widest is the Boiler Room at 256px of travel.
    expect(near.widthMost).toBe(640 + Math.ceil(256 * 1.25));
    expect(near.outlierRoom).toBe("The Playground");
    expect(near.mostCount).toBe(2);
    expect(near.outlierInflationPct).toBeGreaterThan(0);
  });

  it("asks for a wider strip the nearer the plane", () => {
    const plan = firstPassPlan(rooms, presets, VIEW_W, VIEW_H);
    const [far, mid, near] = ["far", "mid", "near"].map((d) => plan.find((p) => p.depth === d)!.width);
    expect(far).toBeLessThan(mid);
    expect(mid).toBeLessThan(near);
  });

  it("returns nothing when there are no rooms", () => {
    expect(firstPassPlan([], presets, VIEW_W, VIEW_H)).toEqual([]);
  });
});
