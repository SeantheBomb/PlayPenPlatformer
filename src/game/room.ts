// Runtime instantiation of a RoomDef, including the elemental simulation:
// tile transformations, fire spread, spark conduction, and enemy reactions.
import type {
  Content, EnemyDef, EnemyReaction, RoomDef, RoomEntity, RuleDef, TileDef,
} from "../data/types";
import { TILE, TileMap } from "../engine/tilemap";
import { drawBlob, drawItemIcon, drawTile, roundRect, shade } from "../engine/renderer";
import { dist, randRange, rectsOverlap, type Rect } from "../engine/math";
import { simNow } from "../engine/simclock";
import type { PlacedItem, RoomMutations } from "./state";

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

export interface DropBundle extends Rect {
  items: [string, number][];
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

const SPREAD_INTERVAL = 0.7; // seconds between fire spread ticks
const ENERGIZE_MS = 1500;
const HAZARD_COOLDOWN_MS = 500;
const WATER_FLOW_INTERVAL = 0.5; // seconds between fluid flow ticks
// Fall-fed fluid spreads with no distance cap — only walls or a drain stop
// it. Finite (melted/poured) fluid is conserved and never replicates at all.
const SOURCED = -1;

export class RoomRuntime {
  map: TileMap;
  entities: EntityInstance[] = [];
  enemies: EnemyInstance[] = [];
  placed: PlacedInstance[] = [];
  bundles: DropBundle[] = [];
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
  /** tile indexes of fall tiles (waterfall/lavafall) that grow + emit fluid */
  private fallTiles = new Set<number>();
  /** tile index -> fluid def flowing THROUGH a grate flush against solid
   *  ground (no gap to fall into) — an overlay, not a tile swap, so the
   *  grate stays the real tile and stays walkable. See placeFluid. */
  private grateFluid = new Map<number, TileDef>();
  private waterFlowEnabled: boolean;
  private spreadClock = 0;
  private waterFlowClock = 0;
  private tilesById = new Map<string, TileDef>();

  constructor(
    public room: RoomDef,
    private content: Content,
    private muts: RoomMutations
  ) {
    this.map = new TileMap(room, content.tiles);
    for (const t of content.tiles) this.tilesById.set(t.id, t);
    for (const [idx, tileId] of muts.tileOverrides) {
      this.map.overrides.set(idx, tileId ? this.tilesById.get(tileId) ?? null : null);
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
      const [w, h] = ENTITY_SIZES[def.type] ?? [16, 16];
      const litOverride = muts.brazierLit.find(([i]) => i === index);
      this.entities.push({
        index, def, kind: def.type,
        x: cx - w / 2, y: feetY - h, w, h,
        collected: muts.collected.has(index),
        open: muts.openedDoors.has(index),
        helped: muts.helpedNpcs.has(index),
        lit: litOverride ? litOverride[1] : def.lit ?? true,
      });
    });

    for (const b of muts.bundles) {
      this.bundles.push({ x: b.x, y: b.y, w: 14, h: 12, items: b.items });
    }
    for (const p of muts.placedItems) {
      this.placed.push(this.makePlacedInstance(p));
    }
  }

  private makePlacedInstance(p: PlacedItem): PlacedInstance {
    const size: [number, number] = p.type === "spring" ? [16, 8] : [16, 8];
    return { data: p, x: p.x, y: p.y, w: size[0], h: size[1] };
  }

  // ================= ELEMENTAL CORE =================

  private findRule(actor: string, tile: TileDef): RuleDef | undefined {
    return this.content.rules.find((r) => {
      if (r.actor !== actor) return false;
      if (r.target) return r.target === tile.element;
      if (r.targetProperty) {
        return !!(tile as unknown as Record<string, unknown>)[r.targetProperty];
      }
      return false;
    });
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
   * Transform a tile via a rule effect (melt/shatter/dissolve/burn/quench).
   * Unlike raw setTileById this also pays out the tile's `dropsItem` as a
   * recoverable bundle — how a metal block melted by lava becomes scrap.
   */
  private transformTile(tx: number, ty: number, next: string | undefined): void {
    const def = this.map.at(tx, ty);
    if (def?.dropsItem) {
      this.bundles.push({ x: tx * TILE + 1, y: ty * TILE + 4, w: 14, h: 12, items: [[def.dropsItem, 1]] });
      this.muts.bundles.push({ x: tx * TILE + 1, y: ty * TILE + 4, items: [[def.dropsItem, 1]] });
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
  private tickWaterFlow(events: ElementEvent[]): void {
    if (!this.waterFlowEnabled) return;
    this.tickFalls(events);

    // Pre-pass: drains eat every adjacent fluid tile BEFORE anything moves,
    // so water queued above a drain vanishes instead of overflowing around
    // the queue. This ordering is what lets base-side drains fully contain
    // a melting tower's runoff.
    for (const [idx] of [...this.waterFlowDist]) {
      const tx = idx % this.map.width;
      const ty = Math.floor(idx / this.map.width);
      const def = this.fluidDefAt(tx, ty);
      if (!def) {
        this.waterFlowDist.delete(idx);
        continue;
      }
      if (this.tileTouchesDrain(tx, ty)) {
        this.clearFluid(tx, ty);
        this.waterFlowDist.delete(idx);
        events.push({ effect: "flow", x: tx * TILE + 8, y: ty * TILE + 8, color: "#5a5470" });
      }
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
    const sorted = [...this.waterFlowDist].sort((a, b) => b[0] - a[0]);
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
        if (this.resolveFluidContact(nx, ny, def, tx, ty, events)) {
          // Contact: the mover is destroyed instead of relocating.
          this.clearFluid(tx, ty);
          this.waterFlowDist.delete(idx);
          return;
        }
        this.placeFluid(nx, ny, def);
        this.waterFlowDist.set(this.map.index(nx, ny), d);
        this.clearFluid(tx, ty);
        this.waterFlowDist.delete(idx);
        events.push({ effect: "flow", x: nx * TILE + 8, y: ny * TILE + 8, color: def.color });
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
          for (const nx of [tx - 1, tx + 1]) {
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
        for (const nx of [tx - 1, tx + 1]) {
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
        for (const nx of [tx - 1, tx + 1]) {
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
      for (const nx of [tx - 1, tx + 1]) {
        if (nx < 0 || nx >= this.map.width) continue;
        const target = this.fluidOccupied(nx, ty);
        if (target.solid) continue;
        const holeBelow = this.fluidOccupied(nx, target.ty + 1);
        if (holeBelow.ty >= this.map.height || holeBelow.solid) continue;
        moveTo(nx, target.ty, distance);
        break;
      }
    }
    this.douseBraziersTouchingWater(events);
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
      for (const nx of [tx - 1, tx + 1]) {
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

  /** Water reaching a brazier puts it out (steam, no drama). */
  private douseBraziersTouchingWater(events: ElementEvent[]): void {
    for (const e of this.entities) {
      if (e.kind !== "brazier" || e.lit === false) continue;
      const tx0 = Math.floor(e.x / TILE);
      const tx1 = Math.floor((e.x + e.w - 1) / TILE);
      const ty0 = Math.floor(e.y / TILE);
      const ty1 = Math.floor((e.y + e.h - 1) / TILE);
      let wet = false;
      for (let ty = ty0; ty <= ty1 && !wet; ty++) {
        for (let tx = tx0; tx <= tx1 && !wet; tx++) {
          if (this.map.at(tx, ty)?.element === "water") wet = true;
        }
      }
      if (wet) {
        this.setBrazierLit(e, false);
        events.push({ effect: "extinguish", x: e.x + e.w / 2, y: e.y, color: "#8f9bb3" });
      }
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
    if (element !== "water" && element !== "fire") return events;
    for (const e of this.entities) {
      if (e.kind !== "brazier" || !rectsOverlap(e, box)) continue;
      if (element === "water" && e.lit !== false) {
        this.setBrazierLit(e, false);
        events.push({ effect: "extinguish", x: e.x + e.w / 2, y: e.y, color: "#8f9bb3" });
      } else if (element === "fire" && e.lit === false) {
        this.setBrazierLit(e, true);
        events.push({ effect: "ignite", x: e.x + e.w / 2, y: e.y, color: "#ffc861" });
      }
    }
    return events;
  }

  /** Cold propagates across a connected body of water: one vial, one bridge. */
  private freezeFrom(tx: number, ty: number, events: ElementEvent[]): void {
    const startElem = this.map.at(tx, ty)?.element;
    const stack = [[tx, ty]];
    const seen = new Set<number>();
    let count = 0;
    while (stack.length > 0 && count < 32) {
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
    const until = simNow() + ENERGIZE_MS;
    const stack = [[tx, ty]];
    const seen = new Set<number>();
    let count = 0;
    while (stack.length > 0 && count < 600) {
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

  /** A fusebox trips if any energized tile touches it (or its neighbors). */
  private checkFuseboxes(events: ElementEvent[]): void {
    const now = simNow();
    for (const fb of this.entities) {
      if (fb.kind !== "fusebox" || fb.open) continue;
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
      if ((e.kind === "door" || e.kind === "trapdoor") && e.def.fuseId && e.def.fuseId === fb.def.fuseId && !e.open) {
        e.open = true;
        this.muts.openedDoors.add(e.index);
        events.push({ effect: "fuse", x: e.x + e.w / 2, y: e.y + e.h / 2, color: "#9be8b0" });
      }
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

  reactEnemy(en: EnemyInstance, element: string, stunMs: number): EnemyReaction {
    const reaction: EnemyReaction = en.def.reactions?.[element] ?? "none";
    switch (reaction) {
      case "kill":
        en.state = "trapped"; // reuse: removed from play
        this.muts.disabledEnemies.add(en.index);
        this.enemies = this.enemies.filter((e) => e !== en);
        break;
      case "stun":
        en.state = "stunned";
        en.stunUntil = simNow() + stunMs;
        break;
      case "knockback":
        en.vx = en.facing * -120;
        break;
      case "none":
        break;
    }
    return reaction;
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

  /** Does this box touch water (for filling buckets)? */
  boxTouchesWater(box: Rect): { tx: number; ty: number } | null {
    const tx0 = Math.floor(box.x / TILE);
    const tx1 = Math.floor((box.x + box.w) / TILE);
    const ty0 = Math.floor(box.y / TILE);
    const ty1 = Math.floor((box.y + box.h) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.map.at(tx, ty)?.element === "water") return { tx, ty };
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

  placedSpringNear(px: number, py: number, range = 20): PlacedInstance | null {
    for (const p of this.placed) {
      if (p.data.type !== "spring") continue;
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

  dropBundle(x: number, y: number, items: [string, number][]): void {
    if (items.length === 0) return;
    const b: DropBundle = { x: x - 7, y: y - 12, w: 14, h: 12, items };
    this.bundles.push(b);
    this.muts.bundles.push({ x: b.x, y: b.y, items });
  }

  removeBundle(b: DropBundle): void {
    this.bundles = this.bundles.filter((x) => x !== b);
    this.muts.bundles = this.muts.bundles.filter(
      (m) => !(m.x === b.x && m.y === b.y)
    );
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

  /** Can this enemy safely take a step in `want` direction? */
  private canStepAhead(en: EnemyInstance, want: number): boolean {
    if (want === 0) return true;
    const d = en.def;
    const aheadX = want > 0 ? en.x + d.width + 3 : en.x - 3;
    const footY = en.y + d.height;
    // Metal creatures refuse water — pools are a safe zone.
    if (d.element === "metal") {
      const tile = this.map.at(Math.floor(aheadX / TILE), Math.floor((footY - 4) / TILE));
      if (tile?.element === "water") return false;
    }
    // No drops it can't climb back out of (max 1 tile down).
    for (let step = 0; step < 2; step++) {
      const def = this.map.at(
        Math.floor(aheadX / TILE),
        Math.floor((footY + 4 + step * TILE) / TILE)
      );
      if (def?.solid) return true;
    }
    return false;
  }

  /** Send every enemy back to its post (called on player respawn). */
  resetEnemies(): void {
    for (const en of this.enemies) {
      if (en.state === "trapped") continue;
      en.x = en.homeX - en.def.width / 2;
      en.vx = 0;
      en.vy = 0;
      en.state = en.def.behavior === "patrol" ? "patrol" : "return";
      en.lastSawPlayerAt = 0;
    }
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
    if (this.spreadClock >= SPREAD_INTERVAL) {
      this.spreadClock = 0;
      // element -> heat sources of that element. Fire tiles/burning tiles/lit
      // braziers radiate "fire"; lava tiles radiate "lava" (their own,
      // hotter ruleset — it can melt metal where a torch can't).
      const igniters: [number, number, string][] = [];
      for (let ty = 0; ty < this.map.height; ty++) {
        for (let tx = 0; tx < this.map.width; tx++) {
          const def = this.map.at(tx, ty);
          if ((def?.spreads && def.element === "fire") || this.isBurning(tx, ty)) {
            igniters.push([tx, ty, "fire"]);
          } else if (def?.spreads && def.element === "lava") {
            igniters.push([tx, ty, "lava"]);
          }
        }
      }
      for (const e of this.entities) {
        if (e.kind === "brazier" && e.lit !== false) {
          igniters.push([Math.floor((e.x + e.w / 2) / TILE), Math.floor((e.y + e.h / 2) / TILE), "fire"]);
        }
      }
      // Neighbors get the source's full ruleset — flammables ignite, ice
      // melts. (A lit goo line can melt a distant ice wall.)
      for (const [tx, ty, elem] of igniters) {
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
          }
        }
      }
    }

    this.waterFlowClock += dt;
    if (this.waterFlowClock >= WATER_FLOW_INTERVAL) {
      this.waterFlowClock = 0;
      this.tickWaterFlow(events);
    }

    // ---- Enemies ----
    for (const en of [...this.enemies]) {
      const d = en.def;
      if (en.state === "trapped") continue;

      // Environmental hazards act on enemies too
      if (now - en.lastHazardAt > HAZARD_COOLDOWN_MS) {
        const tx0 = Math.floor(en.x / TILE);
        const tx1 = Math.floor((en.x + d.width) / TILE);
        const ty0 = Math.floor(en.y / TILE);
        const ty1 = Math.floor((en.y + d.height + 2) / TILE);
        let applied: string | null = null;
        for (let ty = ty0; ty <= ty1 && !applied; ty++) {
          for (let tx = tx0; tx <= tx1 && !applied; tx++) {
            const tdef = this.map.at(tx, ty);
            if (this.isBurning(tx, ty) || tdef?.element === "fire") applied = "fire";
            else if (tdef?.element === "lava") applied = "lava";
            else if (this.isEnergized(tx, ty)) applied = "spark";
          }
        }
        if (applied) {
          en.lastHazardAt = now;
          const r = this.reactEnemy(en, applied, stunMs);
          if (r !== "none") {
            events.push({
              effect: "enemy_" + r,
              x: en.x + d.width / 2, y: en.y + d.height / 2, color: d.color,
              enemyId: d.id, element: applied,
            });
          }
          if (r === "kill") continue;
        }
      }

      if (en.state === "stunned") {
        if (now >= en.stunUntil) {
          en.state = d.behavior === "patrol" ? "patrol" : "return";
        }
        continue;
      }

      const cx = en.x + d.width / 2;
      const cy = en.y + d.height / 2;

      // Smoke veil: a player standing in smoke can't be seen by anyone, and
      // a spotter standing in smoke can't see anything outside it — so sight
      // only ever connects when BOTH ends are in clear air.
      const playerSmoked = !!player && this.smokeAtPoint(player.centerX, player.centerY);
      const enemySmoked = this.smokeAtPoint(cx, cy);

      // Chasers only see FORWARD, in a cone (drawn for the player to read).
      if (d.behavior === "chase" && player && !player.hidden && !playerSmoked && !enemySmoked) {
        const dx = player.centerX - cx;
        const dy = player.centerY - cy;
        const facingOk = dx * en.facing > 0;
        const inCone = Math.abs(dy) <= Math.abs(dx) * SIGHT_HALF_SLOPE + 12;
        const inRange = Math.abs(dx) <= (d.sightRange ?? 120);
        if (
          facingOk && inCone && inRange &&
          this.map.lineOfSight(cx, cy, player.centerX, player.centerY)
        ) {
          en.state = "chase";
          en.lastSawPlayerAt = now;
        }
      }
      if (en.state === "chase") {
        const lost =
          !player || player.hidden || playerSmoked || enemySmoked ||
          now - en.lastSawPlayerAt > (d.loseTargetMs ?? 2000);
        if (lost) en.state = d.returnsHome ? "return" : "patrol";
      }

      let want = 0;
      let speed = d.speed;
      if (en.state === "patrol") {
        want = en.facing;
        if (cx <= en.patrolMin) want = 1;
        else if (cx >= en.patrolMax) want = -1;
        if (!this.canStepAhead(en, want)) want = -en.facing;
      } else if (en.state === "chase" && player) {
        speed = d.chaseSpeed ?? d.speed * 2;
        const dx = player.centerX - cx;
        want = Math.abs(dx) > 4 ? Math.sign(dx) : 0;
        // Too smart to strand itself: no drops it can't climb, no wading.
        if (want !== 0 && !this.canStepAhead(en, want)) want = 0;
      } else if (en.state === "return") {
        const dx = en.homeX - cx;
        want = Math.abs(dx) > 4 ? Math.sign(dx) : 0;
        if (want !== 0 && !this.canStepAhead(en, want)) want = 0;
      }
      if (want !== 0) en.facing = want;
      en.vx = want * speed;
      en.vy = Math.min(en.vy + 1400 * dt, 460);

      const res = this.map.move(en.x, en.y, d.width, d.height, en.vx, en.vy, dt);
      if (res.hitWall && en.state === "patrol") en.facing = -en.facing;
      en.x = res.x;
      en.y = res.y;
      en.vy = res.vy;

      // Player-placed traps
      const rect = { x: en.x, y: en.y, w: d.width, h: d.height };
      for (const p of this.placed) {
        if (p.data.type === "trap" && !p.data.used && d.trappable && rectsOverlap(rect, p)) {
          p.data.used = true;
          en.state = "trapped";
          this.muts.disabledEnemies.add(en.index);
        }
      }
    }

    if (events.length > 0) onEvents(events);
  }

  // ================= DRAWING =================

  draw(ctx: CanvasRenderingContext2D, animT: number): void {
    for (const e of this.entities) this.drawEntity(ctx, e, animT);
    for (const p of this.placed) this.drawPlaced(ctx, p, animT);
    for (const b of this.bundles) this.drawBundle(ctx, b, animT);
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
        const powered = !!e.def.fuseId;
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
        const powered = !!e.def.fuseId;
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
        drawBlob(
          ctx, e.x, e.y + bob * 0.3, e.w, e.h,
          e.def.color ?? "#7fd8e8", "#1a2530", -1,
          { eyeStyle: e.helped ? "sleepy" : "wide", sprite: e.def }
        );
        if (!e.helped) {
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
        const txt = e.def.text ?? "";
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
    // Visible sight cone for forward-looking chasers
    if (d.behavior === "chase") {
      const range = d.sightRange ?? 120;
      const eyeX = en.facing > 0 ? en.x + d.width - 2 : en.x + 2;
      const eyeY = en.y + d.height * 0.35;
      const endX = eyeX + en.facing * range;
      const spread = range * SIGHT_HALF_SLOPE + 12;
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

  private drawBundle(ctx: CanvasRenderingContext2D, b: DropBundle, animT: number): void {
    const glow = 0.5 + Math.sin(animT * 5) * 0.3;
    ctx.fillStyle = `rgba(255,209,102,${glow * 0.3})`;
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c9a86a";
    roundRect(ctx, b.x, b.y + 2, b.w, b.h - 2, 4);
    ctx.fill();
    ctx.fillStyle = "#8a744a";
    ctx.fillRect(b.x + b.w / 2 - 1, b.y, 2, 4);
  }
}
