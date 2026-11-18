// Tile effects player (2026-11-18). Reads moments the game already raises —
// element events, bounces, landings, falls meeting what's under them — and
// plays the artist-made effects content/vfx.json binds to them: particles,
// tile tweens (squish), glows, screen shake and capped flashes.
//
// THE SIM WALL: nothing here writes simulation state. Particles use
// Math.random (cosmetic), tweens and glows are timed on the caller's `animT`
// (the cosmetic clock parallax uses — one fixed step per update, frozen while
// paused), so republished effects can never change how a recorded run plays
// and replays stay pixel-identical. Hit-stop and sound stay in game code
// (game feel, not looks) and are listed to the Art Studio as LOCKED rows.
import type { SpriteFields, VfxBinding, VfxFile, VfxKeys, VfxLayer, VfxPreset } from "../data/types";
import { frameImage } from "./renderer";

/** A moment a tile (or placed item) can bind effects to. */
export interface MomentInfo {
  key: string;
  label: string;
  /** Continuous moments repeat while they keep happening (a fall meets its
   *  pool every flow tick; ambient runs per on-screen cell). */
  continuous?: boolean;
}

export const MOMENTS: MomentInfo[] = [
  { key: "bounce", label: "Bounced on" },
  { key: "land", label: "Landed on" },
  { key: "enter", label: "Player jumps in" },
  { key: "exit", label: "Player climbs out" },
  { key: "fallImpact:fluid", label: "Meets a pool", continuous: true },
  { key: "fallImpact:solid", label: "Meets the floor", continuous: true },
  { key: "ambient", label: "Always (while on screen)", continuous: true },
  { key: "ignite", label: "Catches fire" },
  { key: "burnout", label: "Burns out" },
  { key: "extinguish", label: "Is put out" },
  { key: "fizzle", label: "Fizzles" },
  { key: "melt", label: "Melts" },
  { key: "dissolve", label: "Dissolves" },
  { key: "freeze", label: "Freezes" },
  { key: "shatter", label: "Shatters" },
  { key: "energize", label: "Is energized" },
];
/** Game events that aren't a tile's (Every tile scope only). */
const OTHER_EVENTS: Record<string, string> = {
  capacitorOn: "A capacitor switches on", capacitorOff: "A capacitor switches off",
  fuse: "A fuse box trips", enemy_kill: "An enemy is defeated", enemy_stun: "An enemy is stunned",
  flow: "Fluid flows a step",
};
export const MOMENT_LABEL: Record<string, string> = { ...Object.fromEntries(MOMENTS.map((m) => [m.key, m.label])), ...OTHER_EVENTS };

/** Feedback that plays at a moment but is game feel, not looks — owned by
 *  game code, shown in the Art Studio as locked rows so nothing is hidden. */
export const LOCKED_FEEDBACK: Record<string, string[]> = {
  bounce: ["Sound: boing"],
  land: ["Sound: thud (hard landings only)", "Screen shake on a very hard landing"],
  enter: [], exit: [],
  ignite: ["Sound: whoosh"],
  extinguish: ["Sound: splash"], fizzle: ["Sound: splash"],
  melt: ["Sound: splash"], dissolve: ["Sound: splash"],
  freeze: ["Sound: freeze"],
  shatter: ["Sound: break", "Hit-stop (the game freezes for a beat)"],
};

/** Hard caps — artist values are clamped to these at play time. */
export const VFX_LIMITS = {
  particles: 600,      // live particles; the oldest are dropped beyond it
  flashesPerSec: 3,    // photosensitivity: never more flashes start than this
  flashAlpha: 0.6,
  shakeIntensity: 8,
  shakeSeconds: 1,
};

/** Defaults every particle layer falls back to — exactly the old
 *  Particles.burst defaults, so built-in presets reproduce the old look. */
export const PARTICLE_DEFAULTS = {
  count: 8, speed: 90, speedMin: 0.3, dir: 0, cone: 360, upBias: 0, gravity: 300,
  life: 0.5, lifeMin: 0.6, size: 3, sizeEnd: 0.5, shape: "square" as const, blend: "normal" as const,
  spreadX: 0, spreadY: 0,
};

/** One effect to play: a preset's layers with per-tile params applied. */
export interface ResolvedEffect {
  preset: VfxPreset;
  layers: VfxLayer[];
  /** Where it came from: a game-wide default or this tile's own binding. */
  source: "default" | "own";
  binding?: VfxBinding;
}

export function applyParams(layers: VfxLayer[], params?: Record<string, Partial<VfxLayer>>): VfxLayer[] {
  if (!params) return layers;
  return layers.map((l) => (params[l.id] ? { ...l, ...params[l.id], id: l.id, kind: l.kind } : l));
}

/** What plays for `moment` on a def (tile/item) — its own bindings, plus the
 *  game-wide defaults unless one of its bindings for that moment replaces
 *  them. Pure: the panel lists exactly what the player will play. */
export function resolveEffects(
  file: VfxFile | undefined,
  def: { vfx?: VfxBinding[] } | undefined,
  moment: string
): ResolvedEffect[] {
  if (!file) return [];
  const byId = new Map(file.presets.map((p) => [p.id, p]));
  const own = (def?.vfx ?? []).filter((b) => b.on === moment);
  const out: ResolvedEffect[] = [];
  if (!own.some((b) => b.mode === "replace")) {
    for (const d of file.defaults[moment] ?? []) {
      const p = byId.get(d.preset);
      if (p) out.push({ preset: p, layers: applyParams(p.layers, d.params), source: "default" });
    }
  }
  for (const b of own) {
    const p = byId.get(b.preset);
    if (p) out.push({ preset: p, layers: applyParams(p.layers, b.params), source: "own", binding: b });
  }
  return out;
}

/** Everything that uses a preset — computed, never stored. */
export function presetUsers(
  file: VfxFile,
  defs: { kind: "tile" | "item"; id: string; name: string; vfx?: VfxBinding[] }[],
  presetId: string
): string[] {
  const out: string[] = [];
  for (const [moment, list] of Object.entries(file.defaults)) {
    if (list.some((d) => d.preset === presetId)) out.push(`every tile: ${MOMENT_LABEL[moment] ?? moment}`);
  }
  for (const d of defs) {
    for (const b of d.vfx ?? []) if (b.preset === presetId) out.push(`${d.name}: ${MOMENT_LABEL[b.on] ?? b.on}`);
  }
  return out;
}

/** Linear keyframe lookup. */
export function sampleKeys(keys: VfxKeys | undefined, t: number, fallback: number): number {
  if (!keys || keys.length === 0) return fallback;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const f = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * f;
    }
  }
  return keys[keys.length - 1][1];
}

export interface TileXf { sx: number; sy: number; oy: number; anchor: "bottom" | "center" | "top"; }

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; sizeEnd: number;
  color: string; fadeTo?: string; gravity: number;
  shape: "square" | "round" | "streak" | "art"; add: boolean; art?: SpriteFields;
}

interface Tween { key: string; start: number; layer: VfxLayer; }
interface Glow { x: number; y: number; start: number; layer: VfxLayer; }

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, f: number): string {
  const A = hexToRgb(a), B = hexToRgb(b);
  if (!A || !B) return a;
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export interface VfxHost {
  shake(intensity: number, seconds: number): void;
  /** juice toggles, read live */
  particlesOn(): boolean;
  flashesOn(): boolean;
}

/** Where a moment happened. `cell` = the world-px top-left a tile/placed item
 *  is DRAWN at — the key tile tweens attach to (see setTileTransforms). */
export interface MomentAt {
  x: number; y: number;
  color?: string;
  cell?: { px: number; py: number };
}

export class VfxPlayer {
  private pool: Particle[] = [];
  private tweens: Tween[] = [];
  private glows: Glow[] = [];
  private flash: { color: string; alpha: number; start: number; ms: number } | null = null;
  private flashStarts: number[] = [];
  /** Continuous-moment dedupe: binding+spot → animT last seen. */
  private lastSeen = new Map<string, number>();
  private ambientAcc = new Map<string, number>();
  /** Moments seen since the last reset — the stage runner's proof. */
  readonly seen = new Map<string, number>();
  /** Ambient moment raised this frame for these cells (stage proof too). */
  now = 0;

  constructor(public file: VfxFile, private host: VfxHost) {}

  get particleCount(): number { return this.pool.length; }

  clear(): void {
    this.pool.length = 0;
    this.tweens.length = 0;
    this.glows.length = 0;
    this.flash = null;
    this.lastSeen.clear();
    this.ambientAcc.clear();
  }

  /** Counts per moment and per `moment|defId` (the stage save check asks
   *  "did THIS tile's moment happen", not any tile's). */
  private note(moment: string, id?: string): void {
    this.seen.set(moment, (this.seen.get(moment) ?? 0) + 1);
    if (id) this.seen.set(`${moment}|${id}`, (this.seen.get(`${moment}|${id}`) ?? 0) + 1);
  }

  /** Play whatever `def` + the defaults bind to `moment`. */
  play(moment: string, def: { vfx?: VfxBinding[] } | undefined, at: MomentAt): void {
    this.note(moment, (def as { id?: string } | undefined)?.id);
    const info = MOMENTS.find((m) => m.key === moment);
    for (const fx of resolveEffects(this.file, def, moment)) {
      if (info?.continuous && moment !== "ambient" && !fx.binding?.while) {
        // Once per spot until the moment pauses (a fall keeps meeting its
        // pool every flow tick — without `while`, play only the first).
        const k = `${fx.preset.id}|${fx.binding?.id ?? "d"}|${at.cell?.px ?? at.x},${at.cell?.py ?? at.y}`;
        const last = this.lastSeen.get(k);
        this.lastSeen.set(k, this.now);
        if (last !== undefined && this.now - last < 1.5) continue;
      }
      for (const layer of fx.layers) this.playLayer(layer, at);
    }
  }

  playLayer(layer: VfxLayer, at: MomentAt): void {
    switch (layer.kind) {
      case "particles": return this.emit(layer, at);
      case "tween":
        if (!at.cell) return;
        {
          const key = `${at.cell.px},${at.cell.py}`;
          this.tweens = this.tweens.filter((t) => !(t.key === key && t.layer.id === layer.id));
          this.tweens.push({ key, start: this.now, layer });
        }
        return;
      case "glow":
        if (this.glows.length < 64) this.glows.push({ x: at.x, y: at.y, start: this.now, layer });
        return;
      case "shake":
        this.host.shake(
          Math.min(VFX_LIMITS.shakeIntensity, layer.intensity ?? 2),
          Math.min(VFX_LIMITS.shakeSeconds, layer.seconds ?? 0.2)
        );
        return;
      case "flash": {
        if (!this.host.flashesOn()) return;
        this.flashStarts = this.flashStarts.filter((t) => this.now - t < 1);
        if (this.flashStarts.length >= VFX_LIMITS.flashesPerSec) return;
        this.flashStarts.push(this.now);
        this.flash = {
          color: layer.color ?? "#ffffff",
          alpha: Math.min(VFX_LIMITS.flashAlpha, layer.alpha ?? 0.35),
          start: this.now, ms: Math.max(30, layer.ms ?? 120),
        };
        return;
      }
    }
  }

  private emit(l: VfxLayer, at: MomentAt): void {
    if (!this.host.particlesOn()) return;
    const d = PARTICLE_DEFAULTS;
    const count = Math.max(0, Math.min(200, Math.round(l.count ?? d.count)));
    const speed = l.speed ?? d.speed, speedMin = l.speedMin ?? d.speedMin;
    const life = l.life ?? d.life, lifeMin = l.lifeMin ?? d.lifeMin;
    const size = l.size ?? d.size;
    const cone = ((l.cone ?? d.cone) * Math.PI) / 180;
    const dir = ((l.dir ?? d.dir) * Math.PI) / 180;
    const full = (l.cone ?? d.cone) >= 360;
    const colors = (l.colors && l.colors.length ? l.colors : ["event"]).map((c) => (c === "event" ? at.color ?? "#ffffff" : c));
    const art = l.shape === "art" && (l.sprite || l.spriteFrames?.length) ? l : undefined;
    for (let i = 0; i < count; i++) {
      const ang = full ? rand(0, Math.PI * 2) : dir + rand(-cone / 2, cone / 2);
      const spd = rand(speed * speedMin, speed);
      this.pool.push({
        x: at.x + (l.spreadX ? rand(-l.spreadX, l.spreadX) : 0),
        y: at.y + (l.spreadY ? rand(-l.spreadY, l.spreadY) : 0),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - (l.upBias ?? d.upBias),
        life: rand(life * lifeMin, life),
        maxLife: life,
        size: rand(size * 0.6, size * 1.3),
        sizeEnd: l.sizeEnd ?? d.sizeEnd,
        color: colors[(Math.random() * colors.length) | 0],
        fadeTo: l.fadeTo,
        gravity: l.gravity ?? d.gravity,
        shape: art ? "art" : (l.shape === "art" ? "square" : l.shape ?? d.shape),
        add: l.blend === "add",
        art,
      });
    }
    // Enforced cap: drop the oldest.
    if (this.pool.length > VFX_LIMITS.particles) this.pool.splice(0, this.pool.length - VFX_LIMITS.particles);
  }

  /** Ambient emitters: every on-screen cell whose tile binds "ambient" plays
   *  its layers at `rate` per second (each layer's own rate, default 1). */
  ambient(
    dt: number,
    cells: Iterable<{ tx: number; ty: number; def: { id: string; vfx?: VfxBinding[] } }>
  ): void {
    for (const c of cells) {
      const fxs = resolveEffects(this.file, c.def, "ambient");
      if (fxs.length === 0) continue;
      this.note("ambient", c.def.id);
      for (const fx of fxs) {
        for (const layer of fx.layers) {
          const key = `${c.tx},${c.ty}|${fx.preset.id}|${layer.id}`;
          const acc = (this.ambientAcc.get(key) ?? Math.random()) + dt * Math.max(0, layer.rate ?? 1);
          if (acc >= 1) {
            this.ambientAcc.set(key, acc - Math.floor(acc));
            this.playLayer(layer, { x: c.tx * 16 + 8, y: c.ty * 16 + 8, cell: { px: c.tx * 16, py: c.ty * 16 } });
          } else this.ambientAcc.set(key, acc);
        }
      }
    }
  }

  /** Advance one cosmetic step. `animT` is the caller's cosmetic clock. */
  update(dt: number, animT: number): void {
    this.now = animT;
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) { this.pool.splice(i, 1); continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.tweens = this.tweens.filter((t) => this.now - t.start < (t.layer.ms ?? 260) / 1000);
    this.glows = this.glows.filter((g) => this.now - g.start < (g.layer.ms ?? 300) / 1000);
    if (this.flash && (this.now - this.flash.start) * 1000 > this.flash.ms) this.flash = null;
    if (this.lastSeen.size > 2000) this.lastSeen.clear();
  }

  /** The transform a tile/placed item drawn at (px, py) has right now. */
  transformAt(px: number, py: number): TileXf | null {
    if (this.tweens.length === 0) return null;
    const key = `${px},${py}`;
    let xf: TileXf | null = null;
    for (const t of this.tweens) {
      if (t.key !== key) continue;
      const f = Math.min(1, (this.now - t.start) / ((t.layer.ms ?? 260) / 1000));
      const sx = sampleKeys(t.layer.scaleX, f, 1), sy = sampleKeys(t.layer.scaleY, f, 1);
      const oy = sampleKeys(t.layer.offsetY, f, 0);
      xf = xf
        ? { sx: xf.sx * sx, sy: xf.sy * sy, oy: xf.oy + oy, anchor: xf.anchor }
        : { sx, sy, oy, anchor: t.layer.anchor ?? "bottom" };
    }
    return xf;
  }

  /** World-space: particles and glows. */
  draw(ctx: CanvasRenderingContext2D, nowMs: number): void {
    for (const g of this.glows) {
      const f = Math.min(1, (this.now - g.start) / ((g.layer.ms ?? 300) / 1000));
      const r = Math.max(1, g.layer.radius ?? 24);
      const a = (g.layer.alpha ?? 0.5) * (1 - f);
      const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, r);
      const rgb = hexToRgb(g.layer.color ?? "#ffd166") ?? [255, 209, 102];
      grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
      grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = grad;
      ctx.fillRect(g.x - r, g.y - r, r * 2, r * 2);
      ctx.restore();
    }
    for (const p of this.pool) {
      const t = p.life / p.maxLife;
      ctx.globalAlpha = Math.min(1, t * 1.6);
      if (p.add) ctx.globalCompositeOperation = "lighter";
      const s = p.size * (p.sizeEnd + t * (1 - p.sizeEnd));
      ctx.fillStyle = p.fadeTo ? mix(p.color, p.fadeTo, 1 - t) : p.color;
      if (p.shape === "round") {
        ctx.beginPath();
        ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === "streak") {
        const len = Math.max(s, Math.hypot(p.vx, p.vy) * 0.05);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-len / 2, -s / 4, len, Math.max(1, s / 2));
        ctx.restore();
      } else if (p.shape === "art" && p.art) {
        const img = frameImage(p.art, nowMs);
        if (img) ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
      } else {
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      if (p.add) ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
  }

  /** Screen-space, after the world: the (capped) flash. */
  drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.flash) return;
    const f = Math.min(1, ((this.now - this.flash.start) * 1000) / this.flash.ms);
    ctx.save();
    ctx.globalAlpha = this.flash.alpha * (1 - f);
    ctx.fillStyle = this.flash.color;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
