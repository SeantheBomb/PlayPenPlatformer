// Room-progress design requirements, asserted headlessly against RoomRuntime
// and the pure roomProgress functions. Progress is DERIVED, not persisted —
// tileProgress/entityProgress must stay correct against whatever
// RoomMutations already tracks (tileOverrides, openedDoors, brazierLit,
// gateTouched) without any new persisted field. Run `npm test` before
// shipping any change to tileProgress/entityProgress/setTileById/
// setBrazierLit or the openedDoors call sites.
import { describe, expect, it } from "vitest";
import { RoomRuntime, type EntityInstance } from "../src/game/room";
import { tileProgress, entityProgress, enemyProgress } from "../src/game/roomProgress";
import { emptyRoomMutations } from "../src/game/state";
import type { Content, EnemyDef, RoomDef, RoomEntity, TileDef } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import { setSimTime } from "../src/engine/simclock";
import tilesJson from "../content/tiles.json";
import gameJson from "../content/game.json";
import behaviorsJson from "../content/behaviors.json";
import enemiesJson from "../content/enemies.json";
import rulesJson from "../content/rules.json";

const TILES = tilesJson as TileDef[];
const ENEMIES = enemiesJson as EnemyDef[];

function makeContent(withEnemies = false): Content {
  return {
    game: gameJson as Content["game"],
    elements: [], behaviors: behaviorsJson as never, rules: rulesJson,
    achievements: [], tiles: TILES, items: [], recipes: [], enemies: withEnemies ? ENEMIES : [],
    taunts: [], campaign: { rooms: [] }, rooms: {},
  } as unknown as Content;
}

function makeRoomDef(rows: string[], entities: RoomEntity[] = []): RoomDef {
  return {
    id: "test", name: "test", width: rows[0].length, height: rows.length,
    background: "#000", tiles: rows, entities,
  } as RoomDef;
}

function makeRoom(
  rows: string[], entities: RoomEntity[] = [], muts = emptyRoomMutations(), withEnemies = false
) {
  return { rt: new RoomRuntime(makeRoomDef(rows, entities), makeContent(withEnemies), muts), muts };
}

const find = (rt: RoomRuntime, kind: string): EntityInstance =>
  rt.entities.find((e) => e.kind === kind)!;

function tick(rt: RoomRuntime, n = 1): void {
  for (let i = 0; i < n; i++) (rt as never as { tickWaterFlow(ev: unknown[]): void }).tickWaterFlow([]);
}

describe("tileProgress derives from tileOverrides, no persisted counter needed", () => {
  const rows = [
    "#.b.b.b.#",
    "#........",
    "#########",
  ];

  it("reports 0/3 for a fresh room with three balloons", () => {
    const { rt } = makeRoom(rows);
    expect(rt.tileProgress("balloon")).toEqual({ total: 3, done: 0 });
  });

  it("pops one balloon and reports 1/3", () => {
    const { rt } = makeRoom(rows);
    rt.popBalloonsIn({ x: 0, y: 0, w: 3 * 16, h: 16 }); // covers tx 0..3 — only the balloon at x=2
    expect(rt.tileProgress("balloon")).toEqual({ total: 3, done: 1 });
  });

  it("popping all three reports 3/3", () => {
    const { rt } = makeRoom(rows);
    rt.popBalloonsIn({ x: 0, y: 0, w: 9 * 16, h: 16 });
    expect(rt.tileProgress("balloon")).toEqual({ total: 3, done: 3 });
  });

  it("survives a room reload — progress reads from persisted tileOverrides", () => {
    const muts = emptyRoomMutations();
    const first = makeRoom(rows, [], muts);
    first.rt.popBalloonsIn({ x: 0, y: 0, w: 9 * 16, h: 16 });
    expect(first.rt.tileProgress("balloon")).toEqual({ total: 3, done: 3 });
    const second = makeRoom(rows, [], muts); // fresh RoomRuntime, same persisted mutations
    expect(second.rt.tileProgress("balloon")).toEqual({ total: 3, done: 3 });
  });

  it("a room this player never visited reads as fully un-popped via emptyRoomMutations()", () => {
    const room = makeRoomDef(rows);
    const content = makeContent();
    expect(tileProgress(room, content, emptyRoomMutations(), "balloon")).toEqual({ total: 3, done: 0 });
  });
});

describe("tileProgress covers burn/melt the same way, no special-casing per tile type", () => {
  it("toy blocks burning away count toward progress", () => {
    const rows = ["#T.#", "####"];
    const { rt } = makeRoom(rows);
    expect(rt.tileProgress("toyblock")).toEqual({ total: 1, done: 0 });
    (rt as never as { igniteTile(tx: number, ty: number): boolean }).igniteTile(1, 0);
    tick(rt, 1);
    // Drive the burn-timer tick directly via update() so burnout fires.
    rt.update(10, null, 0, () => {});
    expect(rt.tileProgress("toyblock")).toEqual({ total: 1, done: 1 });
  });

  it("ice melting counts toward progress", () => {
    const rows = ["#I.#", "####"];
    const { rt } = makeRoom(rows);
    expect(rt.tileProgress("ice")).toEqual({ total: 1, done: 0 });
    rt.applyElementToTiles("fire", { x: 16, y: 0, w: 16, h: 16 });
    expect(rt.tileProgress("ice")).toEqual({ total: 1, done: 1 });
  });
});

describe("entityProgress derives from openedDoors/brazierLit, no persisted counter needed", () => {
  it("lit braziers count toward progress", () => {
    const { rt } = makeRoom(["#....#", "######"], [
      { type: "brazier", x: 1, y: 0, lit: false } as RoomEntity,
      { type: "brazier", x: 2, y: 0, lit: false } as RoomEntity,
    ]);
    expect(rt.entityProgress("brazier", "lit")).toEqual({ total: 2, done: 0 });
    rt.setBrazierLit(find(rt, "brazier"), true);
    expect(rt.entityProgress("brazier", "lit")).toEqual({ total: 2, done: 1 });
  });

  it("a fusebox trip counts toward open-based progress", () => {
    const { rt } = makeRoom(["#....#", "######"], [
      { type: "fusebox", x: 1, y: 0, fuseId: "A" } as RoomEntity,
    ]);
    expect(rt.entityProgress("fusebox", "open")).toEqual({ total: 1, done: 0 });
    setSimTime(1000);
    rt.tripFusebox(find(rt, "fusebox"), []);
    expect(rt.entityProgress("fusebox", "open")).toEqual({ total: 1, done: 1 });
  });

  it("a gate authored startOpen counts as open before any fuse trip", () => {
    const { rt } = makeRoom(["#....#", "######"], [
      { type: "door", x: 1, y: 0, gate: true, startOpen: true } as RoomEntity,
      { type: "door", x: 3, y: 0, gate: true, startOpen: false } as RoomEntity,
    ]);
    expect(rt.entityProgress("door", "open")).toEqual({ total: 2, done: 1 });
  });
});

describe("enemyProgress derives from disabledEnemies, no persisted counter needed", () => {
  const rows = ["#..........#", "#..........#", "############"];
  const enemyEntity = (x: number, y: number, id: string): RoomEntity =>
    ({ type: "enemy", x, y, enemy: id, patrolMinX: x - 2, patrolMaxX: x + 2 } as RoomEntity);

  it("reports 0/2 for a fresh room with two crawlers", () => {
    const { rt } = makeRoom(rows, [enemyEntity(2, 1, "crawler"), enemyEntity(8, 1, "crawler")], undefined, true);
    expect(rt.enemyProgress("crawler")).toEqual({ total: 2, done: 0 });
  });

  it("killing one crawler (fire) reports 1/2 and marks it permanently gone", () => {
    const { rt, muts } = makeRoom(rows, [enemyEntity(2, 1, "crawler"), enemyEntity(8, 1, "crawler")], undefined, true);
    const en = rt.enemies[0];
    const idx = en.index;
    const events = rt.applyElementToEnemies("fire", { x: en.x - 2, y: en.y - 2, w: 24, h: 24 }, 3000);
    expect(events.some((e) => e.effect === "enemy_kill")).toBe(true);
    expect(muts.disabledEnemies.has(idx)).toBe(true);
    expect(rt.enemyProgress("crawler")).toEqual({ total: 2, done: 1 });
    expect(rt.progressDirty).toBe(true); // room_progress achievements re-check promptly
  });

  it("killing every crawler in the room reports 2/2", () => {
    const { rt } = makeRoom(rows, [enemyEntity(2, 1, "crawler"), enemyEntity(8, 1, "crawler")], undefined, true);
    for (const en of [...rt.enemies]) {
      rt.applyElementToEnemies("fire", { x: en.x - 2, y: en.y - 2, w: 24, h: 24 }, 3000);
    }
    expect(rt.enemyProgress("crawler")).toEqual({ total: 2, done: 2 });
  });

  it("survives a room reload — progress reads from persisted disabledEnemies", () => {
    const muts = emptyRoomMutations();
    const first = makeRoom(rows, [enemyEntity(2, 1, "crawler")], muts, true);
    const en = first.rt.enemies[0];
    first.rt.applyElementToEnemies("fire", { x: en.x - 2, y: en.y - 2, w: 24, h: 24 }, 3000);
    expect(first.rt.enemyProgress("crawler")).toEqual({ total: 1, done: 1 });
    const second = makeRoom(rows, [enemyEntity(2, 1, "crawler")], muts, true); // fresh RoomRuntime, same persisted mutations
    expect(second.rt.enemyProgress("crawler")).toEqual({ total: 1, done: 1 });
  });

  it("a room this player never visited reads as fully un-destroyed via emptyRoomMutations()", () => {
    const room = makeRoomDef(rows, [enemyEntity(2, 1, "crawler")]);
    expect(enemyProgress(room, emptyRoomMutations(), "crawler")).toEqual({ total: 1, done: 0 });
  });

  it("stuns don't count — only destruction persists", () => {
    const { rt } = makeRoom(rows, [enemyEntity(2, 1, "crawler")], undefined, true);
    const en = rt.enemies[0];
    const events = rt.applyElementToEnemies("ice", { x: en.x - 2, y: en.y - 2, w: 24, h: 24 }, 3000);
    expect(events.some((e) => e.effect === "enemy_stun")).toBe(true);
    expect(rt.enemyProgress("crawler")).toEqual({ total: 1, done: 0 });
  });
});

describe("RoomRuntime.progressDirty flags real changes for the achievement re-check", () => {
  it("starts clean and flips true on a tile transform", () => {
    const { rt } = makeRoom(["#.b.#", "#####"]);
    expect(rt.progressDirty).toBe(false);
    rt.popBalloonsIn({ x: 0, y: 0, w: 5 * 16, h: 16 });
    expect(rt.progressDirty).toBe(true);
  });

  it("flips true on a brazier lit change", () => {
    const { rt } = makeRoom(["#....#", "######"], [
      { type: "brazier", x: 1, y: 0, lit: false } as RoomEntity,
    ]);
    expect(rt.progressDirty).toBe(false);
    rt.setBrazierLit(find(rt, "brazier"), true);
    expect(rt.progressDirty).toBe(true);
  });
});
