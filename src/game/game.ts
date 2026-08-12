// Game orchestrator: scenes, room flow, interactions, death loop, win.
import type { Content, ItemDef } from "../data/types";
import { Input } from "../engine/input";
import { Loop } from "../engine/loop";
import { HitStop } from "../engine/hitstop";
import { Camera } from "../engine/camera";
import { Particles } from "../engine/particles";
import { sfx } from "../engine/audio";
import { music } from "../engine/music";
import { TILE } from "../engine/tilemap";
import { drawBackdrop, drawItemIcon, drawMap, drawNpcAvatar, drawSprite, roundRect } from "../engine/renderer";
import { rectsOverlap, randRange, type Rect } from "../engine/math";
import { RunState, type StateSnapshot } from "./state";
import { Player, type PlayerSnapshot } from "./player";
import {
  RoomRuntime, type ElementEvent, type EntityInstance,
  type EnemySnapshot, type FluidRuntimeSnapshot,
} from "./room";
import { TauntManager } from "./taunts";
import { CraftUI } from "./craftui";
import { TouchControls, type SmartContext } from "./touch";
import { Warden } from "./warden";
import { telemetry } from "./telemetry";
import { simNow, setSimTime } from "../engine/simclock";
import { randomSeed } from "../engine/rng";
import { itemAttachments, registerFn, type ScriptCtx } from "./behavior";
import { recorder, type CraftOp, type Heartbeat } from "./recorder";
import {
  drawAir, drawClimbTimer, drawFloaties, drawHearts, drawHotbar, drawPrompt,
  drawTauntBanner, drawTextOverlay, drawToast, drawToolbelt, hotbarSlotRect, TOAST_MS,
  type Toast,
  type Floaty, type OverlayButton,
} from "./hud";

export const VIEW_W = 640;
export const VIEW_H = 360;

// Level-select list layout (shared by renderMenu and handleTap hit-testing).
const LEVELS_TOP = 172;
const LEVELS_ROW_H = 16;

/** Full-state ground-truth capture cadence — 5s @ 60fps. Frequent enough to
 *  catch a mid-room divergence (see game/replay.ts's applyHeartbeat) well
 *  before it compounds into something like a missed jump or door, without
 *  either a meaningful storage cost or per-frame overhead. */
const HEARTBEAT_STEPS = 300;

type Scene = "menu" | "play" | "win";
type Overlay = "none" | "note" | "dialog" | "npcConfirm" | "craft" | "pause" | "report";

export class Game {
  content: Content;
  /** Replay-player instance: no real input, no recording, no telemetry. */
  readonly replay: boolean;
  /** Simulated ms elapsed (advances one fixed step per update; frozen on pause). */
  simTime = 0;
  /** Fixed-timestep updates executed so far — the replay event timeline unit. */
  stepCount = 0;
  /** Freeze-frame timer for hard-hit juice — step-counted, not wall-clock,
   *  so it replays identically (see engine/hitstop.ts for why). */
  private hitStopClock = new HitStop();
  private lastInputSim = 0; // simTime of the last real/injected input (idle logic)
  runSeed = 0;
  /** Confirm-dialog answers queued by the replay driver (see askConfirm). */
  replayConfirms: boolean[] = [];
  // Breath while submerged in deep water (rules.airBlips / airLossSeconds /
  // drownSeconds). Sim-time driven, so replays reproduce it exactly.
  private air = 0;
  private nextAirLossAt = 0;
  private nextDrownAt = 0;
  private prevSwim: "none" | "surface" | "under" = "none";
  /** Thrown smoke bombs in flight (sim state — replay-safe). */
  private bombs: { x: number; y: number; vx: number; vy: number; itemId: string }[] = [];
  /** simTime when the current throw charge began (null = not charging). */
  private throwChargeSince: number | null = null;
  input: Input;
  camera = new Camera();
  particles = new Particles();
  taunts: TauntManager;
  craftUI: CraftUI;
  loop: Loop;

  scene: Scene = "menu";
  // Level select: a deliberately quiet power-user door on the main menu —
  // most players should still just funnel into room one.
  private menuMode: "main" | "levels" = "main";
  private levelSel = 0;
  overlay: Overlay = "none";
  state!: RunState;
  player!: Player;
  roomRt!: RoomRuntime;
  currentRoomId = "";
  private roomEnteredAt = 0;

  touch: TouchControls;
  warden = new Warden();
  private wardenSpawnAt = Infinity; // boss-room spawn schedule
  private idleWardenSummoned = false;
  private animT = 0;
  private viewScale = 1;
  private viewOx = 0;
  private viewOy = 0;
  private compact = false;  // small (phone-sized) screen
  private worldZoom = 1;    // world magnification on compact screens
  private tipText = "";
  private tipUntil = 0;
  private floaties: Floaty[] = [];
  /** Queued fanfare cards (pickup / craft-ready) — drawn one at a time. */
  private toasts: Toast[] = [];
  /** Which known-and-never-crafted recipes were craftable last step — the
   *  false→true edge is what fires a CRAFT READY toast. */
  private wasCraftable = new Set<string>();
  private overlayEntity: EntityInstance | null = null;
  private overlayText = "";
  private overlayTitle = "";
  private confirmButtons: OverlayButton[] = [];
  private winShownAt = 0;
  private finishedInMs = 0;
  private reportUI: import("./report").ReportUI | null = null;
  private emberTimer = 0; // accumulator gating the lit-torch ember trail

  constructor(
    private ctx: CanvasRenderingContext2D,
    content: Content,
    opts: { replay?: boolean } = {}
  ) {
    this.replay = !!opts.replay;
    // A replay Game must never see real keyboard/touch input — its Input
    // listens on a detached element and is driven purely by inject().
    this.input = new Input(this.replay ? document.createElement("div") : window);
    this.content = content;
    this.taunts = new TauntManager(content.taunts);
    this.taunts.onTauntShown = () => {
      if (this.state) {
        this.state.stats.tauntsHeard++;
        this.state.bump("tauntsHeard");
        this.checkAchievements("counter");
      }
    };
    this.craftUI = new CraftUI(content, (result) => {
      if (result.ok) {
        sfx.play(result.firstTime ? "discover" : "craft");
        if (this.state.stats.crafts === 1) this.taunts.fire("first_craft");
        if (result.outputId) {
          this.taunts.fire("craft_item", { itemId: result.outputId });
          this.checkAchievements("craft_item", { itemId: result.outputId });
          if (!this.replay) telemetry.craft(this.currentRoomId, result.outputId);
          const outDef = this.state.item(result.outputId);
          if (outDef?.useMode) this.switchHotbarSelection(outDef.id);
        }
      } else {
        sfx.play("craftFail");
        this.taunts.fire("craft_fail");
      }
    });
    // Pointer-driven craft actions are recorded semantically (which slot,
    // which combine) rather than as raw coordinates, so replay is immune to
    // viewport differences. Keyboard craft nav replays via key injection.
    this.craftUI.onPointerOp = (op) => {
      if (!this.replay) recorder.recordCraftOp(op);
    };
    this.loop = new Loop(
      (dt) => this.update(dt),
      () => this.render()
    );
    this.touch = new TouchControls(
      // Replay: listeners bind to a detached canvas so real touches on the
      // replay viewport can never leak into the simulation.
      this.replay ? document.createElement("canvas") : (ctx.canvas as HTMLCanvasElement),
      this.input,
      (cx, cy) => this.screenToLogical(cx, cy),
      (cx, cy) => this.screenToCanvasPixel(cx, cy),
      () => (this.overlay === "craft" ? "craft" : this.overlay === "none" ? "none" : "other")
    );
    this.touch.onTap = (x, y) => this.handleTap(x, y);
    this.touch.onCraftPointer = (phase, x, y) => {
      if (phase === "down") this.craftUI.pointerDown(x, y, this.state);
      else if (phase === "move") this.craftUI.pointerMove(x, y);
      else if (this.craftUI.pointerUp(x, y, this.state) === "close") {
        if (!this.replay) recorder.recordCraftOp({ op: "close" });
        this.craftUI.hide();
        this.overlay = "none";
      }
    };
    // Pointer events: mouse parity everywhere + drag-and-drop in the workbench.
    // Touch is handled entirely through TouchControls above (avoids double-firing
    // from synthesized pointer events, and survives preventDefault suppressing them).
    const canvas = ctx.canvas as HTMLCanvasElement;
    // The craft workbench draws and hit-tests in raw canvas-pixel space, so its
    // pointer coords come from screenToCanvasPixel; everything else is logical.
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") return;
      if (this.scene === "play" && this.overlay === "craft") {
        const p = this.screenToCanvasPixel(e.clientX, e.clientY);
        this.craftUI.pointerDown(p.x, p.y, this.state);
      } else {
        const p = this.screenToLogical(e.clientX, e.clientY);
        this.handleTap(p.x, p.y);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      if (this.scene === "play" && this.overlay === "craft") {
        const p = this.screenToCanvasPixel(e.clientX, e.clientY);
        this.craftUI.pointerMove(p.x, p.y);
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      if (e.pointerType === "touch") return;
      if (this.scene === "play" && this.overlay === "craft") {
        const p = this.screenToCanvasPixel(e.clientX, e.clientY);
        if (this.craftUI.pointerUp(p.x, p.y, this.state) === "close") {
          if (!this.replay) recorder.recordCraftOp({ op: "close" });
          this.craftUI.hide();
          this.overlay = "none";
        }
      }
    });
    this.input.onSchemeChange = (s) => {
      if (s === "gamepad") this.tip("controller detected");
    };
    this.applyConfig();
  }

  /** Dialog portrait: custom art if set, otherwise a big blob face. */
  private npcPortrait(e: EntityInstance) {
    return (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
      // Through drawSprite's shared image cache — a fresh `new Image()` per
      // draw call never had time to decode, so custom portraits silently
      // never showed (procedural face won every frame).
      if (e.def.portrait && drawSprite(ctx, { sprite: e.def.portrait }, x, y, size, size)) {
        return;
      }
      const color = e.def.color ?? "#7fd8e8";
      if (e.def.avatar) {
        // Signature body, blown up to portrait size (12×16 grid centered).
        const aw = size * 0.75;
        drawNpcAvatar(
          ctx, e.def.avatar, x + (size - aw) / 2, y + size * 0.02,
          aw, size * 0.96, color, 1, { helped: e.helped }
        );
        return;
      }
      ctx.fillStyle = color;
      roundRect(ctx, x + 2, y + size * 0.18, size - 4, size * 0.82, 8);
      ctx.fill();
      // Wide hopeful eyes + small mouth
      ctx.fillStyle = "#1a2530";
      ctx.beginPath();
      ctx.arc(x + size * 0.32, y + size * 0.48, 4, 0, Math.PI * 2);
      ctx.arc(x + size * 0.68, y + size * 0.48, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x + size * 0.34, y + size * 0.45, 1.4, 0, Math.PI * 2);
      ctx.arc(x + size * 0.70, y + size * 0.45, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#1a2530";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + size * 0.42, y + size * 0.72);
      ctx.quadraticCurveTo(x + size * 0.5, y + size * 0.78, x + size * 0.58, y + size * 0.72);
      ctx.stroke();
    };
  }

  /** Blocking confirm that records the player's answer — a replay consumes
   *  the recorded answer instead of popping a real dialog. */
  private askConfirm(msg: string): boolean {
    if (this.replay) return this.replayConfirms.shift() ?? false;
    const v = confirm(msg);
    recorder.recordConfirm(v);
    return v;
  }

  /** Stuck? Put the whole room back the way it started (softlock escape).
   *  Lands back at your last checkpoint if it's in this room — not the
   *  room's original spawn — so resetting doesn't also throw away progress
   *  toward wherever you actually were. */
  private confirmResetRoom(): void {
    if (!this.askConfirm("Reset this room? Items, doors, and your inventory go back to how the room began.")) {
      return;
    }
    this.overlay = "none";
    const keepCheckpoint = this.state.checkpoint.roomId === this.currentRoomId
      ? { ...this.state.checkpoint } : null;
    this.state.roomStates.delete(this.currentRoomId);
    this.state.inventory.clear();
    this.state.selectedConsumable = 0;
    this.loadRoom(this.currentRoomId);
    this.state.checkpoint = keepCheckpoint ?? {
      roomId: this.currentRoomId, x: this.roomRt.spawnX, y: this.roomRt.spawnY,
    };
    this.player.placeFeetAt(this.state.checkpoint.x, this.state.checkpoint.y);
    if (keepCheckpoint) {
      // Re-mark the checkpoint entity itself as touched — the reset just
      // wiped that mutation, but the player is standing right back on it.
      const cpEntity = this.roomRt.entities.find(
        (e) => e.kind === "checkpoint" &&
          Math.abs(e.x + e.w / 2 - keepCheckpoint.x) < 1 && Math.abs(e.y + e.h - keepCheckpoint.y) < 1
      );
      if (cpEntity) {
        cpEntity.open = true;
        this.state.mutations(this.currentRoomId).openedDoors.add(cpEntity.index);
      }
    }
    this.floaty("Room reset.", this.player.centerX, this.player.y - 12, "#9be8b0");
    sfx.play("checkpoint");
  }

  private async openReportUI(): Promise<void> {
    if (!this.reportUI) {
      const mod = await import("./report");
      this.reportUI = new mod.ReportUI(this, () => {
        this.overlay = "none";
      });
    }
    this.reportUI.open();
  }

  /** Touch-critical UI grows on small touch screens. */
  private uiScale(): number {
    return this.compact && this.input.scheme === "touch" ? 1.4 : 1;
  }

  private tip(text: string): void {
    this.tipText = text;
    this.tipUntil = simNow() + 2500;
  }

  /** Client (CSS) coords -> raw canvas backing-store pixel coords. */
  screenToCanvasPixel(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = this.ctx.canvas as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  screenToLogical(clientX: number, clientY: number): { x: number; y: number } {
    const p = this.screenToCanvasPixel(clientX, clientY);
    return {
      x: (p.x - this.viewOx) / this.viewScale,
      y: (p.y - this.viewOy) / this.viewScale,
    };
  }

  /** Taps that didn't land on a touch button: UI navigation. */
  handleTap(x: number, y: number): void {
    // Logical-space (640×360) coords — viewport-independent, so raw recording
    // replays byte-identically on any screen.
    if (!this.replay) recorder.recordTap(x, y);
    if (this.scene === "menu") {
      if (this.menuMode === "levels") {
        const rooms = this.content.campaign.rooms;
        const top = LEVELS_TOP;
        const row = Math.floor((y - top) / LEVELS_ROW_H);
        if (x >= VIEW_W / 2 - 110 && x <= VIEW_W / 2 + 110 && row >= 0 && row < rooms.length) {
          sfx.play("uiSelect");
          this.newRun(rooms[row]);
        } else {
          this.menuMode = "main"; // tap anywhere else backs out
        }
        return;
      }
      // The quiet corner door: bottom-left, same footprint as the label.
      if (x < 90 && y > VIEW_H - 26) {
        sfx.play("uiMove");
        this.menuMode = "levels";
        return;
      }
      sfx.play("uiSelect");
      this.newRun();
      return;
    }
    if (this.scene === "win") {
      if (simNow() - this.winShownAt > 1200) this.scene = "menu";
      return;
    }
    switch (this.overlay) {
      case "note":
      case "dialog":
        this.overlay = "none";
        break;
      case "pause": {
        const lx = VIEW_W / 2 - 70;
        if (x >= lx && x <= lx + 200 && y >= 146 && y <= 160) {
          // "M — sound ON/OFF" — mute has no touch/gamepad key otherwise.
          sfx.muted = !sfx.muted;
          music.muted = sfx.muted;
          music.applyVolume();
        } else if (x >= lx && x <= lx + 200 && y >= 162 && y <= 176) {
          // "Q — quit to menu" — same gap as mute.
          this.overlay = "none";
          this.scene = "menu";
          if (!this.replay) recorder.end("quit", this);
        } else if (x >= lx && x <= lx + 200 && y >= 178 && y <= 192) {
          // "R — report an issue"
          this.overlay = "report";
          this.openReportUI();
        } else if (x >= lx && x <= lx + 200 && y >= 194 && y <= 208) {
          // "X — reset this room"
          this.confirmResetRoom();
        } else {
          this.overlay = "none";
        }
        break;
      }
      case "npcConfirm": {
        for (const b of this.confirmButtons) {
          if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
            this.overlay = "none";
            if (b.action === "give" && this.overlayEntity) this.giveNpc(this.overlayEntity);
            return;
          }
        }
        break;
      }
      // "craft" is handled by the pointer-event path (drag support)
      case "none": {
        // Hotbar slot tap selects that item
        const usable = this.state.usableItems();
        const hud = this.content.game.hud;
        for (let i = 0; i < usable.length; i++) {
          const r = hotbarSlotRect(hud, VIEW_H, i, this.uiScale());
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            this.switchHotbarSelection(usable[i].id);
            sfx.play("uiMove");
            return;
          }
        }
        break;
      }
    }
  }

  /** Re-read tunables from content (called on load and after editor saves). */
  applyConfig(): void {
    const g = this.content.game;
    this.camera.lerpFactor = g.camera.lerp;
    this.camera.lookaheadX = g.camera.lookaheadX;
    this.camera.lookaheadY = g.camera.lookaheadY;
    this.camera.shakeEnabled = g.juice.screenShake;
    this.camera.shakeIntensity = g.juice.shakeIntensity;
    this.particles.enabled = g.juice.particles;
    sfx.volume = g.audio.sfxVolume;
    sfx.muted = g.audio.muted;
    music.volume = g.audio.musicVolume;
    music.muted = g.audio.muted;
    music.applyVolume();
    this.taunts.setTaunts(this.content.taunts);
    this.craftUI.setContent(this.content);
    this.player?.setConfig(g.player);
  }

  setContent(content: Content): void {
    this.content = content;
    this.applyConfig();
  }

  start(): void {
    this.loop.start();
  }

  /** Freeze simulation + input while the editor owns the page — the game
   *  canvas is hidden behind it, but without this the player keeps moving,
   *  sfx keeps firing, and keyboard input meant for editor fields (Space,
   *  Tab, arrows) leaks through as gameplay actions. */
  pause(): void {
    this.loop.stop();
    this.input.setPaused(true);
    music.pause();
  }

  resume(): void {
    this.input.setPaused(false);
    this.loop.start();
    music.resume();
  }

  /** Native-resolution viewport: logical 640x360 scaled/centered by main.ts. */
  setViewport(scale: number, ox: number, oy: number, compact = false): void {
    this.viewScale = scale;
    this.viewOx = ox;
    this.viewOy = oy;
    this.compact = compact;
    // Phones see a tighter slice of the world so everything reads larger.
    this.worldZoom = compact ? 4 / 3 : 1;
    this.touch.setViewport(scale, ox, oy, this.ctx.canvas.width, this.ctx.canvas.height);
    this.craftUI.setViewport(compact, this.ctx.canvas.width, this.ctx.canvas.height, scale, ox, oy);
  }

  newRun(startRoomId?: string, seed?: number): void {
    const roomId = startRoomId ?? this.content.campaign.rooms[0];
    // Seed gameplay randomness for this run; a recorded session stores the
    // seed so its replay rolls the identical taunt sequence.
    this.runSeed = seed ?? randomSeed();
    this.taunts.reseed(this.runSeed);
    this.replayConfirms.length = 0;
    this.state = new RunState(this.content, roomId);
    this.player = new Player(this.content.game.player);
    this.air = this.content.game.rules.airBlips;
    this.prevSwim = "none";
    this.taunts.reset();
    this.particles.clear();
    this.floaties = [];
    this.toasts = [];
    this.wasCraftable.clear();
    this.scene = "play";
    this.overlay = "none";
    this.menuMode = "main";
    // Begin recording before loadRoom so the first room marker lands inside
    // the new session (also cleanly ends any session still open).
    if (!this.replay) recorder.begin(this, roomId);
    this.loadRoom(roomId);
    this.state.checkpoint = {
      roomId, x: this.roomRt.spawnX, y: this.roomRt.spawnY,
    };
    this.taunts.fire("game_start");
  }

  /** Just the room-construction step: a fresh RoomRuntime rebuilt from
   *  content + the current mutation record, no transition side effects
   *  (taunts, warden reset, camera snap...). loadRoom (below) wraps this
   *  for a genuine room change; applyHeartbeat (see below) uses it bare to
   *  resync entities/tiles when correcting state WITHOUT actually having
   *  changed rooms, where those side effects would be actively wrong
   *  (e.g. resetting the warden's summon timer every heartbeat would mean
   *  he can never actually catch up to an idle player in replay). */
  private rebuildRoom(roomId: string): boolean {
    const room = this.content.rooms[roomId];
    if (!room) {
      console.error("Missing room:", roomId);
      return false;
    }
    this.roomRt = new RoomRuntime(
      room, this.content, this.state.mutations(roomId), this.state.helpedNpcIds, this.runSeed
    );
    return true;
  }

  loadRoom(roomId: string): void {
    if (!this.rebuildRoom(roomId)) return;
    this.currentRoomId = roomId;
    this.roomEnteredAt = Date.now();
    if (!this.replay) {
      telemetry.roomEnter(roomId);
      recorder.markRoom(roomId, this.stepCount);
      recorder.checkpoint();
    }
    this.bombs = [];
    this.player.placeFeetAt(this.roomRt.spawnX, this.roomRt.spawnY);
    this.player.hiddenIn = null;
    // Warden scheduling: boss rooms summon him after a grace period.
    this.warden.dissipate();
    this.idleWardenSummoned = false;
    this.wardenSpawnAt = this.roomRt.room.wardenChase
      ? simNow() + this.roomRt.room.wardenChase.delayMs
      : Infinity;
    this.camera.snapTo(
      this.player.centerX, this.player.centerY,
      VIEW_W / this.worldZoom, VIEW_H / this.worldZoom,
      this.roomRt.map.pixelWidth, this.roomRt.map.pixelHeight
    );
    this.particles.clear();
    sfx.stopAllLoops(); // a capacitor's hum shouldn't carry over from the last room
    // ...but one already left ON in THIS room (persisted state) should hum
    // immediately — otherwise it stays silent until it next toggles off/on,
    // since checkCapacitors only announces an off->on transition.
    for (const e of this.roomRt.entities) {
      if (e.kind === "capacitor" && e.open) sfx.startLoop(`capacitor:${e.index}`);
    }
    this.taunts.fire("room_enter", { roomId });
    const trackId = this.roomRt.room.track ?? this.content.game.audio.defaultTrackId;
    const track = this.content.tracks.find((t) => t.id === trackId);
    music.play(track?.id, track?.dataUrl);
  }

  private nextRoomId(): string | null {
    const order = this.content.campaign.rooms;
    const i = order.indexOf(this.currentRoomId);
    return i >= 0 && i + 1 < order.length ? order[i + 1] : null;
  }

  private floaty(text: string, x: number, y: number, color = "#ffd166"): void {
    this.floaties.push({ text, x, y, bornAt: simNow(), color });
    if (this.floaties.length > 12) this.floaties.shift();
  }

  /** Queue a fanfare card. Cards show one at a time, so a later card's
   *  bornAt starts after the queue ahead of it finishes. A card identical
   *  to one still pending/showing is dropped — hoovering up a pile of
   *  death-scattered scrap should read as one GOT card, not five. */
  private pushToast(itemId: string, title: string, subtitle: string, accent: string): void {
    if (this.toasts.some((t) => t.itemId === itemId && t.title === title)) return;
    const last = this.toasts[this.toasts.length - 1];
    const bornAt = Math.max(simNow(), last ? last.bornAt + TOAST_MS : 0);
    this.toasts.push({ itemId, title, subtitle, accent, bornAt });
    if (this.toasts.length > 6) this.toasts.shift();
  }

  /** Walk-over pickup fanfare: toast + a louder burst than the old one —
   *  playtesters were grabbing items without ever noticing (Sean, 8/11). */
  private pickupFanfare(item: ItemDef, count: number, x: number, y: number): void {
    const kindLabel: Record<string, string> = {
      material: "crafting material", tool: "tool", consumable: "gadget", curio: "curio",
    };
    const name = count > 1 ? `${item.name} ×${count}` : item.name;
    this.pushToast(item.id, `GOT: ${name.toUpperCase()}`, kindLabel[item.kind] ?? item.kind, item.color);
    this.particles.burst({
      x, y, count: 16, color: item.color, speed: 110, upBias: 60, life: 0.55, gravity: 100,
    });
  }

  /** Fire a CRAFT READY toast on the false→true edge of "this known,
   *  never-yet-crafted recipe's ingredients are all on hand". Runs every
   *  sim step so it catches every gain path (pickups, drops, converters,
   *  NPC rewards, learning a recipe while already holding the parts).
   *  craftedRecipes gates repeat-spam: once you've built one, regathering
   *  its materials is routine, not news. */
  private checkCraftReady(): void {
    for (const r of this.content.recipes) {
      if (!this.state.knownRecipes.has(r.id) || this.state.craftedRecipes.has(r.id)) {
        this.wasCraftable.delete(r.id);
        continue;
      }
      const need = new Map<string, number>();
      for (const id of r.inputs) need.set(id, (need.get(id) ?? 0) + 1);
      let ok = true;
      for (const [id, n] of need) if (!this.state.has(id, n)) { ok = false; break; }
      if (ok && !this.wasCraftable.has(r.id)) {
        const out = this.state.item(r.output);
        this.pushToast(
          r.output,
          "CRAFT READY",
          `${out?.name ?? r.output} — press ${this.input.label("craft")}`,
          "#ffd166"
        );
        sfx.play("discover");
      }
      if (ok) this.wasCraftable.add(r.id);
      else this.wasCraftable.delete(r.id);
    }
  }

  // ================= UPDATE =================

  private update(dt: number): void {
    // The deterministic-replay backbone: one fixed step per update, counted
    // and clocked in sim time. All recorded input is tagged by stepCount, so
    // a replay that applies the same events before the same step numbers
    // reproduces the run exactly.
    this.stepCount++;
    this.simTime += dt * 1000;
    setSimTime(this.simTime);
    if (this.hitStopClock.tick()) return; // frozen beat — stepCount above already advanced
    if (!this.replay) this.input.pollGamepads(); // replays never read real pads
    if (this.input.consumeActivity()) this.lastInputSim = this.simTime;
    this.animT += dt;
    this.camera.update(dt);
    this.particles.update(dt);
    this.floaties = this.floaties.filter((f) => simNow() - f.bornAt < 1100);

    switch (this.scene) {
      case "menu": this.updateMenu(); break;
      case "play": this.updatePlay(dt); break;
      case "win": this.updateWin(); break;
    }
    this.input.endFrame();
    if (!this.replay && this.scene === "play" && this.stepCount % HEARTBEAT_STEPS === 0) {
      recorder.recordHeartbeat(this.captureHeartbeat());
    }
  }

  /** Advance exactly one fixed sim step — the replay driver's clock tick. */
  stepOnce(): void {
    this.update(1 / 60);
  }

  private hitStop(ms: number): void {
    this.hitStopClock.trigger(ms);
  }

  /** Replay driver: re-apply a recorded semantic craft-menu action. */
  applyCraftOp(op: CraftOp): void {
    if (op.op === "close") {
      this.craftUI.hide();
      this.overlay = "none";
    } else {
      this.craftUI.applyPointerOp(op, this.state);
    }
  }

  /** Draw the current state — replay driver calls this per display frame. */
  renderOnce(): void {
    this.render();
  }

  private updateMenu(): void {
    if (this.menuMode === "levels") {
      const rooms = this.content.campaign.rooms;
      if (this.input.navUp) {
        this.levelSel = (this.levelSel + rooms.length - 1) % rooms.length;
        sfx.play("uiMove");
      }
      if (this.input.navDown) {
        this.levelSel = (this.levelSel + 1) % rooms.length;
        sfx.play("uiMove");
      }
      if (this.input.confirmPressed) {
        sfx.play("uiSelect");
        this.newRun(rooms[this.levelSel]);
        return;
      }
      if (this.input.pausePressed || this.input.justPressed("Backspace", "KeyL", "GpUse")) {
        this.menuMode = "main";
      }
      return;
    }
    if (this.input.justPressed("KeyL", "GpCraft")) {
      sfx.play("uiMove");
      this.menuMode = "levels";
      return;
    }
    if (this.input.confirmPressed) {
      sfx.play("uiSelect");
      this.newRun();
    }
  }

  private updateWin(): void {
    this.taunts.update();
    if (simNow() - this.winShownAt > 1200 && this.input.confirmPressed) {
      this.scene = "menu";
    }
  }

  private updatePlay(dt: number): void {
    this.taunts.update();
    this.emitTorchEmbers(dt);
    this.checkCraftReady();
    while (this.toasts.length && simNow() - this.toasts[0].bornAt > TOAST_MS) {
      this.toasts.shift();
    }

    // ---- Overlays swallow input ----
    if (this.overlay !== "none") this.throwChargeSince = null; // no surprise lobs
    if (this.overlay === "craft") {
      if (this.input.craftPressed || this.input.pausePressed) {
        this.craftUI.hide();
        this.overlay = "none";
      } else {
        this.craftUI.update(this.input, this.state);
      }
      return;
    }
    if (this.overlay === "note" || this.overlay === "dialog") {
      if (this.input.confirmPressed || this.input.pausePressed) this.overlay = "none";
      return;
    }
    if (this.overlay === "npcConfirm") {
      if (this.input.confirmPressed && this.overlayEntity) {
        this.overlay = "none";
        this.giveNpc(this.overlayEntity);
      } else if (this.input.pausePressed || this.input.justPressed("Backspace", "GpUse")) {
        this.overlay = "none";
      }
      return;
    }
    if (this.overlay === "report") {
      return; // the DOM overlay owns input while it's open
    }
    if (this.overlay === "pause") {
      if (this.input.justPressed("KeyR", "GpCraft")) {
        this.overlay = "report";
        this.openReportUI();
        return;
      }
      if (this.input.justPressed("KeyX")) {
        this.confirmResetRoom();
        return;
      }
      if (this.input.pausePressed) this.overlay = "none";
      if (this.input.justPressed("KeyM")) {
        sfx.muted = !sfx.muted;
        music.muted = sfx.muted;
        music.applyVolume();
      }
      if (this.input.justPressed("KeyQ")) {
        this.overlay = "none";
        this.scene = "menu";
        if (!this.replay) recorder.end("quit", this);
      }
      return;
    }
    if (this.input.pausePressed) {
      this.overlay = "pause";
      return;
    }
    if (this.input.craftPressed) {
      this.craftUI.show();
      this.overlay = "craft";
      this.state.hasOpenedCraftUI = true;
      return;
    }

    const g = this.content.game;

    // ---- Player physics ----
    const ev = this.player.update(
      dt, this.input, this.roomRt.map, this.state,
      (tx, ty) => this.roomRt.isEnergized(tx, ty),
    );
    this.pushToyblocks(dt);
    if (ev.jumped) sfx.play("jump");
    if (ev.landed) {
      if (ev.landSpeed > g.juice.landDustAtFallSpeed) {
        sfx.play("land");
        this.particles.burst({
          x: this.player.centerX, y: this.player.feetY,
          count: 6, color: "#6a6284", speed: 50, upBias: 20, life: 0.35, gravity: 240,
        });
      }
      if (ev.landSpeed > 420) this.camera.shake(2.5, 0.15);
    }
    if (ev.bounced) {
      sfx.play("bounce");
      this.particles.burst({
        x: this.player.centerX, y: this.player.feetY,
        count: 10, color: ev.bounced.def.color, speed: 80, upBias: 60, life: 0.4,
      });
    }
    if (ev.spikeDamage > 0) {
      // Repelling hazards report the tile's center so knockback pushes AWAY
      // from it (centerX would always shove rightward — hurt()'s sign(0)||1).
      this.damagePlayer(ev.spikeDamage, ev.repelFromX ?? this.player.centerX, "spikes");
    }

    // ---- Elemental hazards on the player (burning tiles, live charge) ----
    {
      const ptx0 = Math.floor(this.player.x / TILE);
      const ptx1 = Math.floor((this.player.x + this.player.w) / TILE);
      const pty0 = Math.floor(this.player.y / TILE);
      const pty1 = Math.floor((this.player.feetY + 2) / TILE); // include tile underfoot
      let hazard: "burning" | "spark" | null = null;
      for (let ty = pty0; ty <= pty1; ty++) {
        for (let tx = ptx0; tx <= ptx1; tx++) {
          if (this.roomRt.isBurning(tx, ty)) hazard = hazard ?? "burning";
          if (this.roomRt.isEnergized(tx, ty)) hazard = "spark";
        }
      }
      if (hazard && !this.player.invulnerable) {
        if (hazard === "spark") {
          this.state.bump("selfZaps");
          this.checkAchievements("counter");
        }
        this.damagePlayer(1, this.player.centerX, hazard);
      }
      // Carried-item behaviors (doused_in_liquid: standing in water reverts
      // lit torches / quenches carried lava, wherever they sit in the pack).
      for (const [id] of [...this.state.inventory]) {
        const def = this.state.item(id);
        if (!def) continue;
        this.roomRt.bhv.fire("carriedTick", {
          hostDef: def as unknown as Record<string, unknown>,
          hostKey: "item:" + def.id,
          attachments: itemAttachments(def),
          api: { g: this, item: def },
        });
      }
      // Held-item behaviors (passive lighting: ignites_near_fire lights an
      // unlit torch held up to any flame; lights_braziers lets a lit torch
      // light a cold brazier just by walking into it).
      {
        const usable = this.state.usableItems();
        const held = usable[Math.min(this.state.selectedConsumable, usable.length - 1)];
        if (held) {
          this.roomRt.bhv.fire("heldTick", {
            hostDef: held as unknown as Record<string, unknown>,
            hostKey: "item:" + held.id,
            attachments: itemAttachments(held),
            api: { g: this, item: held },
          });
        }
      }
      // First steps on ice (achievement)
      if (!this.state.counters.has("iceWalks") && this.player.onGround) {
        const below = this.roomRt.map.at(
          Math.floor(this.player.centerX / TILE),
          Math.floor((this.player.feetY + 2) / TILE)
        );
        if (below?.slippery) {
          this.state.bump("iceWalks");
          this.checkAchievements("counter");
        }
      }
    }

    // ---- Breath: submerged in deep water drains air, then hearts ----
    {
      const rules = this.content.game.rules;
      const swim = this.player.swimState;
      if (swim === "under") {
        if (this.prevSwim !== "under") {
          this.nextAirLossAt = this.simTime + rules.airLossSeconds * 1000;
          this.nextDrownAt = this.simTime + rules.drownSeconds * 1000;
        }
        if (this.air > 0) {
          if (this.simTime >= this.nextAirLossAt) {
            this.air--;
            this.nextAirLossAt = this.simTime + rules.airLossSeconds * 1000;
            this.nextDrownAt = this.simTime + rules.drownSeconds * 1000;
            this.particles.burst({
              x: this.player.centerX, y: this.player.y,
              count: 5, color: "#7fd8ff", speed: 40, upBias: 50, life: 0.5,
            });
            if (this.air === 0) {
              this.floaty("Out of air!", this.player.centerX, this.player.y - 10, "#7fd8ff");
            }
          }
        } else if (this.simTime >= this.nextDrownAt) {
          // Drowning ignores invuln frames — hit-invulnerability shouldn't
          // buy extra lungs. No knockback either; just the slow bad news.
          this.nextDrownAt = this.simTime + rules.drownSeconds * 1000;
          this.state.health -= 1;
          sfx.play("hurt");
          this.camera.shake(3, 0.2);
          this.particles.burst({
            x: this.player.centerX, y: this.player.y,
            count: 10, color: "#7fd8ff", speed: 60, upBias: 60, life: 0.6,
          });
          this.floaty("Drowning!", this.player.centerX, this.player.y - 10, "#ff5470");
          if (this.state.health <= 0) {
            this.killPlayer();
            return;
          }
        }
      } else if (this.air < rules.airBlips) {
        this.air = rules.airBlips; // surfaced — instant lungful
      }
      this.prevSwim = swim;
    }

    // ---- Smoke bombs in flight: arc, then burst into a veil on impact ----
    if (this.bombs.length > 0) {
      const rules = this.content.game.rules;
      this.bombs = this.bombs.filter((b) => {
        b.vy += this.content.game.player.gravity * 0.8 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const tx = Math.floor(b.x / TILE);
        const ty = Math.floor(b.y / TILE);
        const out = tx < 0 || ty < 0 || tx >= this.roomRt.map.width || ty >= this.roomRt.map.height;
        const hit = !out && this.roomRt.map.at(tx, ty)?.solid;
        if (out) return false;
        if (!hit) return true;
        // Impact: step back out of the wall so the burst centers in open air.
        const cx = b.x - b.vx * dt;
        const cy = b.y - b.vy * dt;
        if (b.itemId === "sticky_bomb") {
          this.roomRt.spreadGoo(cx, cy, rules.stickyBombRadius);
          sfx.play("trap");
          this.camera.shake(2, 0.2);
          this.particles.burst({
            x: cx, y: cy, count: 30, color: "#8bd44f",
            speed: rules.stickyBombRadius * 0.7, life: 0.7, gravity: 60,
          });
        } else {
          this.roomRt.addSmokeCloud(cx, cy, rules.smokeBombRadius, rules.smokeCloudSeconds * 1000);
          sfx.play("stun");
          this.camera.shake(2, 0.2);
          this.particles.burst({
            x: cx, y: cy, count: 40, color: "#aab3c8",
            speed: rules.smokeBombRadius * 0.6, life: 1.1, gravity: -25,
          });
        }
        return false;
      });
    }

    // ---- Placed springs launch whatever falls on them ----
    if (this.player.vy > 40) {
      const prect0 = { x: this.player.x, y: this.player.feetY - 2, w: this.player.w, h: 6 };
      for (const p of this.roomRt.placed) {
        if (p.data.type === "spring" && rectsOverlap(prect0, p)) {
          this.player.vy = -620;
          this.player.squashX = 0.6;
          this.player.squashY = 1.45;
          sfx.play("bounce");
          this.particles.burst({
            x: p.x + p.w / 2, y: p.y,
            count: 10, color: "#5ad1a5", speed: 80, upBias: 60, life: 0.4,
          });
          break;
        }
      }
    }

    // ---- Room simulation (fire spread, charge, enemies) ----
    this.roomRt.update(
      dt,
      {
        centerX: this.player.centerX,
        centerY: this.player.centerY,
        hidden: this.player.hiddenIn !== null,
      },
      this.content.game.rules.stunDurationMs,
      (events) => this.handleElementEvents(events)
    );
    if (!this.player.invulnerable) {
      const prect = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };
      const inSmoke = this.roomRt.smokeAtPoint(this.player.centerX, this.player.centerY);
      for (const en of this.roomRt.enemies) {
        if (en.state === "stunned" || en.state === "trapped") continue;
        // Smoke only fools enemies that hunt by SIGHT (a "sight"-tagged
        // behavior). Blind bodily hazards like crawlers hurt you regardless.
        if (inSmoke && this.roomRt.isSightHunter(en.def)) continue;
        if (rectsOverlap(prect, { x: en.x, y: en.y, w: en.def.width, h: en.def.height })) {
          this.damagePlayer(en.def.damage, en.x + en.def.width / 2, "enemy");
          break;
        }
      }
    }

    // ---- Closed gates block movement ----
    for (const e of this.roomRt.entities) {
      if (e.kind === "door" && e.def.gate && !e.open) {
        const prect = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };
        if (rectsOverlap(prect, e)) {
          if (this.player.centerX < e.x + e.w / 2) this.player.x = e.x - this.player.w - 0.5;
          else this.player.x = e.x + e.w + 0.5;
          this.player.vx = 0;
        }
      }
      // Trapdoors are the vertical counterpart: a closed one blocks
      // up/down passage through its tile instead of sideways passage
      // through a wall gap.
      if (e.kind === "trapdoor" && e.def.gate && !e.open) {
        const prect = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };
        if (rectsOverlap(prect, e)) {
          if (this.player.centerY < e.y + e.h / 2) this.player.y = e.y - this.player.h - 0.5;
          else this.player.y = e.y + e.h + 0.5;
          this.player.vy = 0;
        }
      }
    }

    // ---- Pickups / bundles / checkpoints (walk-over) ----
    const prect = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };
    for (const e of this.roomRt.entities) {
      if (e.kind === "pickup" && !e.collected && rectsOverlap(prect, e)) {
        const item = this.state.item(e.def.item!);
        if (!item) continue;
        e.collected = true;
        this.state.mutations(this.currentRoomId).collected.add(e.index);
        this.state.add(item.id, e.def.count ?? 1);
        if (!this.replay) recorder.recordPickupGain(item.id, e.def.count ?? 1, e.index);
        if (item.useMode) this.switchHotbarSelection(item.id);
        this.checkAchievements("pickup_item", { itemId: item.id });
        if (!this.replay) telemetry.collect(this.currentRoomId, item.id);
        sfx.play("pickup");
        this.floaty(`+${e.def.count ?? 1} ${item.name}`, e.x + e.w / 2, e.y);
        this.pickupFanfare(item, e.def.count ?? 1, e.x + e.w / 2, e.y + e.h / 2);
      }
      if (e.kind === "checkpoint" && !e.open && rectsOverlap(prect, e)) {
        e.open = true;
        this.state.mutations(this.currentRoomId).openedDoors.add(e.index);
        // loadout is deliberately NOT carried here — it's an editor-only
        // "start test from here" / shareable-deep-link convenience, never a
        // real-respawn effect. A real checkpoint touch must have zero impact
        // on what a player is carrying.
        this.state.checkpoint = {
          roomId: this.currentRoomId, x: e.x + e.w / 2, y: e.y + e.h,
        };
        if (this.content.game.rules.healAtCheckpoints) {
          this.state.health = this.state.maxHealth;
        }
        if (!this.replay) {
          recorder.recordAnchor("checkpoint", this.currentRoomId, this.player.centerX, this.player.feetY);
        }
        sfx.play("checkpoint");
        this.floaty("Checkpoint!", e.x + e.w / 2, e.y, "#5ad1a5");
      }
    }
    for (const d of [...this.roomRt.drops]) {
      if (rectsOverlap(prect, d)) {
        this.state.add(d.itemId, d.count);
        if (!this.replay) recorder.recordDropGain(d.itemId, d.count, d.x, d.y);
        const item = this.state.item(d.itemId);
        if (item?.useMode) this.switchHotbarSelection(item.id);
        this.floaty(`+${d.count} ${item?.name ?? d.itemId}`, d.x + 7, d.y);
        if (item) this.pickupFanfare(item, d.count, d.x + 7, d.y + 7);
        this.roomRt.removePickupDrop(d);
        sfx.play("pickup");
      }
    }

    // ---- Interact (E) ----
    if (this.input.interactPressed) this.tryInteract();

    // ---- Usable items (Q cycle, F use) ----
    const usable = this.state.usableItems();
    if (usable.length > 0) {
      if (this.input.cyclePressed) {
        const next = usable[(this.state.selectedConsumable + 1) % usable.length];
        this.switchHotbarSelection(next.id);
        sfx.play("uiMove");
      }
      const held = usable[Math.min(this.state.selectedConsumable, usable.length - 1)];
      if (this.input.usePressed && this.player.hiddenIn === null) {
        if (held.useMode === "burst") {
          // Throwables charge on hold: longer hold = higher trajectory.
          this.throwChargeSince = this.simTime;
        } else {
          this.useItem(held);
        }
      }
      if (this.throwChargeSince !== null) {
        if (held.useMode !== "burst" || this.player.hiddenIn !== null) {
          this.throwChargeSince = null; // cycled away or hid — cancel cleanly
        } else if (!this.input.useHeld) {
          const rules = this.content.game.rules;
          const t = Math.min(1, (this.simTime - this.throwChargeSince) / (rules.throwChargeSeconds * 1000));
          this.throwChargeSince = null;
          this.useItem(held, t); // use_burst's throwSelf reads the charge
        }
      }
    } else {
      this.throwChargeSince = null;
    }

    // ---- Idle taunt, then idle CONSEQUENCES ----
    const idleMs = this.simTime - this.lastInputSim;
    if (idleMs > this.content.game.rules.idleTauntSeconds * 1000) {
      this.taunts.fire("idle");
    }
    if (
      idleMs > this.content.game.rules.idleChaseSeconds * 1000 &&
      !this.warden.active && !this.idleWardenSummoned
    ) {
      this.idleWardenSummoned = true;
      this.warden.spawn(
        "idle",
        this.player.centerX < this.roomRt.map.pixelWidth / 2
          ? this.roomRt.map.pixelWidth - 60 : 8,
        Math.max(16, this.player.y - 40),
        this.content.game.rules.wardenIdleSpeed
      );
      this.taunts.fire("warden_chase");
      sfx.play("death");
    }
    if (idleMs < 1000 && this.warden.active && this.warden.mode === "idle") {
      // Woke up and moving again? He loses interest... slowly drifts off.
      if (this.warden.distanceTo(this.player.centerX, this.player.centerY) > 320) {
        this.warden.dissipate();
      }
    }

    // ---- The Warden ----
    if (this.roomRt.room.wardenChase && !this.warden.active &&
        simNow() > this.wardenSpawnAt) {
      this.warden.spawn(
        "boss",
        this.roomRt.spawnX - 80,
        this.roomRt.spawnY - 60,
        this.roomRt.room.wardenChase.speed
      );
      this.taunts.fire("warden_chase");
      this.camera.shake(5, 0.5);
      sfx.play("death");
    }
    if (this.warden.active) {
      this.warden.update(dt, this.player.centerX, this.player.centerY);
      if (
        this.player.hiddenIn === null && !this.player.invulnerable &&
        this.warden.touching(this.player.centerX, this.player.centerY)
      ) {
        if (this.warden.mode === "boss") {
          this.state.health = 0;
          this.killPlayer();
          this.warden.dissipate();
          this.wardenSpawnAt = simNow() + 1500;
        } else {
          this.damagePlayer(1, this.warden.centerX, "warden");
          this.warden.dissipate();
        }
      }
    }

    // ---- Fell out of the world (shouldn't happen, but be kind) ----
    if (this.player.y > this.roomRt.map.pixelHeight + 80) {
      this.killPlayer();
    }

    // ---- Camera (zoomed view on phones; bias the action up-screen so the
    // player's thumbs cover mostly-floor, not gameplay) ----
    this.camera.follow(
      this.player.centerX,
      this.player.centerY + (this.compact ? 16 : 0),
      this.player.facing,
      VIEW_W / this.worldZoom, VIEW_H / this.worldZoom,
      this.roomRt.map.pixelWidth, this.roomRt.map.pixelHeight
    );

    // ---- Button decoration context (mobile E verb + F item icon) ----
    this.touch.smartContext = this.computeSmartContext();
  }

  /** What would the smart button do right now? */
  private computeSmartContext(): SmartContext {
    if (this.player.hiddenIn !== null) return { kind: "interact", label: "exit" };
    const near = this.roomRt.interactableNear(this.player.centerX, this.player.centerY);
    if (near) {
      const verbs: Record<string, string> = {
        note: "read", door: near.def.gate && !near.open ? "look" : "go",
        trapdoor: near.def.gate && !near.open ? "look" : "go",
        locker: "hide", npc: "talk", exit: "EXIT",
        source: "take", converter: "trade",
      };
      return { kind: "interact", label: verbs[near.kind] ?? "use" };
    }
    if (this.roomRt.placedItemNear(this.player.centerX, this.player.centerY)) {
      return { kind: "interact", label: "take" };
    }
    const items = this.state.usableItems();
    const held = items[Math.min(this.state.selectedConsumable, items.length - 1)];
    if (held) return { kind: "use", label: "use", item: held };
    return { kind: "none", label: "" };
  }

  private tryInteract(): void {
    // Exit locker first if hiding
    if (this.player.hiddenIn !== null) {
      const locker = this.roomRt.entities.find((e) => e.index === this.player.hiddenIn);
      if (locker) {
        locker.occupied = false;
        this.player.placeFeetAt(locker.x + locker.w / 2, locker.y + locker.h);
      }
      this.player.hiddenIn = null;
      sfx.play("hide");
      return;
    }
    const e = this.roomRt.interactableNear(this.player.centerX, this.player.centerY);
    if (!e) {
      // Reclaim a placed item (spring or trap) — always reclaimable, so a
      // placed item never strands a run just because the level needs it
      // picked up and moved elsewhere.
      const placed = this.roomRt.placedItemNear(this.player.centerX, this.player.centerY);
      if (placed) {
        const item = this.content.items.find((i) => i.placeType === placed.data.type);
        this.roomRt.removePlaced(placed);
        if (item) {
          this.state.add(item.id);
          if (item.id === "spring") {
            this.state.bump("springReclaims");
            this.checkAchievements("counter");
          }
          sfx.play("pickup");
          this.floaty(`+1 ${item.name}`, placed.x + placed.w / 2, placed.y);
        }
      }
      return;
    }
    switch (e.kind) {
      case "note": {
        this.overlayEntity = e;
        this.overlayTitle = "A note from a previous subject";
        this.overlayText = e.def.text ?? "(the writing is illegible)";
        this.overlay = "note";
        const noteKey = `${this.currentRoomId}:${e.index}`;
        if (!this.state.readNotes.has(noteKey)) {
          this.state.readNotes.add(noteKey);
          this.state.bump("notesRead");
          this.checkAchievements("counter");
        }
        if (e.def.recipe && !this.state.knownRecipes.has(e.def.recipe)) {
          this.state.knownRecipes.add(e.def.recipe);
          this.state.stats.discoveries++;
          sfx.play("discover");
          this.floaty("Recipe learned!", e.x + e.w / 2, e.y, "#9be8b0");
        } else {
          sfx.play("note");
        }
        break;
      }
      case "locker": {
        this.player.hiddenIn = e.index;
        e.occupied = true;
        sfx.play("hide");
        this.taunts.fire("hide_enter");
        break;
      }
      case "door": case "trapdoor": this.useDoor(e); break;
      case "npc": this.talkToNpc(e); break;
      case "exit": this.winGame(); break;
      case "source": this.grabSource(e); break;
      case "converter": this.tradeConverter(e); break;
    }
  }

  private grabSource(e: EntityInstance): void {
    const item = this.content.items.find((i) => i.id === e.def.sourceItem);
    if (!item) return;
    if (!this.roomRt.grabFromSource(e)) {
      sfx.play("locked");
      this.floaty("Empty", e.x + e.w / 2, e.y, "#c98a8a");
      return;
    }
    this.state.add(item.id);
    sfx.play("pickup");
    this.floaty(`+1 ${item.name}`, e.x + e.w / 2, e.y);
  }

  private tradeConverter(e: EntityInstance): void {
    const inItem = this.content.items.find((i) => i.id === e.def.convertInput);
    const outItem = this.content.items.find((i) => i.id === e.def.convertOutput);
    if (!inItem || !outItem) return;
    const inCount = e.def.convertInputCount ?? 1;
    const outCount = e.def.convertOutputCount ?? 1;
    if (!this.state.has(inItem.id, inCount)) {
      sfx.play("craftFail");
      this.floaty(`Need ${inCount} ${inItem.name}`, e.x + e.w / 2, e.y, "#c98a8a");
      return;
    }
    this.state.remove(inItem.id, inCount);
    this.state.add(outItem.id, outCount);
    sfx.play("craft");
    this.floaty(`+${outCount} ${outItem.name}`, e.x + e.w / 2, e.y);
  }

  private useDoor(e: EntityInstance): void {
    if (e.def.gate && !e.open) {
      sfx.play("locked");
      this.floaty(
        (e.def.openFuseId ?? e.def.fuseId) ? "Dead. Needs power." : "Sealed shut.",
        e.x + e.w / 2, e.y, "#e8a2b4"
      );
      return;
    }
    if (e.def.gate) return; // opened gates are just passable
    const target = e.def.to === "next" || !e.def.to ? this.nextRoomId() : e.def.to;
    if (target) {
      sfx.play("door");
      if (!this.replay) telemetry.roomComplete(this.currentRoomId, Date.now() - this.roomEnteredAt);
      // The Warden confiscates your belongings between wings. Knowledge stays.
      if (
        this.content.game.rules.resetInventoryBetweenRooms &&
        this.state.inventory.size > 0
      ) {
        this.state.inventory.clear();
        this.state.selectedConsumable = 0;
        this.taunts.fire("confiscate");
      }
      this.loadRoom(target);
      this.state.checkpoint = {
        roomId: target, x: this.roomRt.spawnX, y: this.roomRt.spawnY,
      };
      if (this.content.game.rules.resetInventoryBetweenRooms) {
        this.floaty("Belongings confiscated.", this.player.centerX, this.player.y - 12, "#e8a2b4");
      }
    }
  }

  private talkToNpc(e: EntityInstance): void {
    const d = e.def;
    this.overlayEntity = e;
    this.overlayTitle = d.name ?? "Prisoner";
    sfx.play("npc");
    if (e.helped) {
      this.overlayText = d.dialogAfter ?? "...";
      this.overlay = "dialog";
      return;
    }
    const wants = d.wants;
    if (wants && this.state.has(wants.item, wants.count)) {
      // They can SEE you have it — confirm before handing it over.
      const itemName = this.state.item(wants.item)?.name ?? wants.item;
      this.overlayText =
        d.dialogConfirm ?? `Is that... a ${itemName}? It IS. Hand it over?`;
      this.overlay = "npcConfirm";
    } else {
      this.overlayText = d.dialogAsk ?? "...";
      this.overlay = "dialog";
    }
  }

  /** The player agreed to the trade. */
  private giveNpc(e: EntityInstance): void {
    const d = e.def;
    const wants = d.wants;
    if (!wants || !this.state.remove(wants.item, wants.count)) return;
    e.helped = true;
    this.state.mutations(this.currentRoomId).helpedNpcs.add(e.index);
    if (d.npcId) this.state.helpedNpcIds.add(d.npcId);
    for (const r of d.rewardItems ?? []) {
      this.state.add(r.item, r.count);
      this.floaty(`+${r.count} ${this.state.item(r.item)?.name ?? r.item}`, e.x + e.w / 2, e.y);
    }
    for (const rid of d.rewardRecipes ?? []) {
      if (!this.state.knownRecipes.has(rid)) {
        this.state.knownRecipes.add(rid);
        this.state.stats.discoveries++;
      }
    }
    this.overlayEntity = e;
    this.overlayTitle = d.name ?? "Prisoner";
    this.overlayText = d.dialogDone ?? "Thanks!";
    this.overlay = "dialog";
    sfx.play("discover");
    this.taunts.fire("npc_help");
    this.checkAchievements("npc_help");
  }

  private lastSwingAt = 0;

  /** Switch the held hotbar item, snuffing out anything that only stays lit while held. */
  private switchHotbarSelection(targetId: string): void {
    const usable = this.state.usableItems();
    const current = usable[this.state.selectedConsumable];
    if (current && current.id !== targetId && current.douseOnDeselect && current.dousesTo) {
      this.state.transform(current.id, current.dousesTo);
      sfx.play("splash");
      this.floaty("Torch snuffed out.", this.player.centerX, this.player.y - 8, "#8f87ad");
    }
    const after = this.state.usableItems();
    const idx = after.findIndex((i) => i.id === targetId);
    this.state.selectedConsumable = idx >= 0 ? idx : 0;
  }

  // ================= ACHIEVEMENTS =================

  /** Evaluate achievement triggers against the current run state. */
  checkAchievements(
    trigger: string,
    ctx: { itemId?: string } = {}
  ): void {
    if (!this.state) return;
    for (const a of this.content.achievements) {
      if (this.state.earned.has(a.id) || a.trigger !== trigger) continue;
      if (a.itemId && a.itemId !== ctx.itemId) continue;
      if (a.trigger === "counter") {
        const v = this.state.counters.get(a.counter ?? "") ?? 0;
        if (v < (a.count ?? 1)) continue;
      }
      if (a.trigger === "win") {
        if (a.maxDeaths !== undefined && this.state.stats.deaths > a.maxDeaths) continue;
        if (a.maxSeconds !== undefined && this.finishedInMs / 1000 > a.maxSeconds) continue;
      }
      this.earnAchievement(a.id);
    }
  }

  private earnAchievement(id: string): void {
    const a = this.content.achievements.find((x) => x.id === id);
    if (!a || this.state.earned.has(id)) return;
    this.state.earned.add(id);
    sfx.play("discover");
    this.tip(`★ ${a.name}`);
    this.taunts.queueLine(a.wardenLine, a.emotion);
  }

  /** Visual/audio feedback for elemental happenings, wherever they come from. */
  private handleElementEvents(events: ElementEvent[]): void {
    for (const ev of events) {
      // Achievement counters ride on the event stream
      if (this.state) {
        if (ev.effect === "ignite") this.state.bump("burns");
        if (ev.effect === "extinguish") this.state.bump("douses");
        if (ev.effect === "enemy_kill" && ev.element === "fire" && ev.enemyId === "crawler") {
          this.state.bump("crawlersCooked");
        }
        if (ev.effect === "enemy_stun" && ev.element === "water" && ev.enemyId === "spotter") {
          this.state.bump("spottersSplashed");
        }
      }
      switch (ev.effect) {
        case "ignite":
          sfx.play("ignite");
          this.particles.burst({ x: ev.x, y: ev.y, count: 8, color: "#ff7043", speed: 60, upBias: 40, life: 0.5, gravity: -60 });
          break;
        case "extinguish":
        case "fizzle":
          sfx.play("splash");
          this.particles.burst({ x: ev.x, y: ev.y, count: 10, color: "#cfd8dc", speed: 50, upBias: 50, life: 0.6, gravity: -80 });
          break;
        case "melt":
        case "dissolve":
          sfx.play("splash");
          this.particles.burst({ x: ev.x, y: ev.y, count: 10, color: ev.color, speed: 70, life: 0.5 });
          break;
        case "freeze":
          sfx.play("freeze");
          this.particles.burst({ x: ev.x, y: ev.y, count: 12, color: "#b3e5fc", speed: 60, life: 0.5, gravity: 40 });
          break;
        case "shatter":
          sfx.play("break");
          this.camera.shake(3, 0.2);
          this.hitStop(this.content.game.juice.hitStopMs * 0.6);
          this.particles.burst({ x: ev.x, y: ev.y, count: 14, color: ev.color, speed: 120, life: 0.55 });
          break;
        case "energize":
          this.particles.burst({ x: ev.x, y: ev.y, count: 2, color: "#ffe95a", speed: 40, life: 0.25, gravity: 0 });
          break;
        case "capacitorOn":
          // A quiet ambient hum while it's live, not the fusebox's clink —
          // keyed by entity index so each capacitor gets its own loop.
          sfx.startLoop(`capacitor:${ev.entityIndex}`);
          this.particles.burst({ x: ev.x, y: ev.y, count: 10, color: "#ffe95a", speed: 70, life: 0.4 });
          break;
        case "capacitorOff":
          sfx.stopLoop(`capacitor:${ev.entityIndex}`);
          this.particles.burst({ x: ev.x, y: ev.y, count: 6, color: "#8f9bb3", speed: 50, life: 0.35 });
          break;
        case "fuse":
          sfx.play("unlock");
          this.camera.shake(2, 0.15);
          this.particles.burst({ x: ev.x, y: ev.y, count: 14, color: "#ffe95a", speed: 90, life: 0.5 });
          this.floaty("CLUNK.", ev.x, ev.y - 6, "#9be8b0");
          break;
        case "enemy_kill":
          sfx.play("death");
          this.camera.shake(3, 0.2);
          this.particles.burst({ x: ev.x, y: ev.y, count: 20, color: ev.color, speed: 140, upBias: 50, life: 0.6 });
          break;
        case "enemy_stun":
          sfx.play("stun");
          this.particles.burst({ x: ev.x, y: ev.y, count: 8, color: ev.color, speed: 70, life: 0.4 });
          break;
        case "burnout":
          this.particles.burst({ x: ev.x, y: ev.y, count: 6, color: "#5a5470", speed: 40, upBias: 30, life: 0.6, gravity: -40 });
          break;
        case "flow":
          this.particles.burst({ x: ev.x, y: ev.y, count: 3, color: "#4fc3f7", speed: 25, life: 0.35, gravity: 20 });
          break;
      }
    }
    this.checkAchievements("counter");
  }

  /** Walking into a toyblock leans on it; RoomRuntime.pushToyblock tracks
   *  the sustained-contact timer and hops it one grid tile over once it's
   *  crossed the threshold. */
  private pushToyblocks(dt: number): void {
    const want = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    if (want === 0) { this.roomRt.resetToyblockPush(); return; }
    const p = this.player;
    const dir = want as -1 | 1;
    const edgeX = dir > 0 ? p.x + p.w : p.x - 1;
    const tx = Math.floor(edgeX / TILE);
    const ty0 = Math.floor(p.y / TILE);
    const ty1 = Math.floor((p.feetY - 1) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (this.roomRt.pushToyblock(tx, ty, dir, dt)) break;
    }
  }

  /** At least two distinct materials on hand, or one useful pickup —
   *  enough that opening the craft screen would actually show something. */
  private hasEnoughToCraftPrompt(): boolean {
    let distinctMaterials = 0;
    for (const [id, n] of this.state.inventory) {
      if (n <= 0) continue;
      if (this.state.item(id)?.kind === "material") distinctMaterials++;
    }
    return distinctMaterials >= 2;
  }

  /** Balloons pop from any tool's use box — pure whimsy, not an elemental
   *  rule, so it runs independent of (and alongside) whatever else the
   *  swing/splash does. */
  private popBalloons(box: { x: number; y: number; w: number; h: number }): void {
    const popped = this.roomRt.popBalloonsIn(box);
    for (const p of popped) {
      sfx.play("break");
      this.particles.burst({
        x: p.x, y: p.y, count: 10, color: "#e86a8a", speed: 90, upBias: 30, life: 0.4,
      });
    }
  }

  /** Use the held item: dispatches the "use" trigger through its behavior
   *  attachments (use_swing / use_splash / use_place / use_burst docs in
   *  behaviors.json, or anything custom). `charge` only matters to
   *  throwables (0 = tap, 1 = full hold). */
  private useItem(item: ItemDef, charge = 0): void {
    this.roomRt.bhv.fire("use", {
      hostDef: item as unknown as Record<string, unknown>,
      hostKey: "item:" + item.id,
      attachments: itemAttachments(item),
      data: { charge },
      api: { g: this, item },
    });
  }

  /** Launch a throwable at charge `t` (0 = tap, 1 = full). Velocities lerp
   *  from the tap min to the full-charge max per axis, so the tap throw can
   *  keep the classic feel independent of how high a full charge lofts. */
  private throwBomb(item: ItemDef, t: number): void {
    this.state.remove(item.id);
    this.player.swing();
    const v = this.throwVelocityAt(t);
    this.bombs.push({
      x: this.player.centerX, y: this.player.centerY - 4, vx: v.vx, vy: v.vy, itemId: item.id,
    });
    sfx.play("swing");
  }

  private throwVelocityAt(t: number): { vx: number; vy: number } {
    const rules = this.content.game.rules;
    return {
      vx: this.player.facing * (rules.smokeThrowMinVx + (rules.smokeThrowVx - rules.smokeThrowMinVx) * t)
        + this.player.vx * 0.5,
      vy: -(rules.smokeThrowMinVy + (rules.smokeThrowVy - rules.smokeThrowMinVy) * t),
    };
  }

  /** Current throw velocity for the charge preview (render only). */
  private chargedThrowVelocity(): { vx: number; vy: number; t: number } | null {
    if (this.throwChargeSince === null) return null;
    const rules = this.content.game.rules;
    const t = Math.min(1, (this.simTime - this.throwChargeSince) / (rules.throwChargeSeconds * 1000));
    return { ...this.throwVelocityAt(t), t };
  }

  private damagePlayer(amount: number, fromX: number, _source: string): void {
    const g = this.content.game;
    this.state.health -= amount;
    this.player.hurt(fromX, g.player.invulnMs);
    sfx.play("hurt");
    this.camera.shake(4, 0.25);
    this.hitStop(g.juice.hitStopMs);
    this.particles.burst({
      x: this.player.centerX, y: this.player.centerY,
      count: 10, color: "#ff5470", speed: 100, life: 0.4,
    });
    if (this.state.health <= 0) this.killPlayer();
  }

  private killPlayer(): void {
    const g = this.content.game;
    this.state.stats.deaths++;
    sfx.play("death");
    if (!this.replay) {
      telemetry.death(this.currentRoomId);
      recorder.markDeath();
    }
    this.camera.shake(6, 0.4);
    this.particles.burst({
      x: this.player.centerX, y: this.player.centerY,
      count: 24, color: g.player.color, speed: 160, upBias: 60, life: 0.7,
    });
    if (g.rules.dropMaterialsOnDeath) {
      const dropped = this.state.takeAllMaterials();
      if (dropped.length > 0) {
        this.roomRt.scatterItems(this.player.centerX, this.player.feetY, dropped);
        this.floaty("Materials dropped!", this.player.centerX, this.player.y - 10, "#e8a2b4");
      }
    }
    // Equipped items reset too — a lit torch goes back out, a full/lava
    // bucket goes back to empty (any item with dousesTo/emptiesTo).
    const selectedId = this.state.usableItems()[this.state.selectedConsumable]?.id;
    const resetIds = this.state.resetTransformedItems();
    if (resetIds.length > 0) {
      this.floaty("Equipment reset.", this.player.centerX, this.player.y - 24, "#8f87ad");
      if (selectedId && resetIds.includes(selectedId)) {
        const def = this.state.item(selectedId);
        const resetTo = def?.dousesTo ?? def?.emptiesTo;
        const idx = this.state.usableItems().findIndex((i) => i.id === resetTo);
        if (idx >= 0) this.state.selectedConsumable = idx;
      }
    }
    if (this.state.hasDiedOnce) {
      this.taunts.fire("death");
    } else {
      this.state.hasDiedOnce = true;
      this.taunts.fire("first_death");
    }
    const cp = this.state.checkpoint;
    if (cp.roomId !== this.currentRoomId) {
      this.loadRoom(cp.roomId);
    }
    if (!this.replay) recorder.recordAnchor("death", cp.roomId, cp.x, cp.y);
    this.respawnAt(cp.x, cp.y, cp.loadout);
  }

  /** Position + health/air/inventory/enemy reset for a respawn — shared by
   *  a live death (killPlayer, above) and a replay forcing a recorded death
   *  its own simulation didn't (or doesn't yet) agree happened, see
   *  forceRespawn below. Fresh lungs too, else a checkpoint inside water
   *  (flooded rooms make that possible) re-drowns you instantly on an
   *  empty meter. */
  private respawnAt(x: number, y: number, loadout?: { item: string; count: number }[]): void {
    this.state.health = this.state.maxHealth;
    this.air = this.content.game.rules.airBlips;
    this.prevSwim = "none";
    this.player.placeFeetAt(x, y);
    if (this.state.applyLoadout(loadout)) {
      this.floaty("Reloaded for this area.", this.player.centerX, this.player.y - 24, "#7fd8e8");
    }
    this.player.invulnUntil = simNow() + this.content.game.rules.respawnInvulnMs;
    this.player.hiddenIn = null;
    this.bombs = [];
    this.roomRt.resetEnemies();
  }

  /** Replay driver: force the current room to match a recorded anchor's
   *  room, if it doesn't already — a room transition that failed to fire in
   *  replay is a real failure mode (the player never left the previous
   *  room), not just position drift, and applying an anchor's x/y straight
   *  into the wrong room's coordinate space is actively harmful. */
  forceRoom(room: string): void {
    if (room !== this.currentRoomId) this.loadRoom(room);
  }

  /** Replay driver: a recorded "death" anchor says a death definitely
   *  happened here live — force the full respawn unconditionally, even if
   *  this replay's own simulation hasn't independently reached zero health
   *  (whatever caused that disagreement already broke its own ability to
   *  self-report correctly, so don't trust it to catch up on its own). */
  forceRespawn(room: string, x: number, y: number): void {
    this.forceRoom(room);
    this.respawnAt(x, y, this.state.checkpoint.loadout);
  }

  /** Replay driver: a recorded item gain definitely happened here live —
   *  force it in if this replay's own walk-over detection hasn't already
   *  collected the same source. Idempotent: a no-op when it has (the static
   *  pickup is already marked collected, or the matching drop is already
   *  gone), so it's safe to always call at the recorded step. Returns
   *  whether a correction actually happened, for the replay's resync log. */
  forceItemGain(
    itemId: string, count: number, src: "pickup" | "drop", idx?: number, x?: number, y?: number
  ): boolean {
    if (src === "pickup" && idx !== undefined) {
      const e = this.roomRt.entities.find((en) => en.kind === "pickup" && en.index === idx);
      if (!e || e.collected) return false;
      e.collected = true;
      this.state.mutations(this.currentRoomId).collected.add(idx);
      this.state.add(itemId, count);
      return true;
    }
    if (src === "drop" && x !== undefined && y !== undefined) {
      // No stable id for a scattered drop — match by item + nearest position.
      let nearest: (typeof this.roomRt.drops)[number] | null = null;
      let bestDist = Infinity;
      for (const d of this.roomRt.drops) {
        if (d.itemId !== itemId) continue;
        const dist = Math.hypot(d.x - x, d.y - y);
        if (dist < bestDist) { bestDist = dist; nearest = d; }
      }
      if (!nearest || bestDist > 24) return false; // already collected, or none close enough
      this.state.add(itemId, count);
      this.roomRt.removePickupDrop(nearest);
      return true;
    }
    return false;
  }

  /** Full ground-truth state capture — see recorder.ts's Heartbeat. */
  captureHeartbeat(): Heartbeat {
    return {
      room: this.currentRoomId,
      player: this.player.snapshot(),
      state: this.state.snapshot(),
      enemies: this.roomRt.snapshotEnemies(),
      fluid: this.roomRt.snapshotFluidRuntime(),
    };
  }

  /** Replay driver: periodic full resync to a recorded heartbeat, applied
   *  unconditionally regardless of whether this replay's own simulation
   *  still agrees — a cheap "is it already right" check would just be
   *  re-deriving the same trust heartbeats exist to not rely on. Only a
   *  genuine room change goes through loadRoom's full transition side
   *  effects (taunts, warden reset, camera snap) — staying in the same
   *  room just rebuilds entities/tiles from the (now-corrected) mutation
   *  record bare, or those side effects would fire every heartbeat. */
  applyHeartbeat(hb: Heartbeat): void {
    this.state.restore(hb.state);
    if (hb.room !== this.currentRoomId) this.loadRoom(hb.room);
    else this.rebuildRoom(hb.room);
    this.roomRt.restoreEnemies(hb.enemies);
    this.roomRt.restoreFluidRuntime(hb.fluid);
    this.player.restore(hb.player);
  }

  private winGame(): void {
    if (!this.replay) {
      telemetry.roomComplete(this.currentRoomId, Date.now() - this.roomEnteredAt);
      telemetry.event("game_win");
      recorder.end("win", this);
    }
    this.finishedInMs = simNow() - this.state.stats.startedAt;
    this.scene = "win";
    this.winShownAt = simNow();
    sfx.play("win");
    this.taunts.fire("win");
    this.checkAchievements("win");
  }

  // ================= RENDER =================

  private render(): void {
    setSimTime(this.simTime);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0d0b14"; // letterbox
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(this.viewScale, 0, 0, this.viewScale, this.viewOx, this.viewOy);
    // Clip to the logical view so nothing bleeds into the letterbox
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();
    this.renderScene(ctx);
    // Portrait phone? The game is landscape — say so.
    if (ctx.canvas.height > ctx.canvas.width) {
      TouchControls.drawRotateHint(ctx, VIEW_W, VIEW_H);
    }
    ctx.restore();
    // Touch buttons live in raw screen-pixel space (may sit in the letterbox
    // margins outside the logical 640x360 view) — reset to identity first,
    // since restore() only rewinds to the post-viewTransform save point.
    if (
      this.scene === "play" && this.overlay === "none" &&
      this.input.scheme === "touch"
    ) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.touch.draw(ctx);
    }
    // The craft workbench also lives in raw canvas-pixel space (full-bleed and
    // physically large on phones), drawn over the dimmed, still-clipped scene.
    if (this.scene === "play" && this.overlay === "craft") {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.craftUI.draw(ctx, this.state, ctx.canvas.width, ctx.canvas.height);
    }
  }

  private renderScene(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#0d0b14";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    if (this.scene === "menu") {
      this.renderMenu(ctx);
      return;
    }
    if (this.scene === "win") {
      this.renderWin(ctx);
      return;
    }

    // World (magnified on compact screens)
    const zoom = this.worldZoom;
    const vw = VIEW_W / zoom;
    const vh = VIEW_H / zoom;
    const camX = Math.round(this.camera.x + this.camera.offsetX);
    const camY = Math.round(this.camera.y + this.camera.offsetY);
    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);
    drawBackdrop(ctx, this.roomRt.room.background, camX, camY, vw, vh);
    drawMap(ctx, this.roomRt.map, camX, camY, vw, vh, this.animT);
    this.roomRt.resolveHintText = (raw) => raw.replace(
      /\{(move|jump|craft|use|interact|cycle|start)\}/g,
      (_, tok) => this.input.label(tok)
    );
    this.roomRt.draw(ctx, this.animT);
    // Charging a throw: dotted arc preview that rises as the charge builds.
    const charge = this.chargedThrowVelocity();
    if (charge) {
      let px = this.player.centerX, py = this.player.centerY - 4;
      let { vx, vy } = charge;
      const step = 0.07;
      ctx.fillStyle = `rgba(232,226,244,${0.5 + charge.t * 0.3})`;
      for (let i = 0; i < 9; i++) {
        vy += this.content.game.player.gravity * 0.8 * step;
        px += vx * step;
        py += vy * step;
        const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
        if (this.roomRt.map.at(tx, ty)?.solid) break;
        ctx.beginPath();
        ctx.arc(px, py, 1.6 - i * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Bombs in flight, under the player so a close throw reads right.
    for (const b of this.bombs) {
      ctx.fillStyle = "#8f9bb3";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5a6378";
      ctx.fillRect(b.x - 1, b.y - 5, 2, 2.4);
    }
    if (this.roomRt.smokeAtPoint(this.player.centerX, this.player.centerY)) {
      // Half-faded inside the veil: "they can't see me here" at a glance.
      ctx.globalAlpha = 0.45;
      this.player.draw(ctx);
      this.drawHeldItem(ctx);
      ctx.globalAlpha = 1;
    } else {
      this.player.draw(ctx);
      this.drawHeldItem(ctx);
    }
    this.warden.draw(ctx, this.content.game.antagonist, this.animT);
    this.particles.draw(ctx);
    drawFloaties(ctx, this.floaties);
    // Interaction prompt
    if (this.overlay === "none") {
      const iKey = this.input.label("interact");
      if (this.player.hiddenIn !== null) {
        drawPrompt(ctx, `${iKey} — leave locker`, this.player.centerX, this.player.y - 26);
      } else {
        const near = this.roomRt.interactableNear(this.player.centerX, this.player.centerY);
        if (near) {
          const verbs: Record<string, string> = {
            note: "read", door: near.def.gate && !near.open ? "inspect" : "open",
            trapdoor: near.def.gate && !near.open ? "inspect" : "open",
            locker: "hide", npc: "talk", exit: "ESCAPE",
            source: "take", converter: "trade",
          };
          drawPrompt(ctx, `${iKey} — ${verbs[near.kind] ?? "use"}`, near.x + near.w / 2, near.y - 6);
        } else {
          const placed = this.roomRt.placedItemNear(this.player.centerX, this.player.centerY);
          if (placed) {
            const item = this.content.items.find((i) => i.placeType === placed.data.type);
            drawPrompt(ctx, `${iKey} — take ${item?.name ?? placed.data.type}`, placed.x + placed.w / 2, placed.y - 10);
          } else if (!this.state.hasOpenedCraftUI && this.hasEnoughToCraftPrompt()) {
            // Nobody's told the player Tab exists yet, and they've now got
            // something to actually do with it — nudge until they open it
            // once. Two testers never found the craft screen on their own.
            drawPrompt(ctx, `${this.input.label("craft")} — check what you're carrying`, this.player.centerX, this.player.y - 26);
          }
        }
      }
    }
    ctx.restore();

    // Room name watermark
    ctx.fillStyle = "rgba(232,226,244,0.28)";
    ctx.font = "bold 9px monospace";
    ctx.fillText(this.roomRt.room.name.toUpperCase(), 12, VIEW_H - 8);

    // HUD (touch-critical elements scale up on compact touch screens)
    const hud = this.content.game.hud;
    const uiScale = this.uiScale();
    drawHearts(ctx, this.state.health, this.state.maxHealth, hud, uiScale);
    if (this.player.swimState === "under" || this.air < this.content.game.rules.airBlips) {
      drawAir(ctx, this.air, this.content.game.rules.airBlips, hud, uiScale);
    }
    if (this.player.climbState !== "none") {
      const climbCfg = this.content.game.player.climb;
      const maxTime = this.player.climbState === "wall" ? climbCfg.wallSeconds : climbCfg.ceilingSeconds;
      drawClimbTimer(ctx, this.player.climbTimeLeft, maxTime, hud, uiScale);
    }
    drawToolbelt(ctx, this.state, VIEW_W, hud, uiScale);
    const hotbarHint =
      this.input.scheme === "gamepad" ? "LB/RB cycle · B use" :
      this.input.scheme === "touch" ? "tap a slot to hold it" :
      "Q cycle · F use";
    drawHotbar(ctx, this.state, VIEW_H, hud, hotbarHint, uiScale);
    drawTauntBanner(ctx, this.taunts, this.content.game.antagonist, VIEW_W, hud.bannerTopOffset);
    if (this.toasts.length > 0) {
      // Below the taunt banner when one's up, else in its spot.
      const toastY = this.taunts.active ? hud.bannerTopOffset + 50 : hud.bannerTopOffset;
      const toast = this.toasts[0];
      const item = this.state.item(toast.itemId);
      drawToast(ctx, toast, VIEW_W, toastY, (c, cx, cy, s) => {
        if (item) drawItemIcon(c, item, cx, cy, s);
      });
    }
    if (this.warden.active) {
      this.warden.drawVignette(
        ctx, VIEW_W, VIEW_H,
        this.warden.distanceTo(this.player.centerX, this.player.centerY)
      );
    }
    this.drawTip(ctx);

    // Overlays. The craft workbench is drawn later in render() in raw
    // canvas-pixel space (so it can be physically large on phones); the rest
    // stay in the logical 640x360 view.
    if (this.overlay === "note" || this.overlay === "dialog" || this.overlay === "npcConfirm") {
      const isNpc = this.overlay !== "note" && this.overlayEntity?.kind === "npc";
      // A note's recipe reward used to only flash a fleeting "Recipe
      // learned!" floaty — easy to miss, and said nothing about WHICH
      // recipe. Name it directly in the note's own footer instead, visible
      // the whole time it's open (and on every re-read, as a reminder).
      const noteRecipeId = this.overlay === "note" ? this.overlayEntity?.def.recipe : undefined;
      const noteRecipe = noteRecipeId ? this.content.recipes.find((r) => r.id === noteRecipeId) : undefined;
      const noteOutput = noteRecipe ? this.state.item(noteRecipe.output) : undefined;
      this.confirmButtons = drawTextOverlay(ctx, {
        title: this.overlayTitle,
        titleColor: this.overlay === "note" ? "#c9a86a" : "#7fd8e8",
        body: this.overlayText,
        footer: noteOutput
          ? `Recipe: ${noteOutput.name}  ·  ${this.input.label("interact")} / Enter — close`
          : this.overlay === "npcConfirm"
            ? `${this.input.label("interact")} — give · Esc — keep it`
            : `${this.input.label("interact")} / Enter — close`,
        viewW: VIEW_W, viewH: VIEW_H,
        portrait: isNpc ? this.npcPortrait(this.overlayEntity!) : undefined,
        buttons:
          this.overlay === "npcConfirm"
            ? [
                { label: "Hand it over", action: "give", primary: true },
                { label: "Keep it", action: "keep" },
              ]
            : undefined,
      });
    } else if (this.overlay === "pause") {
      const scheme = this.input.scheme;
      const resumeHint = scheme === "touch" ? "tap here — resume" : "Esc — resume";
      ctx.fillStyle = "rgba(8,6,14,0.75)";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = "#e8e2f4";
      ctx.font = "bold 16px monospace";
      ctx.fillText("PAUSED", VIEW_W / 2 - 30, 110);
      ctx.font = "10px monospace";
      ctx.fillStyle = "#bbb3d6";
      ctx.fillText(resumeHint, VIEW_W / 2 - 70, 140);
      ctx.fillText(`${scheme === "touch" ? "tap" : "M"} — sound ${sfx.muted ? "ON" : "OFF"}`, VIEW_W / 2 - 70, 156);
      ctx.fillText(`${scheme === "touch" ? "tap" : "Q"} — quit to menu`, VIEW_W / 2 - 70, 172);
      ctx.fillStyle = "#9be8b0";
      ctx.fillText(`${scheme === "touch" ? "tap" : "R"} — report an issue`, VIEW_W / 2 - 70, 188);
      ctx.fillStyle = "#e8a2b4";
      ctx.fillText(`${scheme === "touch" ? "tap" : "X"} — reset this room (if stuck)`, VIEW_W / 2 - 70, 204);
      ctx.fillStyle = "#8f87ad";
      ctx.fillText("CONTROLS", VIEW_W / 2 - 70, 222);
      const controls = scheme === "touch"
        ? [
            "◀ ▶ .......... move",
            "▲ ............ jump (hold = higher)",
            "▼ ............ drop through platforms",
            "E ............ interact / hide / doors",
            "CRAFT ........ crafting",
            "F ............ use item",
          ]
        : scheme === "gamepad"
        ? [
            "STICK / DPAD . move",
            "A ............ jump (hold = higher)",
            "DOWN ......... drop through platforms",
            "X ............ interact / hide / doors",
            "Y ............ crafting",
            "LB/RB / B .... cycle / use item",
          ]
        : [
            "A/D or ←/→ ... move",
            "SPACE / W ... jump (hold = higher)",
            "S / ↓ ....... drop through platforms",
            "E ........... interact / hide / doors",
            "TAB ......... crafting",
            "Q / F ....... cycle / use item",
          ];
      controls.forEach((l, i) =>
        ctx.fillText(l, VIEW_W / 2 - 70, 238 + i * 14)
      );
    }
  }

  private renderMenu(ctx: CanvasRenderingContext2D): void {
    const g = this.content.game;
    ctx.fillStyle = "#0d0b14";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // Drifting eye motif
    for (let i = 0; i < 5; i++) {
      const x = ((i * 149 + this.animT * 8) % (VIEW_W + 60)) - 30;
      const y = 60 + ((i * 83) % 240);
      ctx.fillStyle = "rgba(255,84,112,0.05)";
      ctx.beginPath();
      ctx.ellipse(x, y, 22, 14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffd166";
    ctx.font = "bold 42px monospace";
    const tw = ctx.measureText(g.title).width;
    ctx.fillText(g.title, (VIEW_W - tw) / 2, 130);
    ctx.fillStyle = g.antagonist.color;
    ctx.font = "11px monospace";
    const sw = ctx.measureText(g.subtitle).width;
    ctx.fillText(g.subtitle, (VIEW_W - sw) / 2, 152);

    if (this.menuMode === "levels") {
      const rooms = this.content.campaign.rooms;
      ctx.font = "10px monospace";
      rooms.forEach((id, i) => {
        const name = this.content.rooms[id]?.name ?? id;
        const label = `${String(i + 1).padStart(2, " ")}. ${name}`;
        const sel = i === this.levelSel;
        ctx.fillStyle = sel ? "#ffd166" : "#8f87ad";
        ctx.font = sel ? "bold 10px monospace" : "10px monospace";
        const w = ctx.measureText(label).width;
        const y = LEVELS_TOP + i * LEVELS_ROW_H + 11;
        ctx.fillText(label, (VIEW_W - w) / 2, y);
        if (sel) ctx.fillText("▸", (VIEW_W - w) / 2 - 14, y);
      });
      ctx.fillStyle = "rgba(143,135,173,0.5)";
      ctx.font = "9px monospace";
      const hint =
        this.input.scheme === "gamepad" ? "d-pad — pick · A — go · B — back" :
        this.input.scheme === "touch" ? "tap a room · tap elsewhere — back" :
        "W/S — pick · ENTER — go · ESC — back";
      const hw = ctx.measureText(hint).width;
      ctx.fillText(hint, (VIEW_W - hw) / 2, VIEW_H - 12);
      return;
    }

    const blink = Math.floor(this.animT * 1.4) % 2 === 0;
    if (blink) {
      const startMsg =
        this.input.scheme === "gamepad" ? "PRESS START" :
        this.input.scheme === "touch" ? "TAP TO BEGIN" :
        "PRESS ENTER";
      ctx.fillStyle = "#e8e2f4";
      ctx.font = "bold 12px monospace";
      const pw = ctx.measureText(startMsg).width;
      ctx.fillText(startMsg, (VIEW_W - pw) / 2, 210);
    }

    ctx.fillStyle = "#8f87ad";
    ctx.font = "9px monospace";
    const controls =
      this.input.scheme === "gamepad"
        ? "move STICK · jump A · interact X · craft Y · use B · cycle LB/RB"
        : this.input.scheme === "touch"
          ? "on-screen controls appear in the game"
          : "move A/D · jump SPACE · interact E · craft TAB · use F · cycle Q";
    const cw = ctx.measureText(controls).width;
    ctx.fillText(controls, (VIEW_W - cw) / 2, 250);
    ctx.fillStyle = "rgba(143,135,173,0.4)";
    ctx.fillText("v0.2.0", VIEW_W - 46, VIEW_H - 8);
    // The quiet door: same dim register as the version tag, corner-tucked.
    const roomsLabel =
      this.input.scheme === "gamepad" ? "Y · rooms" :
      this.input.scheme === "touch" ? "· rooms" : "L · rooms";
    ctx.fillText(roomsLabel, 10, VIEW_H - 8);
    this.drawTip(ctx);
  }

  /** The selected hotbar item rides in the player's hand, state and all. */
  /** A lit fire-shaped torch trails a steady stream of embers + faint smoke. */
  private emitTorchEmbers(dt: number): void {
    if (this.player.hiddenIn !== null) return;
    const usable = this.state.usableItems();
    if (usable.length === 0) return;
    const item = usable[Math.min(this.state.selectedConsumable, usable.length - 1)];
    if (item.shape !== "torch" || item.element !== "fire") {
      this.emberTimer = 0;
      return;
    }
    const p = this.player;
    const tipX = p.centerX + p.facing * 5;
    const tipY = p.centerY - 6;
    this.emberTimer += dt;
    const interval = 0.05;
    while (this.emberTimer >= interval) {
      this.emberTimer -= interval;
      this.particles.burst({
        x: tipX + randRange(-1.5, 1.5), y: tipY, count: 1,
        color: Math.random() < 0.65 ? "#ff7043" : "#ffd166",
        speed: 12, upBias: 50, life: 0.32, size: 2.2, gravity: -35,
      });
      if (Math.random() < 0.2) {
        this.particles.burst({
          x: tipX, y: tipY - 2, count: 1, color: "#6b6478",
          speed: 8, upBias: 26, life: 0.5, size: 2.6, gravity: -16,
        });
      }
    }
  }

  private drawHeldItem(ctx: CanvasRenderingContext2D): void {
    if (this.player.hiddenIn !== null) return;
    const usable = this.state.usableItems();
    if (usable.length === 0) return;
    const item = usable[Math.min(this.state.selectedConsumable, usable.length - 1)];
    const p = this.player;
    const swingLeft = p.swingUntil - simNow();
    const swinging = swingLeft > 0;
    const t = swinging ? 1 - swingLeft / 160 : 0;
    // Resting: at the hip on the facing side. Swinging: sweeps up and forward.
    const hx = p.centerX + p.facing * (5 + (swinging ? 6 + t * 4 : 0));
    const hy = p.centerY + 2 - (swinging ? 7 - t * 3 : 0);
    ctx.save();
    ctx.translate(hx, hy);
    if (swinging) ctx.rotate(p.facing * (-0.9 + t * 1.4));
    if (p.facing < 0) ctx.scale(-1, 1);
    drawItemIcon(ctx, item, 0, 0, 0.9);
    ctx.restore();
  }

  private drawTip(ctx: CanvasRenderingContext2D): void {
    if (simNow() > this.tipUntil) return;
    ctx.font = "10px monospace";
    const w = ctx.measureText(this.tipText).width + 20;
    ctx.fillStyle = "rgba(16,12,24,0.85)";
    roundRect(ctx, (VIEW_W - w) / 2, VIEW_H - 26, w, 18, 4);
    ctx.fill();
    ctx.fillStyle = "#9be8b0";
    ctx.fillText(this.tipText, (VIEW_W - w) / 2 + 10, VIEW_H - 13);
  }

  private renderWin(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#0d0b14";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#9be8b0";
    ctx.font = "bold 30px monospace";
    const t = "YOU ESCAPED";
    ctx.fillText(t, (VIEW_W - ctx.measureText(t).width) / 2, 90);

    const s = this.state.stats;
    const mins = Math.floor(this.finishedInMs / 60000);
    const secs = Math.floor((this.finishedInMs % 60000) / 1000);
    const lines = [
      `time            ${mins}m ${String(secs).padStart(2, "0")}s`,
      `deaths          ${s.deaths}`,
      `things crafted  ${s.crafts}`,
      `discoveries     ${s.discoveries}`,
      `taunts endured  ${s.tauntsHeard}`,
    ];
    ctx.font = "11px monospace";
    ctx.fillStyle = "#e8e2f4";
    lines.forEach((l, i) => ctx.fillText(l, 130, 128 + i * 17));

    // Achievements: what you earned, and how many secrets you missed.
    const all = this.content.achievements;
    const earned = all.filter((a) => this.state.earned.has(a.id));
    const missed = all.length - earned.length;
    ctx.fillStyle = "#ffd166";
    ctx.font = "bold 11px monospace";
    ctx.fillText("ACHIEVEMENTS", 360, 128);
    ctx.font = "10px monospace";
    let ay = 146;
    if (earned.length === 0) {
      ctx.fillStyle = "#8f87ad";
      ctx.fillText("(none. the Warden is thrilled.)", 360, ay);
      ay += 15;
    }
    for (const a of earned.slice(0, 9)) {
      ctx.fillStyle = "#9be8b0";
      ctx.fillText(`★ ${a.name}`, 360, ay);
      ay += 15;
    }
    if (missed > 0) {
      ctx.fillStyle = "#8f87ad";
      ctx.fillText(
        `${missed} secret${missed === 1 ? "" : "s"} undiscovered...`,
        360, ay + 6
      );
    }

    drawTauntBanner(ctx, this.taunts, this.content.game.antagonist, VIEW_W);

    ctx.fillStyle = "#bbb3d6";
    ctx.font = "10px monospace";
    const p =
      this.input.scheme === "gamepad" ? "A — back to menu" :
      this.input.scheme === "touch" ? "tap — back to menu" :
      "Enter — back to menu";
    ctx.fillText(p, (VIEW_W - ctx.measureText(p).width) / 2, 320);
  }

  // =========================================================================
  // Item-hosted behavior verbs (use_swing / use_splash / doused_in_liquid /
  // ignites_near_fire ... in content/behaviors.json compose these). Static so
  // the closures can reach Game privates; runs once at module load, below.
  // =========================================================================
  // =========================================================================
  // Item-hosted penscript functions (useSwing / useSplash / dousedInLiquid /
  // ignitesNearFire ... in content/behaviors.json call these). Static so the
  // closures can reach Game privates; runs once at module load, below.
  // =========================================================================
  static registerItemFns(): void {
    type ItemApi = { g: Game; item: ItemDef };
    const api = (ctx: ScriptCtx) => ctx.api as unknown as ItemApi;
    const argNum = (v: unknown, fb: number) =>
      typeof v === "number" && Number.isFinite(v) ? v : fb;
    const argStr = (v: unknown, fb: string) => (typeof v === "string" ? v : fb);
    const boxFor = (g: Game, kind: string, reach: number): Rect => {
      const p = g.player;
      if (kind === "splash") {
        // The wide soak area ahead (extends behind a touch, matches the
        // old splash box: 52px reach + the player's own width).
        return { x: p.facing >= 0 ? p.x : p.x - reach, y: p.y - 8, w: reach + p.w, h: p.h + 26 };
      }
      if (kind === "body") return { x: p.x, y: p.y, w: p.w, h: p.h };
      // "swing": an arc in front of the player.
      const front = p.facing >= 0 ? p.x + p.w : p.x;
      const r = p.facing * reach;
      const x0 = Math.min(front, front + r);
      const x1 = Math.max(front, front + r);
      return { x: x0, y: p.y - 16, w: x1 - x0, h: p.feetY + 10 - (p.y - 16) };
    };
    const argBox = (ctx: ScriptCtx, args: unknown[], defReach: number): Rect =>
      boxFor(api(ctx).g, argStr(args[0], "swing"), argNum(args[1], defReach));

    registerFn("swingBlocked", (ctx, args) => {
      const { g } = api(ctx);
      return simNow() - g.lastSwingAt < argNum(args[0], 320);
    }, "swingBlocked(cooldownMs?) -> bool — still inside the shared swing cooldown?");
    registerFn("boxTouchesFire", (ctx, args) => {
      const { g } = api(ctx);
      return g.roomRt.boxTouchesFire(argBox(ctx, args, 22));
    }, "boxTouchesFire(box?, reach?) -> bool — open flame (fire/lava tiles, burning tiles, lit braziers) inside the box (\"swing\" | \"splash\" | \"body\")");
    registerFn("playerTouchesFire", (ctx) => {
      const { g } = api(ctx);
      return g.roomRt.boxTouchesFire(boxFor(g, "body", 0));
    }, "playerTouchesFire() -> bool — open flame inside the player's own body box");
    registerFn("playerInElement", (ctx, args) => {
      const { g } = api(ctx);
      const el = argStr(args[0], "");
      if (!el) return false;
      // The player's actual body box — exclusive right/bottom edges, no
      // underfoot probe — so a tile diagonally adjacent (never visually
      // touched) can't count. Same scan the old inWater douse check used.
      const p = g.player;
      const tx0 = Math.floor(p.x / TILE);
      const tx1 = Math.floor((p.x + p.w - 1) / TILE);
      const ty0 = Math.floor(p.y / TILE);
      const ty1 = Math.floor((p.feetY - 1) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (g.roomRt.map.at(tx, ty)?.element === el) return true;
        }
      }
      return false;
    }, "playerInElement(element) -> bool — a tile of this element inside the player body box (exclusive edges, no underfoot probe)");

    registerFn("armSwing", (ctx) => {
      const { g } = api(ctx);
      g.lastSwingAt = simNow(); // swing cooldown is gameplay state — sim clock
      g.player.swing();
      return undefined;
    }, "armSwing() — start the swing cooldown and play the swing animation");
    registerFn("sfx", (ctx, args) => {
      sfx.play(argStr(args[0], "swing") as never);
      return undefined;
    }, "sfx(name) — play a sound effect (swing, splash, ignite, craftFail...)");
    registerFn("floaty", (ctx, args) => {
      const { g } = api(ctx);
      g.floaty(argStr(args[0], ""), g.player.centerX, g.player.y - 8, argStr(args[1], "#ffd166"));
      return undefined;
    }, "floaty(text, color?) — floating text above the player");
    registerFn("popBalloons", (ctx, args) => {
      const { g } = api(ctx);
      g.popBalloons(argBox(ctx, args, 22));
      return undefined;
    }, "popBalloons(box?, reach?) — pop balloon tiles in the box (pure whimsy, element-free)");
    registerFn("transformSelf", (ctx, args) => {
      const { g, item } = api(ctx);
      const to = args[0];
      if (typeof to === "string" && to) g.state.transform(item.id, to);
      return undefined;
    }, "transformSelf(itemId) — this item becomes another item (no-op when itemId is null)");
    registerFn("selectItem", (ctx, args) => {
      const { g } = api(ctx);
      const id = args[0];
      if (typeof id !== "string") return undefined;
      const after = g.state.usableItems();
      const idx = after.findIndex((i) => i.id === id);
      if (idx >= 0) g.state.selectedConsumable = idx;
      return undefined;
    }, "selectItem(itemId) — select this item in the hotbar if the player has it");
    registerFn("scoopFromBox", (ctx, args) => {
      const { g, item } = api(ctx);
      if (!item.scoopsInto) return false;
      const box = argBox(ctx, args, 22);
      for (const [element, destId] of Object.entries(item.scoopsInto)) {
        if (!g.roomRt.boxTouchesElement(element, box)) continue;
        g.state.transform(item.id, destId);
        sfx.play("splash");
        const destColor = g.state.item(destId)?.color ?? "#4fc3f7";
        g.floaty("Scooped.", g.player.centerX, g.player.y - 8, destColor);
        return true;
      }
      return false;
    }, "scoopFromBox(box?, reach?) -> bool — try the item's scoopsInto table against tiles in the box; true = scooped (item transformed)");
    registerFn("applyElements", (ctx, args) => {
      // Apply the item's element to tiles, enemies, and braziers in the box;
      // feedback (particles/sfx/achievement counters) rides the event stream.
      // Returns how many things reacted.
      const { g, item } = api(ctx);
      const box = argBox(ctx, args, 22);
      const rules = g.content.game.rules;
      const events = [
        ...g.roomRt.applyElementToTiles(item.element, box),
        ...g.roomRt.applyElementToEnemies(item.element, box, rules.stunDurationMs),
        ...g.roomRt.applyElementToBraziers(item.element, box),
      ];
      g.handleElementEvents(events);
      return events.length;
    }, "applyElements(box?, reach?) -> count — apply the item's element to tiles, enemies, and braziers in the box; returns how many reacted");
    registerFn("splashParticles", (ctx) => {
      const { g, item } = api(ctx);
      const p = g.player;
      g.particles.burst({
        x: p.centerX + p.facing * 24, y: p.centerY,
        count: 18, color: item.color, speed: 110, upBias: 30, life: 0.5,
      });
      return undefined;
    }, "splashParticles() — the splash spray visual ahead of the player");
    registerFn("removeSelf", (ctx, args) => {
      const { g, item } = api(ctx);
      const n = argNum(args[0], 1);
      for (let i = 0; i < n; i++) g.state.remove(item.id);
      return undefined;
    }, "removeSelf(count?) — spend this item from the inventory");
    registerFn("placeSelf", (ctx) => {
      const { g, item } = api(ctx);
      if (!item.placeType) return undefined;
      const tx = g.player.centerX + g.player.facing * 14;
      g.state.remove(item.id);
      g.roomRt.placeItem(item.placeType, tx - 8, g.player.feetY - 8);
      sfx.play("trap");
      g.floaty(
        item.placeType === "spring" ? "Sprung. (E to take back)" : "Trap set.",
        tx, g.player.y
      );
      return undefined;
    }, "placeSelf() — place the item's placeType (spring/trap) in front of the player and spend it");
    registerFn("throwSelf", (ctx, args) => {
      const { g, item } = api(ctx);
      g.throwBomb(item, Math.max(0, Math.min(1, argNum(args[0], 0))));
      return undefined;
    }, "throwSelf(charge) — lob this item on an arc (charge 0..1); it bursts into a smoke veil on impact");
    registerFn("applyToBraziers", (ctx, args) => {
      const { g } = api(ctx);
      const element = args[0];
      if (typeof element !== "string" || !element) return 0;
      const events = g.roomRt.applyElementToBraziers(element, boxFor(g, "body", 0));
      g.handleElementEvents(events);
      return events.length;
    }, "applyToBraziers(element) -> count — apply an element to braziers under the player's body box");
  }
}
Game.registerItemFns();
