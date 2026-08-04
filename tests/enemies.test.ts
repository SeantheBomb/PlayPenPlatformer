// Enemy AI design requirements, asserted headlessly against RoomRuntime.
// Run `npm test` before touching canStepAhead or the patrol branch in
// RoomRuntime.update's enemy loop.
import { describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/game/room";
import type { Content, RoomDef, RoomEntity, TileDef, EnemyDef } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import tilesJson from "../content/tiles.json";
import enemiesJson from "../content/enemies.json";
import gameJson from "../content/game.json";
import behaviorsJson from "../content/behaviors.json";

const TILES = tilesJson as TileDef[];
const ENEMIES = enemiesJson as EnemyDef[];

function makeContent(): Content {
  return {
    game: gameJson as Content["game"],
    elements: [], behaviors: behaviorsJson as never, rules: [], achievements: [],
    tiles: TILES, items: [], recipes: [], enemies: ENEMIES, taunts: [],
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

// ---------------------------------------------------------------------------
// REQUIREMENT (Sean, playtest 2026-07-26, Des's notes: "Spotters stop
// moving"): a metal patroller boxed in by a wall on one side and water on
// the other (water refused by metal enemies) must come to a clean, single
// stop — not flip its facing back and forth every frame forever while
// making zero progress, which read as the enemy freezing/glitching.
// ---------------------------------------------------------------------------
describe("a patrolling metal enemy boxed by a wall and water stops cleanly", () => {
  const rows = [
    "#.w.#",
    "#.w.#",
    "#####",
  ];
  const spotter: RoomEntity = {
    type: "enemy", enemy: "spotter", x: 1, y: 1,
    patrolMinX: -2, patrolMaxX: 10,
  } as RoomEntity;

  function makeRoom(): RoomRuntime {
    const room: RoomDef = {
      id: "test", name: "test", width: rows[0].length, height: rows.length,
      background: "#000", tiles: rows, entities: [spotter],
    } as RoomDef;
    return new RoomRuntime(room, makeContent(), makeMuts());
  }

  it("settles to a genuine stop (vx=0) instead of endlessly ramming the wall", () => {
    const rt = makeRoom();
    const en = rt.enemies[0];
    for (let i = 0; i < 5; i++) rt.update(1 / 60, null, 0, () => {});
    // Old behavior: patrol proactively refuses the water side, blindly
    // commits to the wall side anyway, slams into it, and the reactive
    // hitWall flip immediately reverses facing back — so every single
    // frame recomputes want=-1 and sets vx=-38 again, forever, even
    // though the enemy can never actually move. canStepAhead now checks
    // the wall proactively too, so patrol recognizes both directions are
    // blocked up front and stops cleanly (vx settles to 0).
    expect(en.vx).toBe(0);
    expect(en.x).toBe(16); // never actually moved
  });

  it("still refuses to walk into the water tile", () => {
    const rt = makeRoom();
    const en = rt.enemies[0];
    for (let i = 0; i < 30; i++) rt.update(1 / 60, null, 0, () => {});
    // Water sits at tile x=2; the enemy (width 16, spawned at tile x=1)
    // must never cross into it.
    expect(en.x).toBeLessThan(2 * 16);
  });
});

describe("a patrolling enemy with one clear side still bounces normally", () => {
  it("reverses toward the open side instead of freezing", () => {
    const rows = [
      "#....#",
      "#....#",
      "######",
    ];
    const spotter: RoomEntity = {
      type: "enemy", enemy: "spotter", x: 1, y: 1,
      patrolMinX: 1, patrolMaxX: 3,
    } as RoomEntity;
    const room: RoomDef = {
      id: "test", name: "test", width: rows[0].length, height: rows.length,
      background: "#000", tiles: rows, entities: [spotter],
    } as RoomDef;
    const rt = new RoomRuntime(room, makeContent(), makeMuts());
    const en = rt.enemies[0];
    const xs: number[] = [];
    for (let i = 0; i < 90; i++) {
      rt.update(1 / 60, null, 0, () => {});
      xs.push(en.x);
    }
    // Real back-and-forth patrol motion within its range — not stuck.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(8);
  });
});
