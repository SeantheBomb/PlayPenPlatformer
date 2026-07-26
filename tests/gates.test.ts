// Gate (door/trapdoor) fuse wiring design requirements, asserted headlessly
// against RoomRuntime. Run `npm test` before shipping any change to
// tripFusebox or the gate's initial-open computation in the constructor.
import { describe, expect, it } from "vitest";
import { RoomRuntime, type EntityInstance } from "../src/game/room";
import type { Content, RoomDef, RoomEntity, TileDef } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import tilesJson from "../content/tiles.json";
import gameJson from "../content/game.json";

const TILES = tilesJson as TileDef[];

function makeContent(): Content {
  return {
    game: gameJson as Content["game"],
    elements: [], rules: [], achievements: [],
    tiles: TILES, items: [], recipes: [], enemies: [], taunts: [],
    campaign: { rooms: [] }, rooms: {},
  } as unknown as Content;
}

function makeMuts(): RoomMutations {
  return {
    collected: new Set(), tileOverrides: [], openedDoors: new Set(),
    gateTouched: new Set(), helpedNpcs: new Set(), disabledEnemies: new Set(),
    bundles: [], placedItems: [], brazierLit: [],
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

describe("gate fuse wiring", () => {
  it("a legacy fuseId still opens the gate (backward compat)", () => {
    const { rt } = makeRoom([
      { type: "door", x: 2, y: 0, gate: true, fuseId: "A" } as RoomEntity,
      { type: "fusebox", x: 5, y: 0, fuseId: "A" } as RoomEntity,
    ]);
    const door = find(rt, "door");
    expect(door.open).toBe(false);
    rt.tripFusebox(find(rt, "fusebox"), []);
    expect(door.open).toBe(true);
  });

  it("openFuseId opens the gate, independent of a separate closeFuseId box", () => {
    const { rt } = makeRoom([
      { type: "trapdoor", x: 2, y: 0, gate: true, openFuseId: "OPEN" } as RoomEntity,
      { type: "fusebox", x: 5, y: 0, fuseId: "OPEN" } as RoomEntity,
      { type: "fusebox", x: 8, y: 0, fuseId: "CLOSE" } as RoomEntity,
    ]);
    const gate = find(rt, "trapdoor");
    const boxes = rt.entities.filter((e) => e.kind === "fusebox");
    rt.tripFusebox(boxes.find((b) => b.def.fuseId === "CLOSE")!, []);
    expect(gate.open).toBe(false); // wrong box tripped — no effect
    rt.tripFusebox(boxes.find((b) => b.def.fuseId === "OPEN")!, []);
    expect(gate.open).toBe(true);
  });

  it("closeFuseId closes an already-open gate", () => {
    const { rt } = makeRoom([
      {
        type: "door", x: 2, y: 0, gate: true,
        openFuseId: "OPEN", closeFuseId: "CLOSE", startOpen: true,
      } as RoomEntity,
      { type: "fusebox", x: 5, y: 0, fuseId: "CLOSE" } as RoomEntity,
    ]);
    const gate = find(rt, "door");
    expect(gate.open).toBe(true); // startOpen
    rt.tripFusebox(find(rt, "fusebox"), []);
    expect(gate.open).toBe(false);
  });

  it("startOpen is honored fresh, but a fuse trip this run overrides it on re-entry", () => {
    const muts = makeMuts();
    const entities: RoomEntity[] = [
      { type: "trapdoor", x: 2, y: 0, gate: true, closeFuseId: "CLOSE", startOpen: true } as RoomEntity,
      { type: "fusebox", x: 5, y: 0, fuseId: "CLOSE" } as RoomEntity,
    ];
    const first = makeRoom(entities, muts);
    expect(find(first.rt, "trapdoor").open).toBe(true);
    first.rt.tripFusebox(find(first.rt, "fusebox"), []);
    expect(find(first.rt, "trapdoor").open).toBe(false);

    // Re-entering the room (a fresh RoomRuntime over the same persisted
    // mutations) must reflect "closed," not fall back to startOpen again.
    const second = makeRoom(entities, muts);
    expect(find(second.rt, "trapdoor").open).toBe(false);
  });
});
