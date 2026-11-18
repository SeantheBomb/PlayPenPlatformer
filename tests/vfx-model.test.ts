// Tile effects model (content/vfx.json + per-tile bindings). Pins the
// resolution rules the Art Studio's Effects panel shows and the VfxPlayer
// plays, and that every built-in preset reproduces the exact burst game.ts
// used to hardcode before 2026-11-18 (no visible change for players).
import { describe, expect, it } from "vitest";
import vfxJson from "../content/vfx.json";
import type { VfxFile, VfxLayer } from "../src/data/types";
import { PARTICLE_DEFAULTS, presetUsers, resolveEffects, sampleKeys, VfxPlayer, VFX_LIMITS } from "../src/engine/vfx";

const FILE = vfxJson as unknown as VfxFile;

// The literals from the old game.ts particles.burst calls ("event" = ev.color).
const OLD: Record<string, { count: number; color: string; speed: number; upBias?: number; life: number; gravity?: number; shake?: [number, number] }> = {
  ignite: { count: 8, color: "#ff7043", speed: 60, upBias: 40, life: 0.5, gravity: -60 },
  extinguish: { count: 10, color: "#cfd8dc", speed: 50, upBias: 50, life: 0.6, gravity: -80 },
  fizzle: { count: 10, color: "#cfd8dc", speed: 50, upBias: 50, life: 0.6, gravity: -80 },
  melt: { count: 10, color: "event", speed: 70, life: 0.5 },
  dissolve: { count: 10, color: "event", speed: 70, life: 0.5 },
  freeze: { count: 12, color: "#b3e5fc", speed: 60, life: 0.5, gravity: 40 },
  shatter: { count: 14, color: "event", speed: 120, life: 0.55, shake: [3, 0.2] },
  energize: { count: 2, color: "#ffe95a", speed: 40, life: 0.25, gravity: 0 },
  capacitorOn: { count: 10, color: "#ffe95a", speed: 70, life: 0.4 },
  capacitorOff: { count: 6, color: "#8f9bb3", speed: 50, life: 0.35 },
  fuse: { count: 14, color: "#ffe95a", speed: 90, life: 0.5, shake: [2, 0.15] },
  enemy_kill: { count: 20, color: "event", speed: 140, upBias: 50, life: 0.6, shake: [3, 0.2] },
  enemy_stun: { count: 8, color: "event", speed: 70, life: 0.4 },
  burnout: { count: 6, color: "#5a5470", speed: 40, upBias: 30, life: 0.6, gravity: -40 },
  flow: { count: 3, color: "#4fc3f7", speed: 25, life: 0.35, gravity: 20 },
  land: { count: 6, color: "#6a6284", speed: 50, upBias: 20, life: 0.35, gravity: 240 },
  bounce: { count: 10, color: "event", speed: 80, upBias: 60, life: 0.4 },
};

describe("built-in parity: defaults reproduce the old hardcoded bursts", () => {
  for (const [moment, old] of Object.entries(OLD)) {
    it(moment, () => {
      const fx = resolveEffects(FILE, undefined, moment);
      expect(fx).toHaveLength(1);
      const layers = fx[0].layers;
      const p = layers.filter((l) => l.kind === "particles");
      expect(p).toHaveLength(1);
      const l = p[0];
      expect(l.count).toBe(old.count);
      expect(l.colors).toEqual([old.color]);
      expect(l.speed).toBe(old.speed);
      expect(l.upBias ?? PARTICLE_DEFAULTS.upBias).toBe(old.upBias ?? 0);
      expect(l.life).toBe(old.life);
      expect(l.gravity ?? PARTICLE_DEFAULTS.gravity).toBe(old.gravity ?? 300);
      // Untouched burst defaults = the old Particles.burst internals.
      expect(l.cone ?? PARTICLE_DEFAULTS.cone).toBe(360);
      expect(l.speedMin ?? PARTICLE_DEFAULTS.speedMin).toBe(0.3);
      expect(l.lifeMin ?? PARTICLE_DEFAULTS.lifeMin).toBe(0.6);
      expect(l.size ?? PARTICLE_DEFAULTS.size).toBe(3);
      expect(l.sizeEnd ?? PARTICLE_DEFAULTS.sizeEnd).toBe(0.5);
      const shake = layers.find((x) => x.kind === "shake");
      if (old.shake) expect([shake?.intensity, shake?.seconds]).toEqual(old.shake);
      else expect(shake).toBeUndefined();
    });
  }
});

describe("resolution: defaults + the tile's own bindings", () => {
  const squishTile = {
    vfx: [{ id: "squish", on: "bounce", preset: "squish" }],
  };
  it("add (the default mode) plays on top of the every-tile default", () => {
    const fx = resolveEffects(FILE, squishTile, "bounce");
    expect(fx.map((f) => [f.preset.id, f.source])).toEqual([["builtin_bounce", "default"], ["squish", "own"]]);
  });
  it("replace silences the default for this tile only", () => {
    const t = { vfx: [{ id: "s", on: "bounce", preset: "squish", mode: "replace" as const }] };
    expect(resolveEffects(FILE, t, "bounce").map((f) => f.preset.id)).toEqual(["squish"]);
    expect(resolveEffects(FILE, undefined, "bounce").map((f) => f.preset.id)).toEqual(["builtin_bounce"]);
  });
  it("a binding for one moment never leaks into another", () => {
    expect(resolveEffects(FILE, squishTile, "land").map((f) => f.preset.id)).toEqual(["builtin_land"]);
  });
  it("per-tile params override by LAYER ID and leave the preset itself alone", () => {
    const t = { vfx: [{ id: "a", on: "fallImpact:fluid", preset: "splash", params: { drops: { count: 2, speed: 40 } } }] };
    const [fx] = resolveEffects(FILE, t, "fallImpact:fluid");
    const drops = fx.layers.find((l) => l.id === "drops")!;
    expect(drops.count).toBe(2);
    expect(drops.speed).toBe(40);
    expect(drops.gravity).toBe(FILE.presets.find((p) => p.id === "splash")!.layers[0].gravity);
    expect(FILE.presets.find((p) => p.id === "splash")!.layers[0].count).not.toBe(2);
  });
  it("params for a layer id the preset no longer has are ignored, not crashed on", () => {
    const t = { vfx: [{ id: "a", on: "bounce", preset: "squish", params: { gone: { ms: 1 } } }] };
    const fx = resolveEffects(FILE, t, "bounce").find((f) => f.source === "own")!;
    expect(fx.layers.map((l) => l.id)).toEqual(["squash"]);
  });
  it("a binding to a deleted preset just doesn't play", () => {
    const t = { vfx: [{ id: "a", on: "bounce", preset: "nope" }] };
    expect(resolveEffects(FILE, t, "bounce").map((f) => f.preset.id)).toEqual(["builtin_bounce"]);
  });
});

describe("used-by is computed from real data", () => {
  it("counts every-tile defaults and each binding", () => {
    const defs = [
      { kind: "tile" as const, id: "spring", name: "Bounce Pad", vfx: [{ id: "s", on: "bounce", preset: "squish" }] },
      { kind: "item" as const, id: "spring", name: "Spring", vfx: [{ id: "s", on: "bounce", preset: "squish" }] },
      { kind: "tile" as const, id: "wall", name: "Wall" },
    ];
    expect(presetUsers(FILE, defs, "squish")).toEqual(["Bounce Pad: Bounced on", "Spring: Bounced on"]);
    expect(presetUsers(FILE, defs, "builtin_extinguish")).toEqual(["every tile: Is put out", "every tile: Fizzles"]);
  });
});

describe("keyframes are the stored truth", () => {
  it("samples linearly and clamps at the ends", () => {
    const k: [number, number][] = [[0, 1], [0.25, 0.55], [0.6, 1.15], [1, 1]];
    expect(sampleKeys(k, 0, 9)).toBe(1);
    expect(sampleKeys(k, 0.25, 9)).toBeCloseTo(0.55);
    expect(sampleKeys(k, 0.125, 9)).toBeCloseTo(0.775);
    expect(sampleKeys(k, 2, 9)).toBe(1);
    expect(sampleKeys(undefined, 0.5, 9)).toBe(9);
  });
});

describe("VfxPlayer limits", () => {
  const host = { shake: () => {}, particlesOn: () => true, flashesOn: () => true };
  const big: VfxLayer = { id: "p", kind: "particles", count: 200, life: 5 };
  it("never holds more than the particle cap (oldest dropped)", () => {
    const v = new VfxPlayer(FILE, host);
    for (let i = 0; i < 10; i++) v.playLayer(big, { x: 0, y: 0 });
    expect(v.particleCount).toBe(VFX_LIMITS.particles);
  });
  it("starts at most 3 flashes per second", () => {
    const v = new VfxPlayer(FILE, host);
    let started = 0;
    const flash: VfxLayer = { id: "f", kind: "flash", ms: 30 };
    for (let step = 0; step < 60; step++) {
      v.update(1 / 60, step / 60);
      const before = (v as unknown as { flash: unknown }).flash;
      v.playLayer(flash, { x: 0, y: 0 });
      if ((v as unknown as { flash: unknown }).flash !== before) started++;
    }
    expect(started).toBe(VFX_LIMITS.flashesPerSec);
  });
  it("flashes off (juice/reduce-flashing) = none at all", () => {
    const v = new VfxPlayer(FILE, { ...host, flashesOn: () => false });
    v.playLayer({ id: "f", kind: "flash" }, { x: 0, y: 0 });
    expect((v as unknown as { flash: unknown }).flash).toBeNull();
  });
  it("particles off = no particles", () => {
    const v = new VfxPlayer(FILE, { ...host, particlesOn: () => false });
    v.playLayer(big, { x: 0, y: 0 });
    expect(v.particleCount).toBe(0);
  });
  it("shake is clamped", () => {
    let got: number[] = [];
    const v = new VfxPlayer(FILE, { ...host, shake: (i, s) => { got = [i, s]; } });
    v.playLayer({ id: "s", kind: "shake", intensity: 99, seconds: 9 }, { x: 0, y: 0 });
    expect(got).toEqual([VFX_LIMITS.shakeIntensity, VFX_LIMITS.shakeSeconds]);
  });
  it("a tile tween is keyed by where the tile is DRAWN and ends after ms", () => {
    const v = new VfxPlayer(FILE, host);
    v.update(0, 10);
    v.play("bounce", { vfx: [{ id: "s", on: "bounce", preset: "squish" }] }, { x: 8, y: 0, cell: { px: 32, py: 48 } });
    v.update(1 / 60, 10 + 0.065); // t = 0.25 of 260 ms
    expect(v.transformAt(32, 48)?.sy).toBeCloseTo(0.55, 1);
    expect(v.transformAt(32, 48)?.anchor).toBe("bottom");
    expect(v.transformAt(48, 48)).toBeNull();
    v.update(1 / 60, 10 + 0.3);
    expect(v.transformAt(32, 48)).toBeNull();
  });
  it("continuous moments without `while` play once per spot until they pause", () => {
    const v = new VfxPlayer(FILE, host);
    const tile = { vfx: [{ id: "s", on: "fallImpact:fluid", preset: "splash", mode: "replace" as const }] };
    const at = { x: 8, y: 8, cell: { px: 0, py: 0 } };
    v.update(0, 1); v.play("fallImpact:fluid", tile, at);
    const first = v.particleCount;
    v.update(0, 1.2); v.play("fallImpact:fluid", tile, at);
    expect(v.particleCount).toBe(first);
    const streaming = { vfx: [{ ...tile.vfx[0], while: true }] };
    v.update(0, 1.4); v.play("fallImpact:fluid", streaming, at);
    expect(v.particleCount).toBeGreaterThan(first);
  });
});
