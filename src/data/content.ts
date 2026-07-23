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

/**
 * Same problem as deepDefaults but for id-keyed arrays (items.json, tiles.json,
 * etc). A stale override array — from a published bundle, localStorage draft,
 * or Electron disk copy predating a schema field — would otherwise silently
 * carry old per-entry data forward wholesale (e.g. an unlit torch missing the
 * `shape: "torch"` field added after that save, rendering as a generic tool
 * again). Merges each override entry against its bundled counterpart by id,
 * and keeps any bundled-only entries the override predates entirely.
 */
function mergeArrayById<T extends { id: string }>(base: T[], override: unknown): T[] {
  if (!Array.isArray(override)) return base;
  const baseById = new Map(base.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const merged: T[] = override.map((entry) => {
    const e = entry as T;
    seen.add(e.id);
    const baseEntry = baseById.get(e.id);
    return baseEntry ? deepDefaults(baseEntry, e) : e;
  });
  for (const b of base) {
    if (!seen.has(b.id)) merged.push(b);
  }
  return merged;
}

const BUNDLED = bundledFiles();

/**
 * Assemble a raw content-file map into a usable Content bundle, deep-merged
 * against current bundled defaults. Exported for session replay: a recorded
 * session stores the file map as played, and merging it here means replays
 * of old sessions survive future schema additions the same way stale saves do.
 */
export function assembleContent(files: Record<string, unknown>): Content {
  return assemble(files);
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
    game: deepDefaults(BUNDLED["game.json"], files["game.json"]) as Content["game"],
    elements: mergeArrayById((BUNDLED["elements.json"] ?? []) as Content["elements"], files["elements.json"]),
    rules: mergeArrayById((BUNDLED["rules.json"] ?? []) as Content["rules"], files["rules.json"]),
    achievements: mergeArrayById(
      (BUNDLED["achievements.json"] ?? []) as Content["achievements"], files["achievements.json"]
    ),
    tiles: mergeArrayById(BUNDLED["tiles.json"] as Content["tiles"], files["tiles.json"]),
    items: mergeArrayById(BUNDLED["items.json"] as Content["items"], files["items.json"]),
    recipes: mergeArrayById(BUNDLED["recipes.json"] as Content["recipes"], files["recipes.json"]),
    enemies: mergeArrayById(BUNDLED["enemies.json"] as Content["enemies"], files["enemies.json"]),
    taunts: mergeArrayById(BUNDLED["taunts.json"] as Content["taunts"], files["taunts.json"]),
    campaign: files["campaign.json"] as Content["campaign"],
    rooms,
  };
}

/**
 * Re-derive a publishable file map by running every id-array/game file back
 * through the same bundled-defaults merge `assemble()` uses for gameplay.
 * This is defense-in-depth for publish specifically: if a schema field was
 * added since a file's local/published copy was last saved, publishing no
 * longer ships that stale gap to every player — it self-heals the same way
 * a stale save already self-heals at runtime. It can't fix a field whose
 * *value* was explicitly saved (that's indistinguishable from an intentional
 * edit) — see the stale-overlay warning in the editor's publish tab for that.
 */
export function mergedFiles(files: Record<string, unknown>): Record<string, unknown> {
  const c = assemble(files);
  const out: Record<string, unknown> = { ...files };
  out["game.json"] = c.game;
  out["elements.json"] = c.elements;
  out["rules.json"] = c.rules;
  out["achievements.json"] = c.achievements;
  out["tiles.json"] = c.tiles;
  out["items.json"] = c.items;
  out["recipes.json"] = c.recipes;
  out["enemies.json"] = c.enemies;
  out["taunts.json"] = c.taunts;
  return out;
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
  /** Names of files a local (browser-only) editing draft overrides — surfaced
   *  in the publish tab so a forgotten old draft doesn't silently ship stale
   *  values on every future publish (see `mergedFiles`' limits above). */
  overlayFileNames: string[] = [];

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
          this.overlayFileNames = Object.keys(overlay.files ?? {});
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
    this.overlayFileNames = [];
  }
}

export const store = new ContentStore();
