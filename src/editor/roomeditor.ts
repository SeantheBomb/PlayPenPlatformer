// Room editor tab: tile painting, entity placement, inspector, test-play.
import type { Content, RoomDef, RoomEntity } from "../data/types";
import type { ContentStore } from "../data/content";
import { TILE } from "../engine/tilemap";
import { drawBlob, drawMap } from "../engine/renderer";
import { RoomRuntime } from "../game/room";
import { autoForm, el, toast } from "./forms";
import { openPixelEditor, rasterize } from "./pixeleditor";

// Matches ENTITY_SIZES.npc in game/room.ts — used only to fit the procedural
// pixel-editor seed and preview at the right aspect ratio.
const NPC_W = 12, NPC_H = 16;

// Raw data-URIs are edited via the dedicated panels below, not as text fields.
const SPRITE_KEYS = ["portrait", "sprite", "spriteFrames", "spriteFps"];

type Tool =
  | { kind: "select" }
  | { kind: "erase" }
  | { kind: "tile"; char: string }
  | { kind: "entity"; type: RoomEntity["type"] };

const ENTITY_TYPES: RoomEntity["type"][] = [
  "spawn", "checkpoint", "pickup", "note", "door", "locker", "enemy", "npc",
  "exit", "hint", "brazier", "fusebox",
];

const UNDO_CAP = 50;

export class RoomEditor {
  private roomId: string | null = null;
  private tool: Tool = { kind: "select" };
  private zoom = 2;
  private selected: RoomEntity | null = null;
  private painting = false;
  private draggingEntity = false;
  private dirty = false;
  private undoStack: { roomId: string; data: string }[] = [];
  private redoStack: { roomId: string; data: string }[] = [];
  private lastFormUndoAt = 0;
  private keyHandler = (e: KeyboardEvent) => {
    if (!document.body.contains(this.rootEl)) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return; // native undo in fields
    if (e.ctrlKey && !e.shiftKey && e.code === "KeyZ") {
      e.preventDefault();
      this.undo();
    } else if ((e.ctrlKey && e.code === "KeyY") || (e.ctrlKey && e.shiftKey && e.code === "KeyZ")) {
      e.preventDefault();
      this.redo();
    }
  };

  private rootEl!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private inspectorEl!: HTMLElement;
  private roomListEl!: HTMLElement;
  private propsEl!: HTMLElement;
  private paletteEl!: HTMLElement;

  constructor(
    private store: ContentStore,
    private onTestRoom: (roomId: string) => void
  ) {}

  private get content(): Content {
    return this.store.content;
  }

  private get room(): RoomDef | null {
    return this.roomId ? this.content.rooms[this.roomId] ?? null : null;
  }

  mount(): HTMLElement {
    this.rootEl = el("div", { className: "pp-roomeditor" });
    this.roomListEl = el("div", { className: "pp-roomlist" });
    this.paletteEl = el("div", { className: "pp-palette" });
    this.propsEl = el("div");
    this.inspectorEl = el("div");
    this.canvas = el("canvas", { className: "pp-roomcanvas" });

    const canvasWrap = el("div", { className: "pp-canvaswrap" }, this.canvas);
    this.bindCanvas();

    const sidebar = el(
      "div", { className: "pp-sidebar" },
      el("div", { className: "pp-sidehead" },
        "Rooms",
        el("button", { className: "pp-btn", onclick: () => this.newRoom() }, "+ new")
      ),
      this.roomListEl,
      el("hr"),
      this.propsEl
    );

    const right = el(
      "div", { className: "pp-rightcol" },
      el("div", { className: "pp-sidehead" }, "Inspector"),
      this.inspectorEl
    );

    this.rootEl.append(
      sidebar,
      el("div", { className: "pp-roommain" }, this.paletteEl, canvasWrap),
      right
    );

    this.roomId = this.content.campaign.rooms[0] ?? Object.keys(this.content.rooms)[0] ?? null;
    window.removeEventListener("keydown", this.keyHandler);
    window.addEventListener("keydown", this.keyHandler);
    this.refreshAll();
    return this.rootEl;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.keyHandler);
  }

  // ---------- Undo / redo (snapshot-based) ----------

  /** Snapshot the current room before a mutating operation. */
  private pushUndo(): void {
    const room = this.room;
    if (!room) return;
    this.undoStack.push({ roomId: room.id, data: JSON.stringify(room) });
    if (this.undoStack.length > UNDO_CAP) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Debounced variant for rapid-fire form edits (one snapshot per burst). */
  private pushUndoDebounced(): void {
    const now = performance.now();
    if (now - this.lastFormUndoAt > 900) this.pushUndo();
    this.lastFormUndoAt = now;
  }

  private applySnapshot(
    snap: { roomId: string; data: string },
    intoStack: { roomId: string; data: string }[]
  ): void {
    const current = this.content.rooms[snap.roomId];
    if (current) {
      intoStack.push({ roomId: snap.roomId, data: JSON.stringify(current) });
      if (intoStack.length > UNDO_CAP) intoStack.shift();
    }
    this.content.rooms[snap.roomId] = JSON.parse(snap.data);
    this.roomId = snap.roomId;
    this.selected = null;
    this.markDirty();
    this.refreshAll();
  }

  undo(): void {
    const snap = this.undoStack.pop();
    if (snap) this.applySnapshot(snap, this.redoStack);
  }

  redo(): void {
    const snap = this.redoStack.pop();
    if (snap) this.applySnapshot(snap, this.undoStack);
  }

  private refreshAll(): void {
    this.renderRoomList();
    this.renderPalette();
    this.renderProps();
    this.renderInspector();
    this.renderCanvas();
  }

  // ---------- Sidebar ----------

  private renderRoomList(): void {
    this.roomListEl.replaceChildren();
    for (const id of Object.keys(this.content.rooms)) {
      const inCampaign = this.content.campaign.rooms.includes(id);
      this.roomListEl.append(
        el("div", {
          className: "pp-roomitem" + (id === this.roomId ? " pp-active" : ""),
          onclick: () => {
            this.roomId = id;
            this.selected = null;
            this.refreshAll();
          },
        }, `${inCampaign ? "" : "· "}${id}`)
      );
    }
  }

  private renderProps(): void {
    this.propsEl.replaceChildren();
    const room = this.room;
    if (!room) return;
    this.propsEl.append(
      el("div", { className: "pp-sidehead" }, "Room"),
      autoForm(room as unknown as Record<string, unknown>, () => {
        this.markDirty();
        this.normalizeTiles();
        this.renderCanvas();
      }, ["tiles", "entities", "id"], () => this.pushUndoDebounced()),
      el("div", { className: "pp-btnrow" },
        el("button", { className: "pp-btn pp-primary", onclick: () => this.save() }, "Save room"),
        el("button", { className: "pp-btn", onclick: () => this.onTestRoom(room.id) }, "▶ Test"),
        el("button", { className: "pp-btn pp-danger", onclick: () => this.deleteRoom() }, "Delete")
      )
    );
  }

  private renderPalette(): void {
    this.paletteEl.replaceChildren();
    const mk = (label: string, active: boolean, cb: () => void, title = "") =>
      el("button", {
        className: "pp-tool" + (active ? " pp-active" : ""),
        title, onclick: cb,
      }, label);

    this.paletteEl.append(
      mk("select", this.tool.kind === "select", () => this.setTool({ kind: "select" })),
      mk("erase", this.tool.kind === "erase", () => this.setTool({ kind: "erase" }))
    );
    for (const t of this.content.tiles) {
      const active = this.tool.kind === "tile" && this.tool.char === t.char;
      const b = mk(t.name, active, () => this.setTool({ kind: "tile", char: t.char }), `char '${t.char}'`);
      b.style.borderBottom = `3px solid ${t.color}`;
      this.paletteEl.append(b);
    }
    this.paletteEl.append(el("span", { className: "pp-sep" }, "|"));
    for (const et of ENTITY_TYPES) {
      const active = this.tool.kind === "entity" && this.tool.type === et;
      this.paletteEl.append(mk(et, active, () => this.setTool({ kind: "entity", type: et })));
    }
    this.paletteEl.append(
      el("span", { className: "pp-sep" }, "|"),
      mk("zoom " + this.zoom + "x", false, () => {
        this.zoom = this.zoom === 2 ? 1 : this.zoom === 1 ? 3 : 2;
        this.renderPalette();
        this.renderCanvas();
      })
    );
  }

  // ---------- Canvas ----------

  private bindCanvas(): void {
    this.canvas.addEventListener("mousedown", (e) => {
      const { tx, ty, wx, wy } = this.mousePos(e);
      if (this.tool.kind === "tile" || this.tool.kind === "erase") {
        this.pushUndo(); // one snapshot per paint stroke
        this.painting = true;
        this.paintAt(tx, ty);
      } else if (this.tool.kind === "entity") {
        this.placeEntity(this.tool.type, tx, ty);
      } else {
        this.selected = this.entityAt(wx, wy);
        if (this.selected) this.pushUndo(); // pre-drag position
        this.draggingEntity = !!this.selected;
        this.renderInspector();
        this.renderCanvas();
      }
    });
    this.canvas.addEventListener("mousemove", (e) => {
      const { tx, ty } = this.mousePos(e);
      if (this.painting) this.paintAt(tx, ty);
      else if (this.draggingEntity && this.selected) {
        if (this.selected.x !== tx || this.selected.y !== ty) {
          this.selected.x = tx;
          this.selected.y = ty;
          this.markDirty();
          this.renderInspector();
          this.renderCanvas();
        }
      }
    });
    window.addEventListener("mouseup", () => {
      this.painting = false;
      this.draggingEntity = false;
    });
  }

  private mousePos(e: MouseEvent): { tx: number; ty: number; wx: number; wy: number } {
    const rect = this.canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left) / this.zoom;
    const wy = (e.clientY - rect.top) / this.zoom;
    return { wx, wy, tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE) };
  }

  private paintAt(tx: number, ty: number): void {
    const room = this.room;
    if (!room) return;
    if (tx < 0 || ty < 0 || tx >= room.width || ty >= room.height) return;
    const ch = this.tool.kind === "tile" ? this.tool.char : ".";
    const row = (room.tiles[ty] ?? "").padEnd(room.width, ".");
    if (row[tx] === ch) return;
    room.tiles[ty] = row.slice(0, tx) + ch + row.slice(tx + 1);
    this.markDirty();
    this.renderCanvas();
  }

  private entityAt(wx: number, wy: number): RoomEntity | null {
    const room = this.room;
    if (!room) return null;
    // Walk backwards so the most recently placed wins.
    for (let i = room.entities.length - 1; i >= 0; i--) {
      const en = room.entities[i];
      const ex = en.x * TILE;
      const ey = en.y * TILE;
      if (wx >= ex - 8 && wx <= ex + 24 && wy >= ey - 24 && wy <= ey + 16) return en;
    }
    return null;
  }

  private placeEntity(type: RoomEntity["type"], tx: number, ty: number): void {
    const room = this.room;
    if (!room) return;
    const firstMaterial = this.content.items.find((i) => i.kind === "material")?.id ?? "";
    const firstEnemy = this.content.enemies[0]?.id ?? "";
    const defaults: Record<string, Partial<RoomEntity>> = {
      pickup: { item: firstMaterial, count: 1 },
      note: { text: "A note.", recipe: "" },
      hint: { text: "hint text here" },
      door: { to: "next", gate: false, fuseId: "" },
      fusebox: { fuseId: "A" },
      enemy: { enemy: firstEnemy, patrolMinX: tx - 3, patrolMaxX: tx + 3 },
      npc: {
        name: "Prisoner", color: "#7fd8e8",
        wants: { item: firstMaterial, count: 1 },
        rewardItems: [], rewardRecipes: [],
        dialogAsk: "Hey.", dialogDone: "Thanks!", dialogAfter: "Good luck.",
      },
    };
    this.pushUndo();
    const entity: RoomEntity = { type, x: tx, y: ty, ...(defaults[type] ?? {}) } as RoomEntity;
    room.entities.push(entity);
    this.selected = entity;
    this.markDirty();
    this.renderInspector();
    this.renderCanvas();
  }

  private renderInspector(): void {
    this.inspectorEl.replaceChildren();
    const room = this.room;
    if (!room) return;
    if (!this.selected) {
      this.inspectorEl.append(
        el("p", { className: "pp-hint" },
          "Select tool + click an entity to edit it. Entity tools place new ones. " +
          "Drag to move. Ctrl+Z / Ctrl+Y — undo / redo.")
      );
      return;
    }
    const sel = this.selected;
    this.inspectorEl.append(
      el("div", { className: "pp-hint" }, `${sel.type} @ ${sel.x},${sel.y}`),
      autoForm(sel as unknown as Record<string, unknown>, () => {
        this.markDirty();
        this.renderCanvas();
      }, SPRITE_KEYS, () => this.pushUndoDebounced()),
      sel.type === "npc" ? this.npcPortraitRow(sel) : el("span", {}),
      sel.type === "npc" ? this.npcSpriteRow(sel) : el("span", {}),
      el("div", { className: "pp-btnrow" },
        el("button", {
          className: "pp-btn pp-danger",
          onclick: () => {
            this.pushUndo();
            room.entities = room.entities.filter((e) => e !== sel);
            this.selected = null;
            this.markDirty();
            this.renderInspector();
            this.renderCanvas();
          },
        }, "Delete entity")
      )
    );
  }

  /** Upload / pixel-edit / clear this NPC's in-room body sprite (walk-cycle
   *  capable) — distinct from the single-frame dialog portrait below. */
  private npcSpriteRow(sel: RoomEntity): HTMLElement {
    const preview = el("canvas", { width: 40, height: 40, className: "pp-spritepreview" });
    const drawPreview = () => {
      const ctx = preview.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 40, 40);
      const s = 40 / Math.max(NPC_W, NPC_H);
      drawBlob(
        ctx, (40 - NPC_W * s) / 2, 40 - NPC_H * s, NPC_W * s, NPC_H * s,
        sel.color ?? "#7fd8e8", "#1a2530", -1,
        { eyeStyle: "wide", sprite: sel }
      );
    };
    drawPreview();
    const frames = sel.spriteFrames ?? (sel.sprite ? [sel.sprite] : []);
    const apply = (newFrames: string[], fps: number) => {
      if (newFrames.length > 1) {
        sel.spriteFrames = newFrames;
        sel.spriteFps = fps;
        delete sel.sprite;
      } else {
        sel.sprite = newFrames[0];
        delete sel.spriteFrames;
        delete sel.spriteFps;
      }
      this.markDirty();
      this.renderInspector();
    };
    return el(
      "div", { className: "pp-spritepanel" },
      preview,
      el("span", { className: "pp-hint" },
        `body sprite — ${frames.length > 1 ? frames.length + " frames" : frames.length === 1 ? "1 image" : "procedural (none set)"}`),
      el("button", {
        className: "pp-btn",
        onclick: () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/png,image/gif,image/webp";
          input.onchange = () => {
            const f = input.files?.[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => { this.pushUndo(); apply([r.result as string], 6); };
            r.readAsDataURL(f);
          };
          input.click();
        },
      }, "Upload PNG"),
      el("button", {
        className: "pp-btn",
        onclick: () => {
          this.pushUndo();
          const seed = frames.length === 0
            ? [rasterize(16, (ctx) => {
                const s = 16 / Math.max(NPC_W, NPC_H);
                ctx.translate((16 - NPC_W * s) / 2, 16 - NPC_H * s);
                ctx.scale(s, s);
                drawBlob(ctx, 0, 0, NPC_W, NPC_H, sel.color ?? "#7fd8e8", "#1a2530", 1, { eyeStyle: "wide" });
              })]
            : frames;
          openPixelEditor({
            title: `${sel.name ?? "NPC"} body sprite (16x16)`,
            size: 16,
            frames: seed,
            fps: sel.spriteFps ?? 6,
            multiFrame: true,
            onSave: apply,
          });
        },
      }, "Pixel editor"),
      el("button", {
        className: "pp-btn pp-danger",
        onclick: () => {
          this.pushUndo();
          delete sel.sprite;
          delete sel.spriteFrames;
          delete sel.spriteFps;
          this.markDirty();
          this.renderInspector();
        },
      }, "Clear")
    );
  }

  /** Upload / pixel-edit / clear a custom dialog portrait on an NPC. */
  private npcPortraitRow(sel: RoomEntity): HTMLElement {
    return el("div", { className: "pp-btnrow" },
      el("span", { className: "pp-hint" },
        sel.portrait ? "portrait: custom" : "portrait: auto"),
      el("button", {
        className: "pp-btn",
        onclick: () =>
          openPixelEditor({
            title: `${sel.name ?? "NPC"} portrait (32x32)`,
            size: 32,
            frames: sel.portrait ? [sel.portrait] : [],
            fps: 6,
            multiFrame: false,
            onSave: (frames) => {
              this.pushUndo();
              sel.portrait = frames[0];
              this.markDirty();
              this.renderInspector();
            },
          }),
      }, "portrait"),
      el("button", {
        className: "pp-btn pp-danger",
        onclick: () => {
          this.pushUndo();
          delete sel.portrait;
          this.markDirty();
          this.renderInspector();
        },
      }, "✕"),
    );
  }

  private normalizeTiles(): void {
    const room = this.room;
    if (!room) return;
    room.width = Math.max(10, Math.round(room.width));
    room.height = Math.max(8, Math.round(room.height));
    const rows: string[] = [];
    for (let y = 0; y < room.height; y++) {
      rows.push((room.tiles[y] ?? "").padEnd(room.width, ".").slice(0, room.width));
    }
    room.tiles = rows;
  }

  private renderCanvas(): void {
    const room = this.room;
    if (!room) return;
    this.normalizeTiles();
    this.canvas.width = room.width * TILE * this.zoom;
    this.canvas.height = room.height * TILE * this.zoom;
    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(this.zoom, 0, 0, this.zoom, 0, 0);
    ctx.fillStyle = room.background;
    ctx.fillRect(0, 0, room.width * TILE, room.height * TILE);

    // Real runtime preview: same rendering the game uses.
    const emptyMuts = {
      collected: new Set<number>(), tileOverrides: [], openedDoors: new Set<number>(),
      helpedNpcs: new Set<number>(), disabledEnemies: new Set<number>(), bundles: [],
      placedItems: [],
    };
    try {
      const rt = new RoomRuntime(room, this.content, emptyMuts);
      drawMap(ctx, rt.map, 0, 0, room.width * TILE, room.height * TILE, 0);
      rt.draw(ctx, 0);
      this.drawOverlays(ctx, room, rt.spawnX, rt.spawnY);
    } catch (err) {
      console.error("Room preview failed", err);
    }
  }

  private drawOverlays(
    ctx: CanvasRenderingContext2D, room: RoomDef, spawnX: number, spawnY: number
  ): void {
    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1 / this.zoom;
    for (let x = 0; x <= room.width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * TILE, 0);
      ctx.lineTo(x * TILE, room.height * TILE);
      ctx.stroke();
    }
    for (let y = 0; y <= room.height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * TILE);
      ctx.lineTo(room.width * TILE, y * TILE);
      ctx.stroke();
    }
    // Spawn marker
    ctx.fillStyle = "#ffd166";
    ctx.font = "8px monospace";
    ctx.fillText("SPAWN", spawnX - 12, spawnY - 18);
    ctx.strokeStyle = "#ffd166";
    ctx.strokeRect(spawnX - 6, spawnY - 14, 12, 14);
    // Entity markers (small labels; runtime preview already drew visuals)
    for (const e of room.entities) {
      const x = e.x * TILE;
      const y = e.y * TILE;
      if (e === this.selected) {
        ctx.strokeStyle = "#ff5470";
        ctx.lineWidth = 2 / this.zoom;
        ctx.strokeRect(x - 2, y - 2, TILE + 4, TILE + 4);
      }
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "6px monospace";
      ctx.fillText(e.type.slice(0, 4), x, y - 2);
    }
  }

  // ---------- Actions ----------

  private setTool(t: Tool): void {
    this.tool = t;
    this.renderPalette();
  }

  private markDirty(): void {
    this.dirty = true;
  }

  async save(): Promise<void> {
    const room = this.room;
    if (!room) return;
    this.normalizeTiles();
    await this.store.saveFile(`rooms/${room.id}.json`, room);
    this.dirty = false;
    toast(`Saved rooms/${room.id}.json`);
  }

  private async newRoom(): Promise<void> {
    const id = prompt("New room id (kebab_case):");
    if (!id || !/^[a-z0-9_]+$/.test(id)) {
      if (id) toast("Use lowercase letters, digits, underscores.", false);
      return;
    }
    if (this.content.rooms[id]) {
      toast("Room id already exists.", false);
      return;
    }
    const w = 40, h = 24;
    const rows: string[] = [];
    for (let y = 0; y < h; y++) {
      if (y === 0 || y >= h - 3) rows.push("#".repeat(w));
      else rows.push("#" + ".".repeat(w - 2) + "#");
    }
    const room: RoomDef = {
      id, name: id, width: w, height: h, background: "#17131f",
      tiles: rows,
      entities: [
        { type: "spawn", x: 3, y: h - 5 },
        { type: "door", x: w - 3, y: h - 6, to: "next" },
      ],
    };
    await this.store.saveFile(`rooms/${id}.json`, room);
    this.roomId = id;
    this.selected = null;
    this.refreshAll();
    toast(`Created ${id}. Add it to the campaign order when ready.`);
  }

  private async deleteRoom(): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (!confirm(`Delete room "${room.id}"? This removes the file.`)) return;
    await this.store.deleteFile(`rooms/${room.id}.json`);
    const camp = this.content.campaign;
    if (camp.rooms.includes(room.id)) {
      camp.rooms = camp.rooms.filter((r) => r !== room.id);
      await this.store.saveFile("campaign.json", camp);
    }
    this.roomId = Object.keys(this.content.rooms)[0] ?? null;
    this.selected = null;
    this.refreshAll();
    toast("Room deleted.");
  }
}
