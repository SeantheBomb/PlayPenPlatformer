// Player physics design requirements, asserted headlessly against a bare
// TileMap. Run `npm test` before shipping any change to waterStateAt.
import { describe, expect, it } from "vitest";
import { Player, type GooLookup } from "../src/game/player";
import { TileMap } from "../src/engine/tilemap";
import type { TileDef, RoomDef } from "../src/data/types";
import type { Input } from "../src/engine/input";
import type { RunState } from "../src/game/state";
import tilesJson from "../content/tiles.json";
import gameJson from "../content/game.json";

const TILES = tilesJson as TileDef[];
const NO_INPUT = { right: false, left: false, jumpPressed: false, jumpDown: false, downHeld: false } as Input;
const NO_GOO: GooLookup = () => false;

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
    player.update(0.1, NO_INPUT, map, {} as RunState, NO_GOO);
    expect(player.swimState).toBe("under");
  });

  it("stays 'under' resting on top of the grate too", () => {
    const map = makeMap(rows);
    const player = new Player(gameJson.player as never);
    player.placeFeetAt(16 + 8, 16 * 2); // feet at the top of row 2, body in row 1's water/grate band
    player.update(0.1, NO_INPUT, map, {} as RunState, NO_GOO);
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
    player.update(0.1, NO_INPUT, map, {} as RunState, NO_GOO);
    expect(player.swimState).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// REQUIREMENT (Sean, 2026-08-05): sticky-bomb goo climb — moving into a goo
// wall/ceiling engages a stamina climb (axis-locked to the surface, jump =
// up on a wall / left-right along a ceiling), moving away or the timer
// hitting zero dismounts. Durations are tunable via game.json player.climb.
// ---------------------------------------------------------------------------
describe("goo climb (sticky bomb)", () => {
  const wallRows = [
    "........",
    "#.......",
    "#.......",
    "#.......",
    "########",
  ];
  const wallGoo: GooLookup = (tx, _ty, face) => tx === 0 && face === "right";

  it("engages a wall climb on movement into a goo wall, and jump climbs up", () => {
    const map = makeMap(wallRows);
    const player = new Player(gameJson.player as never);
    player.x = 16; player.y = 32;
    const startY = player.y;
    player.update(0.1, { ...NO_INPUT, left: true, jumpDown: true }, map, {} as RunState, wallGoo);
    expect(player.climbState).toBe("wall");
    expect(player.climbFacing).toBe(-1);
    expect(player.y).toBeLessThan(startY); // jump = climb up
    expect(player.climbTimeLeft).toBeCloseTo(gameJson.player.climb.wallSeconds - 0.1, 5);
  });

  it("dismounts a wall climb on input moving away from the wall", () => {
    const map = makeMap(wallRows);
    const player = new Player(gameJson.player as never);
    player.x = 16; player.y = 32;
    player.update(0.1, { ...NO_INPUT, left: true }, map, {} as RunState, wallGoo);
    expect(player.climbState).toBe("wall");
    player.update(0.1, { ...NO_INPUT, right: true }, map, {} as RunState, wallGoo);
    expect(player.climbState).toBe("none");
  });

  it("falls off a wall climb once the timer runs out", () => {
    const map = makeMap(wallRows);
    const player = new Player(gameJson.player as never);
    player.x = 16; player.y = 32;
    const wallSeconds = gameJson.player.climb.wallSeconds;
    const dt = 0.1;
    let elapsed = 0;
    // Stop the instant it dismounts — holding "left" against the wall the
    // whole time would otherwise instantly re-engage a fresh climb next tick.
    while (elapsed < wallSeconds + dt && player.climbState === "wall") {
      player.update(dt, { ...NO_INPUT, left: true, jumpDown: true }, map, {} as RunState, wallGoo);
      elapsed += dt;
    }
    expect(player.climbState).toBe("none");
  });

  it("engages a ceiling climb on rising into a goo ceiling, and left/right slide along it", () => {
    const ceilingRows = [
      "########",
      "........",
      "........",
      "########",
    ];
    const ceilingGoo: GooLookup = (_tx, ty, face) => ty === 0 && face === "bottom";
    const map = makeMap(ceilingRows);
    const player = new Player(gameJson.player as never);
    player.x = 16; player.y = 16;
    player.vy = -50; // rising into the ceiling
    const startX = player.x;
    player.update(0.1, { ...NO_INPUT, right: true }, map, {} as RunState, ceilingGoo);
    expect(player.climbState).toBe("ceiling");
    expect(player.x).toBeGreaterThan(startX);
    expect(player.vy).toBe(0); // locked to the surface, no vertical drift
  });

  it("dismounts a ceiling climb on pressing down (away from the ceiling)", () => {
    const ceilingRows = [
      "########",
      "........",
      "........",
      "########",
    ];
    const ceilingGoo: GooLookup = (_tx, ty, face) => ty === 0 && face === "bottom";
    const map = makeMap(ceilingRows);
    const player = new Player(gameJson.player as never);
    player.x = 16; player.y = 16;
    player.vy = -50;
    player.update(0.1, NO_INPUT, map, {} as RunState, ceilingGoo);
    expect(player.climbState).toBe("ceiling");
    player.update(0.1, { ...NO_INPUT, downHeld: true }, map, {} as RunState, ceilingGoo);
    expect(player.climbState).toBe("none");
  });
});
