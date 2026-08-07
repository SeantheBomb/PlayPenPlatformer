// Mutable state for a single run. Everything here resets on "New Game".
import type { Content, ItemDef } from "../data/types";
import type { Rect } from "../engine/math";
import { simNow } from "../engine/simclock";

export interface PlacedItem {
  type: "spring" | "trap";
  x: number;
  y: number;
  used?: boolean;
}

/** A single item flying/resting out of a death or a melted-tile drop — real
 *  icon, not a generic bag. The SAME object is shared between RoomRuntime's
 *  live `drops` array and this mutation record, so physics just mutates it
 *  in place and there's nothing to resync on room reload. */
export interface ScatterDrop extends Rect {
  itemId: string;
  count: number;
  vx: number;
  vy: number;
  settled: boolean;
}

export interface RoomMutations {
  collected: Set<number>;     // entity indexes taken (pickups)
  tileOverrides: [number, string | null][]; // tile index -> new tile id ("" -> null)
  openedDoors: Set<number>;   // entity indexes of opened gates / lit checkpoints
  gateTouched: Set<number>;   // door/trapdoor indexes a fuse has flipped this run
                              // (open or closed) — lets startOpen fall through
                              // to openedDoors only once something's overridden it
  helpedNpcs: Set<number>;
  disabledEnemies: Set<number>; // trapped/killed enemies stay gone
  drops: ScatterDrop[]; // death drops + melted-tile drops (scattered, real icons)
  placedItems: PlacedItem[];  // player-placed springs and traps
  brazierLit: [number, boolean][]; // entity index -> lit override (douse/relight)
  sourceAmounts: [number, number][]; // entity index -> remaining stock override
}

export interface RunStats {
  deaths: number;
  crafts: number;
  discoveries: number;
  tauntsHeard: number;
  startedAt: number;
}

/** Plain-JSON mirror of RoomMutations — Sets/Maps aren't directly
 *  serializable, so heartbeats carry this shape instead. */
export interface RoomMutationsSnapshot {
  collected: number[];
  tileOverrides: [number, string | null][];
  openedDoors: number[];
  gateTouched: number[];
  helpedNpcs: number[];
  disabledEnemies: number[];
  drops: ScatterDrop[];
  placedItems: PlacedItem[];
  brazierLit: [number, boolean][];
  sourceAmounts: [number, number][];
}

/** Everything in RunState, as plain JSON — a periodic "heartbeat" ground
 *  truth the replay driver can restore from directly instead of trusting
 *  accumulated simulation. Deliberately raw/complete rather than a clever
 *  derived diff: a smaller encoding that has to be re-expanded by game
 *  logic is exactly the kind of "determine it" approach that breaks once
 *  that logic changes across a content/code version — see game.ts's
 *  captureHeartbeat/applyHeartbeat. */
export interface StateSnapshot {
  inventory: [string, number][];
  knownRecipes: string[];
  craftedRecipes: string[];
  health: number;
  maxHealth: number;
  checkpoint: RunState["checkpoint"];
  roomStates: [string, RoomMutationsSnapshot][];
  selectedConsumable: number;
  hasDiedOnce: boolean;
  hasOpenedCraftUI: boolean;
  counters: [string, number][];
  earned: string[];
  readNotes: string[];
  helpedNpcIds: string[];
  stats: RunStats;
}

export class RunState {
  inventory = new Map<string, number>();
  knownRecipes = new Set<string>();    // journal entries (from notes or crafting)
  craftedRecipes = new Set<string>();  // actually produced at least once
  health: number;
  maxHealth: number;
  checkpoint: {
    roomId: string; x: number; y: number;
    /** Authored on the checkpoint entity — what respawning here hands the
     *  player back instead of whatever they had (or nothing). */
    loadout?: { item: string; count: number }[];
  };
  roomStates = new Map<string, RoomMutations>();
  selectedConsumable = 0;
  hasDiedOnce = false;
  /** Has the player ever opened the craft/inventory screen (Tab) this run?
   *  Drives a persistent on-screen nudge until they do — two testers didn't
   *  know the key existed at all. */
  hasOpenedCraftUI = false;
  counters = new Map<string, number>();      // achievement counters
  earned = new Set<string>();                // achievement ids earned this run
  readNotes = new Set<string>();             // "roomId:entityIndex" of notes read
  /** npcIds helped anywhere this run — later rooms spawn/skip entities on
   *  these (pair scenes, the Exit Wing send-off). */
  helpedNpcIds = new Set<string>();

  bump(counter: string, by = 1): number {
    const v = (this.counters.get(counter) ?? 0) + by;
    this.counters.set(counter, v);
    return v;
  }
  stats: RunStats = {
    deaths: 0, crafts: 0, discoveries: 0, tauntsHeard: 0,
    startedAt: simNow(),
  };

  constructor(private content: Content, startRoomId: string) {
    this.health = content.game.player.maxHealth;
    this.maxHealth = content.game.player.maxHealth;
    this.checkpoint = { roomId: startRoomId, x: 0, y: 0 };
  }

  snapshot(): StateSnapshot {
    return {
      inventory: [...this.inventory],
      knownRecipes: [...this.knownRecipes],
      craftedRecipes: [...this.craftedRecipes],
      health: this.health,
      maxHealth: this.maxHealth,
      checkpoint: { ...this.checkpoint },
      roomStates: [...this.roomStates].map(([roomId, m]) => [roomId, {
        collected: [...m.collected],
        tileOverrides: [...m.tileOverrides],
        openedDoors: [...m.openedDoors],
        gateTouched: [...m.gateTouched],
        helpedNpcs: [...m.helpedNpcs],
        disabledEnemies: [...m.disabledEnemies],
        drops: m.drops.map((d) => ({ ...d })),
        placedItems: m.placedItems.map((p) => ({ ...p })),
        brazierLit: [...m.brazierLit],
        sourceAmounts: [...m.sourceAmounts],
      }]),
      selectedConsumable: this.selectedConsumable,
      hasDiedOnce: this.hasDiedOnce,
      hasOpenedCraftUI: this.hasOpenedCraftUI,
      counters: [...this.counters],
      earned: [...this.earned],
      readNotes: [...this.readNotes],
      helpedNpcIds: [...this.helpedNpcIds],
      stats: { ...this.stats },
    };
  }

  /** Overwrite every field from a captured snapshot — a replay driver
   *  ground-truth resync, not a partial merge. */
  restore(snap: StateSnapshot): void {
    this.inventory = new Map(snap.inventory);
    this.knownRecipes = new Set(snap.knownRecipes);
    this.craftedRecipes = new Set(snap.craftedRecipes);
    this.health = snap.health;
    this.maxHealth = snap.maxHealth;
    this.checkpoint = { ...snap.checkpoint };
    this.roomStates = new Map(snap.roomStates.map(([roomId, m]) => [roomId, {
      collected: new Set(m.collected),
      tileOverrides: [...m.tileOverrides],
      openedDoors: new Set(m.openedDoors),
      gateTouched: new Set(m.gateTouched),
      helpedNpcs: new Set(m.helpedNpcs),
      disabledEnemies: new Set(m.disabledEnemies),
      drops: m.drops.map((d) => ({ ...d })),
      placedItems: m.placedItems.map((p) => ({ ...p })),
      brazierLit: [...m.brazierLit],
      sourceAmounts: [...m.sourceAmounts],
    }]));
    this.selectedConsumable = snap.selectedConsumable;
    this.hasDiedOnce = snap.hasDiedOnce;
    this.hasOpenedCraftUI = snap.hasOpenedCraftUI;
    this.counters = new Map(snap.counters);
    this.earned = new Set(snap.earned);
    this.readNotes = new Set(snap.readNotes);
    this.helpedNpcIds = new Set(snap.helpedNpcIds);
    this.stats = { ...snap.stats };
  }

  mutations(roomId: string): RoomMutations {
    let m = this.roomStates.get(roomId);
    if (!m) {
      m = {
        collected: new Set(),
        tileOverrides: [],
        openedDoors: new Set(),
        gateTouched: new Set(),
        helpedNpcs: new Set(),
        disabledEnemies: new Set(),
        drops: [],
        placedItems: [],
        brazierLit: [],
        sourceAmounts: [],
      };
      this.roomStates.set(roomId, m);
    }
    return m;
  }

  item(id: string): ItemDef | undefined {
    return this.content.items.find((i) => i.id === id);
  }

  count(id: string): number {
    return this.inventory.get(id) ?? 0;
  }

  add(id: string, n = 1): void {
    this.inventory.set(id, this.count(id) + n);
  }

  remove(id: string, n = 1): boolean {
    const have = this.count(id);
    if (have < n) return false;
    if (have === n) this.inventory.delete(id);
    else this.inventory.set(id, have - n);
    return true;
  }

  has(id: string, n = 1): boolean {
    return this.count(id) >= n;
  }

  ownedConsumables(): ItemDef[] {
    const out: ItemDef[] = [];
    for (const [id, n] of this.inventory) {
      if (n <= 0) continue;
      const def = this.item(id);
      if (def?.kind === "consumable") out.push(def);
    }
    return out;
  }

  /** Hotbar items: anything with an active use. */
  usableItems(): ItemDef[] {
    const out: ItemDef[] = [];
    for (const [id, n] of this.inventory) {
      if (n <= 0) continue;
      const def = this.item(id);
      if (def?.useMode) out.push(def);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  /** Swap one inventory item for another (torch->lit, bucket->full...). */
  transform(fromId: string, toId: string): boolean {
    if (!this.remove(fromId)) return false;
    this.add(toId);
    return true;
  }

  ownedTools(): ItemDef[] {
    const out: ItemDef[] = [];
    for (const [id, n] of this.inventory) {
      if (n <= 0) continue;
      const def = this.item(id);
      if (def?.kind === "tool") out.push(def);
    }
    return out;
  }

  /** All materials, removed from inventory — used for death drops. */
  takeAllMaterials(): [string, number][] {
    const out: [string, number][] = [];
    for (const [id, n] of [...this.inventory]) {
      const def = this.item(id);
      if (def?.kind === "material") {
        out.push([id, n]);
        this.inventory.delete(id);
      }
    }
    return out;
  }

  /** Replace the current inventory with a fixed kit — what a checkpoint (or
   *  the editor's "start test from here") hands the player back instead of
   *  a merge with whatever they had. Returns whether it actually applied.
   *  An empty array is treated the same as no loadout at all (no-op, false)
   *  — NOT "hand back nothing": the editor's checkpoint-inspector loadout
   *  list UI lazily sets `loadout: []` just from the panel being opened, so
   *  an empty array reaching here is almost always that stray default, not
   *  an authored "give nothing". Mistaking the two wiped a player's whole
   *  inventory on every death at that checkpoint (player report,
   *  exit_wing: "I had a spark rod and then I died... and the spark rod
   *  was gone as well as the ingredients I used to craft it"). */
  applyLoadout(loadout?: { item: string; count: number }[]): boolean {
    if (!loadout || loadout.length === 0) return false;
    this.inventory.clear();
    this.selectedConsumable = 0;
    for (const { item, count } of loadout) this.add(item, count);
    return true;
  }

  /** Death reset for equipped items: a lit torch goes back out, a full/lava
   *  bucket goes back to empty — any item whose carrier state (`dousesTo` /
   *  `emptiesTo`) can revert does, generically, no per-item special-casing.
   *  Returns the ids that changed, for a floaty/sfx cue. */
  resetTransformedItems(): string[] {
    const changed: string[] = [];
    for (const [id, n] of [...this.inventory]) {
      const def = this.item(id);
      const resetTo = def?.dousesTo ?? def?.emptiesTo;
      if (!resetTo || n <= 0) continue;
      this.inventory.set(resetTo, this.count(resetTo) + n);
      this.inventory.delete(id);
      changed.push(id);
    }
    return changed;
  }

}
