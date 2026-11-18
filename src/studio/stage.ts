// Preview stages, the running half: the Effects panel's preview is the REAL
// game — a replay-mode Game (no recording, no analytics, detached input)
// running a one-room level built from a vfx.json stage (stagebuild.ts) or a
// real room the tile appears in, with the draft content, so whatever the
// panel shows is exactly what the engine does. It loops the stage, counts the
// moment as the VfxPlayer actually receives it (the save check), and can
// record a new input clip from live keys, the same {f, code, down} shape the
// session recorder uses.
import type { Content, VfxStage } from "../data/types";
import { Game } from "../game/game";
import { sfx } from "../engine/audio";
import { buildStage, STAGE_ROOM_ID, type BuiltStage, type StageSubject } from "./stagebuild";

const VIEW_W = 640, VIEW_H = 360;
const RECORD_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "KeyA", "KeyD", "KeyW", "KeyS"]);

export type StageSource =
  | { kind: "stage"; stage: VfxStage }
  | { kind: "room"; roomId: string; tx: number; ty: number };

export interface StageLoopReport {
  /** Times the previewed moment reached the VfxPlayer this loop. */
  moments: number;
  peakParticles: number;
}

export class StageRunner {
  readonly canvas: HTMLCanvasElement;
  private game: Game | null = null;
  private built: BuiltStage | null = null;
  private step = 0;
  private timer = 0;
  private wasMuted = false;
  private peak = 0;
  private recording: { f: number; c: string; d: 0 | 1 }[] | null = null;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  /** Called at the end of every loop (and of a recording). */
  onLoop?: (r: StageLoopReport) => void;
  onRecorded?: (clip: { f: number; c: string; d: 0 | 1 }[]) => void;
  errors: string[] = [];

  constructor(
    private content: Content,
    private source: StageSource,
    private subject: StageSubject,
    private moment: string,
    width = 480,
    height = 270
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.tabIndex = 0; // focus = where recorded keys go
  }

  private seconds(): number {
    return this.source.kind === "stage" ? this.source.stage.seconds ?? 4 : 4;
  }

  /** Build (or rebuild) the Game for one loop. */
  private boot(): void {
    let c: Content = this.content;
    let roomId: string;
    let frame: { tx: number; ty: number; w: number; h: number };
    if (this.source.kind === "stage") {
      this.built = buildStage(this.content, this.source.stage, this.subject, this.moment);
      this.errors = this.built.errors;
      const r = this.built.room;
      c = {
        ...this.content,
        rooms: { ...this.content.rooms, [STAGE_ROOM_ID]: r },
        campaign: { ...this.content.campaign, rooms: [STAGE_ROOM_ID], demo: undefined } as Content["campaign"],
        taunts: [], achievements: [],
      };
      roomId = STAGE_ROOM_ID;
      frame = { tx: 0, ty: 0, w: r.width, h: r.height };
    } else {
      this.built = null;
      this.errors = [];
      roomId = this.source.roomId;
      // A real room: same content, no Warden lines, framed on the tile.
      c = { ...this.content, taunts: [], achievements: [] };
      frame = { tx: this.source.tx - 10, ty: this.source.ty - 6, w: 20, h: 11 };
    }
    const ctx = this.canvas.getContext("2d")!;
    const game = new Game(ctx, c, { replay: true });
    const scale = this.canvas.width / VIEW_W;
    game.setViewport(scale, 0, (this.canvas.height - VIEW_H * scale) / 2, false);
    game.newRun(roomId, 1);
    if (this.built?.placed) game.roomRt.placeItem(this.built.placed.type, this.built.placed.x, this.built.placed.y);
    const zoom = Math.max(1, Math.min(4, Math.floor(Math.min(VIEW_W / (frame.w * 16), VIEW_H / (frame.h * 16)) * 4) / 4));
    game.previewFrame = {
      zoom,
      x: frame.tx * 16 + (frame.w * 16 - VIEW_W / zoom) / 2,
      y: frame.ty * 16 + (frame.h * 16 - VIEW_H / zoom) / 2,
    };
    game.vfx.seen.clear();
    this.game = game;
    this.step = 0;
    this.peak = 0;
  }

  start(): void {
    this.stop();
    this.wasMuted = sfx.muted;
    sfx.muted = true; // a preview is silent; sound is game feel (locked rows)
    this.boot();
    this.timer = window.setInterval(() => this.tick(), 1000 / 60);
    window.addEventListener("keydown", this.keyHandler, true);
    window.addEventListener("keyup", this.keyHandler, true);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = 0; sfx.muted = this.wasMuted; }
    window.removeEventListener("keydown", this.keyHandler, true);
    window.removeEventListener("keyup", this.keyHandler, true);
    this.game = null;
  }

  get running(): boolean { return this.timer !== 0; }

  /** The real game's own count of the moment so far this loop. */
  get momentsThisLoop(): number { return this.game?.vfx.seen.get(`${this.moment}|${this.subject.def.id}`) ?? 0; }
  get particles(): number { return this.game?.vfx.particleCount ?? 0; }

  /** "Fire now": play the effect straight away at the previewed cell — a
   *  labelled shortcut for looking at it, NOT proof the moment triggers. It
   *  doesn't count toward the loop's moment total. */
  fireNow(): void {
    const g = this.game;
    if (!g) return;
    const at = this.source.kind === "room" ? { tx: this.source.tx, ty: this.source.ty } : this.built?.at;
    if (!at) return;
    const placed = this.built?.placed;
    const cell = placed ? { px: placed.x, py: placed.y - 8 } : { px: at.tx * 16, py: at.ty * 16 };
    const before = new Map(g.vfx.seen);
    g.vfx.play(this.moment, this.subject.def, { x: at.tx * 16 + 8, y: at.ty * 16 + (placed ? 8 : 0), color: this.subject.def.color, cell });
    g.vfx.seen.clear();
    for (const [k, v] of before) g.vfx.seen.set(k, v);
  }

  /** Record a new clip: restart the loop, take live keys until it ends. */
  record(): void {
    if (!this.running) this.start();
    this.boot();
    this.recording = [];
    this.canvas.focus();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.recording || !this.game || !RECORD_KEYS.has(e.code) || e.repeat) return;
    if (document.activeElement !== this.canvas) return;
    e.preventDefault();
    const d = e.type === "keydown" ? 1 : 0;
    this.recording.push({ f: this.step, c: e.code, d });
    this.game.input.inject(e.code, d === 1);
  }

  private tick(): void {
    const g = this.game;
    if (!g) return;
    const f = this.step;
    if (!this.recording && this.source.kind === "stage") {
      for (const ev of this.source.stage.clip ?? []) if (ev.f === f) g.input.inject(ev.c, ev.d === 1);
    }
    const st = this.source.kind === "stage" ? this.source.stage : null;
    if (st?.apply && this.built?.at) {
      const beat = f % Math.round(st.apply * 60);
      if (this.built.prime && beat === 0) g.stageApplyElement(this.built.prime, this.built.at.tx, this.built.at.ty);
      if (this.built.actor && beat === 30) g.stageApplyElement(this.built.actor, this.built.at.tx, this.built.at.ty);
    }
    g.stepOnce();
    this.step++;
    this.peak = Math.max(this.peak, g.vfx.particleCount);
    g.renderOnce();
    if (this.step >= this.seconds() * 60) {
      const report = { moments: this.momentsThisLoop, peakParticles: this.peak };
      if (this.recording) {
        const clip = this.recording;
        this.recording = null;
        this.onRecorded?.(clip);
      }
      this.onLoop?.(report);
      if (this.running) this.boot();
    }
  }
}

/** Run a stage headlessly-fast (no drawing) for one loop and report — the
 *  save check for a custom stage: it must really trigger its moment. */
export function proveStage(content: Content, stage: VfxStage, subject: StageSubject, moment: string): StageLoopReport & { errors: string[] } {
  const r = new StageRunner(content, { kind: "stage", stage }, subject, moment, 64, 36);
  const was = sfx.muted;
  sfx.muted = true;
  try {
    (r as unknown as { boot(): void }).boot();
    const g = (r as unknown as { game: Game }).game;
    const built = (r as unknown as { built: BuiltStage }).built;
    if (built.errors.length) return { moments: 0, peakParticles: 0, errors: built.errors };
    let peak = 0;
    const steps = Math.round((stage.seconds ?? 4) * 60);
    for (let f = 0; f < steps; f++) {
      for (const ev of stage.clip ?? []) if (ev.f === f) g.input.inject(ev.c, ev.d === 1);
      if (stage.apply && built.at) {
        const beat = f % Math.round(stage.apply * 60);
        if (built.prime && beat === 0) g.stageApplyElement(built.prime, built.at.tx, built.at.ty);
        if (built.actor && beat === 30) g.stageApplyElement(built.actor, built.at.tx, built.at.ty);
      }
      g.stepOnce();
      peak = Math.max(peak, g.vfx.particleCount);
    }
    return { moments: g.vfx.seen.get(`${moment}|${subject.def.id}`) ?? 0, peakParticles: peak, errors: [] };
  } finally {
    sfx.muted = was;
  }
}
