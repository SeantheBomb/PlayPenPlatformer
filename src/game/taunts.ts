// The Warden's taunt system. Fully data-driven from content/taunts.json.
// Runs on the sim clock + a seedable RNG so a recorded session replays the
// exact same taunts at the exact same moments (see engine/simclock.ts).
import type { TauntDef, TauntTrigger, WardenEmotion } from "../data/types";
import { Rng, randomSeed } from "../engine/rng";
import { simNow } from "../engine/simclock";
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
  private rng = new Rng(randomSeed());
  active: ActiveTaunt | null = null;
  onTauntShown?: () => void;

  constructor(private taunts: TauntDef[]) {}

  setTaunts(taunts: TauntDef[]): void {
    this.taunts = taunts;
  }

  /** Reseed for a new run — the seed is recorded so replays roll identically. */
  reseed(seed: number): void {
    this.rng.reseed(seed);
  }

  fire(trigger: TauntTrigger, ctx: { roomId?: string; itemId?: string } = {}): void {
    const now = simNow();
    for (const t of this.taunts) {
      if (t.trigger !== trigger) continue;
      if (t.roomId && t.roomId !== ctx.roomId) continue;
      if (t.itemId && t.itemId !== ctx.itemId) continue;
      const last = this.lastFired.get(t.id) ?? -Infinity;
      if (now - last < t.cooldownMs) continue;
      if (this.rng.next() > (t.chance ?? 1)) continue;
      this.lastFired.set(t.id, now);
      this.queue.push({ line: this.rng.pick(t.lines), emotion: t.emotion ?? "smug" });
    }
  }

  /** Queue a specific line directly (achievement reactions, scripted beats). */
  queueLine(line: string, emotion: WardenEmotion = "smug"): void {
    this.queue.push({ line, emotion });
  }

  update(): void {
    const now = simNow();
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
    const elapsed = simNow() - this.active.shownAt;
    const chars = Math.floor(elapsed / 18);
    return this.active.line.slice(0, chars);
  }

  reset(): void {
    this.lastFired.clear();
    this.queue.length = 0;
    this.active = null;
  }
}
