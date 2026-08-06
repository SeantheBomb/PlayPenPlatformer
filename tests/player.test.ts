// Player physics design requirements, asserted headlessly against a bare
// TileMap. Run `npm test` before shipping any change to waterStateAt.
import { describe, expect, it } from "vitest";
import { Player } from "../src/game/player";
import { TileMap } from "../src/engine/tilemap";
import type { TileDef, RoomDef } from "../src/data/types";
import type { Input } from "../src/engine/input";
import type { RunState } from "../src/game/state";
import tilesJson from "../content/tiles.json";
import gameJson from "../content/game.json";

const TILES = tilesJson as TileDef[];
const NO_INPUT = { right: false, left: false, jumpPressed: false, jumpDown: false, downHeld: false } as Input;

function makeMap(rows: string[]): TileMap {
  const room = {
    id: "test", name: "test", width: rows[0].length, height: rows.length,
    background: "#000", tiles: rows, entities: [],
  } as RoomDef;
  return new TileMap(room, TILES);
}

// ---------------------------------------------------------------------------
// REQUIREMENT (Sean, 2026-07-26): "When a metal grate is submerged, I
// shouldn't be able to get air from it" — touching or resting on a grate
// mid-pool must not read as "surfaced," since grates are transparent to
// fluid everywhere else in the sim.
// ---------------------------------------------------------------------------
describe("waterStateAt treats a submerged grate as transparent, not a surface", () => {
  // A 3-tall water column (rows 0-2) with a grate at row 1, wide enough to
  // stand on. Deep enough (3 tall) to engage swimming.
  const rows = [
    "wwwwwwww",
    "===wwwww",
    "wwwwwwww",
    "########",
  ];

  it("stays 'under' with the body directly overlapping the grate's own tile", () => {
    const map = makeMap(rows);
    const player = new Player(gameJson.player as never);
    // midY = floor((y + h*0.6)/16) must land on row 1 (the grate row).
    player.x = 16; player.y = 16 * 1 - player.h * 0.4;
    player.update(0.1, NO_INPUT, map, {} as RunState);
    expect(player.swimState).toBe("under");
  });

  it("stays 'under' resting on top of the grate too", () => {
    const map = makeMap(rows);
    const player = new Player(gameJson.player as never);
    player.placeFeetAt(16 + 8, 16 * 2); // feet at the top of row 2, body in row 1's water/grate band
    player.update(0.1, NO_INPUT, map, {} as RunState);
    expect(player.swimState).toBe("under");
  });

  it("a pure stack of grates with no real water anywhere is not swimmable", () => {
    const dryRows = [
      "========",
      "========",
      "========",
      "########",
    ];
    const map = makeMap(dryRows);
    const player = new Player(gameJson.player as never);
    player.x = 16; player.y = 16 * 1 - player.h * 0.4;
    player.update(0.1, NO_INPUT, map, {} as RunState);
    expect(player.swimState).toBe("none");
  });
});
