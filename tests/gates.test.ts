// Gate (door/trapdoor) fuse wiring design requirements, asserted headlessly
// against RoomRuntime. Run `npm test` before shipping any change to
// tripFusebox or the gate's initial-open computation in the constructor.
import { describe, expect, it } from "vitest";
import { RoomRuntime, type EntityInstance } from "../src/game/room";
import type { Content, RoomDef, RoomEntity, TileDef } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import { setSimTime } from "../src/engine/simclock";
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
const charAt = (rt: RoomRuntime, x: number, y: number) => rt.map.at(x, y)?.char ?? ".";

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

// ---------------------------------------------------------------------------
// REQUIREMENT (Sean, 2026-07-26): closing a gate can cut a SOURCED body off
// from the fall feeding it — that body shouldn't get to stay infinite (or
// just sit there) forever. It should drain out over ~2s once cut off,
// fading from farthest-from-the-gate first, not vanish all at once.
// ---------------------------------------------------------------------------
describe("cutting a SOURCED body off from its fall drains it, doesn't strand it", () => {
  // Fall at x18 (y0), floor at y8, open floor row at y7. A gated door sits
  // at x10 on that floor, wired to two separate fuseboxes.
  // 25 wide, walls both sides — fall source at x18 (y0), floor at y8.
  const rows = [
    "#.................J......", // y0 fall source at x18
    "#.......................#", // y1
    "#.......................#", // y2
    "#.......................#", // y3
    "#.......................#", // y4
    "#.......................#", // y5
    "#.......................#", // y6
    "#.......................#", // y7 floor
    "#########################", // y8
  ];
  const door: RoomEntity = {
    type: "door", x: 10, y: 7, gate: true, openFuseId: "OPEN", closeFuseId: "CLOSE",
  } as RoomEntity;
  const openBox: RoomEntity = { type: "fusebox", x: 21, y: 7, fuseId: "OPEN" } as RoomEntity;
  const closeBox: RoomEntity = { type: "fusebox", x: 22, y: 7, fuseId: "CLOSE" } as RoomEntity;

  function makeGateRoom(): RoomRuntime {
    const roomDef: RoomDef = {
      id: "test", name: "test", width: rows[0].length, height: rows.length,
      background: "#000", tiles: rows, entities: [door, openBox, closeBox],
    } as RoomDef;
    return new RoomRuntime(roomDef, makeContent(), makeMuts());
  }

  /** Full update() (not just tickWaterFlow) — recede logic lives there. */
  function step(rt: RoomRuntime, ms: number, simMs: { t: number }): void {
    simMs.t += ms;
    setSimTime(simMs.t);
    rt.update(ms / 1000, null, 0, () => {});
  }

  it("floods past the door once opened, drains the far side over ~2s once re-closed", () => {
    const rt = makeGateRoom();
    const simMs = { t: 0 };
    for (let i = 0; i < 40; i++) step(rt, 500, simMs); // fall grows, pools at the closed door

    for (let x = 2; x <= 9; x++) {
      expect(charAt(rt, x, 7), `sealed behind the door at (${x},7)`).toBe(".");
    }

    rt.tripFusebox(rt.entities.find((e) => e.def.fuseId === "OPEN")!, []);
    for (let i = 0; i < 20; i++) step(rt, 500, simMs); // floods past the door

    for (let x = 2; x <= 17; x++) {
      expect(charAt(rt, x, 7), `lava expected past the door at (${x},7)`).toBe("L");
    }

    rt.tripFusebox(rt.entities.find((e) => e.def.fuseId === "CLOSE")!, []);
    // Immediately after closing: still there — it recedes, doesn't vanish.
    let stillPresent = 0;
    for (let x = 2; x <= 9; x++) if (charAt(rt, x, 7) === "L") stillPresent++;
    expect(stillPresent).toBeGreaterThan(0);

    // Mid-recede (~1s in): some has drained, but not the whole cut-off body.
    for (let i = 0; i < 2; i++) step(rt, 500, simMs);
    let remaining = 0;
    for (let x = 2; x <= 9; x++) if (charAt(rt, x, 7) === "L") remaining++;
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(8);

    // Fully drained by ~2.5s.
    for (let i = 0; i < 3; i++) step(rt, 500, simMs);
    for (let x = 2; x <= 9; x++) {
      expect(charAt(rt, x, 7), `(${x},7) should have drained`).toBe(".");
    }

    // The still-connected side (between the fall and the now-closed door)
    // is untouched — only the cut-off side recedes.
    for (let x = 19; x <= 20; x++) {
      expect(charAt(rt, x, 7), `still-fed lava expected at (${x},7)`).toBe("L");
    }
  });
});
