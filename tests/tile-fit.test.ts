// A body exactly one tile tall/wide must fit a one-tile passage (2026-11-04:
// the 12×16 art-sized player got stuck at the vault's swim-under tunnel
// because resting eps-above the floor read as touching the ceiling).
import { describe, expect, it } from "vitest";
import { TileMap } from "../src/engine/tilemap";
import type { RoomDef, TileDef } from "../src/data/types";

const wall = { id: "wall", char: "#", name: "Wall", style: "block", color: "#000", solid: true } as TileDef;
const room = (tiles: string[]) => ({ id: "t", width: tiles[0].length, height: tiles.length, background: "#000", tiles, entities: [] }) as RoomDef;

/** Settle a body onto the floor, then push it sideways for a while. */
function walk(map: TileMap, x: number, y: number, w: number, h: number, vx: number) {
  let s = { x, y, vx: 0, vy: 200 };
  for (let i = 0; i < 30; i++) { const r = map.move(s.x, s.y, w, h, 0, s.vy, 1 / 60); s = { ...s, x: r.x, y: r.y }; }
  for (let i = 0; i < 120; i++) { const r = map.move(s.x, s.y, w, h, vx, 200, 1 / 60); s = { ...s, x: r.x, y: r.y }; }
  return s;
}

describe("exact-fit passages", () => {
  // a 1-tile-tall tunnel from x=2 onward (ceiling row 1, floor row 3)
  const tunnel = new TileMap(room([
    "########",
    "##.#####",
    "........",
    "########",
  ]), [wall]);

  it("a 16px-tall body walks through a 16px-tall tunnel", () => {
    const end = walk(tunnel, 32, 20, 12, 16, 120);
    expect(end.x).toBeGreaterThan(5 * 16);
  });

  it("…and a 17px-tall one still can't", () => {
    const end = walk(tunnel, 32, 10, 12, 17, 120);
    expect(end.x).toBeLessThan(3 * 16);
  });

  it("a 16px-wide body drops down a 16px-wide shaft after pressing against its wall", () => {
    const shaft = new TileMap(room([
      "#..#",
      "#..#",
      "##.#",
      "##.#",
      "##.#",
      "####",
    ]), [wall]);
    let s = { x: 20, y: 0 };
    // press right against the wall first (parks x eps short of it)
    for (let i = 0; i < 60; i++) { const r = shaft.move(s.x, s.y, 16, 16, 200, 0, 1 / 60); s = { x: r.x, y: r.y }; }
    for (let i = 0; i < 120; i++) { const r = shaft.move(s.x, s.y, 16, 16, 0, 300, 1 / 60); s = { x: r.x, y: r.y }; }
    expect(s.y).toBeGreaterThan(3 * 16);
  });
});
