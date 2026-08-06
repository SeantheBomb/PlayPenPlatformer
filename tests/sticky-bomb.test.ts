// Sticky bomb: bursts real "goo" tiles into empty pockets near a surface
// within blast radius, using the ordinary tileOverrides mechanism (same as
// melt/burn) rather than any bespoke persistence.
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
    elements: [], behaviors: behaviorsJson as never,
    rules: [],
    achievements: [],
    tiles: TILES,
    items: [],
    recipes: [],
    enemies: [],
    taunts: [],
    campaign: { rooms: [] },
    rooms: {},
  } as unknown as Content;
}

function makeMuts(): RoomMutations {
  return {
    collected: new Set(),
    tileOverrides: [],
    openedDoors: new Set(),
    gateTouched: new Set(),
    helpedNpcs: new Set(),
    disabledEnemies: new Set(),
    drops: [],
    placedItems: [],
    brazierLit: [],
    sourceAmounts: [],
  };
}

function makeRoom(tiles: string[]): RoomDef {
  return {
    id: "test", name: "Test", width: tiles[0].length, height: tiles.length,
    background: "#000", tiles, entities: [],
  } as RoomDef;
}

const styleAt = (rt: RoomRuntime, tx: number, ty: number) => rt.map.at(tx, ty)?.style;

describe("sticky bomb: goo splat placement", () => {
  it("fills every open pocket bordering a surface within radius with a real goo tile", () => {
    const rt = new RoomRuntime(
      makeRoom([
        "#####",
        "#...#",
        "#...#",
        "#...#",
        "#####",
      ]),
      makeContent(), makeMuts()
    );
    // Center of the 3x3 open interior.
    rt.spreadGoo(2 * 16 + 8, 2 * 16 + 8, 40);

    // Every interior cell EXCEPT the very center borders a solid wall (it's
    // a 3x3 room) — those 8 should become goo. The center cell touches no
    // wall directly, so it stays empty; walls themselves stay solid.
    for (let ty = 1; ty <= 3; ty++) {
      for (let tx = 1; tx <= 3; tx++) {
        if (tx === 2 && ty === 2) continue;
        expect(styleAt(rt, tx, ty)).toBe("goo");
      }
    }
    expect(rt.map.at(2, 2)).toBeNull();
    expect(rt.map.at(0, 0)?.solid).toBe(true);
    expect(styleAt(rt, 0, 0)).not.toBe("goo");
  });

  it("does not reach open cells outside the blast radius", () => {
    const rows = ["#".repeat(12)];
    for (let i = 0; i < 3; i++) rows.push("#" + ".".repeat(10) + "#");
    rows.push("#".repeat(12));
    const rt = new RoomRuntime(makeRoom(rows), makeContent(), makeMuts());
    // Blast near the left wall only — far right wall (tx=10) is out of range.
    rt.spreadGoo(2 * 16 + 8, 2 * 16 + 8, 24);
    expect(styleAt(rt, 1, 2)).toBe("goo");
    expect(styleAt(rt, 10, 2)).not.toBe("goo");
  });

  it("never overwrites a non-empty cell (fire, water, another tile)", () => {
    const rt = new RoomRuntime(
      makeRoom([
        "#####",
        "#.f.#",
        "#...#",
        "#####",
      ]),
      makeContent(), makeMuts()
    );
    rt.spreadGoo(2 * 16 + 8, 1 * 16 + 8, 40);
    expect(styleAt(rt, 2, 1)).toBe("fire"); // untouched
    expect(styleAt(rt, 1, 1)).toBe("goo");  // adjacent empty cell still fills
  });

  it("skips open cells that don't border any solid tile", () => {
    // A big open field with a wall only far to one side — the center cell
    // is open but doesn't touch a surface, so it should stay empty.
    const rows = [
      "#..........",
      "............",
      "............",
    ];
    const rt = new RoomRuntime(makeRoom(rows), makeContent(), makeMuts());
    rt.spreadGoo(6 * 16 + 8, 1 * 16 + 8, 200);
    expect(rt.map.at(6, 1)).toBeNull(); // far from any wall
  });
});

describe("sticky bomb: goo durability (existing elemental rules, no new code)", () => {
  it("is flammable, same as any authored goo puddle", () => {
    const gooDef = TILES.find((t) => t.id === "goo");
    expect(gooDef?.flammable).toBe(true);
  });
});
