// Sticky bomb: per-face goo splat placement/orientation and durability
// (fire/water destroys goo, same reactions as the full-tile goo substance).
import { describe, expect, it } from "vitest";
import { RoomRuntime, type GooFace } from "../src/game/room";
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
    gooFaces: [],
  };
}

function makeRoom(tiles: string[]): RoomDef {
  return {
    id: "test", name: "Test", width: tiles[0].length, height: tiles.length,
    background: "#000", tiles, entities: [],
  } as RoomDef;
}

function tickGoo(rt: RoomRuntime, n = 1): void {
  for (let i = 0; i < n; i++) (rt as never as { tickGooDurability(): void }).tickGooDurability();
}

describe("sticky bomb: goo splat orientation", () => {
  it("paints each surrounding wall/floor/ceiling face toward the blast, and nothing further out", () => {
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

    expect(rt.hasGooFace(2, 0, "bottom")).toBe(true); // ceiling above the room
    expect(rt.hasGooFace(2, 4, "top")).toBe(true);    // floor below the room
    expect(rt.hasGooFace(0, 2, "right")).toBe(true);  // left wall
    expect(rt.hasGooFace(4, 2, "left")).toBe(true);   // right wall

    // Corners get both faces they border.
    expect(rt.hasGooFace(0, 0, "bottom")).toBe(false); // no open cell borders (0,0) itself
    expect(rt.hasGooFace(0, 0, "right")).toBe(false);
    expect(rt.gooFacesAt(0, 0)).toBeUndefined();

    // A face never gets marked on its wrong (outward-away) side.
    expect(rt.hasGooFace(2, 0, "top")).toBe(false);
    expect(rt.hasGooFace(0, 2, "left")).toBe(false);
  });

  it("only reaches surfaces within the blast radius", () => {
    const rows = ["#".repeat(12)];
    for (let i = 0; i < 3; i++) rows.push("#" + ".".repeat(10) + "#");
    rows.push("#".repeat(12));
    const rt = new RoomRuntime(makeRoom(rows), makeContent(), makeMuts());
    // Blast near the left wall only — far right wall (tx=11) is out of range.
    rt.spreadGoo(2 * 16 + 8, 2 * 16 + 8, 24);
    expect(rt.hasGooFace(0, 2, "right")).toBe(true);
    expect(rt.hasGooFace(11, 2, "left")).toBe(false);
  });
});

describe("sticky bomb: goo durability", () => {
  function faceDown(face: GooFace, rt: RoomRuntime, tx: number, ty: number): boolean {
    return rt.hasGooFace(tx, ty, face);
  }

  it("fire burns adjacent goo off", () => {
    const rt = new RoomRuntime(
      makeRoom([
        "#####",
        "#.f.#",
        "#...#",
        "#####",
      ]),
      makeContent(), makeMuts()
    );
    rt.spreadGoo(2 * 16 + 8, 1 * 16 + 8, 20);
    expect(faceDown("bottom", rt, 2, 0)).toBe(true);
    tickGoo(rt);
    expect(faceDown("bottom", rt, 2, 0)).toBe(false);
  });

  it("water washes adjacent goo off", () => {
    const rt = new RoomRuntime(
      makeRoom([
        "#####",
        "#.w.#",
        "#...#",
        "#####",
      ]),
      makeContent(), makeMuts()
    );
    rt.spreadGoo(2 * 16 + 8, 1 * 16 + 8, 20);
    expect(faceDown("bottom", rt, 2, 0)).toBe(true);
    tickGoo(rt);
    expect(faceDown("bottom", rt, 2, 0)).toBe(false);
  });

  it("goo with no fire/water neighbor persists indefinitely", () => {
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
    rt.spreadGoo(2 * 16 + 8, 2 * 16 + 8, 40);
    tickGoo(rt, 10);
    expect(rt.hasGooFace(2, 4, "top")).toBe(true);
    expect(rt.hasGooFace(0, 2, "right")).toBe(true);
  });
});
