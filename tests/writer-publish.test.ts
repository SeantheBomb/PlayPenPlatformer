// Story-scoped publish design requirements (Sean, 2026-09-30): the writer
// password may change what the game SAYS — dialog, taunts, notes, hints,
// descriptions — and each NPC's quest structure (what they want, give,
// teach, and who they wait for). Nothing else. overlayStoryBundle is the
// server-side boundary — run `npm test` before shipping any change to
// functions/api/_writerscope.js or the writer branch in content.js.
import { describe, expect, it } from "vitest";
import { overlayStoryBundle } from "../functions/api/_writerscope.js";

function liveBundle() {
  return {
    "rooms/cell.json": {
      id: "cell", name: "Cell", width: 8, height: 4, background: "#111",
      tiles: ["########", "#......#", "#......#", "########"],
      entities: [
        {
          type: "npc", npcId: "marla", name: "Marla", x: 1, y: 2, avatar: "blocky", color: "#8bd44f",
          sprite: "data:image/png;base64,body",
          dialogAsk: "Dibs on the corner.", wants: { item: "glow_mushroom", count: 1 },
          rewardRecipes: ["recipe_smoke_bomb"],
        },
        { type: "npc", x: 5, y: 2, name: "Nobody" }, // no npcId -> untouchable
        { type: "note", x: 3, y: 2, text: "old note", recipe: "recipe_torch" },
        { type: "hint", x: 6, y: 2, text: "old hint" },
        { type: "pickup", item: "torch", x: 2, y: 2 },
      ],
    },
    "taunts.json": [
      { id: "welcome", trigger: "game_start", lines: ["Hello."], cooldownMs: 0, chance: 1, emotion: "smug" },
      { id: "yard", trigger: "room_enter", roomId: "the_yard", lines: ["Careful."], cooldownMs: 0, chance: 1 },
    ],
    "achievements.json": [
      { id: "a1", name: "Old", description: "old", hidden: true, trigger: "craft_item", itemId: "torch", wardenLine: "meh", emotion: "bored" },
    ],
    "items.json": [{ id: "torch", name: "Torch", color: "#fa0", description: "old desc", element: "wood" }],
    "recipes.json": [{ id: "recipe_torch", inputs: ["plank", "cloth"], output: "torch", flavor: "old flavor" }],
    "tiles.json": [{ id: "wall", char: "#", solid: true }],
    "game.json": { player: { runSpeed: 150 }, antagonist: { name: "The Warden", color: "#f57" } },
  };
}

describe("overlayStoryBundle", () => {
  it("takes dialog and quest structure from the writer, per NPC by npcId", () => {
    const writer = {
      "rooms/cell.json": {
        id: "cell", tiles: ["ZZ"], // stale/mangled geometry — ignored
        entities: [{
          type: "npc", npcId: "marla", name: "XxMARLAxX", x: 99, y: 99, color: "#f00",
          sprite: "data:image/png;base64,HACK",
          dialogAsk: "Dibs. On EVERYTHING.", dialogAfter: "Told you.",
          wants: { item: "cog", count: 2 }, rewardItems: [{ item: "spring", count: 1 }],
          requiresHelped: ["toby"],
        }],
      },
    };
    const out = overlayStoryBundle(liveBundle(), writer) as any;
    const room = out["rooms/cell.json"];
    expect(room.tiles).toEqual(["########", "#......#", "#......#", "########"]);
    const marla = room.entities.find((e: any) => e.npcId === "marla");
    expect(marla.name).toBe("XxMARLAxX");
    expect(marla.dialogAsk).toBe("Dibs. On EVERYTHING.");
    expect(marla.dialogAfter).toBe("Told you.");
    expect(marla.wants).toEqual({ item: "cog", count: 2 });
    expect(marla.rewardItems).toEqual([{ item: "spring", count: 1 }]);
    expect(marla.requiresHelped).toEqual(["toby"]);
    // Level data and art stay live's.
    expect(marla.x).toBe(1);
    expect(marla.y).toBe(2);
    expect(marla.color).toBe("#8bd44f");
    expect(marla.sprite).toBe("data:image/png;base64,body");
  });

  it("clearing a quest publishes: fields absent on the writer's copy are removed", () => {
    const writer = {
      "rooms/cell.json": { id: "cell", entities: [{ type: "npc", npcId: "marla", name: "Marla", dialogAsk: "Just chatting." }] },
    };
    const marla = (overlayStoryBundle(liveBundle(), writer) as any)["rooms/cell.json"].entities[0];
    expect(marla.wants).toBeUndefined();
    expect(marla.rewardRecipes).toBeUndefined();
    expect(marla.dialogAsk).toBe("Just chatting.");
  });

  it("an NPC without an npcId is untouchable, and a writer can't add or remove entities", () => {
    const writer = {
      "rooms/cell.json": {
        id: "cell",
        entities: [
          { type: "npc", x: 5, y: 2, name: "Renamed" },                       // no npcId
          { type: "npc", npcId: "newguy", name: "New", x: 4, y: 2, dialogAsk: "hi" }, // not in live
        ],
      },
    };
    const room = (overlayStoryBundle(liveBundle(), writer) as any)["rooms/cell.json"];
    expect(room.entities).toHaveLength(5);
    expect(room.entities.find((e: any) => e.name === "Nobody")).toBeDefined();
    expect(room.entities.some((e: any) => e.npcId === "newguy")).toBe(false);
  });

  it("notes and hints match by position and take only their text", () => {
    const writer = {
      "rooms/cell.json": {
        id: "cell",
        entities: [
          { type: "note", x: 3, y: 2, text: "new note", recipe: "recipe_hammer", item: "smuggled" },
          { type: "hint", x: 6, y: 2, text: "new hint", recipe: "nope" },
          { type: "note", x: 7, y: 1, text: "moved note" }, // no note here in live -> dropped
        ],
      },
    };
    const room = (overlayStoryBundle(liveBundle(), writer) as any)["rooms/cell.json"];
    const note = room.entities.find((e: any) => e.type === "note");
    expect(note.text).toBe("new note");
    expect(note.recipe).toBe("recipe_hammer");
    expect(note.item).toBeUndefined();
    const hint = room.entities.find((e: any) => e.type === "hint");
    expect(hint.text).toBe("new hint");
    expect(hint.recipe).toBeUndefined();
    expect(room.entities.filter((e: any) => e.type === "note")).toHaveLength(1);
  });

  it("taunts: lines/emotion/cooldown/chance per id; trigger and filters stay live's", () => {
    const writer = {
      "taunts.json": [
        { id: "welcome", trigger: "win", lines: ["Good morning, Subject #67."], emotion: "gleeful", cooldownMs: 500, chance: 0.5 },
        { id: "yard", trigger: "room_enter", roomId: "vents", lines: ["Playground time!"] },
        { id: "evil", trigger: "death", lines: ["injected"] },
      ],
    };
    const out = (overlayStoryBundle(liveBundle(), writer) as any)["taunts.json"];
    expect(out).toHaveLength(2);
    const welcome = out.find((t: any) => t.id === "welcome");
    expect(welcome.lines).toEqual(["Good morning, Subject #67."]);
    expect(welcome.emotion).toBe("gleeful");
    expect(welcome.cooldownMs).toBe(500);
    expect(welcome.chance).toBe(0.5);
    expect(welcome.trigger).toBe("game_start"); // never the writer's
    const yard = out.find((t: any) => t.id === "yard");
    expect(yard.roomId).toBe("the_yard");
  });

  it("achievements, item descriptions and recipe flavor are writer-owned text", () => {
    const writer = {
      "achievements.json": [{ id: "a1", name: "Best Friend", description: "Craft the sock puppet.", wardenLine: "You made HIM.", emotion: "proud", hidden: false, trigger: "win" }],
      "items.json": [{ id: "torch", description: "Fire on a stick.", element: "fire", color: "#000" }],
      "recipes.json": [{ id: "recipe_torch", flavor: "Wood + cloth. Peak engineering.", output: "hammer" }],
    };
    const out = overlayStoryBundle(liveBundle(), writer) as any;
    const a = out["achievements.json"][0];
    expect(a.name).toBe("Best Friend");
    expect(a.wardenLine).toBe("You made HIM.");
    expect(a.emotion).toBe("proud");
    expect(a.hidden).toBe(true);          // still live's
    expect(a.trigger).toBe("craft_item");
    expect(out["items.json"][0].description).toBe("Fire on a stick.");
    expect(out["items.json"][0].element).toBe("wood");
    expect(out["recipes.json"][0].flavor).toBe("Wood + cloth. Peak engineering.");
    expect(out["recipes.json"][0].output).toBe("torch");
  });

  it("never touches game.json, tiles, or any file outside the story set, and can't add files", () => {
    const writer = {
      "game.json": { player: { runSpeed: 9999 }, antagonist: { name: "Steve" } },
      "tiles.json": [{ id: "wall", solid: false }],
      "layers.json": { sets: {} },
      "hacked.json": { anything: true },
    };
    const live = liveBundle();
    const out = overlayStoryBundle(live, writer) as any;
    expect(out["game.json"]).toEqual(live["game.json"]);
    expect(out["tiles.json"]).toEqual(live["tiles.json"]);
    expect(out["layers.json"]).toBeUndefined();
    expect(out["hacked.json"]).toBeUndefined();
  });

  it("passes files the writer bundle lacks through untouched", () => {
    const live = liveBundle();
    const out = overlayStoryBundle(live, {}) as any;
    expect(out).toEqual(live);
  });
});
