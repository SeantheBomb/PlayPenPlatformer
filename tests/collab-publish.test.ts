// Working together safely (Sean, 2026-11-04 — Miranda joined Casey): drives
// the REAL publish endpoint (functions/api/content.js) against an in-memory
// KV, so the whole server path — credential scope, projection, 3-way merge,
// 409 conflicts, resolutions, live-meta — is pinned end to end.
//
// The bug this exists for: studios publish every file they loaded, and the
// art scope used to overlay ALL of it onto live — so an artist with an older
// session open silently reverted another artist's newer art on every publish.
import { describe, expect, it } from "vitest";
import { onRequestGet, onRequestPost } from "../functions/api/content.js";
import { rebaseDraft } from "../src/data/content";

const px = (n: string) => `data:image/png;base64,${n}`;
type Files = Record<string, unknown>;
type Tile = { id: string; sprite?: string; damage?: number; color?: string };

function kv() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  };
}
const env = () => ({ CONTENT: kv(), EDITOR_PASSWORD: "ed", ARTIST_PASSWORD: "art", WRITER_PASSWORD: "wr" });
type Env = ReturnType<typeof env>;

async function publish(e: Env, who: "editor" | "artist" | "writer", body: Record<string, unknown>) {
  const header = { editor: "x-editor-password", artist: "x-artist-password", writer: "x-writer-password" }[who];
  const pass = { editor: "ed", artist: "art", writer: "wr" }[who];
  const res = await onRequestPost({
    request: new Request("https://x/api/content", {
      method: "POST", headers: { [header]: pass, "content-type": "application/json" }, body: JSON.stringify(body),
    }),
    env: e,
  } as never);
  return { status: res.status, data: (await res.json()) as any };
}
async function live(e: Env) {
  const res = await onRequestGet({ request: new Request("https://x/api/content"), env: e } as never);
  return (await res.json()) as { id: string; by?: string; files: Files };
}
const tiles = (f: Files) => f["tiles.json"] as Tile[];
const tile = (f: Files, id: string) => tiles(f).find((t) => t.id === id)!;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

const seed: Files = {
  "tiles.json": [
    { id: "wall", damage: 0, color: "#333" },
    { id: "lava", damage: 1, color: "#f40" },
  ],
  "layers.json": { sets: { lab: { layers: [{ id: "far", scrollX: 0.2 }, { id: "near", scrollX: 0.8 }] } }, rooms: {} },
  "rooms/cell.json": { id: "cell", tiles: ["##"], entities: [{ type: "npc", npcId: "marla", x: 1, y: 0, name: "Marla", dialogAsk: "hi" }] },
};

/** Live = seed, published by the editor; returns its id. */
async function setup() {
  const e = env();
  Date.now = (() => { let t = 1_000; return () => (t += 1000); })();
  const r = await publish(e, "editor", { files: clone(seed), note: "seed", author: "Sean" });
  return { e, v0: r.data.id as string };
}

describe("collaborative publishing (server, end to end)", () => {
  it("an older open session no longer reverts another artist's newer art", async () => {
    const { e, v0 } = await setup();
    // Both artists open the studio on v0. Casey draws the wall and publishes.
    const casey = clone(seed); tile(casey, "wall").sprite = px("casey-wall");
    expect((await publish(e, "artist", { files: casey, baseId: v0, author: "Casey" })).status).toBe(200);
    // Miranda (still on v0) draws lava and publishes her whole loaded bundle.
    const miranda = clone(seed); tile(miranda, "lava").sprite = px("miranda-lava");
    const r = await publish(e, "artist", { files: miranda, baseId: v0, author: "Miranda" });
    expect(r.status).toBe(200);
    const l = await live(e);
    expect(tile(l.files, "wall").sprite).toBe(px("casey-wall"));    // NOT reverted
    expect(tile(l.files, "lava").sprite).toBe(px("miranda-lava"));
    expect(l.by).toBe("Miranda");
  });

  it("an artist's art and Sean's gameplay edit to the SAME tile both survive", async () => {
    const { e, v0 } = await setup();
    const sean = clone(seed); tile(sean, "lava").damage = 3;
    await publish(e, "editor", { files: sean, baseId: v0 });
    const art = clone(seed); tile(art, "lava").sprite = px("lava");
    expect((await publish(e, "artist", { files: art, baseId: v0 })).status).toBe(200);
    const l = await live(e);
    expect(tile(l.files, "lava")).toMatchObject({ damage: 3, sprite: px("lava") });
  });

  it("two artists changing the SAME sprite: 409 with both versions, then resolutions apply", async () => {
    const { e, v0 } = await setup();
    const casey = clone(seed); tile(casey, "wall").sprite = px("casey");
    await publish(e, "artist", { files: casey, baseId: v0, author: "Casey" });
    const miranda = clone(seed); tile(miranda, "wall").sprite = px("miranda");
    tile(miranda, "lava").sprite = px("miranda-lava"); // a non-conflicting change too

    const r = await publish(e, "artist", { files: miranda, baseId: v0, author: "Miranda" });
    expect(r.status).toBe(409);
    expect(r.data.liveBy).toBe("Casey");
    expect(r.data.conflicts).toHaveLength(1);
    expect(r.data.conflicts[0]).toMatchObject({ group: "tiles.json#wall" });
    expect(r.data.conflicts[0].values[0]).toMatchObject({ live: px("casey"), incoming: px("miranda") });
    // Nothing was published by the refused attempt.
    expect(tile((await live(e)).files, "lava").sprite).toBeUndefined();

    const theirs = await publish(e, "artist", {
      files: miranda, baseId: v0, author: "Miranda", resolutions: { "tiles.json#wall": "theirs" },
    });
    expect(theirs.status).toBe(200);
    const l = await live(e);
    expect(tile(l.files, "wall").sprite).toBe(px("casey"));        // took theirs
    expect(tile(l.files, "lava").sprite).toBe(px("miranda-lava")); // hers merged
  });

  it("layer sets merge per layer: two artists retuning different layers both land", async () => {
    const { e, v0 } = await setup();
    const a = clone(seed) as any; a["layers.json"].sets.lab.layers[0].scrollX = 0.1;
    const b = clone(seed) as any; b["layers.json"].sets.lab.layers[1].scrollX = 0.9;
    await publish(e, "artist", { files: a, baseId: v0 });
    expect((await publish(e, "artist", { files: b, baseId: v0 })).status).toBe(200);
    const layers = ((await live(e)).files["layers.json"] as any).sets.lab.layers;
    expect(layers.map((l: any) => l.scrollX)).toEqual([0.1, 0.9]);
  });

  it("a scoped publish can't conflict on anything outside its scope", async () => {
    const { e, v0 } = await setup();
    const sean = clone(seed); tile(sean, "wall").color = "#000";
    await publish(e, "editor", { files: sean, baseId: v0 });
    // The writer's stale copy differs from live on wall.color — irrelevant to them.
    const w = clone(seed) as any; tile(w, "wall").color = "#fff";
    w["rooms/cell.json"].entities[0].dialogAsk = "hello there";
    const r = await publish(e, "writer", { files: w, baseId: v0 });
    expect(r.status).toBe(200);
    const l = await live(e) as any;
    expect(tile(l.files, "wall").color).toBe("#000");
    expect(l.files["rooms/cell.json"].entities[0].dialogAsk).toBe("hello there");
  });

  it("the editor gets the same conflict stop (no more silent last-publisher-wins)", async () => {
    const { e, v0 } = await setup();
    const a = clone(seed); tile(a, "lava").damage = 2;
    await publish(e, "editor", { files: a, baseId: v0 });
    const b = clone(seed); tile(b, "lava").damage = 5;
    const r = await publish(e, "editor", { files: b, baseId: v0 });
    expect(r.status).toBe(409);
    expect(r.data.conflicts.map((c: any) => c.group)).toEqual(["tiles.json#lava"]);
    const ok = await publish(e, "editor", { files: b, baseId: v0, resolutions: { "tiles.json#lava": "mine" } });
    expect(ok.status).toBe(200);
    expect(tile((await live(e)).files, "lava").damage).toBe(5);
  });

  it("no baseId (an old cached client) keeps the old overlay behavior", async () => {
    const { e } = await setup();
    const art = clone(seed); tile(art, "wall").sprite = px("w");
    expect((await publish(e, "artist", { files: art })).status).toBe(200);
    expect(tile((await live(e)).files, "wall").sprite).toBe(px("w"));
  });

  it("?meta=1 is the small summary pollers read, updated on every publish", async () => {
    const { e } = await setup();
    const res = await onRequestGet({ request: new Request("https://x/api/content?meta=1"), env: e } as never);
    const meta = await res.json() as any;
    expect(meta).toMatchObject({ id: (await live(e)).id, by: "Sean", note: "seed" });
    expect(meta.files).toBeUndefined();
  });
});

describe("background sync (rebaseDraft collisions)", () => {
  it("reports items both sides changed, keeps the local value, and 'theirs' settles them", () => {
    const base = clone(seed);
    const liveF = clone(seed); tile(liveF, "wall").sprite = px("casey");
    const draft = clone(seed); tile(draft, "wall").sprite = px("mine"); tile(draft, "lava").sprite = px("lava");
    const r = rebaseDraft(base, liveF, draft);
    expect(r.collisions.map((c) => c.group)).toEqual(["tiles.json#wall"]);
    expect(tile(r.files, "wall").sprite).toBe(px("mine"));   // local never overwritten by a sync
    const t = rebaseDraft(base, liveF, draft, [], { "tiles.json#wall": "theirs" });
    expect(t.collisions).toEqual([]);
    expect(tile(t.files, "wall").sprite).toBe(px("casey"));
  });

  it("non-overlapping incoming work arrives with no collisions", () => {
    const base = clone(seed);
    const liveF = clone(seed); tile(liveF, "wall").sprite = px("casey");
    const draft = clone(seed); tile(draft, "lava").sprite = px("mine");
    const r = rebaseDraft(base, liveF, draft);
    expect(r.collisions).toEqual([]);
    expect(tile(r.files, "wall").sprite).toBe(px("casey"));
    expect(tile(r.files, "lava").sprite).toBe(px("mine"));
  });
});
