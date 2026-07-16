// The Warden's taunt system. Fully data-driven from content/taunts.json.
import type { TauntDef, TauntTrigger, WardenEmotion } from "../data/types";
import { randPick } from "../engine/math";
import { sfx } from "../engine/audio";

export interface ActiveTaunt {
  line: string;
  emotion: WardenEmotion;
  shownAt: number;
  duration: number;
}

export class TauntManager {
  private lastFired = new Map<string, number>();
  private queue: { line: string; emotion: WardenEmotion }[] = [];
  active: ActiveTaunt | null = null;
  onTauntShown?: () => void;

  constructor(private taunts: TauntDef[]) {}

  setTaunts(taunts: TauntDef[]): void {
    this.taunts = taunts;
  }

  fire(trigger: TauntTrigger, ctx: { roomId?: string; itemId?: string } = {}): void {
    const now = performance.now();
    for (const t of this.taunts) {
      if (t.trigger !== trigger) continue;
      if (t.roomId && t.roomId !== ctx.roomId) continue;
      if (t.itemId && t.itemId !== ctx.itemId) continue;
      const last = this.lastFired.get(t.id) ?? -Infinity;
      if (now - last < t.cooldownMs) continue;
      if (Math.random() > (t.chance ?? 1)) continue;
      this.lastFired.set(t.id, now);
      this.queue.push({ line: randPick(t.lines), emotion: t.emotion ?? "smug" });
    }
  }

  update(): void {
    const now = performance.now();
    if (this.active && now - this.active.shownAt > this.active.duration) {
      this.active = null;
    }
    if (!this.active && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.active = {
        line: next.line,
        emotion: next.emotion,
        shownAt: now,
        duration: 2600 + next.line.length * 34, // linger long enough to read
      };
      sfx.play("taunt");
      this.onTauntShown?.();
    }
  }

  /** Portion of the line visible right now (typewriter effect). */
  visibleText(): string {
    if (!this.active) return "";
    const elapsed = performance.now() - this.active.shownAt;
    const chars = Math.floor(elapsed / 18);
    return this.active.line.slice(0, chars);
  }

  reset(): void {
    this.lastFired.clear();
    this.queue.length = 0;
    this.active = null;
  }
}
