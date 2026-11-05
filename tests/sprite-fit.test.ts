// Characters/enemies/Warden/objects are drawn at the ART's own size, and the
// collision box can follow the art (Sean, 2026-11-04: "the collision box
// should match the artwork, not the other way around").
import { describe, expect, it } from "vitest";
import { spriteContentSize, spriteRect } from "../src/engine/renderer";
import { playerHitbox } from "../src/game/player";
import { overlayArtBundle } from "../functions/api/_artscope.js";
import bundledGame from "../content/game.json";

describe("spriteRect", () => {
  it("fill stretches to the box exactly (tiles, items, portraits)", () => {
    expect(spriteRect(32, 32, 10, 20, 12, 14, { fit: "fill" })).toEqual({ x: 10, y: 20, w: 12, h: 14 });
  });

  it("natural draws 1 art px = 1 game px, content standing on the box's floor, centered", () => {
    // Casey's player: 32×32 canvas, visible part 23×31 at (4,1); 12×14 box at (100,200)
    const r = spriteRect(32, 32, 100, 200, 12, 14, { fit: "natural", bounds: [4, 1, 23, 31] });
    expect(r.w).toBe(32);
    expect(r.h).toBe(32);
    // content bottom (1+31=32 art px) on the box floor (214)
    expect(r.y + 32).toBe(214);
    // content center (4 + 11.5 = 15.5) on the box center (106)
    expect(r.x + 15.5).toBe(106);
  });

  it("art scale shrinks it: scale 2 = half size, still on the floor", () => {
    const r = spriteRect(32, 32, 0, 0, 12, 14, { fit: "natural", scale: 2, bounds: [4, 1, 23, 31] });
    expect(r.w).toBe(16);
    expect(r.y + r.h).toBe(14);
  });

  it("without bounds the whole canvas stands on the floor", () => {
    const r = spriteRect(20, 10, 0, 0, 12, 14, { fit: "natural" });
    expect(r).toEqual({ x: -4, y: 4, w: 20, h: 10 });
  });

  it("squash & stretch scales about the feet", () => {
    const r = spriteRect(16, 16, 0, 0, 16, 16, { fit: "natural", sx: 1.25, sy: 0.75 });
    expect(r.w).toBe(20);
    expect(r.h).toBe(12);
    expect(r.y + r.h).toBe(16);
    expect(r.x + r.w / 2).toBe(8);
  });
});

describe("player hitbox", () => {
  const base = JSON.parse(JSON.stringify(bundledGame.player));

  it("uses width/height unless told to follow the art", () => {
    expect(playerHitbox({ ...base, hitboxFromArt: false, spriteBounds: [4, 1, 23, 31] })).toEqual({ w: base.width, h: base.height });
  });

  it("follows the art's visible size when switched on", () => {
    expect(playerHitbox({ ...base, hitboxFromArt: true, spriteBounds: [4, 1, 23, 31] })).toEqual({ w: 23, h: 31 });
  });

  it("…divided by the art scale", () => {
    expect(playerHitbox({ ...base, hitboxFromArt: true, spriteBounds: [4, 1, 23, 31], spriteScale: 2 })).toEqual({ w: 12, h: 16 });
  });

  it("falls back to width/height when the art has no measured bounds", () => {
    const cfg = { ...base, hitboxFromArt: true };
    delete cfg.spriteBounds;
    expect(playerHitbox(cfg)).toEqual({ w: base.width, h: base.height });
  });

  it("spriteContentSize rounds to whole pixels", () => {
    expect(spriteContentSize({ spriteBounds: [0, 0, 23, 31], spriteScale: 3 })).toEqual({ w: 8, h: 10 });
  });
});

describe("art scale/bounds are artist-publishable, the hitbox switch is not", () => {
  it("overlay takes spriteScale + spriteBounds, never hitboxFromArt or width", () => {
    const live = { "game.json": { player: { width: 12, height: 14, hitboxFromArt: false } } };
    const artist = { "game.json": { player: { width: 99, hitboxFromArt: true, sprite: "data:x", spriteScale: 2, spriteBounds: [0, 0, 8, 8] } } };
    const p = (overlayArtBundle(live, artist) as any)["game.json"].player;
    expect(p).toMatchObject({ width: 12, hitboxFromArt: false, spriteScale: 2, spriteBounds: [0, 0, 8, 8] });
  });
});
