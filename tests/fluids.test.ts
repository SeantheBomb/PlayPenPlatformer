// Fluid-sim design requirements, asserted headlessly against RoomRuntime.
// These encode Sean's explicit rules — run `npm test` before shipping any
// change to tickWaterFlow / tickFalls / realTileBelow / placeFluid.
import { describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/game/room";
import type { Content, RoomDef, RoomEntity, TileDef } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import tilesJson from "../content/tiles.json";
import gameJson from "../content/game.json";

const TILES = tilesJson as TileDef[];

function makeContent(): Content {
  return {
    game: gameJson as Content["game"],
    elements: [],
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
    helpedNpcs: new Set(),
    disabledEnemies: new Set(),
    bundles: [],
    placedItems: [],
    brazierLit: [],
  };
}

/** Build a runtime from a char-map (rows of equal length) + entities. */
function makeRoom(rows: string[], entities: RoomEntity[] = []): RoomRuntime {
  const room: RoomDef = {
    id: "test",
    name: "test",
    width: rows[0].length,
    height: rows.length,
    background: "#000",
    tiles: rows,
    entities,
  } as RoomDef;
  return new RoomRuntime(room, makeContent(), makeMuts());
}

/** Advance the fluid sim by N flow ticks (falls + drains + flow). */
function tick(rt: RoomRuntime, n = 1): void {
  for (let i = 0; i < n; i++) (rt as never as { tickWaterFlow(ev: unknown[]): void }).tickWaterFlow([]);
}

const charAt = (rt: RoomRuntime, x: number, y: number) => rt.map.at(x, y)?.char ?? ".";
const rowStr = (rt: RoomRuntime, y: number, x0: number, x1: number) => {
  let s = "";
  for (let x = x0; x <= x1; x++) s += charAt(rt, x, y);
  return s;
};
const grateFluidAt = (rt: RoomRuntime, x: number, y: number) =>
  (rt as never as { grateFluid: Map<number, TileDef> }).grateFluid.get(rt.map.index(x, y)) ?? null;
/** Is fluid of this element logically present at (x,y) — tile or grate overlay? */
const fluidAt = (rt: RoomRuntime, x: number, y: number, element: string) => {
  const overlay = grateFluidAt(rt, x, y);
  if (overlay) return overlay.element === element;
  const t = rt.map.at(x, y);
  return !!t && t.element === element && (!!t.fluid || t.style === "water");
};

// ---------------------------------------------------------------------------
// REQUIREMENT (Sean, 2026-07-24): "The lava should be able to hit the ground
// and keep flowing. It should fill all the way to the left until it reaches
// the door."
// ---------------------------------------------------------------------------
describe("lavafall floods plain floor to a closed door", () => {
  // 24 wide: wall borders, lavafall high at x=18, plain floor at y=8,
  // closed gated door standing on the floor at x=4 (2 tiles tall: y=6..7).
  const rows = [
    "#..................J....", // y0  fall source at x19
    "#......................#", // y1
    "#......................#", // y2
    "#......................#", // y3
    "#......................#", // y4
    "#......................#", // y5
    "#......................#", // y6
    "#......................#", // y7
    "########################", // y8  floor
  ];
  const door: RoomEntity = { type: "door", x: 4, y: 7, gate: true } as RoomEntity;

  it("fills every open floor cell between the door and the right wall", () => {
    const rt = makeRoom(rows, [door]);
    tick(rt, 60); // fall grows ~7 ticks, then floods ~18 wide
    // Right of the door (x5..x18 at y7, skipping the fall column x19 itself):
    for (let x = 5; x <= 18; x++) {
      expect(fluidAt(rt, x, 7, "lava"), `lava expected at (${x},7)`).toBe(true);
    }
  });

  it("stops exactly at the closed door and never passes it", () => {
    const rt = makeRoom(rows, [door]);
    tick(rt, 60);
    for (let x = 1; x <= 4; x++) {
      expect(fluidAt(rt, x, 7, "lava"), `no lava expected at (${x},7) behind/at the door`).toBe(false);
    }
  });

  it("flows past the door once it opens", () => {
    const rt = makeRoom(rows, [door]);
    tick(rt, 60);
    const inst = rt.entities.find((e) => e.kind === "door")!;
    inst.open = true;
    tick(rt, 20);
    for (let x = 1; x <= 3; x++) {
      expect(fluidAt(rt, x, 7, "lava"), `lava expected past the open door at (${x},7)`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// REQUIREMENT (Sean, 2026-07-24): "The suspended metal grates should let the
// lava pass through cleanly without being impacted by the lava."
// ---------------------------------------------------------------------------
describe("suspended grates are never impacted by a passing fall", () => {
  // A platform walkway at y4 with open air above and below; the fall crosses
  // it at x6 on its way to the floor at y9.
  const rows = [
    "#.....J....#", // y0 fall at x6
    "#..........#",
    "#..........#",
    "#..........#",
    "#.=======..#", // y4 suspended grate row x2..x8
    "#..........#",
    "#..........#",
    "#..........#",
    "#..........#",
    "############", // y9 floor
  ];

  it("every grate tile remains a platform tile in the map", () => {
    const rt = makeRoom(rows);
    tick(rt, 40);
    for (let x = 2; x <= 8; x++) {
      expect(charAt(rt, x, 4), `grate expected intact at (${x},4)`).toBe("=");
    }
  });

  it("no grate on the walkway carries fluid (open air below = pass through)", () => {
    const rt = makeRoom(rows);
    tick(rt, 40);
    for (let x = 2; x <= 8; x++) {
      expect(grateFluidAt(rt, x, 4), `no overlay expected at (${x},4)`).toBeNull();
    }
  });

  it("the fall reaches the floor and pools beneath the walkway", () => {
    const rt = makeRoom(rows);
    tick(rt, 40);
    // Fall column continues below the grate...
    expect(charAt(rt, 6, 5)).toBe("J");
    // ...and a pool forms on the floor row despite the grate above.
    expect(fluidAt(rt, 5, 8, "lava")).toBe(true);
    expect(fluidAt(rt, 7, 8, "lava")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Flush-mounted grate (no gap): fluid rides THROUGH the walkway as an
// overlay — the grates stay real, walkable tiles.
// ---------------------------------------------------------------------------
describe("flush grates over solid ground carry fluid as an overlay", () => {
  const rows = [
    "#.....J....#", // y0 fall at x6
    "#..........#",
    "#..........#",
    "#==========#", // y3 grate walkway flush against...
    "############", // y4 ...the floor
  ];

  it("floods the walkway end to end while every tile stays a grate", () => {
    const rt = makeRoom(rows);
    tick(rt, 40);
    for (let x = 1; x <= 10; x++) {
      expect(charAt(rt, x, 3), `tile at (${x},3) must remain a grate`).toBe("=");
      if (x !== 6) {
        expect(fluidAt(rt, x, 3, "lava"), `lava overlay expected at (${x},3)`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Sean's screenshot scenario, reproduced faithfully: the fall crosses a
// SUSPENDED walkway partway down, lands on plain floor, and the pool must
// still travel the whole floor — under the walkway — to a closed door.
// ---------------------------------------------------------------------------
describe("screenshot scenario: fall through walkway, long floor to a door", () => {
  const rows = [
    "#.................J....#", // y0 fall at x18
    "#......................#",
    "#......................#",
    "#...====....=======....#", // y3 suspended walkway pieces (fall crosses x13..19 span? no: x12..18)
    "#......................#",
    "#......................#",
    "#......................#",
    "#......................#", // y7 door stands here (x3, 2 tall y6..7)
    "########################", // y8 floor
  ];
  const door: RoomEntity = { type: "door", x: 3, y: 7, gate: true } as RoomEntity;

  it("walkway tiles all survive; none carry fluid; floor floods to the door", () => {
    const rt = makeRoom(rows, [door]);
    tick(rt, 80);
    // Suspended walkway pieces intact and dry (open air beneath them):
    for (const x of [4, 5, 6, 7, 12, 13, 14, 15, 16, 17]) {
      expect(charAt(rt, x, 3), `walkway tile intact at (${x},3)`).toBe("=");
      expect(grateFluidAt(rt, x, 3), `walkway tile dry at (${x},3)`).toBeNull();
    }
    // The fall's crossing cell: also a grate, also intact, NOT replaced.
    expect(charAt(rt, 18, 3)).toBe("=");
    // Floor flooded from beside the fall column all the way to the door:
    for (let x = 4; x <= 17; x++) {
      expect(fluidAt(rt, x, 7, "lava"), `lava expected at (${x},7)`).toBe(true);
    }
    // Nothing at or behind the closed door:
    for (let x = 1; x <= 3; x++) {
      expect(fluidAt(rt, x, 7, "lava"), `no lava at/behind door (${x},7)`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Second field report (2026-07-24): "the lava still doesn't flow to the left
// like it used to" after the grate-overlay fix. Reproduces a small ledge the
// fall lands on, with a drop-off down to a much longer floor + door further
// left and lower — the lava must cascade down the drop and keep going.
// ---------------------------------------------------------------------------
describe("lava cascades down a drop-off onto a lower, longer floor to a door", () => {
  const rows = [
    "#..........J..........#", // y0 fall at x11
    "#......................#",
    "#......................#",
    "#......................#",
    "#.........####.........#", // y4 small landing ledge under the fall (x9..12)
    "#......................#", // y5 open drop to the left of the ledge
    "#......................#",
    "#......................#",
    "########################", // y8 the real, long floor
  ];
  const door: RoomEntity = { type: "door", x: 2, y: 7, gate: true } as RoomEntity;

  it("does not get stuck on the small ledge", () => {
    const rt = makeRoom(rows, [door]);
    tick(rt, 80);
    // Ledge should not be buried under a permanently-growing cluster only —
    // fluid must have moved on past x8 (off the left edge of the ledge).
    let onLowerFloor = false;
    for (let x = 3; x <= 8; x++) if (fluidAt(rt, x, 7, "lava")) onLowerFloor = true;
    expect(onLowerFloor, "lava expected to have cascaded down onto the lower floor").toBe(true);
  });

  it("reaches the door on the lower floor", () => {
    const rt = makeRoom(rows, [door]);
    tick(rt, 120);
    for (let x = 3; x <= 8; x++) {
      expect(fluidAt(rt, x, 7, "lava"), `lava expected on lower floor at (${x},7)`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Locked regressions from earlier rounds.
// ---------------------------------------------------------------------------
describe("locked fluid behaviors", () => {
  it("a drain directly beneath a fall absorbs it entirely (nothing pools)", () => {
    const rows = [
      "#....V....#",
      "#.........#",
      "#.........#",
      "#....D....#", // drain right under the fall's landing point
      "###########",
    ];
    const rt = makeRoom(rows);
    tick(rt, 30);
    for (let x = 1; x <= 9; x++) {
      for (let y = 0; y <= 3; y++) {
        expect(fluidAt(rt, x, y, "water"), `no pooled water expected at (${x},${y})`).toBe(false);
      }
    }
  });

  it("a fall stops at its own pool's surface instead of spilling over the top", () => {
    // Narrow basin: fall at x3, walls at x1/x5, floor y6 — pool rises to
    // meet the fall, then everything must hold steady.
    const rows = [
      "#.#V#.#",
      "#.#.#.#",
      "#.#.#.#",
      "#.#.#.#",
      "#.#.#.#",
      "#.#.#.#",
      "#######",
    ];
    const rt = makeRoom(rows);
    tick(rt, 40);
    // The columns OUTSIDE the basin walls must stay bone dry.
    for (let y = 0; y <= 5; y++) {
      expect(fluidAt(rt, 1, y, "water"), `outside column dry at (1,${y})`).toBe(false);
      expect(fluidAt(rt, 5, y, "water"), `outside column dry at (5,${y})`).toBe(false);
    }
  });

  it("finite (melted) fluid is conserved — it never multiplies", () => {
    const rows = [
      "#.........#",
      "#....L....#", // one lone lava tile in mid-air
      "#.........#",
      "#.........#",
      "###########",
    ];
    const rt = makeRoom(rows);
    tick(rt, 30);
    let count = 0;
    for (let y = 0; y <= 3; y++) {
      for (let x = 1; x <= 9; x++) if (fluidAt(rt, x, y, "lava")) count++;
    }
    expect(count).toBe(1);
  });

  it("moving water into stationary lava destroys the water; the lava hardens", () => {
    const rows = [
      "#..w......#", // water at x3 will fall
      "#.........#",
      "#..L......#", // stationary lava on the floor below it
      "###########",
    ];
    const rt = makeRoom(rows);
    tick(rt, 10);
    // Both fluids gone; cracked stone left only at the stationary (lava) side.
    expect(charAt(rt, 3, 2)).toBe("C");
    let waterLeft = 0;
    for (let y = 0; y <= 2; y++) {
      for (let x = 1; x <= 9; x++) if (fluidAt(rt, x, y, "water")) waterLeft++;
    }
    expect(waterLeft).toBe(0);
  });

  it("a closed trapdoor blocks a fall; opening it lets the fall through", () => {
    const rows = [
      "#....V....#",
      "#.........#",
      "#.........#", // y2: trapdoor entity here at x5
      "#.........#",
      "###########",
    ];
    const trap: RoomEntity = { type: "trapdoor", x: 5, y: 2, gate: true } as RoomEntity;
    const rt = makeRoom(rows, [trap]);
    tick(rt, 20);
    expect(charAt(rt, 5, 2)).toBe(".");
    expect(charAt(rt, 5, 3)).toBe(".");
    const inst = rt.entities.find((e) => e.kind === "trapdoor")!;
    inst.open = true;
    tick(rt, 10);
    expect(charAt(rt, 5, 3)).toBe("V");
  });
});

// ---------------------------------------------------------------------------
// REQUIREMENT (Sean, 2026-07-24): "I'm just confused why the lavafall
// continues to pour, the lava had more space on the left to expand, yet it
// didn't." Root cause: an author-placed pool sitting next to a fall (the
// editor's way of pre-filling a fall's landing spot) loaded as FINITE fluid
// (distance 0), not SOURCED — so once a sealed floor beneath it was broken
// (hammer + brittle rule) and it cascaded down onto open floor, it obeyed
// "finite fluid is conserved" and just sat in a small puddle instead of
// spreading, even though open floor was available on both sides.
// ---------------------------------------------------------------------------
describe("an authored pool touching a fall is SOURCED, not finite", () => {
  // Fall at x8; an authored 3-wide lava pool sits right under it (y1, x8-10),
  // boxed in by walls at x7/x11 so it can't spread sideways, with a solid
  // ceiling directly beneath it (y2, x8-10) standing in for cracked stone a
  // hammer would shatter. Below that: an open shaft (y3), then a floor (y4)
  // wide enough to show the pool actually spreading once freed, with a
  // closed door at the far left (x1) it must stop at.
  const rows = [
    "#.......J......#", // y0 fall source at x8
    "#......#LLL#...#", // y1 authored pool (x8-10), boxed in, under the fall
    "#......#####...#", // y2 sealed ceiling over the pool (x8-10 is the break)
    "#..............#", // y3 open shaft once the ceiling is broken
    "#..............#", // y4 landing floor; door at x1
    "################", // y5 floor
  ];
  const door: RoomEntity = { type: "door", x: 1, y: 4, gate: true } as RoomEntity;

  it("stays put while sealed, then floods the whole floor once freed", () => {
    const rt = makeRoom(rows, [door]);
    tick(rt, 20);
    // Sealed: the authored pool hasn't moved, nothing below it yet.
    expect(fluidAt(rt, 8, 1, "lava")).toBe(true);
    expect(fluidAt(rt, 8, 4, "lava")).toBe(false);

    // Hammer shatters the ceiling (x8-10, y2).
    for (let x = 8; x <= 10; x++) {
      (rt as never as { setTileById(x: number, y: number, id?: string): void }).setTileById(x, 2, undefined);
    }
    tick(rt, 40);

    // Floods the whole open floor, not just the 3 tiles under the old pool.
    for (let x = 2; x <= 14; x++) {
      expect(fluidAt(rt, x, 4, "lava"), `lava expected at (${x},4)`).toBe(true);
    }
    // Stops at the closed door — never passes it.
    expect(fluidAt(rt, 1, 4, "lava")).toBe(false);
  });
});
