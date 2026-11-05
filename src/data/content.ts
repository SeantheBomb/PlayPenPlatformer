// ContentStore: loads all serialized game content and saves editor changes.
// Sources, in precedence order:
//   1. Electron: content/ directory on disk (live truth, editor writes here)
//   2. Browser: localStorage overlay (editor writes here) over bundled defaults
//   3. Bundled defaults: content/*.json imported at build time
import type { Content, RoomDef } from "./types";
import {
  diffBundles, groupConflicts, mergeBundlesDetailed, summarizeDiff,
  type ConflictGroup, type Resolution,
} from "../../functions/api/_merge.js";
import { SPRITE_FIELDS } from "../../functions/api/_artscope.js";

/** Art fields are optional DATA, not schema: their absence means "no custom
 *  art / not animated", every renderer already handles that, and removing
 *  one is a real edit. deepDefaults must never backfill them from the
 *  bundled copy — doing so meant a 2-frame animation in bundled content
 *  could never be replaced by a single image (the deleted spriteFrames came
 *  straight back), "Revert to built-in look" silently didn't, and players
 *  kept the old art after a publish (Sean, 2026-11-04: an .aseprite that
 *  "didn't upload"). `portraits` (the Warden's faces) is one art value too:
 *  per-emotion backfill would resurrect a cleared face. */
const ART_KEYS = new Set<string>([...SPRITE_FIELDS, "portraits"]);

declare global {
  interface Window {
    playpenFS?: {
      readAllContent(): Promise<Record<string, string>>;
      writeContent(relPath: string, text: string): Promise<boolean>;
      deleteContent(relPath: string): Promise<boolean>;
      /** Opens an http(s) URL in the system browser. */
      openExternal?(url: string): Promise<void>;
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
    if (ART_KEYS.has(key)) {
      // Taken from override as-is, absence included (see ART_KEYS).
      if (key in (override as Record<string, unknown>)) merged[key] = (override as Record<string, unknown>)[key];
      else delete merged[key];
      continue;
    }
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
    behaviors: mergeArrayById((BUNDLED["behaviors.json"] ?? []) as Content["behaviors"], files["behaviors.json"]),
    entityTypes: mergeArrayById((BUNDLED["entities.json"] ?? []) as Content["entityTypes"], files["entities.json"]),
    achievements: mergeArrayById(
      (BUNDLED["achievements.json"] ?? []) as Content["achievements"], files["achievements.json"]
    ),
    tiles: mergeArrayById(BUNDLED["tiles.json"] as Content["tiles"], files["tiles.json"]),
    items: mergeArrayById(BUNDLED["items.json"] as Content["items"], files["items.json"]),
    recipes: mergeArrayById(BUNDLED["recipes.json"] as Content["recipes"], files["recipes.json"]),
    enemies: mergeArrayById(BUNDLED["enemies.json"] as Content["enemies"], files["enemies.json"]),
    taunts: mergeArrayById(BUNDLED["taunts.json"] as Content["taunts"], files["taunts.json"]),
    tracks: mergeArrayById((BUNDLED["tracks.json"] ?? []) as Content["tracks"], files["tracks.json"]),
    campaign: files["campaign.json"] as Content["campaign"],
    rooms,
    // Nested-key merge (like game.json): a draft/publish saved before a layer
    // field existed still gets the bundled default for it instead of handing
    // the renderer an undefined it reads every frame.
    layers: deepDefaults(BUNDLED["layers.json"], files["layers.json"]) as Content["layers"],
    // Writers Studio notes + line ledger: nested-key merge, same reasoning.
    script: deepDefaults(BUNDLED["script.json"] ?? { notes: {}, reminders: {}, lines: {} }, files["script.json"]) as Content["script"],
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
  out["behaviors.json"] = c.behaviors;
  out["entities.json"] = c.entityTypes;
  out["achievements.json"] = c.achievements;
  out["tiles.json"] = c.tiles;
  out["items.json"] = c.items;
  out["recipes.json"] = c.recipes;
  out["enemies.json"] = c.enemies;
  out["taunts.json"] = c.taunts;
  out["tracks.json"] = c.tracks;
  out["layers.json"] = c.layers;
  out["script.json"] = c.script;
  return out;
}

/**
 * Rebase a local browser draft onto a newer published version, git-style:
 * 3-way merge with the draft's base, so anything the draft didn't change
 * picks up the newer publish and anything it did change keeps the local
 * value. Same merge rules as the server's publish merge (_merge.js). All
 * three sides are normalized through `mergedFiles` first so schema-default
 * gaps in an old draft don't read as "local edits" that mask live changes.
 *
 * `collisions` are items BOTH the draft and live changed differently — the
 * draft's value is kept (a sync never overwrites local work); `resolutions`
 * can settle them toward live, as after a publish where the person chose
 * "take theirs".
 */
export function rebaseDraft(
  base: Record<string, unknown>,
  live: Record<string, unknown>,
  draft: Record<string, unknown>,
  deleted: Iterable<string> = [],
  resolutions: Record<string, Resolution> = {}
): { files: Record<string, unknown>; hasLocalChanges: boolean; incoming: string[]; collisions: ConflictGroup[] } {
  const b = mergedFiles({ ...BUNDLED, ...base });
  const l = mergedFiles({ ...BUNDLED, ...live });
  const dRaw: Record<string, unknown> = { ...BUNDLED, ...draft };
  for (const rel of deleted) delete dRaw[rel];
  const d = mergedFiles(dRaw);
  const r = mergeBundlesDetailed(b, l, d, resolutions);
  return {
    files: r.files,
    hasLocalChanges: diffBundles(l, r.files).length > 0,
    incoming: summarizeDiff(diffBundles(d, r.files), 40),
    collisions: groupConflicts(r.conflicts.filter((c) => !c.resolved)),
  };
}

/** The small summary of live that open sessions poll (GET /api/content?meta=1). */
export interface LiveMeta {
  id: string;
  at: string | null;
  by: string | null;
  note: string;
  changes: string[];
}

/** A newer publish, already merged with this session's draft, waiting for a
 *  quiet moment to be applied (ContentStore.prepareSync → applySync). */
export interface PendingSync {
  meta: LiveMeta;
  files: Record<string, unknown>;
  /** The draft's fork point after applying (ignored when clearDraft). */
  baseId: string | null;
  /** Nothing local is left that live lacks — drop the draft. */
  clearDraft: boolean;
  /** What arrived, one line per file (summarizeDiff). */
  incoming: string[];
  /** Items both sides changed — local kept, the publish step will ask. */
  collisions: ConflictGroup[];
  /** Store revision this was computed against; stale if an edit landed since. */
  revision: number;
}

export function isElectron(): boolean {
  return !!window.playpenFS;
}

export class ContentStore {
  content!: Content;
  /** id/time of the published bundle this session loaded (browser only). */
  publishedInfo: { id: string; publishedAt: string; note?: string; by?: string | null } | null = null;
  /** Bumped on every local edit — a background sync computed before an edit
   *  is discarded rather than applied over it. */
  revision = 0;
  /** Items this draft and a newer publish BOTH changed: the draft's value is
   *  kept and the draft's base stays behind them, so publishing asks
   *  "keep mine / take theirs" instead of anyone's work vanishing. */
  collisions: ConflictGroup[] = [];
  private versionCache = new Map<string, Record<string, unknown>>();
  private files: Record<string, unknown> = {};
  private deletedInOverlay = new Set<string>();
  /** Published version id the local draft diverged from — stamped when the
   *  overlay first gets a write, sent as `baseId` with every publish so the
   *  server can 3-way merge concurrent publishes instead of clobbering. */
  private overlayBaseId: string | null = null;
  /** Names of files a local (browser-only) editing draft overrides — surfaced
   *  in the publish tab so a forgotten old draft doesn't silently ship stale
   *  values on every future publish (see `mergedFiles`' limits above). */
  overlayFileNames: string[] = [];
  /** What happened to the local draft on load when live had moved past its
   *  base (surfaced in the publish tab). null = nothing to rebase. */
  rebaseInfo:
    | { ok: true; from: string; to: string; incoming: string[]; absorbed: boolean }
    | { ok: false; from: string; to: string }
    | null = null;

  /** If someone published since this draft's base, pull their work into the
   *  draft now (3-way, local edits win overlaps) so non-conflicting changes
   *  show up on reload without discarding the draft. */
  private async rebaseOntoLive(liveFiles: Record<string, unknown> | null): Promise<void> {
    const from = this.overlayBaseId;
    const to = this.publishedInfo?.id;
    if (!liveFiles || !from || !to || from === to) return;
    const baseFiles = await this.fetchVersion(from);
    if (!baseFiles) {
      // Base pruned from history (or unreachable): can't tell which draft
      // values are edits vs stale copies, so the draft keeps winning wholesale.
      this.rebaseInfo = { ok: false, from, to };
      return;
    }
    const r = rebaseDraft(baseFiles, liveFiles, this.files, this.deletedInOverlay);
    this.files = r.files;
    for (const rel of [...this.deletedInOverlay]) {
      if (rel in this.files) this.deletedInOverlay.delete(rel);
    }
    this.rebaseInfo = { ok: true, from, to, incoming: r.incoming, absorbed: !r.hasLocalChanges };
    this.collisions = r.collisions;
    if (r.hasLocalChanges) {
      // With collisions the base stays put, so the server still sees both
      // sides' change at publish time and asks instead of picking silently.
      if (!r.collisions.length) this.overlayBaseId = to;
      this.persistOverlay();
    } else {
      // Nothing local left that live doesn't already have — drop the draft.
      this.clearOverlay();
    }
    console.info(
      `[content] rebased local draft ${from} -> ${to}` +
      (r.incoming.length ? `; pulled in:\n  ${r.incoming.join("\n  ")}` : "; nothing new from live") +
      (r.hasLocalChanges ? "" : " (draft fully published — cleared)")
    );
  }

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
      let liveFiles: Record<string, unknown> | null = null;
      try {
        const res = await fetch("/api/content", { cache: "no-store" });
        if (res.ok) {
          const pub = (await res.json()) as {
            id: string; publishedAt: string; note?: string; by?: string | null;
            files: Record<string, unknown>;
          };
          if (pub?.files) {
            Object.assign(this.files, pub.files);
            liveFiles = pub.files;
            this.versionCache.set(pub.id, pub.files);
            this.publishedInfo = {
              id: pub.id, publishedAt: pub.publishedAt, note: pub.note, by: pub.by ?? null,
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
            baseId?: string | null;
          };
          Object.assign(this.files, overlay.files);
          this.overlayFileNames = Object.keys(overlay.files ?? {});
          this.overlayBaseId = overlay.baseId ?? null;
          for (const rel of overlay.deleted ?? []) {
            delete this.files[rel];
            this.deletedInOverlay.add(rel);
          }
          await this.rebaseOntoLive(liveFiles);
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
    this.revision++;
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
    this.revision++;
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
    // First write of a fresh draft: remember which published version it
    // forked from (pre-feature drafts without a stamp keep null = wholesale).
    if (this.overlayBaseId === null && this.overlayFileNames.length === 0) {
      this.overlayBaseId = this.publishedInfo?.id ?? null;
    }
    this.overlayFileNames = Object.keys(this.files);
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        files: this.files,
        deleted: [...this.deletedInOverlay],
        baseId: this.overlayBaseId,
      })
    );
  }

  /** The local draft's fork point (null = no draft, or a pre-tracking draft). */
  get draftBaseId(): string | null {
    return this.overlayBaseId;
  }

  /** Base version id to send with a publish (draft's fork point, else the
   *  version this session loaded — e.g. publishing with no local edits). */
  publishBaseId(): string | null {
    return this.overlayBaseId ?? this.publishedInfo?.id ?? null;
  }

  /** After a successful publish. A fast-forward publish made live exactly
   *  this draft, so it becomes the new base. A MERGED publish did not — live
   *  also holds someone else's work the draft lacks — so the base stays put
   *  and the next load rebases that work in (moving the base here would make
   *  the draft's stale copies of their entries look like local edits). */
  markPublished(id: string, merged: boolean): void {
    if (merged) return;
    this.overlayBaseId = id;
    if (localStorage.getItem(LS_KEY)) this.persistOverlay();
  }

  // ---------- Live sync: other people's publishes arriving mid-session ----------

  /** One published version's files (immutable once published, so cached). */
  private async fetchVersion(id: string): Promise<Record<string, unknown> | null> {
    const hit = this.versionCache.get(id);
    if (hit) return hit;
    try {
      const res = await fetch(`/api/content?id=${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const files = ((await res.json()) as { files: Record<string, unknown> }).files;
      this.versionCache.set(id, files);
      return files;
    } catch {
      return null;
    }
  }

  /** What's live right now, cheaply (no bundle download). null = offline. */
  async liveMeta(): Promise<LiveMeta | null> {
    try {
      const res = await fetch("/api/content?meta=1", { cache: "no-store" });
      return res.ok ? ((await res.json()) as LiveMeta) : null;
    } catch {
      return null;
    }
  }

  /**
   * If live has moved past what this session has, merge it with the local
   * draft (local work always kept) WITHOUT applying it yet — the caller
   * applies at a quiet moment so nothing changes under someone's cursor.
   * null = nothing new, offline, Electron (disk is truth), or a draft that
   * predates base tracking (can't tell its edits from stale copies).
   */
  async prepareSync(
    opts: { force?: boolean; resolutions?: Record<string, Resolution> } = {}
  ): Promise<PendingSync | null> {
    if (isElectron()) return null;
    const revision = this.revision;
    const meta = await this.liveMeta();
    if (!meta || (!opts.force && meta.id === this.publishedInfo?.id)) return null;
    let live: { id: string; publishedAt: string; note?: string; by?: string | null; files: Record<string, unknown> };
    try {
      const res = await fetch("/api/content", { cache: "no-store" });
      if (!res.ok) return null;
      live = await res.json();
    } catch {
      return null;
    }
    this.versionCache.set(live.id, live.files);
    const liveMeta: LiveMeta = {
      ...meta, id: live.id, at: live.publishedAt ?? meta.at, by: live.by ?? meta.by, note: live.note ?? meta.note,
    };
    if (this.overlayFileNames.length === 0) {
      // No local draft: live simply replaces what this session had.
      const files = { ...bundledFiles(), ...live.files };
      return {
        meta: liveMeta, files, baseId: null, clearDraft: true, collisions: [], revision,
        incoming: summarizeDiff(diffBundles(mergedFiles(this.files), mergedFiles(files)), 40),
      };
    }
    const from = this.overlayBaseId;
    if (!from) return null;
    const baseFiles = await this.fetchVersion(from);
    if (!baseFiles) return null;
    const r = rebaseDraft(baseFiles, live.files, this.files, this.deletedInOverlay, opts.resolutions);
    return {
      meta: liveMeta,
      files: r.files,
      // Collisions keep the old base so the publish step still sees them.
      baseId: r.collisions.length ? from : live.id,
      clearDraft: !r.hasLocalChanges,
      incoming: r.incoming,
      collisions: r.collisions,
      revision,
    };
  }

  /** Apply a prepared sync. false = a local edit landed since it was
   *  computed (it's dropped; the next poll recomputes on top of the edit). */
  applySync(p: PendingSync): boolean {
    if (p.revision !== this.revision) return false;
    this.files = p.files;
    for (const rel of [...this.deletedInOverlay]) {
      if (rel in this.files) this.deletedInOverlay.delete(rel);
    }
    this.publishedInfo = { id: p.meta.id, publishedAt: p.meta.at ?? "", note: p.meta.note, by: p.meta.by };
    if (p.clearDraft) {
      this.clearOverlay();
    } else {
      this.overlayBaseId = p.baseId;
      this.persistOverlay();
    }
    this.collisions = p.collisions;
    this.content = assemble(this.files);
    this.revision++;
    return true;
  }

  /** After a successful publish: take live as the new truth (applying the
   *  person's keep-mine / take-theirs choices) so the draft is clean and the
   *  next publish starts from what everyone has. */
  async adoptPublished(id: string, merged: boolean, resolutions: Record<string, Resolution> = {}): Promise<void> {
    const p = await this.prepareSync({ force: true, resolutions });
    if (p && p.meta.id === id && this.applySync(p)) return;
    this.markPublished(id, merged); // couldn't adopt (offline / raced): the old rule
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
    this.overlayBaseId = null;
    this.collisions = [];
  }
}

export const store = new ContentStore();
