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

/**
 * Recursively fills in any keys missing from `override` using `base`. This is
 * what keeps an old disk/published/localStorage game.json from wholesale
 * blanking out newer schema fields (e.g. the `hud` block) it predates — every
 * schema addition would otherwise crash any render that reads the new field
 * off a stale save. Arrays and primitives in `override` win outright.
 */
function deepDefaults<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (
    typeof base !== "object" || base === null || Array.isArray(base) ||
    typeof override !== "object" || override === null || Array.isArray(override)
  ) {
    return override as T;
  }
  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(base as Record<string, unknown>)) {
    merged[key] = deepDefaults(
      (base as Record<string, unknown>)[key],
      (override as Record<string, unknown>)[key]
    );
  }
  // Keep any extra keys override adds that base doesn't have yet.
  for (const key of Object.keys(override as Record<string, unknown>)) {
    if (!(key in merged)) merged[key] = (override as Record<string, unknown>)[key];
  }
  return merged as T;
}

const BUNDLED_GAME_DEFAULT = bundledFiles()["game.json"];

function assemble(files: Record<string, unknown>): Content {
  const rooms: Record<string, RoomDef> = {};
  for (const [rel, data] of Object.entries(files)) {
    if (rel.startsWith("rooms/")) {
      const room = data as RoomDef;
      rooms[room.id] = room;
    }
  }
  return {
    game: deepDefaults(BUNDLED_GAME_DEFAULT, files["game.json"]) as Content["game"],
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
  /** id/time of the published bundle this session loaded (browser only). */
  publishedInfo: { id: string; publishedAt: string; note?: string } | null = null;
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
      // Published content (Sean's editor pushes) sits between the bundled
      // defaults and any local editing draft: bundled < published < draft.
      try {
        const res = await fetch("/api/content", { cache: "no-store" });
        if (res.ok) {
          const pub = (await res.json()) as {
            id: string; publishedAt: string; note?: string;
            files: Record<string, unknown>;
          };
          if (pub?.files) {
            Object.assign(this.files, pub.files);
            this.publishedInfo = {
              id: pub.id, publishedAt: pub.publishedAt, note: pub.note,
            };
          }
        }
      } catch {
        // Offline or local dev without functions — bundled content is fine.
      }
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

  /** The complete current file map (for publishing). */
  allFiles(): Record<string, unknown> {
    return { ...this.files };
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
