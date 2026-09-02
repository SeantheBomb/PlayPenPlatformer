// Pins the publish merge/diff contract (functions/api/_merge.js) — the code
// that lets Sean (browser editor) and AI (repo pushes) publish concurrently
// without clobbering each other. Locked semantics (Sean, 2026-08-08):
// last publisher wins anything BOTH sides changed since the common base;
// work on different files / id-entries / game.json keys survives from both.
import { describe, expect, it } from "vitest";
import {
  deepEqual, diffBundles, mergeBundles, summarizeDiff,
} from "../functions/api/_merge.js";

const room = (id: string, map: string[]) => ({ id, name: id, map });

describe("mergeBundles", () => {
  it("keeps both sides' work when they touched different files", () => {
    const base = {
      "rooms/vents.json": room("vents", ["..", ".."]),
      "behaviors.json": [{ id: "chaseOnSight", script: ["old"] }],
    };
    // Sean edited the room; AI edited the behavior.
    const live = { ...base, "rooms/vents.json": room("vents", ["##", ".."]) };
    const incoming = { ...base, "behaviors.json": [{ id: "chaseOnSight", script: ["new"] }] };
    const out = mergeBundles(base, live, incoming);
    expect(out["rooms/vents.json"]).toEqual(live["rooms/vents.json"]);
    expect(out["behaviors.json"]).toEqual(incoming["behaviors.json"]);
  });

  it("merges id-keyed arrays per entry, both sides' edits surviving in one file", () => {
    const base = { "items.json": [{ id: "torch", color: "#f80" }, { id: "bucket", color: "#08f" }] };
    const live = { "items.json": [{ id: "torch", color: "#ff0" }, { id: "bucket", color: "#08f" }] };
    const incoming = { "items.json": [{ id: "torch", color: "#f80" }, { id: "bucket", color: "#00f" }] };
    const out = mergeBundles(base, live, incoming)["items.json"] as { id: string; color: string }[];
    expect(out.find((e) => e.id === "torch")?.color).toBe("#ff0"); // live's edit
    expect(out.find((e) => e.id === "bucket")?.color).toBe("#00f"); // incoming's edit
  });

  it("last publisher wins an entry both sides changed", () => {
    const base = { "enemies.json": [{ id: "spotter", damage: 1 }] };
    const live = { "enemies.json": [{ id: "spotter", damage: 2 }] };
    const incoming = { "enemies.json": [{ id: "spotter", damage: 3 }] };
    const out = mergeBundles(base, live, incoming)["enemies.json"] as { damage: number }[];
    expect(out[0].damage).toBe(3);
  });

  it("keeps additions from both sides", () => {
    const base = { "items.json": [{ id: "torch" }] };
    const live = { "items.json": [{ id: "torch" }, { id: "lantern" }] };
    const incoming = { "items.json": [{ id: "torch" }, { id: "rope" }] };
    const out = mergeBundles(base, live, incoming)["items.json"] as { id: string }[];
    expect(out.map((e) => e.id).sort()).toEqual(["lantern", "rope", "torch"]);
  });

  it("honors deletes: incoming's delete wins, live's delete stands if incoming untouched", () => {
    const base = { "items.json": [{ id: "a", v: 1 }, { id: "b", v: 1 }] };
    const live = { "items.json": [{ id: "a", v: 1 }] };            // live deleted b
    const incoming = { "items.json": [{ id: "b", v: 1 }] };        // incoming deleted a
    const out = mergeBundles(base, live, incoming)["items.json"] as { id: string }[];
    expect(out).toEqual([]); // both deletes stand
  });

  it("incoming edit beats a live delete of the same entry (last writer wins)", () => {
    const base = { "items.json": [{ id: "a", v: 1 }] };
    const live = { "items.json": [] };                              // live deleted a
    const incoming = { "items.json": [{ id: "a", v: 2 }] };         // incoming edited a
    const out = mergeBundles(base, live, incoming)["items.json"] as { id: string; v: number }[];
    expect(out).toEqual([{ id: "a", v: 2 }]);
  });

  it("merges game.json per nested key", () => {
    const base = { "game.json": { player: { speed: 100, swim: { gravity: 30 } }, hud: { airX: 10 } } };
    const live = { "game.json": { player: { speed: 100, swim: { gravity: 20 } }, hud: { airX: 10 } } };
    const incoming = { "game.json": { player: { speed: 120, swim: { gravity: 30 } }, hud: { airX: 10 } } };
    const out = mergeBundles(base, live, incoming)["game.json"] as {
      player: { speed: number; swim: { gravity: number } };
    };
    expect(out.player.speed).toBe(120);        // incoming's edit
    expect(out.player.swim.gravity).toBe(20);  // live's edit
  });

  it("merges layers.json per set and per room binding", () => {
    // Two concurrent art publishes: one dressed the greenhouse, the other
    // retuned the facility set. Both must survive.
    const mk = (facilityOpacity: number, rooms: Record<string, unknown>) => ({
      "layers.json": {
        defaultSetId: "facility",
        sets: { facility: { id: "facility", name: "Facility", layers: [{ id: "far", opacity: facilityOpacity }] } },
        rooms,
      },
    });
    const base = mk(1, {});
    const live = mk(1, { greenhouse: { setId: "green" } });
    const incoming = mk(0.4, {});
    const out = mergeBundles(base, live, incoming)["layers.json"] as {
      sets: { facility: { layers: { opacity: number }[] } };
      rooms: Record<string, { setId: string }>;
    };
    expect(out.sets.facility.layers[0].opacity).toBe(0.4);   // incoming's retune
    expect(out.rooms.greenhouse.setId).toBe("green");        // live's binding
  });

  it("rooms are atomic: incoming wins a room both sides edited", () => {
    const base = { "rooms/vents.json": room("vents", [".."]) };
    const live = { "rooms/vents.json": room("vents", ["#."]) };
    const incoming = { "rooms/vents.json": room("vents", [".#"]) };
    const out = mergeBundles(base, live, incoming);
    expect(out["rooms/vents.json"]).toEqual(incoming["rooms/vents.json"]);
  });

  it("keeps whole files only one side has (new room from each side)", () => {
    const base = {};
    const live = { "rooms/attic.json": room("attic", [".."]) };
    const incoming = { "rooms/cellar.json": room("cellar", [".."]) };
    const out = mergeBundles(base, live, incoming);
    expect(out["rooms/attic.json"]).toBeDefined();
    expect(out["rooms/cellar.json"]).toBeDefined();
  });

  it("no base at all falls back to incoming (wholesale, the legacy path)", () => {
    const live = { "items.json": [{ id: "a", v: 1 }], "rooms/x.json": room("x", ["."]) };
    const incoming = { "items.json": [{ id: "a", v: 2 }] };
    const out = mergeBundles(undefined, live, incoming);
    // With base={}, everything live has counts as a live addition and every
    // incoming file counts as an incoming change — incoming wins overlaps.
    expect((out["items.json"] as { v: number }[])[0].v).toBe(2);
    expect(out["rooms/x.json"]).toBeDefined();
  });
});

describe("diffBundles / summarizeDiff", () => {
  it("reports per-entry changes with field names", () => {
    const a = { "enemies.json": [{ id: "spotter", damage: 3, speed: 40 }] };
    const b = { "enemies.json": [{ id: "spotter", damage: 1, speed: 40 }, { id: "roomba" }] };
    const d = diffBundles(a, b);
    expect(d).toHaveLength(1);
    expect(d[0].entries).toEqual(expect.arrayContaining([
      { id: "spotter", kind: "changed", fields: ["damage"] },
      { id: "roomba", kind: "added" },
    ]));
  });

  it("reports game.json changes as dotted paths", () => {
    const a = { "game.json": { player: { swim: { gravity: 30 } } } };
    const b = { "game.json": { player: { swim: { gravity: 20 } } } };
    const d = diffBundles(a, b);
    expect(d[0].paths).toEqual(["player.swim.gravity"]);
  });

  it("reports added/removed files and ignores identical ones", () => {
    const a = { "rooms/x.json": room("x", ["."]), "rooms/same.json": room("same", ["."]) };
    const b = { "rooms/y.json": room("y", ["."]), "rooms/same.json": room("same", ["."]) };
    const kinds = Object.fromEntries(diffBundles(a, b).map((c) => [c.file, c.kind]));
    expect(kinds).toEqual({ "rooms/x.json": "removed", "rooms/y.json": "added" });
  });

  it("an order-only array shuffle is a change with no entry diffs", () => {
    const a = { "items.json": [{ id: "a" }, { id: "b" }] };
    const b = { "items.json": [{ id: "b" }, { id: "a" }] };
    const d = diffBundles(a, b);
    expect(d).toHaveLength(1);
    expect(d[0].entries).toBeUndefined();
  });

  it("summarize is one compact line per file, capped", () => {
    const lines = summarizeDiff([
      { file: "items.json", kind: "changed", entries: [{ id: "torch", kind: "changed", fields: ["color"] }] },
      { file: "rooms/vents.json", kind: "changed" },
      { file: "rooms/attic.json", kind: "added" },
    ]);
    expect(lines).toEqual([
      "items.json: ~torch",
      "~ rooms/vents.json",
      "+ rooms/attic.json",
    ]);
  });
});

describe("deepEqual", () => {
  it("handles nested objects, arrays, and mismatched shapes", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });
});
