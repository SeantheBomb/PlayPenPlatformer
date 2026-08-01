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

export interface IdlePeriod { from: number; to: number; }

export interface Resync { step: number; kind: "checkpoint" | "death"; dx: number; dy: number; }

export interface ItemFixup { step: number; itemId: string; count: number; }

export interface HeartbeatResync { step: number; dx: number; dy: number; }

/** Beyond this many px of disagreement with a recorded checkpoint-touch
 *  anchor, snap to it rather than let whatever caused the gap keep
 *  compounding for the rest of the session. Death anchors don't use this —
 *  they always force a full respawn, see applyAnchors. */
const ANCHOR_TOLERANCE = 2;

/** No key held and no tap/craft/confirm event for at least this many steps
 *  (3s @ 60fps) counts as an idle stretch — see IdlePeriod below. */
const IDLE_THRESHOLD_STEPS = 180;

/** Stretches of the recording where the player held no key and produced no
 *  tap/craft/confirm event for at least IDLE_THRESHOLD_STEPS — derived once
 *  from the sparse transition log, no re-simulation needed. A lone tap/craft
 *  mid-gap still breaks the gap (it's a real action), but doesn't itself
 *  keep anything "held" afterward, so idle resumes immediately after it. */
export function computeIdlePeriods(events: SessionEvent[], totalSteps: number): IdlePeriod[] {
  const sorted = [...events].sort((a, b) => a.f - b.f);
  const periods: IdlePeriod[] = [];
  let held = 0;
  let last = 0;
  for (const ev of sorted) {
    if (held <= 0 && ev.f - last >= IDLE_THRESHOLD_STEPS) periods.push({ from: last, to: ev.f });
    if (ev.t === "k") held += ev.d === 1 ? 1 : -1;
    last = ev.f;
  }
  if (held <= 0 && totalSteps - last >= IDLE_THRESHOLD_STEPS) periods.push({ from: last, to: totalSteps });
  return periods;
}

export class ReplayDriver {
  game: Game;
  step = 0;              // sim steps executed so far
  playing = false;
  speed = 1;
  readonly totalSteps: number;
  /** Idle stretches — see computeIdlePeriods. Drawn as timeline bands and
   *  used by the "skip idle" button in the sessions editor tab. */
  readonly idlePeriods: IdlePeriod[];
  /** Every time a recorded anchor disagreed with the simulated position
   *  enough to be snapped — see ANCHOR_TOLERANCE. Empty means every anchor
   *  checked out, i.e. this replay tracked the original run exactly. */
  resyncs: Resync[] = [];
  /** Every time a recorded item gain wasn't already picked up by this
   *  replay's own walk-over detection — see Game.forceItemGain. Empty means
   *  every recorded pickup/drop was collected naturally, right on schedule. */
  itemFixups: ItemFixup[] = [];
  /** Every recorded heartbeat this replay reached, with the position
   *  disagreement it was applying (dx/dy are 0 if it was already exact) —
   *  the periodic full-state ground truth, applied unconditionally
   *  regardless of drift; see Game.applyHeartbeat. */
  heartbeats: HeartbeatResync[] = [];
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
    this.idlePeriods = computeIdlePeriods(session.events, this.totalSteps);
    this.game = this.buildGame();
  }

  /** The idle period containing `step`, if any — null when actively playing. */
  idlePeriodAt(step: number): IdlePeriod | null {
    return this.idlePeriods.find((p) => step >= p.from && step < p.to) ?? null;
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
        case "anchor": break;    // ground truth, not input — see applyAnchors
        case "item": break;      // ground truth, not input — see applyItemGains
        case "heartbeat": break; // ground truth, not input — see applyHeartbeats
      }
    }
  }

  /** Check the just-simulated step's ground-truth anchors (if any) against
   *  where the player actually ended up, snapping on disagreement so one
   *  divergence doesn't compound for the rest of the (possibly very long)
   *  session. Runs after stepOnce(), since an anchor records the position at
   *  the END of the tick it was captured on (post checkpoint/respawn logic),
   *  not the input state going into it. */
  private applyAnchors(step: number): void {
    const list = this.eventsByStep.get(step);
    if (!list) return;
    for (const ev of list) {
      if (ev.t !== "anchor") continue;
      // Sessions recorded before anchors carried a room (older data) have
      // ev.room === undefined — never force a switch to "undefined".
      if (ev.kind === "death") {
        // A death definitely happened here live — force the full respawn
        // unconditionally (room included), regardless of whether this
        // replay's own simulation agrees a death occurred (it may not, if
        // whatever caused an earlier mismatch already broke its own
        // health/hazard tracking too).
        const p = this.game.player;
        this.resyncs.push({ step, kind: "death", dx: ev.x - p.centerX, dy: ev.y - p.feetY });
        this.game.forceRespawn(ev.room ?? this.game.currentRoomId, ev.x, ev.y);
        continue;
      }
      if (ev.room && ev.room !== this.game.currentRoomId) {
        // The room transition itself failed to fire in replay — a real
        // failure mode, not mere position drift. Force the room too, not
        // just x/y, or we'd be placing the player at these coordinates
        // inside the WRONG room's map.
        const p = this.game.player;
        this.resyncs.push({ step, kind: "checkpoint", dx: ev.x - p.centerX, dy: ev.y - p.feetY });
        this.game.forceRoom(ev.room);
        this.game.player.placeFeetAt(ev.x, ev.y);
        continue;
      }
      const p = this.game.player;
      // Anchors are recorded as (centerX, feetY) — see game.ts's two
      // recordAnchor call sites — matching placeFeetAt's own inputs.
      const dx = ev.x - p.centerX, dy = ev.y - p.feetY;
      if (Math.hypot(dx, dy) > ANCHOR_TOLERANCE) {
        this.resyncs.push({ step, kind: "checkpoint", dx, dy });
        p.placeFeetAt(ev.x, ev.y);
      }
    }
  }

  /** Check the just-simulated step's recorded item gains (if any) against
   *  this replay's own walk-over detection, forcing in anything it missed —
   *  see Game.forceItemGain. Runs after stepOnce() for the same reason as
   *  applyAnchors: a gain records state at the END of the tick it happened
   *  on, not input going into it. */
  private applyItemGains(step: number): void {
    const list = this.eventsByStep.get(step);
    if (!list) return;
    for (const ev of list) {
      if (ev.t !== "item") continue;
      const fixed = this.game.forceItemGain(ev.itemId, ev.count, ev.src, ev.idx, ev.x, ev.y);
      if (fixed) this.itemFixups.push({ step, itemId: ev.itemId, count: ev.count });
    }
  }

  /** Apply the just-simulated step's recorded heartbeat (if any) — a full
   *  ground-truth resync, unconditional (see Game.applyHeartbeat for why).
   *  Runs after stepOnce() like the other ground-truth checks: it records
   *  state at the END of the tick it was captured on. */
  private applyHeartbeats(step: number): void {
    const list = this.eventsByStep.get(step);
    if (!list) return;
    for (const ev of list) {
      if (ev.t !== "heartbeat") continue;
      const p = this.game.player;
      const dx = ev.player.x - p.x, dy = ev.player.y - p.y;
      this.heartbeats.push({ step, dx, dy });
      this.game.applyHeartbeat(ev);
    }
  }

  private stepOne(): void {
    this.applyEvents(this.step);
    this.game.stepOnce();
    this.applyAnchors(this.step);
    this.applyItemGains(this.step);
    this.applyHeartbeats(this.step);
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
      this.resyncs = [];
      this.itemFixups = [];
      this.heartbeats = [];
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
