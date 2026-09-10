// Parallax layer design requirements (Sean, 2026-09-02). Layers are polish,
// but two properties are load-bearing and easy to regress:
//   1. They are COSMETIC ONLY — nothing here may ever reach the simulation,
//      or replaying a recorded run would diverge when art is republished.
//   2. The shipped default set is art-free, so adding parallax to the game
//      changes NOTHING for players until the artist actually fills it in.
import { describe, expect, it } from "vitest";
import type { Content, LayersFile } from "../src/data/types";
import { resolveLayerSet, resolveRoomLayers, setIdForRoom, withLayerDefaults, DEPTH_PRESETS } from "../src/game/layers";
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
  // This used to assert the bundled file was art-free, which is how parallax
  // shipped inert. Real art has since been published into it (2026-09-09), so
  // that assertion now just means "the artist may never publish a backdrop".
  // What's still worth pinning is that the shipped file actually RESOLVES —
  // a malformed one would throw in the render loop on every frame.
  it("the bundled layers file resolves cleanly for every room", () => {
    const file = bundledLayers as unknown as LayersFile;
    expect(Object.keys(file.sets).length).toBeGreaterThan(0);
    for (const set of Object.values(file.sets)) {
      expect(Array.isArray(set.layers)).toBe(true);
      for (const l of set.layers) expect(typeof l.id).toBe("string");
    }
    for (const roomId of ["orientation", "mess_hall", "the_long_run"]) {
      const r = resolveRoomLayers(contentWith(file), roomId);
      expect(Array.isArray(r.behind)).toBe(true);
      expect(Array.isArray(r.front)).toBe(true);
      // Anything that resolves must be drawable — art or props, never a
      // blank layer the renderer would still iterate every frame.
      for (const l of [...r.behind, ...r.front]) {
        expect(!!l.sprite || !!l.props?.some((p) => p.sprite)).toBe(true);
      }
    }
  });

  it("a layer set with no art still renders exactly like no parallax", () => {
    // The property the art-free assertion above was really protecting.
    const bare: LayersFile = {
      defaultSetId: "s",
      sets: { s: set("s", [{ id: "far" }, { id: "mid", props: [] }]) },
      rooms: {},
    };
    expect(resolveRoomLayers(contentWith(bare), "orientation").behind).toHaveLength(0);
    expect(resolveRoomLayers(contentWith(bare), "orientation").front).toHaveLength(0);
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

describe("resolving an explicit set", () => {
  // The Art Studio previews the set being EDITED, not whichever set the
  // previewed room happens to be bound to — otherwise a set that isn't bound
  // anywhere yet silently previews as someone else's art, and nothing you add
  // to it ever appears (Sean, 2026-09-09: "I don't see it there").
  const set = {
    id: "s", name: "s",
    layers: [
      { id: "far", sprite: px("far"), opacity: 1 },
      { id: "fore", sprite: px("fore"), plane: "front" as const },
    ],
  };

  it("resolves a set that no room is bound to", () => {
    const r = resolveLayerSet(set);
    expect(r.behind.map((l) => l.id)).toEqual(["far"]);
    expect(r.front.map((l) => l.id)).toEqual(["fore"]);
  });

  it("applies the previewed room's overrides to it", () => {
    const r = resolveLayerSet(set, { far: { opacity: 0.3 } });
    expect(r.behind[0].opacity).toBe(0.3);
  });

  it("keeps a props-only layer, so adding a prop makes the layer appear", () => {
    const r = resolveLayerSet({
      id: "s", name: "s",
      layers: [{ id: "far", props: [{ id: "p", sprite: px("p"), x: 0, y: 0, w: 8, h: 8 }] }],
    });
    expect(r.behind).toHaveLength(1);
  });

  it("survives an undefined set (deleted while being edited)", () => {
    expect(resolveLayerSet(undefined)).toEqual({ behind: [], front: [] });
  });
});
