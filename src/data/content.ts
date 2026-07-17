// ContentStore: loads all serialized game content and saves editor changes.
// Sources, in precedence order:
//   1. Electron: content/ directory on disk (live truth, editor writes here)
//   2. Browser: localStorage overlay (editor writes here) over bundled defaults
//   3. Bundled defaults: content/*.json imported at build time
import type { Content, RoomDef } from "./types";

declare global {
  interface Window {
    playpenFS?: {
      readAllContent(): Promise<Record<string, string>>;
      writeContent(relPath: string, text: string): Promise<boolean>;
      deleteContent(relPath: string): Promise<boolean>;
    };
  }
}

const bundled = import.meta.glob("../../content/**/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const LS_KEY = "playpen.content.overlay";

function bundledFiles(): Record<string, unknown> {
  // Normalize glob paths ("../../content/rooms/x.json" -> "rooms/x.json")
  const out: Record<string, unknown> = {};
  for (const [p, data] of Object.entries(bundled)) {
    const rel = p.replace(/^.*\/content\//, "");
    out[rel] = data;
  }
  return out;
}

function assemble(files: Record<string, unknown>): Content {
  const rooms: Record<string, RoomDef> = {};
  for (const [rel, data] of Object.entries(files)) {
    if (rel.startsWith("rooms/")) {
      const room = data as RoomDef;
      rooms[room.id] = room;
    }
  }
  return {
    game: files["game.json"] as Content["game"],
    elements: (files["elements.json"] ?? []) as Content["elements"],
    rules: (files["rules.json"] ?? []) as Content["rules"],
    achievements: (files["achievements.json"] ?? []) as Content["achievements"],
    tiles: files["tiles.json"] as Content["tiles"],
    items: files["items.json"] as Content["items"],
    recipes: files["recipes.json"] as Content["recipes"],
    enemies: files["enemies.json"] as Content["enemies"],
    taunts: files["taunts.json"] as Content["taunts"],
    campaign: files["campaign.json"] as Content["campaign"],
    rooms,
  };
}

export function isElectron(): boolean {
  return !!window.playpenFS;
}

export class ContentStore {
  content!: Content;
  private files: Record<string, unknown> = {};
  private deletedInOverlay = new Set<string>();

  async load(): Promise<Content> {
    this.files = bundledFiles();
    if (isElectron()) {
      // Disk is source of truth; it includes everything bundled plus edits.
      const disk = await window.playpenFS!.readAllContent();
      for (const [rel, text] of Object.entries(disk)) {
        try {
          this.files[rel.replace(/\\/g, "/")] = JSON.parse(text);
        } catch (e) {
          console.error("Bad JSON in content file", rel, e);
        }
      }
    } else {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const overlay = JSON.parse(raw) as {
            files: Record<string, unknown>;
            deleted?: string[];
          };
          Object.assign(this.files, overlay.files);
          for (const rel of overlay.deleted ?? []) {
            delete this.files[rel];
            this.deletedInOverlay.add(rel);
          }
        }
      } catch (e) {
        console.error("Bad content overlay in localStorage; ignoring.", e);
      }
    }
    this.content = assemble(this.files);
    return this.content;
  }

  /** Persist one logical file (e.g. "game.json", "rooms/vents.json"). */
  async saveFile(rel: string, data: unknown): Promise<void> {
    this.files[rel] = data;
    this.deletedInOverlay.delete(rel);
    if (isElectron()) {
      await window.playpenFS!.writeContent(rel, JSON.stringify(data, null, 2) + "\n");
    } else {
      this.persistOverlay();
    }
    this.content = assemble(this.files);
  }

  async deleteFile(rel: string): Promise<void> {
    delete this.files[rel];
    if (isElectron()) {
      await window.playpenFS!.deleteContent(rel);
    } else {
      this.deletedInOverlay.add(rel);
      this.persistOverlay();
    }
    this.content = assemble(this.files);
  }

  private persistOverlay(): void {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ files: this.files, deleted: [...this.deletedInOverlay] })
    );
  }

  /** Full export for sharing/backup (web builds especially). */
  exportAll(): string {
    return JSON.stringify(this.files, null, 2);
  }

  async importAll(json: string): Promise<void> {
    const files = JSON.parse(json) as Record<string, unknown>;
    for (const [rel, data] of Object.entries(files)) {
      await this.saveFile(rel, data);
    }
  }

  clearOverlay(): void {
    localStorage.removeItem(LS_KEY);
  }
}

export const store = new ContentStore();
