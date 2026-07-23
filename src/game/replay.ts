// Replay driver: reconstructs a recorded session by re-running the actual
// simulation. Builds a second, isolated Game instance (replay mode: detached
// input, no recording, no analytics) from the session's captured content and
// seed, then feeds the recorded input events back in at the exact step
// indices they originally occurred. Because the sim runs on a fixed timestep,
// a sim clock, and seeded gameplay RNG, the run reproduces exactly — and the
// recorded final player position doubles as a drift check.
import { assembleContent } from "../data/content";
import { Game } from "./game";
import { sfx } from "../engine/audio";
import type { SessionEvent, SessionMeta } from "./recorder";

export interface SessionData {
  meta: SessionMeta;
  content: Record<string, unknown> | null;
  events: SessionEvent[];
}

export class ReplayDriver {
  game: Game;
  step = 0;              // sim steps executed so far
  playing = false;
  speed = 1;
  readonly totalSteps: number;
  private eventsByStep = new Map<number, SessionEvent[]>();
  private acc = 0;
  private lastFrame = 0;
  private raf = 0;
  private fallback = 0; // hidden tabs suspend rAF (same fix as engine/loop.ts)
  private lastTickAt = 0;
  onFrame?: () => void;  // UI refresh hook (time display, seek bar)
  onEnded?: () => void;

  constructor(
    private session: SessionData,
    private canvas: HTMLCanvasElement
  ) {
    this.totalSteps = Math.max(1, session.meta.steps | 0);
    for (const ev of session.events) {
      const list = this.eventsByStep.get(ev.f);
      if (list) list.push(ev);
      else this.eventsByStep.set(ev.f, [ev]);
    }
    this.game = this.buildGame();
  }

  private buildGame(): Game {
    const ctx = this.canvas.getContext("2d")!;
    const content = this.session.content
      ? assembleContent(this.session.content)
      : assembleContent({});
    const game = new Game(ctx, content, { replay: true });
    // Fixed desktop-style viewport: recorded taps are logical-space and craft
    // ops are semantic, so replay is viewport-independent by construction.
    const scale = this.canvas.width / 640;
    game.setViewport(scale, 0, (this.canvas.height - 360 * scale) / 2, false);
    game.newRun(this.session.meta.startRoom, this.session.meta.seed);
    return game;
  }

  /** Apply all recorded events tagged for the step about to run. */
  private applyEvents(step: number): void {
    const list = this.eventsByStep.get(step);
    if (!list) return;
    for (const ev of list) {
      switch (ev.t) {
        case "k": this.game.input.inject(ev.c, ev.d === 1); break;
        case "tap": {
          // NPC-confirm buttons are laid out during render; make sure they
          // exist before a tap replays against them (matters mid-seek, when
          // renders are skipped).
          if (this.game.overlay !== "none") this.game.renderOnce();
          this.game.handleTap(ev.x, ev.y);
          break;
        }
        case "craft": this.game.applyCraftOp(ev.op); break;
        case "confirm": this.game.replayConfirms.push(ev.v); break;
      }
    }
  }

  private stepOne(): void {
    this.applyEvents(this.step);
    this.game.stepOnce();
    this.step++;
  }

  play(): void {
    if (this.playing || this.step >= this.totalSteps) return;
    this.playing = true;
    this.lastFrame = performance.now();
    const tick = () => {
      if (!this.playing) return;
      const now = performance.now();
      this.lastTickAt = now;
      this.acc += Math.min(0.25, (now - this.lastFrame) / 1000) * this.speed;
      this.lastFrame = now;
      const STEP = 1 / 60;
      while (this.acc >= STEP && this.step < this.totalSteps) {
        this.stepOne();
        this.acc -= STEP;
      }
      this.game.renderOnce();
      this.onFrame?.();
      if (this.step >= this.totalSteps) {
        this.pause();
        this.onEnded?.();
      }
    };
    const rafTick = () => {
      if (!this.playing) return;
      tick();
      this.raf = requestAnimationFrame(rafTick);
    };
    this.raf = requestAnimationFrame(rafTick);
    // Hidden tabs suspend rAF; keep replaying anyway (engine/loop.ts pattern).
    this.fallback = window.setInterval(() => {
      if (this.playing && performance.now() - this.lastTickAt > 50) tick();
    }, 16);
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this.fallback);
  }

  /**
   * Jump to an arbitrary step. Deterministic replay has no keyframes to jump
   * between — seeking backwards (or far forwards) rebuilds the game and
   * re-simulates from step 0, muted and unrendered. ~60x faster than realtime.
   */
  seek(targetStep: number): void {
    const target = Math.max(0, Math.min(this.totalSteps, targetStep | 0));
    const wasPlaying = this.playing;
    this.pause();
    if (target < this.step) {
      this.game = this.buildGame();
      this.step = 0;
    }
    const wasMuted = sfx.muted;
    sfx.muted = true; // fast-forward without an sfx storm
    while (this.step < target) this.stepOne();
    sfx.muted = wasMuted;
    this.game.renderOnce();
    this.onFrame?.();
    if (wasPlaying) this.play();
  }

  /** Replay-vs-recording drift in px (null until the replay finishes). */
  drift(): number | null {
    const m = this.session.meta;
    if (this.step < this.totalSteps || m.finalX === undefined || !this.game.player) return null;
    return Math.hypot(this.game.player.x - m.finalX, this.game.player.y - (m.finalY ?? 0));
  }

  dispose(): void {
    this.pause();
  }
}
