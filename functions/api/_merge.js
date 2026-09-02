// Structural 3-way merge + diff for content bundles (the { "game.json": {...},
// "rooms/vents.json": {...} } file maps that publishes carry). Shared by:
//   - functions/api/content.js   (server-side merge on every publish)
//   - tools/publish-content.mjs  (repo pushes merge before writing KV)
//   - tools/diff-content.mjs     (CLI "what would this push change")
//   - src/editor/*               (publish-tab diff views)
// Plain ESM, no Cloudflare/Node/browser-specific APIs — keep it that way.
//
// Merge semantics (Sean, 2026-08-08): last publisher wins on anything BOTH
// sides changed since the common base; the point of the merge is that work
// on DIFFERENT files/entries/keys survives from both sides. Granularity:
//   - id-keyed arrays (tiles/items/behaviors/...) merge per entry by id
//   - game.json merges per nested key
//   - rooms/*.json and everything else are atomic per file (a char-map grid
//     can't be half-merged)

/** Files whose top level is an array of { id } entries, merged per entry. */
export const ID_ARRAY_FILES = new Set([
  "elements.json", "rules.json", "behaviors.json", "entities.json",
  "achievements.json", "tiles.json", "items.json", "recipes.json",
  "enemies.json", "taunts.json", "tracks.json",
]);

/** Files merged recursively per nested key. layers.json is keyed by set id
 *  and room id all the way down, so this gives per-set and per-room-binding
 *  merging for free; each set's `layers` array stays atomic (an array hits
 *  `pick`), which is the right grain — two people restacking the same set's
 *  layers concurrently is a genuine conflict, and last-publisher-wins is the
 *  established call there. */
export const DEEP_OBJECT_FILES = new Set(["game.json", "layers.json"]);

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

/** The one merge rule: if the incoming side didn't touch it since base, the
 *  live side's version (including a live-side delete) stands; any incoming
 *  change — including a delete — wins. `undefined` means "absent". */
const pick = (base, live, incoming) => (deepEqual(incoming, base) ? live : incoming);

/** True when every entry is an object with a string id (per-entry merge is safe). */
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

function mergeIdArray(base = [], live = [], incoming = []) {
  const byId = (arr) => new Map(arr.map((e) => [e.id, e]));
  const b = byId(base), l = byId(live), i = byId(incoming);
  const out = [];
  const seen = new Set();
  // Incoming's order first (it's the publisher's authored order)...
  for (const e of incoming) {
    seen.add(e.id);
    const v = pick(b.get(e.id), l.get(e.id), e);
    if (v !== undefined) out.push(v);
  }
  // ...then anything only the live side has (its additions, plus entries the
  // incoming side deleted — pick() decides which of those survive).
  for (const e of live) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const v = pick(b.get(e.id), e, i.get(e.id));
    if (v !== undefined) out.push(v);
  }
  return out;
}

function mergeDeep(base, live, incoming) {
  if (!isPlainObj(live) || !isPlainObj(incoming)) return pick(base, live, incoming);
  const out = {};
  const keys = new Set([...Object.keys(live), ...Object.keys(incoming)]);
  if (isPlainObj(base)) for (const k of Object.keys(base)) keys.add(k);
  for (const k of keys) {
    const v = mergeDeep(base?.[k], live[k], incoming[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * 3-way merge of whole content-file maps. `base` is the published version the
 * incoming side last synced from; `live` is what's published now; `incoming`
 * is the new publish. Returns a fresh file map.
 */
export function mergeBundles(base, live, incoming) {
  base = base ?? {};
  live = live ?? {};
  incoming = incoming ?? {};
  const out = {};
  const files = new Set([...Object.keys(live), ...Object.keys(incoming), ...Object.keys(base)]);
  for (const f of files) {
    const b = base[f], l = live[f], i = incoming[f];
    let v;
    if (ID_ARRAY_FILES.has(f) && idArrayLike(b, l, i)) {
      if (l === undefined || i === undefined) v = pick(b, l, i);
      else v = mergeIdArray(b ?? [], l, i);
    } else if (DEEP_OBJECT_FILES.has(f)) {
      v = mergeDeep(b, l, i);
    } else {
      v = pick(b, l, i);
    }
    if (v !== undefined) out[f] = v;
  }
  return out;
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
