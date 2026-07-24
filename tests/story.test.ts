// Story-engine design requirements: run-reactive NPC presence.
// Constructs return in later rooms ONLY if the player completed their quest
// earlier — and the story adapts silently (no gap, no lampshade) when not.
import { describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/game/room";
import type { Content, RoomDef } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import gameJson from "../content/game.json";
import tilesJson from "../content/tiles.json";
import exitWing from "../content/rooms/exit_wing.json";
import greenhouse from "../content/rooms/greenhouse.json";

function makeContent(): Content {
  return {
    game: gameJson as unknown as Content["game"],
    elements: [], rules: [], achievements: [],
    tiles: tilesJson as Content["tiles"],
    items: [], recipes: [], enemies: [], taunts: [],
    campaign: { rooms: [] }, rooms: {},
  } as unknown as Content;
}
function makeMuts(): RoomMutations {
  return {
    collected: new Set(), tileOverrides: [], openedDoors: new Set(),
    helpedNpcs: new Set(), disabledEnemies: new Set(), bundles: [],
    placedItems: [], brazierLit: [],
  };
}
const npcNames = (rt: RoomRuntime) =>
  rt.entities.filter((e) => e.kind === "npc").map((e) => e.def.name).sort();

describe("run-reactive NPC presence", () => {
  it("Exit Wing send-off scales to exactly the constructs you helped", () => {
    const room = exitWing as unknown as RoomDef;
    // Helped no one: no gathering at all.
    const none = new RoomRuntime(room, makeContent(), makeMuts(), new Set());
    expect(npcNames(none)).toEqual([]);
    // Helped two: exactly those two see you off.
    const two = new RoomRuntime(
      room, makeContent(), makeMuts(), new Set(["marla", "deb"])
    );
    expect(npcNames(two)).toEqual(["DEBUG.DEB", "XxMARLAxX"]);
    // Helped all five: the full cast gathers.
    const all = new RoomRuntime(
      room, makeContent(), makeMuts(),
      new Set(["marla", "toby", "priya", "marcus", "deb"])
    );
    expect(npcNames(all)).toEqual(
      ["DEBUG.DEB", "MVP_MARCUS", "PATCHNURSE", "TOBY.EXE", "XxMARLAxX"]
    );
  });

  it("pair scenes need BOTH friendships earned — one alone isn't enough", () => {
    const room = greenhouse as unknown as RoomDef;
    const base = npcNames(
      new RoomRuntime(room, makeContent(), makeMuts(), new Set())
    );
    // Only Marla helped: the Marla+Toby scene must NOT appear.
    const onlyMarla = npcNames(
      new RoomRuntime(room, makeContent(), makeMuts(), new Set(["marla"]))
    );
    expect(onlyMarla).toEqual(base);
    // Both helped: the pair shows up (one extra Marla + one extra Toby).
    const both = npcNames(
      new RoomRuntime(room, makeContent(), makeMuts(), new Set(["marla", "toby"]))
    );
    expect(both.length).toBe(base.length + 2);
    expect(both).toContain("TOBY.EXE");
  });

  it("editor/tests default (no flag set) hides conditional scenes, shows quests", () => {
    const room = greenhouse as unknown as RoomDef;
    const rt = new RoomRuntime(room, makeContent(), makeMuts());
    // Priya's quest is unconditional; the pair scene is not.
    expect(npcNames(rt)).toEqual(["PATCHNURSE"]);
  });
});
