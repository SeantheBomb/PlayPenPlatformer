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

// ---------------------------------------------------------------------------
// REQUIREMENT (Sean, 2026-08-05): sticky-bomb goo climb — a "goo"-style tile
// works like a water tile for engagement: standing in one (adjacent to a
// wall/ceiling) engages a stamina climb (axis-locked to the surface, jump =
// up on a wall / left-right along a ceiling); moving away or the timer
// hitting zero dismounts. Durations are tunable via game.json player.climb.
// ---------------------------------------------------------------------------
describe("goo climb (sticky bomb)", () => {
  const wallRows = [
    "........",
    "#G......",
    "#G......",
    "#G......",
    "########",
  ];

  it("engages a wall climb on movement into a goo pocket against a wall, and jump climbs up", () => {
    const map = makeMap(wallRows);
    const player = new Player(gameJson.player as never);
    player.x = 16; player.y = 32;
    const startY = player.y;
    player.update(0.1, { ...NO_INPUT, left: true, jumpDown: true }, map, {} as RunState);
    expect(player.climbState).toBe("wall");
    expect(player.climbFacing).toBe(-1);
    expect(player.y).toBeLessThan(startY); // jump = climb up
    expect(player.climbTimeLeft).toBeCloseTo(gameJson.player.climb.wallSeconds - 0.1, 5);
  });

  it("dismounts a wall climb on input moving away from the wall", () => {
    const map = makeMap(wallRows);
    const player = new Player(gameJson.player as never);
    player.x = 16; player.y = 32;
    player.update(0.1, { ...NO_INPUT, left: true }, map, {} as RunState);
    expect(player.climbState).toBe("wall");
    player.update(0.1, { ...NO_INPUT, right: true }, map, {} as RunState);
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
      player.update(dt, { ...NO_INPUT, left: true, jumpDown: true }, map, {} as RunState);
      elapsed += dt;
    }
    expect(player.climbState).toBe("none");
  });

  it("does nothing next to a plain (non-goo) wall", () => {
    const plainRows = [
      "........",
      "#.......",
      "#.......",
      "#.......",
      "########",
    ];
    const map = makeMap(plainRows);
    const player = new Player(gameJson.player as never);
    player.x = 16; player.y = 32;
    player.update(0.1, { ...NO_INPUT, left: true }, map, {} as RunState);
    expect(player.climbState).toBe("none");
  });

  it("engages a ceiling climb on rising into a goo pocket against a ceiling, and left/right slide along it", () => {
    const ceilingRows = [
      "########",
      ".G......",
      "........",
      "########",
    ];
    const map = makeMap(ceilingRows);
    const player = new Player(gameJson.player as never);
    player.x = 16; player.y = 16;
    player.vy = -50; // rising into the ceiling
    const startX = player.x;
    player.update(0.1, { ...NO_INPUT, right: true }, map, {} as RunState);
    expect(player.climbState).toBe("ceiling");
    expect(player.x).toBeGreaterThan(startX);
    expect(player.vy).toBe(0); // locked to the surface, no vertical drift
  });

  it("dismounts a ceiling climb on pressing down (away from the ceiling)", () => {
    const ceilingRows = [
      "########",
      ".G......",
      "........",
      "########",
    ];
    const map = makeMap(ceilingRows);
    const player = new Player(gameJson.player as never);
    player.x = 16; player.y = 16;
    player.vy = -50;
    player.update(0.1, NO_INPUT, map, {} as RunState);
    expect(player.climbState).toBe("ceiling");
    player.update(0.1, { ...NO_INPUT, downHeld: true }, map, {} as RunState);
    expect(player.climbState).toBe("none");
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT (Sean, 2026-08-05): "I want to be able to mount onto metal
  // grates or surface tops if the goo lets me climb all the way up to them.
  // Right now I seem to just get stuck at the end of the goo and jitter
  // wildly." Also: "I look weirdly squished" while climbing.
  // -------------------------------------------------------------------------
  it("mounts onto a grate at the top of a climbable wall instead of hovering/jittering", () => {
    const rows = [
      "#........", // row0: open headroom above the grate
      "#=.......", // row1: grate cap
      "#G.......", // row2: goo
      "#G.......", // row3: goo
      "#G.......", // row4: goo
      "##########", // row5: floor
    ];
    const map = makeMap(rows);
    const player = new Player(gameJson.player as never);
    player.x = 18; player.y = 4 * 16;
    const dt = 1 / 60;
    for (let i = 0; i < 240 && player.y > 0; i++) {
      player.update(dt, { ...NO_INPUT, left: true, jumpDown: true }, map, {} as RunState);
      if (player.climbState === "none" && i > 5) break; // dismounted (mounted or fell)
    }
    expect(player.climbState).toBe("none");
    expect(player.onGround).toBe(true);
    // Mounted ON TOP of the grate (row1), not fallen back to the floor.
    expect(player.y).toBeLessThan(4 * 16);
  });

  it("does not endlessly re-engage against a dead-end (solid-capped) climbable wall", () => {
    const rows = [
      "##........", // row0: solid cap, no headroom to mount
      "#G........", // row1: goo
      "#G........", // row2: goo
      "#G........", // row3: goo
      "##########", // row4: floor
    ];
    const map = makeMap(rows);
    const player = new Player(gameJson.player as never);
    player.x = 18; player.y = 3 * 16;
    const dt = 1 / 60;
    let reengageCount = 0;
    let prevState: string = player.climbState;
    for (let i = 0; i < 600; i++) {
      player.update(dt, { ...NO_INPUT, left: true, jumpDown: true }, map, {} as RunState);
      if (prevState === "none" && player.climbState === "wall") reengageCount++;
      prevState = player.climbState;
    }
    // Exactly one engage — timing out must not silently reset and re-grab
    // forever while input stays held.
    expect(reengageCount).toBe(1);
    expect(player.climbState).toBe("none");
  });

  it("keeps easing squash back to normal while climbing (doesn't freeze mid-squash)", () => {
    const rows = [
      "........",
      "#G......",
      "#G......",
      "#G......",
      "########",
    ];
    const map = makeMap(rows);
    const player = new Player(gameJson.player as never);
    player.x = 18; player.y = 2 * 16;
    player.squashY = 1.32; // as if a jump squash was mid-animation
    player.update(0.1, { ...NO_INPUT, left: true }, map, {} as RunState);
    expect(player.climbState).toBe("wall");
    expect(player.squashY).toBeLessThan(1.32); // eased toward 1, not frozen
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT (Sean, 2026-08-05): "climbing seems to mount the metal
  // grates well, but not the stone blocks." A solid tile (unlike a one-way
  // platform) blocks upward movement entirely, so the player is pinned one
  // row short of it and can only ever dismount via TIMEOUT (never via
  // "ran out of goo") — tryMountLedge must fire on that path too, and must
  // check both "the row I'm in" (platform case) and "the row just above me"
  // (solid case), since collision never lets the player actually enter it.
  // -------------------------------------------------------------------------
  it("mounts onto a solid stone ledge at the top of a climbable wall, same as a grate", () => {
    const rows = [
      "#........", // row0: open headroom above the stone cap
      "##.......", // row1: solid stone cap (single tile thick)
      "#G.......", // row2: goo
      "#G.......", // row3: goo
      "#G.......", // row4: goo
      "##########", // row5: floor
    ];
    const map = makeMap(rows);
    const player = new Player(gameJson.player as never);
    player.x = 18; player.y = 4 * 16;
    const dt = 1 / 60;
    const wallSeconds = gameJson.player.climb.wallSeconds;
    // Solid stone pins the player inside the goo the whole time (never
    // "runs out of goo"), so this only resolves once the stamina timer
    // actually expires — hold well past that.
    for (let i = 0; i < Math.ceil((wallSeconds + 1) / dt); i++) {
      player.update(dt, { ...NO_INPUT, left: true, jumpDown: true }, map, {} as RunState);
    }
    expect(player.climbState).toBe("none");
    expect(player.onGround).toBe(true);
    // Mounted ON TOP of the stone cap (row1), not fallen back to the floor.
    expect(player.y).toBeLessThan(4 * 16);
  });
});

// ---------------------------------------------------------------------------
// REQUIREMENT (Sean, 2026-08-06): a gutter tile "allows fluid to pass
// through it but not a player or other character" — it must block the
// player exactly like a normal solid wall (fluid-transparency is a
// RoomRuntime fluid-sim concern only, see tests/fluids.test.ts).
// ---------------------------------------------------------------------------
describe("gutter blocks the player like a solid wall", () => {
  it("a gutter tile stops horizontal movement into it", () => {
    const rows = [
      "..g.",
      "####",
    ];
    const map = makeMap(rows);
    const player = new Player(gameJson.player as never);
    player.x = 0; player.y = 0;
    for (let i = 0; i < 30; i++) player.update(1 / 60, { ...NO_INPUT, right: true }, map, {} as RunState);
    // Gutter tile sits at x=2*16=32; the player (width 12) must never cross into it.
    expect(player.x + player.w).toBeLessThanOrEqual(32 + 0.01);
  });
});
