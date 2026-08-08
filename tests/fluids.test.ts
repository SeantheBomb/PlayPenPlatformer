// Fluid-sim design requirements, asserted headlessly against RoomRuntime.
// These encode Sean's explicit rules — run `npm test` before shipping any
// change to tickWaterFlow / tickFalls / realTileBelow / placeFluid.
import { describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/game/room";
import type { Content, RoomDef, RoomEntity, TileDef } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import tilesJson from "../content/tiles.json";
import gameJson from "../content/game.json";
import behaviorsJson from "../content/behaviors.json";
import rulesJson from "../content/rules.json";
import { setSimTime } from "../src/engine/simclock";

const TILES = tilesJson as TileDef[];

function makeContent(): Content {
  return {
    game: gameJson as Content["game"],
    elements: [], behaviors: behaviorsJson as never,
    rules: rulesJson,
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
// Gutter (fluidPasses): unlike a grate, never a resting spot for fluid at
// all — fluid falls straight through a suspended one, and even flush
// against solid ground it never carries an overlay (fluid pools in the
// open tiles beside it instead). The tile itself must never be destroyed
// or overwritten by fluid passing through — see realTileBelow's skip.
// ---------------------------------------------------------------------------
describe("gutter lets fluid pass straight through without ever pooling on it", () => {
  it("a fall crosses a suspended gutter and lands on the real floor below", () => {
    const rows = [
      "#..J..#", // y0 fall at x3
      "#..g..#", // y1 suspended gutter, gap below
      "#......", // y2 open — no right wall needed for this check
      "########", // y3 floor
    ];
    const rt = makeRoom(rows);
    tick(rt, 40);
    expect(charAt(rt, 3, 1)).toBe("g"); // gutter untouched
    expect(fluidAt(rt, 2, 2, "lava")).toBe(true); // pool lands past it, beside the fall column
  });

  it("flush against solid ground, the gutter tile survives and carries no overlay", () => {
    const rows = [
      "#..J..#",
      "#..g..#",
      "#######",
    ];
    const rt = makeRoom(rows);
    tick(rt, 40);
    expect(charAt(rt, 3, 1)).toBe("g");
    expect(grateFluidAt(rt, 3, 1)).toBeNull(); // never rides as an overlay, unlike a grate
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
      "#...#.#...#", // y1: contained — nothing to bypass the door through
      "#...#.#...#", // y2: trapdoor entity here at x5
      "#...#.#...#",
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

  // -------------------------------------------------------------------------
  // REGRESSION (Sean, live playtest 2026-08-06, the_vault): "the trapdoor
  // was very much not stopping the water even after I closed it" / "even
  // when the trapdoor starts closed, it looks like it doesn't cause the
  // water to pool" / "when the trapdoor starts open and then gets closed,
  // it's not cutting off the downstream waterfall". Root cause: a closed
  // gate makes realTileBelow report `{ def: null, solid: true }` — the same
  // shape tickFalls uses for "genuinely nothing here yet, keep waiting" — so
  // a shut door could stop a fall from GROWING but could never trigger the
  // pool-forming logic (that only ever ran for a real solid tile def). The
  // dammed water just hung in limbo forever instead of pooling. Fixed by
  // routing a closed-gate block through the same poolFallBase() the "landed
  // on solid ground" case uses.
  // -------------------------------------------------------------------------
  it("a closed trapdoor pools the fall above it instead of leaving it in limbo", () => {
    const rows = [
      "#....V....#",
      "#.....#...#", // y1: open at x4 (room to pool into), walled at x6
      "#...#.#...#", // y2: trapdoor at x5, walled both sides below pool level
      "#...#.#...#",
      "###########",
    ];
    const trap: RoomEntity = { type: "trapdoor", x: 5, y: 2, gate: true } as RoomEntity;
    const rt = makeRoom(rows, [trap]);
    tick(rt, 20);
    // Nothing gets past the closed door — no bypassing around it either.
    expect(fluidAt(rt, 5, 2, "water")).toBe(false);
    expect(fluidAt(rt, 5, 3, "water")).toBe(false);
    expect(fluidAt(rt, 4, 2, "water")).toBe(false);
    // But it actually POOLS at the row it's dammed against, instead of the
    // fall just sitting there as a single stuck tile forever.
    expect(fluidAt(rt, 4, 1, "water")).toBe(true);
  });

  it("closing a trapdoor mid-flow cuts off the fall and starts a pool, instead of leaving the established flow running", () => {
    const rows = [
      "#....V....#",
      "#.....#...#",
      "#...#.#...#",
      "#...#.#...#",
      "###########",
    ];
    const trap: RoomEntity = { type: "trapdoor", x: 5, y: 2, gate: true } as RoomEntity;
    const rt = makeRoom(rows, [trap]);
    const inst = rt.entities.find((e) => e.kind === "trapdoor")!;
    inst.open = true; // starts open: let the fall establish all the way down
    tick(rt, 20);
    expect(charAt(rt, 5, 3)).toBe("V"); // confirms it actually flowed through
    inst.open = false; // now close it mid-flow
    tick(rt, 20);
    // New pooling above the now-closed door, and it actually gets cut off —
    // not "still running because it already established a path through".
    expect(fluidAt(rt, 4, 1, "water")).toBe(true);
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

// ---------------------------------------------------------------------------
// REQUIREMENT (Sean, 2026-07-27): a drain should fully empty a whole
// connected body of water, not just the one tile touching it. A flat,
// hand-authored (non-fall-fed) lake sitting on solid ground previously
// stalled after losing exactly one tile, because finite fluid only slid
// sideways into a hole it could keep falling into — a flat lake has no such
// hole. Sean's rule: "if a water block moves, it should grab at least one
// neighbor water block and move it to take its place, which should cause a
// chain effect." Implemented as RoomRuntime.vacate.
// ---------------------------------------------------------------------------
describe("a drain fully empties a flat, non-fall-fed lake via the grab-chain", () => {
  it("drains a whole flat pool down to nothing, not just the contact tile", () => {
    const rows = [
      "######################",
      "#....................#",
      "#wwwwwwwwwwwwwwwwwwwD#",
      "######################",
    ];
    const rt = makeRoom(rows);
    tick(rt, 40);
    for (let x = 1; x <= 20; x++) {
      expect(fluidAt(rt, x, 2, "water"), `expected (${x},2) to have drained`).toBe(false);
    }
  });

  it("drains one tile at a time (a visible trickle, not an instant vanish)", () => {
    const rows = [
      "######################",
      "#....................#",
      "#wwwwwwwwwwwwwwwwwwwD#",
      "######################",
    ];
    const rt = makeRoom(rows);
    const countWater = () => {
      let n = 0;
      for (let x = 1; x <= 20; x++) if (fluidAt(rt, x, 2, "water")) n++;
      return n;
    };
    const before = countWater();
    tick(rt, 1);
    const after = countWater();
    expect(before - after).toBe(1);
  });

  // -------------------------------------------------------------------------
  // REGRESSION (Sean, 2026-07-27): the boiler room's actual layout — a tank,
  // an open trapdoor breaking into a wide room below, one narrow drain in
  // that room's floor. The first grab-chain (which tried vertical neighbors
  // too) filled this room partway and then plateaued forever: the tile
  // touching the drain and the tile directly above it just swapped back and
  // forth every tick, net zero progress, because case 3 ("column pressure
  // squeeze") already defers "the column above falls next tick" by design —
  // grabbing vertically raced that and undid it every single tick. Fixed by
  // making the grab horizontal-only (falling stays case 1's job, unconditional
  // every tick, no grab needed).
  // -------------------------------------------------------------------------
  it("a tank feeding a wide room through an open trapdoor fully drains, not just partway", () => {
    const rows = [
      "#################",
      "#wwwwwwwwwwwwwww#", // tank
      "#################", // sealed ceiling (trapdoor breaks x=8)
      "#...............#", // wide room, 3 tall
      "#...............#",
      "#...............#",
      "#########D#######", // floor, one drain at x=9
      "#################",
    ];
    const trapdoor: RoomEntity = { type: "trapdoor", x: 8, y: 2, gate: true } as RoomEntity;
    const rt = makeRoom(rows, [trapdoor]);
    const inst = rt.entities.find((e) => e.kind === "trapdoor")!;
    inst.open = true;
    tick(rt, 40); // 20 simulated seconds
    for (let y = 3; y <= 5; y++) {
      for (let x = 1; x <= 15; x++) {
        expect(fluidAt(rt, x, y, "water"), `expected (${x},${y}) to have drained`).toBe(false);
      }
    }
  });

  // -------------------------------------------------------------------------
  // REGRESSION (Sean, 2026-07-27): "why is it only draining 3 blocks at a
  // time?" — a wide bank of drains under a tall tank should drain much
  // faster than the same width of a single-layer puddle, because there's a
  // whole tank of water above ready to fall in. It didn't: eating a
  // drain-touching tile immediately grab-chained sideways into the tile
  // next to it — which was ALSO about to be independently eaten by the same
  // drain pass — wasting the chain reshuffling water that was getting
  // erased either way, instead of leaving the row alone so the tank above
  // could fall the full width to replace it. Fixed by computing every
  // drain-touching tile first, then vacating them all with that whole set
  // excluded from each other's grab search.
  // -------------------------------------------------------------------------
  it("a full-width drain under a tall tank sustains a fast removal rate, not a throttled trickle", () => {
    const rows = [
      "##############",
      "#wwwwwwwwwwww#",
      "#wwwwwwwwwwww#",
      "#wwwwwwwwwwww#",
      "#wwwwwwwwwwww#",
      "#wwwwwwwwwwww#",
      "#wwwwwwwwwwww#",
      "#DDDDDDDDDDDD#",
      "##############",
    ];
    const rt = makeRoom(rows);
    const countAll = () => {
      let n = 0;
      for (let y = 1; y <= 6; y++) for (let x = 1; x <= 12; x++) if (fluidAt(rt, x, y, "water")) n++;
      return n;
    };
    const before = countAll();
    // The first tick alone doesn't discriminate well (both old and new code
    // clear most of the direct-contact row immediately); the throttling
    // showed up over the next few ticks, once the row above had to refill
    // the gap. Old: 11+4+5+3 = 23 removed by tick 4. New: 12+6+5+4 = 27.
    tick(rt, 4);
    const after = countAll();
    expect(before - after).toBeGreaterThanOrEqual(26);
  });

  // -------------------------------------------------------------------------
  // REGRESSION (Sean, 2026-07-27): "I just want it to drain evenly." A wide,
  // perfectly uniform tank (identical depth in every column, no fall, all
  // finite) still didn't drain evenly — the leftmost column consistently
  // emptied first and the rightmost consistently lagged ~40-60s behind in
  // real testing, purely from "which side to check first" always being
  // tried left-before-right (in the lateral-move neighbor checks AND in the
  // main loop's intra-row processing order) — a fixed tie-break compounds
  // into a strong one-directional sweep over hundreds of ticks. Fixed by
  // alternating both tie-breaks on flowSideFlip, which flips every tick.
  // Signature of the bug: at a fixed tick count, column depth increases
  // almost monotonically left-to-right (most adjacent pairs "increasing").
  // -------------------------------------------------------------------------
  it("a uniform wide tank does not drain as a one-directional left-to-right sweep", () => {
    const width = 14;
    const rows: string[] = [];
    rows.push("#".repeat(width));
    for (let i = 0; i < 20; i++) rows.push("#" + "w".repeat(12) + "#");
    rows.push("#" + ".".repeat(12) + "#"); // open shaft
    rows.push("#" + "D".repeat(12) + "#"); // full-width drain
    rows.push("#".repeat(width));
    const rt = makeRoom(rows);
    const colDepth = (x: number) => {
      let n = 0;
      for (let y = 1; y <= 20; y++) if (fluidAt(rt, x, y, "water")) n++;
      return n;
    };
    tick(rt, 40); // 20 simulated seconds
    const depths = Array.from({ length: 12 }, (_, i) => colDepth(1 + i));
    let increasing = 0;
    for (let i = 0; i < depths.length - 1; i++) {
      if (depths[i] < depths[i + 1]) increasing++;
    }
    // The old left-first bias produced a near-monotonic ramp (9 of 11
    // adjacent steps increasing in a real run); the fix breaks that pattern.
    expect(increasing, `column depths were ${depths.join(",")}`).toBeLessThanOrEqual(6);
  });

  // -------------------------------------------------------------------------
  // REGRESSION (Sean bug report, 2026-08-04, mess_hall): "Lava should lay
  // only one layer deep, it shouldn't be on top of the metal grate here."
  // Fluid arriving from above at a grate whose pool below is already full
  // came to rest one tile ABOVE a visibly dry grate: fluidOccupied saw
  // "fluid below, no hole" and returned solid without offering the grate
  // cell's own (dry) overlay as the resting spot.
  // -------------------------------------------------------------------------
  it("fluid landing on a full pool under a grate rests IN the grate overlay, not above it", () => {
    const rows = [
      "#...#", // y0
      "#.L.#", // y1  lava released from above
      "#...#", // y2
      "#.=.#", // y3  walkway grate
      "#LLL#", // y4  basin already full to the grate
      "#####", // y5
    ];
    const rt = makeRoom(rows);
    tick(rt, 6);
    expect(grateFluidAt(rt, 2, 3)?.element).toBe("lava"); // riding the grate
    expect(charAt(rt, 2, 3)).toBe("="); // grate itself untouched
    expect(charAt(rt, 2, 2)).toBe("."); // nothing stacked above the grate
    expect(charAt(rt, 2, 1)).toBe(".");
  });

  // -------------------------------------------------------------------------
  // REGRESSION (Sean bug report, 2026-08-04, greenhouse): "The water on the
  // ice oscillates back and forth instead of falling." A two-tile body atop
  // a one-wide pillar shuffled sideways forever: the pillar tile hopped to
  // the SAME ROW beside the hole, its vacate grab-chain dragged the neighbor
  // back onto the pillar, and next tick's processing order repeated the
  // shuffle before the overhang ever took its fall turn. The lateral move
  // now lands IN the hole (one diagonal step down), so motion is
  // monotonically downward and the cycle can't form.
  // -------------------------------------------------------------------------
  it("a two-tile body on a one-wide pillar drains off and settles instead of shuffling forever", () => {
    const rows = [
      "#.....#", // y0
      "#.ww..#", // y1  pair: (3,1) on the pillar, (2,1) overhanging
      "#..#..#", // y2  one-wide pillar at x3
      "#.....#", // y3  open basin floor row
      "#######", // y4
    ];
    const rt = makeRoom(rows);
    tick(rt, 20);
    // Fully quiescent: no flow events at all across several further ticks.
    for (let i = 0; i < 4; i++) {
      const ev: { effect?: string }[] = [];
      (rt as never as { tickWaterFlow(e: unknown[]): void }).tickWaterFlow(ev);
      expect(ev.filter((e) => e.effect === "flow").length).toBe(0);
    }
    // Both tiles conserved, resting on the floor row — none left aloft.
    let onFloor = 0, aloft = 0;
    for (let y = 0; y <= 3; y++) for (let x = 1; x <= 5; x++) {
      if (!fluidAt(rt, x, y, "water")) continue;
      if (y === 3) onFloor++; else aloft++;
    }
    expect(onFloor).toBe(2);
    expect(aloft).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION (Sean, 2026-08-04): player report — "the water on the ice
// oscillates back and forth instead of falling", greenhouse room, melting
// the ice pillar with a torch. The pillar is a solid, one-tile-wide column
// with an open channel on EACH side, each channel bottoming out onto its own
// floor drain (the room's real layout: drains flank the pillar's base).
// ---------------------------------------------------------------------------
describe("melted water beside a solid pillar flanked by two drains", () => {
  it("fully drains down both faces instead of getting stuck beside the pillar", () => {
    const rows = [
      "#####",
      "#wIw#", // melt result: water both sides of the pillar's top
      "#.I.#",
      "#.I.#",
      "#.I.#",
      "#.I.#",
      "#.I.#",
      "#.I.#",
      "#DID#", // drains flank the pillar's base
      "#####",
    ];
    const rt = makeRoom(rows);
    tick(rt, 60); // 30 simulated seconds — plenty of time to fall + drain
    for (let y = 1; y <= 7; y++) {
      expect(fluidAt(rt, 1, y, "water"), `expected (1,${y}) to have drained`).toBe(false);
      expect(fluidAt(rt, 3, y, "water"), `expected (3,${y}) to have drained`).toBe(false);
    }
  });

  it("makes visible downward progress every few ticks, not a stationary plateau", () => {
    const rows = [
      "#####",
      "#wIw#",
      "#.I.#",
      "#.I.#",
      "#.I.#",
      "#.I.#",
      "#.I.#",
      "#.I.#",
      "#DID#",
      "#####",
    ];
    const rt = makeRoom(rows);
    const stillAtTop = () => (fluidAt(rt, 1, 1, "water") ? 1 : 0) + (fluidAt(rt, 3, 1, "water") ? 1 : 0);
    expect(stillAtTop()).toBe(2);
    tick(rt, 10); // 5 simulated seconds — should be long gone from the melt spot
    expect(stillAtTop(), "water is still sitting at the melt origin after 5s").toBe(0);
  });

  // Faithful reproduction: melting 3 STACKED segments of the pillar itself
  // (matching the real torch swing, which melted (44,14)/(44,15)/(44,16) in
  // a vertical run) — open channels flank the pillar's FULL height on both
  // sides (matching the real room, not just below the melt point), and the
  // remaining pillar continues solid beneath the melt.
  it("a 3-tile vertical melt inside the pillar's own column still drains both ways", () => {
    const rows = [
      "#####",
      "#.w.#", // melted (top)
      "#.w.#", // melted
      "#.w.#", // melted (bottom of melt)
      "#.I.#", // pillar resumes, solid
      "#.I.#",
      "#.I.#",
      "#.I.#",
      "#DID#",
      "#####",
    ];
    const rt = makeRoom(rows);
    tick(rt, 60); // 30 simulated seconds
    for (let y = 1; y <= 7; y++) {
      expect(fluidAt(rt, 1, y, "water"), `expected (1,${y}) to have drained`).toBe(false);
      expect(fluidAt(rt, 2, y, "water"), `expected (2,${y}) to have drained`).toBe(false);
      expect(fluidAt(rt, 3, y, "water"), `expected (3,${y}) to have drained`).toBe(false);
    }
  });

  it("a 3-tile vertical melt makes progress within 5 simulated seconds", () => {
    const rows = [
      "#####",
      "#.w.#",
      "#.w.#",
      "#.w.#",
      "#.I.#",
      "#.I.#",
      "#.I.#",
      "#.I.#",
      "#DID#",
      "#####",
    ];
    const rt = makeRoom(rows);
    const countAll = () => {
      let n = 0;
      for (let y = 1; y <= 7; y++) for (let x = 1; x <= 3; x++) if (fluidAt(rt, x, y, "water")) n++;
      return n;
    };
    expect(countAll()).toBe(3);
    tick(rt, 10); // 5 simulated seconds
    const stillAtOrigin =
      (fluidAt(rt, 2, 1, "water") ? 1 : 0) + (fluidAt(rt, 2, 2, "water") ? 1 : 0) + (fluidAt(rt, 2, 3, "water") ? 1 : 0);
    expect(stillAtOrigin, "water is still sitting unmoved at the melt column after 5s").toBeLessThan(3);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION (Sean, live playtest, the_vault report + design directive
// 2026-08-06): "The water should put out the fire and keep expanding to the
// right" / "Flowing water should extinguish fire tiles (or anything
// burning), once the fire tile is extinguished it should pool into that
// tile." Root cause: water_extinguishes_fire (rules.json) only ever fired
// from an ACTIVE item swing (applyElementToTiles) — the passive flow tick
// had no equivalent, and fire/burning tiles were treated exactly like a
// solid wall (realTileBelow), so flowing water just dammed up against fire
// instead of putting it out and continuing through. Fixed by having
// realTileBelow extinguish fire on the water's behalf as it walks past —
// a bare fire tile (extinguishesTo: "") clears away entirely so the very
// same check reports the cell open, letting water pool straight into it
// the same tick; a merely-burning flammable tile just stops burning.
// ---------------------------------------------------------------------------
describe("flowing water extinguishes fire and pools into it", () => {
  it("a fall extinguishes a fire tile directly below it and pools into the now-open cell", () => {
    const rows = [
      "#####",
      "#.V.#",
      "#.f.#", // fire directly below the fall
      "#...#",
      "#####",
    ];
    const rt = makeRoom(rows);
    tick(rt, 10);
    expect(charAt(rt, 2, 2)).not.toBe("f"); // the fire is gone
    expect(fluidAt(rt, 2, 2, "water") || charAt(rt, 2, 2) === "V").toBe(true); // water/fall took its place
  });

  it("water spreading sideways extinguishes fire tiles in its path and keeps expanding past them", () => {
    const rows = [
      "#V.ffff...#", // fall at x1; fire at x3-6; open ledge past it
      "###########", // solid the whole way along — forces sideways spread, not a fall-through
    ];
    const rt = makeRoom(rows);
    tick(rt, 40); // plenty of time for the SOURCED frontier to reach x6
    for (let x = 3; x <= 6; x++) {
      expect(charAt(rt, x, 0), `expected fire at (${x},0) to be extinguished`).not.toBe("f");
      expect(fluidAt(rt, x, 0, "water"), `expected water to have pooled into (${x},0)`).toBe(true);
    }
  });

  it("water only stops a merely-burning flammable tile from burning — the tile itself stays exactly as solid as before", () => {
    const rows = [
      "#####",
      "#.V.#",
      "#.T.#", // toyblock: solid + flammable
      "#...#",
      "#####",
    ];
    const rt = makeRoom(rows);
    expect(rt.igniteTile(2, 2)).toBe(true);
    tick(rt, 10);
    // Water dammed against it (never got past — the tile itself is unchanged
    // and still solid), but the block itself is still there, still a toyblock.
    expect(charAt(rt, 2, 2)).toBe("T");
    expect(fluidAt(rt, 2, 2, "water")).toBe(false);
  });

  // REGRESSION (player report, 2026-08-07, exit_wing): "I thought the water
  // was supposed to wash away the goo" — same gap, different rule
  // (water_dissolves_goo). Proves the fix generalizes via findRule instead
  // of being fire-specific.
  it("a fall dissolves a goo tile directly below it and pools into the now-open cell", () => {
    const rows = [
      "#####",
      "#.V.#",
      "#.G.#", // goo directly below the fall
      "#...#",
      "#####",
    ];
    const rt = makeRoom(rows);
    tick(rt, 10);
    expect(charAt(rt, 2, 2)).not.toBe("G"); // the goo is washed away
    expect(fluidAt(rt, 2, 2, "water") || charAt(rt, 2, 2) === "V").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION (Sean, live playtest 2026-08-07, exit_wing): "The water is
// still falling through the trapdoor." The earlier fix (pooling above a
// closed gate) only covers a fall's ADVANCING EDGE — a segment querying its
// own "below". It never covers a segment that already grew straight through
// a cell before the gate closed there: that segment's own turn only ever
// checks its OWN below (one row further down), never "is a gate now closed
// on the cell I'm already sitting in". So a fall that had already reached
// the floor before the door shut left a permanent waterfall-styled tile
// (the fall's own self-perpetuating id, not "water") physically occupying
// the door's cell forever — visibly still falling through a shut door, with
// everything below it orphaned from the source but never cleaned up either.
// Fixed by having tickFalls check its OWN position for a closed gate, not
// just its below: clears that cell, and converts the now-orphaned chain
// below it (same id, contiguous) from the fall's identity into ordinary
// finite water, so it settles/drains instead of hanging there forever.
// ---------------------------------------------------------------------------
describe("a gate closing under an already-established fall clears it, not just new growth", () => {
  it("stops a fall that already reached the floor before the gate shut, and cleans up what's left behind", () => {
    const rows = [
      "############",
      ".........V#.",
      "..........#.",
      "............",
      "............",
      "############",
    ];
    const trap: RoomEntity = { type: "trapdoor", x: 9, y: 2, gate: true } as RoomEntity;
    const rt = makeRoom(rows, [trap]);
    const inst = rt.entities.find((e) => e.kind === "trapdoor")!;
    inst.open = true;
    tick(rt, 10); // let it fully establish, reaching the floor
    expect(charAt(rt, 9, 3)).toBe("V"); // confirms it actually flowed all the way down first
    inst.open = false;
    tick(rt, 30);
    // The door's own cell is genuinely empty — no fall tile physically
    // sitting on/through a closed door.
    expect(charAt(rt, 9, 2)).toBe(".");
    // Nothing below it is still the fall's self-perpetuating "V" identity
    // either — it settled into ordinary (drainable/poolable) water instead
    // of hanging there forever as a frozen, sourceless waterfall glyph.
    for (let y = 3; y <= 4; y++) {
      expect(charAt(rt, 9, y), `expected (9,${y}) to no longer be the fall's own tile`).not.toBe("V");
    }
  });

  // -------------------------------------------------------------------------
  // REGRESSION (Sean, live playtest 2026-08-07, follow-up): "The water
  // flowed to the left when the trapdoor was closed and couldn't flow
  // down. Now that the gate is open, the water that pushed left should dry
  // up since that water flow is theoretically flowing down through the
  // gate now." A closed gate backs a fall up sideways as a SOURCED pool
  // (matching real solid ground — it keeps topping up while blocked), but
  // unlike real ground that's a REVERSIBLE obstruction: once the gate
  // reopens, that sideways overflow isn't a real base anymore and shouldn't
  // get to sit there as a permanent extra source. tickFalls now remembers
  // what it backed up (dammedFallPools) and drains it the moment the gate
  // reopens (drainDammedPool), the same staggered way a gate CLOSING drains
  // a body cut off on the far side (recedeCutOffFluid).
  // -------------------------------------------------------------------------
  it("drains the sideways-backed-up pool once the gate reopens, instead of leaving it as a permanent extra source", () => {
    const rows = [
      "#....V....#",
      "#.....#...#", // y1: open at x4 (room to pool into), walled+contained at x6
      "#...#.#...#", // y2: trapdoor at x5
      "#...#.#...#",
      "###########",
    ];
    const trap: RoomEntity = { type: "trapdoor", x: 5, y: 2, gate: true } as RoomEntity;
    const rt = makeRoom(rows, [trap]);
    const inst = rt.entities.find((e) => e.kind === "trapdoor")!;
    setSimTime(10_000);
    tick(rt, 15); // build up the sideways pool while blocked
    expect(fluidAt(rt, 4, 1, "water"), "expected a sideways pool to have formed while blocked").toBe(true);
    inst.open = true;
    rt.update(1, null, 0, () => {}); // one flow tick: detects the reopen, schedules the drain
    setSimTime(20_000); // well past RECEDE_MS
    rt.update(1, null, 0, () => {}); // the scheduled drain actually fires
    expect(fluidAt(rt, 4, 1, "water"), "expected (4,1) to have drained after the gate reopened").toBe(false);
  });

  // -------------------------------------------------------------------------
  // REGRESSION (Sean, live playtest 2026-08-07, after the above fix went
  // out): "I just tested it and I'm seeing the same issue" — turned out
  // pooling wasn't the leftover problem, it was a genuine LEAK: poolFallBase
  // runs every single tick a gate stays closed, and in the real room one of
  // its spread targets had open space below leading down an entire
  // unrelated shaft. Every tick's placement fell straight through and got
  // re-placed the next tick — a permanent trickle pouring an extra
  // waterfall down that shaft and flooding the floor far below it, for as
  // long as the gate stayed shut. requireContainment refuses to place
  // anywhere that doesn't have solid ground directly under it — pooling
  // beside a gate may only settle somewhere it will actually stay.
  // -------------------------------------------------------------------------
  it("does not leak a permanent trickle down an unrelated open shaft while backed up behind a gate", () => {
    // Asymmetric on purpose, mirroring the real room: x4 (left of the fall)
    // is a genuinely contained pooling spot (wall directly below it at y2);
    // x6 (right of the fall) is open all the way down an unrelated shaft —
    // exactly the shape that leaked live.
    const rows = [
      "#....V.......#",
      "#............#", // y1: pooling row — x4 contained, x6 the leak candidate
      "#...#........#", // y2: trapdoor at x5 — x4 walled, x6+ wide open
      "#............#",
      "#............#",
      "#............#",
      "#............#",
      "#............#",
      "##############",
    ];
    const trap: RoomEntity = { type: "trapdoor", x: 5, y: 2, gate: true } as RoomEntity;
    const rt = makeRoom(rows, [trap]);
    setSimTime(10_000);
    tick(rt, 40); // plenty of time for a leak to establish and cascade, if one exists
    // The contained spot beside the gate legitimately pools...
    expect(fluidAt(rt, 4, 1, "water")).toBe(true);
    // ...but nothing ever leaked into the unrelated open shaft on the other
    // side, or down into it, or onto the floor far below.
    for (let y = 1; y <= 7; y++) {
      for (let x = 6; x <= 12; x++) {
        expect(fluidAt(rt, x, y, "water"), `expected (${x},${y}) to be dry — no leak`).toBe(false);
      }
    }
  });

  // -------------------------------------------------------------------------
  // REGRESSION (Sean, live playtest 2026-08-07, follow-up to the leak fix):
  // "Why did the water stop expanding to the right towards the spotters?"
  // Fixing the leak by refusing any spread without solid ground under it
  // was scoped too narrowly — it only guarded poolFallBase's OWN placement,
  // not that tile's own later spreading (case 4's SOURCED "surface, fully
  // fallen" branch, the SAME generic code every sourced tile — including
  // legitimate solid-ground pools — uses to widen). So the pool correctly
  // stopped leaking, but also stopped ever widening across a genuinely safe
  // floor it should have kept filling, like any other pool would. Fixed by
  // tagging gate-sourced tiles (gateSourcedTiles) and propagating the tag
  // as they spread, so containment keeps being required at every step, not
  // just the first — while a real, solid floor lets it keep widening across
  // the whole thing, same as it always could.
  // -------------------------------------------------------------------------
  it("still widens across a genuinely safe floor while refusing to leak down an unrelated shaft beside it", () => {
    const rows = [
      "#....V.............#", // fall at x5
      "#..................#", // y1: pooling row — x4 the leak candidate, x6-18 a real floor
      "####..##############", // y2: trapdoor at x5 — x4 open (leak continues down), x6-18 solid
      "####..##############",
      "####..##############",
      "####..##############",
      "####..##############",
      "####..##############",
      "####################", // floor, seals the leak shaft at the very bottom
    ];
    const trap: RoomEntity = { type: "trapdoor", x: 5, y: 2, gate: true } as RoomEntity;
    const rt = makeRoom(rows, [trap]);
    setSimTime(10_000);
    tick(rt, 80); // plenty of time to fill the whole safe floor if it's going to
    // Widened all the way across the real floor...
    for (let x = 6; x <= 18; x++) {
      expect(fluidAt(rt, x, 1, "water"), `expected (${x},1) — the safe floor — to have filled`).toBe(true);
    }
    // ...but never leaked down the open shaft right beside it — not even
    // the very top of it, since that spot has no solid ground under it
    // either.
    for (let y = 1; y <= 7; y++) {
      expect(fluidAt(rt, 4, y, "water"), `expected (4,${y}) to be dry — no leak`).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // REGRESSION (Sean, live playtest 2026-08-08, follow-up to the reopen-
  // drain fix): "Why didn't the water that hit the grate dry up with the
  // rest of the water that was coming from the same spot?" drainDammedPool's
  // flood-fill used raw map.at() to compare elements across the walk — but
  // a tile carrying its water as a grate overlay (a metal grate flush
  // against solid ground, per placeFluid's grateFluid routing) reads back
  // from map.at as the grate itself (element "metal"), not the water it's
  // carrying. The element compare never matched there, so gateSourcedTiles
  // membership was ignored and a grate-carried tile — despite being tagged,
  // despite still genuinely being part of the same pool — never made it
  // into the walk, and so never got scheduled to drain with everything
  // else. Fixed by using fluidDefAt (grate-aware, like every other
  // fluid-identity read in the sim) instead of the raw tile.
  // -------------------------------------------------------------------------
  it("drains a gate-dammed pool that rested on a metal grate, same as any other tile in it", () => {
    // The grate at x7 is deliberately NOT directly adjacent to the fall —
    // poolFallBase's own placement only ever reaches x6 (its immediate
    // neighbor); x7 is only reachable by that tile's own later cascade
    // (case 4), which is what makes it show up ONLY via drainDammedPool's
    // flood-fill, not the initial seed — exactly the gap that let it slip
    // through undrained.
    const rows = [
      "#....V.......#",
      "#......=.....#", // y1: pooling row — x6 open+contained (seed), x7 a grate flush below
      "#####.########", // y2: trapdoor at x5; x6 and x7 both walled directly under them
      "##############",
    ];
    const trap: RoomEntity = { type: "trapdoor", x: 5, y: 2, gate: true } as RoomEntity;
    const rt = makeRoom(rows, [trap]);
    const inst = rt.entities.find((e) => e.kind === "trapdoor")!;
    setSimTime(10_000);
    tick(rt, 20); // build up the pool, then let it cascade onto the grate
    expect(fluidAt(rt, 7, 1, "water"), "expected the pool to have cascaded onto the grate at x7").toBe(true);
    inst.open = true;
    rt.update(1, null, 0, () => {}); // detects the reopen, schedules the drain
    setSimTime(20_000); // well past RECEDE_MS
    rt.update(1, null, 0, () => {}); // the scheduled drain actually fires
    expect(fluidAt(rt, 6, 1, "water"), "expected the ordinary tile to have drained").toBe(false);
    expect(fluidAt(rt, 7, 1, "water"), "expected the grate-carried water to have drained too").toBe(false);
  });
});
