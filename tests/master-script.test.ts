// Master Script design requirements (Lorne's ask via Sean, 2026-10-22): one
// linear, screenplay-style view of every scripted story beat in campaign
// order, that maps straight back to the game's events and survives campaign
// changes (shuffled levels, moved / removed residents) without throwing out
// the writer's work. The model is src/studio/script.ts; these pin its
// contract so the page can't drift from the game's own rules.
import { describe, expect, it } from "vitest";
import { assembleContent } from "../src/data/content";
import type { Content, RoomDef, RoomEntity, TauntDef } from "../src/data/types";
import {
  allLineBeats, buildScript, continuityFlags, diffSignature, presentOnRun, signatureOf, type Beat,
} from "../src/studio/script";
import { overlayStoryBundle } from "../functions/api/_writerscope.js";
import { mergeBundles } from "../functions/api/_merge.js";

const room = (id: string, name: string, entities: RoomEntity[]): RoomDef =>
  ({ id, name, width: 40, height: 10, background: "#111", tiles: [], entities } as unknown as RoomDef);
const npc = (o: Partial<RoomEntity>): RoomEntity => ({ type: "npc", x: 5, y: 8, ...o } as RoomEntity);
const taunt = (id: string, trigger: TauntDef["trigger"], line: string, o: Partial<TauntDef> = {}): TauntDef =>
  ({ id, trigger, lines: [line], cooldownMs: 0, chance: 1, ...o });

function fixture(order = ["a", "b", "c"]): Content {
  const rooms: Record<string, RoomDef> = {
    a: room("a", "Lost and Found", [
      { type: "note", x: 2, y: 8, text: "— Subject #22.", recipe: "r_bucket" } as RoomEntity,
      npc({ npcId: "marla", name: "Marla", x: 9, dialogAsk: "Find me in the Bunk Room.", dialogAfter: "Pile stays." }),
    ]),
    b: room("b", "The Bunk Room", [
      npc({ npcId: "marla", name: "Marla", x: 8, wants: { item: "mushroom", count: 1 }, rewardRecipes: ["r_smoke"],
        dialogAsk: "Crack it out.", dialogConfirm: "THE MUSHROOM.", dialogDone: "Spores in a sock.", dialogAfter: "Dibs." }),
    ]),
    c: room("c", "The Field Trip", [
      npc({ npcId: "toby", name: "Toby", x: 4, wants: { item: "spring", count: 1 }, dialogAsk: "BOING.", dialogConfirm: "?", dialogDone: "!", dialogAfter: "." }),
      npc({ npcId: "marla", name: "Marla", x: 20, requiresHelped: ["marla", "toby"], dialogAsk: "Guild." }),
      npc({ npcId: "toby", name: "Toby", x: 22, requiresHelped: ["marla", "toby"], dialogAsk: "THREE THINGS." }),
      npc({ npcId: "marla", name: "Marla", x: 30, requiresHelped: ["marla"], dialogAsk: "Dibs on the door." }),
    ]),
  };
  return {
    campaign: { rooms: order },
    rooms,
    taunts: [
      taunt("welcome", "game_start", "Rise and shine."),
      taunt("confiscate", "confiscate", "Mine now."),
      taunt("npc_help", "npc_help", "Fraternizing."),
      taunt("room_a", "room_enter", "Stay put.", { roomId: "a" }),
      taunt("room_b", "room_enter", "Bunks.", { roomId: "b" }),
      taunt("gone", "room_enter", "Deleted.", { roomId: "c", removed: true }),
      taunt("win", "win", "Out."),
    ],
    items: [{ id: "mushroom", name: "Glow Mushroom" }, { id: "spring", name: "Spring" }, { id: "bucket", name: "Bucket" }, { id: "smoke", name: "Smoke Bomb" }],
    recipes: [{ id: "r_bucket", inputs: [], output: "bucket" }, { id: "r_smoke", inputs: [], output: "smoke" }],
  } as unknown as Content;
}

const keysOf = (bs: Beat[]) => bs.flatMap((b) => [b.key, ...(b.columns ?? []).flatMap((c) => keysOf(c.beats))]).filter(Boolean);
const textOf = (bs: Beat[]) => bs.map((b) => b.text ?? "").join("\n");

describe("Master Script model", () => {
  it("follows the campaign order, with the welcome in whichever level is first", () => {
    const m = buildScript(fixture(["b", "a", "c"]));
    expect(m.scenes.map((s) => s.roomId)).toEqual(["b", "a", "c"]);
    expect(keysOf(m.scenes[0].beats)).toContain("taunt:welcome");
    expect(keysOf(m.scenes[1].beats)).not.toContain("taunt:welcome");
    expect(keysOf(m.scenes[1].beats)).toContain("taunt:confiscate");
    expect(keysOf(m.ending)).toEqual(["taunt:win"]);
  });

  it("keys lines by game event, so reordering never changes them", () => {
    const a = buildScript(fixture(["a", "b", "c"]));
    const b = buildScript(fixture(["c", "a", "b"]));
    const keys = (m: ReturnType<typeof buildScript>) => new Set(allLineBeats(m).map((x) => x.key));
    expect(keys(b)).toEqual(keys(a));
    expect(a.lineKeys.has("npc:b:marla:dialogDone")).toBe(true);
    expect(a.lineKeys.has("note:a@2,8")).toBe(true);
  });

  it("removed taunts never appear; a room without an entry line says so", () => {
    const m = buildScript(fixture());
    expect(keysOf(m.scenes[2].beats)).not.toContain("taunt:gone");
    expect(textOf(m.scenes[2].beats)).toMatch(/no line for entering this room/);
  });

  it("a talk-only resident never reaches 'after' (the game can't help them)", () => {
    const m = buildScript(fixture());
    const a = m.scenes[0].beats;
    expect(keysOf(a)).toContain("npc:a:marla:dialogAsk");
    expect(keysOf(a)).not.toContain("npc:a:marla:dialogAfter");
    expect(textOf(a)).toMatch(/never plays here/);
  });

  it("a quest lays out ask → has it → keeps-it stub → done → recipe → help taunt → after", () => {
    const keys = keysOf(buildScript(fixture()).scenes[1].beats);
    expect(keys).toEqual([
      "taunt:confiscate", "taunt:room_b",
      "npc:b:marla:dialogAsk", "npc:b:marla:dialogConfirm", "npc:b:marla:dialogDone", "taunt:npc_help", "npc:b:marla:dialogAfter",
    ]);
    expect(textOf(buildScript(fixture()).scenes[1].beats)).toMatch(/learns to make: Smoke Bomb/);
  });

  it("every branch: a pair scene is a branch block; a single-helped gate is an IF-HELPED / IF-NOT alternate", () => {
    const c = buildScript(fixture()).scenes[2].beats;
    const head = c.find((b) => b.branchHead)!;
    expect(head.branchHead).toBe("Only on some runs");
    expect(head.text).toMatch(/helped Marla and Toby/);
    const alt = c.find((b) => b.kind === "alt")!;
    expect(alt.columns!.map((x) => x.label)).toEqual(["IF #67 HELPED Marla", "IF NOT"]);
    expect(keysOf(alt.columns![0].beats)).toEqual(["npc:c:marla#2:dialogAsk"]);
    expect(alt.columns![1].empty).toMatch(/no not-helped version/);
  });

  it("reading one run collapses what doesn't happen and keeps what does", () => {
    const nobody = buildScript(fixture(), new Set());
    const c = nobody.scenes[2].beats;
    expect(c.filter((b) => b.kind === "skip")).toHaveLength(2);
    expect(keysOf(c)).not.toContain("npc:c:marla#1:dialogAsk");
    // Not helped: the quest stops at the choice.
    expect(keysOf(nobody.scenes[1].beats)).not.toContain("npc:b:marla:dialogDone");
    expect(nobody.threads).toEqual([]);
    const both = buildScript(fixture(), new Set(["marla", "toby"]));
    expect(keysOf(both.scenes[2].beats)).toEqual(expect.arrayContaining(["npc:c:marla#1:dialogAsk", "npc:c:marla#2:dialogAsk"]));
  });

  it("threads run from the hand-over to every beat gated on it", () => {
    const m = buildScript(fixture());
    const marla = m.threads.find((t) => t.npcId === "marla")!;
    expect(marla.startKey).toBe("npc:b:marla:dialogDone");
    expect(marla.deps.map((d) => d.key)).toEqual(["npc:c:marla#1:dialogAsk", "npc:c:toby#2:dialogAsk", "npc:c:marla#2:dialogAsk"]);
    expect(marla.deps.every((d) => !d.early)).toBe(true);
  });

  it("a payoff moved before its setup is flagged — it can never play", () => {
    const m = buildScript(fixture(["c", "a", "b"]));
    const marla = m.threads.find((t) => t.npcId === "marla")!;
    expect(marla.deps.every((d) => d.early)).toBe(true);
    const pair = allLineBeats(m).find((b) => b.key === "npc:c:marla#1:dialogAsk")!;
    expect(pair.flags?.[0].text).toMatch(/can never play/);
  });

  it("tells the writer what moved since they last looked", () => {
    const before = signatureOf(buildScript(fixture(["a", "b", "c"])));
    const after = signatureOf(buildScript(fixture(["b", "a", "c"])));
    const d = diffSignature(before, after);
    expect(d.moved.map((x) => x.roomId).sort()).toEqual(["a", "b"]);
    expect(d.firstMeetMoved).toEqual([{ npcId: "marla", from: "a", to: "b" }]);
    expect(diffSignature(null, after).moved).toEqual([]);
    // "Find me in the Bunk Room" reads wrong once the Bunk Room comes first.
    const swapped = fixture(["b", "a", "c"]);
    expect(continuityFlags(swapped, "Find me in the Bunk Room.", "a", before)[0].text).toMatch(/now comes before/);
    expect(continuityFlags(fixture(), "Find me in the Bunk Room.", "a", before)).toEqual([]);
  });

  it("presentOnRun matches the room's own spawn gating", () => {
    const e = npc({ requiresHelped: ["a"], hiddenIfHelped: ["b"] });
    expect(presentOnRun(e, new Set(["a"]))).toBe(true);
    expect(presentOnRun(e, new Set(["a", "b"]))).toBe(false);
    expect(presentOnRun(e, new Set())).toBe(false);
  });

  it("builds the shipped campaign: every scene, unique keys, no thread can't-play flags", () => {
    const files: Record<string, unknown> = {};
    for (const [p, data] of Object.entries(import.meta.glob("../content/**/*.json", { eager: true, import: "default" }))) {
      files[p.replace(/^.*\/content\//, "")] = data;
    }
    const content = assembleContent(files);
    const m = buildScript(content);
    expect(m.scenes.map((s) => s.roomId)).toEqual(content.campaign.rooms.filter((r) => content.rooms[r]));
    const keys = allLineBeats(m).filter((b) => b.kind === "line").map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(allLineBeats(m).flatMap((b) => b.flags ?? [])).toEqual([]);
  });
});

describe("script.json publishing", () => {
  it("is writer-owned: a writer publish lands it, even before live has it", () => {
    const doc = { notes: { cell_block: "Pickaxe payoff?" }, lines: {} };
    const out = overlayStoryBundle({ "game.json": { a: 1 } }, { "game.json": { a: 2 }, "script.json": doc });
    expect(out["script.json"]).toEqual(doc);
    expect(out["game.json"]).toEqual({ a: 1 });
  });

  it("merges per key, so two people's notes both survive", () => {
    const base = { "script.json": { notes: {}, lines: {} } };
    const live = { "script.json": { notes: { a: "Sean's" }, lines: {} } };
    const mine = { "script.json": { notes: { b: "Lorne's" }, lines: {} } };
    expect((mergeBundles(base, live, mine)["script.json"] as { notes: object }).notes).toEqual({ a: "Sean's", b: "Lorne's" });
  });
});
