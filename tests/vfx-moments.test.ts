// The Effects panel only offers moments tileMoments() lists — so every one of
// them must be a moment the engine REALLY raises for that tile, and an
// element moment it doesn't list must never fire for it. Driven headlessly
// against the real RoomRuntime / Player, for every tile in content.
import { describe, expect, it } from "vitest";
import { RoomRuntime, type ElementEvent } from "../src/game/room";
import { Player } from "../src/game/player";
import { TileMap } from "../src/engine/tilemap";
import { fluidAt, itemMoments, tileMoments } from "../src/game/vfxmoments";
import type { Content, ItemDef, RoomDef, TileDef } from "../src/data/types";
import type { Input } from "../src/engine/input";
import type { RoomMutations, RunState } from "../src/game/state";
import tilesJson from "../content/tiles.json";
import itemsJson from "../content/items.json";
import gameJson from "../content/game.json";
import behaviorsJson from "../content/behaviors.json";
import rulesJson from "../content/rules.json";
import entitiesJson from "../content/entities.json";
import { setSimTime } from "../src/engine/simclock";

const TILES = tilesJson as TileDef[];
const content = {
  game: gameJson, elements: [], behaviors: behaviorsJson, entityTypes: entitiesJson, rules: rulesJson,
  achievements: [], tiles: TILES, items: [], recipes: [], enemies: [], taunts: [],
  campaign: { rooms: [] }, rooms: {},
} as unknown as Content;
const muts = (): RoomMutations => ({
  collected: new Set(), tileOverrides: [], openedDoors: new Set(), gateTouched: new Set(),
  helpedNpcs: new Set(), disabledEnemies: new Set(), drops: [], placedItems: [], brazierLit: [], sourceAmounts: [],
});
const room = (rows: string[]): RoomRuntime =>
  new RoomRuntime({ id: "t", name: "t", width: rows[0].length, height: rows.length, background: "#000", tiles: rows, entities: [] } as RoomDef, content, muts());
const ELEMENT_MOMENTS = ["ignite", "burnout", "extinguish", "fizzle", "melt", "dissolve", "freeze", "shatter", "energize"];
const ACTORS = [...new Set((rulesJson as { rule?: string }[]).map((r) => /^\s*(\w+)/.exec(r.rule ?? "")?.[1]).filter(Boolean))] as string[];

/** Every element moment raised FOR this tile by applying `actor` to it (plus
 *  water on it while burning, plus letting a burn run out). */
function elementMomentsRaised(tile: TileDef): Map<string, ElementEvent> {
  const seen = new Map<string, ElementEvent>();
  const note = (evs: ElementEvent[]) => { for (const e of evs) if (e.tileId === tile.id && !seen.has(e.effect)) seen.set(e.effect, e); };
  for (const actor of ACTORS) {
    const rt = room(["#####", "#...#", `#.${tile.char}.#`, "#####"]);
    const box = { x: 2 * 16 + 2, y: 2 * 16 + 2, w: 12, h: 12 };
    note(rt.applyElementToTiles(actor, box));
    // A burning tile: water puts it out; or leave it and it burns out.
    if (seen.has("ignite")) {
      const wet = room(["#####", "#...#", `#.${tile.char}.#`, "#####"]);
      wet.applyElementToTiles(actor, box);
      note(wet.applyElementToTiles("water", box));
      let t = 0;
      for (let i = 0; i < 60 * 8; i++) {
        t += 1000 / 60; setSimTime(t);
        rt.update(1 / 60, null, 0, note);
      }
    }
  }
  return seen;
}

describe("element moments: listed ⇔ really raised, for every tile", () => {
  for (const tile of TILES) {
    it(tile.id, () => {
      const listed = new Set(tileMoments(content, tile).map((m) => m.key).filter((k) => ELEMENT_MOMENTS.includes(k)));
      const raised = elementMomentsRaised(tile);
      for (const k of listed) expect(raised.has(k), `${tile.id} lists ${k} but it never fired`).toBe(true);
      for (const k of raised.keys()) {
        if (ELEMENT_MOMENTS.includes(k)) expect(listed.has(k), `${tile.id} raised ${k} but the panel wouldn't offer it`).toBe(true);
      }
    });
  }
  it("every element event names its tile and cell", () => {
    for (const tile of TILES) {
      for (const ev of elementMomentsRaised(tile).values()) {
        expect(ev.tileId).toBe(tile.id);
        expect([ev.tx, ev.ty]).toEqual([2, 2]);
      }
    }
  });
});

describe("fall moments", () => {
  const tick = (rt: RoomRuntime, n: number) => {
    const evs: ElementEvent[] = [];
    for (let i = 0; i < n; i++) (rt as unknown as { tickWaterFlow(e: ElementEvent[]): void }).tickWaterFlow(evs);
    return evs;
  };
  for (const fall of TILES.filter((t) => t.fallSpawns)) {
    const pool = TILES.find((t) => t.id === fall.fallSpawns)!;
    it(`${fall.id} meets a pool (pre-filled basin)`, () => {
      const p = pool.char;
      const rt = room([`#..${fall.char}..#`, "#.....#", "#.....#", `#${p.repeat(5)}#`, "#######"]);
      const evs = tick(rt, 30).filter((e) => e.tileId === fall.id);
      expect(evs.some((e) => e.effect === "fallImpact:fluid")).toBe(true);
      expect(evs.find((e) => e.effect === "fallImpact:fluid")!.tx).toBe(3);
    });
    it(`${fall.id} meets the floor (drain beneath)`, () => {
      const rt = room([`#..${fall.char}..#`, "#.....#", "#.....#", "###D###"]);
      const evs = tick(rt, 30).filter((e) => e.tileId === fall.id);
      expect(evs.some((e) => e.effect === "fallImpact:solid")).toBe(true);
      expect(evs.some((e) => e.effect === "fallImpact:fluid")).toBe(false);
    });
  }
  it("only falls list fall moments", () => {
    for (const t of TILES) {
      const has = tileMoments(content, t).some((m) => m.key.startsWith("fallImpact"));
      expect(has).toBe(!!t.fallSpawns);
    }
  });
});

describe("player moments", () => {
  const NO = { right: false, left: false, jumpPressed: false, jumpDown: false, downHeld: false } as Input;
  const map = (rows: string[]) => new TileMap({ id: "t", name: "t", width: rows[0].length, height: rows.length, background: "#000", tiles: rows, entities: [] } as RoomDef, TILES);
  /** Drop the player onto the tile; collect what player.update reports. */
  function drop(tile: TileDef) {
    const m = map(["#.....#", "#.....#", "#.....#", "#.....#", `#..${tile.char}..#`, "#######"]);
    const p = new Player(gameJson.player as never);
    p.placeFeetAt(3 * 16 + 8, 16);
    let bounced: TileDef | undefined, landedOn: TileDef | null = null;
    for (let i = 0; i < 90; i++) {
      setSimTime(i * 16);
      const ev = p.update(1 / 60, NO, m, {} as RunState);
      if (ev.bounced) bounced ??= ev.bounced.def;
      if (ev.landed && !landedOn) landedOn = m.at(Math.floor(p.centerX / 16), Math.floor((p.feetY + 1) / 16));
    }
    return { bounced, landedOn };
  }
  for (const tile of TILES) {
    const keys = tileMoments(content, tile).map((m) => m.key);
    if (keys.includes("bounce")) it(`${tile.id}: bounced on`, () => expect(drop(tile).bounced?.id).toBe(tile.id));
    if (keys.includes("land")) it(`${tile.id}: landed on`, () => expect(drop(tile).landedOn?.id).toBe(tile.id));
    if (keys.includes("enter")) {
      it(`${tile.id}: enter/exit = the player's middle crossing it`, () => {
        const m = map(["#.....#", `#${tile.char.repeat(5)}#`, "#######"]);
        expect(fluidAt(m, 3 * 16, 8)).toBeNull();
        expect(fluidAt(m, 3 * 16, 24)?.id).toBe(tile.id);
      });
    }
  }
  it("the placed Spring item bounces (its own moment, separate from the tile)", () => {
    const spring = (itemsJson as ItemDef[]).find((i) => i.placeType === "spring")!;
    expect(itemMoments(spring).map((m) => m.key)).toEqual(["bounce"]);
    expect((itemsJson as ItemDef[]).filter((i) => !i.placeType || i.placeType !== "spring").every((i) => itemMoments(i).length === 0)).toBe(true);
  });
});
