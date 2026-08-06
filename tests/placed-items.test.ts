// Design requirement (Sean, playtest 2026-07-26, Meredith: "Can't pick up
// placed sticky trap, softlocks BF"): every placed item must be reclaimable
// with E, the same way a spring always has been — a placed item you can't
// take back is a softlock waiting to happen. Run `npm test` before touching
// placedItemNear/placeItem/removePlaced in room.ts.
import { describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/game/room";
import type { Content, RoomDef, TileDef } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import tilesJson from "../content/tiles.json";
import gameJson from "../content/game.json";
import behaviorsJson from "../content/behaviors.json";

const TILES = tilesJson as TileDef[];

function makeContent(): Content {
  return {
    game: gameJson as Content["game"],
    elements: [], behaviors: behaviorsJson as never, rules: [], achievements: [],
    tiles: TILES, items: [], recipes: [], enemies: [], taunts: [],
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
function makeRoom(): RoomRuntime {
  const rows = ["......", "......", "......"];
  const room: RoomDef = {
    id: "test", name: "test", width: 6, height: 3,
    background: "#000", tiles: rows, entities: [],
  } as RoomDef;
  return new RoomRuntime(room, makeContent(), makeMuts());
}

describe("placedItemNear finds any placed item type, not just spring", () => {
  it("finds a placed trap within range", () => {
    const rt = makeRoom();
    rt.placeItem("trap", 32, 16);
    const found = rt.placedItemNear(32 + 7, 16 + 6);
    expect(found).not.toBeNull();
    expect(found?.data.type).toBe("trap");
  });

  it("finds a placed spring within range (existing behavior preserved)", () => {
    const rt = makeRoom();
    rt.placeItem("spring", 32, 16);
    const found = rt.placedItemNear(32 + 7, 16 + 6);
    expect(found).not.toBeNull();
    expect(found?.data.type).toBe("spring");
  });

  it("returns null when nothing is placed nearby", () => {
    const rt = makeRoom();
    rt.placeItem("trap", 32, 16);
    expect(rt.placedItemNear(500, 500)).toBeNull();
  });
});

describe("removePlaced reclaims a placed trap the same way as a spring", () => {
  it("removes the trap from both the live list and the persisted mutations", () => {
    const rt = makeRoom();
    rt.placeItem("trap", 32, 16);
    expect(rt.placed.length).toBe(1);
    const inst = rt.placedItemNear(32 + 7, 16 + 6)!;
    rt.removePlaced(inst);
    expect(rt.placed.length).toBe(0);
    expect(rt.placedItemNear(32 + 7, 16 + 6)).toBeNull();
  });

  it("a used (already-triggered) trap is still reclaimable, not stuck forever", () => {
    const rt = makeRoom();
    rt.placeItem("trap", 32, 16);
    rt.placed[0].data.used = true;
    const inst = rt.placedItemNear(32 + 7, 16 + 6);
    expect(inst).not.toBeNull();
    rt.removePlaced(inst!);
    expect(rt.placed.length).toBe(0);
  });
});
