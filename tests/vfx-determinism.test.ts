// The sim wall: tile effects read the event stream and never write sim
// state. Same room, same steps, effects playing vs not → identical tiles,
// fluid and fire state every step; and playing effects never mutates content
// (so a republished vfx.json can't change how a recorded run plays).
import { describe, expect, it } from "vitest";
import { RoomRuntime, type ElementEvent } from "../src/game/room";
import { VfxPlayer } from "../src/engine/vfx";
import type { Content, RoomDef, TileDef, VfxFile } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import tilesJson from "../content/tiles.json";
import gameJson from "../content/game.json";
import behaviorsJson from "../content/behaviors.json";
import rulesJson from "../content/rules.json";
import entitiesJson from "../content/entities.json";
import vfxJson from "../content/vfx.json";
import { setSimTime } from "../src/engine/simclock";

const mk = () => {
  const tiles = structuredClone(tilesJson) as TileDef[];
  // Give every tile an effect on every moment so the player has real work.
  for (const t of tiles) t.vfx = [
    { id: "a", on: "fallImpact:fluid", preset: "splash", while: true },
    { id: "b", on: "ignite", preset: "embers" },
    { id: "c", on: "ambient", preset: "mist" },
    { id: "d", on: "melt", preset: "squish" },
  ];
  return {
    game: gameJson, elements: [], behaviors: behaviorsJson, entityTypes: entitiesJson, rules: rulesJson,
    achievements: [], tiles, items: [], recipes: [], enemies: [], taunts: [],
    campaign: { rooms: [] }, rooms: {}, vfx: structuredClone(vfxJson) as unknown as VfxFile,
  } as unknown as Content;
};
const ROWS = [
  "#......V.....W#",
  "#.............#",
  "#....fW.......#",
  "#...I.f.......#",
  "#wwwwwwwwwwwww#",
  "###############",
];
const muts = (): RoomMutations => ({
  collected: new Set(), tileOverrides: [], openedDoors: new Set(), gateTouched: new Set(),
  helpedNpcs: new Set(), disabledEnemies: new Set(), drops: [], placedItems: [], brazierLit: [], sourceAmounts: [],
});

function run(withFx: boolean, c: Content): string[] {
  const rt = new RoomRuntime({ id: "t", name: "t", width: ROWS[0].length, height: ROWS.length, background: "#000", tiles: ROWS, entities: [] } as RoomDef, c, muts());
  const fx = new VfxPlayer(c.vfx, { shake: () => {}, particlesOn: () => true, flashesOn: () => true });
  const byId = new Map(c.tiles.map((t) => [t.id, t]));
  const snaps: string[] = [];
  let t = 0;
  for (let step = 0; step < 600; step++) {
    t += 1000 / 60; setSimTime(t);
    rt.update(1 / 60, null, 0, (evs: ElementEvent[]) => {
      if (!withFx) return;
      for (const e of evs) fx.play(e.effect, e.tileId ? byId.get(e.tileId) : undefined, { x: e.x, y: e.y, color: e.color, cell: e.tx !== undefined ? { px: e.tx * 16, py: (e.ty ?? 0) * 16 } : undefined });
    });
    if (withFx) {
      fx.update(1 / 60, step / 60);
      const cells = [];
      for (let ty = 0; ty < rt.map.height; ty++) for (let tx = 0; tx < rt.map.width; tx++) {
        const d = rt.map.at(tx, ty); if (d) cells.push({ tx, ty, def: d });
      }
      fx.ambient(1 / 60, cells);
    }
    if (step === 30) rt.applyElementToTiles("fire", { x: 4 * 16, y: 3 * 16, w: 16, h: 16 });
    let s = "";
    for (let ty = 0; ty < rt.map.height; ty++) for (let tx = 0; tx < rt.map.width; tx++) s += rt.map.at(tx, ty)?.char ?? ".";
    s += "|" + [...(rt as unknown as { burning: Map<number, number> }).burning.keys()].join(",");
    snaps.push(s);
  }
  return snaps;
}

describe("effects never touch the simulation", () => {
  it("identical sim state every step with effects playing vs not", () => {
    const a = run(false, mk());
    const b = run(true, mk());
    expect(b).toEqual(a);
    // Something actually happened (the fall poured, the fire spread).
    expect(a[0]).not.toEqual(a[a.length - 1]);
  });
  it("playing effects never mutates content", () => {
    const c = mk();
    const before = JSON.stringify(c);
    run(true, c);
    expect(JSON.stringify(c)).toBe(before);
  });
});
