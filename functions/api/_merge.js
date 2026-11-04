// Structural 3-way merge + diff for content bundles (the { "game.json": {...},
// "rooms/vents.json": {...} } file maps that publishes carry). Shared by:
//   - functions/api/content.js   (server-side merge on every publish)
//   - tools/publish-content.mjs  (repo pushes merge before writing KV)
//   - tools/diff-content.mjs     (CLI "what would this push change")
//   - src/data/content.ts        (background sync / rebase of open drafts)
//   - src/editor/*               (publish-tab diff views)
// Plain ESM, no Cloudflare/Node/browser-specific APIs — keep it that way.
//
// Merge semantics (Sean, 2026-11-04 — replaces 2026-08-08's silent
// last-publisher-wins): work on different things always survives from both
// sides, down to the individual FIELD — Sean changing a tile's damage while an
// artist changes its sprite is not a conflict. Granularity:
//   - plain objects merge per key, all the way down (entries, game.json,
//     layers.json, script.json, and a room file's own keys)
//   - keyed lists merge per item: id-keyed arrays anywhere (tiles, a layer
//     set's layers, a layer's props…), and a room's `entities` keyed by
//     npcId / type@x,y (the writer scope's own match)
//   - everything else (a room's char-map `tiles`, a sprite's frame list, …)
//     is one indivisible value — a char-map grid can't be half-merged
// A CONFLICT is one such value both sides changed since the common base, to
// different results. mergeBundlesDetailed reports them grouped by item
// ("tiles.json#wall", "layers.json#facility/far", "rooms/vents.json"), and
// the publish paths stop and ask a person — keep mine / take theirs —
// instead of choosing silently. mergeBundles (the legacy API) still settles
// unasked conflicts on the incoming side, for callers rebasing a local draft
// (where "incoming" IS the person's own unpublished work).

/** Files whose top level is an array of { id } entries, merged per entry. */
export const ID_ARRAY_FILES = new Set([
  "elements.json", "rules.json", "behaviors.json", "entities.json",
  "achievements.json", "tiles.json", "items.json", "recipes.json",
  "enemies.json", "taunts.json", "tracks.json",
]);

/** Files whose top level is a plain object. Every file merges per key now;
 *  this list is kept for the diff views, which describe these files by
 *  dotted path rather than by entry. */
export const DEEP_OBJECT_FILES = new Set(["game.json", "layers.json", "script.json"]);

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

const isPlainObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** True when every entry is an object with a string id (the diff views use this). */
function idArrayLike(...arrays) {
  for (const arr of arrays) {
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) return false;
    for (const e of arr) {
      if (!isPlainObj(e) || typeof e.id !== "string") return false;
    }
  }
  return true;
}

/** A stable key for an item in a keyed list, or null if it has none. Room
 *  entities have no id, so they're keyed the way the writer scope matches
 *  them: a resident by npcId, anything else by type + tile position (a moved
 *  entity reads as removed-here + added-there, which merges correctly). */
function itemKey(e, roomEntities) {
  if (!isPlainObj(e)) return null;
  if (typeof e.id === "string") return e.id;
  if (!roomEntities) return null;
  if (typeof e.npcId === "string") return `npc:${e.npcId}`;
  if (typeof e.type === "string" && typeof e.x === "number" && typeof e.y === "number") {
    return `${e.type}@${e.x},${e.y}`;
  }
  return null;
}

/** Can these arrays merge item by item? Every item needs a key that's unique
 *  within its own array — otherwise the list is one indivisible value. */
function keyedLike(roomEntities, ...arrays) {
  let any = false;
  for (const arr of arrays) {
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) return false;
    const seen = new Set();
    for (const e of arr) {
      const k = itemKey(e, roomEntities);
      if (k === null || seen.has(k)) return false;
      seen.add(k);
    }
    any = true;
  }
  return any;
}

/** The ITEM a conflict belongs to — what a person decides about as a unit
 *  (one tile, one layer, one room entity), plus a readable label. */
function groupOf(file, path) {
  const key = (s) => (typeof s === "object" ? s.key : s);
  const short = file.replace(/\.json$/, "");
  if (file.startsWith("rooms/")) {
    const ent = path[0] === "entities" && typeof path[1] === "object" ? path[1].key : null;
    return {
      group: ent ? `${file}#${ent}` : file,
      label: `room ${short.slice(6)}${ent ? ` — ${ent}` : ""}`,
    };
  }
  if (path.length === 0) return { group: file, label: short };
  if (typeof path[0] === "object") return { group: `${file}#${path[0].key}`, label: `${short}: ${path[0].key}` };
  if (file === "layers.json" && path[0] === "sets" && path.length >= 2) {
    const layer = path[2] === "layers" && typeof path[3] === "object" ? path[3].key : null;
    return {
      group: `layers.json#${path[1]}${layer ? `/${layer}` : ""}`,
      label: `environment ${path[1]}${layer ? ` — layer ${layer}` : ""}`,
    };
  }
  const head = path.slice(0, 2).map(key).join(".");
  return { group: `${file}#${head}`, label: `${short}: ${head}` };
}

/**
 * 3-way merge of one value, `path` locating it inside `file` (string keys
 * and { key } list-item markers). Returns the merged value; records any
 * conflict on ctx.
 */
function mergeValue(b, l, i, file, path, ctx) {
  if (deepEqual(l, i)) return l; // same result on both sides (or untouched)
  if (deepEqual(i, b)) return l; // only live changed it (incl. a live delete)
  if (deepEqual(l, b)) return i; // only incoming changed it (incl. a delete)
  // Both changed it, differently. Descend if it has parts that can merge…
  if (isPlainObj(l) && isPlainObj(i) && (b === undefined || isPlainObj(b))) {
    const out = {};
    const keys = new Set([...Object.keys(l), ...Object.keys(i), ...(isPlainObj(b) ? Object.keys(b) : [])]);
    for (const k of keys) {
      const v = mergeValue(b?.[k], l[k], i[k], file, [...path, k], ctx);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  const roomEntities = file.startsWith("rooms/") && path.length === 1 && path[0] === "entities";
  if (Array.isArray(l) && Array.isArray(i) && keyedLike(roomEntities, b, l, i)) {
    return mergeKeyedArray(b ?? [], l, i, file, path, ctx, roomEntities);
  }
  // …otherwise it's a genuine conflict on one indivisible value.
  const { group, label } = groupOf(file, path);
  const choice = ctx.resolutions[group];
  ctx.conflicts.push({ group, label, file, path, base: b, live: l, incoming: i, resolved: choice ?? null });
  return choice === "theirs" ? l : i;
}

function mergeKeyedArray(base, live, incoming, file, path, ctx, roomEntities) {
  const byKey = (arr) => new Map(arr.map((e) => [itemKey(e, roomEntities), e]));
  const b = byKey(base), l = byKey(live), i = byKey(incoming);
  const out = [];
  const seen = new Set();
  // Incoming's order first (it's the publisher's authored order)...
  for (const e of incoming) {
    const k = itemKey(e, roomEntities);
    seen.add(k);
    const v = mergeValue(b.get(k), l.get(k), e, file, [...path, { key: k }], ctx);
    if (v !== undefined) out.push(v);
  }
  // ...then anything only the live side has (its additions, plus items the
  // incoming side deleted — mergeValue decides which of those survive).
  for (const e of live) {
    const k = itemKey(e, roomEntities);
    if (seen.has(k)) continue;
    seen.add(k);
    const v = mergeValue(b.get(k), e, i.get(k), file, [...path, { key: k }], ctx);
    if (v !== undefined) out.push(v);
  }
  return out;
}

/**
 * 3-way merge of whole content-file maps. `base` is the published version the
 * incoming side last synced from; `live` is what's published now; `incoming`
 * is the new publish (or, when rebasing, the local draft).
 *
 * `resolutions` maps a conflict group to "mine" (incoming) or "theirs"
 * (live). Unresolved conflicts take the incoming side in `files`, and every
 * conflict is listed (with `resolved`) so a caller can stop and ask.
 */
export function mergeBundlesDetailed(base, live, incoming, resolutions = {}) {
  base = base ?? {};
  live = live ?? {};
  incoming = incoming ?? {};
  const ctx = { conflicts: [], resolutions: resolutions ?? {} };
  const out = {};
  for (const f of new Set([...Object.keys(live), ...Object.keys(incoming), ...Object.keys(base)])) {
    const v = mergeValue(base[f], live[f], incoming[f], f, [], ctx);
    if (v !== undefined) out[f] = v;
  }
  return { files: out, conflicts: ctx.conflicts };
}

/** Legacy API: the merged file map, unasked conflicts settled on the incoming side. */
export function mergeBundles(base, live, incoming) {
  return mergeBundlesDetailed(base, live, incoming).files;
}

/**
 * Conflicts as a person sees them: one row per ITEM, with every conflicting
 * value inside it (paths as plain strings) — the shape the publish dialogs
 * and the 409 response carry.
 */
export function groupConflicts(conflicts) {
  const groups = new Map();
  for (const c of conflicts) {
    const g = groups.get(c.group) ?? { group: c.group, label: c.label, file: c.file, resolved: c.resolved, values: [] };
    g.values.push({
      path: c.path.map((p) => (typeof p === "object" ? p.key : p)),
      base: c.base, live: c.live, incoming: c.incoming,
    });
    groups.set(c.group, g);
  }
  return [...groups.values()];
}

/** Dotted paths of leaves that differ between two nested objects. */
function changedPaths(a, b, prefix, out, cap) {
  if (out.length >= cap) return;
  if (deepEqual(a, b)) return;
  if (!isPlainObj(a) || !isPlainObj(b)) {
    out.push(prefix || "(root)");
    return;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    changedPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k, out, cap);
    if (out.length >= cap) return;
  }
}

/**
 * Structural diff of two file maps (from -> to). Returns:
 *   [{ file, kind: "added"|"removed"|"changed",
 *      entries?: [{ id, kind, fields?: string[] }],   // id-array files
 *      paths?: string[] }]                             // game.json-style files
 */
export function diffBundles(from, to) {
  from = from ?? {};
  to = to ?? {};
  const out = [];
  for (const f of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const a = from[f], b = to[f];
    if (deepEqual(a, b)) continue;
    if (a === undefined) { out.push({ file: f, kind: "added" }); continue; }
    if (b === undefined) { out.push({ file: f, kind: "removed" }); continue; }
    const change = { file: f, kind: "changed" };
    if (ID_ARRAY_FILES.has(f) && idArrayLike(a, b)) {
      const am = new Map(a.map((e) => [e.id, e]));
      const bm = new Map(b.map((e) => [e.id, e]));
      const entries = [];
      for (const id of new Set([...am.keys(), ...bm.keys()])) {
        const ae = am.get(id), be = bm.get(id);
        if (deepEqual(ae, be)) continue;
        if (ae === undefined) entries.push({ id, kind: "added" });
        else if (be === undefined) entries.push({ id, kind: "removed" });
        else {
          const fields = [];
          for (const k of new Set([...Object.keys(ae), ...Object.keys(be)])) {
            if (!deepEqual(ae[k], be[k])) fields.push(k);
          }
          entries.push({ id, kind: "changed", fields });
        }
      }
      if (entries.length > 0) change.entries = entries;
    } else if (DEEP_OBJECT_FILES.has(f)) {
      const paths = [];
      changedPaths(a, b, "", paths, 40);
      change.paths = paths;
    }
    out.push(change);
  }
  out.sort((x, y) => (x.file < y.file ? -1 : x.file > y.file ? 1 : 0));
  return out;
}

const MARK = { added: "+", removed: "-", changed: "~" };

/** Compact one-line-per-file summary strings (stored in the version index). */
export function summarizeDiff(changes, maxLines = 14) {
  const lines = [];
  for (const c of changes) {
    if (c.entries) {
      const parts = c.entries.slice(0, 8).map((e) => `${MARK[e.kind]}${e.id}`);
      if (c.entries.length > 8) parts.push(`+${c.entries.length - 8} more`);
      lines.push(`${c.file}: ${parts.join(" ")}`);
    } else if (c.paths && c.paths.length > 0) {
      const parts = c.paths.slice(0, 6);
      if (c.paths.length > 6) parts.push(`+${c.paths.length - 6} more`);
      lines.push(`${c.file}: ${parts.join(", ")}`);
    } else {
      lines.push(`${MARK[c.kind]} ${c.file}`);
    }
  }
  if (lines.length > maxLines) {
    const extra = lines.length - maxLines;
    lines.length = maxLines;
    lines.push(`…+${extra} more files`);
  }
  return lines;
}
