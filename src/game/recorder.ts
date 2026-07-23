// Session recorder: captures a real (non-bot) playsession precisely enough to
// reproduce it — the content bundle as played, the run's RNG seed, and every
// input, tagged by fixed-timestep step index. Replays re-run the actual
// simulation from those inputs (see replay.ts); nothing here samples or
// approximates state.
//
// Bot detection: synthetic input events (isTrusted: false — the scripted
// playtest workflow) and PP.give/PP.warp debug calls taint the session.
// Tainted sessions are dropped, not uploaded (recorder.uploadTainted = true
// overrides for pipeline testing; they arrive marked bot and are filtered
// out of the viewer by default).
//
// Upload is chunked (periodic + on end + best-effort on pagehide) so a
// tab-closed-mid-run session still lands, minus at most the last partial
// chunk. Everything is fire-and-forget: recording must never break play.

import type { Game } from "./game";
import type { CraftPointerOp } from "./craftui";

export type CraftOp = CraftPointerOp;

export type SessionEvent =
  | { f: number; t: "k"; c: string; d: 0 | 1 }
  | { f: number; t: "tap"; x: number; y: number }
  | { f: number; t: "craft"; op: CraftOp }
  | { f: number; t: "confirm"; v: boolean };

export interface RoomSegment {
  id: string;
  from: number;        // stepCount (session-relative) when the room began
  to: number | null;   // null while it's the active room
}

export interface SessionMeta {
  id: string;
  pid: string;
  startedAt: string;   // wall-clock ISO — when the human actually played
  seed: number;
  startRoom: string;
  steps: number;       // total sim steps recorded (steps/60 = seconds)
  rooms: RoomSegment[];
  deaths: number;
  crafts: number;
  discoveries: number;
  win: boolean;
  endReason: string;   // win | quit | restarted | abandoned | editor | (open)
  tainted: boolean;
  taintReason?: string;
  dev: boolean;
  scheme: string;
  viewport: { w: number; h: number; compact: boolean };
  ua: string;
  finalX?: number;     // player position at end — replay drift diagnostic
  finalY?: number;
}

const FLUSH_MS = 45_000;
const FLUSH_EVENTS = 1500;

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pid(): string {
  try {
    let v = localStorage.getItem("playpen.pid");
    if (!v) {
      v = newId();
      localStorage.setItem("playpen.pid", v);
    }
    return v;
  } catch {
    return "anon";
  }
}

class Recorder {
  /** Set by main.ts: the effective content file map + API base URL. */
  contentFiles: (() => Record<string, unknown>) | null = null;
  apiBase = "";
  /** Editor was opened this page load — sessions get flagged dev. */
  devFlag = false;
  /** Testing hook: upload tainted (bot) sessions instead of dropping them. */
  uploadTainted = false;

  private game: Game | null = null;
  private meta: SessionMeta | null = null;
  private events: SessionEvent[] = [];
  private base = 0;      // game.stepCount at begin — event tags are relative
  private seq = 0;       // next chunk sequence number
  private sentContent = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    try {
      window.addEventListener("pagehide", () => {
        if (this.meta) this.end("abandoned", this.game ?? undefined, true);
      });
    } catch { /* recorder must never break boot */ }
  }

  get active(): boolean {
    return this.meta !== null;
  }

  private tag(): number {
    return this.game ? this.game.stepCount - this.base : 0;
  }

  begin(game: Game, startRoom: string): void {
    try {
      if (this.meta) this.end("restarted", this.game ?? undefined);
      this.game = game;
      this.base = game.stepCount;
      this.seq = 0;
      this.sentContent = false;
      this.events = [];
      this.meta = {
        id: newId(),
        pid: pid(),
        startedAt: new Date().toISOString(),
        seed: game.runSeed,
        startRoom,
        steps: 0,
        rooms: [],
        deaths: 0,
        crafts: 0,
        discoveries: 0,
        win: false,
        endReason: "(open)",
        tainted: false,
        dev: this.devFlag || location.protocol === "file:" || location.hostname === "localhost",
        scheme: game.input.scheme,
        viewport: {
          w: Math.round(window.innerWidth), h: Math.round(window.innerHeight),
          compact: Math.min(window.innerWidth, window.innerHeight) < 500,
        },
        ua: navigator.userAgent.slice(0, 160),
      };
      this.timer = setInterval(() => this.flush(false), FLUSH_MS);
    } catch { /* never break play */ }
  }

  taint(reason: string): void {
    if (this.meta && !this.meta.tainted) {
      this.meta.tainted = true;
      this.meta.taintReason = reason;
    }
  }

  onInputTransition(code: string, isDown: boolean, trusted: boolean): void {
    if (!this.meta) return;
    if (!trusted) this.taint("synthetic-input");
    this.push({ f: this.tag(), t: "k", c: code, d: isDown ? 1 : 0 });
  }

  recordTap(x: number, y: number): void {
    if (!this.meta) return;
    this.push({ f: this.tag(), t: "tap", x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }

  recordCraftOp(op: CraftOp): void {
    if (!this.meta) return;
    this.push({ f: this.tag(), t: "craft", op });
  }

  recordConfirm(v: boolean): void {
    if (!this.meta) return;
    this.push({ f: this.tag(), t: "confirm", v });
  }

  markRoom(roomId: string, stepCount: number): void {
    if (!this.meta) return;
    const rel = stepCount - this.base;
    const open = this.meta.rooms.find((r) => r.to === null);
    if (open) open.to = rel;
    // Respawn back into the checkpoint room re-marks it; only add a segment
    // when the room actually changes (deaths within a room stay one segment).
    const last = this.meta.rooms[this.meta.rooms.length - 1];
    if (!last || last.id !== roomId || last.to !== rel) {
      this.meta.rooms.push({ id: roomId, from: rel, to: null });
    } else {
      last.to = null; // same room, contiguous — reopen it
    }
  }

  markDeath(): void {
    if (this.meta) this.meta.deaths++;
  }

  /** Force an upload now (e.g. room transitions) instead of waiting on the timer/threshold. */
  checkpoint(): void {
    if (this.meta) this.flush(false, false, true);
  }

  private push(ev: SessionEvent): void {
    this.events.push(ev);
    if (this.events.length >= FLUSH_EVENTS) this.flush(false);
  }

  private syncStats(game?: Game): void {
    if (!this.meta || !game) return;
    this.meta.dev = this.meta.dev || this.devFlag; // editor opened mid-session
    this.meta.steps = game.stepCount - this.base;
    const open = this.meta.rooms.find((r) => r.to === null);
    if (open && this.meta.endReason !== "(open)") open.to = this.meta.steps;
    if (game.state) {
      this.meta.crafts = game.state.stats.crafts;
      this.meta.discoveries = game.state.stats.discoveries;
    }
    if (game.player) {
      this.meta.finalX = Math.round(game.player.x * 100) / 100;
      this.meta.finalY = Math.round(game.player.y * 100) / 100;
    }
    this.meta.scheme = game.input.scheme;
  }

  end(reason: string, game?: Game, useBeacon = false): void {
    if (!this.meta) return;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.meta.endReason = reason;
    this.meta.win = reason === "win";
    this.syncStats(game ?? this.game ?? undefined);
    this.flush(true, useBeacon);
    this.meta = null;
    this.events = [];
    this.game = null;
  }

  private flush(final: boolean, useBeacon = false, force = false): void {
    const meta = this.meta;
    if (!meta) return;
    if (meta.tainted && !this.uploadTainted) {
      // Bot-driven sessions are not captured (the point of the taint flag).
      this.events = [];
      return;
    }
    if (!final && !force && this.events.length === 0) return;
    this.syncStats(this.game ?? undefined);
    try {
      const body: Record<string, unknown> = {
        id: meta.id,
        seq: this.seq++,
        meta,
        events: this.events,
        final,
      };
      if (!this.sentContent) {
        body.content = this.contentFiles ? this.contentFiles() : null;
        this.sentContent = true;
      }
      this.events = [];
      const json = JSON.stringify(body);
      const url = `${this.apiBase}/api/sessions`;
      // sendBeacon caps out around 64KB; only trust it for small final chunks.
      if (useBeacon && navigator.sendBeacon && json.length < 60_000) {
        navigator.sendBeacon(url, new Blob([json], { type: "application/json" }));
      } else {
        void fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: json,
          keepalive: useBeacon,
        }).catch(() => {});
      }
    } catch { /* never break play */ }
  }
}

export const recorder = new Recorder();
