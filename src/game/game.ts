// Game orchestrator: scenes, room flow, interactions, death loop, win.
import type { Content, ItemDef } from "../data/types";
import { Input } from "../engine/input";
import { Loop } from "../engine/loop";
import { Camera } from "../engine/camera";
import { Particles } from "../engine/particles";
import { sfx } from "../engine/audio";
import { TILE } from "../engine/tilemap";
import { drawBackdrop, drawItemIcon, drawMap, roundRect } from "../engine/renderer";
import { rectsOverlap } from "../engine/math";
import { RunState } from "./state";
import { Player } from "./player";
import { RoomRuntime, type ElementEvent, type EntityInstance } from "./room";
import { TauntManager } from "./taunts";
import { CraftUI } from "./craftui";
import { TouchControls, type SmartContext } from "./touch";
import { Warden } from "./warden";
import {
  drawFloaties, drawHearts, drawHotbar, drawPrompt,
  drawTauntBanner, drawTextOverlay, drawToolbelt, hotbarSlotRect,
  type Floaty, type OverlayButton,
} from "./hud";

export const VIEW_W = 640;
export const VIEW_H = 360;

type Scene = "menu" | "play" | "win";
type Overlay = "none" | "note" | "dialog" | "npcConfirm" | "craft" | "pause" | "report";

export class Game {
  content: Content;
  input = new Input();
  camera = new Camera();
  particles = new Particles();
  taunts: TauntManager;
  craftUI: CraftUI;
  loop: Loop;

  scene: Scene = "menu";
  overlay: Overlay = "none";
  state!: RunState;
  player!: Player;
  roomRt!: RoomRuntime;
  currentRoomId = "";

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
  private overlayEntity: EntityInstance | null = null;
  private overlayText = "";
  private overlayTitle = "";
  private confirmButtons: OverlayButton[] = [];
  private winShownAt = 0;
  private finishedInMs = 0;
  private reportUI: import("./report").ReportUI | null = null;

  constructor(private ctx: CanvasRenderingContext2D, content: Content) {
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
        }
      } else {
        sfx.play("craftFail");
        this.taunts.fire("craft_fail");
      }
    });
    this.loop = new Loop(
      (dt) => this.update(dt),
      () => this.render()
    );
    this.touch = new TouchControls(
      ctx.canvas as HTMLCanvasElement,
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
        this.craftUI.hide();
        this.overlay = "none";
      }
    };
    // Pointer events: mouse parity everywhere + drag-and-drop in the workbench.
    // Touch is handled entirely through TouchControls above (avoids double-firing
    // from synthesized pointer events, and survives preventDefault suppressing them).
    const canvas = ctx.canvas as HTMLCanvasElement;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") return;
      const p = this.screenToLogical(e.clientX, e.clientY);
      if (this.scene === "play" && this.overlay === "craft") {
        this.craftUI.pointerDown(p.x, p.y, this.state);
      } else {
        this.handleTap(p.x, p.y);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      if (this.scene === "play" && this.overlay === "craft") {
        const p = this.screenToLogical(e.clientX, e.clientY);
        this.craftUI.pointerMove(p.x, p.y);
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      if (e.pointerType === "touch") return;
      if (this.scene === "play" && this.overlay === "craft") {
        const p = this.screenToLogical(e.clientX, e.clientY);
        if (this.craftUI.pointerUp(p.x, p.y, this.state) === "close") {
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
      if (e.def.portrait) {
        const img = new Image();
        img.src = e.def.portrait;
        if (img.complete && img.naturalWidth > 0) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, x, y, size, size);
          return;
        }
      }
      const color = e.def.color ?? "#7fd8e8";
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
    this.tipUntil = performance.now() + 2500;
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
    if (this.scene === "menu") {
      sfx.play("uiSelect");
      this.newRun();
      return;
    }
    if (this.scene === "win") {
      if (performance.now() - this.winShownAt > 1200) this.scene = "menu";
      return;
    }
    switch (this.overlay) {
      case "note":
      case "dialog":
        this.overlay = "none";
        break;
      case "pause": {
        // "R — report an issue" line's tap zone
        const rx = VIEW_W / 2 - 70, ry = 188 - 10;
        if (x >= rx && x <= rx + 160 && y >= ry && y <= ry + 14) {
          this.overlay = "report";
          this.openReportUI();
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

  /** Native-resolution viewport: logical 640x360 scaled/centered by main.ts. */
  setViewport(scale: number, ox: number, oy: number, compact = false): void {
    this.viewScale = scale;
    this.viewOx = ox;
    this.viewOy = oy;
    this.compact = compact;
    // Phones see a tighter slice of the world so everything reads larger.
    this.worldZoom = compact ? 4 / 3 : 1;
    this.touch.setViewport(scale, ox, oy, this.ctx.canvas.width, this.ctx.canvas.height);
  }

  newRun(startRoomId?: string): void {
    const roomId = startRoomId ?? this.content.campaign.rooms[0];
    this.state = new RunState(this.content, roomId);
    this.player = new Player(this.content.game.player);
    this.taunts.reset();
    this.particles.clear();
    this.floaties = [];
    this.scene = "play";
    this.overlay = "none";
    this.loadRoom(roomId);
    this.state.checkpoint = {
      roomId, x: this.roomRt.spawnX, y: this.roomRt.spawnY,
    };
    this.taunts.fire("game_start");
  }

  loadRoom(roomId: string): void {
    const room = this.content.rooms[roomId];
    if (!room) {
      console.error("Missing room:", roomId);
      return;
    }
    this.currentRoomId = roomId;
    this.roomRt = new RoomRuntime(room, this.content, this.state.mutations(roomId));
    this.player.placeFeetAt(this.roomRt.spawnX, this.roomRt.spawnY);
    this.player.hiddenIn = null;
    // Warden scheduling: boss rooms summon him after a grace period.
    this.warden.dissipate();
    this.idleWardenSummoned = false;
    this.wardenSpawnAt = room.wardenChase
      ? performance.now() + room.wardenChase.delayMs
      : Infinity;
    this.camera.snapTo(
      this.player.centerX, this.player.centerY,
      VIEW_W / this.worldZoom, VIEW_H / this.worldZoom,
      this.roomRt.map.pixelWidth, this.roomRt.map.pixelHeight
    );
    this.particles.clear();
    this.taunts.fire("room_enter", { roomId });
  }

  private nextRoomId(): string | null {
    const order = this.content.campaign.rooms;
    const i = order.indexOf(this.currentRoomId);
    return i >= 0 && i + 1 < order.length ? order[i + 1] : null;
  }

  private floaty(text: string, x: number, y: number, color = "#ffd166"): void {
    this.floaties.push({ text, x, y, bornAt: performance.now(), color });
    if (this.floaties.length > 12) this.floaties.shift();
  }

  // ================= UPDATE =================

  private update(dt: number): void {
    this.input.pollGamepads();
    this.animT += dt;
    this.camera.update(dt);
    this.particles.update(dt);
    this.floaties = this.floaties.filter((f) => performance.now() - f.bornAt < 1100);

    switch (this.scene) {
      case "menu": this.updateMenu(); break;
      case "play": this.updatePlay(dt); break;
      case "win": this.updateWin(); break;
    }
    this.input.endFrame();
  }

  private updateMenu(): void {
    if (this.input.confirmPressed) {
      sfx.play("uiSelect");
      this.newRun();
    }
  }

  private updateWin(): void {
    this.taunts.update();
    if (performance.now() - this.winShownAt > 1200 && this.input.confirmPressed) {
      this.scene = "menu";
    }
  }

  private updatePlay(dt: number): void {
    this.taunts.update();

    // ---- Overlays swallow input ----
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
      if (this.input.pausePressed) this.overlay = "none";
      if (this.input.justPressed("KeyM")) {
        sfx.muted = !sfx.muted;
      }
      if (this.input.justPressed("KeyQ")) {
        this.overlay = "none";
        this.scene = "menu";
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
      return;
    }

    const g = this.content.game;

    // ---- Player physics ----
    const ev = this.player.update(dt, this.input, this.roomRt.map, this.state);
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
      this.damagePlayer(ev.spikeDamage, this.player.centerX, "spikes");
    }

    // ---- Elemental hazards on the player (burning tiles, live charge) ----
    {
      const ptx0 = Math.floor(this.player.x / TILE);
      const ptx1 = Math.floor((this.player.x + this.player.w) / TILE);
      const pty0 = Math.floor(this.player.y / TILE);
      const pty1 = Math.floor((this.player.feetY + 2) / TILE); // include tile underfoot
      let hazard: "burning" | "spark" | null = null;
      let inWater = false;
      for (let ty = pty0; ty <= pty1; ty++) {
        for (let tx = ptx0; tx <= ptx1; tx++) {
          if (this.roomRt.isBurning(tx, ty)) hazard = hazard ?? "burning";
          if (this.roomRt.isEnergized(tx, ty)) hazard = "spark";
          if (this.roomRt.map.at(tx, ty)?.element === "water") inWater = true;
        }
      }
      if (hazard && !this.player.invulnerable) {
        if (hazard === "spark") {
          this.state.bump("selfZaps");
          this.checkAchievements("counter");
        }
        this.damagePlayer(1, this.player.centerX, hazard);
      }
      // Water douses carried flames (torches revert to unlit)
      if (inWater) {
        for (const [id] of [...this.state.inventory]) {
          const def = this.state.item(id);
          if (def?.dousedBy === "water" && def.dousesTo) {
            this.state.transform(id, def.dousesTo);
            sfx.play("splash");
            this.floaty("Torch doused!", this.player.centerX, this.player.y - 10, "#4fc3f7");
          }
        }
      }
      // Passive lighting: just holding an unlit torch up to a flame lights it —
      // no button press needed. (Applying fire to the WORLD still needs F.)
      {
        const usable = this.state.usableItems();
        const held = usable[Math.min(this.state.selectedConsumable, usable.length - 1)];
        if (held?.igniteTo) {
          const box = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };
          if (this.roomRt.boxTouchesFire(box)) {
            this.state.transform(held.id, held.igniteTo);
            sfx.play("ignite");
            this.floaty("Lit!", this.player.centerX, this.player.y - 8, "#ff7043");
            const after = this.state.usableItems();
            const idx = after.findIndex((i) => i.id === held.igniteTo);
            if (idx >= 0) this.state.selectedConsumable = idx;
          }
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
      for (const en of this.roomRt.enemies) {
        if (en.state === "stunned" || en.state === "trapped") continue;
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
        this.checkAchievements("pickup_item", { itemId: item.id });
        sfx.play("pickup");
        this.floaty(`+${e.def.count ?? 1} ${item.name}`, e.x + e.w / 2, e.y);
        this.particles.burst({
          x: e.x + e.w / 2, y: e.y + e.h / 2,
          count: 8, color: item.color, speed: 70, upBias: 40, life: 0.4, gravity: 120,
        });
      }
      if (e.kind === "checkpoint" && !e.open && rectsOverlap(prect, e)) {
        e.open = true;
        this.state.mutations(this.currentRoomId).openedDoors.add(e.index);
        this.state.checkpoint = {
          roomId: this.currentRoomId, x: e.x + e.w / 2, y: e.y + e.h,
        };
        if (this.content.game.rules.healAtCheckpoints) {
          this.state.health = this.state.maxHealth;
        }
        sfx.play("checkpoint");
        this.floaty("Checkpoint!", e.x + e.w / 2, e.y, "#5ad1a5");
      }
    }
    for (const b of [...this.roomRt.bundles]) {
      if (rectsOverlap(prect, b)) {
        for (const [id, n] of b.items) {
          this.state.add(id, n);
          const item = this.state.item(id);
          this.floaty(`+${n} ${item?.name ?? id}`, b.x + 7, b.y);
        }
        this.roomRt.removeBundle(b);
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
      if (this.input.usePressed && this.player.hiddenIn === null) {
        this.useItem(usable[Math.min(this.state.selectedConsumable, usable.length - 1)]);
      }
    }

    // ---- Idle taunt, then idle CONSEQUENCES ----
    const idleMs = performance.now() - this.input.lastInputAt;
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
        performance.now() > this.wardenSpawnAt) {
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
          this.wardenSpawnAt = performance.now() + 1500;
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

    // ---- Smart action context (mobile) + its press ----
    this.touch.smartContext = this.computeSmartContext();
    if (this.input.justPressed("TouchSmart")) {
      if (this.touch.smartContext.kind === "interact") {
        this.tryInteract();
      } else if (this.touch.smartContext.kind === "use" && this.player.hiddenIn === null) {
        const items = this.state.usableItems();
        const held = items[Math.min(this.state.selectedConsumable, items.length - 1)];
        if (held) this.useItem(held);
      }
    }
  }

  /** What would the smart button do right now? */
  private computeSmartContext(): SmartContext {
    if (this.player.hiddenIn !== null) return { kind: "interact", label: "exit" };
    const near = this.roomRt.interactableNear(this.player.centerX, this.player.centerY);
    if (near) {
      const verbs: Record<string, string> = {
        note: "read", door: near.def.gate && !near.open ? "look" : "go",
        locker: "hide", npc: "talk", exit: "EXIT",
      };
      return { kind: "interact", label: verbs[near.kind] ?? "use" };
    }
    if (this.roomRt.placedSpringNear(this.player.centerX, this.player.centerY)) {
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
      // Reclaim a placed spring
      const spring = this.roomRt.placedSpringNear(this.player.centerX, this.player.centerY);
      if (spring) {
        this.roomRt.removePlaced(spring);
        this.state.add("spring");
        this.state.bump("springReclaims");
        this.checkAchievements("counter");
        sfx.play("pickup");
        this.floaty("+1 Spring", spring.x + spring.w / 2, spring.y);
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
      case "door": this.useDoor(e); break;
      case "npc": this.talkToNpc(e); break;
      case "exit": this.winGame(); break;
    }
  }

  private useDoor(e: EntityInstance): void {
    if (e.def.gate && !e.open) {
      sfx.play("locked");
      this.floaty(
        e.def.fuseId ? "Dead. Needs power." : "Sealed shut.",
        e.x + e.w / 2, e.y, "#e8a2b4"
      );
      return;
    }
    if (e.def.gate) return; // opened gates are just passable
    const target = e.def.to === "next" || !e.def.to ? this.nextRoomId() : e.def.to;
    if (target) {
      sfx.play("door");
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
          this.loop.hitStop(this.content.game.juice.hitStopMs * 0.6);
          this.particles.burst({ x: ev.x, y: ev.y, count: 14, color: ev.color, speed: 120, life: 0.55 });
          break;
        case "energize":
          this.particles.burst({ x: ev.x, y: ev.y, count: 2, color: "#ffe95a", speed: 40, life: 0.25, gravity: 0 });
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

  /** The swing/apply box in front of the player. */
  private swingBox(): { x: number; y: number; w: number; h: number } {
    const p = this.player;
    const front = p.facing >= 0 ? p.x + p.w : p.x;
    const reach = p.facing * 22;
    const x0 = Math.min(front, front + reach);
    const x1 = Math.max(front, front + reach);
    return { x: x0, y: p.y - 16, w: x1 - x0, h: p.feetY + 10 - (p.y - 16) };
  }

  private useItem(item: ItemDef): void {
    const now = performance.now();
    const rules = this.content.game.rules;
    switch (item.useMode) {
      case "swing": {
        if (now - this.lastSwingAt < 320) return;
        this.lastSwingAt = now;
        this.player.swing();
        sfx.play("swing");
        const box = this.swingBox();
        // Carrier transformations first: light the torch, fill the bucket.
        if (item.igniteTo && this.roomRt.boxTouchesFire(box)) {
          this.state.transform(item.id, item.igniteTo);
          sfx.play("ignite");
          this.floaty("Lit!", this.player.centerX, this.player.y - 8, "#ff7043");
          return;
        }
        if (item.fillsTo && this.roomRt.boxTouchesWater(box)) {
          this.state.transform(item.id, item.fillsTo);
          sfx.play("splash");
          this.floaty("Scooped.", this.player.centerX, this.player.y - 8, "#4fc3f7");
          return;
        }
        const events = [
          ...this.roomRt.applyElementToTiles(item.element, box),
          ...this.roomRt.applyElementToEnemies(item.element, box, rules.stunDurationMs),
        ];
        this.handleElementEvents(events);
        if (item.kind === "consumable" && events.length > 0) {
          this.state.remove(item.id); // frost vial spends itself on a real effect
        }
        break;
      }
      case "splash": {
        if (now - this.lastSwingAt < 320) return;
        this.lastSwingAt = now;
        this.player.swing();
        const p = this.player;
        const dir = p.facing;
        const box = {
          x: dir >= 0 ? p.x : p.x - 52, y: p.y - 8,
          w: 52 + p.w, h: p.h + 26,
        };
        const events = [
          ...this.roomRt.applyElementToTiles(item.element, box),
          ...this.roomRt.applyElementToEnemies(item.element, box, rules.stunDurationMs),
        ];
        sfx.play("splash");
        this.particles.burst({
          x: p.centerX + dir * 24, y: p.centerY,
          count: 18, color: "#4fc3f7", speed: 110, upBias: 30, life: 0.5,
        });
        this.handleElementEvents(events);
        if (item.emptiesTo) this.state.transform(item.id, item.emptiesTo);
        break;
      }
      case "place": {
        if (!item.placeType) return;
        const tx = this.player.centerX + this.player.facing * 14;
        this.state.remove(item.id);
        this.roomRt.placeItem(item.placeType, tx - 8, this.player.feetY - 8);
        sfx.play("trap");
        this.floaty(
          item.placeType === "spring" ? "Sprung. (E to take back)" : "Trap set.",
          tx, this.player.y
        );
        break;
      }
      case "burst": {
        this.state.remove(item.id);
        const hit = this.roomRt.stunEnemiesNear(
          this.player.centerX, this.player.centerY,
          rules.smokeBombRadius, rules.stunDurationMs
        );
        sfx.play("stun");
        this.camera.shake(2, 0.2);
        this.particles.burst({
          x: this.player.centerX, y: this.player.centerY,
          count: 26, color: "#aab3c8", speed: 110, life: 0.9, gravity: -20,
        });
        this.floaty(hit > 0 ? `Stunned ${hit}!` : "Poof.", this.player.centerX, this.player.y);
        break;
      }
    }
  }

  private damagePlayer(amount: number, fromX: number, _source: string): void {
    const g = this.content.game;
    this.state.health -= amount;
    this.player.hurt(fromX, g.player.invulnMs);
    sfx.play("hurt");
    this.camera.shake(4, 0.25);
    this.loop.hitStop(g.juice.hitStopMs);
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
    this.camera.shake(6, 0.4);
    this.particles.burst({
      x: this.player.centerX, y: this.player.centerY,
      count: 24, color: g.player.color, speed: 160, upBias: 60, life: 0.7,
    });
    if (g.rules.dropMaterialsOnDeath) {
      const dropped = this.state.takeAllMaterials();
      if (dropped.length > 0) {
        this.roomRt.dropBundle(this.player.centerX, this.player.feetY, dropped);
        this.floaty("Materials dropped!", this.player.centerX, this.player.y - 10, "#e8a2b4");
      }
    }
    if (this.state.hasDiedOnce) {
      this.taunts.fire("death");
    } else {
      this.state.hasDiedOnce = true;
      this.taunts.fire("first_death");
    }
    // Respawn
    this.state.health = this.state.maxHealth;
    const cp = this.state.checkpoint;
    if (cp.roomId !== this.currentRoomId) {
      this.loadRoom(cp.roomId);
    }
    this.player.placeFeetAt(cp.x, cp.y);
    this.player.invulnUntil = performance.now() + g.rules.respawnInvulnMs;
    this.player.hiddenIn = null;
    this.roomRt.resetEnemies();
  }

  private winGame(): void {
    this.finishedInMs = performance.now() - this.state.stats.startedAt;
    this.scene = "win";
    this.winShownAt = performance.now();
    sfx.play("win");
    this.taunts.fire("win");
    this.checkAchievements("win");
  }

  // ================= RENDER =================

  private render(): void {
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
    this.roomRt.draw(ctx, this.animT);
    this.player.draw(ctx);
    this.drawHeldItem(ctx);
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
            locker: "hide", npc: "talk", exit: "ESCAPE",
          };
          drawPrompt(ctx, `${iKey} — ${verbs[near.kind] ?? "use"}`, near.x + near.w / 2, near.y - 6);
        } else {
          const spring = this.roomRt.placedSpringNear(this.player.centerX, this.player.centerY);
          if (spring) {
            drawPrompt(ctx, `${iKey} — take spring`, spring.x + spring.w / 2, spring.y - 10);
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
    drawToolbelt(ctx, this.state, VIEW_W, hud);
    const hotbarHint =
      this.input.scheme === "gamepad" ? "LB/RB cycle · B use" :
      this.input.scheme === "touch" ? "tap a slot to hold it" :
      "Q cycle · F use";
    drawHotbar(ctx, this.state, VIEW_H, hud, hotbarHint, uiScale);
    drawTauntBanner(ctx, this.taunts, this.content.game.antagonist, VIEW_W, hud.bannerTopOffset);
    if (this.warden.active) {
      this.warden.drawVignette(
        ctx, VIEW_W, VIEW_H,
        this.warden.distanceTo(this.player.centerX, this.player.centerY)
      );
    }
    this.drawTip(ctx);

    // Overlays
    if (this.overlay === "craft") {
      this.craftUI.draw(ctx, this.state, VIEW_W, VIEW_H);
    } else if (this.overlay === "note" || this.overlay === "dialog" || this.overlay === "npcConfirm") {
      const isNpc = this.overlay !== "note" && this.overlayEntity?.kind === "npc";
      this.confirmButtons = drawTextOverlay(ctx, {
        title: this.overlayTitle,
        titleColor: this.overlay === "note" ? "#c9a86a" : "#7fd8e8",
        body: this.overlayText,
        footer:
          this.overlay === "npcConfirm"
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
      ctx.fillStyle = "rgba(8,6,14,0.75)";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = "#e8e2f4";
      ctx.font = "bold 16px monospace";
      ctx.fillText("PAUSED", VIEW_W / 2 - 30, 110);
      ctx.font = "10px monospace";
      ctx.fillStyle = "#bbb3d6";
      ctx.fillText("Esc — resume", VIEW_W / 2 - 70, 140);
      ctx.fillText(`M — sound ${sfx.muted ? "ON" : "OFF"}`, VIEW_W / 2 - 70, 156);
      ctx.fillText("Q — quit to menu", VIEW_W / 2 - 70, 172);
      ctx.fillStyle = "#9be8b0";
      ctx.fillText("R — report an issue", VIEW_W / 2 - 70, 188);
      ctx.fillStyle = "#8f87ad";
      ctx.fillText("CONTROLS", VIEW_W / 2 - 70, 204);
      const controls = [
        "A/D or ←/→ ... move",
        "SPACE / W ... jump (hold = higher)",
        "S / ↓ ....... drop through platforms",
        "E ........... interact / hide / doors",
        "TAB ......... crafting",
        "Q / F ....... cycle / use item",
      ];
      controls.forEach((l, i) =>
        ctx.fillText(l, VIEW_W / 2 - 70, 220 + i * 14)
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
    this.drawTip(ctx);
  }

  /** The selected hotbar item rides in the player's hand, state and all. */
  private drawHeldItem(ctx: CanvasRenderingContext2D): void {
    if (this.player.hiddenIn !== null) return;
    const usable = this.state.usableItems();
    if (usable.length === 0) return;
    const item = usable[Math.min(this.state.selectedConsumable, usable.length - 1)];
    const p = this.player;
    const swingLeft = p.swingUntil - performance.now();
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
    if (performance.now() > this.tipUntil) return;
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
}
