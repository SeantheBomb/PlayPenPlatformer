// Runtime instantiation of a RoomDef, including the elemental simulation:
// tile transformations, fire spread, spark conduction, and enemy reactions.
import type {
  Content, EnemyDef, EnemyReaction, RoomDef, RoomEntity, RuleDef, RuleEffect, TileDef,
} from "../data/types";
import { TILE, TileMap } from "../engine/tilemap";
import { drawBlob, drawItemIcon, drawNpcAvatar, drawTile, roundRect, shade } from "../engine/renderer";
import { dist, randRange, rectsOverlap, type Rect } from "../engine/math";
import { simNow } from "../engine/simclock";
import { Rng } from "../engine/rng";
import type { PlacedItem, RoomMutations, ScatterDrop } from "./state";
import {
  BehaviorSystem, enemyAttachments, enemyResetState,
  registerFn, type ScriptCtx,
} from "./behavior";

export interface EntityInstance extends Rect {
  index: number;
  def: RoomEntity;
  kind: RoomEntity["type"];
  collected?: boolean;
  open?: boolean;
  helped?: boolean;
  occupied?: boolean; // locker with player inside
  lit?: boolean;      // brazier flame state (water douses, fire relights)
}

export interface EnemyInstance {
  index: number;
  def: EnemyDef;
  x: number; y: number;
  vx: number; vy: number;
  facing: number;
  state: "patrol" | "chase" | "return" | "stunned" | "trapped";
  stunUntil: number;
  lastSawPlayerAt: number;
  lastHazardAt: number;
  homeX: number;
  patrolMin: number;
  patrolMax: number;
}

export interface PlacedInstance extends Rect {
  data: PlacedItem;
}

/** Heartbeat ground truth for one enemy — everything on EnemyInstance except
 *  `def`/`homeX`/`patrolMin`/`patrolMax`, which are content-derived constants
 *  the constructor always rebuilds identically from `index` alone. */
export interface EnemySnapshot {
  index: number;
  x: number; y: number; vx: number; vy: number; facing: number;
  state: "patrol" | "chase" | "return" | "stunned" | "trapped";
  stunUntil: number; lastSawPlayerAt: number; lastHazardAt: number;
}

/** Runtime-only fluid bookkeeping not covered by RoomMutations.tileOverrides
 *  (which only tracks a tile's identity, not these overlays) — see
 *  RoomRuntime.snapshotFluidRuntime. */
export interface FluidRuntimeSnapshot {
  burning: [number, number][];       // tile index -> seconds of burn time left
  grateFluid: [number, string][];    // tile index -> fluid tile id riding a grate
}

/** One thing that happened when an element was applied — for game feedback. */
export interface ElementEvent {
  effect: string; // RuleEffect, plus "enemy_kill" | "enemy_stun" | "enemy_knockback" | "fuse"
  x: number;
  y: number;
  color: string;
  enemyId?: string;  // for enemy_* events
  element?: string;  // the element that caused it
}

const SIGHT_HALF_SLOPE = 0.55; // vertical spread of the vision cone (~29°)

/** A rule row resolved to actionable form, whichever way it was authored. */
export interface ParsedRule {
  actor: string;
  target?: string;
  targetProperty?: string;
  effect: RuleEffect;
}

/** Tile properties a rule line may target (vs. an element id). */
const RULE_PROPERTIES = new Set(["flammable", "brittle", "conductive"]);

/** Parse a pattern line: "fire + flammable -> ignite". The middle token is a
 *  known tile property, else an element id. Null = malformed. */
export function parseRuleLine(line: string): ParsedRule | null {
  const m = /^\s*(\w+)\s*\+\s*(\w+)\s*->\s*(\w+)\s*$/.exec(line);
  if (!m) return null;
  const [, actor, target, effect] = m;
  return RULE_PROPERTIES.has(target)
    ? { actor, targetProperty: target, effect: effect as RuleEffect }
    : { actor, target, effect: effect as RuleEffect };
}

const parsedRuleCache = new WeakMap<RuleDef, ParsedRule | null>();

/** A RuleDef in either form (pattern line, or the legacy split fields stale
 *  saves still carry) resolved to a ParsedRule, cached per object. */
function ruleOf(r: RuleDef): ParsedRule | null {
  let p = parsedRuleCache.get(r);
  if (p !== undefined) return p;
  if (typeof r.rule === "string" && r.rule.trim() !== "") {
    p = parseRuleLine(r.rule);
  } else if (r.actor && r.effect) {
    p = {
      actor: r.actor,
      target: r.target || undefined,
      targetProperty: r.targetProperty || undefined,
      effect: r.effect,
    };
  } else {
    p = null;
  }
  parsedRuleCache.set(r, p);
  return p;
}

/** Fallback footprints for stale content — content/entities.json wins. */
const ENTITY_SIZES: Partial<Record<RoomEntity["type"], [number, number]>> = {
  pickup: [14, 14],
  note: [12, 12],
  door: [16, 32],
  trapdoor: [16, 16], // horizontal hatch — blocks/passes vertically, not sideways
  locker: [16, 32],
  npc: [12, 16],
  checkpoint: [8, 24],
  exit: [28, 44],
  hint: [16, 16],
  brazier: [16, 14],
  fusebox: [14, 18],
};

// Code-level fallbacks for the global tunables in content/behaviors.json
// (heat_spread / fluid_flow / element_effects docs) — the content values win.
const SPREAD_INTERVAL = 0.7; // seconds between fire spread ticks
const ENERGIZE_MS = 1500;
const HAZARD_COOLDOWN_MS = 500;
const WATER_FLOW_INTERVAL = 0.5; // seconds between fluid flow ticks
// Fall-fed fluid spreads with no distance cap — only walls or a drain stop
// it. Finite (melted/poured) fluid is conserved and never replicates at all.
const SOURCED = -1;
// How long a SOURCED body takes to fully recede once a gate closing cuts it
// off from every fall — staggered by distance from the gate, not instant.
const RECEDE_MS = 2000;
// Seconds of sustained walking-into-it before a toyblock hops one tile over.
const TOYBLOCK_PUSH_TIME = 0.25;

export class RoomRuntime {
  map: TileMap;
  entities: EntityInstance[] = [];
  enemies: EnemyInstance[] = [];
  placed: PlacedInstance[] = [];
  drops: ScatterDrop[] = [];
  spawnX = 32;
  spawnY = 32;

  /** tile index -> seconds of burn left */
  burning = new Map<number, number>();
  /** tile index -> simNow() timestamp when the smoke veil there clears */
  smoked = new Map<number, number>();
  /** tile index -> simNow() timestamp when charge dissipates */
  energized = new Map<number, number>();
  /** tile index -> tiles-from-source (SOURCED = fall-fed, uncapped spread) */
  private waterFlowDist = new Map<number, number>();
  /** tile index -> simNow() timestamp a cut-off SOURCED tile fully recedes.
   *  Stops flowing the instant it's cut off (removed from waterFlowDist);
   *  the tile itself lingers and drains visually until this fires. */
  private draining = new Map<number, number>();
  /** tile indexes of fall tiles (waterfall/lavafall) that grow + emit fluid */
  private fallTiles = new Set<number>();
  /** source tile index -> seconds a toyblock there has been leaned on, in
   *  the direction that would push it. Resets whenever contact breaks. */
  private toyblockPush = new Map<number, number>();
  /** tile index -> fluid def flowing THROUGH a grate flush against solid
   *  ground (no gap to fall into) — an overlay, not a tile swap, so the
   *  grate stays the real tile and stays walkable. See placeFluid. */
  private grateFluid = new Map<number, TileDef>();
  private waterFlowEnabled: boolean;
  private spreadClock = 0;
  /** Tile index -> chain depth for cells a lava-caused melt vacated last
   *  spread tick — they radiate lava's heat for exactly one more tick so a
   *  consecutive run of metal (or ice) chain-melts tile by tile, the same
   *  way an actively burning tile keeps igniting its own neighbors each
   *  tick. Melting is otherwise instantaneous with no equivalent "still
   *  hot" phase, so without this only the ONE tile directly touching the
   *  lava would ever melt. The depth is how many tiles beyond direct lava
   *  contact the chain has traveled — heat_spread's chainMeltRange caps it. */
  private meltedHot = new Map<number, number>();
  private waterFlowClock = 0;
  /** Flips every flow tick. Every "which side first" neighbor check below
   *  alternates on this instead of always trying left first — a fixed
   *  left-first order compounds over hundreds of ticks into a strong,
   *  visible drift (a wide tank observed draining leftmost-column-first,
   *  rightmost-column-last, ~40s apart, despite every column starting with
   *  identical depth and no fall feeding any of them — confirmed by a clean
   *  synthetic repro). Alternating cancels the bias out over time instead of
   *  compounding it in one direction. */
  private flowSideFlip = false;
  /** The side order actually used this tick: flowSideFlip when fluid_flow's
   *  sideBias is "alternate", else pinned left/right (Sean's slosh tunable). */
  private flowFlipEff = false;
  private tilesById = new Map<string, TileDef>();
  /** The behavior-grammar interpreter for this room (content-driven). */
  readonly bhv: BehaviorSystem;
  // Global tunables (behaviors.json global docs; consts above as fallbacks)
  private flowIntervalSec = WATER_FLOW_INTERVAL;
  private spreadIntervalSec = SPREAD_INTERVAL;
  private recedeMsEff = RECEDE_MS;
  private toyblockPushSec = TOYBLOCK_PUSH_TIME;
  private energizeMs = ENERGIZE_MS;
  private freezeSpreadMax = 32;
  private energizeSpreadMax = 600;
  private sideBias = "alternate";
  /** Max tiles a lava melt may chain beyond direct contact (-1 = unlimited). */
  private chainMeltRange = -1;
  /** Seeded (not Math.random) so scatter-drop launch velocity replays
   *  deterministically, same as taunts. */
  private rng: Rng;

  constructor(
    public room: RoomDef,
    private content: Content,
    readonly muts: RoomMutations,
    /** npcIds helped anywhere this run — gates requiresHelped/hiddenIfHelped
     *  entities (pair scenes, the send-off). Optional so the editor's
     *  preview and headless tests see every unconditional entity. */
    private helpedNpcIds: ReadonlySet<string> = new Set(),
    runSeed = 0
  ) {
    this.rng = new Rng((runSeed >>> 0) || 1);
    this.map = new TileMap(room, content.tiles);
    for (const t of content.tiles) this.tilesById.set(t.id, t);
    this.bhv = new BehaviorSystem(content);
    {
      // Global sim tunables from behaviors.json (content wins, consts fall back).
      const num = (v: unknown, fb: number) =>
        typeof v === "number" && Number.isFinite(v) ? v : fb;
      const flow = this.bhv.globalParams("fluidFlow");
      this.flowIntervalSec = num(flow.intervalSec, WATER_FLOW_INTERVAL);
      this.sideBias = typeof flow.sideBias === "string" ? flow.sideBias : "alternate";
      this.recedeMsEff = num(flow.recedeMs, RECEDE_MS);
      this.toyblockPushSec = num(flow.toyblockPushSec, TOYBLOCK_PUSH_TIME);
      const heat = this.bhv.globalParams("heatSpread");
      this.spreadIntervalSec = num(heat.intervalSec, SPREAD_INTERVAL);
      this.chainMeltRange = num(heat.chainMeltRange, -1);
      const fx = this.bhv.globalParams("elementEffects");
      this.energizeMs = num(fx.energizeMs, ENERGIZE_MS);
      this.freezeSpreadMax = num(fx.freezeSpreadMax, 32);
      this.energizeSpreadMax = num(fx.energizeSpreadMax, 600);
    }
    for (const [idx, tileId] of muts.tileOverrides) {
      this.map.overrides.set(idx, tileId ? this.tilesById.get(tileId) ?? null : null);
    }

    // A door/trapdoor's own footprint always wins over the tile grid — a
    // solid tile authored (or later painted) under a gate would make it
    // structurally impossible to ever pass through no matter its open/closed
    // state, since a gate only blocks an already-open cell, it never carves
    // one out of solid ground itself. Enforced here (not just on placement)
    // so it self-heals already-authored rooms too, before fall/fluid
    // connectivity below is computed against the tile grid.
    for (const def of room.entities) {
      if (def.type !== "door" && def.type !== "trapdoor") continue;
      const [w, h] = this.entitySize(def.type);
      const cx = def.x * TILE + TILE / 2;
      const feetY = (def.y + 1) * TILE;
      const tx0 = Math.floor((cx - w / 2) / TILE);
      const tx1 = Math.floor((cx - w / 2 + w - 1) / TILE);
      const ty0 = Math.floor((feetY - h) / TILE);
      const ty1 = Math.floor((feetY - 1) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (this.map.at(tx, ty)?.solid) this.map.setTile(tx, ty, null);
        }
      }
    }

    this.waterFlowEnabled = content.game.rules.waterFlowEnabled ?? true;
    if (this.waterFlowEnabled) {
      for (let ty = 0; ty < this.map.height; ty++) {
        for (let tx = 0; tx < this.map.width; tx++) {
          const def = this.map.at(tx, ty);
          if (!def) continue;
          const idx = this.map.index(tx, ty);
          if (this.isFluid(def)) this.waterFlowDist.set(idx, 0);
          if (def.fallSpawns) this.fallTiles.add(idx);
        }
      }
      // A hand-authored pool touching a fall (the editor's way of pre-filling
      // a fall's landing spot instead of waiting for the sim to grow it tile
      // by tile) is just as infinite as the fall feeding it — flood-fill
      // SOURCED out from every fall tile through connected same-element
      // fluid, or an authored pool stays finite forever and refuses to widen
      // once liberated (e.g. a hammer opening a sealed floor beneath it).
      const neighborsOf = (tx: number, ty: number) =>
        [[tx - 1, ty], [tx + 1, ty], [tx, ty - 1], [tx, ty + 1]] as const;
      const queue: number[] = [];
      for (const idx of this.fallTiles) {
        const tx = idx % this.map.width;
        const ty = Math.floor(idx / this.map.width);
        const fluidDef = this.tilesById.get(this.map.at(tx, ty)?.fallSpawns ?? "");
        if (!fluidDef) continue;
        for (const [nx, ny] of neighborsOf(tx, ty)) {
          const ndef = this.map.at(nx, ny);
          if (!ndef || !this.isFluid(ndef) || ndef.element !== fluidDef.element) continue;
          const nidx = this.map.index(nx, ny);
          if (this.waterFlowDist.get(nidx) === SOURCED) continue;
          this.waterFlowDist.set(nidx, SOURCED);
          queue.push(nidx);
        }
      }
      while (queue.length) {
        const idx = queue.pop()!;
        const tx = idx % this.map.width;
        const ty = Math.floor(idx / this.map.width);
        const def = this.map.at(tx, ty);
        if (!def) continue;
        for (const [nx, ny] of neighborsOf(tx, ty)) {
          if (nx < 0 || nx >= this.map.width || ny < 0 || ny >= this.map.height) continue;
          const ndef = this.map.at(nx, ny);
          if (!ndef || !this.isFluid(ndef) || ndef.element !== def.element) continue;
          const nidx = this.map.index(nx, ny);
          if (this.waterFlowDist.get(nidx) === SOURCED) continue;
          this.waterFlowDist.set(nidx, SOURCED);
          queue.push(nidx);
        }
      }
    }

    room.entities.forEach((def, index) => {
      // Run-reactive presence: pair scenes and gatherings only exist once the
      // player's help earned them; fallback variants only while they haven't.
      if (def.requiresHelped?.some((id) => !this.helpedNpcIds.has(id))) return;
      if (def.hiddenIfHelped?.some((id) => this.helpedNpcIds.has(id))) return;
      const cx = def.x * TILE + TILE / 2;
      const feetY = (def.y + 1) * TILE;
      if (def.type === "spawn") {
        this.spawnX = cx;
        this.spawnY = feetY;
        return;
      }
      if (def.type === "enemy") {
        if (muts.disabledEnemies.has(index)) return;
        const edef = content.enemies.find((e) => e.id === def.enemy);
        if (!edef) return;
        this.enemies.push({
          index, def: edef,
          x: cx - edef.width / 2,
          y: feetY - edef.height,
          vx: 0, vy: 0, facing: 1,
          state: "patrol", // everyone drifts a route; chasers escalate on sight
          stunUntil: 0, lastSawPlayerAt: 0, lastHazardAt: 0,
          homeX: cx,
          patrolMin: (def.patrolMinX ?? def.x - 3) * TILE,
          patrolMax: (def.patrolMaxX ?? def.x + 3) * TILE,
        });
        return;
      }
      const [w, h] = this.entitySize(def.type);
      const litOverride = muts.brazierLit.find(([i]) => i === index);
      // Doors/trapdoors can be authored to start open; a fuse trip (open or
      // close) overrides that for the rest of the run once it happens.
      const isGate = def.type === "door" || def.type === "trapdoor";
      const open = isGate && !muts.gateTouched.has(index)
        ? !!def.startOpen
        : muts.openedDoors.has(index);
      this.entities.push({
        index, def, kind: def.type,
        x: cx - w / 2, y: feetY - h, w, h,
        collected: muts.collected.has(index),
        open,
        helped: muts.helpedNpcs.has(index),
        lit: litOverride ? litOverride[1] : def.lit ?? true,
      });
    });

    for (const d of muts.drops) {
      this.drops.push(d);
    }
    for (const p of muts.placedItems) {
      this.placed.push(this.makePlacedInstance(p));
    }
  }

  /** Entity footprint: content/entities.json wins, code table falls back. */
  private entitySize(type: RoomEntity["type"]): [number, number] {
    const et = this.content.entityTypes?.find((e) => e.id === type);
    if (et && typeof et.width === "number" && typeof et.height === "number") {
      return [et.width, et.height];
    }
    return ENTITY_SIZES[type] ?? [16, 16];
  }

  private makePlacedInstance(p: PlacedItem): PlacedInstance {
    const size: [number, number] = p.type === "spring" ? [16, 8] : [16, 8];
    return { data: p, x: p.x, y: p.y, w: size[0], h: size[1] };
  }

  // ================= ELEMENTAL CORE =================

  private findRule(actor: string, tile: TileDef): ParsedRule | undefined {
    for (const r of this.content.rules) {
      const p = ruleOf(r);
      if (!p || p.actor !== actor) continue;
      if (p.target) {
        if (p.target === tile.element) return p;
        continue;
      }
      if (p.targetProperty && (tile as unknown as Record<string, unknown>)[p.targetProperty]) {
        return p;
      }
    }
    return undefined;
  }

  private setTileById(tx: number, ty: number, tileId: string | undefined): void {
    const id = tileId ?? "";
    const def = id ? this.tilesById.get(id) ?? null : null;
    this.map.setTile(tx, ty, def);
    const idx = this.map.index(tx, ty);
    this.burning.delete(idx);
    // Persist (replace any earlier override for this index)
    this.muts.tileOverrides = this.muts.tileOverrides.filter(([i]) => i !== idx);
    this.muts.tileOverrides.push([idx, id || null]);
    // Any transform that produces a fluid (ice melting, cracked stone
    // lava-ing) joins the flow sim too, not just fluid poured by spreading —
    // otherwise it sits inert, ignoring open space (and drains) next to it.
    if (this.waterFlowEnabled && def && this.isFluid(def)) {
      if (!this.waterFlowDist.has(idx)) this.waterFlowDist.set(idx, 0);
    }
    if (def?.fallSpawns) this.fallTiles.add(idx);
    else this.fallTiles.delete(idx);
  }

  /** Water/lava — anything that falls and spreads. `fluid` in tiles.json;
   *  style "water" kept as a fallback so stale content keeps flowing. */
  private isFluid(def: TileDef): boolean {
    return !!def.fluid || def.style === "water";
  }

  /** A closed gate (door + trapdoor) blocks fluid exactly like it blocks the
   *  player — open gates and plain (non-gated) teleport doors don't. */
  private doorBlocksFluid(tx: number, ty: number): boolean {
    const box = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
    return this.entities.some(
      (e) => (e.kind === "door" || e.kind === "trapdoor") && e.def.gate && !e.open && rectsOverlap(e, box)
    );
  }

  /**
   * Where would fluid entering column tx at row ty actually come to rest?
   * Grates are transparent horizontally too — a walkway sitting flush over
   * a solid floor leaves no empty cell of its own, so fluid spreading along
   * it has to be understood as resting on the real floor one layer down,
   * same as if it fell there. This is realTileBelow's raw result collapsed
   * to "can I enter, and where": genuinely open -> that cell; resting on
   * more fluid (or truly blocked) -> solid; blocked by real ground/a closed
   * gate but reachable only through ≥1 grate -> flood the last grate passed
   * instead of giving up. Callers that need to react differently to WHAT
   * is blocking (tickFalls' mid-fall/drain/quench cases) call
   * realTileBelow directly instead.
   */
  private fluidOccupied(tx: number, ty: number): { ty: number; solid: boolean } {
    const r = this.realTileBelow(tx, ty);
    if (!r.solid) return { ty: r.ty, solid: false };
    if (r.def && this.isFluid(r.def)) return { ty: r.ty, solid: true };
    if (r.grateY >= 0) return { ty: r.grateY, solid: false };
    return { ty: r.ty, solid: true };
  }

  /**
   * Metal grates are transparent to fluid — flow "through them as if they
   * weren't there" instead of resting on top. Walks downward from (tx,ty)
   * skipping consecutive platform-style tiles, and reports the first REAL
   * (non-platform) cell reached — `def`/`solid` describe THAT cell exactly
   * (null+not-solid = genuinely open; a real tile, fluid or otherwise, is
   * solid; a closed gate is solid with `grateY` forced to -1, since gates
   * always fully block, no flooding around them). `grateY` separately
   * reports the last grate tile passed through, when there was one — the
   * fallback resting spot a caller MAY use instead of giving up when the
   * real cell here turns out to be an ordinary dead-end wall (a grate
   * flush against solid ground has no empty cell of its own to offer).
   * Off the map reports ty === map.height, not solid, no grate fallback.
   */
  private realTileBelow(
    tx: number, ty: number
  ): { ty: number; def: TileDef | null; solid: boolean; grateY: number } {
    let y = ty;
    let lastGrateY = -1;
    while (y < this.map.height) {
      if (this.doorBlocksFluid(tx, y)) return { ty: y, def: null, solid: true, grateY: -1 };
      const t = this.map.at(tx, y);
      if (t === null) return { ty: y, def: null, solid: false, grateY: -1 };
      if (t.style !== "platform") return { ty: y, def: t, solid: true, grateY: lastGrateY };
      lastGrateY = y;
      y++;
    }
    return { ty: y, def: null, solid: false, grateY: -1 };
  }

  /**
   * Place fluid at (tx,ty). If that cell is a metal grate, the grate and
   * the fluid occupy the same space — the tile stays a grate (still
   * walkable, still renders as a platform) and the fluid rides underneath
   * as an overlay (see drawGrateFluid) instead of overwriting it. Anywhere
   * else this is just a normal tile placement.
   */
  private placeFluid(tx: number, ty: number, fluidDef: TileDef): void {
    const idx = this.map.index(tx, ty);
    if (this.map.at(tx, ty)?.style === "platform") {
      const existing = this.grateFluid.get(idx);
      if (existing && existing.element !== fluidDef.element) {
        // Opposite fluids meeting under the same grate: both gone (a grate
        // can't harden into cracked stone), the grate itself stays dry.
        this.grateFluid.delete(idx);
        this.waterFlowDist.delete(idx);
        return;
      }
      this.grateFluid.set(idx, fluidDef);
    } else {
      this.setTileById(tx, ty, fluidDef.id);
    }
  }

  /** Remove fluid from (tx,ty) — clears a grate overlay if that's what's
   *  carrying it, otherwise clears the tile itself. */
  private clearFluid(tx: number, ty: number): void {
    const idx = this.map.index(tx, ty);
    if (this.grateFluid.has(idx)) this.grateFluid.delete(idx);
    else this.setTileById(tx, ty, undefined);
  }

  /** The fluid logically AT (tx,ty) — a grate's overlay fluid if it's
   *  carrying any, else the real tile itself if that's a fluid, else null. */
  private fluidDefAt(tx: number, ty: number): TileDef | null {
    const grate = this.grateFluid.get(this.map.index(tx, ty));
    if (grate) return grate;
    const t = this.map.at(tx, ty);
    return t && this.isFluid(t) ? t : null;
  }

  /**
   * Water/lava contact: both are destroyed, leaving only cracked stone at
   * the STATIONARY side's position (Sean's rule). Checks (nx,ny)'s
   * neighbors — excluding the mover's own vacated cell — for the opposite
   * fluid; if found, hardens that stationary neighbor into cracked stone
   * and reports true so the caller skips placing the mover there at all
   * (the mover is destroyed rather than relocating/replicating into it).
   */
  private resolveFluidContact(
    nx: number, ny: number, moverDef: TileDef, fromTx: number, fromTy: number, events: ElementEvent[]
  ): boolean {
    if (moverDef.element !== "water" && moverDef.element !== "lava") return false;
    const opposite = moverDef.element === "water" ? "lava" : "water";
    const neighbors = [[nx - 1, ny], [nx + 1, ny], [nx, ny - 1], [nx, ny + 1]] as const;
    for (const [ox, oy] of neighbors) {
      if (ox === fromTx && oy === fromTy) continue;
      const odef = this.fluidDefAt(ox, oy);
      if (!odef || odef.element !== opposite) continue;
      const lavaDef = moverDef.element === "lava" ? moverDef : odef;
      if (this.grateFluid.has(this.map.index(ox, oy))) {
        // The grate itself can't harden into cracked stone — it's just not
        // carrying fluid anymore.
        this.grateFluid.delete(this.map.index(ox, oy));
      } else {
        this.transformTile(ox, oy, lavaDef.extinguishesTo ?? "cracked");
      }
      this.waterFlowDist.delete(this.map.index(ox, oy));
      events.push({ effect: "extinguish", x: ox * TILE + 8, y: oy * TILE + 8, color: "#8f9bb3" });
      return true;
    }
    return false;
  }

  /**
   * A fluid tile just left (tx,ty) empty — whether it moved elsewhere or was
   * eaten by a drain. Rather than leave a hole, grab ONE horizontal neighbor
   * (left, then right) that still has fluid and pull it in to take the
   * vacated spot. That neighbor's own old cell is now empty too, so this
   * chains outward the same way — Sean's rule: "if a water block moves, it
   * should grab at least one neighbor to take its place," applied uniformly
   * wherever fluid disappears from a cell (drain absorption included),
   * which is what lets a whole connected flat body (not just a
   * tiered/sourced one) actually empty into a drain instead of losing only
   * the one tile touching it. `visited` stops a chain from doubling back on
   * itself in a loop; conservation (never duplicates) is automatic since
   * each step is a MOVE, not a copy.
   *
   * Deliberately horizontal-only — no up/down. Vertical movement is already
   * handled unconditionally, every tick, by case 1 (fall) for every
   * registered tile, and case 3 explicitly defers "the column above falls
   * into the vacated space" to the *next* tick, by design. Grabbing
   * vertically here would race that same-tick and immediately undo it —
   * confirmed by a repro (a fall feeding a wide room through a narrow neck):
   * with vertical grabbing included, the tile touching the drain and the
   * tile above it swapped back and forth every tick, netting zero progress
   * forever, well before the room ever ran dry.
   *
   * `grab` is false for a SOURCED tile's own routine fall/slide — that body
   * already has its own unconditional "replicate outward, no cap" mechanic
   * (case 4 below) once it lands, so pulling a neighbor in behind it while
   * it's still mid-fall would fight that instead of helping. Drain
   * absorption always grabs regardless of what's being drained.
   */
  private vacate(
    tx: number, ty: number, events: ElementEvent[], visited = new Set<number>(), grab = true
  ): void {
    this.clearFluid(tx, ty);
    const idx = this.map.index(tx, ty);
    this.waterFlowDist.delete(idx);
    if (!grab) return;
    visited.add(idx);
    const dirs = this.flowFlipEff ? [[1, 0], [-1, 0]] as const : [[-1, 0], [1, 0]] as const;
    for (const [dx, dy] of dirs) {
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || nx >= this.map.width || ny < 0 || ny >= this.map.height) continue;
      const nIdx = this.map.index(nx, ny);
      if (visited.has(nIdx)) continue;
      const ndef = this.fluidDefAt(nx, ny);
      if (!ndef) continue;
      if (this.resolveFluidContact(tx, ty, ndef, nx, ny, events)) {
        // The grabbed neighbor hardens/quenches on contact instead of
        // relocating — it's destroyed, so try the next direction instead.
        this.waterFlowDist.delete(nIdx);
        this.clearFluid(nx, ny);
        continue;
      }
      const d = this.waterFlowDist.get(nIdx) ?? 0;
      this.placeFluid(tx, ty, ndef);
      this.waterFlowDist.set(idx, d);
      events.push({ effect: "flow", x: tx * TILE + 8, y: ty * TILE + 8, color: ndef.color });
      this.vacate(nx, ny, events, visited);
      return;
    }
  }

  /**
   * Transform a tile via a rule effect (melt/shatter/dissolve/burn/quench).
   * Unlike raw setTileById this also pays out the tile's `dropsItem` as a
   * recoverable bundle — how a metal block melted by lava becomes scrap.
   */
  private transformTile(tx: number, ty: number, next: string | undefined): void {
    const def = this.map.at(tx, ty);
    if (def?.dropsItem) {
      this.spawnScatterDrop(tx * TILE + 8, ty * TILE + 8, def.dropsItem, 1);
    }
    this.setTileById(tx, ty, next);
  }

  igniteTile(tx: number, ty: number): boolean {
    const def = this.map.at(tx, ty);
    const idx = this.map.index(tx, ty);
    if (!def?.flammable || this.burning.has(idx)) return false;
    this.burning.set(idx, def.burnTime ?? 2.5);
    return true;
  }

  /** Balloons pop from ANY tool's use, no element check — pure whimsy, not
   *  part of the elemental rule system. Returns the popped positions so the
   *  caller can spawn particles/sfx. */
  popBalloonsIn(box: Rect): { x: number; y: number }[] {
    const tx0 = Math.max(0, Math.floor(box.x / TILE));
    const tx1 = Math.min(this.map.width - 1, Math.floor((box.x + box.w) / TILE));
    const ty0 = Math.max(0, Math.floor(box.y / TILE));
    const ty1 = Math.min(this.map.height - 1, Math.floor((box.y + box.h) / TILE));
    const popped: { x: number; y: number }[] = [];
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.map.at(tx, ty)?.style !== "balloon") continue;
        this.setTileById(tx, ty, undefined);
        popped.push({ x: tx * TILE + 8, y: ty * TILE + 8 });
      }
    }
    return popped;
  }

  /** A tile the tile grid treats as ground to rest on — solid walls plus
   *  one-way platforms (a toyblock sits on a grate same as the player does). */
  private isFloorTile(tx: number, ty: number): boolean {
    if (ty < 0 || ty >= this.map.height) return true;
    const def = this.map.at(tx, ty);
    return !!(def?.solid || def?.oneWay);
  }

  /** The player let go of movement (or is pushing nothing) — any in-progress
   *  lean-on-a-toyblock timer drops back to zero, so a later push starts
   *  fresh rather than resuming from a stale partial count. */
  resetToyblockPush(): void {
    this.toyblockPush.clear();
  }

  /**
   * Walking into a toyblock (dir -1/1) leans on it; sustained contact for
   * TOYBLOCK_PUSH_TIME hops it one tile over, grid-locked — no continuous
   * sub-tile physics. Call resetToyblockPush() whenever contact breaks (the
   * caller stops holding movement) so progress doesn't linger. Returns true
   * if (tx,ty) held a toyblock being leaned on this frame (whether or not it
   * actually moved), so the caller knows contact happened and can stop
   * scanning further rows.
   */
  pushToyblock(tx: number, ty: number, dir: -1 | 1, dt: number): boolean {
    const def = this.map.at(tx, ty);
    if (def?.style !== "toyblock") return false;
    const idx = this.map.index(tx, ty);
    const destX = tx + dir;
    const blocked = destX < 0 || destX >= this.map.width || !!this.map.at(destX, ty)?.solid;
    if (blocked) {
      this.toyblockPush.delete(idx);
      return true;
    }
    const t = (this.toyblockPush.get(idx) ?? 0) + dt;
    if (t >= this.toyblockPushSec) {
      this.setTileById(destX, ty, def.id);
      this.setTileById(tx, ty, undefined);
      this.toyblockPush.delete(idx);
    } else {
      this.toyblockPush.set(idx, t);
    }
    return true;
  }

  /** Toyblocks fall exactly like fluids do — one tile per flow tick — when
   *  nothing (solid or one-way platform) is holding them up. Scanning from
   *  the bottom row upward lets a stack fall in lockstep within one tick,
   *  same ordering trick the fluid sim uses for its column pressure squeeze. */
  private tickToyblockFalls(): void {
    for (let ty = this.map.height - 2; ty >= 0; ty--) {
      for (let tx = 0; tx < this.map.width; tx++) {
        const def = this.map.at(tx, ty);
        if (def?.style !== "toyblock") continue;
        if (this.isFloorTile(tx, ty + 1)) continue;
        this.setTileById(tx, ty + 1, def.id);
        this.setTileById(tx, ty, undefined);
      }
    }
  }

  /** Apply an element to every tile in a pixel-space box. Returns events. */
  applyElementToTiles(element: string | undefined, box: Rect): ElementEvent[] {
    const events: ElementEvent[] = [];
    if (!element) return events;
    const tx0 = Math.max(0, Math.floor(box.x / TILE));
    const tx1 = Math.min(this.map.width - 1, Math.floor((box.x + box.w) / TILE));
    const ty0 = Math.max(0, Math.floor(box.y / TILE));
    const ty1 = Math.min(this.map.height - 1, Math.floor((box.y + box.h) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const def = this.map.at(tx, ty);
        if (!def) continue;
        const idx = this.map.index(tx, ty);
        const cx = tx * TILE + 8;
        const cy = ty * TILE + 8;
        // Water on a burning (but not water-element) tile: put it out.
        if (element === "water" && this.burning.has(idx)) {
          this.burning.delete(idx);
          events.push({ effect: "extinguish", x: cx, y: cy, color: "#4fc3f7" });
          continue;
        }
        const rule = this.findRule(element, def);
        if (!rule) continue;
        switch (rule.effect) {
          case "ignite":
            if (this.igniteTile(tx, ty)) {
              events.push({ effect: "ignite", x: cx, y: cy, color: "#ff7043" });
            }
            break;
          case "melt":
            // No meltsTo = this tile doesn't melt. Guard matters: melt rules
            // can target a whole element (fire→stone hits walls too) and
            // only the tiles that opt in (cracked→lava) should respond.
            if (def.meltsTo === undefined) break;
            this.transformTile(tx, ty, def.meltsTo);
            events.push({ effect: "melt", x: cx, y: cy, color: "#b3e5fc" });
            break;
          case "extinguish":
            this.transformTile(tx, ty, def.extinguishesTo);
            events.push({ effect: "extinguish", x: cx, y: cy, color: "#8f9bb3" });
            break;
          case "dissolve":
            this.transformTile(tx, ty, def.dissolvesTo);
            events.push({ effect: "dissolve", x: cx, y: cy, color: def.color });
            break;
          case "freeze":
            this.freezeFrom(tx, ty, events);
            break;
          case "shatter":
            this.transformTile(tx, ty, def.shattersTo);
            events.push({ effect: "shatter", x: cx, y: cy, color: def.color });
            break;
          case "energize":
            this.energizeFrom(tx, ty, events);
            break;
          case "fizzle":
            events.push({ effect: "fizzle", x: cx, y: cy, color: "#cfd8dc" });
            break;
          // ignite_self is a carrier-item rule; Game handles it.
        }
      }
    }
    return events;
  }

  /**
   * Blanket a circle of tiles in smoke. Stealth is positional: standing in
   * a smoked tile hides the player; a spotter in smoke can't see out of it.
   */
  addSmokeCloud(px: number, py: number, radiusPx: number, durationMs: number): void {
    const until = simNow() + durationMs;
    const ctx0 = Math.floor(px / TILE);
    const cty0 = Math.floor(py / TILE);
    const rt = radiusPx / TILE;
    const r = Math.ceil(rt);
    for (let ty = cty0 - r; ty <= cty0 + r; ty++) {
      for (let tx = ctx0 - r; tx <= ctx0 + r; tx++) {
        if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) continue;
        if (Math.hypot(tx - ctx0, ty - cty0) > rt) continue;
        const idx = this.map.index(tx, ty);
        this.smoked.set(idx, Math.max(this.smoked.get(idx) ?? 0, until));
      }
    }
  }

  smokeAtPoint(x: number, y: number): boolean {
    const until = this.smoked.get(this.map.index(Math.floor(x / TILE), Math.floor(y / TILE)));
    return !!until && until > simNow();
  }

  /** Is any orthogonal neighbor of (tx,ty) a drain tile? */
  private tileTouchesDrain(tx: number, ty: number): boolean {
    return (
      this.map.at(tx - 1, ty)?.style === "drain" ||
      this.map.at(tx + 1, ty)?.style === "drain" ||
      this.map.at(tx, ty - 1)?.style === "drain" ||
      this.map.at(tx, ty + 1)?.style === "drain"
    );
  }

  /**
   * Fluid physics (water AND lava): fluids fall into open shafts and spread
   * sideways along floors. Poured/melted fluid keeps the Minecraft-style
   * distance cap; fall-fed (SOURCED) fluid spreads uncapped until walls
   * contain it or a drain eats it. Only ever fills genuinely empty tiles.
   * Water and lava meeting quenches the lava into its extinguishesTo
   * (cracked stone) — the water survives.
   */
  /** [tx-1, tx+1] or [tx+1, tx-1], per the sideBias tunable — see flowFlipEff. */
  private sideXs(tx: number): [number, number] {
    return this.flowFlipEff ? [tx + 1, tx - 1] : [tx - 1, tx + 1];
  }

  private tickWaterFlow(events: ElementEvent[]): void {
    if (!this.waterFlowEnabled) return;
    this.flowSideFlip = !this.flowSideFlip;
    // sideBias tunable: "alternate" keeps the drift-cancelling flip;
    // "left"/"right" pin every side check to one direction.
    this.flowFlipEff = this.sideBias === "alternate" ? this.flowSideFlip : this.sideBias === "right";
    this.tickFalls(events);

    // Pre-pass: drains eat every adjacent fluid tile BEFORE anything moves,
    // so water queued above a drain vanishes instead of overflowing around
    // the queue. This ordering is what lets base-side drains fully contain
    // a melting tower's runoff.
    //
    // Find every drain-touching tile FIRST, then vacate them all with that
    // whole set pre-excluded from the grab-chain. Without this, a wide bank
    // of drains only drained a couple of tiles per tick: eating tile A would
    // immediately grab-chain sideways into tile B, which was ALSO about to
    // be independently eaten this same pass — wasted effort reshuffling
    // water that was getting erased either way, instead of actually
    // removing more of it. Excluding the whole doomed row forces the chain
    // to reach past it into water that wouldn't otherwise go this tick, so
    // a wide drain genuinely drains proportionally faster, and the row
    // above falls to replace the whole gap via the ordinary (unconditional,
    // every tick) case 1 fall — no chain needed for that part at all.
    const doomed = new Set<number>();
    for (const [idx] of this.waterFlowDist) {
      const tx = idx % this.map.width;
      const ty = Math.floor(idx / this.map.width);
      if (this.fluidDefAt(tx, ty) && this.tileTouchesDrain(tx, ty)) doomed.add(idx);
    }
    for (const idx of doomed) {
      const tx = idx % this.map.width;
      const ty = Math.floor(idx / this.map.width);
      if (!this.fluidDefAt(tx, ty)) continue; // an earlier chain in this pass already took it
      events.push({ effect: "flow", x: tx * TILE + 8, y: ty * TILE + 8, color: "#5a5470" });
      this.vacate(tx, ty, events, new Set(doomed));
    }

    // Main pass, bottom-up (lower tiles vacate first so columns funnel
    // downward in single file). Movement rules, in order:
    //   1. below empty  -> MOVE down (falling never leaves a copy behind)
    //   2. below fluid  -> wait, unless the tile below rests on solid —
    //      then one diagonal slide into an open hole is allowed
    //   3. below solid, fluid above -> column pressure: MOVE sideways
    //   4. below solid, surface tile -> SOURCED replicates outward; finite
    //      fluid only MOVES toward an adjacent hole (fully conserved)
    // Net effect: fluid never widens until it has fully fallen downward,
    // and a finite body slushes downhill as a body — it never multiplies.
    //
    // Row order (descending y) must stay fixed — that's what makes a column
    // funnel downward in a single pass. But the intra-row tie-break (which
    // column within the same row gets processed, and so gets first pick of
    // an open neighbor, before the others) also alternates with
    // flowSideFlip: leaving it fixed (always descending x) reintroduced the
    // same left/right drain-rate bias as the neighbor-check order, just from
    // a different source — whichever side processes first also gets to move
    // first, tick after tick, in the same direction.
    const width = this.map.width;
    const sorted = [...this.waterFlowDist].sort((a, b) => {
      const ay = Math.floor(a[0] / width), by = Math.floor(b[0] / width);
      if (ay !== by) return by - ay;
      const ax = a[0] % width, bx = b[0] % width;
      return this.flowFlipEff ? ax - bx : bx - ax;
    });
    for (const [idx, distance] of sorted) {
      const tx = idx % this.map.width;
      const ty = Math.floor(idx / this.map.width);
      const def = this.fluidDefAt(tx, ty);
      if (!def) {
        this.waterFlowDist.delete(idx);
        continue;
      }
      // Lava beside water hardens (extinguishesTo, i.e. cracked stone).
      // Fallback path only: real movement-caused contact is resolved at the
      // moment of the move/replicate below via resolveFluidContact, which
      // correctly destroys the MOVING side. A lava tile that's already
      // sitting still next to water (e.g. authored adjacent) has no mover
      // to blame, so it defaults to hardening itself and destroying the
      // water — still "one side cracked, the other gone", just a fixed
      // default absent better information.
      if (def.element === "lava" && def.extinguishesTo !== undefined) {
        const waterNeighbor = ([[tx - 1, ty], [tx + 1, ty], [tx, ty - 1], [tx, ty + 1]] as const)
          .find(([nx, ny]) => this.fluidDefAt(nx, ny)?.element === "water");
        if (waterNeighbor) {
          this.clearFluid(waterNeighbor[0], waterNeighbor[1]);
          this.waterFlowDist.delete(this.map.index(waterNeighbor[0], waterNeighbor[1]));
          if (this.grateFluid.has(idx)) this.grateFluid.delete(idx);
          else this.transformTile(tx, ty, def.extinguishesTo);
          this.waterFlowDist.delete(idx);
          events.push({ effect: "extinguish", x: tx * TILE + 8, y: ty * TILE + 8, color: "#8f9bb3" });
          continue;
        }
      }
      const moveTo = (nx: number, ny: number, d: number) => {
        // Seed vacate's visited set with the destination — otherwise the
        // grab-chain could immediately pull the very tile that just moved
        // back where it came from (an infinite ping-pong).
        const cameFrom = new Set<number>([this.map.index(nx, ny)]);
        const grabAfter = distance !== SOURCED;
        if (this.resolveFluidContact(nx, ny, def, tx, ty, events)) {
          // Contact: the mover is destroyed instead of relocating. The
          // origin still vacates (and grabs a neighbor of its own).
          this.vacate(tx, ty, events, cameFrom, grabAfter);
          return;
        }
        this.placeFluid(nx, ny, def);
        this.waterFlowDist.set(this.map.index(nx, ny), d);
        events.push({ effect: "flow", x: nx * TILE + 8, y: ny * TILE + 8, color: def.color });
        this.vacate(tx, ty, events, cameFrom, grabAfter);
      };
      // 1. Fall (as a move) — metal grates are transparent, so this skips
      // straight through any directly beneath to the first real open cell,
      // or floods a grate flush against solid ground if that's all there is.
      const belowInfo = this.realTileBelow(tx, ty + 1);
      const fallTarget = this.fluidOccupied(tx, ty + 1);
      if (!fallTarget.solid) {
        moveTo(tx, fallTarget.ty, distance === SOURCED ? SOURCED : 0);
        continue;
      }
      const below = belowInfo.def;
      // 2. Part of a column still settling.
      if (below && this.isFluid(below)) {
        const belowBelowInfo = this.realTileBelow(tx, belowInfo.ty + 1);
        const columnGrounded = belowBelowInfo.ty >= this.map.height ||
          (belowBelowInfo.solid && !(belowBelowInfo.def && this.isFluid(belowBelowInfo.def)));
        if (columnGrounded) {
          for (const nx of this.sideXs(tx)) {
            if (nx < 0 || nx >= this.map.width) continue;
            const target = this.fluidOccupied(nx, ty);
            if (target.solid) continue;
            // "Into an open hole": there must be room below the landing spot
            // too, not just a single flat opening at ty.
            const holeBelow = this.fluidOccupied(nx, target.ty + 1);
            if (holeBelow.ty >= this.map.height || holeBelow.solid) continue;
            moveTo(nx, target.ty, distance);
            break;
          }
        }
        continue;
      }
      // Fully fallen from here down.
      const hasFluidAbove = ty > 0 && !!this.fluidDefAt(tx, ty - 1);
      if (hasFluidAbove) {
        // 3. Column pressure: the base squeezes out sideways (a move), the
        // column above falls into the vacated space next tick.
        for (const nx of this.sideXs(tx)) {
          if (nx < 0 || nx >= this.map.width) continue;
          const target = this.fluidOccupied(nx, ty);
          if (target.solid) continue;
          moveTo(nx, target.ty, distance);
          break;
        }
        continue;
      }
      // 4. Surface tile, fully fallen.
      if (distance === SOURCED) {
        // Fall-fed fluid IS an infinite source — it replicates outward until
        // walls or a drain stop it.
        for (const nx of this.sideXs(tx)) {
          if (nx < 0 || nx >= this.map.width) continue;
          const target = this.fluidOccupied(nx, ty);
          if (target.solid) continue;
          if (this.resolveFluidContact(nx, target.ty, def, tx, ty, events)) continue;
          const nIdx = this.map.index(nx, target.ty);
          this.placeFluid(nx, target.ty, def);
          this.waterFlowDist.set(nIdx, SOURCED);
          events.push({ effect: "flow", x: nx * TILE + 8, y: target.ty * TILE + 8, color: def.color });
        }
        continue;
      }
      // Finite fluid (melted/poured) is CONSERVED — it never replicates.
      // It only moves toward an adjacent hole it can fall into, so when a
      // neighboring tile drops away the grounded body follows it down: the
      // whole thing slushes downhill instead of becoming an infinite source.
      for (const nx of this.sideXs(tx)) {
        if (nx < 0 || nx >= this.map.width) continue;
        const target = this.fluidOccupied(nx, ty);
        if (target.solid) continue;
        const holeBelow = this.fluidOccupied(nx, target.ty + 1);
        if (holeBelow.ty >= this.map.height || holeBelow.solid) continue;
        moveTo(nx, target.ty, distance);
        break;
      }
    }
    this.dispatchEntityFlowTick(events);
  }

  /**
   * Fall tiles (waterfall/lavafall) are self-sustaining sources. Each tick,
   * one tile per fall: open space below grows the fall downward (a whole
   * fall from one authored tile); a drain directly below absorbs everything
   * (the authored escape valve); anything else makes this the fall's base —
   * it emits its fluid into open side tiles as SOURCED (uncapped) flow, and
   * keeps any fluid pool directly below topped up as a source. A fall
   * meeting the opposite liquid caps it into the lava's hardened form.
   */
  private tickFalls(events: ElementEvent[]): void {
    for (const idx of [...this.fallTiles]) {
      const tx = idx % this.map.width;
      const ty = Math.floor(idx / this.map.width);
      const def = this.map.at(tx, ty);
      if (!def?.fallSpawns) {
        this.fallTiles.delete(idx);
        continue;
      }
      if (ty + 1 >= this.map.height) continue;
      // Metal grates are transparent to fluid — a fall skips straight
      // through any directly below instead of resting on them. A closed
      // gate is the opposite: solid to fluid even where the tile itself is
      // empty, so the fall just stops and waits rather than growing past it.
      const belowInfo = this.realTileBelow(tx, ty + 1);
      if (belowInfo.ty >= this.map.height) continue;
      const below = belowInfo.def;
      const belowTy = belowInfo.ty;
      if (below === null) {
        if (belowInfo.solid) continue; // blocked by a closed door — wait
        // Genuinely open — the fall's own vertical body just keeps growing.
        // (A grate flush against real ground further down is handled below,
        // as the base pool's landing spot, not as fall growth.)
        this.setTileById(tx, belowTy, def.id);
        events.push({ effect: "flow", x: tx * TILE + 8, y: belowTy * TILE + 8, color: def.color });
        continue;
      }
      // Mid-fall tiles (another fall tile below) do nothing; the base acts.
      if (below.id === def.id) continue;
      if (below.style === "drain") continue; // fully absorbed, nothing pools
      const fluidDef = this.tilesById.get(def.fallSpawns);
      if (!fluidDef) continue;
      // Fall landing on the opposite liquid: both destroyed, the STATIONARY
      // pool below hardens into cracked stone (the fall never gets a tile).
      if (this.isFluid(below) && below.element !== fluidDef.element) {
        const lavaSide = below.element === "lava" ? below : fluidDef;
        this.transformTile(tx, belowTy, lavaSide.extinguishesTo ?? "");
        events.push({ effect: "extinguish", x: tx * TILE + 8, y: belowTy * TILE + 8, color: "#8f9bb3" });
        continue;
      }
      // The pool has risen to meet the fall: keep it topped up as a source
      // (so it keeps refilling if drained elsewhere) but STOP here — the
      // fall doesn't also spill sideways over the top of its own pool.
      if (this.isFluid(below)) {
        this.waterFlowDist.set(this.map.index(tx, belowTy), SOURCED);
        continue;
      }
      // First landing on solid ground: this is the fall's true base — start
      // the pool by emitting into open side tiles, one row above the solid
      // (which may be several rows below the fall if grates were skipped).
      const baseTy = belowTy - 1;
      for (const nx of this.sideXs(tx)) {
        if (nx < 0 || nx >= this.map.width) continue;
        // baseTy itself may be a grate spanning the whole walkway (flush over
        // the real floor, no gap) — resolve through it same as falling does,
        // so the pool can spread along/under a grated walkway toward a door
        // instead of being unable to find anywhere to place a single tile.
        const target = this.fluidOccupied(nx, baseTy);
        if (target.solid) continue;
        if (this.resolveFluidContact(nx, target.ty, fluidDef, tx, baseTy, events)) continue;
        this.placeFluid(nx, target.ty, fluidDef);
        this.waterFlowDist.set(this.map.index(nx, target.ty), SOURCED);
        events.push({ effect: "flow", x: nx * TILE + 8, y: target.ty * TILE + 8, color: fluidDef.color });
      }
    }
  }

  /** Per-flow-tick entity behaviors (brazier_flame's water-douse rule lives
   *  here — flowing/pooled water reaching a lit brazier puts it out). */
  private dispatchEntityFlowTick(events: ElementEvent[]): void {
    for (const e of this.entities) {
      const attachments = this.bhv.entityAttachments(e.kind);
      if (attachments.length === 0) continue;
      this.bhv.fire("flowTick", {
        hostDef: e.def as unknown as Record<string, unknown>,
        hostKey: "entity:" + e.index,
        attachments,
        api: { rt: this, e, events },
        builtins: entityBuiltins(this, e),
      });
    }
  }

  /** Flip a brazier's flame and persist it in the room mutations. */
  setBrazierLit(e: EntityInstance, lit: boolean): void {
    e.lit = lit;
    this.muts.brazierLit = this.muts.brazierLit.filter(([i]) => i !== e.index);
    this.muts.brazierLit.push([e.index, lit]);
  }

  /**
   * Water douses lit braziers, fire relights cold ones. Called for tool
   * swings/splashes (alongside applyElementToTiles) and for passive
   * lit-torch contact. Returns events for feedback.
   */
  applyElementToBraziers(element: string | undefined, box: Rect): ElementEvent[] {
    const events: ElementEvent[] = [];
    if (!element) return events;
    for (const e of this.entities) {
      if (!rectsOverlap(e, box)) continue;
      const attachments = this.bhv.entityAttachments(e.kind);
      if (attachments.length === 0) continue;
      this.bhv.fire("elementContact", {
        hostDef: e.def as unknown as Record<string, unknown>,
        hostKey: "entity:" + e.index,
        attachments,
        data: { element },
        api: { rt: this, e, events },
        builtins: entityBuiltins(this, e),
      });
    }
    return events;
  }

  /** Cold propagates across a connected body of water: one vial, one bridge. */
  private freezeFrom(tx: number, ty: number, events: ElementEvent[]): void {
    const startElem = this.map.at(tx, ty)?.element;
    const stack = [[tx, ty]];
    const seen = new Set<number>();
    let count = 0;
    while (stack.length > 0 && count < this.freezeSpreadMax) {
      const [cx, cy] = stack.pop()!;
      const idx = this.map.index(cx, cy);
      if (seen.has(idx)) continue;
      seen.add(idx);
      const def = this.map.at(cx, cy);
      if (!def || def.element !== startElem || !def.freezesTo) continue;
      this.setTileById(cx, cy, def.freezesTo);
      count++;
      events.push({
        effect: "freeze", x: cx * TILE + 8, y: cy * TILE + 8, color: "#b3e5fc",
      });
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  /** Flood charge through connected conductive tiles; trip fuse boxes. */
  private energizeFrom(tx: number, ty: number, events: ElementEvent[]): void {
    const until = simNow() + this.energizeMs;
    const stack = [[tx, ty]];
    const seen = new Set<number>();
    let count = 0;
    while (stack.length > 0 && count < this.energizeSpreadMax) {
      const [cx, cy] = stack.pop()!;
      const idx = this.map.index(cx, cy);
      if (seen.has(idx)) continue;
      seen.add(idx);
      const def = this.map.at(cx, cy);
      if (!def?.conductive) continue;
      this.energized.set(idx, until);
      count++;
      events.push({
        effect: "energize", x: cx * TILE + 8, y: cy * TILE + 8, color: "#ffe95a",
      });
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    if (count > 0) this.checkFuseboxes(events);
  }

  /** A fusebox trips if any energized tile touches it (or its neighbors).
   *  Retriggerable — a door another fusebox has since closed needs to be
   *  reopenable by going back and zapping this one again. */
  private checkFuseboxes(events: ElementEvent[]): void {
    const now = simNow();
    for (const fb of this.entities) {
      if (fb.kind !== "fusebox") continue;
      const tx0 = Math.floor(fb.x / TILE) - 1;
      const tx1 = Math.floor((fb.x + fb.w) / TILE) + 1;
      const ty0 = Math.floor(fb.y / TILE) - 1;
      const ty1 = Math.floor((fb.y + fb.h) / TILE) + 1;
      let hit = false;
      for (let ty = ty0; ty <= ty1 && !hit; ty++) {
        for (let tx = tx0; tx <= tx1 && !hit; tx++) {
          const until = this.energized.get(this.map.index(tx, ty));
          if (until && until > now) hit = true;
        }
      }
      if (hit) this.tripFusebox(fb, events);
    }
  }

  tripFusebox(fb: EntityInstance, events: ElementEvent[]): void {
    fb.open = true;
    this.muts.openedDoors.add(fb.index);
    events.push({ effect: "fuse", x: fb.x + fb.w / 2, y: fb.y, color: "#ffe95a" });
    for (const e of this.entities) {
      if (e.kind !== "door" && e.kind !== "trapdoor") continue;
      const openId = e.def.openFuseId ?? e.def.fuseId;
      if (openId && openId === fb.def.fuseId && !e.open) {
        e.open = true;
        this.muts.openedDoors.add(e.index);
        this.muts.gateTouched.add(e.index);
        events.push({ effect: "fuse", x: e.x + e.w / 2, y: e.y + e.h / 2, color: "#9be8b0" });
      }
      if (e.def.closeFuseId && e.def.closeFuseId === fb.def.fuseId && e.open) {
        e.open = false;
        this.muts.openedDoors.delete(e.index);
        this.muts.gateTouched.add(e.index);
        events.push({ effect: "fuse", x: e.x + e.w / 2, y: e.y + e.h / 2, color: "#e8a2b4" });
        this.recedeCutOffFluid(e, events);
      }
    }
  }

  /**
   * A closed gate can sever the only path back to whatever fall fed a
   * SOURCED body through it — that body doesn't just get to stay infinite
   * forever once nothing feeds it. Re-floods from every live fall through
   * EXISTING fluid only (a SOURCED tile is, by definition, already fluid —
   * open air can't be carrying a connection between two fluid bodies, so it
   * isn't part of this check, unlike the room-load version of this flood
   * that seeds a fall's own growth). Any SOURCED tile no longer reachable
   * stops flowing immediately and is scheduled to drain out over
   * RECEDE_MS, farthest from the closed gate first — so it reads as the
   * pool shrinking back toward the gate, not blinking out all at once.
   */
  private recedeCutOffFluid(closedGate: EntityInstance, events: ElementEvent[]): void {
    // Reachability is computed PER ELEMENT — a waterfall's network must
    // never be able to vouch for a lavafall's pool (or vice versa) just
    // because their bodies happen to sit near each other. Each fall tile
    // seeds a flood restricted to its own spawned element the whole way.
    const reachableByElement = new Map<string, Set<number>>();
    for (const seedIdx of this.fallTiles) {
      const seedTx = seedIdx % this.map.width;
      const seedTy = Math.floor(seedIdx / this.map.width);
      const seedDef = this.map.at(seedTx, seedTy);
      const element = seedDef?.fallSpawns ? this.tilesById.get(seedDef.fallSpawns)?.element : undefined;
      if (!element) continue;
      let reachable = reachableByElement.get(element);
      if (!reachable) { reachable = new Set(); reachableByElement.set(element, reachable); }
      if (reachable.has(seedIdx)) continue;
      reachable.add(seedIdx);
      const queue = [seedIdx];
      while (queue.length > 0) {
        const idx = queue.pop()!;
        const tx = idx % this.map.width;
        const ty = Math.floor(idx / this.map.width);
        for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]] as const) {
          if (nx < 0 || nx >= this.map.width || ny < 0 || ny >= this.map.height) continue;
          const nidx = this.map.index(nx, ny);
          if (reachable.has(nidx) || this.doorBlocksFluid(nx, ny)) continue;
          const ndef = this.map.at(nx, ny);
          // A grate (fluid passes through) or matching-element fluid —
          // anything else (open air, a wall, the opposite element) stops
          // the flood here; only existing fluid of THIS fall's own
          // element carries the connection further.
          const passable = (ndef?.style === "platform") ||
            (!!ndef && this.isFluid(ndef) && ndef.element === element);
          if (!passable) continue;
          reachable.add(nidx);
          queue.push(nidx);
        }
      }
    }
    const now = simNow();
    const cx = closedGate.x + closedGate.w / 2, cy = closedGate.y + closedGate.h / 2;
    const cut: { idx: number; d: number }[] = [];
    let maxDist = 0;
    for (const [idx, dist] of this.waterFlowDist) {
      if (dist !== SOURCED || this.draining.has(idx)) continue;
      const tx = idx % this.map.width, ty = Math.floor(idx / this.map.width);
      const def = this.map.at(tx, ty);
      const stillFed = def?.element && this.isFluid(def) && reachableByElement.get(def.element)?.has(idx);
      if (stillFed) continue;
      const d = Math.hypot(tx * TILE + TILE / 2 - cx, ty * TILE + TILE / 2 - cy);
      cut.push({ idx, d });
      if (d > maxDist) maxDist = d;
    }
    for (const { idx, d } of cut) {
      const ratio = maxDist > 0 ? d / maxDist : 1;
      this.draining.set(idx, now + this.recedeMsEff * (1 - ratio));
      this.waterFlowDist.delete(idx);
      const tx = idx % this.map.width, ty = Math.floor(idx / this.map.width);
      events.push({ effect: "flow", x: tx * TILE + 8, y: ty * TILE + 8, color: "#8f9bb3" });
    }
  }

  /** Apply an element to enemies in a box (from tools, splashes, hazards). */
  applyElementToEnemies(
    element: string | undefined, box: Rect, stunMs: number
  ): ElementEvent[] {
    const events: ElementEvent[] = [];
    if (!element) return events;
    for (const en of this.enemies) {
      if (en.state === "trapped") continue;
      const rect = { x: en.x, y: en.y, w: en.def.width, h: en.def.height };
      if (!rectsOverlap(rect, box)) continue;
      const reaction = this.reactEnemy(en, element, stunMs);
      if (reaction !== "none") {
        events.push({
          effect: "enemy_" + reaction,
          x: en.x + en.def.width / 2,
          y: en.y + en.def.height / 2,
          color: en.def.color,
          enemyId: en.def.id,
          element,
        });
      }
    }
    return events;
  }

  /** Apply an element to one enemy — dispatches the elementContact trigger
   *  through its behaviors (element_reactions reads the reactions table; a
   *  custom doc can do anything else) and reports what happened. */
  reactEnemy(en: EnemyInstance, element: string, stunMs: number): EnemyReaction {
    const data: Record<string, unknown> = { element };
    this.bhv.fire("elementContact", {
      hostDef: en.def as unknown as Record<string, unknown>,
      hostKey: "enemy:" + en.index,
      attachments: enemyAttachments(en.def),
      data,
      api: { rt: this, en, player: null, dt: 0, stunMs, events: [] },
      builtins: enemyBuiltins(en),
    });
    const r = data.reaction;
    return r === "kill" || r === "stun" || r === "knockback" ? r : "none";
  }

  isEnergized(tx: number, ty: number): boolean {
    const until = this.energized.get(this.map.index(tx, ty));
    return !!until && until > simNow();
  }

  isBurning(tx: number, ty: number): boolean {
    return this.burning.has(this.map.index(tx, ty));
  }

  /** Does this box touch open flame (fire tiles, burning tiles, braziers)? */
  boxTouchesFire(box: Rect): boolean {
    const tx0 = Math.floor(box.x / TILE);
    const tx1 = Math.floor((box.x + box.w) / TILE);
    const ty0 = Math.floor(box.y / TILE);
    const ty1 = Math.floor((box.y + box.h) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.isBurning(tx, ty)) return true;
        const el = this.map.at(tx, ty)?.element;
        if (el === "fire" || el === "lava") return true;
      }
    }
    return this.entities.some(
      (e) => e.kind === "brazier" && e.lit !== false && rectsOverlap(e, box)
    );
  }

  /** Does this box touch a tile of this element (for scooping into tools)? */
  boxTouchesElement(element: string, box: Rect): { tx: number; ty: number } | null {
    const tx0 = Math.floor(box.x / TILE);
    const tx1 = Math.floor((box.x + box.w) / TILE);
    const ty0 = Math.floor(box.y / TILE);
    const ty1 = Math.floor((box.y + box.h) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.map.at(tx, ty)?.element === element) return { tx, ty };
      }
    }
    return null;
  }

  // ================= PLACED ITEMS =================

  placeItem(type: "spring" | "trap", x: number, y: number): void {
    const p: PlacedItem = { type, x, y, used: false };
    this.muts.placedItems.push(p);
    this.placed.push(this.makePlacedInstance(p));
  }

  removePlaced(inst: PlacedInstance): void {
    this.placed = this.placed.filter((p) => p !== inst);
    this.muts.placedItems = this.muts.placedItems.filter((p) => p !== inst.data);
  }

  /** Any placed item (spring OR trap) within range — reclaimable with E,
   *  same as a spring always has been. A placed item you can't take back
   *  is a softlock waiting to happen if the level needs it moved. */
  placedItemNear(px: number, py: number, range = 20): PlacedInstance | null {
    for (const p of this.placed) {
      if (dist(px, py, p.x + p.w / 2, p.y + p.h / 2) <= range) return p;
    }
    return null;
  }

  // ================= QUERIES =================

  /** Nearest interactable entity within reach of the player center. */
  interactableNear(px: number, py: number, range = 22): EntityInstance | null {
    let best: EntityInstance | null = null;
    let bestD = range;
    for (const e of this.entities) {
      if (e.collected) continue;
      if (!["note", "door", "trapdoor", "locker", "npc", "exit"].includes(e.kind)) continue;
      if ((e.kind === "door" || e.kind === "trapdoor") && e.def.gate && e.open) continue; // open gates are scenery
      const nx = Math.max(e.x, Math.min(px, e.x + e.w));
      const ny = Math.max(e.y, Math.min(py, e.y + e.h));
      const d = dist(px, py, nx, ny);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** One item unit flying out, Sonic-ring style — random outward/upward
   *  launch from a seeded RNG so replay stays deterministic. Shares the SAME
   *  object between the live `drops` array and the persisted mutation record,
   *  so physics ticks need nothing extra to keep them in sync. */
  private spawnScatterDrop(cx: number, cy: number, itemId: string, count: number): void {
    const angle = -Math.PI / 2 + (this.rng.next() - 0.5) * Math.PI * 1.3;
    const speed = 60 + this.rng.next() * 100;
    const d: ScatterDrop = {
      x: cx - 7 + (this.rng.next() - 0.5) * 6, y: cy - 7, w: 14, h: 14,
      itemId, count,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      settled: false,
    };
    this.drops.push(d);
    this.muts.drops.push(d);
  }

  /** Scatter a whole set of stacks outward from a point (death drop, or a
   *  bulk hand-off). Each stack splits into up to 5 discrete flying icons —
   *  "discretely," per Sean's request, not one generic bag. */
  scatterItems(x: number, y: number, items: [string, number][]): void {
    for (const [itemId, total] of items) {
      if (total <= 0) continue;
      const n = Math.min(total, 5);
      const base = Math.floor(total / n);
      const extra = total - base * n;
      for (let i = 0; i < n; i++) {
        this.spawnScatterDrop(x, y, itemId, base + (i < extra ? 1 : 0));
      }
    }
  }

  removePickupDrop(d: ScatterDrop): void {
    this.drops = this.drops.filter((x) => x !== d);
    this.muts.drops = this.muts.drops.filter((x) => x !== d);
  }

  stunEnemiesNear(x: number, y: number, radius: number, durationMs: number): number {
    let hit = 0;
    for (const en of this.enemies) {
      if (!en.def.stunnable || en.state === "trapped") continue;
      if (dist(x, y, en.x + en.def.width / 2, en.y + en.def.height / 2) <= radius) {
        en.state = "stunned";
        en.stunUntil = simNow() + durationMs;
        hit++;
      }
    }
    return hit;
  }

  /** Can this enemy safely take a step in `want` direction? (Public for the
   *  behavior verbs below — steering primitives live outside the class.) */
  canStepAhead(en: EnemyInstance, want: number): boolean {
    if (want === 0) return true;
    const d = en.def;
    const aheadX = want > 0 ? en.x + d.width + 3 : en.x - 3;
    const footY = en.y + d.height;
    const aheadTx = Math.floor(aheadX / TILE);
    // A real wall directly ahead blocks regardless of element — checked
    // proactively here (not just reactively via hitWall) so patrol's
    // "try the other direction" fallback can actually trust the answer
    // instead of committing to a direction that's just as blocked, which
    // — combined with the water-refusal check below — used to flip an
    // enemy's facing back and forth every frame with zero progress
    // whenever both patrol directions were blocked (reads as "frozen").
    const tyBody0 = Math.floor(en.y / TILE);
    const tyBody1 = Math.floor((footY - 1) / TILE);
    for (let ty = tyBody0; ty <= tyBody1; ty++) {
      if (this.map.at(aheadTx, ty)?.solid) return false;
    }
    // Metal creatures refuse water — pools are a safe zone.
    if (d.element === "metal") {
      const tile = this.map.at(aheadTx, Math.floor((footY - 4) / TILE));
      if (tile?.element === "water") return false;
    }
    // No drops it can't climb back out of (max 1 tile down).
    for (let step = 0; step < 2; step++) {
      const def = this.map.at(aheadTx, Math.floor((footY + 4 + step * TILE) / TILE));
      if (def?.solid) return true;
    }
    return false;
  }

  /** Send every enemy back to its post (called on player respawn). */
  resetEnemies(): void {
    // Fresh behavior state too (chase memory like seenAt starts over).
    this.bhv.resetInstances("enemy:");
    for (const en of this.enemies) {
      if (en.state === "trapped") continue;
      en.x = en.homeX - en.def.width / 2;
      en.vx = 0;
      en.vy = 0;
      en.state = enemyResetState(this.bhv, en.def);
      en.lastSawPlayerAt = 0;
    }
  }

  /** Does this enemy hunt by sight? (Smoke hides the player from it, and it
   *  draws a vision cone.) True when any attached behavior is tagged "sight". */
  isSightHunter(d: EnemyDef): boolean {
    return this.bhv.hasTag(enemyAttachments(d), "sight");
  }

  /** Vision-cone drawing parameters from the enemy's sight-tagged behavior,
   *  or null for blind enemies. */
  sightParamsFor(d: EnemyDef): { range: number; halfSlope: number; conePad: number } | null {
    const atts = enemyAttachments(d);
    const tagged = this.bhv.taggedAttachment(atts, "sight");
    if (!tagged) return null;
    const p = this.bhv.attachedFields(atts, tagged.id, d as unknown as Record<string, unknown>) ?? {};
    const num = (v: unknown, fb: number) =>
      typeof v === "number" && Number.isFinite(v) ? v : fb;
    return {
      range: num(p.range, d.sightRange ?? 120),
      halfSlope: num(p.halfSlope, SIGHT_HALF_SLOPE),
      conePad: num(p.conePad, 12),
    };
  }

  /** Heartbeat ground truth — see EnemySnapshot. */
  snapshotEnemies(): EnemySnapshot[] {
    return this.enemies.map((en) => ({
      index: en.index, x: en.x, y: en.y, vx: en.vx, vy: en.vy, facing: en.facing,
      state: en.state, stunUntil: en.stunUntil,
      lastSawPlayerAt: en.lastSawPlayerAt, lastHazardAt: en.lastHazardAt,
    }));
  }

  /** Overwrite each currently-live enemy's runtime fields from a snapshot,
   *  matched by index. An enemy the snapshot doesn't mention (disabled since,
   *  or the room construction disagrees for some other reason) is left as
   *  the constructor placed it — same fallback as any other partial data. */
  restoreEnemies(snaps: EnemySnapshot[]): void {
    const byIndex = new Map(snaps.map((s) => [s.index, s]));
    for (const en of this.enemies) {
      const s = byIndex.get(en.index);
      if (!s) continue;
      en.x = s.x; en.y = s.y; en.vx = s.vx; en.vy = s.vy; en.facing = s.facing;
      en.state = s.state; en.stunUntil = s.stunUntil;
      en.lastSawPlayerAt = s.lastSawPlayerAt; en.lastHazardAt = s.lastHazardAt;
    }
  }

  /** Heartbeat ground truth for the two fluid-runtime overlays RoomMutations
   *  doesn't track (tileOverrides only records a tile's identity) — see
   *  FluidRuntimeSnapshot. meltedHot isn't included: it's a single-tick
   *  ignition trigger, cleared every tick, so by the time anything reads a
   *  heartbeat it's already stale either way. */
  snapshotFluidRuntime(): FluidRuntimeSnapshot {
    return {
      burning: [...this.burning],
      grateFluid: [...this.grateFluid].map(([idx, def]) => [idx, def.id]),
    };
  }

  restoreFluidRuntime(snap: FluidRuntimeSnapshot): void {
    this.burning = new Map(snap.burning);
    this.grateFluid = new Map(
      snap.grateFluid
        .map(([idx, id]) => [idx, this.tilesById.get(id)] as const)
        .filter((e): e is [number, TileDef] => !!e[1])
    );
  }

  // ================= UPDATE =================

  update(
    dt: number,
    player: { centerX: number; centerY: number; hidden: boolean } | null,
    stunMs: number,
    onEvents: (events: ElementEvent[]) => void
  ): void {
    const now = simNow();
    const events: ElementEvent[] = [];

    // ---- Fire simulation ----
    for (const [idx, left] of [...this.burning]) {
      const next = left - dt;
      if (next <= 0) {
        const tx = idx % this.map.width;
        const ty = Math.floor(idx / this.map.width);
        const def = this.map.at(tx, ty);
        this.transformTile(tx, ty, def?.burnsTo);
        events.push({ effect: "burnout", x: tx * TILE + 8, y: ty * TILE + 8, color: "#5a5470" });
      } else {
        this.burning.set(idx, next);
      }
    }
    this.spreadClock += dt;
    if (this.spreadClock >= this.spreadIntervalSec) {
      this.spreadClock = 0;
      // element -> heat sources of that element. Fire tiles/burning tiles/lit
      // braziers radiate "fire"; lava tiles radiate "lava" (their own,
      // hotter ruleset — it can melt metal where a torch can't). The 4th
      // tuple slot is the chain-melt depth (0 = a real heat source).
      const igniters: [number, number, string, number][] = [];
      for (let ty = 0; ty < this.map.height; ty++) {
        for (let tx = 0; tx < this.map.width; tx++) {
          const def = this.map.at(tx, ty);
          if ((def?.spreads && def.element === "fire") || this.isBurning(tx, ty)) {
            igniters.push([tx, ty, "fire", 0]);
          } else if (def?.spreads && def.element === "lava") {
            igniters.push([tx, ty, "lava", 0]);
          }
        }
      }
      for (const e of this.entities) {
        if (e.kind === "brazier" && e.lit !== false) {
          igniters.push([Math.floor((e.x + e.w / 2) / TILE), Math.floor((e.y + e.h / 2) / TILE), "fire", 0]);
        }
      }
      // Cells a lava melt vacated last tick radiate lava's heat once more —
      // see meltedHot above. Single-shot: swap to a fresh map each tick so
      // it's exactly one more ring, not a permanent hot spot.
      for (const [idx, depth] of this.meltedHot) {
        igniters.push([idx % this.map.width, Math.floor(idx / this.map.width), "lava", depth]);
      }
      this.meltedHot = new Map();
      // Neighbors get the source's full ruleset — flammables ignite, ice
      // melts. (A lit goo line can melt a distant ice wall.)
      for (const [tx, ty, elem, depth] of igniters) {
        for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]] as const) {
          const ndef = this.map.at(nx, ny);
          if (!ndef) continue;
          const rule = this.findRule(elem, ndef);
          if (rule?.effect === "ignite" && this.igniteTile(nx, ny)) {
            events.push({ effect: "ignite", x: nx * TILE + 8, y: ny * TILE + 8, color: "#ff7043", element: elem });
            continue;
          }
          if (rule?.effect === "melt" && ndef.meltsTo !== undefined) {
            this.transformTile(nx, ny, ndef.meltsTo);
            events.push({ effect: "melt", x: nx * TILE + 8, y: ny * TILE + 8, color: "#b3e5fc", element: elem });
            // heat_spread.chainMeltRange caps how far the chain reaches
            // beyond direct contact (-1 = unlimited, the shipped default).
            if (elem === "lava" && (this.chainMeltRange < 0 || depth + 1 <= this.chainMeltRange)) {
              this.meltedHot.set(this.map.index(nx, ny), depth + 1);
            }
          }
        }
      }
    }

    this.waterFlowClock += dt;
    if (this.waterFlowClock >= this.flowIntervalSec) {
      this.waterFlowClock = 0;
      this.tickWaterFlow(events);
      this.tickToyblockFalls();
    }

    for (const [idx, at] of [...this.draining]) {
      if (at > now) continue;
      this.draining.delete(idx);
      const tx = idx % this.map.width, ty = Math.floor(idx / this.map.width);
      this.clearFluid(tx, ty);
      events.push({ effect: "flow", x: tx * TILE + 8, y: ty * TILE + 8, color: "#8f9bb3" });
    }

    // ---- Enemies (behavior-grammar driven — content/behaviors.json wires
    // which rules each enemy runs; the verbs below this class implement the
    // primitives. Legacy defs without a `behaviors` list get the mapping in
    // enemyAttachments, which reproduces the old hardcoded loop exactly.) ----
    for (const en of [...this.enemies]) {
      if (en.state === "trapped") continue;
      this.bhv.fire("tick", {
        hostDef: en.def as unknown as Record<string, unknown>,
        hostKey: "enemy:" + en.index,
        attachments: enemyAttachments(en.def),
        api: { rt: this, en, player, dt, stunMs, events },
        builtins: enemyBuiltins(en),
      });
    }

    // ---- Scattered drops: gravity + settle (Sonic-ring launch, then rest) ----
    for (const d of this.drops) {
      if (d.settled) continue;
      d.vy = Math.min(d.vy + 900 * dt, 520);
      const res = this.map.move(d.x, d.y, d.w, d.h, d.vx, d.vy, dt);
      d.x = res.x; d.y = res.y; d.vy = res.vy; d.vx = res.vx;
      // Never let a dropped item come to rest in (or sink into) a damaging
      // tile — lava/fire aren't solid, so gravity alone would happily let
      // an item fall straight through and settle unreachable beneath the
      // surface. Bounce it back out instead, same spirit as the player's
      // own knockback off a hazard.
      const hereDef = this.map.at(
        Math.floor((d.x + d.w / 2) / TILE), Math.floor((d.y + d.h / 2) / TILE)
      );
      if (hereDef?.damage) {
        d.vy = -260;
        d.vx = (this.rng.next() - 0.5) * 240;
        continue;
      }
      if (res.onGround) {
        d.vx *= Math.pow(0.0004, dt);
        if (Math.abs(d.vx) < 3) {
          d.vx = 0; d.vy = 0; d.settled = true;
        }
      }
    }

    if (events.length > 0) onEvents(events);
  }

  // ================= DRAWING =================

  /** Content-authored hint text can reference scheme-aware control tokens
   *  like "{move} — move · {jump} — jump" instead of hardcoding keyboard
   *  keys; the game sets this from Input.label() each frame so the same
   *  authored string reads correctly on keyboard, gamepad, and touch. */
  resolveHintText: (raw: string) => string = (raw) => raw;

  draw(ctx: CanvasRenderingContext2D, animT: number): void {
    this.drawFuseWires(ctx, animT);
    for (const e of this.entities) this.drawEntity(ctx, e, animT);
    for (const p of this.placed) this.drawPlaced(ctx, p, animT);
    for (const d of this.drops) this.drawScatterDrop(ctx, d, animT);
    for (const en of this.enemies) this.drawEnemy(ctx, en, animT);
    this.drawElementOverlays(ctx, animT);
    this.drawSmoke(ctx, animT);
  }

  /** The smoke veil: soft drifting puffs on every smoked tile, fading out
   *  over the last second so "about to clear" is readable at a glance. */
  private drawSmoke(ctx: CanvasRenderingContext2D, animT: number): void {
    const now = simNow();
    for (const [idx, until] of this.smoked) {
      if (until <= now) {
        this.smoked.delete(idx);
        continue;
      }
      const tx = idx % this.map.width;
      const ty = Math.floor(idx / this.map.width);
      const fade = Math.min(1, (until - now) / 1000);
      const phase = (idx * 37) % 17;
      const bob = Math.sin(animT * 0.9 + phase) * 2;
      ctx.fillStyle = `rgba(170,179,200,${0.30 * fade})`;
      ctx.beginPath();
      ctx.arc(tx * TILE + 5 + (phase % 5), ty * TILE + 7 + bob, 7.5, 0, Math.PI * 2);
      ctx.arc(tx * TILE + 12 - (phase % 4), ty * TILE + 11 - bob * 0.6, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawElementOverlays(ctx: CanvasRenderingContext2D, animT: number): void {
    const now = simNow();
    // Fluid flowing through a grate: drawn UNDER the grate's own tile (already
    // painted by drawMap), so the slats still read on top of a translucent
    // glow — "the grate and the fluid occupy the same space."
    for (const [idx, fluidDef] of this.grateFluid) {
      const tx = idx % this.map.width;
      const ty = Math.floor(idx / this.map.width);
      ctx.save();
      ctx.globalAlpha = 0.55;
      drawTile(ctx, fluidDef, tx * TILE, ty * TILE, animT, true);
      ctx.restore();
    }
    for (const idx of this.burning.keys()) {
      const tx = idx % this.map.width;
      const ty = Math.floor(idx / this.map.width);
      this.drawFlames(ctx, tx * TILE, ty * TILE, animT);
    }
    for (const [idx, until] of this.energized) {
      if (until <= now) {
        this.energized.delete(idx);
        continue;
      }
      const tx = idx % this.map.width;
      const ty = Math.floor(idx / this.map.width);
      const px = tx * TILE;
      const py = ty * TILE;
      const flick = Math.sin(animT * 40 + idx) > -0.3;
      if (flick) {
        ctx.strokeStyle = "rgba(255,233,90,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + 2, py + randRange(2, 14));
        ctx.lineTo(px + 8, py + randRange(2, 14));
        ctx.lineTo(px + 14, py + randRange(2, 14));
        ctx.stroke();
      }
    }
  }

  /** Burning (dynamically ignited) tiles are a hazard — same jagged, hot-white
   *  language as the "fire" tile style, so both read as "this will hurt you." */
  private drawFlames(ctx: CanvasRenderingContext2D, px: number, py: number, animT: number): void {
    for (let i = 0; i < 3; i++) {
      const fx = px + 3 + i * 5;
      const jitter = Math.sin(animT * 16 + px + i * 2.7) * 1.2;
      const hgt = 7 + Math.sin(animT * 11 + px + i * 2.1) * 3;
      ctx.fillStyle = i % 2 ? "#d32f2f" : "#ff6d1f";
      ctx.beginPath();
      ctx.moveTo(fx - 2.5, py + 14);
      ctx.lineTo(fx - 1 + jitter * 0.4, py + 14 - hgt * 0.9);
      ctx.lineTo(fx + jitter, py + 14 - hgt * 1.6);
      ctx.lineTo(fx + 1 - jitter * 0.4, py + 14 - hgt * 0.9);
      ctx.lineTo(fx + 2.5, py + 14);
      ctx.closePath();
      ctx.fill();
      if (Math.sin(animT * 21 + i * 5) > 0.5) {
        ctx.fillStyle = "#fff3c4";
        ctx.beginPath();
        ctx.arc(fx + jitter * 0.5, py + 14 - hgt * 1.45, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** The brazier is a safe, always-on lighting station — warm gold, rounded,
   *  slow — the opposite visual language from hazard fire (never damages). */
  private drawBrazierFlames(ctx: CanvasRenderingContext2D, px: number, py: number, animT: number): void {
    for (let i = 0; i < 3; i++) {
      const fx = px + 3 + i * 5;
      const hgt = 6 + Math.sin(animT * 3 + i * 1.7) * 1.6;
      ctx.fillStyle = i % 2 ? "#f4a531" : "#ffd166";
      ctx.beginPath();
      ctx.moveTo(fx - 3, py + 14);
      ctx.quadraticCurveTo(fx - 2.4, py + 14 - hgt * 0.9, fx, py + 14 - hgt * 1.5);
      ctx.quadraticCurveTo(fx + 2.4, py + 14 - hgt * 0.9, fx + 3, py + 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffe9a8";
      ctx.beginPath();
      ctx.arc(fx, py + 14 - hgt * 0.55, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    // Glowing coals at the base — steady, not flickery.
    ctx.fillStyle = "rgba(255,120,60,0.6)";
    for (let i = 0; i < 3; i++) {
      const ex = px + 3 + i * 5;
      ctx.beginPath();
      ctx.arc(ex, py + 14.5, 1 + Math.sin(animT * 1.5 + i) * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Wires from every gated door/trapdoor to its linked fusebox(es) — drawn
   *  first so they read as background wiring, entities render on top. Green
   *  is the open-link (lit while the gate is open), red the close-link (lit
   *  while closed) — a gate can have both at once, to different fuseboxes. */
  private drawFuseWires(ctx: CanvasRenderingContext2D, animT: number): void {
    for (const e of this.entities) {
      if (e.kind !== "door" && e.kind !== "trapdoor") continue;
      const openId = e.def.openFuseId ?? e.def.fuseId;
      if (openId) this.drawFuseWire(ctx, e, openId, "#3ddc84", e.open === true, animT);
      if (e.def.closeFuseId) this.drawFuseWire(ctx, e, e.def.closeFuseId, "#e0475a", e.open !== true, animT);
    }
  }

  private drawFuseWire(
    ctx: CanvasRenderingContext2D, gate: EntityInstance, fuseId: string,
    color: string, lit: boolean, animT: number
  ): void {
    const fb = this.entities.find((f) => f.kind === "fusebox" && f.def.fuseId === fuseId);
    if (!fb) return;
    const ax = gate.x + gate.w / 2, ay = gate.y + gate.h / 2;
    const bx = fb.x + fb.w / 2, by = fb.y + fb.h / 2;
    const dx = bx - ax, dy = by - ay;
    const len = Math.max(1, Math.hypot(dx, dy));
    const sag = Math.min(24, len * 0.18);
    // Perpendicular offset off the midpoint so it droops like a real wire
    // instead of cutting a straight rigid line through the room.
    const cx = (ax + bx) / 2 - (dy / len) * sag;
    const cy = (ay + by) / 2 + (dx / len) * sag;
    const pulse = lit ? 0.55 + Math.sin(animT * 3 + gate.index) * 0.25 : 0.18;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = pulse;
    ctx.lineWidth = lit ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, cy, bx, by);
    ctx.stroke();
    ctx.restore();
  }

  private drawEntity(ctx: CanvasRenderingContext2D, e: EntityInstance, animT: number): void {
    const bob = Math.sin(animT * 2.6 + e.index) * 2;
    switch (e.kind) {
      case "pickup": {
        if (e.collected) return;
        const item = this.content.items.find((i) => i.id === e.def.item);
        if (!item) return;
        const cx = e.x + e.w / 2;
        const cy = e.y + e.h / 2 + bob;
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.beginPath();
        ctx.ellipse(cx, e.y + e.h + 3, 6, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        drawItemIcon(ctx, item, cx, cy);
        break;
      }
      case "note": {
        const cy = e.y + e.h / 2 + bob * 0.6;
        ctx.fillStyle = "#f4ead8";
        ctx.fillRect(e.x, cy - 6, 11, 12);
        ctx.fillStyle = "#a99f8a";
        ctx.fillRect(e.x + 2, cy - 3, 7, 1);
        ctx.fillRect(e.x + 2, cy, 7, 1);
        ctx.fillRect(e.x + 2, cy + 3, 5, 1);
        break;
      }
      case "door": {
        const powered = !!(e.def.openFuseId ?? e.def.fuseId) || !!e.def.closeFuseId;
        const c = e.open ? "#4f8a5e" : powered ? "#8a6f4f" : "#6e5c8a";
        ctx.fillStyle = shade(c, -25);
        ctx.fillRect(e.x - 2, e.y - 2, e.w + 4, e.h + 2);
        ctx.fillStyle = c;
        ctx.fillRect(e.x, e.y, e.w, e.h);
        if (e.open) {
          ctx.fillStyle = "#0d0b14";
          ctx.fillRect(e.x + 3, e.y + 3, e.w - 6, e.h - 3);
        } else {
          ctx.fillStyle = shade(c, 25);
          ctx.beginPath();
          ctx.arc(e.x + e.w - 5, e.y + e.h / 2, 1.8, 0, Math.PI * 2);
          ctx.fill();
          if (powered) {
            // bolt emblem: this door wants electricity
            ctx.strokeStyle = "#ffe95a";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(e.x + 9, e.y + 10);
            ctx.lineTo(e.x + 6, e.y + 16);
            ctx.lineTo(e.x + 9, e.y + 16);
            ctx.lineTo(e.x + 6, e.y + 22);
            ctx.stroke();
          }
        }
        break;
      }
      case "trapdoor": {
        // A horizontal hatch: two hinged flaps that swing open downward,
        // vs. the door's vertical panel — reads as blocking up/down, not
        // sideways.
        const powered = !!(e.def.openFuseId ?? e.def.fuseId) || !!e.def.closeFuseId;
        const c = e.open ? "#4f8a5e" : powered ? "#8a6f4f" : "#6e5c8a";
        ctx.fillStyle = shade(c, -25);
        ctx.fillRect(e.x - 2, e.y - 1, e.w + 4, e.h + 3);
        if (e.open) {
          ctx.fillStyle = "#0d0b14";
          ctx.fillRect(e.x + 1, e.y + 3, e.w - 2, e.h - 4);
          // Flaps hang open to the sides.
          ctx.fillStyle = c;
          ctx.fillRect(e.x - 2, e.y + e.h - 2, e.w / 2, 2.5);
          ctx.fillRect(e.x + e.w / 2, e.y + e.h - 2, e.w / 2 + 2, 2.5);
        } else {
          ctx.fillStyle = c;
          ctx.fillRect(e.x, e.y, e.w, e.h);
          ctx.fillStyle = shade(c, -40);
          ctx.fillRect(e.x, e.y + e.h / 2 - 0.75, e.w, 1.5); // hinge seam, split down the middle
          ctx.fillStyle = shade(c, 25);
          ctx.beginPath();
          ctx.arc(e.x + e.w / 2, e.y + 3, 1.6, 0, Math.PI * 2);
          ctx.fill();
          if (powered) {
            ctx.strokeStyle = "#ffe95a";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(e.x + 8, e.y + 7);
            ctx.lineTo(e.x + 5, e.y + 11);
            ctx.lineTo(e.x + 8, e.y + 11);
            ctx.lineTo(e.x + 5, e.y + 15);
            ctx.stroke();
          }
        }
        break;
      }
      case "locker": {
        ctx.fillStyle = "#48506b";
        ctx.fillRect(e.x - 1, e.y - 1, e.w + 2, e.h + 1);
        ctx.fillStyle = e.occupied ? "#39415c" : "#59627f";
        ctx.fillRect(e.x, e.y, e.w, e.h);
        ctx.fillStyle = "#39415c";
        for (let i = 0; i < 3; i++) ctx.fillRect(e.x + 3, e.y + 4 + i * 3, e.w - 6, 1.4);
        ctx.fillRect(e.x + e.w - 5, e.y + e.h / 2, 2, 5);
        if (e.occupied) {
          ctx.fillStyle = "#ffd166";
          ctx.fillRect(e.x + 4, e.y + 6, 2, 2);
          ctx.fillRect(e.x + 9, e.y + 6, 2, 2);
        }
        break;
      }
      case "npc": {
        const hasSprite = !!(e.def.sprite || e.def.spriteFrames?.length);
        if (e.def.avatar && !hasSprite) {
          drawNpcAvatar(
            ctx, e.def.avatar, e.x, e.y + bob * 0.3, e.w, e.h,
            e.def.color ?? "#7fd8e8", -1,
            { t: animT, helped: e.helped }
          );
        } else {
          drawBlob(
            ctx, e.x, e.y + bob * 0.3, e.w, e.h,
            e.def.color ?? "#7fd8e8", "#1a2530", -1,
            { eyeStyle: e.helped ? "sleepy" : "wide", sprite: e.def }
          );
        }
        // "?" only over an open trade — chatty constructs aren't quests.
        if (!e.helped && e.def.wants) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "8px monospace";
          ctx.fillText("?", e.x + e.w / 2 - 2, e.y - 4 + bob);
        }
        break;
      }
      case "checkpoint": {
        const active = !!e.open;
        ctx.fillStyle = "#5a5470";
        ctx.fillRect(e.x + e.w / 2 - 1, e.y, 2, e.h);
        ctx.fillStyle = active ? "#5ad1a5" : "#3a3550";
        ctx.beginPath();
        ctx.moveTo(e.x + e.w / 2 + 1, e.y + 2);
        ctx.lineTo(e.x + e.w / 2 + 11, e.y + 6 + (active ? Math.sin(animT * 4) : 0));
        ctx.lineTo(e.x + e.w / 2 + 1, e.y + 10);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "hint": {
        const txt = this.resolveHintText(e.def.text ?? "");
        ctx.font = "9px monospace";
        ctx.fillStyle = "rgba(232,226,244,0.42)";
        const tw = ctx.measureText(txt).width;
        ctx.fillText(txt, e.x + e.w / 2 - tw / 2, e.y + 6 + bob * 0.4);
        break;
      }
      case "brazier": {
        ctx.fillStyle = "#4a4258";
        roundRect(ctx, e.x, e.y + 8, e.w, 6, 2);
        ctx.fill();
        ctx.fillStyle = "#332d40";
        ctx.fillRect(e.x + e.w / 2 - 2, e.y + 13, 4, 3);
        if (e.lit === false) {
          // Cold: dark coals, no halo, no flame — clearly "bring fire here".
          ctx.fillStyle = "#2a2536";
          ctx.beginPath();
          ctx.ellipse(e.x + e.w / 2, e.y + 7, 5.5, 2.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#3d3750";
          ctx.beginPath();
          ctx.arc(e.x + e.w / 2 - 2.5, e.y + 6.5, 1.6, 0, Math.PI * 2);
          ctx.arc(e.x + e.w / 2 + 2, e.y + 6, 1.9, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        // A soft, slow-breathing halo reads as "warm hearth", not "heat haze".
        ctx.fillStyle = "rgba(255,200,120,0.14)";
        ctx.beginPath();
        ctx.arc(e.x + e.w / 2, e.y + 4, 15 + Math.sin(animT * 1.4) * 1.5, 0, Math.PI * 2);
        ctx.fill();
        this.drawBrazierFlames(ctx, e.x, e.y - 6, animT);
        break;
      }
      case "fusebox": {
        ctx.fillStyle = "#3a3550";
        roundRect(ctx, e.x - 1, e.y - 1, e.w + 2, e.h + 2, 2);
        ctx.fill();
        ctx.fillStyle = e.open ? "#5ad1a5" : "#59627f";
        ctx.fillRect(e.x, e.y, e.w, e.h);
        ctx.strokeStyle = e.open ? "#0d2b1c" : "#ffe95a";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(e.x + 8, e.y + 4);
        ctx.lineTo(e.x + 5, e.y + 9);
        ctx.lineTo(e.x + 8, e.y + 9);
        ctx.lineTo(e.x + 5, e.y + 14);
        ctx.stroke();
        if (!e.open && Math.sin(animT * 3 + e.index) > 0.6) {
          ctx.fillStyle = "rgba(255,233,90,0.25)";
          ctx.fillRect(e.x - 2, e.y - 2, e.w + 4, e.h + 4);
        }
        break;
      }
      case "exit": {
        ctx.fillStyle = "#2b3a2e";
        ctx.fillRect(e.x - 3, e.y - 3, e.w + 6, e.h + 3);
        ctx.fillStyle = "#3e5c46";
        ctx.fillRect(e.x, e.y, e.w, e.h);
        ctx.fillStyle = "#89f0b1";
        ctx.font = "7px monospace";
        ctx.fillText("EXIT", e.x + 4, e.y + 10);
        const glow = 0.4 + Math.sin(animT * 3) * 0.2;
        ctx.fillStyle = `rgba(137,240,177,${glow * 0.25})`;
        ctx.fillRect(e.x - 6, e.y - 6, e.w + 12, e.h + 6);
        break;
      }
    }
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, en: EnemyInstance, animT: number): void {
    const d = en.def;
    if (en.state === "trapped") {
      ctx.globalAlpha = 0.8;
      drawBlob(ctx, en.x, en.y, d.width, d.height, shade(d.color, -50), d.eyeColor, en.facing, { eyeStyle: "sleepy", sprite: d });
      ctx.fillStyle = "rgba(139,212,79,0.55)";
      roundRect(ctx, en.x - 3, en.y + d.height * 0.4, d.width + 6, d.height * 0.6 + 2, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    if (en.state === "stunned") {
      drawBlob(ctx, en.x, en.y, d.width, d.height, shade(d.color, -30), d.eyeColor, en.facing, { blink: true, sprite: d });
      ctx.fillStyle = "#ffffff";
      ctx.font = "8px monospace";
      const wob = Math.sin(animT * 8) * 3;
      ctx.fillText("zZ", en.x + d.width / 2 + wob, en.y - 4);
      return;
    }
    const chasing = en.state === "chase";
    // Visible sight cone for forward-looking chasers (any enemy carrying a
    // "sight"-tagged behavior; range/slope come from that behavior's params).
    const sightParams = this.sightParamsFor(d);
    if (sightParams) {
      const range = sightParams.range;
      const eyeX = en.facing > 0 ? en.x + d.width - 2 : en.x + 2;
      const eyeY = en.y + d.height * 0.35;
      const endX = eyeX + en.facing * range;
      const spread = range * sightParams.halfSlope + sightParams.conePad;
      const pulse = chasing ? 0.22 + Math.sin(animT * 12) * 0.06 : 0.10;
      ctx.fillStyle = chasing
        ? `rgba(255,84,112,${pulse})`
        : `rgba(255,233,90,${pulse})`;
      ctx.beginPath();
      ctx.moveTo(eyeX, eyeY);
      ctx.lineTo(endX, eyeY - spread);
      ctx.lineTo(endX, eyeY + spread);
      ctx.closePath();
      ctx.fill();
    }
    const wobble = Math.sin(animT * (chasing ? 18 : 7) + en.index) * (chasing ? 0.12 : 0.05);
    drawBlob(
      ctx, en.x, en.y, d.width, d.height, d.color, d.eyeColor, en.facing,
      { squashX: 1 + wobble, squashY: 1 - wobble, eyeStyle: chasing ? "wide" : "dot", sprite: d }
    );
    if (chasing) {
      ctx.fillStyle = "#ff5470";
      ctx.font = "9px monospace";
      ctx.fillText("!", en.x + d.width / 2 - 1, en.y - 4);
    }
  }

  private drawPlaced(ctx: CanvasRenderingContext2D, p: PlacedInstance, animT: number): void {
    if (p.data.type === "spring") {
      const springTile = this.tilesById.get("spring");
      drawTile(
        ctx,
        springTile ?? ({ id: "spring", char: "S", name: "", style: "spring", color: "#5ad1a5" } as TileDef),
        p.x, p.y - 8, animT
      );
      return;
    }
    // trap
    ctx.fillStyle = "#8a6d47";
    ctx.fillRect(p.x, p.y + p.h - 3, p.w, 3);
    if (!p.data.used) {
      ctx.fillStyle = "rgba(139,212,79,0.8)";
      roundRect(ctx, p.x + 1, p.y + p.h - 7, p.w - 2, 5, 2);
      ctx.fill();
    }
  }

  private drawScatterDrop(ctx: CanvasRenderingContext2D, d: ScatterDrop, animT: number): void {
    const item = this.content.items.find((i) => i.id === d.itemId);
    if (!item) return;
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h / 2;
    if (d.settled) {
      const glow = 0.35 + Math.sin(animT * 5 + d.x) * 0.15;
      ctx.fillStyle = `rgba(255,255,255,${glow * 0.12})`;
      ctx.beginPath();
      ctx.ellipse(cx, d.y + d.h + 1, 6, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    drawItemIcon(ctx, item, cx, cy);
    if (d.count > 1) {
      ctx.font = "bold 8px sans-serif";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "right";
      ctx.fillText(`${d.count}`, cx + 7, cy + 8);
      ctx.textAlign = "left";
    }
  }
}

// ===========================================================================
// penscript function registry — the engine capabilities behavior scripts
// call. Each function is small and single-purpose; adding one here (it shows
// up in the editor's legend automatically) is how the vocabulary grows.
// Registered at module load, shared by every RoomRuntime. Determinism rule:
// only simNow() and the room's seeded RNG — never wall clock/Math.random.
// ===========================================================================

interface EnemyApi {
  rt: RoomRuntime;
  en: EnemyInstance;
  player: { centerX: number; centerY: number; hidden: boolean } | null;
  dt: number;
  stunMs: number;
  events: ElementEvent[];
}
const enemyApi = (ctx: ScriptCtx) => ctx.api as unknown as EnemyApi;

interface EntityApi {
  rt: RoomRuntime;
  e: EntityInstance;
  events: ElementEvent[];
}
const entityApi = (ctx: ScriptCtx) => ctx.api as unknown as EntityApi;

/** Script-facing builtins for an enemy dispatch (the `state` variable). */
export function enemyBuiltins(en: EnemyInstance) {
  return {
    state: {
      get: () => en.state as unknown,
      set: (v: unknown) => {
        en.state = String(v) as EnemyInstance["state"];
      },
    },
  };
}

/** Script-facing builtins for an entity dispatch (the `lit` variable). */
export function entityBuiltins(rt: RoomRuntime, e: EntityInstance) {
  return {
    lit: {
      get: () => (e.lit !== false) as unknown,
      set: (v: unknown) => rt.setBrazierLit(e, !!v),
    },
  };
}

const argNum = (v: unknown, fb: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fb;
const argStr = (v: unknown, fb: string) => (typeof v === "string" ? v : fb);

function applyReaction(ctx: ScriptCtx, reaction: EnemyReaction, msOverride?: number): void {
  const { rt, en, stunMs } = enemyApi(ctx);
  switch (reaction) {
    case "kill":
      en.state = "trapped"; // reuse: removed from play
      rt.muts.disabledEnemies.add(en.index);
      rt.enemies = rt.enemies.filter((e) => e !== en);
      break;
    case "stun":
      en.state = "stunned";
      en.stunUntil = simNow() + (msOverride ?? stunMs);
      break;
    case "knockback":
      en.vx = en.facing * -120;
      break;
    case "none":
      break;
  }
  ctx.data.reaction = reaction;
}

// ---- enemy senses ----
registerFn("stunElapsed", (ctx) => {
  const { en } = enemyApi(ctx);
  return simNow() >= en.stunUntil;
}, "stunElapsed() -> bool — has the current stun timer run out?");
registerFn("seesPlayer", (ctx, args) => {
  const { rt, en, player } = enemyApi(ctx);
  if (!player || player.hidden) return false;
  const d = en.def;
  const cx = en.x + d.width / 2;
  const cy = en.y + d.height / 2;
  // Smoke veil: sight only connects when BOTH ends are in clear air.
  if (rt.smokeAtPoint(player.centerX, player.centerY) || rt.smokeAtPoint(cx, cy)) return false;
  const dx = player.centerX - cx;
  const dy = player.centerY - cy;
  if (dx * en.facing <= 0) return false; // forward only
  const halfSlope = argNum(args[1], SIGHT_HALF_SLOPE);
  const conePad = argNum(args[2], 12);
  if (Math.abs(dy) > Math.abs(dx) * halfSlope + conePad) return false;
  if (Math.abs(dx) > argNum(args[0], 120)) return false;
  return rt.map.lineOfSight(cx, cy, player.centerX, player.centerY);
}, "seesPlayer(range?, halfSlope?, conePad?) -> bool — forward vision cone + line of sight; hidden players and smoke on either end block it");
registerFn("playerHidden", (ctx) => {
  // No player, hiding in a locker, or smoke on either end of the sightline.
  const { rt, en, player } = enemyApi(ctx);
  if (!player || player.hidden) return true;
  const cx = en.x + en.def.width / 2;
  const cy = en.y + en.def.height / 2;
  return rt.smokeAtPoint(player.centerX, player.centerY) || rt.smokeAtPoint(cx, cy);
}, "playerHidden() -> bool — no player, hiding in a locker, or smoke on either end of the sightline");

// ---- enemy reactions ----
registerFn("reactToTileHazards", (ctx, args) => {
  const { rt, en, stunMs, events } = enemyApi(ctx);
  const d = en.def;
  const now = simNow();
  if (now - en.lastHazardAt <= argNum(args[0], HAZARD_COOLDOWN_MS)) return undefined;
  const tx0 = Math.floor(en.x / TILE);
  const tx1 = Math.floor((en.x + d.width) / TILE);
  const ty0 = Math.floor(en.y / TILE);
  const ty1 = Math.floor((en.y + d.height + 2) / TILE);
  let applied: string | null = null;
  for (let ty = ty0; ty <= ty1 && !applied; ty++) {
    for (let tx = tx0; tx <= tx1 && !applied; tx++) {
      const tdef = rt.map.at(tx, ty);
      if (rt.isBurning(tx, ty) || tdef?.element === "fire") applied = "fire";
      else if (tdef?.element === "lava") applied = "lava";
      else if (rt.isEnergized(tx, ty)) applied = "spark";
    }
  }
  if (!applied) return undefined;
  en.lastHazardAt = now;
  const r = rt.reactEnemy(en, applied, stunMs);
  if (r !== "none") {
    events.push({
      effect: "enemy_" + r,
      x: en.x + d.width / 2, y: en.y + d.height / 2, color: d.color,
      enemyId: d.id, element: applied,
    });
  }
  if (r === "kill") ctx.halt = true;
  return r;
}, "reactToTileHazards(cooldownMs?) — fire/lava/spark tiles under the enemy apply their element through its reactions; halts the dispatch on a kill");
registerFn("reactFromTable", (ctx) => {
  const { en } = enemyApi(ctx);
  const element = typeof ctx.data.element === "string" ? ctx.data.element : "";
  applyReaction(ctx, en.def.reactions?.[element] ?? "none");
  return ctx.data.reaction;
}, "reactFromTable() — look the contacting element up in the enemy's reactions map and apply kill / stun / knockback / none");
registerFn("kill", (ctx) => {
  applyReaction(ctx, "kill");
  return undefined;
}, "kill() — remove this enemy from play (persisted)");
registerFn("stun", (ctx, args) => {
  applyReaction(ctx, "stun", typeof args[0] === "number" ? args[0] : undefined);
  return undefined;
}, "stun(ms?) — put this enemy to sleep (defaults to the game stun duration)");
registerFn("knockback", (ctx, args) => {
  const { en } = enemyApi(ctx);
  en.vx = en.facing * -argNum(args[0], 120);
  ctx.data.reaction = "knockback";
  return undefined;
}, "knockback(vx?) — shove this enemy backward against its facing (default 120)");

// ---- enemy steering + physics ----
registerFn("patrol", (ctx, args) => {
  const { rt, en } = enemyApi(ctx);
  const d = en.def;
  const cx = en.x + d.width / 2;
  let want = en.facing;
  if (cx <= en.patrolMin) want = 1;
  else if (cx >= en.patrolMax) want = -1;
  if (!rt.canStepAhead(en, want)) {
    // Blocked ahead (a wall, or water a metal enemy refuses) — try the other
    // direction, but only commit if THAT one is actually walkable too, else
    // stand still instead of flip-flopping forever (reads as frozen).
    want = rt.canStepAhead(en, -want) ? -want : 0;
  }
  if (want !== 0) en.facing = want;
  en.vx = want * argNum(args[0], d.speed);
  return undefined;
}, "patrol(speed?) — drift between the patrol bounds, refusing unsafe steps; blocked both ways = stand still");
registerFn("moveToward", (ctx, args) => {
  const { rt, en, player } = enemyApi(ctx);
  const d = en.def;
  const target = argStr(args[0], "player");
  let targetX: number;
  if (target === "home") {
    targetX = en.homeX;
  } else {
    if (!player) {
      en.vx = 0;
      return undefined;
    }
    targetX = player.centerX;
  }
  const cx = en.x + d.width / 2;
  const dx = targetX - cx;
  let want = Math.abs(dx) > 4 ? Math.sign(dx) : 0;
  // Too smart to strand itself: no drops it can't climb, no wading.
  if (want !== 0 && !rt.canStepAhead(en, want)) want = 0;
  if (want !== 0) en.facing = want;
  en.vx = want * argNum(args[1], d.speed);
  return undefined;
}, "moveToward(player | home, speed?) — walk toward the player or the spawn post, refusing unsafe steps");
registerFn("applyGravityAndMove", (ctx, args) => {
  const { rt, en, dt } = enemyApi(ctx);
  const d = en.def;
  en.vy = Math.min(en.vy + argNum(args[0], 1400) * dt, argNum(args[1], 460));
  const res = rt.map.move(en.x, en.y, d.width, d.height, en.vx, en.vy, dt);
  if (res.hitWall && en.state === argStr(args[2], "patrol")) {
    en.facing = -en.facing;
  }
  en.x = res.x;
  en.y = res.y;
  en.vy = res.vy;
  return undefined;
}, "applyGravityAndMove(gravity?, maxFall?, flipOnWallIn?) — apply gravity and resolve movement; hitting a wall in the given state flips the facing");
registerFn("checkTraps", (ctx) => {
  const { rt, en } = enemyApi(ctx);
  const d = en.def;
  const rect = { x: en.x, y: en.y, w: d.width, h: d.height };
  for (const p of rt.placed) {
    if (p.data.type === "trap" && !p.data.used && rectsOverlap(rect, p)) {
      p.data.used = true;
      en.state = "trapped";
      rt.muts.disabledEnemies.add(en.index);
    }
  }
  return undefined;
}, "checkTraps() — a player-placed trap under this enemy captures it (trap consumed)");

// ---- entity (brazier & friends) ----
registerFn("touchesTileElement", (ctx, args) => {
  const { rt, e } = entityApi(ctx);
  const el = argStr(args[0], "");
  if (!el) return false;
  const tx0 = Math.floor(e.x / TILE);
  const tx1 = Math.floor((e.x + e.w - 1) / TILE);
  const ty0 = Math.floor(e.y / TILE);
  const ty1 = Math.floor((e.y + e.h - 1) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (rt.map.at(tx, ty)?.element === el) return true;
    }
  }
  return false;
}, "touchesTileElement(element) -> bool — is a tile of this element inside the entity footprint?");
registerFn("emitEvent", (ctx, args) => {
  const { e, events } = entityApi(ctx);
  events.push({
    effect: argStr(args[0], "fizzle"),
    x: e.x + e.w / 2,
    y: argStr(args[2], "top") === "center" ? e.y + e.h / 2 : e.y,
    color: argStr(args[1], "#ffffff"),
  });
  return undefined;
}, "emitEvent(effect, color?, at?) — push a feedback event (particles/sfx) at this entity (\"top\" or \"center\")");

