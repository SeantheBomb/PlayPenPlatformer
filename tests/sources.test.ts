// Design requirement (Sean, 2026-08-04): sources and converters exist to keep
// levels from softlocking on scarce materials. A source grabs one unit of a
// configured item per E-press (finite or infinite); a converter trades a
// configured input item for a configured output item. Asserted headlessly
// against RoomRuntime. Run `npm test` before touching grabFromSource in
// room.ts, or the "source"/"converter" cases in game.ts's tryInteract.
import { describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/game/room";
import type { Content, ItemDef, RoomDef, RoomEntity, TileDef } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import tilesJson from "../content/tiles.json";
import gameJson from "../content/game.json";

const TILES = tilesJson as TileDef[];
const ITEMS: ItemDef[] = [
  { id: "wood", name: "Wood", kind: "material", shape: "plank", color: "#000", description: "" },
  { id: "gear", name: "Gear", kind: "material", shape: "cog", color: "#000", description: "" },
];

function makeContent(): Content {
  return {
    game: gameJson as Content["game"],
    elements: [], rules: [], achievements: [],
    tiles: TILES, items: ITEMS, recipes: [], enemies: [], taunts: [],
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

describe("source: fixed-stock and infinite item dispensers", () => {
  it("a finite source depletes one unit per grab and refuses when empty", () => {
    const source: RoomEntity = {
      type: "source", x: 3, y: 1, sourceItem: "wood", sourceAmount: 2,
    } as RoomEntity;
    const { rt } = makeRoom([source]);
    const e = rt.entities[0];
    expect(e.amount).toBe(2);
    expect(rt.grabFromSource(e)).toBe(true);
    expect(e.amount).toBe(1);
    expect(rt.grabFromSource(e)).toBe(true);
    expect(e.amount).toBe(0);
    expect(rt.grabFromSource(e)).toBe(false); // empty — refuses, no further mutation
    expect(e.amount).toBe(0);
  });

  it("an infinite (-1) source never depletes", () => {
    const source: RoomEntity = {
      type: "source", x: 3, y: 1, sourceItem: "wood", sourceAmount: -1,
    } as RoomEntity;
    const { rt } = makeRoom([source]);
    const e = rt.entities[0];
    for (let i = 0; i < 10; i++) expect(rt.grabFromSource(e)).toBe(true);
    expect(e.amount).toBe(-1);
  });

  it("remaining stock persists across a room reload via RoomMutations", () => {
    const source: RoomEntity = {
      type: "source", x: 3, y: 1, sourceItem: "wood", sourceAmount: 5,
    } as RoomEntity;
    const { rt, muts } = makeRoom([source]);
    rt.grabFromSource(rt.entities[0]);
    rt.grabFromSource(rt.entities[0]);
    expect(muts.sourceAmounts).toEqual([[0, 3]]);
    // Reload the same room from the persisted mutations.
    const { rt: reloaded } = makeRoom([source], muts);
    expect(reloaded.entities[0].amount).toBe(3);
  });
});

describe("interactableNear picks up source/converter entities", () => {
  it("finds a source within reach", () => {
    const source: RoomEntity = {
      type: "source", x: 3, y: 1, sourceItem: "wood", sourceAmount: -1,
    } as RoomEntity;
    const { rt } = makeRoom([source]);
    const e = rt.entities[0];
    const found = rt.interactableNear(e.x + e.w / 2, e.y + e.h / 2);
    expect(found?.kind).toBe("source");
  });

  it("finds a converter within reach", () => {
    const converter: RoomEntity = {
      type: "converter", x: 3, y: 1,
      convertInput: "wood", convertInputCount: 2,
      convertOutput: "gear", convertOutputCount: 1,
    } as RoomEntity;
    const { rt } = makeRoom([converter]);
    const e = rt.entities[0];
    const found = rt.interactableNear(e.x + e.w / 2, e.y + e.h / 2);
    expect(found?.kind).toBe("converter");
  });
});
