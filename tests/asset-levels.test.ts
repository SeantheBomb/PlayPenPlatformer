// The Art Studio's level filter (Miranda's ask, 2026-11-04): which levels
// each asset shows up in — placed, transformed into, handed out, or
// craftable there. src/studio/levels.ts is the pure model.
import { describe, expect, it } from "vitest";
import { assetLevels, levelOrder } from "../src/studio/levels";
import type { Content } from "../src/data/types";

function fixture(): Content {
  return {
    tiles: [
      { id: "wall", char: "#", name: "Wall" },
      { id: "cracked", char: "c", name: "Cracked", meltsTo: "lava" },
      { id: "lava", char: "L", name: "Lava" },
      { id: "waterfall", char: "w", name: "Waterfall", fallSpawns: "water" },
      { id: "water", char: "~", name: "Water" },
      { id: "metal", char: "m", name: "Metal", dropsItem: "scrap" },
    ],
    items: [
      { id: "scrap", name: "Scrap" }, { id: "plank", name: "Plank" }, { id: "hammer", name: "Hammer" },
      { id: "torch", name: "Torch", dousesTo: "torch_out" }, { id: "torch_out", name: "Unlit torch" },
      { id: "gem", name: "Gem" },
    ],
    recipes: [{ id: "r", inputs: ["scrap", "plank"], output: "hammer", flavor: "" }],
    campaign: { rooms: ["b", "a"] },
    rooms: {
      a: {
        id: "a", name: "Alpha", tiles: ["#c", "m#"],
        entities: [
          { type: "pickup", x: 0, y: 0, item: "plank" },
          { type: "enemy", x: 1, y: 0, enemy: "spotter" },
          { type: "npc", x: 1, y: 0, npcId: "toby", rewardItems: [{ item: "torch", count: 1 }] },
        ],
      },
      b: { id: "b", name: "Beta", tiles: ["w#"], entities: [{ type: "door", x: 0, y: 0 }], wardenChase: { speed: 1, delayMs: 0 } },
      z: { id: "z", name: "Zed", tiles: [], entities: [] },
    },
  } as unknown as Content;
}

describe("assetLevels", () => {
  const m = assetLevels(fixture());
  const where = (k: string) => [...(m.get(k) ?? [])].sort();

  it("places tiles by char, plus what they turn into", () => {
    expect(where("tile:wall")).toEqual(["a", "b"]);
    expect(where("tile:lava")).toEqual(["a"]);   // cracked melts to lava
    expect(where("tile:water")).toEqual(["b"]);  // the waterfall spawns water
  });

  it("items: dropped, handed out, transformed, and crafted from what the room supplies", () => {
    expect(where("item:scrap")).toEqual(["a"]);     // metal drops it
    expect(where("item:hammer")).toEqual(["a"]);    // scrap + plank both in a
    expect(where("item:torch_out")).toEqual(["a"]); // reward torch douses to it
    expect(m.has("item:gem")).toBe(false);          // nowhere
  });

  it("entities, enemies and residents by what's placed", () => {
    expect(where("entity:door")).toEqual(["b"]);
    expect(where("enemy:spotter")).toEqual(["a"]);
    expect(where("npc:toby")).toEqual(["a"]);
    expect(where("npc-portrait:toby")).toEqual(["a"]);
  });

  it("the player and the Warden's faces are everywhere; the chase body only where it chases", () => {
    expect(where("player")).toEqual(["a", "b", "z"]);
    expect(where("warden-portrait:smug")).toEqual(["a", "b", "z"]);
    expect(where("warden")).toEqual(["b"]);
  });

  it("levels list in campaign order, then rooms the campaign doesn't list", () => {
    expect(levelOrder(fixture()).map((r) => r.id)).toEqual(["b", "a", "z"]);
  });
});
