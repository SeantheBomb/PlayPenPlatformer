// Art-scoped publish design requirements (Sean, 2026-08-12): the artist
// password may change how things LOOK and nothing else. overlayArtBundle is
// the server-side scope boundary — run `npm test` before shipping any change
// to functions/api/_artscope.js or the artist branch in content.js.
import { describe, expect, it } from "vitest";
import { overlayArtBundle } from "../functions/api/_artscope.js";

const px = (n: string) => `data:image/png;base64,${n}`;

function liveBundle() {
  return {
    "tiles.json": [
      { id: "wall", char: "#", solid: true, damage: undefined, color: "#333" },
      { id: "spikes", char: "^", damage: 1, color: "#c00", sprite: px("old-spikes") },
    ],
    "items.json": [{ id: "torch", name: "Torch", color: "#fa0" }],
    "enemies.json": [{ id: "spotter", speed: 55, color: "#59e" }],
    "entities.json": [{ id: "door", width: 16, height: 32 }],
    "recipes.json": [{ id: "r1", output: "torch" }],
    "game.json": {
      player: { width: 12, height: 14, runSpeed: 150, sprite: px("old-player") },
      antagonist: { name: "The Warden", color: "#ff5470" },
      rules: { stunDurationMs: 3000 },
    },
    "rooms/cell.json": {
      id: "cell", tiles: ["##", "##"],
      entities: [
        { type: "npc", npcId: "marla", x: 1, y: 1, name: "Marla" },
        { type: "pickup", item: "torch", x: 2, y: 1 },
      ],
    },
  };
}

describe("overlayArtBundle scope", () => {
  it("takes sprite fields per id-entry and NOTHING else", () => {
    const artist = {
      "tiles.json": [
        // artist's copy has stale gameplay values — they must not win
        { id: "wall", char: "#", solid: false, damage: 99, sprite: px("wall-art") },
      ],
    };
    const out = overlayArtBundle(liveBundle(), artist) as any;
    const wall = out["tiles.json"].find((t: any) => t.id === "wall");
    expect(wall.sprite).toBe(px("wall-art"));
    expect(wall.solid).toBe(true); // live gameplay value survives
    expect(wall.damage).toBeUndefined();
  });

  it("an artist entry WITHOUT a sprite reverts that entry to procedural", () => {
    const artist = { "tiles.json": [{ id: "spikes" }] };
    const out = overlayArtBundle(liveBundle(), artist) as any;
    const spikes = out["tiles.json"].find((t: any) => t.id === "spikes");
    expect(spikes.sprite).toBeUndefined();
    expect(spikes.damage).toBe(1); // gameplay untouched
  });

  it("entries the artist didn't send pass through untouched", () => {
    const artist = { "tiles.json": [{ id: "wall", sprite: px("wall-art") }] };
    const out = overlayArtBundle(liveBundle(), artist) as any;
    const spikes = out["tiles.json"].find((t: any) => t.id === "spikes");
    expect(spikes.sprite).toBe(px("old-spikes"));
  });

  it("game.json: player/antagonist art fields only; rules and tuning survive", () => {
    const artist = {
      "game.json": {
        player: { runSpeed: 999, sprite: px("new-player"), spriteFrames: [px("f1"), px("f2")], spriteFps: 8 },
        antagonist: { color: "#000", sprite: px("warden"), portraits: { smug: px("smug") } },
      },
    };
    const out = overlayArtBundle(liveBundle(), artist) as any;
    expect(out["game.json"].player.sprite).toBe(px("new-player"));
    expect(out["game.json"].player.spriteFrames).toEqual([px("f1"), px("f2")]);
    expect(out["game.json"].player.runSpeed).toBe(150); // not 999
    expect(out["game.json"].antagonist.portraits.smug).toBe(px("smug"));
    expect(out["game.json"].antagonist.color).toBe("#ff5470"); // not #000
    expect(out["game.json"].rules.stunDurationMs).toBe(3000);
  });

  it("rooms: entities matched by npcId only; positions/gameplay survive", () => {
    const artist = {
      "rooms/cell.json": {
        id: "cell", tiles: ["XX"], // stale/mangled level data — ignored
        entities: [
          { type: "npc", npcId: "marla", x: 55, y: 55, sprite: px("marla"), portrait: px("marla-face") },
          { type: "pickup", item: "torch", x: 9, y: 9, sprite: px("nope") }, // no npcId -> ignored
        ],
      },
    };
    const out = overlayArtBundle(liveBundle(), artist) as any;
    const room = out["rooms/cell.json"];
    expect(room.tiles).toEqual(["##", "##"]); // level geometry untouched
    const marla = room.entities.find((e: any) => e.npcId === "marla");
    expect(marla.sprite).toBe(px("marla"));
    expect(marla.portrait).toBe(px("marla-face"));
    expect(marla.x).toBe(1); // live position wins
    const pickup = room.entities.find((e: any) => e.type === "pickup");
    expect(pickup.sprite).toBeUndefined();
    expect(pickup.x).toBe(2);
  });

  it("non-art files (recipes, rules, …) are never artist-writable", () => {
    const artist = { "recipes.json": [{ id: "r1", output: "hammer" }, { id: "evil", output: "x" }] };
    const out = overlayArtBundle(liveBundle(), artist) as any;
    expect(out["recipes.json"]).toEqual([{ id: "r1", output: "torch" }]);
  });

  it("an artist bundle can't introduce new files or new defs", () => {
    const artist = {
      "hacked.json": { anything: true },
      "tiles.json": [{ id: "brand_new_tile", char: "Z", solid: true }],
    };
    const out = overlayArtBundle(liveBundle(), artist) as any;
    expect(out["hacked.json"]).toBeUndefined();
    expect(out["tiles.json"].some((t: any) => t.id === "brand_new_tile")).toBe(false);
  });
});
