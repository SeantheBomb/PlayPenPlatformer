// Game orchestrator: scenes, room flow, interactions, death loop, win.
import type { Content, ItemDef } from "../data/types";
import { Input } from "../engine/input";
import { Loop } from "../engine/loop";
import { Camera } from "../engine/camera";
import { Particles } from "../engine/particles";
import { sfx } from "../engine/audio";
import { TILE } from "../engine/tilemap";
import { drawBackdrop, drawMap, roundRect } from "../engine/renderer";
import { rectsOverlap } from "../engine/math";
import { RunState } from "./state";
import { Player } from "./player";
import { RoomRuntime, type EntityInstance } from "./room";
import { TauntManager } from "./taunts";
import { CraftUI } from "./craftui";
import {
  drawFloaties, drawHearts, drawHotbar, drawPrompt,
  drawTauntBanner, drawTextOverlay, drawToolbelt, type Floaty,
} from "./hud";

export const VIEW_W = 640;
export const VIEW_H = 360;

type Scene = "menu" | "play" | "win";
type Overlay = "none" | "note" | "dialog" | "craft" | "pause";

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

  private animT = 0;
  private viewScale = 1;
  private viewOx = 0;
  private viewOy = 0;
  private floaties: Floaty[] = [];
  private overlayEntity: EntityInstance | null = null;
  private overlayText = "";
  private overlayTitle = "";
  private winShownAt = 0;
  private finishedInMs = 0;

  constructor(private ctx: CanvasRenderingContext2D, content: Content) {
    this.content = content;
    this.taunts = new TauntManager(content.taunts);
    this.taunts.onTauntShown = () => {
      if (this.state) this.state.stats.tauntsHeard++;
    };
    this.craftUI = new CraftUI(content, (result) => {
      if (result.ok) {
        sfx.play(result.firstTime ? "discover" : "craft");
        if (this.state.stats.crafts === 1) this.taunts.fire("first_craft");
        if (result.outputId) this.taunts.fire("craft_item", { itemId: result.outputId });
      } else {
        sfx.play("craftFail");
        this.taunts.fire("craft_fail");
      }
    });
    this.loop = new Loop(
      (dt) => this.update(dt),
      () => this.render()
    );
    this.applyConfig();
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
  setViewport(scale: number, ox: number, oy: number): void {
    this.viewScale = scale;
    this.viewOx = ox;
    this.viewOy = oy;
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
    this.camera.snapTo(
      this.player.centerX, this.player.centerY,
      VIEW_W, VIEW_H, this.roomRt.map.pixelWidth, this.roomRt.map.pixelHeight
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
    if (this.input.justPressed("Enter", "Space")) {
      sfx.play("uiSelect");
      this.newRun();
    }
  }

  private updateWin(): void {
    this.taunts.update();
    if (performance.now() - this.winShownAt > 1200 && this.input.justPressed("Enter", "Space")) {
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
    if (this.overlay === "pause") {
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
    void ev.broke; // contact-breaking retired: breaking is an active swing now
    if (ev.spikeDamage > 0) {
      this.damagePlayer(ev.spikeDamage, this.player.centerX, "spikes");
    }

    // ---- Enemies ----
    this.roomRt.update(dt, {
      centerX: this.player.centerX,
      centerY: this.player.centerY,
      hidden: this.player.hiddenIn !== null,
    });
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
        this.state.selectedConsumable = (this.state.selectedConsumable + 1) % usable.length;
        sfx.play("uiMove");
      }
      if (this.input.usePressed && this.player.hiddenIn === null) {
        this.useItem(usable[Math.min(this.state.selectedConsumable, usable.length - 1)]);
      }
    }

    // ---- Idle taunt ----
    if (
      performance.now() - this.input.lastInputAt >
      this.content.game.rules.idleTauntSeconds * 1000
    ) {
      this.taunts.fire("idle");
    }

    // ---- Fell out of the world (shouldn't happen, but be kind) ----
    if (this.player.y > this.roomRt.map.pixelHeight + 80) {
      this.killPlayer();
    }

    // ---- Camera ----
    this.camera.follow(
      this.player.centerX, this.player.centerY, this.player.facing,
      VIEW_W, VIEW_H, this.roomRt.map.pixelWidth, this.roomRt.map.pixelHeight
    );
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
    if (!e) return;
    switch (e.kind) {
      case "note": {
        this.overlayEntity = e;
        this.overlayTitle = "A note from a previous subject";
        this.overlayText = e.def.text ?? "(the writing is illegible)";
        this.overlay = "note";
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
    if (e.def.locked && !e.open) {
      const pick = this.state.findConsumableWith("unlock");
      if (pick) {
        this.state.remove(pick.id);
        e.open = true;
        this.state.mutations(this.currentRoomId).openedDoors.add(e.index);
        sfx.play("unlock");
        this.camera.shake(1.5, 0.12);
        this.floaty(`Used ${pick.name}`, e.x + e.w / 2, e.y, "#9be8b0");
      } else {
        sfx.play("locked");
        this.floaty("Locked tight.", e.x + e.w / 2, e.y, "#e8a2b4");
      }
      return;
    }
    if (e.def.gate) return; // opened gates are just passable
    const target = e.def.to === "next" || !e.def.to ? this.nextRoomId() : e.def.to;
    if (target) {
      sfx.play("door");
      this.loadRoom(target);
      this.state.checkpoint = {
        roomId: target, x: this.roomRt.spawnX, y: this.roomRt.spawnY,
      };
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
      this.state.remove(wants.item, wants.count);
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
      this.overlayText = d.dialogDone ?? "Thanks!";
      this.overlay = "dialog";
      sfx.play("discover");
      this.taunts.fire("npc_help");
    } else {
      this.overlayText = d.dialogAsk ?? "...";
      this.overlay = "dialog";
    }
  }

  private lastSwingAt = 0;

  /** Reusable swing tools (hammer): break matching tiles in a short arc ahead. */
  private trySwing(item: ItemDef): void {
    const now = performance.now();
    if (now - this.lastSwingAt < 320) return;
    this.lastSwingAt = now;
    this.player.swing();
    sfx.play("swing");
    const caps = new Set(
      (item.capabilities ?? []).filter((c) => c.startsWith("break:"))
    );
    const p = this.player;
    const front = p.facing >= 0 ? p.x + p.w : p.x;
    const reach = p.facing * 22;
    const x0 = Math.min(front, front + reach);
    const x1 = Math.max(front, front + reach);
    const y0 = p.y - 16;
    const y1 = p.feetY + 10;
    const map = this.roomRt.map;
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++) {
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
        const def = map.at(tx, ty);
        if (def?.breakBy && caps.has(def.breakBy)) {
          map.breakTile(tx, ty);
          this.smashTileFX(tx, ty, def.color);
        }
      }
    }
  }

  private smashTileFX(tx: number, ty: number, color: string): void {
    sfx.play("break");
    this.camera.shake(3, 0.2);
    this.loop.hitStop(this.content.game.juice.hitStopMs * 0.6);
    this.particles.burst({
      x: tx * TILE + 8, y: ty * TILE + 8,
      count: 14, color, speed: 120, life: 0.55,
    });
    this.state.mutations(this.currentRoomId).brokenTiles.push(
      ty * this.roomRt.map.width + tx
    );
  }

  private useItem(item: ItemDef): void {
    if (item.kind === "tool") {
      if (item.capabilities?.some((c) => c.startsWith("break:"))) this.trySwing(item);
      return;
    }
    this.useConsumable(item.id);
  }

  private useConsumable(id: string): void {
    const item = this.state.item(id);
    if (!item) return;
    const caps = item.capabilities ?? [];
    const rules = this.content.game.rules;
    if (caps.includes("stun")) {
      this.state.remove(id);
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
    } else if (caps.includes("trap")) {
      this.state.remove(id);
      const tx = this.player.centerX + this.player.facing * 14;
      this.roomRt.traps.push({ x: tx - 8, y: this.player.feetY - 8, w: 16, h: 8, used: false });
      sfx.play("trap");
      this.floaty("Trap set.", tx, this.player.y);
    } else if (caps.includes("unlock")) {
      this.floaty("Use it on a locked door (E).", this.player.centerX, this.player.y, "#bbb3d6");
    } else {
      this.floaty("It does... nothing. Proudly.", this.player.centerX, this.player.y, "#bbb3d6");
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
    ctx.restore();
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

    // World
    const camX = Math.round(this.camera.x + this.camera.offsetX);
    const camY = Math.round(this.camera.y + this.camera.offsetY);
    ctx.save();
    ctx.translate(-camX, -camY);
    drawBackdrop(ctx, this.roomRt.room.background, camX, camY, VIEW_W, VIEW_H);
    drawMap(ctx, this.roomRt.map, camX, camY, VIEW_W, VIEW_H, this.animT);
    this.roomRt.draw(ctx, this.animT);
    this.player.draw(ctx);
    this.particles.draw(ctx);
    drawFloaties(ctx, this.floaties);
    // Interaction prompt
    if (this.overlay === "none") {
      if (this.player.hiddenIn !== null) {
        drawPrompt(ctx, "E — leave locker", this.player.centerX, this.player.y - 26);
      } else {
        const near = this.roomRt.interactableNear(this.player.centerX, this.player.centerY);
        if (near) {
          const verbs: Record<string, string> = {
            note: "read", door: near.def.locked && !near.open ? "unlock" : "open",
            locker: "hide", npc: "talk", exit: "ESCAPE",
          };
          drawPrompt(ctx, `E — ${verbs[near.kind] ?? "use"}`, near.x + near.w / 2, near.y - 6);
        }
      }
    }
    ctx.restore();

    // Room name watermark
    ctx.fillStyle = "rgba(232,226,244,0.28)";
    ctx.font = "bold 9px monospace";
    ctx.fillText(this.roomRt.room.name.toUpperCase(), 12, VIEW_H - 8);

    // HUD
    drawHearts(ctx, this.state.health, this.state.maxHealth);
    drawToolbelt(ctx, this.state, VIEW_W);
    drawHotbar(ctx, this.state, VIEW_H);
    drawTauntBanner(ctx, this.taunts, this.content.game.antagonist, VIEW_W);

    // Overlays
    if (this.overlay === "craft") {
      this.craftUI.draw(ctx, this.state, VIEW_W, VIEW_H);
    } else if (this.overlay === "note" || this.overlay === "dialog") {
      drawTextOverlay(ctx, {
        title: this.overlayTitle,
        titleColor: this.overlay === "note" ? "#c9a86a" : "#7fd8e8",
        body: this.overlayText,
        footer: "E / Enter — close",
        viewW: VIEW_W, viewH: VIEW_H,
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
      ctx.fillStyle = "#e8e2f4";
      ctx.font = "bold 12px monospace";
      const pw = ctx.measureText("PRESS ENTER").width;
      ctx.fillText("PRESS ENTER", (VIEW_W - pw) / 2, 210);
    }

    ctx.fillStyle = "#8f87ad";
    ctx.font = "9px monospace";
    const controls = "move A/D · jump SPACE · interact E · craft TAB · use F · cycle Q";
    const cw = ctx.measureText(controls).width;
    ctx.fillText(controls, (VIEW_W - cw) / 2, 250);
    ctx.fillStyle = "rgba(143,135,173,0.4)";
    ctx.fillText("v0.1.0", VIEW_W - 46, VIEW_H - 8);
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
    ctx.font = "12px monospace";
    ctx.fillStyle = "#e8e2f4";
    lines.forEach((l, i) => ctx.fillText(l, 220, 140 + i * 20));

    drawTauntBanner(ctx, this.taunts, this.content.game.antagonist, VIEW_W);

    ctx.fillStyle = "#bbb3d6";
    ctx.font = "10px monospace";
    const p = "Enter — back to menu";
    ctx.fillText(p, (VIEW_W - ctx.measureText(p).width) / 2, 300);
  }
}
