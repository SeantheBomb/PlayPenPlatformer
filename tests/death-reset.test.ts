// Design requirement (Sean, 2026-07-26): "When the player dies, any of their
// equipped items should be reset. Torches should be unlit and buckets should
// be empty, etc." — generic, driven by each item's dousesTo/emptiesTo carrier
// field (the one rule: no hardcoded per-item special-casing). Run `npm test`
// before touching RunState.resetTransformedItems.
import { describe, expect, it } from "vitest";
import { RunState } from "../src/game/state";
import type { Content, ItemDef } from "../src/data/types";
import itemsJson from "../content/items.json";
import gameJson from "../content/game.json";
import behaviorsJson from "../content/behaviors.json";

function makeContent(): Content {
  return {
    game: gameJson as Content["game"], elements: [], behaviors: behaviorsJson as never, rules: [], achievements: [],
    tiles: [], items: itemsJson as ItemDef[], recipes: [], enemies: [], taunts: [],
    campaign: { rooms: [] }, rooms: {},
  } as unknown as Content;
}

// REGRESSION (player report, 2026-08-06, exit_wing, "stuck"): "I had a spark
// rod and then I died from a spotter and the spark rod was gone as well as
// the ingredients I used to craft it." Root cause: respawnAt (game.ts) and
// the two editor/deep-link loadout appliers all used a bare `if (loadout)`
// check — but an EMPTY array is truthy in JS, and the editor's checkpoint-
// inspector loadout-list UI lazily sets `loadout: []` on the entity just
// from the panel being opened (roomeditor.ts's `sel.loadout ?? (sel.loadout
// = [])`). Confirmed via the actual session: state.checkpoint.loadout was
// `[]` (not undefined) from the very first heartbeat. Every death at that
// checkpoint replaced the whole inventory with... nothing. Fixed by
// centralizing all three call sites on RunState.applyLoadout, which treats
// an empty array the same as no loadout at all.
describe("applyLoadout", () => {
  it("an empty array does NOT wipe the inventory — only undefined/populated loadouts count", () => {
    const state = new RunState(makeContent(), "test");
    state.add("spark_rod", 1);
    state.add("cog", 1);
    const applied = state.applyLoadout([]);
    expect(applied).toBe(false);
    expect(state.count("spark_rod")).toBe(1);
    expect(state.count("cog")).toBe(1);
  });

  it("undefined also leaves the inventory untouched", () => {
    const state = new RunState(makeContent(), "test");
    state.add("hammer", 1);
    const applied = state.applyLoadout(undefined);
    expect(applied).toBe(false);
    expect(state.count("hammer")).toBe(1);
  });

  it("a real (non-empty) loadout DOES replace the inventory", () => {
    const state = new RunState(makeContent(), "test");
    state.add("hammer", 1);
    const applied = state.applyLoadout([{ item: "bucket", count: 1 }, { item: "scrap_metal", count: 3 }]);
    expect(applied).toBe(true);
    expect(state.count("hammer")).toBe(0);
    expect(state.count("bucket")).toBe(1);
    expect(state.count("scrap_metal")).toBe(3);
  });
});

describe("resetTransformedItems", () => {
  it("douses a lit torch back to unlit", () => {
    const state = new RunState(makeContent(), "test");
    state.add("torch_lit", 1);
    const changed = state.resetTransformedItems();
    expect(changed).toEqual(["torch_lit"]);
    expect(state.count("torch_lit")).toBe(0);
    expect(state.count("torch")).toBe(1);
  });

  it("empties a full water bucket and a lava bucket back to plain bucket", () => {
    const state = new RunState(makeContent(), "test");
    state.add("bucket_full", 1);
    state.add("bucket_lava", 2);
    const changed = state.resetTransformedItems().sort();
    expect(changed).toEqual(["bucket_full", "bucket_lava"]);
    expect(state.count("bucket_full")).toBe(0);
    expect(state.count("bucket_lava")).toBe(0);
    expect(state.count("bucket")).toBe(3); // merges into any bucket already owned
  });

  it("merges into stock already owned rather than overwriting it", () => {
    const state = new RunState(makeContent(), "test");
    state.add("bucket", 1);
    state.add("bucket_full", 1);
    state.resetTransformedItems();
    expect(state.count("bucket")).toBe(2);
  });

  it("leaves plain materials and untransformed tools untouched", () => {
    const state = new RunState(makeContent(), "test");
    state.add("scrap_metal", 5);
    state.add("hammer", 1);
    state.add("bucket", 1);
    const changed = state.resetTransformedItems();
    expect(changed).toEqual([]);
    expect(state.count("scrap_metal")).toBe(5);
    expect(state.count("hammer")).toBe(1);
    expect(state.count("bucket")).toBe(1);
  });
});
