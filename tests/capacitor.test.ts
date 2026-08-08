// Capacitor design requirements, asserted headlessly against RoomRuntime.
// A capacitor turns on from ANY charge reaching it (no fuseId match needed,
// unlike a fusebox trip), stays on across ticks re-emitting its own charge
// into conductive neighbors, and only turns back off when a fusebox with
// its offFuseId trips (never, if unset). Run `npm test` before shipping any
// change to checkCapacitors/tickCapacitors/tripFusebox.
import { describe, expect, it } from "vitest";
import { RoomRuntime, type EntityInstance } from "../src/game/room";
import type { Content, RoomDef, RoomEntity, TileDef } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import { setSimTime } from "../src/engine/simclock";
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

const ROWS = ["#..........#", "#..........#", "############"];

function makeRoom(entities: RoomEntity[], muts = makeMuts()): { rt: RoomRuntime; muts: RoomMutations } {
  const room: RoomDef = {
    id: "test", name: "test", width: ROWS[0].length, height: ROWS.length,
    background: "#000", tiles: ROWS, entities,
  } as RoomDef;
  return { rt: new RoomRuntime(room, makeContent(), muts), muts };
}

const find = (rt: RoomRuntime, kind: string): EntityInstance =>
  rt.entities.find((e) => e.kind === kind)!;

/** Directly energizes the tile under an entity and runs the check pass —
 *  same shape as gates.test.ts's fusebox `zap` helper. */
function zap(rt: RoomRuntime, en: EntityInstance, t: number): void {
  setSimTime(t);
  rt.energized.set(rt.map.index(Math.floor(en.x / 16), Math.floor(en.y / 16)), t + 100);
  (rt as never as { checkCapacitors(ev: unknown[]): void }).checkCapacitors([]);
}

describe("capacitor turns on from any charge", () => {
  it("turns on when a neighboring tile is energized, with no fuseId wiring at all", () => {
    const { rt } = makeRoom([{ type: "capacitor", x: 5, y: 0 } as RoomEntity]);
    const cap = find(rt, "capacitor");
    expect(cap.open).toBe(false);
    zap(rt, cap, 1000);
    expect(cap.open).toBe(true);
  });

  it("announces itself as capacitorOn, not the fusebox's fuse/clink effect", () => {
    const { rt } = makeRoom([{ type: "capacitor", x: 5, y: 0 } as RoomEntity]);
    const cap = find(rt, "capacitor");
    setSimTime(1000);
    rt.energized.set(rt.map.index(Math.floor(cap.x / 16), Math.floor(cap.y / 16)), 1100);
    const events: { effect: string; entityIndex?: number }[] = [];
    (rt as never as { checkCapacitors(ev: typeof events): void }).checkCapacitors(events);
    expect(events.some((e) => e.effect === "fuse")).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ effect: "capacitorOn", entityIndex: cap.index }));
  });

  it("stays on across later check passes once already on (idempotent)", () => {
    const { rt } = makeRoom([{ type: "capacitor", x: 5, y: 0 } as RoomEntity]);
    const cap = find(rt, "capacitor");
    zap(rt, cap, 1000);
    expect(cap.open).toBe(true);
    (rt as never as { checkCapacitors(ev: unknown[]): void }).checkCapacitors([]);
    expect(cap.open).toBe(true);
  });
});

describe("capacitor emits continuous charge into neighbors while on", () => {
  // Metal floor (conductive) under and beside the capacitor — energizeFrom
  // only marks conductive tiles, so a plain "." floor can't show this.
  const metalRows = ["#..........#", "#..........#", "MMMMMMMMMMMM"];

  function makeMetalRoom(entities: RoomEntity[]): { rt: RoomRuntime } {
    const room: RoomDef = {
      id: "test", name: "test", width: metalRows[0].length, height: metalRows.length,
      background: "#000", tiles: metalRows, entities,
    } as RoomDef;
    return { rt: new RoomRuntime(room, makeContent(), makeMuts()) };
  }

  it("re-energizes a conductive neighbor tile every flow tick", () => {
    const { rt } = makeMetalRoom([{ type: "capacitor", x: 5, y: 1 } as RoomEntity]);
    const cap = find(rt, "capacitor");
    setSimTime(1000);
    cap.open = true;
    const neighborTx = Math.floor(cap.x / 16);
    const neighborTy = 2; // the metal floor row (row 2 of metalRows)
    expect(rt.isEnergized(neighborTx, neighborTy)).toBe(false);
    (rt as never as { tickCapacitors(ev: unknown[]): void }).tickCapacitors([]);
    expect(rt.isEnergized(neighborTx, neighborTy)).toBe(true);
  });

  it("an off capacitor emits nothing", () => {
    const { rt } = makeMetalRoom([{ type: "capacitor", x: 5, y: 1 } as RoomEntity]);
    const cap = find(rt, "capacitor");
    setSimTime(1000);
    expect(cap.open).toBe(false);
    const neighborTx = Math.floor(cap.x / 16);
    const neighborTy = 2;
    (rt as never as { tickCapacitors(ev: unknown[]): void }).tickCapacitors([]);
    expect(rt.isEnergized(neighborTx, neighborTy)).toBe(false);
  });
});

describe("capacitor offFuseId wiring", () => {
  it("turns off only when a fusebox with its offFuseId trips", () => {
    const { rt } = makeRoom([
      { type: "capacitor", x: 5, y: 0, offFuseId: "KILL" } as RoomEntity,
      { type: "fusebox", x: 8, y: 0, fuseId: "OTHER" } as RoomEntity,
      { type: "fusebox", x: 9, y: 0, fuseId: "KILL" } as RoomEntity,
    ]);
    const cap = find(rt, "capacitor");
    zap(rt, cap, 1000);
    expect(cap.open).toBe(true);
    const boxes = rt.entities.filter((e) => e.kind === "fusebox");
    rt.tripFusebox(boxes.find((b) => b.def.fuseId === "OTHER")!, []);
    expect(cap.open).toBe(true); // wrong box tripped — no effect
    rt.tripFusebox(boxes.find((b) => b.def.fuseId === "KILL")!, []);
    expect(cap.open).toBe(false);
  });

  it("never turns off (or on again from a trip alone) when offFuseId is unset", () => {
    const { rt } = makeRoom([
      { type: "capacitor", x: 5, y: 0 } as RoomEntity,
      { type: "fusebox", x: 8, y: 0, fuseId: "ANY" } as RoomEntity,
    ]);
    const cap = find(rt, "capacitor");
    zap(rt, cap, 1000);
    expect(cap.open).toBe(true);
    rt.tripFusebox(find(rt, "fusebox"), []);
    expect(cap.open).toBe(true); // no offFuseId — a fusebox trip never touches it
  });

  it("announces itself as capacitorOff, not the fusebox's fuse/clink effect", () => {
    const { rt } = makeRoom([
      { type: "capacitor", x: 5, y: 0, offFuseId: "KILL" } as RoomEntity,
      { type: "fusebox", x: 9, y: 0, fuseId: "KILL" } as RoomEntity,
    ]);
    const cap = find(rt, "capacitor");
    zap(rt, cap, 1000);
    expect(cap.open).toBe(true);
    const events: { effect: string; entityIndex?: number }[] = [];
    rt.tripFusebox(find(rt, "fusebox"), events);
    expect(cap.open).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ effect: "capacitorOff", entityIndex: cap.index }));
  });
});

// ---------------------------------------------------------------------------
// REQUIREMENT (Sean, 2026-08-07): "the capacitor is loud and clinks very
// often" — a capacitor's continuous re-shock keeps touching any fusebox in
// its reach every flow tick, and tripFusebox used to unconditionally push a
// "fuse" event (sfx "unlock" + camera shake + CLUNK text) on every call,
// even when the fusebox was already open. That read as constant clinking.
// ---------------------------------------------------------------------------
describe("tripFusebox only announces a real off->on transition", () => {
  it("does not re-emit the fuse event when the fusebox is already open", () => {
    const { rt } = makeRoom([{ type: "fusebox", x: 5, y: 0, fuseId: "A" } as RoomEntity]);
    const fb = find(rt, "fusebox");
    const first: { effect: string }[] = [];
    rt.tripFusebox(fb, first);
    expect(first.some((e) => e.effect === "fuse")).toBe(true);
    expect(fb.open).toBe(true);

    const second: { effect: string }[] = [];
    rt.tripFusebox(fb, second);
    expect(second.some((e) => e.effect === "fuse")).toBe(false);
    expect(fb.open).toBe(true); // still open — just no repeat announcement
  });
});

// ---------------------------------------------------------------------------
// REQUIREMENT (Sean, 2026-08-07): "once the capacitor is turned off, it
// should have a cooldown for X seconds before it can be turned back on. X
// should equal the amount of time it takes for a charged tile to discharge
// naturally" — so whatever the capacitor was still charging when it
// switched off can't immediately re-trigger it. X = elementEffects'
// energizeMs (1500ms in content/behaviors.json).
// ---------------------------------------------------------------------------
describe("capacitor cooldown after an offFuseId trip", () => {
  function makeKillRoom(): { rt: RoomRuntime; cap: EntityInstance; fb: EntityInstance } {
    const { rt } = makeRoom([
      { type: "capacitor", x: 5, y: 0, offFuseId: "KILL" } as RoomEntity,
      { type: "fusebox", x: 9, y: 0, fuseId: "KILL" } as RoomEntity,
    ]);
    return { rt, cap: find(rt, "capacitor"), fb: find(rt, "fusebox") };
  }

  it("refuses to turn back on from leftover charge immediately after turning off", () => {
    const { rt, cap, fb } = makeKillRoom();
    zap(rt, cap, 1000);
    expect(cap.open).toBe(true);
    rt.tripFusebox(fb, []);
    expect(cap.open).toBe(false);
    // Still within the discharge window — as if the same charge that was
    // powering it lingered on the tile and tried to re-trigger it.
    zap(rt, cap, 1050);
    expect(cap.open).toBe(false);
  });

  it("turns back on once the charge would have naturally discharged", () => {
    const { rt, cap, fb } = makeKillRoom();
    zap(rt, cap, 1000);
    rt.tripFusebox(fb, []);
    expect(cap.open).toBe(false);
    const energizeMs = 1500; // must match elementEffects.energizeMs in content/behaviors.json
    zap(rt, cap, 1000 + energizeMs + 10);
    expect(cap.open).toBe(true);
  });
});
