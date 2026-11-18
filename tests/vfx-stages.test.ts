// Preview stages are real levels, not drawings: for EVERY tile and every
// moment the Effects panel offers it, the default stage for that moment —
// built by the same buildStage the studio's runner uses — really raises the
// moment within the stage's loop, driven through the real engine pieces
// (RoomRuntime, Player). A stage that can't, fails here in CI.
import { describe, expect, it } from "vitest";
import { RoomRuntime, type ElementEvent } from "../src/game/room";
import { Player } from "../src/game/player";
import { fluidAt, itemMoments, tileMoments } from "../src/game/vfxmoments";
import { buildStage, stageFor, worstScreenCount } from "../src/studio/stagebuild";
import type { Content, ItemDef, TileDef, VfxFile, VfxStage } from "../src/data/types";
import type { Input } from "../src/engine/input";
import type { RoomMutations, RunState } from "../src/game/state";
import { rectsOverlap } from "../src/engine/math";
import tilesJson from "../content/tiles.json";
import itemsJson from "../content/items.json";
import gameJson from "../content/game.json";
import behaviorsJson from "../content/behaviors.json";
import rulesJson from "../content/rules.json";
import entitiesJson from "../content/entities.json";
import vfxJson from "../content/vfx.json";
import { setSimTime } from "../src/engine/simclock";

const TILES = tilesJson as TileDef[];
const VFX = vfxJson as unknown as VfxFile;
const content = {
  game: gameJson, elements: [], behaviors: behaviorsJson, entityTypes: entitiesJson, rules: rulesJson,
  achievements: [], tiles: TILES, items: [], recipes: [], enemies: [], taunts: [], campaign: { rooms: [] }, rooms: {}, vfx: VFX,
} as unknown as Content;
const muts = (): RoomMutations => ({
  collected: new Set(), tileOverrides: [], openedDoors: new Set(), gateTouched: new Set(),
  helpedNpcs: new Set(), disabledEnemies: new Set(), drops: [], placedItems: [], brazierLit: [], sourceAmounts: [],
});
const STEP = 1 / 60;

/** Run one loop of `stage` for `subject` and say whether `moment` happened. */
function raises(stage: VfxStage, subject: Parameters<typeof buildStage>[2], moment: string): boolean {
  const b = buildStage(content, stage, subject, moment);
  if (b.errors.length) throw new Error(b.errors.join("; "));
  const rt = new RoomRuntime(b.room, content, muts());
  const at = b.at!;
  const steps = Math.round((stage.seconds ?? 4) * 60);
  const tileId = subject.kind === "tile" ? subject.def.id : null;
  let hit = false;
  const note = (evs: ElementEvent[]) => { for (const e of evs) if (e.effect === moment && (!tileId || e.tileId === tileId)) hit = true; };
  const player = new Player(gameJson.player as never);
  player.placeFeetAt(rt.spawnX, rt.spawnY);
  const held = new Set<string>();
  const pressed = new Set<string>();
  let prevFluid: string | null = fluidAt(rt.map, player.centerX, player.centerY)?.id ?? null;
  let t = 0;
  for (let f = 0; f < steps && !hit; f++) {
    t += 1000 / 60; setSimTime(t);
    for (const c of stage.clip ?? []) if (c.f === f) { if (c.d) { held.add(c.c); pressed.add(c.c); } else held.delete(c.c); }
    const beat = stage.apply ? f % Math.round(stage.apply * 60) : -1;
    const cell = { x: at.tx * 16 + 2, y: at.ty * 16 + 2, w: 12, h: 12 };
    if (b.prime && beat === 0) note(rt.applyElementToTiles(b.prime, cell));
    if (b.actor && beat === 30) note(rt.applyElementToTiles(b.actor, cell));
    rt.update(STEP, null, 0, note);
    const input = {
      right: held.has("ArrowRight"), left: held.has("ArrowLeft"), downHeld: false,
      jumpDown: held.has("Space"), jumpPressed: pressed.has("Space"),
    } as Input;
    pressed.clear();
    const vy0 = player.vy;
    const ev = player.update(STEP, input, rt.map, {} as RunState);
    if (moment === "bounce" && ev.bounced?.def.id === tileId) hit = true;
    if (moment === "land" && ev.landed && ev.landSpeed > gameJson.juice.landDustAtFallSpeed) {
      const below = rt.map.at(Math.floor(player.centerX / 16), Math.floor((player.feetY + 1) / 16));
      if (below?.id === tileId) hit = true;
    }
    if (moment === "bounce" && b.placed && vy0 > 40) {
      // game.ts's placed-spring check, verbatim.
      const prect0 = { x: player.x, y: player.feetY - 2, w: player.w, h: 6 };
      if (rectsOverlap(prect0, { ...b.placed, w: 16, h: 8 })) hit = true;
    }
    const fl = fluidAt(rt.map, player.centerX, player.centerY)?.id ?? null;
    if (fl !== prevFluid) {
      if (moment === "enter" && fl === tileId) hit = true;
      if (moment === "exit" && prevFluid === tileId) hit = true;
      prevFluid = fl;
    }
    if (moment === "ambient" && rt.map.at(at.tx, at.ty)?.id === tileId) hit = true;
  }
  return hit;
}

describe("every tile × every moment it offers: the default stage raises it", () => {
  for (const tile of TILES) {
    for (const m of tileMoments(content, tile)) {
      it(`${tile.id} · ${m.key}`, () => {
        const stage = stageFor(VFX.stages, tile, m.key);
        expect(stage, `no stage previews ${m.key}`).toBeDefined();
        expect(raises(stage!, { kind: "tile", def: tile }, m.key)).toBe(true);
      });
    }
  }
  it("the placed Spring item · bounce", () => {
    const spring = (itemsJson as ItemDef[]).find((i) => i.placeType === "spring")!;
    for (const m of itemMoments(spring)) {
      const stage = stageFor(VFX.stages, spring, m.key)!;
      expect(raises(stage, { kind: "item", def: spring }, m.key)).toBe(true);
    }
  });
});

describe("a broken stage is refused", () => {
  const wall = TILES.find((t) => t.id === "wall")!;
  it("no @", () => {
    expect(buildStage(content, { id: "x", name: "x", rows: ["#..#", "####"] }, { kind: "tile", def: wall }, "ambient").errors).toContain("No @ — mark where the tile goes.");
  });
  it("a player moment with no P", () => {
    expect(buildStage(content, { id: "x", name: "x", rows: ["#.@#", "####"] }, { kind: "tile", def: wall }, "land").errors)
      .toContain("This moment needs the player — paint a P.");
  });
  it("a stage that never triggers its moment doesn't pass the run check", () => {
    const spring = TILES.find((t) => t.id === "spring")!;
    // Player off to the side: never falls onto the pad.
    const stage = { id: "x", name: "x", seconds: 2, rows: ["#P......#", "#.......#", "#######@#"] };
    expect(raises(stage, { kind: "tile", def: spring }, "bounce")).toBe(false);
  });
});

describe("worst-case screen count (the meter's real-room estimate)", () => {
  it("finds the densest screen", () => {
    const rooms = { a: { id: "a", tiles: ["VV..", "V...", "...."] }, b: { id: "b", tiles: ["V"] } } as never;
    expect(worstScreenCount({ rooms }, "V", 2, 2)).toEqual({ count: 3, roomId: "a" });
  });
});
