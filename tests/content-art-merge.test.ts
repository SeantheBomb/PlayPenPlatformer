// Art fields are optional data, not schema — assemble()'s backfill against the
// bundled content must never resurrect one a draft/publish removed (Sean,
// 2026-11-04: dropping a 1-frame .aseprite on the 2-frame player "didn't
// upload" because the deleted spriteFrames came back from bundled game.json).
import { describe, expect, it } from "vitest";
import { assembleContent } from "../src/data/content";
import bundledGame from "../content/game.json";
import bundledTiles from "../content/tiles.json";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("assemble never backfills art fields", () => {
  it("an animated player replaced by one still image stays a still", () => {
    const game = clone(bundledGame) as any;
    game.player.spriteFrames = ["data:image/png;base64,a", "data:image/png;base64,b"];
    game.player.spriteFps = 2;
    // the draft: one frame, animation fields removed
    const draft = clone(game);
    delete draft.player.spriteFrames;
    delete draft.player.spriteFps;
    draft.player.sprite = "data:image/png;base64,new";
    const c = assembleContent({ "game.json": draft });
    expect(c.game.player.sprite).toBe("data:image/png;base64,new");
    expect(c.game.player.spriteFrames).toBeUndefined();
    expect(c.game.player.spriteFps).toBeUndefined();
  });

  it("reverting to the built-in look removes the art even if bundled content has some", () => {
    const draft = clone(bundledGame) as any;
    delete draft.player.sprite;
    delete draft.player.spriteFrames;
    delete draft.player.spriteFps;
    const c = assembleContent({ "game.json": draft });
    expect(c.game.player.sprite).toBeUndefined();
    expect(c.game.player.spriteFrames).toBeUndefined();
  });

  it("a cleared Warden face stays cleared", () => {
    const draft = clone(bundledGame) as any;
    draft.antagonist.portraits = { smug: "data:image/png;base64,s" };
    const c = assembleContent({ "game.json": draft });
    expect(c.game.antagonist.portraits).toEqual({ smug: "data:image/png;base64,s" });
  });

  it("id-keyed entries: a tile's removed art isn't refilled, gameplay fields still are", () => {
    const tiles = clone(bundledTiles) as any[];
    const wall = tiles.find((t) => t.id === "wall");
    delete wall.sprite;
    delete wall.spriteFrames;
    delete wall.solid; // a stale save missing a schema field
    const c = assembleContent({ "tiles.json": tiles });
    const out = c.tiles.find((t) => t.id === "wall")!;
    const bundledWall = (bundledTiles as any[]).find((t) => t.id === "wall");
    expect(out.sprite).toBeUndefined();
    expect(out.spriteFrames).toBeUndefined();
    expect(out.solid).toBe(bundledWall.solid); // schema backfill still works
  });

  it("schema backfill for non-art game.json fields is unchanged", () => {
    const draft = clone(bundledGame) as any;
    delete draft.player.runSpeed;
    const c = assembleContent({ "game.json": draft });
    expect(c.game.player.runSpeed).toBe((bundledGame as any).player.runSpeed);
  });
});
