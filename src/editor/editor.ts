// PlayPen Editor — hidden behind Ctrl+Shift+E. Every serialized content file
// has a tab here: rooms, tiles, items, recipes, enemies, taunts, game, campaign.
import type { ContentStore } from "../data/content";
import { isElectron, mergedFiles } from "../data/content";
import type { EnemyDef, ItemDef, TileDef, WardenEmotion } from "../data/types";
import type { Game } from "../game/game";
import {
  enemyAttachments, isKnownFn, itemAttachments, knownFnNames, scriptSource, TRIGGERS,
} from "../game/behavior";
import { compileScript, lintScript, type ScriptError } from "../game/penscript";
import {
  currentFrame, drawBlob, drawItemIcon, drawTile, drawWardenPortrait,
} from "../engine/renderer";
import { autoForm, el, fieldOptionsFor, schemaForm, toast, type FieldSpec } from "./forms";
import { RoomEditor } from "./roomeditor";
import { openPixelEditor, rasterize } from "./pixeleditor";
import { renderSessionsTab } from "./sessions";
import { renderReportsTab } from "./reports";

const SPRITE_KEYS = ["sprite", "spriteFrames", "spriteFps", "portraits"];
const EMOTIONS: WardenEmotion[] = ["smug", "gleeful", "annoyed", "bored", "shocked", "proud"];

// Full field schemas — every def shows every knob the engine supports, not
// just the fields it happens to have (a fire tile gets the fluid toggle, a
// water tile gets repels). Optional fields delete their key when emptied.
const TILE_SCHEMA: FieldSpec[] = [
  { key: "id", kind: "string", req: true },
  { key: "char", kind: "string", req: true, hint: "one character, used in room maps" },
  { key: "name", kind: "string", req: true },
  { key: "style", kind: "string", req: true, hint: "how it draws" },
  { key: "color", kind: "color", req: true },
  { key: "solid", kind: "bool" },
  { key: "oneWay", kind: "bool", hint: "platform you can jump up through" },
  { key: "damage", kind: "number", hint: "hearts per touch" },
  { key: "repels", kind: "bool", hint: "shoves the player out even on invuln frames" },
  { key: "bounce", kind: "number", hint: "upward launch px/s" },
  { key: "slow", kind: "number", hint: "movement multiplier while overlapping (sticky)" },
  { key: "wade", kind: "number", hint: "movement multiplier while overlapping (liquid)" },
  { key: "slippery", kind: "bool" },
  { key: "element", kind: "string" },
  { key: "flammable", kind: "bool" },
  { key: "brittle", kind: "bool" },
  { key: "conductive", kind: "bool" },
  { key: "spreads", kind: "bool", hint: "radiates its element to neighbors" },
  { key: "burnTime", kind: "number", hint: "seconds a burning tile lasts" },
  { key: "burnsTo", kind: "string" },
  { key: "meltsTo", kind: "string" },
  { key: "freezesTo", kind: "string" },
  { key: "shattersTo", kind: "string" },
  { key: "dissolvesTo", kind: "string" },
  { key: "extinguishesTo", kind: "string" },
  { key: "fluid", kind: "bool", hint: "joins the flow sim (falls, spreads)" },
  { key: "fallSpawns", kind: "string", hint: "fall tile: grows down, emits this tile id" },
  { key: "dropsItem", kind: "string", hint: "destructive transforms pay out this item" },
];
const ITEM_SCHEMA: FieldSpec[] = [
  { key: "id", kind: "string", req: true },
  { key: "name", kind: "string", req: true },
  { key: "kind", kind: "string", req: true },
  { key: "shape", kind: "string", req: true },
  { key: "color", kind: "color", req: true },
  { key: "description", kind: "string", req: true },
  { key: "element", kind: "string", hint: "the element this item applies when used" },
  { key: "useMode", kind: "string", hint: "present = appears in the hotbar" },
  { key: "dousedBy", kind: "string", hint: "element that reverts this while overlapped" },
  { key: "dousesTo", kind: "string" },
  { key: "douseOnDeselect", kind: "bool", hint: "also revert when no longer held" },
  { key: "igniteTo", kind: "string", hint: "becomes this near fire while held" },
  { key: "scoopsInto", kind: "json", hint: '{"water": "bucket_full"} — element -> item id' },
  { key: "emptiesTo", kind: "string", hint: "reverts to this after a splash" },
  { key: "placeType", kind: "string" },
  { key: "capabilities", kind: "json" },
  { key: "params", kind: "json" },
];
const ENEMY_SCHEMA: FieldSpec[] = [
  { key: "id", kind: "string", req: true },
  { key: "name", kind: "string", req: true },
  { key: "behavior", kind: "string", req: true, hint: "legacy preset; the behaviors list below wins" },
  { key: "width", kind: "number", req: true },
  { key: "height", kind: "number", req: true },
  { key: "color", kind: "color", req: true },
  { key: "eyeColor", kind: "color", req: true },
  { key: "speed", kind: "number", req: true },
  { key: "damage", kind: "number", req: true },
  { key: "chaseSpeed", kind: "number" },
  { key: "sightRange", kind: "number" },
  { key: "loseTargetMs", kind: "number" },
  { key: "returnsHome", kind: "bool" },
  { key: "turnAtEdges", kind: "bool" },
  { key: "stunnable", kind: "bool" },
  { key: "trappable", kind: "bool" },
  { key: "element", kind: "string" },
  { key: "reactions", kind: "json", hint: '{"fire": "kill", "ice": "stun", ...} — kill | stun | knockback | none' },
  { key: "description", kind: "string" },
];
const ENTITY_TYPE_SCHEMA: FieldSpec[] = [
  { key: "id", kind: "string", req: true, hint: "entity type name (brazier, door...)" },
  { key: "width", kind: "number", req: true },
  { key: "height", kind: "number", req: true },
  { key: "note", kind: "string" },
];

const CSS = `
.pp-editor { position:absolute; inset:0; background:#12101c; color:#d8d2ec;
  font:12px "Segoe UI", system-ui, sans-serif; display:flex; flex-direction:column; }
.pp-topbar { display:flex; align-items:center; gap:6px; padding:8px 12px;
  background:#1a1626; border-bottom:1px solid #2c2740; flex-wrap:wrap; }
.pp-title { font-weight:700; color:#ffd166; margin-right:10px; }
.pp-tab { background:#241f36; border:1px solid #322c4a; color:#bbb3d6; padding:5px 10px;
  border-radius:4px; cursor:pointer; }
.pp-tab.pp-active { background:#3d3556; color:#fff; border-color:#5a5080; }
.pp-btn { background:#241f36; border:1px solid #3a3550; color:#d8d2ec; padding:5px 10px;
  border-radius:4px; cursor:pointer; }
.pp-btn:hover { background:#2e2845; }
.pp-primary { background:#2c5140; border-color:#3e7a5c; }
.pp-danger { background:#4a2432; border-color:#7a3e50; }
.pp-body { flex:1; overflow:auto; padding:12px; }
.pp-cols { display:flex; gap:14px; align-items:flex-start; }
.pp-list { width:190px; flex:none; background:#1a1626; border:1px solid #2c2740;
  border-radius:6px; padding:6px; max-height:75vh; overflow:auto; }
.pp-listitem { padding:5px 8px; border-radius:4px; cursor:pointer; }
.pp-listitem:hover { background:#241f36; }
.pp-listitem.pp-active { background:#3d3556; color:#fff; }
.pp-panel { flex:1; background:#1a1626; border:1px solid #2c2740; border-radius:6px;
  padding:12px; max-width:640px; }
.pp-form .pp-row { display:flex; align-items:flex-start; gap:8px; margin:5px 0; }
.pp-form label { width:130px; flex:none; color:#8f87ad; padding-top:4px; }
.pp-form input[type=text], .pp-form input[type=number], .pp-form textarea, .pp-form select {
  flex:1; background:#100e1a; color:#e8e2f4; border:1px solid #3a3550;
  border-radius:4px; padding:4px 6px; font:11px monospace; min-width:60px; }
.pp-form textarea { resize:vertical; }
.pp-form input[type=color] { width:34px; height:24px; padding:0; border:none; background:none; }
.pp-colortext { max-width:80px; }
.pp-form fieldset { border:1px solid #2c2740; border-radius:5px; margin:8px 0; padding:4px 10px; }
.pp-form legend { color:#ffd166; padding:0 4px; }
.pp-bad { border-color:#c84b6a !important; }
.pp-btnrow { display:flex; gap:8px; margin-top:12px; }
.pp-hint { color:#8f87ad; font-size:11px; }
.pp-toast { position:fixed; bottom:18px; right:18px; background:#2c5140; color:#e8fff0;
  padding:8px 14px; border-radius:6px; z-index:99; font:12px monospace; }
.pp-toast-bad { background:#4a2432; color:#ffe8ee; }
.pp-sep { color:#3a3550; margin:0 4px; }
/* Room editor */
.pp-roomeditor { display:flex; gap:12px; align-items:flex-start; }
.pp-sidebar { width:230px; flex:none; background:#1a1626; border:1px solid #2c2740;
  border-radius:6px; padding:10px; max-height:78vh; overflow:auto; }
.pp-sidehead { font-weight:700; color:#ffd166; margin-bottom:6px; display:flex;
  justify-content:space-between; align-items:center; }
.pp-roomitem { padding:4px 8px; border-radius:4px; cursor:pointer; font-family:monospace; }
.pp-roomitem:hover { background:#241f36; }
.pp-roomitem.pp-active { background:#3d3556; color:#fff; }
.pp-roommain { flex:1; min-width:0; }
.pp-palette { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px; align-items:center; }
.pp-tool { background:#241f36; border:1px solid #3a3550; color:#bbb3d6; padding:3px 8px;
  border-radius:4px; cursor:pointer; font-size:11px; }
.pp-tool.pp-active { background:#3d3556; color:#fff; border-color:#ffd166; }
.pp-canvaswrap { overflow:auto; max-height:70vh; border:1px solid #2c2740; border-radius:6px;
  background:#0d0b14; }
.pp-roomcanvas { display:block; cursor:crosshair; }
.pp-rightcol { width:250px; flex:none; background:#1a1626; border:1px solid #2c2740;
  border-radius:6px; padding:10px; max-height:78vh; overflow:auto; }
hr { border:none; border-top:1px solid #2c2740; margin:10px 0; }
/* Thumbnails + sprites */
.pp-listitem { display:flex; align-items:center; gap:7px; }
.pp-thumb { width:24px; height:24px; flex:none; background:#100e1a; border-radius:4px; }
.pp-spritepanel { margin-top:10px; padding:8px; background:#161226; border:1px solid #2c2740;
  border-radius:6px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.pp-spritepreview { width:48px; height:48px; background:
  repeating-conic-gradient(#1a1626 0% 25%, #221e30 0% 50%) 0 0 / 12px 12px; border-radius:4px; }
/* Pixel editor modal */
.pp-pixmodal { position:fixed; inset:0; background:rgba(5,4,10,0.8); z-index:50;
  display:flex; align-items:center; justify-content:center; }
.pp-pixpanel { background:#1a1626; border:1px solid #3a3550; border-radius:8px; padding:16px;
  color:#d8d2ec; font:12px "Segoe UI", system-ui, sans-serif; }
.pp-pixcols { display:flex; gap:16px; align-items:flex-start; margin-top:8px; }
.pp-pixgrid { cursor:crosshair; border:1px solid #2c2740; border-radius:4px; }
.pp-pixside { display:flex; flex-direction:column; gap:6px; width:130px; }
.pp-pixpreview { background:
  repeating-conic-gradient(#1a1626 0% 25%, #221e30 0% 50%) 0 0 / 16px 16px;
  border:1px solid #2c2740; border-radius:4px; }
.pp-paletterow { display:flex; flex-wrap:wrap; gap:4px; margin-top:8px; align-items:center; }
.pp-swatch { width:22px; height:22px; border:1px solid #3a3550; border-radius:4px; cursor:pointer; }
.pp-swatch.pp-active { outline:2px solid #ffd166; }
.pp-framestrip { display:flex; flex-wrap:wrap; gap:4px; align-items:center; }
.pp-framethumb { width:32px; height:32px; background:#100e1a; border:1px solid #3a3550;
  border-radius:4px; cursor:pointer; }
.pp-framethumb.pp-active { border-color:#ffd166; }
.pp-portraitgrid { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-top:8px; }
.pp-portraitcell { background:#161226; border:1px solid #2c2740; border-radius:6px; padding:8px;
  display:flex; flex-direction:column; align-items:center; gap:5px; }
`;

type TabId =
  | "rooms" | "elements" | "rules" | "behaviors" | "tiles" | "items" | "recipes"
  | "enemies" | "entities" | "taunts" | "achievements" | "game" | "campaign" | "publish"
  | "sessions" | "reports";

// Electron loads from file://, so API calls need the real origin.
const API_BASE =
  location.protocol === "file:" ? "https://playpen.pages.dev" : "";
const PASS_KEY = "playpen.editorPass";

interface ListSpec {
  file: string;
  list: () => Record<string, unknown>[];
  setList: (l: Record<string, unknown>[]) => void;
  template: () => Record<string, unknown>;
  label: (item: Record<string, unknown>) => string;
  /** Draw a 24x24 thumbnail for a list row. */
  thumb?: (item: Record<string, unknown>, ctx: CanvasRenderingContext2D) => void;
  /** Show the custom-sprite panel (upload / pixel editor / clear). */
  sprites?: boolean;
  spriteSize?: number;
  /** Draw the procedural art at `size` — used to seed the pixel editor. */
  procedural?: (item: Record<string, unknown>, ctx: CanvasRenderingContext2D, size: number) => void;
  /** Extra panel content below the auto-form (behavior attachments etc). */
  extras?: (item: Record<string, unknown>) => HTMLElement | null;
  /** Full field schema: renders EVERY field the type supports (schemaForm),
   *  with a plain autoForm appended for any extra keys the entry carries. */
  schema?: FieldSpec[];
}

let styleEl: HTMLStyleElement | null = null;
let activeShell: EditorShell | null = null;

export function openEditor(root: HTMLElement, store: ContentStore, game: Game): void {
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.textContent = CSS;
    document.head.append(styleEl);
  }
  activeShell = new EditorShell(root, store, game);
  activeShell.render();
}

export function closeEditor(root: HTMLElement): void {
  activeShell?.dispose();
  root.replaceChildren();
  activeShell = null;
}

class EditorShell {
  private tab: TabId = "rooms";
  private bodyEl!: HTMLElement;
  private roomEditor: RoomEditor;
  private selectedIndex = 0;

  constructor(
    private root: HTMLElement,
    private store: ContentStore,
    private game: Game
  ) {
    this.roomEditor = new RoomEditor(store, (roomId, startAt) => {
      // Close editor and boot straight into the room being edited.
      const evt = new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: true, code: "KeyE" });
      window.dispatchEvent(evt);
      this.game.setContent(this.store.content);
      this.game.newRun(roomId);
      if (startAt) {
        // "Start Test From Here" — spawn at a specific checkpoint instead of
        // the room's spawn entity, and make it the respawn point too, or
        // dying mid-test would bounce back to the room's actual start.
        this.game.player.placeFeetAt(startAt.x, startAt.y);
        this.game.state.checkpoint = { roomId, x: startAt.x, y: startAt.y };
      }
    });
  }

  dispose(): void {
    this.roomEditor.dispose();
  }

  render(): void {
    const c = this.store.content;
    const tabs: TabId[] = [
      "rooms", "elements", "rules", "behaviors", "tiles", "items", "recipes",
      "enemies", "entities", "taunts", "achievements", "game", "campaign", "publish",
      "sessions", "reports",
    ];
    this.bodyEl = el("div", { className: "pp-body" });
    const shell = el(
      "div", { className: "pp-editor" },
      el("div", { className: "pp-topbar" },
        el("span", { className: "pp-title" }, `PlayPen Editor ${isElectron() ? "(disk)" : "(browser overlay)"}`),
        ...tabs.map((t) =>
          el("button", {
            className: "pp-tab" + (t === this.tab ? " pp-active" : ""),
            onclick: () => {
              this.tab = t;
              this.selectedIndex = 0;
              this.render();
            },
          }, t)
        ),
        el("span", { style: "flex:1" }),
        el("button", { className: "pp-btn", onclick: () => this.exportAll() }, "Export JSON"),
        el("button", { className: "pp-btn", onclick: () => this.importAll() }, "Import JSON"),
        el("span", { className: "pp-hint" }, "Ctrl+Shift+E to close")
      ),
      this.bodyEl
    );
    this.root.replaceChildren(shell);
    void c;
    this.renderTab();
  }

  private renderTab(): void {
    this.bodyEl.replaceChildren();
    const c = this.store.content;
    switch (this.tab) {
      case "rooms":
        this.bodyEl.append(this.roomEditor.mount());
        break;
      case "elements":
        this.renderListTab({
          file: "elements.json",
          list: () => c.elements as unknown as Record<string, unknown>[],
          setList: (l) => (c.elements = l as never),
          template: () => ({ id: "new_element", name: "New Element", color: "#888888" }),
          label: (t) => String(t.id),
          thumb: (t, ctx) => {
            ctx.fillStyle = String(t.color ?? "#888");
            ctx.beginPath();
            ctx.arc(12, 12, 8, 0, Math.PI * 2);
            ctx.fill();
          },
        });
        break;
      case "rules":
        this.renderListTab({
          file: "rules.json",
          list: () => c.rules as unknown as Record<string, unknown>[],
          setList: (l) => (c.rules = l as never),
          template: () => ({
            id: "new_rule",
            rule: "fire + flammable -> ignite",
            note: "actor + target -> effect. Target = element id or property (flammable/brittle/conductive). " +
              "Effects: ignite melt extinguish dissolve freeze shatter energize ignite_self fizzle",
          }),
          label: (t) => String(t.rule ?? `${t.actor} + ${t.target || t.targetProperty} -> ${t.effect}`),
        });
        break;
      case "behaviors":
        this.renderBehaviorsTab();
        break;
      case "tiles":
        this.renderListTab({
          file: "tiles.json",
          list: () => c.tiles as unknown as Record<string, unknown>[],
          setList: (l) => (c.tiles = l as never),
          template: () => ({
            id: "new_tile", char: "?", name: "New Tile", style: "block",
            solid: true, color: "#888888",
          }),
          label: (t) => `${t.char}  ${t.id}`,
          schema: TILE_SCHEMA,
          extras: (item) => this.attachmentsWidget(item, "tile"),
          thumb: (t, ctx) => {
            ctx.scale(1.5, 1.5);
            drawTile(ctx, t as unknown as TileDef, 0, 0, 0);
          },
          sprites: true,
          spriteSize: 16,
          procedural: (t, ctx, size) => {
            ctx.scale(size / 16, size / 16);
            drawTile(ctx, { ...(t as unknown as TileDef), sprite: undefined, spriteFrames: undefined }, 0, 0, 0);
          },
        });
        break;
      case "items":
        this.renderListTab({
          file: "items.json",
          list: () => c.items as unknown as Record<string, unknown>[],
          setList: (l) => (c.items = l as never),
          template: () => ({
            id: "new_item", name: "New Item", kind: "material", shape: "ball",
            color: "#888888", description: "",
          }),
          label: (t) => `${t.id} (${t.kind})`,
          schema: ITEM_SCHEMA,
          extras: (item) => this.attachmentsWidget(item, "item"),
          thumb: (t, ctx) => drawItemIcon(ctx, t as unknown as ItemDef, 12, 12, 1.3),
          sprites: true,
          spriteSize: 16,
          procedural: (t, ctx, size) =>
            drawItemIcon(
              ctx,
              { ...(t as unknown as ItemDef), sprite: undefined, spriteFrames: undefined },
              size / 2, size / 2, size / 14
            ),
        });
        break;
      case "recipes":
        this.renderListTab({
          file: "recipes.json",
          list: () => c.recipes as unknown as Record<string, unknown>[],
          setList: (l) => (c.recipes = l as never),
          template: () => ({
            id: "recipe_new", inputs: ["", ""], output: "", flavor: "",
          }),
          label: (t) => String(t.id),
        });
        break;
      case "enemies":
        this.renderListTab({
          file: "enemies.json",
          list: () => c.enemies as unknown as Record<string, unknown>[],
          setList: (l) => (c.enemies = l as never),
          template: () => ({
            id: "new_enemy", name: "New Enemy", behavior: "patrol",
            width: 16, height: 14, color: "#c84b6a", eyeColor: "#2a1020",
            speed: 50, damage: 1, turnAtEdges: true, stunnable: true, trappable: true,
            reactions: { fire: "none", water: "none", ice: "stun", spark: "none", metal: "knockback", lava: "kill" },
            behaviors: [
              "hazard_reactions", "element_reactions",
              { id: "stun_cycle", params: { wakeTo: "patrol" } },
              "patrol_route", "grounded_move", "trappable",
            ],
          }),
          label: (t) => `${t.id} (${t.behavior})`,
          schema: ENEMY_SCHEMA,
          extras: (item) => this.attachmentsWidget(item, "enemy"),
          thumb: (t, ctx) => {
            const d = t as unknown as EnemyDef;
            const s = 18 / Math.max(d.width || 16, d.height || 16);
            ctx.translate((24 - d.width * s) / 2, (24 - d.height * s) / 2);
            ctx.scale(s, s);
            drawBlob(ctx, 0, 0, d.width || 16, d.height || 16,
              d.color || "#888", d.eyeColor || "#000", 1, { sprite: d });
          },
          sprites: true,
          spriteSize: 16,
          procedural: (t, ctx, size) => {
            const d = t as unknown as EnemyDef;
            const w = d.width || 16;
            const h = d.height || 16;
            const s = size / Math.max(w, h);
            ctx.translate((size - w * s) / 2, size - h * s);
            ctx.scale(s, s);
            drawBlob(ctx, 0, 0, w, h, d.color || "#888", d.eyeColor || "#000", 1);
          },
        });
        break;
      case "entities":
        this.renderListTab({
          file: "entities.json",
          list: () => c.entityTypes as unknown as Record<string, unknown>[],
          setList: (l) => (c.entityTypes = l as never),
          template: () => ({ id: "new_entity", width: 16, height: 16 }),
          label: (t) => `${t.id} (${t.width}×${t.height})`,
          schema: ENTITY_TYPE_SCHEMA,
          extras: (item) => this.attachmentsWidget(item, "entity"),
        });
        break;
      case "taunts":
        this.renderListTab({
          file: "taunts.json",
          list: () => c.taunts as unknown as Record<string, unknown>[],
          setList: (l) => (c.taunts = l as never),
          template: () => ({
            id: "taunt_new", trigger: "death", cooldownMs: 8000, chance: 1,
            lines: ["..."],
          }),
          label: (t) => `${t.id} (${t.trigger})`,
        });
        break;
      case "achievements":
        this.renderListTab({
          file: "achievements.json",
          list: () => c.achievements as unknown as Record<string, unknown>[],
          setList: (l) => (c.achievements = l as never),
          template: () => ({
            id: "new_achievement", name: "New Achievement",
            description: "", hidden: false,
            trigger: "counter", counter: "burns", count: 1,
            wardenLine: "Noted. Filed. Judged.", emotion: "smug",
          }),
          label: (t) => `${t.hidden ? "◈ " : ""}${t.id}`,
        });
        break;
      case "game": {
        const panel = el("div", { className: "pp-panel" });
        panel.append(
          el("p", { className: "pp-hint" },
            "Global tuning: player feel, camera, juice, rules, audio. Changes apply on save."),
          autoForm(c.game as unknown as Record<string, unknown>, () => {}, SPRITE_KEYS, undefined, fieldOptionsFor(c)),
          el("div", { className: "pp-sidehead", style: "margin-top:14px" }, "Player sprite"),
          this.spritePanel(
            c.game.player as unknown as Record<string, unknown>,
            "Player", 16, () => this.renderTab(),
            (ctx, size) => {
              const p = c.game.player;
              const s = size / Math.max(p.width, p.height);
              ctx.translate((size - p.width * s) / 2, size - p.height * s);
              ctx.scale(s, s);
              drawBlob(ctx, 0, 0, p.width, p.height, p.color, p.eyeColor, 1);
            }
          ),
          el("div", { className: "pp-sidehead", style: "margin-top:14px" }, "Warden portraits"),
          el("p", { className: "pp-hint" },
            "One face per emotion. Taunts pick their face via their 'emotion' field (taunts tab)."),
          this.portraitGrid(),
          el("div", { className: "pp-btnrow" },
            el("button", {
              className: "pp-btn pp-primary",
              onclick: async () => {
                await this.store.saveFile("game.json", c.game);
                this.game.setContent(this.store.content);
                toast("Saved game.json");
              },
            }, "Save game config")
          )
        );
        this.bodyEl.append(panel);
        break;
      }
      case "campaign":
        this.renderCampaignTab();
        break;
      case "publish":
        this.renderPublishTab();
        break;
      case "sessions": {
        const panel = el("div", { className: "pp-panel" });
        renderSessionsTab(panel, c, API_BASE, PASS_KEY);
        this.bodyEl.append(panel);
        break;
      }
      case "reports": {
        const panel = el("div", { className: "pp-panel" });
        renderReportsTab(panel, API_BASE, PASS_KEY);
        this.bodyEl.append(panel);
        break;
      }
    }
  }

  /** Push the current content to every player (password-gated, versioned). */
  private renderPublishTab(): void {
    const panel = el("div", { className: "pp-panel" });
    const pub = this.store.publishedInfo;
    panel.append(
      el("p", { className: "pp-hint" },
        "Publishing pushes THIS editor's current content to all players at " +
        "playpen.pages.dev (they get it on their next page load). " +
        "Every publish is kept in history and can be restored."),
      el("p", { className: "pp-hint" },
        pub
          ? `This session loaded published version ${pub.id} (${pub.publishedAt})${pub.note ? ` — "${pub.note}"` : ""}.`
          : "This session loaded no published version (bundled/local content only).")
    );

    if (this.store.overlayFileNames.length > 0) {
      panel.append(
        el("div", {
          style: "background:#3a2a1e;border:1px solid #7a5638;border-radius:4px;padding:8px;margin:8px 0",
        },
          el("p", { style: "margin:0 0 6px;color:#ffd166" },
            `⚠ This browser has a local editing draft overriding: ${this.store.overlayFileNames.join(", ")}. ` +
            "It sits on top of published/bundled content forever, in every future publish — including for " +
            "fields a later code update changed, if this draft still has the old value. If you didn't mean " +
            "to keep old edits to these files, clear the draft below before publishing."),
          el("button", {
            className: "pp-btn",
            onclick: () => {
              if (!confirm(
                "Clear this browser's local editing draft? Unsaved/uncommitted edits to " +
                `${this.store.overlayFileNames.join(", ")} will revert to published/bundled content. ` +
                "This reloads the page."
              )) return;
              this.store.clearOverlay();
              location.reload();
            },
          }, "clear local draft")
        )
      );
    }

    const passInput = el("input", {
      type: "password",
      placeholder: "editor password",
      value: localStorage.getItem(PASS_KEY) ?? "",
    });
    const noteInput = el("input", {
      type: "text", placeholder: "what changed? (optional note)",
    });
    const form = el("div", { className: "pp-form" },
      el("div", { className: "pp-row" }, el("label", {}, "password"), passInput),
      el("div", { className: "pp-row" }, el("label", {}, "note"), noteInput),
    );
    panel.append(form);

    const historyEl = el("div", { style: "margin-top:14px" });
    const auth = () => {
      const p = passInput.value.trim();
      localStorage.setItem(PASS_KEY, p);
      return { "x-editor-password": p, "content-type": "application/json" };
    };

    const loadHistory = async () => {
      historyEl.replaceChildren(el("p", { className: "pp-hint" }, "loading history..."));
      try {
        const res = await fetch(`${API_BASE}/api/content/versions`, { headers: auth() });
        if (res.status === 401) {
          historyEl.replaceChildren(el("p", { className: "pp-hint" }, "wrong password — history hidden"));
          return;
        }
        const data = await res.json() as {
          liveId: string | null;
          versions: { id: string; at: string; note: string; bytes: number }[];
        };
        historyEl.replaceChildren(
          el("div", { className: "pp-sidehead" }, "Version history")
        );
        if (data.versions.length === 0) {
          historyEl.append(el("p", { className: "pp-hint" }, "no versions published yet"));
        }
        for (const v of data.versions) {
          const isLive = v.id === data.liveId;
          historyEl.append(
            el("div", { className: "pp-row", style: "display:flex;gap:8px;align-items:center;margin:4px 0" },
              el("span", { style: `font-family:monospace;${isLive ? "color:#9be8b0" : ""}` },
                `${isLive ? "● " : ""}${v.id}`),
              el("span", { className: "pp-hint", style: "flex:1" },
                `${new Date(v.at).toLocaleString()}${v.note ? ` — ${v.note}` : ""} (${Math.round(v.bytes / 1024)}kb)`),
              isLive
                ? el("span", { className: "pp-hint" }, "live")
                : el("button", {
                    className: "pp-btn",
                    onclick: async () => {
                      if (!confirm(`Make ${v.id} live for all players?`)) return;
                      const r = await fetch(`${API_BASE}/api/content/restore`, {
                        method: "POST", headers: auth(),
                        body: JSON.stringify({ id: v.id }),
                      });
                      toast(r.ok ? `Restored ${v.id}` : "Restore failed", r.ok);
                      loadHistory();
                    },
                  }, "restore")
            )
          );
        }
      } catch {
        historyEl.replaceChildren(el("p", { className: "pp-hint" },
          "couldn't reach the server (offline / local dev without functions)"));
      }
    };

    panel.append(
      el("div", { className: "pp-btnrow" },
        el("button", {
          className: "pp-btn pp-primary",
          onclick: async () => {
            if (!passInput.value.trim()) {
              toast("Enter the editor password first.", false);
              return;
            }
            if (!confirm("Publish current content to ALL players?")) return;
            try {
              const res = await fetch(`${API_BASE}/api/content`, {
                method: "POST",
                headers: auth(),
                body: JSON.stringify({
                  files: mergedFiles(this.store.allFiles()),
                  note: noteInput.value.trim(),
                }),
              });
              const out = await res.json() as { ok: boolean; id?: string; error?: string };
              toast(out.ok ? `Published ${out.id}` : `Failed: ${out.error}`, out.ok);
              if (out.ok) loadHistory();
            } catch {
              toast("Couldn't reach the server.", false);
            }
          },
        }, "🚀 Publish to all players"),
        el("button", { className: "pp-btn", onclick: () => loadHistory() }, "Load history")
      ),
      historyEl
    );
    this.bodyEl.append(panel);
    if (passInput.value) loadHistory();
  }

  private renderListTab(spec: ListSpec): void {
    const list = spec.list();
    if (this.selectedIndex >= list.length) this.selectedIndex = 0;
    const listEl = el("div", { className: "pp-list" });
    list.forEach((item, i) => {
      const row = el("div", {
        className: "pp-listitem" + (i === this.selectedIndex ? " pp-active" : ""),
        onclick: () => {
          this.selectedIndex = i;
          this.renderTab();
        },
      });
      if (spec.thumb) {
        const cv = el("canvas", { width: 24, height: 24, className: "pp-thumb" });
        try {
          spec.thumb(item, cv.getContext("2d")!);
        } catch { /* half-filled entries shouldn't break the list */ }
        row.append(cv);
      }
      row.append(el("span", {}, spec.label(item)));
      listEl.append(row);
    });
    listEl.append(
      el("div", { className: "pp-btnrow" },
        el("button", {
          className: "pp-btn",
          onclick: () => {
            list.push(spec.template());
            this.selectedIndex = list.length - 1;
            this.renderTab();
          },
        }, "+ add")
      )
    );

    const panel = el("div", { className: "pp-panel" });
    const item = list[this.selectedIndex];
    if (item) {
      const opts = fieldOptionsFor(this.store.content);
      const skip = [...SPRITE_KEYS, "behaviors", ...(spec.schema?.map((s) => s.key) ?? [])];
      panel.append(
        spec.schema ? schemaForm(item, spec.schema, () => {}, opts) : el("span", {}),
        autoForm(item, () => {}, skip, undefined, opts),
        spec.extras?.(item) ?? el("span", {}),
        spec.sprites
          ? this.spritePanel(
              item, "Custom sprite", spec.spriteSize ?? 16, () => this.renderTab(),
              spec.procedural ? (ctx, size) => spec.procedural!(item, ctx, size) : undefined
            )
          : el("span", {}),
        el("div", { className: "pp-btnrow" },
          el("button", {
            className: "pp-btn pp-primary",
            onclick: async () => {
              await this.store.saveFile(spec.file, list);
              this.game.setContent(this.store.content);
              toast(`Saved ${spec.file}`);
            },
          }, `Save ${spec.file}`),
          el("button", {
            className: "pp-btn",
            onclick: () => {
              const copy = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
              copy.id = String(copy.id ?? "item") + "_copy";
              list.push(copy);
              this.selectedIndex = list.length - 1;
              this.renderTab();
            },
          }, "Duplicate"),
          el("button", {
            className: "pp-btn pp-danger",
            onclick: () => {
              if (!confirm("Delete this entry? (Remember to save)")) return;
              list.splice(this.selectedIndex, 1);
              this.selectedIndex = 0;
              this.renderTab();
            },
          }, "Delete")
        )
      );
    } else {
      panel.append(el("p", { className: "pp-hint" }, "Nothing here yet — add one."));
    }
    this.bodyEl.append(el("div", { className: "pp-cols" }, listEl, panel));
  }

  /**
   * The behavior library: named trigger→condition→action rule bundles
   * (content/behaviors.json) that tiles/items/enemies/entities attach.
   * Scalar fields + params get the auto-form; rules get a structured
   * per-rule builder (trigger dropdown + validated JSON for if/do); the
   * verb legend below is generated live from the engine registries.
   */
  /**
   * The behavior library: penscript scripts (content/behaviors.json) that
   * tiles/items/enemies/entities attach. Metadata gets a form; the script is
   * plain text in a monospace pane with live compile errors — no half-UI in
   * between. The reference legend below is generated live from the engine's
   * function registry, so a newly registered function shows up automatically.
   */
  private renderBehaviorsTab(): void {
    const c = this.store.content;
    const list = c.behaviors as unknown as Record<string, unknown>[];
    if (this.selectedIndex >= list.length) this.selectedIndex = 0;
    const listEl = el("div", { className: "pp-list" });
    list.forEach((item, i) => {
      listEl.append(
        el("div", {
          className: "pp-listitem" + (i === this.selectedIndex ? " pp-active" : ""),
          onclick: () => {
            this.selectedIndex = i;
            this.renderTab();
          },
        }, el("span", {}, `${item.id}${item.host ? ` (${item.host})` : ""}`))
      );
    });
    listEl.append(
      el("div", { className: "pp-btnrow" },
        el("button", {
          className: "pp-btn",
          onclick: () => {
            list.push({
              id: "newBehavior", name: "New Behavior", host: "enemy",
              description: "",
              script: [
                "// Top-level vars are this behavior's tweakable fields;",
                "// attachments can override their values per def.",
                "var speed = host.speed ?? 50;",
                "",
                "on tick {",
                "",
                "}",
              ],
            });
            this.selectedIndex = list.length - 1;
            this.renderTab();
          },
        }, "+ add")
      )
    );

    const panel = el("div", { className: "pp-panel" });
    const item = list[this.selectedIndex];
    if (item) {
      const errorsEl = el("div", { className: "pp-hint", style: "margin-top:4px" });
      const refreshErrors = (source: string) => {
        const { script, errors } = compileScript(source);
        const all: ScriptError[] = [...errors];
        if (script && errors.length === 0) {
          all.push(...lintScript(script, TRIGGERS, isKnownFn));
        }
        errorsEl.replaceChildren(
          ...(all.length === 0
            ? [el("span", { style: "color:#9be8b0" }, "✓ compiles clean")]
            : all.map((e) =>
                el("div", { style: "color:#ff9db0" }, `line ${e.line}: ${e.message}`)))
        );
        return all.length === 0;
      };
      const source = scriptSource(item as never);
      const scriptEl = el("textarea", {
        rows: Math.min(28, Math.max(10, source.split("\n").length + 2)),
        className: "pp-json",
        spellcheck: false,
        value: source,
        oninput: (e) => {
          const t = e.target as HTMLTextAreaElement;
          item.script = t.value.split("\n");
          t.classList.toggle("pp-bad", !refreshErrors(t.value));
        },
      });
      refreshErrors(source);
      panel.append(
        autoForm(item, () => {}, ["script"], undefined, fieldOptionsFor(c)),
        el("div", { className: "pp-sidehead", style: "margin-top:10px" }, "script"),
        scriptEl,
        errorsEl,
        el("hr"),
        el("p", { className: "pp-hint" },
          "events: " + TRIGGERS.map((t) => `on ${t}`).join(" · ")),
        el("p", { className: "pp-hint" },
          "built-ins: now · host.<field> · state (enemies) · lit (entities) · " +
          "player / home (moveToward targets) · halt (consume event) · return (end handler)"),
        el("p", { className: "pp-hint" }, "functions: " + knownFnNames().join(" · ")),
        el("div", { className: "pp-btnrow" },
          el("button", {
            className: "pp-btn pp-primary",
            onclick: async () => {
              await this.store.saveFile("behaviors.json", list);
              this.game.setContent(this.store.content);
              toast("Saved behaviors.json");
            },
          }, "Save behaviors.json"),
          el("button", {
            className: "pp-btn",
            onclick: () => {
              const copy = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
              copy.id = String(copy.id ?? "behavior") + "Copy";
              list.push(copy);
              this.selectedIndex = list.length - 1;
              this.renderTab();
            },
          }, "Duplicate"),
          el("button", {
            className: "pp-btn pp-danger",
            onclick: () => {
              if (!confirm("Delete this behavior? Anything attached to it stops doing it. (Remember to save)")) return;
              list.splice(this.selectedIndex, 1);
              this.selectedIndex = 0;
              this.renderTab();
            },
          }, "Delete")
        )
      );
    } else {
      panel.append(el("p", { className: "pp-hint" }, "Nothing here yet — add one."));
    }
    this.bodyEl.append(el("div", { className: "pp-cols" }, listEl, panel));
  }

  private attachmentsWidget(
    def: Record<string, unknown>, host: "enemy" | "item" | "tile" | "entity"
  ): HTMLElement {
    const c = this.store.content;
    const wrap = el("div", { className: "pp-spritepanel", style: "display:block" });
    wrap.append(el("div", { className: "pp-sidehead" }, "behaviors (execution order)"));
    const derived =
      host === "enemy" ? enemyAttachments(def as unknown as EnemyDef)
      : host === "item" ? itemAttachments(def as unknown as ItemDef)
      : [];
    if (!Array.isArray(def.behaviors)) {
      wrap.append(
        el("p", { className: "pp-hint" },
          derived.length
            ? "derived from legacy fields: " +
              derived.map((a) => (typeof a === "string" ? a : a.id)).join(" → ")
            : "none attached"),
        el("button", {
          className: "pp-btn",
          onclick: () => {
            def.behaviors = JSON.parse(JSON.stringify(derived));
            this.renderTab();
          },
        }, "✎ customize")
      );
      return wrap;
    }
    const atts = def.behaviors as unknown[];
    atts.forEach((att, i) => {
      const area = el("textarea", {
        rows: 1, className: "pp-json", style: "flex:1",
        value: JSON.stringify(att),
        oninput: (e) => {
          const t = e.target as HTMLTextAreaElement;
          try {
            atts[i] = JSON.parse(t.value);
            t.classList.remove("pp-bad");
          } catch {
            t.classList.add("pp-bad");
          }
        },
      });
      wrap.append(
        el("div", { className: "pp-row", style: "display:flex;gap:6px;align-items:center;margin:3px 0" },
          area,
          el("button", {
            className: "pp-tool",
            onclick: () => {
              if (i > 0) {
                [atts[i - 1], atts[i]] = [atts[i], atts[i - 1]];
                this.renderTab();
              }
            },
          }, "▲"),
          el("button", {
            className: "pp-tool",
            onclick: () => {
              if (i < atts.length - 1) {
                [atts[i + 1], atts[i]] = [atts[i], atts[i + 1]];
                this.renderTab();
              }
            },
          }, "▼"),
          el("button", {
            className: "pp-tool",
            onclick: () => {
              atts.splice(i, 1);
              this.renderTab();
            },
          }, "✕")
        )
      );
    });
    const dlId = `pp-bhv-add-${host}`;
    const addInput = el("input", { type: "text", list: dlId, placeholder: "add behavior…" });
    const options = c.behaviors
      .filter((b) => !b.host || b.host === host)
      .map((b) => b.id);
    wrap.append(
      el("div", { className: "pp-row", style: "display:flex;gap:6px;margin-top:6px" },
        addInput,
        el("datalist", { id: dlId }, ...options.map((o) => el("option", { value: o }))),
        el("button", {
          className: "pp-btn",
          onclick: () => {
            const v = addInput.value.trim();
            if (!v) return;
            atts.push(v);
            addInput.value = "";
            this.renderTab();
          },
        }, "+ attach"),
        el("button", {
          className: "pp-btn", title: "remove the explicit list; fall back to legacy-derived",
          onclick: () => {
            delete def.behaviors;
            this.renderTab();
          },
        }, "↺ revert to derived")
      )
    );
    return wrap;
  }

  /** Upload / pixel-edit / clear custom art on any SpriteFields carrier. */
  private spritePanel(
    target: Record<string, unknown>,
    title: string,
    size: number,
    onChanged: () => void,
    procedural?: (ctx: CanvasRenderingContext2D, size: number) => void
  ): HTMLElement {
    const preview = el("canvas", { width: 48, height: 48, className: "pp-spritepreview" });
    const drawPreview = () => {
      const ctx = preview.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 48, 48);
      const uri = currentFrame(target as { sprite?: string; spriteFrames?: string[] });
      if (!uri) return;
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, 48, 48);
      img.src = uri;
    };
    drawPreview();
    const frames = (target.spriteFrames as string[] | undefined)
      ?? (target.sprite ? [target.sprite as string] : []);
    const apply = (newFrames: string[], fps: number) => {
      if (newFrames.length > 1) {
        target.spriteFrames = newFrames;
        target.spriteFps = fps;
        delete target.sprite;
      } else {
        target.sprite = newFrames[0];
        delete target.spriteFrames;
        delete target.spriteFps;
      }
      onChanged();
    };
    return el(
      "div", { className: "pp-spritepanel" },
      preview,
      el("span", { className: "pp-hint" },
        `${title} — ${frames.length > 1 ? frames.length + " frames" : frames.length === 1 ? "1 image" : "procedural (none set)"}`),
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
            r.onload = () => apply([r.result as string], 6);
            r.readAsDataURL(f);
          };
          input.click();
        },
      }, "Upload PNG"),
      el("button", {
        className: "pp-btn",
        onclick: () => {
          // No custom art yet? Start from the procedural sprite, not a blank.
          const seed =
            frames.length === 0 && procedural
              ? [rasterize(size, (ctx) => procedural(ctx, size))]
              : frames;
          openPixelEditor({
            title: `${title} (${size}x${size})`,
            size,
            frames: seed,
            fps: (target.spriteFps as number) ?? 6,
            multiFrame: true,
            onSave: apply,
          });
        },
      }, "Pixel editor"),
      el("button", {
        className: "pp-btn pp-danger",
        onclick: () => {
          delete target.sprite;
          delete target.spriteFrames;
          delete target.spriteFps;
          onChanged();
        },
      }, "Clear")
    );
  }

  /** Per-emotion Warden portrait manager (game tab). */
  private portraitGrid(): HTMLElement {
    const c = this.store.content;
    const ant = c.game.antagonist;
    const grid = el("div", { className: "pp-portraitgrid" });
    for (const emotion of EMOTIONS) {
      const cv = el("canvas", { width: 64, height: 64 });
      const draw = () => {
        const ctx = cv.getContext("2d")!;
        ctx.clearRect(0, 0, 64, 64);
        drawWardenPortrait(ctx, emotion, ant.color, 0, 0, 64, ant.portraits?.[emotion]);
      };
      draw();
      grid.append(
        el("div", { className: "pp-portraitcell" },
          cv,
          el("span", { className: "pp-hint" }, emotion),
          el("div", { className: "pp-btnrow", style: "margin-top:0" },
            el("button", {
              className: "pp-btn",
              onclick: () =>
                openPixelEditor({
                  title: `Warden — ${emotion} (32x32)`,
                  size: 32,
                  frames: [
                    ant.portraits?.[emotion] ??
                      rasterize(32, (ctx) => drawWardenPortrait(ctx, emotion, ant.color, 0, 0, 32)),
                  ],
                  fps: 6,
                  multiFrame: false,
                  onSave: (frames) => {
                    ant.portraits = ant.portraits ?? {};
                    ant.portraits[emotion] = frames[0];
                    this.renderTab();
                  },
                }),
            }, "edit"),
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
                  r.onload = () => {
                    ant.portraits = ant.portraits ?? {};
                    ant.portraits[emotion] = r.result as string;
                    this.renderTab();
                  };
                  r.readAsDataURL(f);
                };
                input.click();
              },
            }, "png"),
            el("button", {
              className: "pp-btn pp-danger",
              onclick: () => {
                if (ant.portraits) delete ant.portraits[emotion];
                this.renderTab();
              },
            }, "✕")
          )
        )
      );
    }
    return grid;
  }

  private renderCampaignTab(): void {
    const c = this.store.content;
    const panel = el("div", { className: "pp-panel" });
    panel.append(el("p", { className: "pp-hint" },
      "Room order for a run. Doors with to:\"next\" follow this sequence."));
    const listEl = el("div");
    const rebuild = () => {
      listEl.replaceChildren();
      c.campaign.rooms.forEach((id, i) => {
        listEl.append(
          el("div", { className: "pp-row", style: "display:flex;gap:6px;margin:4px 0;align-items:center" },
            el("span", { style: "width:24px;color:#8f87ad" }, String(i + 1)),
            el("span", { style: "flex:1;font-family:monospace" }, id),
            el("button", {
              className: "pp-btn", onclick: () => {
                if (i > 0) {
                  [c.campaign.rooms[i - 1], c.campaign.rooms[i]] =
                    [c.campaign.rooms[i], c.campaign.rooms[i - 1]];
                  rebuild();
                }
              },
            }, "↑"),
            el("button", {
              className: "pp-btn", onclick: () => {
                if (i < c.campaign.rooms.length - 1) {
                  [c.campaign.rooms[i + 1], c.campaign.rooms[i]] =
                    [c.campaign.rooms[i], c.campaign.rooms[i + 1]];
                  rebuild();
                }
              },
            }, "↓"),
            el("button", {
              className: "pp-btn pp-danger", onclick: () => {
                c.campaign.rooms.splice(i, 1);
                rebuild();
              },
            }, "✕")
          )
        );
      });
      const missing = Object.keys(c.rooms).filter((r) => !c.campaign.rooms.includes(r));
      if (missing.length > 0) {
        const sel = el("select", {});
        for (const m of missing) sel.append(el("option", { value: m }, m));
        listEl.append(
          el("div", { className: "pp-btnrow" },
            sel,
            el("button", {
              className: "pp-btn", onclick: () => {
                c.campaign.rooms.push(sel.value);
                rebuild();
              },
            }, "+ append")
          )
        );
      }
    };
    rebuild();
    panel.append(
      listEl,
      el("div", { className: "pp-btnrow" },
        el("button", {
          className: "pp-btn pp-primary",
          onclick: async () => {
            await this.store.saveFile("campaign.json", c.campaign);
            toast("Saved campaign.json");
          },
        }, "Save campaign.json")
      )
    );
    this.bodyEl.append(panel);
  }

  private exportAll(): void {
    const blob = new Blob([this.store.exportAll()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "playpen-content.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Exported all content.");
  }

  private importAll(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        await this.store.importAll(await f.text());
        this.game.setContent(this.store.content);
        this.render();
        toast("Imported content bundle.");
      } catch (e) {
        console.error(e);
        toast("Import failed — bad JSON?", false);
      }
    };
    input.click();
  }
}
