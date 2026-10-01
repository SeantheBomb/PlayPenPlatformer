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
      if (t.removed) continue; // deleted from the Writers Studio (a tombstone, see TauntDef)
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

  /** Sim time the banner was put on hold, or null when it isn't. */
  private heldAt: number | null = null;

  /** True while a dialog/note box is open — the banner neither draws nor
   *  advances. */
  get held(): boolean {
    return this.heldAt !== null;
  }

  /**
   * `hold` = a dialog or note box is open. The Warden waits his turn rather
   * than talking over a resident (Sean, 2026-10-01: "they should queue"):
   * nothing new is dequeued, and a line already on screen is paused — its
   * clock shifted forward by the time held, so it resumes mid-line with its
   * full reading time intact. Pure simNow arithmetic, so replays agree.
   */
  update(hold = false): void {
    const now = simNow();
    if (hold) {
      if (this.heldAt === null) this.heldAt = now;
      return;
    }
    if (this.heldAt !== null) {
      if (this.active) this.active.shownAt += now - this.heldAt;
      this.heldAt = null;
    }
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
    this.heldAt = null;
  }
}
