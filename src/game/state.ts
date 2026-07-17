// Mutable state for a single run. Everything here resets on "New Game".
import type { Content, ItemDef } from "../data/types";

export interface PlacedItem {
  type: "spring" | "trap";
  x: number;
  y: number;
  used?: boolean;
}

export interface RoomMutations {
  collected: Set<number>;     // entity indexes taken (pickups)
  tileOverrides: [number, string | null][]; // tile index -> new tile id ("" -> null)
  openedDoors: Set<number>;   // entity indexes of opened gates / lit checkpoints
  helpedNpcs: Set<number>;
  disabledEnemies: Set<number>; // trapped/killed enemies stay gone
  bundles: { x: number; y: number; items: [string, number][] }[]; // death drops
  placedItems: PlacedItem[];  // player-placed springs and traps
}

export interface RunStats {
  deaths: number;
  crafts: number;
  discoveries: number;
  tauntsHeard: number;
  startedAt: number;
}

export class RunState {
  inventory = new Map<string, number>();
  knownRecipes = new Set<string>();    // journal entries (from notes or crafting)
  craftedRecipes = new Set<string>();  // actually produced at least once
  health: number;
  maxHealth: number;
  checkpoint: { roomId: string; x: number; y: number };
  roomStates = new Map<string, RoomMutations>();
  selectedConsumable = 0;
  hasDiedOnce = false;
  stats: RunStats = {
    deaths: 0, crafts: 0, discoveries: 0, tauntsHeard: 0,
    startedAt: performance.now(),
  };

  constructor(private content: Content, startRoomId: string) {
    this.health = content.game.player.maxHealth;
    this.maxHealth = content.game.player.maxHealth;
    this.checkpoint = { roomId: startRoomId, x: 0, y: 0 };
  }

  mutations(roomId: string): RoomMutations {
    let m = this.roomStates.get(roomId);
    if (!m) {
      m = {
        collected: new Set(),
        tileOverrides: [],
        openedDoors: new Set(),
        helpedNpcs: new Set(),
        disabledEnemies: new Set(),
        bundles: [],
        placedItems: [],
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

}
