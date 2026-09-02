// Parallax layer design requirements (Sean, 2026-09-02). Layers are polish,
// but two properties are load-bearing and easy to regress:
//   1. They are COSMETIC ONLY — nothing here may ever reach the simulation,
//      or replaying a recorded run would diverge when art is republished.
//   2. The shipped default set is art-free, so adding parallax to the game
//      changes NOTHING for players until the artist actually fills it in.
import { describe, expect, it } from "vitest";
import type { Content, LayersFile } from "../src/data/types";
import { resolveRoomLayers, setIdForRoom, withLayerDefaults, DEPTH_PRESETS } from "../src/game/layers";
import bundledLayers from "../content/layers.json";

const px = (n: string) => `data:image/png;base64,${n}`;

function contentWith(layers: LayersFile): Content {
  return { layers } as unknown as Content;
}

const set = (id: string, layers: LayersFile["sets"][string]["layers"]) => ({ id, name: id, layers });

describe("layer set binding", () => {
  const file = (): LayersFile => ({
    defaultSetId: "facility",
    sets: {
      facility: set("facility", [{ id: "far", sprite: px("f") }]),
      green: set("green", [{ id: "far", sprite: px("g") }]),
    },
    rooms: { greenhouse: { setId: "green" } },
  });

  it("an unbound room falls back to the default set", () => {
    expect(setIdForRoom(file(), "orientation")).toBe("facility");
  });

  it("a bound room uses its own set", () => {
    expect(setIdForRoom(file(), "greenhouse")).toBe("green");
  });

  it("a room bound to a deleted set draws nothing (never silently reverts)", () => {
    const f = file();
    f.rooms.greenhouse.setId = "gone";
    expect(setIdForRoom(f, "greenhouse")).toBeNull();
    expect(resolveRoomLayers(contentWith(f), "greenhouse").behind).toHaveLength(0);
  });

  it("survives a layers file with no sets at all", () => {
    const empty: LayersFile = { sets: {}, rooms: {} };
    expect(resolveRoomLayers(contentWith(empty), "orientation")).toEqual({ behind: [], front: [], setId: null });
  });
});

describe("layer resolution", () => {
  const file = (): LayersFile => ({
    defaultSetId: "s",
    sets: {
      s: set("s", [
        { id: "far", sprite: px("far"), scrollX: 0.1, opacity: 1 },
        { id: "mid", sprite: px("mid"), scrollX: 0.5, opacity: 1 },
        { id: "fore", sprite: px("fore"), plane: "front", opacity: 0.8 },
      ]),
    },
    rooms: {},
  });

  it("splits layers by plane, preserving authored order", () => {
    const r = resolveRoomLayers(contentWith(file()), "any");
    expect(r.behind.map((l) => l.id)).toEqual(["far", "mid"]);
    expect(r.front.map((l) => l.id)).toEqual(["fore"]);
  });

  it("per-room overrides apply on top of the set", () => {
    const f = file();
    f.rooms.vents = { setId: "s", overrides: { far: { opacity: 0.25, scrollX: 0.9 } } };
    const far = resolveRoomLayers(contentWith(f), "vents").behind[0];
    expect(far.opacity).toBe(0.25);
    expect(far.scrollX).toBe(0.9);
    expect(far.sprite).toBe(px("far")); // untouched fields still come from the set
  });

  it("an override never leaks into other rooms using the same set", () => {
    const f = file();
    f.rooms.vents = { setId: "s", overrides: { far: { opacity: 0.25 } } };
    expect(resolveRoomLayers(contentWith(f), "storage").behind[0].opacity).toBe(1);
  });

  it("drops layers with no art, so an empty set renders exactly like no parallax", () => {
    const f: LayersFile = { defaultSetId: "s", sets: { s: set("s", [{ id: "far" }, { id: "mid" }]) }, rooms: {} };
    const r = resolveRoomLayers(contentWith(f), "any");
    expect(r.behind).toHaveLength(0);
    expect(r.front).toHaveLength(0);
  });

  it("keeps a layer that has only props (no strip)", () => {
    const f: LayersFile = {
      defaultSetId: "s",
      sets: { s: set("s", [{ id: "far", props: [{ id: "p", sprite: px("p"), x: 0, y: 0, w: 8, h: 8 }] }]) },
      rooms: {},
    };
    expect(resolveRoomLayers(contentWith(f), "any").behind).toHaveLength(1);
  });

  it("drops fully transparent layers", () => {
    const f = file();
    f.sets.s.layers[0].opacity = 0;
    expect(resolveRoomLayers(contentWith(f), "any").behind.map((l) => l.id)).toEqual(["mid"]);
  });

  it("fills every knob so render code can read fields unconditionally", () => {
    const l = withLayerDefaults({ id: "bare", sprite: px("x") });
    for (const k of ["scrollX", "scrollY", "driftX", "driftY", "opacity", "offsetY", "plane", "wrapX", "wrapY"]) {
      expect(l[k as keyof typeof l]).toBeDefined();
    }
  });

  it("an undefined override value does not erase the set's value", () => {
    const f = file();
    f.rooms.vents = { setId: "s", overrides: { far: { opacity: undefined } } };
    expect(resolveRoomLayers(contentWith(f), "vents").behind[0].opacity).toBe(1);
  });
});

describe("shipped defaults", () => {
  it("the bundled set is art-free, so shipping parallax changes nothing for players", () => {
    const file = bundledLayers as unknown as LayersFile;
    const layers = Object.values(file.sets).flatMap((s) => s.layers);
    expect(layers.length).toBeGreaterThan(0);
    for (const l of layers) {
      expect(l.sprite).toBeUndefined();
      expect(l.props ?? []).toHaveLength(0);
    }
    expect(resolveRoomLayers(contentWith(file), "orientation").behind).toHaveLength(0);
    expect(resolveRoomLayers(contentWith(file), "orientation").front).toHaveLength(0);
  });

  it("the near preset is a front layer that protects readability by default", () => {
    expect(DEPTH_PRESETS.near.plane).toBe("front");
    expect(DEPTH_PRESETS.near.fadeNearPlayer).toBe(true);
  });

  it("presets get further-away layers moving slower than nearer ones", () => {
    expect(DEPTH_PRESETS.far.scrollX!).toBeLessThan(DEPTH_PRESETS.mid.scrollX!);
    expect(DEPTH_PRESETS.mid.scrollX!).toBeLessThan(DEPTH_PRESETS.near.scrollX!);
  });
});
