// Pins rebase-on-load for browser drafts (Sean, 2026-09-23): when someone
// else publishes and it doesn't conflict with the local draft, reloading
// shows their changes WITHOUT discarding the draft. Local edits win anything
// both sides touched.
import { describe, expect, it } from "vitest";
import { rebaseDraft } from "../src/data/content";

type Item = { id: string; color?: string };
const items = (files: Record<string, unknown>) => files["items.json"] as Item[];
const room = (id: string, map: string[]) => ({ id, name: id, map, entities: [] });

describe("rebaseDraft", () => {
  const base = {
    "rooms/vents.json": room("vents", ["....", "...."]),
    "items.json": [{ id: "torch", color: "#f80" }, { id: "bucket", color: "#08f" }],
  };

  it("pulls in another publisher's change to content the draft didn't touch", () => {
    const live = { ...base, "items.json": [{ id: "torch", color: "#ff0" }, { id: "bucket", color: "#08f" }] };
    const draft = { ...base, "rooms/vents.json": room("vents", ["##..", "...."]) };
    const r = rebaseDraft(base, live, draft);
    expect(items(r.files).find((e) => e.id === "torch")?.color).toBe("#ff0");   // theirs
    expect(r.files["rooms/vents.json"]).toEqual(draft["rooms/vents.json"]);   // mine
    expect(r.hasLocalChanges).toBe(true);
    expect(r.incoming.join("\n")).toContain("torch");
  });

  it("keeps the local edit when both sides changed the same entry", () => {
    const live = { ...base, "items.json": [{ id: "torch", color: "#ff0" }, { id: "bucket", color: "#08f" }] };
    const draft = { ...base, "items.json": [{ id: "torch", color: "#000" }, { id: "bucket", color: "#08f" }] };
    const r = rebaseDraft(base, live, draft);
    expect(items(r.files).find((e) => e.id === "torch")?.color).toBe("#000");
  });

  it("a draft with no edits of its own collapses to live (safe to clear)", () => {
    const live = { ...base, "rooms/vents.json": room("vents", ["#...", "...."]) };
    const r = rebaseDraft(base, live, { ...base });
    expect(r.hasLocalChanges).toBe(false);
    expect(r.files["rooms/vents.json"]).toEqual(live["rooms/vents.json"]);
  });

  it("a draft whose edits were already published collapses to live", () => {
    // Draft published (merged) with someone else's change; base didn't move.
    const draftRoom = room("vents", ["##..", "...."]);
    const live = {
      ...base,
      "rooms/vents.json": draftRoom,
      "items.json": [{ id: "torch", color: "#ff0" }, { id: "bucket", color: "#08f" }],
    };
    const draft = { ...base, "rooms/vents.json": draftRoom };
    const r = rebaseDraft(base, live, draft);
    expect(r.hasLocalChanges).toBe(false);
    expect(items(r.files).find((e) => e.id === "torch")?.color).toBe("#ff0");
  });

  it("picks up a room another publisher added", () => {
    const live = { ...base, "rooms/attic.json": room("attic", [".."]) };
    const draft = { ...base, "rooms/vents.json": room("vents", ["##..", "...."]) };
    const r = rebaseDraft(base, live, draft);
    expect(r.files["rooms/attic.json"]).toBeDefined();
  });
});
