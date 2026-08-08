// Runtime instantiation of a RoomDef, including the elemental simulation:
// tile transformations, fire spread, spark conduction, and enemy reactions.
import type {
  BehaviorTrigger, Content, EnemyDef, EnemyReaction, RoomDef, RoomEntity,
  RuleDef, RuleEffect, TileDef,
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
  amount?: number;    // source: remaining stock (-1 = infinite); unused otherwise
  // capacitor: simNow() it can next turn back on — set on offFuseId trip to
  // energizeMs (how long a charged tile takes to discharge on its own), so
  // whatever it was still charging can't immediately re-trigger it.
  capacitorCooldownUntil?: number;
}

export interface EnemyInstance {
  index: number;
  def: EnemyDef;
  x: number; y: number;
  vx: number; vy: number;
  facing: number;
  state: "patrol" | "chase" | "return" | "stunned" | "trapped" | "panicked";
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
  state: "patrol" | "chase" | "return" | "stunned" | "trapped" | "panicked";
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
  // for capacitorOn/capacitorOff: identifies WHICH capacitor, so its ambient
  // hum loop can be started/stopped by a stable key instead of position
  // (on/off events report different y — center vs top — so x,y alone can't
  // reliably pair them back up).
  entityIndex?: number;
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
  capacitor: [14, 18],
  source: [16, 16],
  converter: [16, 16],
};

// Code-level fallbacks for the global tunables in content/behaviors.json
// (heat_spread / fluid_flow / element_effects docs) — the content values win.
const SPREAD_INTERVAL = 0.7; // seconds between fire spread ticks
const ENERGIZE_MS = 1500;
const HAZARD_COOLDOWN_MS = 500;
// How many tiles of clearance a panicked enemy needs (beyond the immediate
// step) before calming back to patrol — see waterPanic's recovery check.
const PANIC_CLEAR_TILES = 2;
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
  /** fall-origin tile index -> tile indices it backed up sideways while a
   *  closed gate blocked it (see tickFalls' closed-gate branch). Drained via
   *  drainDammedPool the moment that gate reopens — a dammed pool is
   *  overflow from a temporary obstruction, not a real base, so it doesn't
   *  get to linger as a permanent extra source once the real path resumes. */
  private dammedFallPools = new Map<number, Set<number>>();
  /** Tile indices of SOURCED water that came from a gate-dammed pool (see
   *  poolFallBase's requireContainment) — their own later "surface, fully
   *  fallen" spreading (the generic case in tickWaterFlow, used by every
   *  SOURCED tile) must keep respecting containment too, and propagate the
   *  tag to whatever they spread into, or only the FIRST tile a gate backed
   *  up would be leak-safe while everything it goes on to widen into is
   *  right back to unrestricted. Cleared as tiles drain (drainDammedPool)
   *  or otherwise stop being fluid. */
  private gateSourcedTiles = new Set<number>();
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
      const amountOverride = muts.sourceAmounts.find(([i]) => i === index);
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
        amount: def.type === "source"
          ? (amountOverride ? amountOverride[1] : def.sourceAmount ?? 0)
          : undefined,
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

  /** Does any closed gate (door + trapdoor) overlap this rect? Open gates
   *  and plain (non-gated) teleport doors never block — shared by every
   *  "does a closed gate stand here" check (fluid, enemy sight, enemy
   *  movement) so they can't drift out of sync with how it blocks the
   *  player (game.ts's own closed-gate collision pass). */
  private gateBlocksRect(box: { x: number; y: number; w: number; h: number }): boolean {
    return this.entities.some(
      (e) => (e.kind === "door" || e.kind === "trapdoor") && e.def.gate && !e.open && rectsOverlap(e, box)
    );
  }

  /** A closed gate (door + trapdoor) blocks fluid exactly like it blocks the
   *  player — open gates and plain (non-gated) teleport doors don't. */
  private doorBlocksFluid(tx: number, ty: number): boolean {
    return this.gateBlocksRect({ x: tx * TILE, y: ty * TILE, w: TILE, h: TILE });
  }

  /** Is this point inside a closed gate? Used by enemy sight, which rays
   *  through world-space points rather than tile cells. */
  private doorBlocksPoint(x: number, y: number): boolean {
    return this.gateBlocksRect({ x, y, w: 1, h: 1 });
  }

  /** A closed gate blocks enemy sight exactly like it blocks fluid and the
   *  player — the tile grid alone (Tilemap.lineOfSight) has no idea gates
   *  exist, since a closed gate is an entity overlay, not a carved tile
   *  (see the room-construction note above about doors never getting a
   *  solid tile under their own footprint). Samples the ray the same way
   *  Tilemap.lineOfSight does, so a spotter reacts consistently whether
   *  the thing in its cone is a wall or a shut door. */
  lineOfSightBlockedByDoor(x1: number, y1: number, x2: number, y2: number): boolean {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (TILE / 2));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.doorBlocksPoint(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return true;
    }
    return false;
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
  private fluidOccupied(
    tx: number, ty: number, moverElement?: string, events?: ElementEvent[]
  ): { ty: number; solid: boolean } {
    const r = this.realTileBelow(tx, ty, moverElement, events);
    if (!r.solid) return { ty: r.ty, solid: false };
    if (r.def && this.isFluid(r.def)) {
      // Resting on fluid THROUGH a grate whose overlay is still dry: the
      // grate cell itself is the resting spot — the pool's surface rising
      // through the walkway. Without this, fluid arriving from above found
      // "full below, no hole anywhere" and came to rest a full tile ABOVE
      // a visibly dry grate (Sean's mess_hall report: lava stacked on top
      // of the grate while the grate row itself carried nothing).
      if (r.grateY >= 0 && !this.grateFluid.has(this.map.index(tx, r.grateY))) {
        return { ty: r.grateY, solid: false };
      }
      return { ty: r.ty, solid: true };
    }
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
    tx: number, ty: number, moverElement?: string, events?: ElementEvent[]
  ): { ty: number; def: TileDef | null; solid: boolean; grateY: number } {
    let y = ty;
    let lastGrateY = -1;
    while (y < this.map.height) {
      if (this.doorBlocksFluid(tx, y)) return { ty: y, def: null, solid: true, grateY: -1 };
      // Water reaching fire (or goo, or anything else with a water rule)
      // reacts with it in passing — same "on fluidContact" spirit as
      // quenching lava, but for the passive flow tick, which never
      // consulted rules.json at all outside an active item swing. A tile
      // that clears away entirely (extinguishesTo/dissolvesTo: "") opens up
      // so this same walk sees an open cell next line down and the water
      // pools straight into it; a flammable tile that's merely burning (the
      // `burning` overlay) just stops burning — the tile itself (e.g. wood)
      // stays exactly as solid as it always was.
      if (moverElement === "water") this.reactFluidWithTile(tx, y, moverElement, events ?? []);
      const t = this.map.at(tx, y);
      if (t === null) return { ty: y, def: null, solid: false, grateY: -1 };
      if (t.fluidPasses) { y++; continue; } // gutter: pass straight through, never a resting spot
      if (t.style !== "platform") return { ty: y, def: t, solid: true, grateY: lastGrateY };
      lastGrateY = y;
      y++;
    }
    return { ty: y, def: null, solid: false, grateY: -1 };
  }

  /** See realTileBelow's water branch above — reacts (tx,ty) with the
   *  passing fluid via the SAME rules.json lookup the active item-swing path
   *  uses (findRule), instead of a hardcoded fire-only check, so any future
   *  "water + X -> clear-the-tile" rule (goo's dissolve today) gets this for
   *  free. Only ever clears the tile for "extinguish"/"dissolve" — the two
   *  effects whose *To field means "gone" — and only for non-fluid targets;
   *  water-vs-lava contact stays resolveFluidContact's job entirely (it
   *  hardens the OTHER side and needs to know which one is actually moving,
   *  something a read-only lookahead here can't determine). A merely-
   *  burning flammable tile (the `burning` overlay, e.g. ignited wood) just
   *  stops burning — the tile itself is unchanged, not cleared. No-op, no
   *  event, if nothing here reacts. */
  private reactFluidWithTile(tx: number, ty: number, moverElement: string, events: ElementEvent[]): void {
    const idx = this.map.index(tx, ty);
    let reacted = this.burning.delete(idx);
    const def = this.map.at(tx, ty);
    if (def && !this.isFluid(def)) {
      const rule = this.findRule(moverElement, def);
      const clearsTo = rule?.effect === "extinguish" ? def.extinguishesTo
        : rule?.effect === "dissolve" ? def.dissolvesTo
        : undefined;
      if (clearsTo !== undefined) {
        this.transformTile(tx, ty, clearsTo);
        reacted = true;
      }
    }
    if (reacted) {
      events.push({ effect: "extinguish", x: tx * TILE + 8, y: ty * TILE + 8, color: "#8f9bb3" });
    }
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
      // What happens is fluidFlow's `on fluidContact(mover, other)` policy:
      // destroyMover/keepMover × hardenOther(id?)/destroyOther/keepOther.
      // No handler = the classic rule (mover destroyed, other hardens).
      const data: Record<string, unknown> = {
        mover: moverDef.element, other: odef.element,
      };
      this.fireGlobalHook("fluidFlow", "fluidContact", data, ox, oy);
      const moverFate = data.moverFate ?? "destroy";
      const otherFate = data.otherFate ?? "harden";
      const oIdx = this.map.index(ox, oy);
      if (otherFate === "harden") {
        if (this.grateFluid.has(oIdx)) {
          // The grate itself can't harden into cracked stone — it's just
          // not carrying fluid anymore.
          this.grateFluid.delete(oIdx);
        } else {
          const hardenTo = typeof data.hardenTo === "string" ? data.hardenTo : undefined;
          this.transformTile(ox, oy, hardenTo ?? lavaDef.extinguishesTo ?? "cracked");
        }
        this.waterFlowDist.delete(oIdx);
      } else if (otherFate === "destroy") {
        this.clearFluid(ox, oy);
        this.waterFlowDist.delete(oIdx);
      }
      if (moverFate !== "keep" || otherFate !== "keep") {
        events.push({ effect: "extinguish", x: ox * TILE + 8, y: oy * TILE + 8, color: "#8f9bb3" });
      }
      // true = the mover was consumed by the contact (caller skips placing
      // it); keepMover lets it complete its move and coexist alongside.
      return moverFate !== "keep";
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

  /**
   * Sticky bomb burst: every EMPTY open cell within radiusPx of the
   * detonation point that borders at least one solid tile becomes a real
   * "goo" tile — the same substance already used for floor puddles, placed
   * via the ordinary tileOverrides mechanism (setTileById), so it's
   * persisted, editor-authorable-alike, and subject to the existing
   * elemental rules for free (flammable -> burns off, water -> dissolves).
   * Only truly empty cells are converted — fire/water/lava tiles are left
   * alone rather than overwritten.
   */
  spreadGoo(px: number, py: number, radiusPx: number): void {
    const gooDef = this.tilesById.get("goo");
    if (!gooDef) return;
    const ctx0 = Math.floor(px / TILE);
    const cty0 = Math.floor(py / TILE);
    const r = Math.ceil(radiusPx / TILE) + 1;
    for (let ty = cty0 - r; ty <= cty0 + r; ty++) {
      for (let tx = ctx0 - r; tx <= ctx0 + r; tx++) {
        if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) continue;
        if (this.map.at(tx, ty) !== null) continue; // only truly empty cells
        const cellCx = tx * TILE + TILE / 2;
        const cellCy = ty * TILE + TILE / 2;
        if (Math.hypot(cellCx - px, cellCy - py) > radiusPx) continue;
        const bordersSolid =
          !!this.map.at(tx - 1, ty)?.solid || !!this.map.at(tx + 1, ty)?.solid ||
          !!this.map.at(tx, ty - 1)?.solid || !!this.map.at(tx, ty + 1)?.solid;
        if (!bordersSolid) continue;
        this.setTileById(tx, ty, "goo");
      }
    }
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
  /**
   * Fire a policy hook on a global doc (fluidFlow / heatSpread). The doc's
   * handler writes its decision into `data` via the decision functions
   * (prefer, spreadLeft, keepHot, setDelay...); an untouched `data` field
   * means "no handler decided" and the caller falls back to legacy engine
   * behavior — which is what keeps stale docs (a localStorage draft or old
   * published bundle predating the hooks, possibly still carrying sideBias/
   * chainMeltRange vars) working unchanged.
   */
  private fireGlobalHook(
    docId: string, trigger: BehaviorTrigger,
    data: Record<string, unknown>, tx: number, ty: number
  ): void {
    this.bhv.fire(trigger, {
      hostDef: {},
      hostKey: "global:" + docId,
      attachments: [docId],
      data,
      api: { rt: this, tx, ty },
    });
  }

  /** [tx-1, tx+1] or [tx+1, tx-1] — which neighbor fluid tries FIRST when
   *  it must pick ONE side (a diagonal slide, a column squeeze, a finite
   *  pour moving). Policy lives in fluidFlow's `on pickSide` handler
   *  (prefer("left"/"right"/"alternate"), typically comparing sideDepth()
   *  on each side); no handler = legacy sideBias var, then the
   *  drift-cancelling alternate flip. */
  private sideXs(tx: number, ty: number): [number, number] {
    if (this.bhv.hasHandler("fluidFlow", "pickSide")) {
      const data: Record<string, unknown> = {};
      this.fireGlobalHook("fluidFlow", "pickSide", data, tx, ty);
      const pref = data.preferred;
      if (pref === "left") return [tx - 1, tx + 1];
      if (pref === "right") return [tx + 1, tx - 1];
      // "alternate", or a handler that stayed silent: the flip below.
    } else if (this.sideBias === "lower") {
      // Stale doc without a pickSide handler, still carrying the short-lived
      // sideBias:"lower" var — the original one-tile-lookahead comparison.
      const leftDepth = this.dropDepth(tx - 1, ty);
      const rightDepth = this.dropDepth(tx + 1, ty);
      if (leftDepth !== rightDepth) {
        return leftDepth > rightDepth ? [tx - 1, tx + 1] : [tx + 1, tx - 1];
      }
    }
    // Alternate flip; legacy left/right sideBias values ride flowFlipEff.
    return this.flowFlipEff ? [tx + 1, tx - 1] : [tx - 1, tx + 1];
  }

  /** Which sides a SOURCED (fall-fed) surface tile widens into this tick.
   *  Policy lives in fluidFlow's `on sourcedSpread` handler (spreadBoth /
   *  spreadLeft / spreadRight / spreadNone); no handler = both sides, the
   *  classic symmetric fill. */
  private spreadTargets(tx: number, ty: number): number[] {
    const data: Record<string, unknown> = {};
    this.fireGlobalHook("fluidFlow", "sourcedSpread", data, tx, ty);
    const mode = typeof data.spread === "string" ? data.spread : "both";
    if (mode === "none") return [];
    if (mode === "left") return [tx - 1];
    if (mode === "right") return [tx + 1];
    return this.flowFlipEff ? [tx + 1, tx - 1] : [tx - 1, tx + 1];
  }

  /** How far straight down from (tx,ty) the drop goes before hitting real
   *  solid ground — walks through existing fluid (a body already pooling
   *  somewhere doesn't make that spot read as shallower; the floor
   *  position underneath is what depth compares) and skips platforms,
   *  same tile classification tickWaterFlow uses elsewhere. Off the map
   *  (x out of bounds, or the column is open all the way to the floor)
   *  reads as maximally deep — callers already discard out-of-bounds
   *  candidates regardless of how they sort. */
  private dropDepth(tx: number, ty: number): number {
    let y = ty;
    while (y < this.map.height) {
      if (this.doorBlocksFluid(tx, y)) return y - ty; // closed gate = floor here
      const t = this.map.at(tx, y);
      if (t === null || t.style === "platform" || this.isFluid(t)) { y++; continue; }
      return y - ty; // real solid ground
    }
    return y - ty;
  }

  /**
   * Script query (sideDepth in fluidFlow handlers): the deepest floor
   * reachable within `lookahead` tiles to one side of (tx,ty) — slope-
   * following, so fluid a few tiles from a ledge still "sees" it, unlike a
   * bare one-tile dropDepth. A solid wall (or closed gate) at the fluid's
   * own row stops the scan: depth beyond a wall isn't connected.
   */
  sideDepth(tx: number, ty: number, dir: -1 | 1, lookahead: number): number {
    let best = 0;
    for (let i = 1; i <= lookahead; i++) {
      const x = tx + dir * i;
      if (x < 0 || x >= this.map.width) break;
      if (this.doorBlocksFluid(x, ty)) break;
      const t = this.map.at(x, ty);
      if (t !== null && t.style !== "platform" && !this.isFluid(t)) break; // wall
      const d = this.dropDepth(x, ty);
      if (d > best) best = d;
    }
    return best;
  }

  private tickWaterFlow(events: ElementEvent[]): void {
    if (!this.waterFlowEnabled) return;
    this.flowSideFlip = !this.flowSideFlip;
    // sideBias tunable: "left"/"right" pin every side check to one
    // direction; "alternate" (and "lower"'s equal-depth tie-break, and any
    // unrecognized value) use the drift-cancelling flip.
    this.flowFlipEff = this.sideBias === "left" ? false
      : this.sideBias === "right" ? true
      : this.flowSideFlip;
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
      const moveTo = (nx: number, ny: number, d: number, grab = true) => {
        // Seed vacate's visited set with the destination — otherwise the
        // grab-chain could immediately pull the very tile that just moved
        // back where it came from (an infinite ping-pong).
        const cameFrom = new Set<number>([this.map.index(nx, ny)]);
        const grabAfter = grab && distance !== SOURCED;
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
      const belowInfo = this.realTileBelow(tx, ty + 1, def.element, events);
      const fallTarget = this.fluidOccupied(tx, ty + 1, def.element, events);
      if (!fallTarget.solid) {
        moveTo(tx, fallTarget.ty, distance === SOURCED ? SOURCED : 0);
        continue;
      }
      const below = belowInfo.def;
      // 2. Part of a column still settling.
      if (below && this.isFluid(below)) {
        const belowBelowInfo = this.realTileBelow(tx, belowInfo.ty + 1, def.element, events);
        const columnGrounded = belowBelowInfo.ty >= this.map.height ||
          (belowBelowInfo.solid && !(belowBelowInfo.def && this.isFluid(belowBelowInfo.def)));
        if (columnGrounded) {
          for (const nx of this.sideXs(tx, ty)) {
            if (nx < 0 || nx >= this.map.width) continue;
            const target = this.fluidOccupied(nx, ty, def.element, events);
            if (target.solid) continue;
            // "Into an open hole": there must be room below the landing spot
            // too, not just a single flat opening at ty. Land IN the hole
            // (one diagonal step down), not beside it on the same row — a
            // same-row hop parks the tile over the hole for a tick, and the
            // vacate grab-chain can drag a neighbor back before the fall
            // turn ever comes, shuffling a two-tile body sideways forever
            // (the greenhouse "oscillates instead of falling" report).
            const holeBelow = this.fluidOccupied(nx, target.ty + 1, def.element, events);
            if (holeBelow.ty >= this.map.height || holeBelow.solid) continue;
            // No grab-refill here either: this tile is escaping a dead end
            // (resting beside a solid wall) sideways, not falling into open
            // space. If vacate() pulled a neighbor in behind it, that
            // neighbor would land in the exact same dead end and immediately
            // take the same escape route next tick — a two-tile ping-pong
            // that never actually drains (confirmed by a repro: melted water
            // beside a solid pillar flanked by open channels on both sides
            // settled into an infinite side-to-side swap instead of
            // draining).
            moveTo(nx, holeBelow.ty, distance, false);
            break;
          }
        }
        continue;
      }
      // Fully fallen from here down.
      const hasFluidAbove = ty > 0 && !!this.fluidDefAt(tx, ty - 1);
      if (hasFluidAbove) {
        // 3. Column pressure: the base squeezes out sideways (a move), the
        // column above falls into the vacated space next tick. No
        // grab-refill (see the matching note on case 2) — this base is
        // resting on solid ground, so pulling a neighbor into its old spot
        // would just hand that neighbor the same squeeze-and-swap escape.
        for (const nx of this.sideXs(tx, ty)) {
          if (nx < 0 || nx >= this.map.width) continue;
          const target = this.fluidOccupied(nx, ty, def.element, events);
          if (target.solid) continue;
          moveTo(nx, target.ty, distance, false);
          break;
        }
        continue;
      }
      // 4. Surface tile, fully fallen.
      if (distance === SOURCED) {
        // Fall-fed fluid IS an infinite source — it replicates outward until
        // walls or a drain stop it. WHICH sides it widens into each tick is
        // fluidFlow's `on sourcedSpread` policy (spreadTargets). A tile
        // tagged gateSourcedTiles (backed up behind a closed gate, not
        // resting on a real designed floor — see poolFallBase) keeps
        // requiring solid ground directly under wherever it spreads next,
        // same as its own placement did, and passes the tag along to
        // whatever it spreads into — otherwise only the very first tile a
        // gate backed up was leak-safe, and everything it went on to widen
        // into was right back to unrestricted spreading.
        const containedOnly = this.gateSourcedTiles.has(idx);
        for (const nx of this.spreadTargets(tx, ty)) {
          if (nx < 0 || nx >= this.map.width) continue;
          const target = this.fluidOccupied(nx, ty, def.element, events);
          if (target.solid) continue;
          if (containedOnly) {
            const below = this.fluidOccupied(nx, target.ty + 1, def.element, events);
            if (!below.solid) continue;
          }
          if (this.resolveFluidContact(nx, target.ty, def, tx, ty, events)) continue;
          const nIdx = this.map.index(nx, target.ty);
          this.placeFluid(nx, target.ty, def);
          this.waterFlowDist.set(nIdx, SOURCED);
          if (containedOnly) this.gateSourcedTiles.add(nIdx);
          events.push({ effect: "flow", x: nx * TILE + 8, y: target.ty * TILE + 8, color: def.color });
        }
        continue;
      }
      // Finite fluid (melted/poured) is CONSERVED — it never replicates.
      // It only moves toward an adjacent hole it can fall into, so when a
      // neighboring tile drops away the grounded body follows it down: the
      // whole thing slushes downhill instead of becoming an infinite source.
      for (const nx of this.sideXs(tx, ty)) {
        if (nx < 0 || nx >= this.map.width) continue;
        const target = this.fluidOccupied(nx, ty, def.element, events);
        if (target.solid) continue;
        // Same "land IN the hole" rule as the diagonal slide above — see the
        // perpetual-shuffle note there.
        const holeBelow = this.fluidOccupied(nx, target.ty + 1, def.element, events);
        if (holeBelow.ty >= this.map.height || holeBelow.solid) continue;
        // No grab-refill (see case 2's note) — same dead-end-escape shape.
        moveTo(nx, holeBelow.ty, distance, false);
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
      // A gate just closed exactly where THIS segment already sits (it grew
      // through while the gate was open, before ever getting a chance to
      // check — the closed-gate check below only ever runs for a segment
      // querying its OWN below, never for a segment already occupying a
      // cell). A shut door can't have a waterfall visibly running through
      // its own middle — that's what "the water is still falling through
      // the trapdoor" was actually reporting (a real fall tile physically
      // sitting on the door's cell, not water finding a way around it).
      // Clear this segment and convert everything still hanging below it —
      // now orphaned from the source above, since growth stopped here too —
      // from the fall's self-perpetuating identity into ordinary finite
      // fluid, so it settles/drains like any other water instead of
      // sitting there forever as a frozen "still falling" glyph with
      // nothing visibly feeding it.
      if (this.doorBlocksFluid(tx, ty)) {
        this.fallTiles.delete(idx);
        this.setTileById(tx, ty, undefined);
        const fluidDef = this.tilesById.get(def.fallSpawns);
        if (fluidDef) {
          for (let oy = ty + 1; oy < this.map.height; oy++) {
            const odef = this.map.at(tx, oy);
            if (!odef || odef.id !== def.id) break;
            const oIdx = this.map.index(tx, oy);
            this.fallTiles.delete(oIdx);
            this.setTileById(tx, oy, fluidDef.id);
            this.waterFlowDist.set(oIdx, 0); // conserved now, not an infinite source
          }
        }
        continue;
      }
      if (ty + 1 >= this.map.height) continue;
      // Metal grates are transparent to fluid — a fall skips straight
      // through any directly below instead of resting on them. A closed
      // gate is the opposite: solid to fluid even where the tile itself is
      // empty, so the fall just stops and waits rather than growing past it.
      const belowInfo = this.realTileBelow(tx, ty + 1, def.element, events);
      if (belowInfo.ty >= this.map.height) continue;
      const below = belowInfo.def;
      const belowTy = belowInfo.ty;
      if (below === null) {
        if (belowInfo.solid) {
          // Blocked by a closed gate — realTileBelow reports this the same
          // shape as "genuinely nothing here yet" (def: null), which used to
          // make this branch just `continue` forever: a shut door could stop
          // the fall from growing, but could never trigger the pool-forming
          // logic below (that only ever fired for a REAL solid tile def), so
          // water dammed by a closed trapdoor just hung there indefinitely
          // instead of pooling — reported live: "the trapdoor was very much
          // not stopping the water even after I closed it." A closed gate
          // needs to behave exactly like landing on solid ground: start (or
          // keep) pooling at the row just above it. SOURCED like the real
          // thing (so it keeps topping up while the gate stays shut) — but
          // tracked in dammedFallPools, because unlike real ground this is a
          // reversible obstruction: see the "genuinely open" branch below,
          // which drains it back out once the gate reopens.
          const fluidDef = this.tilesById.get(def.fallSpawns);
          if (fluidDef) {
            const placed = this.poolFallBase(tx, belowInfo.ty - 1, fluidDef, events, true);
            let pool = this.dammedFallPools.get(idx);
            if (!pool) { pool = new Set(); this.dammedFallPools.set(idx, pool); }
            for (const p of placed) pool.add(p);
          }
          continue;
        }
        // Genuinely open — the fall's own vertical body just keeps growing.
        // (A grate flush against real ground further down is handled below,
        // as the base pool's landing spot, not as fall growth.)
        this.setTileById(tx, belowTy, def.id);
        events.push({ effect: "flow", x: tx * TILE + 8, y: belowTy * TILE + 8, color: def.color });
        // The gate that was damming this fall (if any) just reopened — the
        // backed-up pool it built up sideways is overflow, not a real base,
        // and shouldn't get to sit there as a permanent extra source now
        // that the real path down is flowing again (reported live: "the
        // water that pushed left should dry up... now that the gate is
        // open"). Drain it the same staggered farthest-first way a gate
        // CLOSING cuts off the far side (recedeCutOffFluid) — just running
        // in the other direction, back toward the reopened gate.
        this.drainDammedPool(idx, tx, belowTy, events);
        continue;
      }
      // Mid-fall tiles (another fall tile below) do nothing; the base acts.
      if (below.id === def.id) continue;
      if (below.style === "drain") continue; // fully absorbed, nothing pools
      const fluidDef = this.tilesById.get(def.fallSpawns);
      if (!fluidDef) continue;
      // Fall landing on the opposite liquid — same `on fluidContact` policy
      // as horizontal contact (mover = the falling fluid; it never gets a
      // tile regardless, the fall just keeps pouring into the reaction).
      if (this.isFluid(below) && below.element !== fluidDef.element) {
        const lavaSide = below.element === "lava" ? below : fluidDef;
        const data: Record<string, unknown> = {
          mover: fluidDef.element, other: below.element,
        };
        this.fireGlobalHook("fluidFlow", "fluidContact", data, tx, belowTy);
        const otherFate = data.otherFate ?? "harden";
        if (otherFate === "harden") {
          const hardenTo = typeof data.hardenTo === "string" ? data.hardenTo : undefined;
          this.transformTile(tx, belowTy, hardenTo ?? lavaSide.extinguishesTo ?? "");
        } else if (otherFate === "destroy") {
          this.clearFluid(tx, belowTy);
          this.waterFlowDist.delete(this.map.index(tx, belowTy));
        }
        if (otherFate !== "keep") {
          events.push({ effect: "extinguish", x: tx * TILE + 8, y: belowTy * TILE + 8, color: "#8f9bb3" });
        }
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
      // the pool (see poolFallBase) one row above the solid (which may be
      // several rows below the fall if grates were skipped).
      this.poolFallBase(tx, belowTy - 1, fluidDef, events);
    }
  }

  /** A fall has hit its base (real solid ground OR a closed gate — see the
   *  call sites) at baseTy+1: start (or keep) the pool by emitting into open
   *  side tiles at baseTy, SOURCED (an eternal top-up — this genuinely is
   *  fed by an infinite fall, whichever kind of base it hit). Sourced
   *  spreading, so `on sourcedSpread` governs which sides it widens into.
   *  Returns every tile index the pool now occupies (placed this call, or
   *  already there and topped up) — the closed-gate call site uses this to
   *  remember what to drain once the gate reopens (dammedFallPools /
   *  drainDammedPool).
   *
   *  Real solid ground (the default, requireContainment=false) is allowed
   *  to spill into any gap it finds — that's how a waterfall meets a ledge
   *  and keeps flowing elsewhere, and existing tests rely on exactly that.
   *
   *  A closed gate (requireContainment=true) is different: unlike real
   *  ground it's a reversible obstruction sitting at whatever row the fall
   *  happened to be blocked at, a spot the room was never designed as a
   *  floor — so refuse to place into anything that doesn't have solid
   *  ground directly under it. Placed tiles are also tagged into
   *  gateSourcedTiles, which makes their OWN later spreading (the generic
   *  "surface, fully fallen" case elsewhere in tickWaterFlow) keep applying
   *  this same check as the pool widens, propagating the tag forward —
   *  without it, a single open gap anywhere the pool eventually reached
   *  (not just this call's own immediate neighbors) turned into a permanent
   *  trickle feeding an entire second waterfall down whatever shaft it
   *  found, reported live after containment-checking only this call's own
   *  placement: pooling stopped leaking, but also stopped ever widening
   *  across the room's actual floor toward open space (a real, contained
   *  place it should have kept spreading into). */
  private poolFallBase(
    tx: number, baseTy: number, fluidDef: TileDef, events: ElementEvent[], requireContainment = false
  ): number[] {
    const touched: number[] = [];
    for (const nx of this.spreadTargets(tx, baseTy)) {
      if (nx < 0 || nx >= this.map.width) continue;
      // baseTy itself may be a grate spanning the whole walkway (flush over
      // the real floor, no gap) — resolve through it same as falling does,
      // so the pool can spread along/under a grated walkway toward a door
      // instead of being unable to find anywhere to place a single tile.
      const target = this.fluidOccupied(nx, baseTy, fluidDef.element, events);
      if (target.solid) continue;
      if (requireContainment) {
        const below = this.fluidOccupied(nx, target.ty + 1, fluidDef.element, events);
        if (!below.solid) continue;
      }
      if (this.resolveFluidContact(nx, target.ty, fluidDef, tx, baseTy, events)) continue;
      this.placeFluid(nx, target.ty, fluidDef);
      const tIdx = this.map.index(nx, target.ty);
      this.waterFlowDist.set(tIdx, SOURCED);
      if (requireContainment) this.gateSourcedTiles.add(tIdx);
      touched.push(tIdx);
      events.push({ effect: "flow", x: nx * TILE + 8, y: target.ty * TILE + 8, color: fluidDef.color });
    }
    return touched;
  }

  /** A fall origin's gate just reopened — drain the pool it backed up while
   *  dammed, the same staggered farthest-first way recedeCutOffFluid drains
   *  a body cut off by a gate CLOSING, just measured from the reopened
   *  point instead. No-op if this origin never actually dammed anything
   *  (the common case — most falls never meet a gate at all).
   *
   *  dammedFallPools only ever records what poolFallBase itself directly
   *  placed — the pool's OWN first layer — but a gate-sourced tile goes on
   *  to widen further on its own later ticks (case 4's SOURCED spread,
   *  propagating the gateSourcedTiles tag as it goes), so the true extent
   *  of what THIS gate backed up can reach well beyond that first layer.
   *  Flood-fills outward from it through connected gateSourcedTiles
   *  (matching element, matching the reachability walk recedeCutOffFluid
   *  already does) to find everything, not just what was recorded as
   *  directly placed. */
  private drainDammedPool(originIdx: number, gateX: number, gateY: number, events: ElementEvent[]): void {
    const seed = this.dammedFallPools.get(originIdx);
    this.dammedFallPools.delete(originIdx);
    if (!seed || seed.size === 0) return;
    const pool = new Set<number>();
    const queue = [...seed];
    while (queue.length > 0) {
      const idx = queue.pop()!;
      if (pool.has(idx) || !this.waterFlowDist.has(idx)) continue;
      pool.add(idx);
      const tx = idx % this.map.width, ty = Math.floor(idx / this.map.width);
      // fluidDefAt, not raw map.at — a tile carrying its water as a grate
      // overlay (a metal grate flush against solid ground) reads back as
      // the grate itself (element "metal") from map.at, not the water it's
      // carrying, which silently broke the walk right at any grate: the
      // element compare below never matched, so gateSourcedTiles membership
      // was ignored and a grate-carried tile — despite being tagged and
      // despite still being fluid — never made it into the drain set
      // (reported live: "why didn't the water that hit the grate dry up
      // with the rest?"). fluidDefAt already knows to check the grate
      // overlay first, same as every other fluid-identity read in the sim.
      const def = this.fluidDefAt(tx, ty);
      if (!def) continue;
      for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]] as const) {
        if (nx < 0 || nx >= this.map.width || ny < 0 || ny >= this.map.height) continue;
        const nIdx = this.map.index(nx, ny);
        if (pool.has(nIdx) || !this.gateSourcedTiles.has(nIdx)) continue;
        const ndef = this.fluidDefAt(nx, ny);
        if (!ndef || ndef.element !== def.element) continue;
        queue.push(nIdx);
      }
    }
    const now = simNow();
    const cx = gateX * TILE + TILE / 2, cy = gateY * TILE + TILE / 2;
    let maxDist = 0;
    const withDist: { idx: number; d: number }[] = [];
    for (const idx of pool) {
      if (this.draining.has(idx)) continue;
      const tx = idx % this.map.width, ty = Math.floor(idx / this.map.width);
      const d = Math.hypot(tx * TILE + TILE / 2 - cx, ty * TILE + TILE / 2 - cy);
      withDist.push({ idx, d });
      if (d > maxDist) maxDist = d;
    }
    for (const { idx, d } of withDist) {
      this.gateSourcedTiles.delete(idx);
      const ratio = maxDist > 0 ? d / maxDist : 1;
      const tx = idx % this.map.width, ty = Math.floor(idx / this.map.width);
      const data: Record<string, unknown> = { ratio };
      this.fireGlobalHook("fluidFlow", "recede", data, tx, ty);
      const delay = typeof data.delayMs === "number"
        ? Math.max(0, data.delayMs)
        : this.recedeMsEff * (1 - ratio);
      this.draining.set(idx, now + delay);
      this.waterFlowDist.delete(idx);
      events.push({ effect: "flow", x: tx * TILE + 8, y: ty * TILE + 8, color: "#8f9bb3" });
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
    if (count > 0) {
      this.checkFuseboxes(events);
      this.checkCapacitors(events);
    }
  }

  /** A capacitor turns on from ANY charge reaching it (no fuseId match
   *  needed, unlike a fusebox trip) and, once on, stays on across ticks —
   *  only tripFusebox's offFuseId check turns it back off. */
  private checkCapacitors(events: ElementEvent[]): void {
    const now = simNow();
    for (const cap of this.entities) {
      if (cap.kind !== "capacitor" || cap.open) continue;
      if (cap.capacitorCooldownUntil && now < cap.capacitorCooldownUntil) continue;
      const tx0 = Math.floor(cap.x / TILE) - 1;
      const tx1 = Math.floor((cap.x + cap.w) / TILE) + 1;
      const ty0 = Math.floor(cap.y / TILE) - 1;
      const ty1 = Math.floor((cap.y + cap.h) / TILE) + 1;
      let hit = false;
      for (let ty = ty0; ty <= ty1 && !hit; ty++) {
        for (let tx = tx0; tx <= tx1 && !hit; tx++) {
          const until = this.energized.get(this.map.index(tx, ty));
          if (until && until > now) hit = true;
        }
      }
      if (hit) {
        cap.open = true;
        this.muts.openedDoors.add(cap.index);
        // Own effect, not "fuse" — a capacitor turning on starts a quiet
        // ambient hum, not the fusebox's one-shot "unlock" clink.
        events.push({
          effect: "capacitorOn", x: cap.x + cap.w / 2, y: cap.y + cap.h / 2,
          color: "#ffe95a", entityIndex: cap.index,
        });
      }
    }
  }

  /** Re-energizes every conductive tile touching an "on" capacitor, every
   *  flow tick — the continuous-shock half of the feature. Rides the same
   *  fixed cadence as tickWaterFlow so it stays replay-deterministic. */
  private tickCapacitors(events: ElementEvent[]): void {
    for (const cap of this.entities) {
      if (cap.kind !== "capacitor" || !cap.open) continue;
      const tx0 = Math.floor(cap.x / TILE) - 1;
      const tx1 = Math.floor((cap.x + cap.w) / TILE) + 1;
      const ty0 = Math.floor(cap.y / TILE) - 1;
      const ty1 = Math.floor((cap.y + cap.h) / TILE) + 1;
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (tx >= cap.x / TILE && tx < (cap.x + cap.w) / TILE
            && ty >= cap.y / TILE && ty < (cap.y + cap.h) / TILE) continue;
          this.energizeFrom(tx, ty, events);
        }
      }
    }
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
    // A capacitor left running keeps re-touching this fusebox's box every
    // flow tick, calling this repeatedly while fb is already open — only
    // announce (sfx/particles/CLUNK text) on an actual off->on transition,
    // or that reads as the fusebox clinking nonstop instead of just once.
    const wasOpen = fb.open;
    fb.open = true;
    this.muts.openedDoors.add(fb.index);
    if (!wasOpen) {
      events.push({ effect: "fuse", x: fb.x + fb.w / 2, y: fb.y, color: "#ffe95a" });
    }
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
    for (const cap of this.entities) {
      if (cap.kind !== "capacitor" || !cap.open) continue;
      if (cap.def.offFuseId && cap.def.offFuseId === fb.def.fuseId) {
        cap.open = false;
        this.muts.openedDoors.delete(cap.index);
        // Cooldown = however long a charged tile takes to discharge on its
        // own — long enough that anything the capacitor was still charging
        // has genuinely gone dark before it's allowed to trip back on, so
        // it can't immediately re-trigger itself through its own leftover charge.
        cap.capacitorCooldownUntil = simNow() + this.energizeMs;
        events.push({
          effect: "capacitorOff", x: cap.x + cap.w / 2, y: cap.y + cap.h / 2,
          color: "#e8a2b4", entityIndex: cap.index,
        });
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
      const tx = idx % this.map.width, ty = Math.floor(idx / this.map.width);
      // WHEN each cut-off tile dries is fluidFlow's `on recede(ratio)`
      // policy (setDelay(ms); ratio 0 = at the closed gate, 1 = farthest).
      // No handler = the legacy stagger, farthest-first over recedeMs.
      const data: Record<string, unknown> = { ratio };
      this.fireGlobalHook("fluidFlow", "recede", data, tx, ty);
      const delay = typeof data.delayMs === "number"
        ? Math.max(0, data.delayMs)
        : this.recedeMsEff * (1 - ratio);
      this.draining.set(idx, now + delay);
      this.waterFlowDist.delete(idx);
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

  // ================= SOURCES =================

  /** Grabs one unit from a source, persisting the reduced stock. Returns
   *  false (no mutation) when a finite source is already empty; infinite
   *  (-1) sources never deplete. */
  grabFromSource(e: EntityInstance): boolean {
    if (e.amount === undefined || e.amount === SOURCED) return e.amount === SOURCED;
    if (e.amount <= 0) return false;
    e.amount -= 1;
    const existing = this.muts.sourceAmounts.find(([i]) => i === e.index);
    if (existing) existing[1] = e.amount;
    else this.muts.sourceAmounts.push([e.index, e.amount]);
    return true;
  }

  // ================= QUERIES =================

  /** Nearest interactable entity within reach of the player center. */
  interactableNear(px: number, py: number, range = 22): EntityInstance | null {
    let best: EntityInstance | null = null;
    let bestD = range;
    for (const e of this.entities) {
      if (e.collected) continue;
      if (!["note", "door", "trapdoor", "locker", "npc", "exit", "source", "converter"].includes(e.kind)) continue;
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
    // A closed gate blocks exactly like a real wall — it's an entity
    // overlay, not a tile, so the tile-grid solid check above never sees it
    // (same reason enemy sight needs lineOfSightBlockedByDoor: a gate's
    // footprint is deliberately never carved as a solid tile, see the room-
    // construction note near the door/trapdoor entity loop).
    if (this.gateBlocksRect({ x: aheadTx * TILE, y: tyBody0 * TILE, w: TILE, h: (tyBody1 - tyBody0 + 1) * TILE })) {
      return false;
    }
    // Metal creatures refuse water — pools are a safe zone (now a lethal
    // one, see reactToTileHazards — so this refusal is what keeps them
    // from ever actually stepping into it in the first place).
    if (d.element === "metal" && this.waterBlocksStep(en, want)) return false;
    // No drops it can't climb back out of (max 1 tile down). isFloorTile,
    // not a bare `.solid` check — a one-way platform (metal grate) is real
    // standable ground (the player and toyblocks both rest on it the same
    // as a solid floor) but never sets `solid` itself, since it's meant to
    // be walked through from below/dropped through, not blocked outright.
    // Using `.solid` alone made every grate-topped floor read as a
    // bottomless drop, so a patrolling enemy would reach one and just stop
    // (player report: "Spotter stops walking when on metal grate").
    for (let step = 0; step < 2; step++) {
      if (this.isFloorTile(aheadTx, Math.floor((footY + 4 + step * TILE) / TILE))) return true;
    }
    return false;
  }

  /** Is there a water tile in the step `want` would take (extraTiles=0, the
   *  exact footprint canStepAhead's water refusal checks), or within
   *  `extraTiles` further tiles in that direction? The wider lookahead is
   *  for waterPanic's recovery check specifically — using extraTiles=0
   *  there would calm an enemy back to patrol the instant it took a single
   *  step away (water is a whole tile behind it, so "immediately ahead" is
   *  already clear), reading as a one-frame panic flicker instead of an
   *  actual flee. */
  waterBlocksStep(en: EnemyInstance, want: number, extraTiles = 0): boolean {
    if (want === 0) return false;
    const d = en.def;
    const footY = en.y + d.height;
    const ty = Math.floor((footY - 4) / TILE);
    for (let i = 0; i <= extraTiles; i++) {
      const aheadX = want > 0 ? en.x + d.width + 3 + i * TILE : en.x - 3 - i * TILE;
      const aheadTx = Math.floor(aheadX / TILE);
      if (this.map.at(aheadTx, ty)?.element === "water") return true;
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
      range: num(p.range, 120), // matches chaseOnSight's own default
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
            // Whether the chain continues is heatSpread's `on meltChain(depth)`
            // policy — keepHot() lets the vacated cell radiate one more tick,
            // and a handler that stays silent is CHOOSING to stop the chain
            // (hence the explicit hasHandler check: silence from an existing
            // handler must not fall through to the legacy default). No
            // handler at all = the legacy chainMeltRange var (-1 = unlimited).
            if (elem === "lava") {
              const nDepth = depth + 1;
              let keep: boolean;
              if (this.bhv.hasHandler("heatSpread", "meltChain")) {
                const data: Record<string, unknown> = { depth: nDepth };
                this.fireGlobalHook("heatSpread", "meltChain", data, nx, ny);
                keep = data.keepHot === true;
              } else {
                keep = this.chainMeltRange < 0 || nDepth <= this.chainMeltRange;
              }
              if (keep) this.meltedHot.set(this.map.index(nx, ny), nDepth);
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
      this.tickCapacitors(events);
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
      case "capacitor": {
        ctx.fillStyle = "#3a3550";
        roundRect(ctx, e.x - 1, e.y - 1, e.w + 2, e.h + 2, 2);
        ctx.fill();
        ctx.fillStyle = e.open ? "#ffe95a" : "#59627f";
        ctx.fillRect(e.x, e.y, e.w, e.h);
        ctx.strokeStyle = e.open ? "#4a3d0d" : "#8892a8";
        ctx.lineWidth = 1.5;
        // Two facing arcs — reads as a stored-charge cell, distinct from
        // fusebox's single trigger-bolt glyph.
        ctx.beginPath();
        ctx.arc(e.x + e.w / 2 - 2, e.y + e.h / 2, 4, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(e.x + e.w / 2 + 2, e.y + e.h / 2, 4, Math.PI / 2, -Math.PI / 2);
        ctx.stroke();
        if (e.open) {
          // Continuous emitting halo — "still live", not a one-shot flicker.
          const pulse = 0.18 + Math.sin(animT * 5 + e.index) * 0.08;
          ctx.fillStyle = `rgba(255,233,90,${pulse})`;
          ctx.beginPath();
          ctx.arc(e.x + e.w / 2, e.y + e.h / 2, e.w + 3, 0, Math.PI * 2);
          ctx.fill();
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
      case "source": {
        const item = this.content.items.find((i) => i.id === e.def.sourceItem);
        const empty = e.amount !== undefined && e.amount !== SOURCED && e.amount <= 0;
        const casing = "#454e5e";
        const bx = e.x - 2, by = e.y - 2, bw = e.w + 4, bh = e.h + 4;
        const wx = e.x + e.w / 2, wy = e.y + e.h / 2 - 1 + bob * 0.4;
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.ellipse(wx, e.y + e.h + 3, 8, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        // A riveted steel hopper — reads as a dispensing MACHINE, not the
        // item it holds. The item only appears in the recessed display.
        ctx.fillStyle = casing;
        roundRect(ctx, bx, by, bw, bh, 3);
        ctx.fill();
        ctx.fillStyle = shade(casing, -25);
        roundRect(ctx, bx, by, bw, 3, 2);
        ctx.fill();
        ctx.fillStyle = shade(casing, -35);
        for (const [rx, ry] of [[bx + 2, by + 2], [bx + bw - 2, by + 2],
          [bx + 2, by + bh - 2], [bx + bw - 2, by + bh - 2]] as [number, number][]) {
          ctx.beginPath();
          ctx.arc(rx, ry, 1, 0, Math.PI * 2);
          ctx.fill();
        }
        // Dispense slot at the base.
        ctx.fillStyle = "#0d0f14";
        ctx.fillRect(e.x + 2, e.y + e.h, e.w - 4, 2);
        // Recessed display window showing the real item icon.
        ctx.fillStyle = "#181c24";
        roundRect(ctx, wx - 6, wy - 6, 12, 12, 2);
        ctx.fill();
        if (item) {
          ctx.globalAlpha = empty ? 0.35 : 1;
          drawItemIcon(ctx, item, wx, wy, 0.85);
          ctx.globalAlpha = 1;
        }
        // Status light: lit green while stocked, dead red when empty.
        const lx = bx + bw - 4, ly = by + bh - 4;
        if (!empty) {
          ctx.globalAlpha = 0.4 + Math.sin(animT * 3 + e.index) * 0.3;
          ctx.fillStyle = "#5ad18a";
          ctx.beginPath();
          ctx.arc(lx, ly, 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = empty ? "#5a3a3a" : "#8af0b8";
        ctx.beginPath();
        ctx.arc(lx, ly, 1.4, 0, Math.PI * 2);
        ctx.fill();
        // Amount/infinity badge — always visible so a source's stock is
        // clear at a glance, not just discoverable on interact.
        const label = e.amount === SOURCED ? "∞" : String(e.amount ?? 0);
        ctx.font = "8px monospace";
        ctx.fillStyle = empty ? "#8a7f9a" : "#f4ead8";
        const tw = ctx.measureText(label).width;
        ctx.fillText(label, wx - tw / 2, by - 3);
        break;
      }
      case "converter": {
        const inItem = this.content.items.find((i) => i.id === e.def.convertInput);
        const outItem = this.content.items.find((i) => i.id === e.def.convertOutput);
        const casing = "#3f4a52";
        const cy = e.y + e.h / 2 - 1 + bob * 0.4;
        const leftX = e.x - 3, rightX = e.x + e.w + 3;
        const bx = leftX - 5, by = e.y - 2, bw = rightX + 5 - bx, bh = e.h + 4;
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.ellipse(e.x + e.w / 2, e.y + e.h + 3, bw / 2, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        // A wider chassis with two hopper windows and a grinding gear
        // core between them — reads as a converter MACHINE, not a pair
        // of floating icons.
        ctx.fillStyle = casing;
        roundRect(ctx, bx, by, bw, bh, 3);
        ctx.fill();
        ctx.fillStyle = shade(casing, -25);
        roundRect(ctx, bx, by, bw, 3, 2);
        ctx.fill();
        ctx.fillStyle = shade(casing, -35);
        for (const [rx, ry] of [[bx + 2, by + 2], [bx + bw - 2, by + 2],
          [bx + 2, by + bh - 2], [bx + bw - 2, by + bh - 2]] as [number, number][]) {
          ctx.beginPath();
          ctx.arc(rx, ry, 1, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#181c24";
        roundRect(ctx, leftX - 6, cy - 6, 12, 12, 2);
        ctx.fill();
        roundRect(ctx, rightX - 6, cy - 6, 12, 12, 2);
        ctx.fill();
        if (inItem) drawItemIcon(ctx, inItem, leftX, cy, 0.75);
        if (outItem) drawItemIcon(ctx, outItem, rightX, cy, 0.75);
        // Slow-turning gear core — the "trade" affordance, animated so it
        // reads as active machinery rather than a static prop.
        ctx.save();
        ctx.translate(e.x + e.w / 2, cy);
        ctx.rotate(animT * 1.1);
        ctx.strokeStyle = "#c9b8e8";
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          ctx.moveTo(Math.cos(a) * 2.6, Math.sin(a) * 2.6);
          ctx.lineTo(Math.cos(a) * 5, Math.sin(a) * 5);
        }
        ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        const inCount = e.def.convertInputCount ?? 1;
        const outCount = e.def.convertOutputCount ?? 1;
        if (inCount > 1 || outCount > 1) {
          ctx.font = "7px monospace";
          ctx.fillStyle = "#f4ead8";
          if (inCount > 1) ctx.fillText(String(inCount), leftX - 3, by - 3);
          if (outCount > 1) ctx.fillText(String(outCount), rightX - 3, by - 3);
        }
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
    if (en.state === "panicked") {
      // Fast agitated shake + a blue "!" — distinct from chase's red "!" so
      // "fleeing water" doesn't read as "hunting you."
      const wob = Math.sin(animT * 22 + en.index) * 0.16;
      drawBlob(
        ctx, en.x, en.y, d.width, d.height, d.color, d.eyeColor, en.facing,
        { squashX: 1 + wob, squashY: 1 - wob, eyeStyle: "wide", sprite: d }
      );
      ctx.fillStyle = "#7fd8ff";
      ctx.font = "9px monospace";
      ctx.fillText("!", en.x + d.width / 2 - 1, en.y - 4);
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
  return rt.map.lineOfSight(cx, cy, player.centerX, player.centerY)
    && !rt.lineOfSightBlockedByDoor(cx, cy, player.centerX, player.centerY);
}, "seesPlayer(range?, halfSlope?, conePad?) -> bool — forward vision cone + line of sight; hidden players, smoke, and closed gates block it");
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
  // -1: an exclusive right edge. Without it, an enemy whose width is an
  // exact tile multiple and sits flush against (not overlapping) a hazard —
  // exactly what canStepAhead's water refusal presses a panicking enemy
  // into — floors to the NEXT tile over, reading merely-adjacent as
  // touching. Harmless for fire/lava (nothing presses an enemy flush
  // against those), but water now has both a "stand flush at the edge"
  // behavior (waterPanic) and this hazard-kill scan, so the two must agree
  // on what "touching" means or standing at a safe distance is impossible.
  const tx1 = Math.floor((en.x + d.width - 1) / TILE);
  const ty0 = Math.floor(en.y / TILE);
  const ty1 = Math.floor((en.y + d.height + 2) / TILE);
  let applied: string | null = null;
  for (let ty = ty0; ty <= ty1 && !applied; ty++) {
    for (let tx = tx0; tx <= tx1 && !applied; tx++) {
      const tdef = rt.map.at(tx, ty);
      if (rt.isBurning(tx, ty) || tdef?.element === "fire") applied = "fire";
      else if (tdef?.element === "lava") applied = "lava";
      else if (tdef?.element === "water") applied = rt.isEnergized(tx, ty) ? "electrifiedWater" : "water";
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
}, "reactToTileHazards(cooldownMs?) — fire/lava/spark/water tiles under the enemy apply their element through its reactions (an energized water tile applies electrifiedWater instead of plain water/spark); halts the dispatch on a kill");
registerFn("reactFromTable", (ctx, args) => {
  const element = typeof ctx.data.element === "string" ? ctx.data.element : "";
  const table = args[0];
  const reaction = table && typeof table === "object"
    ? ((table as Record<string, unknown>)[element] as EnemyReaction | undefined) ?? "none"
    : "none";
  applyReaction(ctx, reaction);
  return ctx.data.reaction;
}, "reactFromTable(reactions) — look the contacting element up in the given {element: kill|stun|knockback|none} map and apply the result");
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
registerFn("waterPanic", (ctx, args) => {
  // Water is lethal (reactToTileHazards), so canStepAhead already refuses
  // to ever step a metal enemy into it — this is what makes that refusal
  // VISIBLE and directional instead of a silent stand-still: entering
  // "panicked" flees toward whichever patrol direction isn't water, and
  // holds position (still panicked, not back to calm patrol) if fleeing
  // would mean leaving the patrol zone or running into more water.
  const { rt, en } = enemyApi(ctx);
  const d = en.def;
  const speed = argNum(args[0], d.speed);
  const cx = en.x + d.width / 2;

  if (en.state === "patrol") {
    let want = en.facing;
    if (cx <= en.patrolMin) want = 1;
    else if (cx >= en.patrolMax) want = -1;
    if (rt.waterBlocksStep(en, want)) {
      en.state = "panicked";
      en.vx = 0;
    }
    return undefined;
  }

  if (en.state === "panicked") {
    // A wide lookahead here specifically — using the same immediate check
    // the flee decision below uses would calm it back to patrol after a
    // single step (water is already a whole tile behind by then), reading
    // as a one-frame panic flicker instead of an actual flee to safety.
    if (!rt.waterBlocksStep(en, 1, PANIC_CLEAR_TILES) && !rt.waterBlocksStep(en, -1, PANIC_CLEAR_TILES)) {
      // Clear well on both sides — the threat's gone (water receded/
      // drained), calm back down and let patrolRoute take back over.
      en.state = "patrol";
      return undefined;
    }
    // Same PANIC_CLEAR_TILES margin as the recovery check above, not the
    // bare adjacency check canStepAhead uses — two reasons. First, the bare
    // check's fixed lookahead is only a few px past the enemy's edge, so as
    // it moves away one step at a time its own position crosses in and out
    // of "adjacent" every frame at the tile boundary — "blocked" this tick,
    // "clear" the next, "blocked" again — flipping the fled-from direction
    // back and forth and canceling all progress. Second, it must match the
    // recovery check's margin specifically: a narrower one here would let
    // the enemy decide "safe to reverse toward the water" at a distance the
    // recovery check still considers "not yet safe to calm down," stalling
    // it in a dead zone between the two thresholds, fleeing neither way.
    const blockedRight = rt.waterBlocksStep(en, 1, PANIC_CLEAR_TILES);
    const away = blockedRight ? -1 : 1;
    const atBound = away > 0 ? cx >= en.patrolMax : cx <= en.patrolMin;
    if (!atBound && rt.canStepAhead(en, away)) {
      en.facing = away;
      en.vx = away * speed;
    } else {
      // Retreat would leave the patrol zone (or the other side is blocked
      // too) — trapped. Stop and stay panicked rather than wander off post
      // or calm back toward the water.
      en.vx = 0;
    }
  }
  return undefined;
}, "waterPanic(speed?) — patrol enemies that refuse water flee the opposite direction when it blocks their path, staying within patrol bounds; trapped = stop and stay panicked");
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
registerFn("nearHome", (ctx, args) => {
  const { en } = enemyApi(ctx);
  const cx = en.x + en.def.width / 2;
  return Math.abs(en.homeX - cx) <= argNum(args[0], 4); // matches moveToward's own arrival snap
}, "nearHome(threshold?) -> bool — within threshold px of the spawn post (default 4)");
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

// ---- fluid/heat policy hooks (fluidFlow / heatSpread global docs) ----
// Decision functions: each writes the handler's choice into ctx.data, which
// the engine reads back at the decision point (see fireGlobalHook). Queries
// like sideDepth let the handler inspect terrain before deciding.
interface HookApi {
  rt: RoomRuntime;
  /** The tile the decision is about (the fluid tile for pickSide/
   *  sourcedSpread, the stationary side for fluidContact, the candidate
   *  hot cell for meltChain, the drying tile for recede). */
  tx: number;
  ty: number;
}
const hookApi = (ctx: ScriptCtx) => ctx.api as unknown as HookApi;

registerFn("sideDepth", (ctx, args) => {
  const { rt, tx, ty } = hookApi(ctx);
  const dir = argStr(args[0], "left") === "right" ? 1 : -1;
  return rt.sideDepth(tx, ty, dir, Math.max(1, argNum(args[1], 1)));
}, "sideDepth(\"left\" | \"right\", lookahead?) -> tiles — the deepest floor reachable within lookahead tiles to that side (slope-following: sees through platforms and existing fluid; a wall stops the scan)");
registerFn("prefer", (ctx, args) => {
  ctx.data.preferred = argStr(args[0], "alternate");
  return undefined;
}, "prefer(\"left\" | \"right\" | \"alternate\") — pickSide's decision: which neighbor fluid tries first (alternate flips each tick, cancelling drift)");
registerFn("spreadBoth", (ctx) => {
  ctx.data.spread = "both";
  return undefined;
}, "spreadBoth() — sourcedSpread's decision: widen the pool into both open sides (the classic symmetric fill)");
registerFn("spreadLeft", (ctx) => {
  ctx.data.spread = "left";
  return undefined;
}, "spreadLeft() — sourcedSpread's decision: widen only leftward this tick");
registerFn("spreadRight", (ctx) => {
  ctx.data.spread = "right";
  return undefined;
}, "spreadRight() — sourcedSpread's decision: widen only rightward this tick");
registerFn("spreadNone", (ctx) => {
  ctx.data.spread = "none";
  return undefined;
}, "spreadNone() — sourcedSpread's decision: hold the pool at its current width this tick");
registerFn("destroyMover", (ctx) => {
  ctx.data.moverFate = "destroy";
  return undefined;
}, "destroyMover() — fluidContact's decision: the fluid that MOVED into contact is consumed (never placed)");
registerFn("keepMover", (ctx) => {
  ctx.data.moverFate = "keep";
  return undefined;
}, "keepMover() — fluidContact's decision: the mover completes its move and the two fluids coexist side by side");
registerFn("hardenOther", (ctx, args) => {
  ctx.data.otherFate = "harden";
  if (typeof args[0] === "string") ctx.data.hardenTo = args[0];
  return undefined;
}, "hardenOther(tileId?) — fluidContact's decision: the stationary fluid solidifies (default: the lava side's extinguishesTo, cracked stone)");
registerFn("destroyOther", (ctx) => {
  ctx.data.otherFate = "destroy";
  return undefined;
}, "destroyOther() — fluidContact's decision: the stationary fluid is removed outright, nothing left behind");
registerFn("keepOther", (ctx) => {
  ctx.data.otherFate = "keep";
  return undefined;
}, "keepOther() — fluidContact's decision: the stationary fluid is untouched");
registerFn("keepHot", (ctx) => {
  ctx.data.keepHot = true;
  return undefined;
}, "keepHot() — meltChain's decision: the just-melted cell radiates lava heat one more tick, so the melt chains onward; not calling it stops the chain here");
registerFn("setDelay", (ctx, args) => {
  ctx.data.delayMs = argNum(args[0], 0);
  return undefined;
}, "setDelay(ms) — recede's decision: how long this cut-off sourced tile lingers before drying up");

