// Design requirement (Sean, playtest 2026-07-26, Des's notes: "Lava should
// melt consecutive metal as well"): fire already chain-ignites a run of
// consecutive flammable tiles (each newly-burning tile keeps radiating heat
// while it burns), but melting was instantaneous with no equivalent
// "still hot" phase — only the ONE tile directly touching lava ever melted.
// Run `npm test` before touching meltedHot / the spread-tick igniters loop
// in room.ts.
import { describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/game/room";
import type { Content, RoomDef, TileDef, RuleDef } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import tilesJson from "../content/tiles.json";
import rulesJson from "../content/rules.json";
import gameJson from "../content/game.json";
import behaviorsJson from "../content/behaviors.json";

const TILES = tilesJson as TileDef[];

function makeContent(): Content {
  return {
    game: gameJson as Content["game"],
    elements: [], behaviors: behaviorsJson as never, rules: rulesJson as RuleDef[], achievements: [],
    tiles: TILES, items: [], recipes: [], enemies: [], taunts: [],
    campaign: { rooms: [] }, rooms: {},
  } as unknown as Content;
}
function makeMuts(): RoomMutations {
  return {
    collected: new Set(), tileOverrides: [], openedDoors: new Set(),
    gateTouched: new Set(), helpedNpcs: new Set(), disabledEnemies: new Set(),
    drops: [], placedItems: [], brazierLit: [],
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

describe("lava chain-melts a consecutive run of metal, not just the contact tile", () => {
  it("melts the whole run of metal tiles over enough spread ticks", () => {
    // Lava at x0, four metal tiles in a row at x1-4.
    const rt = makeRoom(["LMMMM."]);
    for (let i = 0; i < 8; i++) rt.update(0.7, null, 0, () => {});
    // Every metal tile melted away (meltsTo "" removes the tile).
    for (let x = 1; x <= 4; x++) {
      expect(charAt(rt, x, 0), `tile at x=${x} should have melted`).toBe(".");
    }
  });

  it("melts outward one tile per spread tick, not instantly", () => {
    const rt = makeRoom(["LMMMM."]);
    rt.update(0.7, null, 0, () => {}); // one tick: only the contact tile
    expect(charAt(rt, 1, 0)).toBe("."); // melted (touches lava directly)
    expect(charAt(rt, 2, 0)).toBe("M"); // not yet — one tick isn't enough
  });
});
