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

function makeContent(): Content {
  return {
    game: gameJson as Content["game"], elements: [], rules: [], achievements: [],
    tiles: [], items: itemsJson as ItemDef[], recipes: [], enemies: [], taunts: [],
    campaign: { rooms: [] }, rooms: {},
  } as unknown as Content;
}

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
