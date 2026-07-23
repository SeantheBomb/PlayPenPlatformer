// Room editor tab: tile painting, entity placement, inspector, test-play.
import type { Content, RoomDef, RoomEntity } from "../data/types";
import type { ContentStore } from "../data/content";
import { TILE } from "../engine/tilemap";
import { drawBlob, drawMap } from "../engine/renderer";
import { RoomRuntime } from "../game/room";
import { autoForm, el, fieldOptionsFor, toast } from "./forms";
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
  | { kind: "entity"; type: RoomEntity["type"] }
  | { kind: "marquee" };

const ENTITY_TYPES: RoomEntity["type"][] = [
  "spawn", "checkpoint", "pickup", "note", "door", "locker", "enemy", "npc",
  "exit", "hint", "brazier", "fusebox",
];

const UNDO_CAP = 50;

interface TileBox { x0: number; y0: number; x1: number; y1: number; }

interface GroupClip {
  w: number;
  h: number;
  tiles: string[];
  entities: { dx: number; dy: number; entity: RoomEntity }[];
}

const ROOM_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "Small — 24×14", w: 24, h: 14 },
  { label: "Medium — 44×24", w: 44, h: 24 },
  { label: "Large — 64×32", w: 64, h: 32 },
  { label: "Wide — 80×20", w: 80, h: 20 },
  { label: "Tall — 32×48", w: 32, h: 48 },
];

export class RoomEditor {
  private roomId: string | null = null;
  private tool: Tool = { kind: "select" };
  private zoom = 2;
  private selected: RoomEntity | null = null;
  private clipboard: RoomEntity | null = null;
  private painting = false;
  private draggingEntity = false;
  private draggingHandle: "min" | "max" | null = null;
  // Brush (freehand tile painting)
  private brushShape: "square" | "circle" = "square";
  private brushSize = 1; // 1 = single tile
  // Rectangle paint mode (tile/erase tools)
  private paintMode: "freehand" | "rect" = "freehand";
  private rectStart: { tx: number; ty: number } | null = null;
  private rectCurrent: { tx: number; ty: number } | null = null;
  // Box select (marquee tool): a tile-region + the entities inside it,
  // draggable as a group and copy/pasteable as a unit.
  private groupBox: TileBox | null = null;
  private groupEntities: RoomEntity[] = [];
  private groupClipboard: GroupClip | null = null;
  private marqueeStart: { tx: number; ty: number } | null = null;
  private marqueeCurrent: { tx: number; ty: number } | null = null;
  private draggingGroup = false;
  private groupDragStart: { tx: number; ty: number } | null = null;
  private groupDragOffset = { dx: 0, dy: 0 };
  private lastCopyKind: "entity" | "group" | null = null;
  private dirty = false;
  private undoStack: { roomId: string; data: string }[] = [];
  private redoStack: { roomId: string; data: string }[] = [];
  private lastFormUndoAt = 0;
  private keyHandler = (e: KeyboardEvent) => {
    if (!document.body.contains(this.rootEl)) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return; // native undo/copy in fields
    if (e.ctrlKey && !e.shiftKey && e.code === "KeyZ") {
      e.preventDefault();
      this.undo();
    } else if ((e.ctrlKey && e.code === "KeyY") || (e.ctrlKey && e.shiftKey && e.code === "KeyZ")) {
      e.preventDefault();
      this.redo();
    } else if (e.ctrlKey && e.code === "KeyC") {
      e.preventDefault();
      if (this.groupBox) this.copyGroup(); else this.copySelected();
    } else if (e.ctrlKey && e.code === "KeyV") {
      e.preventDefault();
      if (this.lastCopyKind === "group" && this.groupClipboard) this.pasteGroup();
      else this.pasteClipboard();
    } else if (e.ctrlKey && e.code === "KeyD" && (this.selected || this.groupBox)) {
      e.preventDefault();
      if (this.groupBox) { this.copyGroup(); this.pasteGroup(); }
      else { this.copySelected(); this.pasteClipboard(); }
    } else if ((e.code === "Delete" || e.code === "Backspace") && this.groupBox) {
      e.preventDefault();
      this.deleteGroup();
    }
  };

  /** Clears every selection mode — used whenever a room/room-data swap could
   *  leave stale entity references (undo/redo, room switch, delete). */
  private clearSelection(): void {
    this.selected = null;
    this.groupBox = null;
    this.groupEntities = [];
  }

  /** Deep-clone the selected entity onto the clipboard — every field carries
   *  over (including sprite/portrait overrides), ready to paste elsewhere. */
  private copySelected(): void {
    if (!this.selected) return;
    this.clipboard = JSON.parse(JSON.stringify(this.selected)) as RoomEntity;
    this.lastCopyKind = "entity";
    toast(`Copied ${this.clipboard.type}`);
  }

  /** Paste the clipboard entity into the current room, offset one tile so it
   *  doesn't land exactly on top of its source, then select the copy. */
  private pasteClipboard(): void {
    const room = this.room;
    if (!room || !this.clipboard) return;
    this.pushUndo();
    const copy = JSON.parse(JSON.stringify(this.clipboard)) as RoomEntity;
    copy.x += 1;
    copy.y += 1;
    room.entities.push(copy);
    this.selected = copy;
    this.markDirty();
    this.renderInspector();
    this.renderCanvas();
    toast(`Pasted ${copy.type}`);
  }

  // ---------- Box select (marquee): tile region + entities as one group ----------

  private extractSubgrid(room: RoomDef, box: TileBox): string[] {
    const w = box.x1 - box.x0 + 1;
    const rows: string[] = [];
    for (let ty = box.y0; ty <= box.y1; ty++) {
      const row = (room.tiles[ty] ?? "").padEnd(room.width, ".");
      rows.push(row.slice(box.x0, box.x1 + 1).padEnd(w, "."));
    }
    return rows;
  }

  private stampSubgrid(room: RoomDef, ox: number, oy: number, tiles: string[]): void {
    for (let ry = 0; ry < tiles.length; ry++) {
      const ty = oy + ry;
      if (ty < 0 || ty >= room.height) continue;
      let row = (room.tiles[ty] ?? "").padEnd(room.width, ".");
      for (let rx = 0; rx < tiles[ry].length; rx++) {
        const tx = ox + rx;
        if (tx < 0 || tx >= room.width) continue;
        row = row.slice(0, tx) + tiles[ry][rx] + row.slice(tx + 1);
      }
      room.tiles[ty] = row;
    }
  }

  private clearSubgrid(room: RoomDef, box: TileBox): void {
    const blank = ".".repeat(box.x1 - box.x0 + 1);
    this.stampSubgrid(room, box.x0, box.y0, new Array(box.y1 - box.y0 + 1).fill(blank));
  }

  /** Commit a group drag: cut the tile region from its old spot, restamp it
   *  at the new one, and shift every contained entity by the same delta. */
  private commitGroupMove(dx: number, dy: number): void {
    const room = this.room;
    if (!room || !this.groupBox || (dx === 0 && dy === 0)) return;
    this.pushUndo();
    const snapshot = this.extractSubgrid(room, this.groupBox);
    this.clearSubgrid(room, this.groupBox);
    const newBox: TileBox = {
      x0: this.groupBox.x0 + dx, y0: this.groupBox.y0 + dy,
      x1: this.groupBox.x1 + dx, y1: this.groupBox.y1 + dy,
    };
    this.stampSubgrid(room, newBox.x0, newBox.y0, snapshot);
    for (const e of this.groupEntities) { e.x += dx; e.y += dy; }
    this.groupBox = newBox;
    this.markDirty();
    this.normalizeTiles();
    this.refreshAll();
  }

  private copyGroup(): void {
    const room = this.room;
    if (!room || !this.groupBox) return;
    const { x0, y0, x1, y1 } = this.groupBox;
    const tiles = this.extractSubgrid(room, this.groupBox);
    const entities = this.groupEntities.map((e) => ({
      dx: e.x - x0, dy: e.y - y0, entity: JSON.parse(JSON.stringify(e)) as RoomEntity,
    }));
    this.groupClipboard = { w: x1 - x0 + 1, h: y1 - y0 + 1, tiles, entities };
    this.lastCopyKind = "group";
    toast(`Copied ${this.groupClipboard.w}×${this.groupClipboard.h} selection (${entities.length} entities)`);
  }

  /** Paste the group clipboard offset one tile from the current box (or the
   *  origin, if nothing is selected), then select the pasted copy as the
   *  new group so it can be dragged straight into place. */
  private pasteGroup(): void {
    const room = this.room;
    if (!room || !this.groupClipboard) return;
    this.pushUndo();
    const { w, h, tiles, entities } = this.groupClipboard;
    const ox = (this.groupBox?.x0 ?? 0) + 1;
    const oy = (this.groupBox?.y0 ?? 0) + 1;
    this.stampSubgrid(room, ox, oy, tiles);
    const newEntities: RoomEntity[] = [];
    for (const { dx, dy, entity } of entities) {
      const copy = JSON.parse(JSON.stringify(entity)) as RoomEntity;
      copy.x = ox + dx;
      copy.y = oy + dy;
      room.entities.push(copy);
      newEntities.push(copy);
    }
    this.groupBox = { x0: ox, y0: oy, x1: ox + w - 1, y1: oy + h - 1 };
    this.groupEntities = newEntities;
    this.markDirty();
    this.normalizeTiles();
    this.refreshAll();
    toast(`Pasted ${w}×${h} selection`);
  }

  private deleteGroup(): void {
    const room = this.room;
    if (!room || !this.groupBox) return;
    this.pushUndo();
    this.clearSubgrid(room, this.groupBox);
    const toRemove = new Set(this.groupEntities);
    room.entities = room.entities.filter((e) => !toRemove.has(e));
    this.groupBox = null;
    this.groupEntities = [];
    this.markDirty();
    this.normalizeTiles();
    this.refreshAll();
  }

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
    this.clearSelection();
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
            this.clearSelection();
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

    const wInput = el("input", { type: "number", min: 10, value: room.width });
    const hInput = el("input", { type: "number", min: 8, value: room.height });
    const presetSelect = el("select", {
      onchange: (e) => {
        const sel = e.target as HTMLSelectElement;
        const preset = ROOM_PRESETS.find((p) => p.label === sel.value);
        sel.value = "";
        if (preset) this.resizeRoom(preset.w, preset.h);
      },
    },
      el("option", { value: "" }, "Choose a preset…"),
      ...ROOM_PRESETS.map((p) => el("option", { value: p.label }, p.label))
    );

    this.propsEl.append(
      el("div", { className: "pp-sidehead" }, "Room"),
      autoForm(room as unknown as Record<string, unknown>, () => {
        this.markDirty();
        this.renderCanvas();
      }, ["tiles", "entities", "id", "width", "height"], () => this.pushUndoDebounced(), fieldOptionsFor(this.content)),
      el("div", { className: "pp-sidehead", style: "margin-top:10px" }, "Size"),
      el("p", { className: "pp-hint" },
        `Currently ${room.width} × ${room.height} tiles. Shrinking warns first — nothing ` +
        "outside the new bounds is deleted without confirming."),
      el("div", { className: "pp-form" },
        el("div", { className: "pp-row" }, el("label", {}, "preset"), presetSelect),
        el("div", { className: "pp-row" },
          el("label", {}, "custom"),
          wInput, el("span", { className: "pp-hint" }, "×"), hInput,
          el("button", {
            className: "pp-btn",
            onclick: () => this.resizeRoom(
              parseInt((wInput as HTMLInputElement).value) || room.width,
              parseInt((hInput as HTMLInputElement).value) || room.height
            ),
          }, "Apply")
        )
      ),
      el("div", { className: "pp-btnrow" },
        el("button", { className: "pp-btn pp-primary", onclick: () => this.save() }, "Save room"),
        el("button", { className: "pp-btn", onclick: () => this.onTestRoom(room.id) }, "▶ Test"),
        el("button", { className: "pp-btn pp-danger", onclick: () => this.deleteRoom() }, "Delete")
      )
    );
  }

  /** Resize the room, warning (once, with a count) before any shrink that
   *  would cut off painted tiles or entities — instead of silently
   *  truncating them the moment a smaller number is typed. */
  private resizeRoom(newW: number, newH: number): void {
    const room = this.room;
    if (!room) return;
    newW = Math.max(10, Math.round(newW));
    newH = Math.max(8, Math.round(newH));
    if (newW === room.width && newH === room.height) return;

    if (newW < room.width || newH < room.height) {
      let tilesLost = 0;
      for (let y = 0; y < room.height; y++) {
        const row = room.tiles[y] ?? "";
        for (let x = 0; x < row.length; x++) {
          if ((x >= newW || y >= newH) && row[x] !== "." && row[x] !== undefined) tilesLost++;
        }
      }
      const entitiesLost = room.entities.filter((e) => e.x >= newW || e.y >= newH).length;
      if (tilesLost > 0 || entitiesLost > 0) {
        const parts: string[] = [];
        if (tilesLost > 0) parts.push(`${tilesLost} painted tile${tilesLost === 1 ? "" : "s"}`);
        if (entitiesLost > 0) parts.push(`${entitiesLost} entit${entitiesLost === 1 ? "y" : "ies"}`);
        if (!confirm(`Shrinking to ${newW}×${newH} will delete ${parts.join(" and ")} outside the new bounds. Continue?`)) {
          return;
        }
      }
    }

    this.pushUndo();
    const rows: string[] = [];
    for (let y = 0; y < newH; y++) {
      rows.push((room.tiles[y] ?? "").padEnd(newW, ".").slice(0, newW));
    }
    room.tiles = rows;
    room.width = newW;
    room.height = newH;
    room.entities = room.entities.filter((e) => e.x < newW && e.y < newH);
    this.clearSelection();
    this.markDirty();
    this.refreshAll();
    toast(`Resized to ${newW}×${newH}`);
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
      mk("▭ box select", this.tool.kind === "marquee", () => this.setTool({ kind: "marquee" }),
        "drag to select a region · drag inside to move · Ctrl+C/V to copy/paste"),
      mk("erase", this.tool.kind === "erase", () => this.setTool({ kind: "erase" }))
    );
    for (const t of this.content.tiles) {
      const active = this.tool.kind === "tile" && this.tool.char === t.char;
      const b = mk(t.name, active, () => this.setTool({ kind: "tile", char: t.char }), `char '${t.char}'`);
      b.style.borderBottom = `3px solid ${t.color}`;
      this.paletteEl.append(b);
    }
    if (this.tool.kind === "tile" || this.tool.kind === "erase") {
      this.paletteEl.append(
        el("span", { className: "pp-sep" }, "|"),
        mk("freehand", this.paintMode === "freehand", () => { this.paintMode = "freehand"; this.renderPalette(); },
          "paint one stroke at a time"),
        mk("▭ rectangle", this.paintMode === "rect", () => { this.paintMode = "rect"; this.renderPalette(); },
          "drag out a rectangle, release to fill it")
      );
      if (this.paintMode === "freehand") {
        this.paletteEl.append(
          el("span", { className: "pp-sep" }, "|"),
          mk("■", this.brushShape === "square", () => { this.brushShape = "square"; this.renderPalette(); }, "square brush"),
          mk("●", this.brushShape === "circle", () => { this.brushShape = "circle"; this.renderPalette(); }, "circle brush"),
          el("input", {
            type: "number", min: 1, max: 12, value: this.brushSize, title: "brush radius (tiles)",
            style: "width:40px;padding:3px 4px;font-size:11px;background:#100e1a;color:#e8e2f4;" +
              "border:1px solid #3a3550;border-radius:4px;",
            oninput: (e) => {
              this.brushSize = Math.max(1, Math.min(12, parseInt((e.target as HTMLInputElement).value) || 1));
            },
          })
        );
      }
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
        if (this.paintMode === "rect") {
          this.rectStart = { tx, ty };
          this.rectCurrent = { tx, ty };
          this.renderCanvas();
        } else {
          this.pushUndo(); // one snapshot per paint stroke
          this.painting = true;
          this.paintAt(tx, ty);
        }
      } else if (this.tool.kind === "entity") {
        this.placeEntity(this.tool.type, tx, ty);
      } else if (this.tool.kind === "marquee") {
        if (this.groupBox && tx >= this.groupBox.x0 && tx <= this.groupBox.x1 &&
            ty >= this.groupBox.y0 && ty <= this.groupBox.y1) {
          this.draggingGroup = true;
          this.groupDragStart = { tx, ty };
          this.groupDragOffset = { dx: 0, dy: 0 };
        } else {
          this.marqueeStart = { tx, ty };
          this.marqueeCurrent = { tx, ty };
          this.groupBox = null;
          this.groupEntities = [];
          this.renderInspector();
        }
        this.renderCanvas();
      } else {
        const handle = this.patrolHandleAt(wx, wy);
        if (handle) {
          this.pushUndo();
          this.draggingHandle = handle;
        } else {
          this.selected = this.entityAt(wx, wy);
          this.groupBox = null;
          this.groupEntities = [];
          if (this.selected) this.pushUndo(); // pre-drag position
          this.draggingEntity = !!this.selected;
        }
        this.renderInspector();
        this.renderCanvas();
      }
    });
    this.canvas.addEventListener("mousemove", (e) => {
      const { tx, ty, wx } = this.mousePos(e);
      if (this.rectStart) {
        this.rectCurrent = { tx, ty };
        this.renderCanvas();
      } else if (this.painting) {
        this.paintAt(tx, ty);
      } else if (this.marqueeStart) {
        this.marqueeCurrent = { tx, ty };
        this.renderCanvas();
      } else if (this.draggingGroup && this.groupDragStart) {
        const dx = tx - this.groupDragStart.tx, dy = ty - this.groupDragStart.ty;
        if (dx !== this.groupDragOffset.dx || dy !== this.groupDragOffset.dy) {
          this.groupDragOffset = { dx, dy };
          this.renderCanvas();
        }
      } else if (this.draggingHandle && this.selected) {
        const newTx = Math.round(wx / TILE);
        if (this.draggingHandle === "min") {
          this.selected.patrolMinX = Math.min(newTx, this.selected.patrolMaxX ?? newTx);
        } else {
          this.selected.patrolMaxX = Math.max(newTx, this.selected.patrolMinX ?? newTx);
        }
        this.markDirty();
        this.renderInspector();
        this.renderCanvas();
      } else if (this.draggingEntity && this.selected) {
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
      if (this.rectStart && this.rectCurrent) {
        this.pushUndo();
        this.paintRect(this.rectStart.tx, this.rectStart.ty, this.rectCurrent.tx, this.rectCurrent.ty);
      }
      this.rectStart = null;
      this.rectCurrent = null;
      if (this.marqueeStart && this.marqueeCurrent) {
        const x0 = Math.min(this.marqueeStart.tx, this.marqueeCurrent.tx);
        const x1 = Math.max(this.marqueeStart.tx, this.marqueeCurrent.tx);
        const y0 = Math.min(this.marqueeStart.ty, this.marqueeCurrent.ty);
        const y1 = Math.max(this.marqueeStart.ty, this.marqueeCurrent.ty);
        this.groupBox = { x0, y0, x1, y1 };
        const room = this.room;
        this.groupEntities = room
          ? room.entities.filter((e) => e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1)
          : [];
        this.renderInspector();
        this.renderCanvas();
      }
      this.marqueeStart = null;
      this.marqueeCurrent = null;
      if (this.draggingGroup) {
        this.commitGroupMove(this.groupDragOffset.dx, this.groupDragOffset.dy);
      }
      this.draggingGroup = false;
      this.groupDragStart = null;
      this.groupDragOffset = { dx: 0, dy: 0 };
      this.painting = false;
      this.draggingEntity = false;
      this.draggingHandle = null;
    });
  }

  /** World-pixel span of an enemy's patrol gizmo, or null if not applicable. */
  private patrolGizmo(sel: RoomEntity): { minX: number; maxX: number; y: number } | null {
    if (sel.type !== "enemy") return null;
    const minTx = sel.patrolMinX ?? sel.x - 3;
    const maxTx = sel.patrolMaxX ?? sel.x + 3;
    return { minX: minTx * TILE, maxX: maxTx * TILE, y: sel.y * TILE + TILE / 2 };
  }

  private patrolHandleAt(wx: number, wy: number): "min" | "max" | null {
    if (!this.selected) return null;
    const g = this.patrolGizmo(this.selected);
    if (!g) return null;
    const r = 6;
    if (Math.hypot(wx - g.minX, wy - (g.y - 10)) <= r) return "min";
    if (Math.hypot(wx - g.maxX, wy - (g.y - 10)) <= r) return "max";
    return null;
  }

  private mousePos(e: MouseEvent): { tx: number; ty: number; wx: number; wy: number } {
    const rect = this.canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left) / this.zoom;
    const wy = (e.clientY - rect.top) / this.zoom;
    return { wx, wy, tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE) };
  }

  /** Sets one cell, in place. Returns whether anything actually changed. */
  private setTileChar(room: RoomDef, tx: number, ty: number, ch: string): boolean {
    if (tx < 0 || ty < 0 || tx >= room.width || ty >= room.height) return false;
    const row = (room.tiles[ty] ?? "").padEnd(room.width, ".");
    if (row[tx] === ch) return false;
    room.tiles[ty] = row.slice(0, tx) + ch + row.slice(tx + 1);
    return true;
  }

  /** Freehand paint at (tx,ty), stamping the current brush shape/size. */
  private paintAt(tx: number, ty: number): void {
    const room = this.room;
    if (!room) return;
    const ch = this.tool.kind === "tile" ? this.tool.char : ".";
    const r = this.brushSize - 1;
    let changed = false;
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (this.brushShape === "circle" && Math.hypot(ox, oy) > r + 0.35) continue;
        if (this.setTileChar(room, tx + ox, ty + oy, ch)) changed = true;
      }
    }
    if (changed) { this.markDirty(); this.renderCanvas(); }
  }

  /** Fill the axis-aligned rectangle between two tile corners (inclusive)
   *  with the current tool's char — the "drag a rectangle" paint mode. */
  private paintRect(x0: number, y0: number, x1: number, y1: number): void {
    const room = this.room;
    if (!room) return;
    const ch = this.tool.kind === "tile" ? this.tool.char : ".";
    const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
    const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
    let changed = false;
    for (let ty = lo.y; ty <= hi.y; ty++) {
      for (let tx = lo.x; tx <= hi.x; tx++) {
        if (this.setTileChar(room, tx, ty, ch)) changed = true;
      }
    }
    if (changed) { this.markDirty(); this.renderCanvas(); }
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
    if (this.groupBox) {
      const w = this.groupBox.x1 - this.groupBox.x0 + 1;
      const h = this.groupBox.y1 - this.groupBox.y0 + 1;
      this.inspectorEl.append(
        el("div", { className: "pp-hint" }, `Selection: ${w}×${h} tiles, ${this.groupEntities.length} entities`),
        el("p", { className: "pp-hint" },
          "Drag inside the box to move it. Ctrl+C / Ctrl+V — copy / paste the whole " +
          "selection. Delete — clear the tiles and remove the entities."),
        el("div", { className: "pp-btnrow" },
          el("button", { className: "pp-btn", onclick: () => this.copyGroup() }, "Copy"),
          el("button", {
            className: "pp-btn",
            onclick: () => { this.copyGroup(); this.pasteGroup(); },
          }, "Duplicate"),
          el("button", { className: "pp-btn pp-danger", onclick: () => this.deleteGroup() }, "Delete selection"),
          el("button", {
            className: "pp-btn",
            onclick: () => { this.clearSelection(); this.renderInspector(); this.renderCanvas(); },
          }, "Clear selection")
        )
      );
      return;
    }
    if (!this.selected) {
      this.inspectorEl.append(
        el("p", { className: "pp-hint" },
          "Select tool + click an entity to edit it. Entity tools place new ones. " +
          "Drag to move. Box select drags out a region of tiles + entities to move, " +
          "copy, or delete as a group. Ctrl+Z / Ctrl+Y — undo / redo. Ctrl+C / Ctrl+V — " +
          "copy / paste (carries every field, including custom sprites).")
      );
      if (this.clipboard) {
        this.inspectorEl.append(
          el("div", { className: "pp-btnrow" },
            el("button", {
              className: "pp-btn",
              onclick: () => this.pasteClipboard(),
            }, `Paste ${this.clipboard.type}`)
          )
        );
      }
      return;
    }
    const sel = this.selected;
    this.inspectorEl.append(
      el("div", { className: "pp-hint" }, `${sel.type} @ ${sel.x},${sel.y}`),
      autoForm(sel as unknown as Record<string, unknown>, () => {
        this.markDirty();
        this.renderCanvas();
      }, SPRITE_KEYS, () => this.pushUndoDebounced(), fieldOptionsFor(this.content)),
      sel.type === "npc" ? this.npcPortraitRow(sel) : el("span", {}),
      sel.type === "npc" ? this.npcSpriteRow(sel) : el("span", {}),
      el("div", { className: "pp-btnrow" },
        el("button", {
          className: "pp-btn",
          onclick: () => { this.copySelected(); this.pasteClipboard(); },
        }, "Duplicate"),
        el("button", {
          className: "pp-btn",
          onclick: () => this.copySelected(),
        }, "Copy"),
        el("button", {
          className: "pp-btn pp-danger",
          onclick: () => {
            this.pushUndo();
            room.entities = room.entities.filter((e) => e !== sel);
            this.clearSelection();
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
      placedItems: [], brazierLit: [],
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
    if (this.selected) this.drawPatrolGizmo(ctx, this.selected);
    this.drawPaintRectPreview(ctx);
    this.drawGroupSelection(ctx);
  }

  /** Live preview of the rectangle a tile/erase drag will fill on release. */
  private drawPaintRectPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.rectStart || !this.rectCurrent) return;
    const tool = this.tool;
    if (tool.kind !== "tile" && tool.kind !== "erase") return;
    const x0 = Math.min(this.rectStart.tx, this.rectCurrent.tx);
    const x1 = Math.max(this.rectStart.tx, this.rectCurrent.tx);
    const y0 = Math.min(this.rectStart.ty, this.rectCurrent.ty);
    const y1 = Math.max(this.rectStart.ty, this.rectCurrent.ty);
    const color = tool.kind === "tile"
      ? (this.content.tiles.find((t) => t.char === tool.char)?.color ?? "#ffffff")
      : "#ff5470";
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.strokeRect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
  }

  /** Marquee drag-in-progress, the committed group box, and a live preview
   *  of where a group drag will land. */
  private drawGroupSelection(ctx: CanvasRenderingContext2D): void {
    if (this.marqueeStart && this.marqueeCurrent) {
      const x0 = Math.min(this.marqueeStart.tx, this.marqueeCurrent.tx);
      const x1 = Math.max(this.marqueeStart.tx, this.marqueeCurrent.tx);
      const y0 = Math.min(this.marqueeStart.ty, this.marqueeCurrent.ty);
      const y1 = Math.max(this.marqueeStart.ty, this.marqueeCurrent.ty);
      ctx.fillStyle = "rgba(155,93,229,0.18)";
      ctx.fillRect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
      ctx.strokeStyle = "#9b5de5";
      ctx.lineWidth = 1.5 / this.zoom;
      ctx.strokeRect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
      return;
    }
    if (!this.groupBox) return;
    const b = this.groupBox;
    ctx.strokeStyle = "#9b5de5";
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.setLineDash([5 / this.zoom, 3 / this.zoom]);
    ctx.strokeRect(b.x0 * TILE, b.y0 * TILE, (b.x1 - b.x0 + 1) * TILE, (b.y1 - b.y0 + 1) * TILE);
    ctx.setLineDash([]);
    const { dx, dy } = this.groupDragOffset;
    if (this.draggingGroup && (dx !== 0 || dy !== 0)) {
      ctx.globalAlpha = 0.7;
      ctx.strokeRect(
        (b.x0 + dx) * TILE, (b.y0 + dy) * TILE,
        (b.x1 - b.x0 + 1) * TILE, (b.y1 - b.y0 + 1) * TILE
      );
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(155,93,229,0.4)";
      for (const e of this.groupEntities) {
        ctx.fillRect((e.x + dx) * TILE, (e.y + dy) * TILE, TILE, TILE);
      }
    }
  }

  /** Draggable minX/maxX handles for a selected enemy's patrol range —
   *  the horizontal span it paces between, at a glance and editable by hand. */
  private drawPatrolGizmo(ctx: CanvasRenderingContext2D, sel: RoomEntity): void {
    const g = this.patrolGizmo(sel);
    if (!g) return;
    const handleY = g.y - 10;
    ctx.strokeStyle = "#7fd8e8";
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.setLineDash([4 / this.zoom, 3 / this.zoom]);
    ctx.beginPath();
    ctx.moveTo(g.minX, g.y);
    ctx.lineTo(g.maxX, g.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [x, active] of [[g.minX, this.draggingHandle === "min"], [g.maxX, this.draggingHandle === "max"]] as const) {
      ctx.strokeStyle = "#7fd8e8";
      ctx.lineWidth = 1.5 / this.zoom;
      ctx.beginPath();
      ctx.moveTo(x, g.y);
      ctx.lineTo(x, handleY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, handleY, active ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = active ? "#ffd166" : "#20304a";
      ctx.fill();
      ctx.stroke();
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
    this.clearSelection();
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
    this.clearSelection();
    this.refreshAll();
    toast("Room deleted.");
  }
}
