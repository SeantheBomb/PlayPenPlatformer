// Tile effects ride the art publish scope (2026-11-18): an artist can publish
// vfx.json and tile/item `vfx` bindings, and still can't touch the gameplay
// fields effects are built around (bounce, fallSpawns, hit-stop). Two artists
// editing different presets both land; the same preset field conflicts and
// asks, grouped per preset. Drives the real endpoint over an in-memory KV.
import { describe, expect, it } from "vitest";
import { onRequestGet, onRequestPost } from "../functions/api/content.js";
import { overlayArtBundle } from "../functions/api/_artscope.js";

type Files = Record<string, any>;
function kv() {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) };
}
const env = () => ({ CONTENT: kv(), EDITOR_PASSWORD: "ed", ARTIST_PASSWORD: "art", WRITER_PASSWORD: "wr" });
async function publish(e: ReturnType<typeof env>, who: "editor" | "artist", body: Record<string, unknown>) {
  const header = who === "editor" ? "x-editor-password" : "x-artist-password";
  const res = await onRequestPost({
    request: new Request("https://x/api/content", { method: "POST", headers: { [header]: who === "editor" ? "ed" : "art", "content-type": "application/json" }, body: JSON.stringify(body) }),
    env: e,
  } as never);
  return { status: res.status, data: (await res.json()) as any };
}
async function live(e: ReturnType<typeof env>): Promise<Files> {
  const res = await onRequestGet({ request: new Request("https://x/api/content"), env: e } as never);
  return ((await res.json()) as { files: Files }).files;
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const seed: Files = {
  "tiles.json": [
    { id: "spring", char: "S", bounce: 620, color: "#5ad1a5" },
    { id: "waterfall", char: "V", fallSpawns: "water", color: "#4fc3f7" },
  ],
  "items.json": [{ id: "spring", name: "Spring", placeType: "spring", color: "#5ad1a5" }],
  "game.json": { juice: { hitStopMs: 70, flashes: true } },
  "vfx.json": {
    presets: [
      { id: "splash", name: "Splash", layers: [{ id: "drops", kind: "particles", count: 5, speed: 95 }] },
      { id: "squish", name: "Squish", layers: [{ id: "squash", kind: "tween", ms: 260 }] },
    ],
    defaults: { bounce: [{ preset: "builtin_bounce" }] },
    stages: [],
  },
};
async function setup() {
  const e = env();
  Date.now = (() => { let t = 5_000; return () => (t += 1000); })();
  const r = await publish(e, "editor", { files: clone(seed), note: "seed" });
  return { e, v0: r.data.id as string };
}

describe("artist scope: effects in, gameplay out", () => {
  it("vfx bindings + vfx.json publish; bounce, fallSpawns and hit-stop don't", () => {
    const artist = clone(seed);
    artist["tiles.json"][0].vfx = [{ id: "squish", on: "bounce", preset: "squish" }];
    artist["tiles.json"][0].vfxStage = { bounce: "drop_onto" };
    artist["tiles.json"][0].bounce = 9999;
    artist["tiles.json"][1].fallSpawns = "lava";
    artist["items.json"][0].vfx = [{ id: "squish", on: "bounce", preset: "squish" }];
    artist["game.json"].juice.hitStopMs = 0;
    artist["vfx.json"].presets.push({ id: "mist", name: "Mist", layers: [] });
    const out = overlayArtBundle(clone(seed), artist) as Files;
    expect(out["tiles.json"][0].vfx).toEqual([{ id: "squish", on: "bounce", preset: "squish" }]);
    expect(out["tiles.json"][0].vfxStage).toEqual({ bounce: "drop_onto" });
    expect(out["items.json"][0].vfx).toHaveLength(1);
    expect(out["vfx.json"].presets.map((p: any) => p.id)).toEqual(["splash", "squish", "mist"]);
    expect(out["tiles.json"][0].bounce).toBe(620);
    expect(out["tiles.json"][1].fallSpawns).toBe("water");
    expect(out["game.json"].juice.hitStopMs).toBe(70);
  });
  it("removing a binding publishes the removal", () => {
    const withFx = clone(seed); withFx["tiles.json"][0].vfx = [{ id: "s", on: "bounce", preset: "squish" }];
    const out = overlayArtBundle(withFx, clone(seed)) as Files;
    expect(out["tiles.json"][0].vfx).toBeUndefined();
  });
});

describe("two artists on effects", () => {
  it("different presets both land", async () => {
    const { e, v0 } = await setup();
    const casey = clone(seed); casey["vfx.json"].presets[0].layers[0].count = 9;
    const miranda = clone(seed); miranda["vfx.json"].presets[1].layers[0].ms = 300;
    expect((await publish(e, "artist", { files: casey, baseId: v0, author: "Casey" })).status).toBe(200);
    expect((await publish(e, "artist", { files: miranda, baseId: v0, author: "Miranda" })).status).toBe(200);
    const l = await live(e);
    expect(l["vfx.json"].presets[0].layers[0].count).toBe(9);
    expect(l["vfx.json"].presets[1].layers[0].ms).toBe(300);
  });
  it("the same preset field conflicts, grouped per preset, then resolves", async () => {
    const { e, v0 } = await setup();
    const casey = clone(seed); casey["vfx.json"].presets[0].layers[0].count = 9;
    const miranda = clone(seed); miranda["vfx.json"].presets[0].layers[0].count = 2;
    await publish(e, "artist", { files: casey, baseId: v0, author: "Casey" });
    const r = await publish(e, "artist", { files: miranda, baseId: v0, author: "Miranda" });
    expect(r.status).toBe(409);
    expect(r.data.conflicts).toHaveLength(1);
    expect(r.data.conflicts[0]).toMatchObject({ group: "vfx.json#preset:splash", label: "effect preset splash" });
    const ok = await publish(e, "artist", { files: miranda, baseId: v0, author: "Miranda", resolutions: { "vfx.json#preset:splash": "mine" } });
    expect(ok.status).toBe(200);
    expect((await live(e))["vfx.json"].presets[0].layers[0].count).toBe(2);
  });
  it("different tiles' bindings both land (per-tile merge)", async () => {
    const { e, v0 } = await setup();
    const a = clone(seed); a["tiles.json"][0].vfx = [{ id: "s", on: "bounce", preset: "squish" }];
    const b = clone(seed); b["tiles.json"][1].vfx = [{ id: "p", on: "fallImpact:fluid", preset: "splash" }];
    await publish(e, "artist", { files: a, baseId: v0 });
    expect((await publish(e, "artist", { files: b, baseId: v0 })).status).toBe(200);
    const l = await live(e);
    expect(l["tiles.json"][0].vfx).toHaveLength(1);
    expect(l["tiles.json"][1].vfx).toHaveLength(1);
  });
});
