// Design requirements (Sean, 2026-07-26): balloons pop from any tool's use
// (no element check), toyblocks push grid-locked by walking into them, and
// fall exactly like fluids when nothing holds them up. Asserted headlessly
// against RoomRuntime. Run `npm test` before touching popBalloonsIn,
// pushToyblock, or tickToyblockFalls in room.ts.
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
    drops: [], placedItems: [], brazierLit: [], sourceAmounts: [],
  };
}

function makeRoom(rows: string[]): RoomRuntime {
  const room: RoomDef = {
    id: "test", name: "test", width: rows[0].length, height: rows.length,
    background: "#000", tiles: rows, entities: [],
  } as RoomDef;
  return new RoomRuntime(room, makeContent(), makeMuts());
}

const charAt = (rt: RoomRuntime, x: number, y: number) => rt.map.at(x, y)?.char ?? ".";

describe("balloons pop from any tool's use, no element required", () => {
  it("removes a balloon tile overlapped by the use box", () => {
    const rt = makeRoom(["#..b..#", "#######"]);
    const popped = rt.popBalloonsIn({ x: 2 * 16, y: 0, w: 32, h: 16 });
    expect(popped.length).toBe(1);
    expect(charAt(rt, 3, 0)).toBe("."); // gone, not just visually — real tile removed
  });

  it("leaves balloons outside the box alone", () => {
    const rt = makeRoom(["#..b..#", "#######"]);
    rt.popBalloonsIn({ x: 0, y: 0, w: 16, h: 16 }); // box only covers x0
    expect(charAt(rt, 3, 0)).toBe("b");
  });
});

describe("toyblocks push grid-locked by sustained contact", () => {
  const ROWS = ["#.T...#", "#######"];

  it("does not move on a single short frame of contact", () => {
    const rt = makeRoom(ROWS);
    rt.pushToyblock(2, 0, 1, 0.05);
    expect(charAt(rt, 2, 0)).toBe("T");
    expect(charAt(rt, 3, 0)).toBe(".");
  });

  it("hops one tile over once sustained contact crosses the threshold", () => {
    const rt = makeRoom(ROWS);
    rt.pushToyblock(2, 0, 1, 0.1);
    rt.pushToyblock(2, 0, 1, 0.1);
    rt.pushToyblock(2, 0, 1, 0.1); // 0.3s total > 0.25s threshold
    expect(charAt(rt, 2, 0)).toBe(".");
    expect(charAt(rt, 3, 0)).toBe("T");
  });

  it("resetToyblockPush drops progress so a later lean starts from zero", () => {
    const rt = makeRoom(ROWS);
    rt.pushToyblock(2, 0, 1, 0.2); // 0.2s in, just under the 0.25s threshold
    rt.resetToyblockPush(); // player let go of movement
    rt.pushToyblock(2, 0, 1, 0.2); // a fresh 0.2s — still shouldn't cross 0.25s
    expect(charAt(rt, 2, 0)).toBe("T");
    expect(charAt(rt, 3, 0)).toBe(".");
  });

  it("never pushes through a wall", () => {
    const rt = makeRoom(["T#", "##"]);
    for (let i = 0; i < 5; i++) rt.pushToyblock(0, 0, 1, 0.1);
    expect(charAt(rt, 0, 0)).toBe("T");
    expect(charAt(rt, 1, 0)).toBe("#");
  });
});

describe("toyblocks fall like fluids when nothing holds them up", () => {
  it("falls one tile per flow tick down to the floor", () => {
    const rt = makeRoom(["T....", ".....", ".....", "#####"]);
    for (let i = 0; i < 3; i++) rt.update(0.5, null, 0, () => {});
    expect(charAt(rt, 0, 0)).toBe(".");
    expect(charAt(rt, 0, 3)).toBe("#"); // the floor itself, untouched
    expect(charAt(rt, 0, 2)).toBe("T"); // rests one tile above it
  });

  it("a stack of two blocks falls together, keeping relative order", () => {
    const rt = makeRoom(["T....", "T....", ".....", ".....", "#####"]);
    for (let i = 0; i < 4; i++) rt.update(0.5, null, 0, () => {});
    expect(charAt(rt, 0, 3)).toBe("T");
    expect(charAt(rt, 0, 2)).toBe("T");
  });

  it("rests on a one-way grate instead of falling through it", () => {
    const rt = makeRoom(["T....", ".....", "=====", "#####"]);
    for (let i = 0; i < 4; i++) rt.update(0.5, null, 0, () => {});
    expect(charAt(rt, 0, 1)).toBe("T");
    expect(charAt(rt, 0, 2)).toBe("=");
  });
});
