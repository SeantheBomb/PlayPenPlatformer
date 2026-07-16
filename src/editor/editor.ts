// PlayPen Editor — hidden behind Ctrl+Shift+E. Every serialized content file
// has a tab here: rooms, tiles, items, recipes, enemies, taunts, game, campaign.
import type { ContentStore } from "../data/content";
import { isElectron } from "../data/content";
import type { EnemyDef, ItemDef, TileDef, WardenEmotion } from "../data/types";
import type { Game } from "../game/game";
import {
  currentFrame, drawBlob, drawItemIcon, drawTile, drawWardenPortrait,
} from "../engine/renderer";
import { autoForm, el, toast } from "./forms";
import { RoomEditor } from "./roomeditor";
import { openPixelEditor } from "./pixeleditor";

const SPRITE_KEYS = ["sprite", "spriteFrames", "spriteFps", "portraits"];
const EMOTIONS: WardenEmotion[] = ["smug", "gleeful", "annoyed", "bored", "shocked", "proud"];

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
  | "rooms" | "tiles" | "items" | "recipes"
  | "enemies" | "taunts" | "game" | "campaign";

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
    this.roomEditor = new RoomEditor(store, (roomId) => {
      // Close editor and boot straight into the room being edited.
      const evt = new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: true, code: "KeyE" });
      window.dispatchEvent(evt);
      this.game.setContent(this.store.content);
      this.game.newRun(roomId);
    });
  }

  dispose(): void {
    this.roomEditor.dispose();
  }

  render(): void {
    const c = this.store.content;
    const tabs: TabId[] = ["rooms", "tiles", "items", "recipes", "enemies", "taunts", "game", "campaign"];
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
          thumb: (t, ctx) => {
            ctx.scale(1.5, 1.5);
            drawTile(ctx, t as unknown as TileDef, 0, 0, 0);
          },
          sprites: true,
          spriteSize: 16,
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
          thumb: (t, ctx) => drawItemIcon(ctx, t as unknown as ItemDef, 12, 12, 1.3),
          sprites: true,
          spriteSize: 16,
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
          }),
          label: (t) => `${t.id} (${t.behavior})`,
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
      case "game": {
        const panel = el("div", { className: "pp-panel" });
        panel.append(
          el("p", { className: "pp-hint" },
            "Global tuning: player feel, camera, juice, rules, audio. Changes apply on save."),
          autoForm(c.game as unknown as Record<string, unknown>, () => {}, SPRITE_KEYS),
          el("div", { className: "pp-sidehead", style: "margin-top:14px" }, "Player sprite"),
          this.spritePanel(
            c.game.player as unknown as Record<string, unknown>,
            "Player", 16, () => this.renderTab()
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
    }
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
      panel.append(
        autoForm(item, () => {}, SPRITE_KEYS),
        spec.sprites
          ? this.spritePanel(item, "Custom sprite", spec.spriteSize ?? 16, () => this.renderTab())
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

  /** Upload / pixel-edit / clear custom art on any SpriteFields carrier. */
  private spritePanel(
    target: Record<string, unknown>,
    title: string,
    size: number,
    onChanged: () => void
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
        onclick: () =>
          openPixelEditor({
            title: `${title} (${size}x${size})`,
            size,
            frames,
            fps: (target.spriteFps as number) ?? 6,
            multiFrame: true,
            onSave: apply,
          }),
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
                  frames: ant.portraits?.[emotion] ? [ant.portraits[emotion]!] : [],
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
