// Mutable state for a single run. Everything here resets on "New Game".
import type { Content, ItemDef } from "../data/types";

export interface RoomMutations {
  collected: Set<number>;     // entity indexes taken (pickups)
  brokenTiles: number[];      // tile indexes smashed
  openedDoors: Set<number>;   // entity indexes of unlocked/opened gates
  helpedNpcs: Set<number>;
  disabledEnemies: Set<number>; // trapped enemies stay gone
  bundles: { x: number; y: number; items: [string, number][] }[]; // death drops
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
        brokenTiles: [],
        openedDoors: new Set(),
        helpedNpcs: new Set(),
        disabledEnemies: new Set(),
        bundles: [],
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

  /** Does any owned tool grant this capability? */
  hasCapability(cap: string): boolean {
    for (const [id, n] of this.inventory) {
      if (n <= 0) continue;
      const def = this.item(id);
      if (def?.kind === "tool" && def.capabilities?.includes(cap)) return true;
    }
    return false;
  }

  /** Find an owned consumable granting this capability (for lockpicks etc). */
  findConsumableWith(cap: string): ItemDef | undefined {
    for (const [id, n] of this.inventory) {
      if (n <= 0) continue;
      const def = this.item(id);
      if (def?.kind === "consumable" && def.capabilities?.includes(cap)) return def;
    }
    return undefined;
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

  jumpMultiplier(): number {
    let mult = 1;
    for (const [id, n] of this.inventory) {
      if (n <= 0) continue;
      const def = this.item(id);
      if (def?.kind === "tool" && def.capabilities?.includes("jump:boost")) {
        mult = Math.max(mult, def.params?.jumpMultiplier ?? 1);
      }
    }
    return mult;
  }

  breakCaps(): Set<string> {
    const caps = new Set<string>();
    for (const [id, n] of this.inventory) {
      if (n <= 0) continue;
      const def = this.item(id);
      if (def?.kind === "tool") {
        for (const c of def.capabilities ?? []) {
          if (c.startsWith("break:")) caps.add(c);
        }
      }
    }
    return caps;
  }
}
