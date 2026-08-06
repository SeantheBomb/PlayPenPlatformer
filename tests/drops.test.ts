// Scattered item drop design requirements (Sean, 2026-07-26): death drops and
// melted-tile drops ("lava melts a metal block into scrap") must appear as
// real per-item icons flying outward, not one generic bag — asserted
// headlessly against RoomRuntime. Run `npm test` before touching
// spawnScatterDrop/scatterItems/the drop-physics tick in room.ts.
import { describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/game/room";
import type { Content, RoomDef, TileDef, ItemDef, RuleDef } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import tilesJson from "../content/tiles.json";
import itemsJson from "../content/items.json";
import rulesJson from "../content/rules.json";
import gameJson from "../content/game.json";
import behaviorsJson from "../content/behaviors.json";

const TILES = tilesJson as TileDef[];

function makeContent(): Content {
  return {
    game: gameJson as Content["game"],
    elements: [], behaviors: behaviorsJson as never, rules: rulesJson as RuleDef[], achievements: [],
    tiles: TILES, items: itemsJson as ItemDef[], recipes: [], enemies: [], taunts: [],
    campaign: { rooms: [] }, rooms: {},
  } as unknown as Content;
}

function makeMuts(): RoomMutations {
  return {
    collected: new Set(), tileOverrides: [], openedDoors: new Set(),
    gateTouched: new Set(), helpedNpcs: new Set(), disabledEnemies: new Set(),
    drops: [], placedItems: [], brazierLit: [], sourceAmounts: [], gooFaces: [],
  };
}

const ROWS = ["....", "..M.", "...."];

function makeRoom(): { rt: RoomRuntime; muts: RoomMutations } {
  const room: RoomDef = {
    id: "test", name: "test", width: ROWS[0].length, height: ROWS.length,
    background: "#000", tiles: ROWS, entities: [],
  } as RoomDef;
  const muts = makeMuts();
  return { rt: new RoomRuntime(room, makeContent(), muts, new Set(), 42), muts };
}

describe("lava melting a metal block drops real scrap metal, not a generic bag", () => {
  it("produces a ScatterDrop carrying itemId scrap_metal", () => {
    const { rt } = makeRoom();
    rt.applyElementToTiles("lava", { x: 2 * 16, y: 1 * 16, w: 16, h: 16 });
    expect(rt.drops.length).toBe(1);
    expect(rt.drops[0].itemId).toBe("scrap_metal");
    expect(rt.drops[0].count).toBe(1);
  });
});

describe("scatterItems splits a stack into discrete flying icons (Sonic-ring style)", () => {
  it("spawns up to 5 separate drops per stack, conserving total count", () => {
    const { rt } = makeRoom();
    rt.scatterItems(32, 32, [["scrap_metal", 12], ["wood", 2]]);
    const metalDrops = rt.drops.filter((d) => d.itemId === "scrap_metal");
    const woodDrops = rt.drops.filter((d) => d.itemId === "wood");
    expect(metalDrops.length).toBe(5); // capped, not one bundle of 12
    expect(metalDrops.reduce((s, d) => s + d.count, 0)).toBe(12);
    expect(woodDrops.length).toBe(2); // fewer than the cap: one icon per unit
    expect(woodDrops.every((d) => d.count === 1)).toBe(true);
  });

  it("gives every spawned drop outward, non-zero launch velocity", () => {
    const { rt } = makeRoom();
    rt.scatterItems(32, 32, [["scrap_metal", 3]]);
    for (const d of rt.drops) {
      expect(d.settled).toBe(false);
      expect(d.vx !== 0 || d.vy !== 0).toBe(true);
    }
  });
});

describe("scattered drops fall and settle onto solid ground", () => {
  it("a drop above open floor comes to rest instead of flying forever", () => {
    const { rt } = makeRoom();
    // Solid floor 3 tiles down from the drop point.
    const room: RoomDef = {
      id: "test2", name: "test2", width: 4, height: 5,
      background: "#000",
      tiles: ["....", "....", "....", "....", "####"],
      entities: [],
    } as RoomDef;
    const muts = makeMuts();
    const rt2 = new RoomRuntime(room, makeContent(), muts, new Set(), 7);
    rt2.scatterItems(32, 16, [["scrap_metal", 1]]);
    expect(rt2.drops.length).toBe(1);
    for (let i = 0; i < 400; i++) rt2.update(1 / 60, null, 0, () => {});
    expect(rt2.drops[0].settled).toBe(true);
    expect(rt2.drops[0].vx).toBe(0);
    expect(rt2.drops[0].vy).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// REQUIREMENT (Sean, playtest 2026-07-26, Des + Meredith: "materials fall
// in lava can't be reached" / "item stuck between block and fire, lost &
// found"): a dropped item must never come to rest inside a damaging tile —
// lava/fire aren't solid, so gravity alone would let one sink straight
// through and settle unreachable beneath the surface.
// ---------------------------------------------------------------------------
describe("scattered drops are repelled out of lava/fire instead of sinking in", () => {
  it("never sinks through a deep lava pool to settle buried beneath it", () => {
    // A wide, 3-tile-deep lava pool (cols 0-6) with a small safe gap at the
    // far edge (cols 7-8) — real floor only underneath. Lava isn't solid,
    // so without a repel an item launched over the middle of the pool just
    // free-falls straight through to the bottom, ending up trapped under
    // three tiles of lava; launch drift alone can't reach the safe gap from
    // the middle, so only repeated repel-bounces (each with a fresh random
    // kick) can walk it there.
    const room: RoomDef = {
      id: "test3", name: "test3", width: 9, height: 6,
      background: "#000",
      tiles: [
        ".........",
        ".........",
        "LLLLLLL..",
        "LLLLLLL..",
        "LLLLLLL..",
        "#########",
      ],
      entities: [],
    } as RoomDef;
    const muts = makeMuts();
    const rt = new RoomRuntime(room, makeContent(), muts, new Set(), 3);
    rt.scatterItems(3 * 16 + 8, 8, [["scrap_metal", 1]]);
    const d = rt.drops[0];
    for (let i = 0; i < 600; i++) rt.update(1 / 60, null, 0, () => {});
    expect(d.settled).toBe(true);
    const tx = Math.floor((d.x + d.w / 2) / 16);
    const ty = Math.floor((d.y + d.h / 2) / 16);
    expect(rt.map.at(tx, ty)?.damage).toBeFalsy(); // not resting in the hazard itself
    expect(rt.map.at(tx, ty - 1)?.damage).toBeFalsy(); // and nothing damaging sits right above it
  });
});
