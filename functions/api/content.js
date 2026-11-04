// Published game content: what every player loads on boot.
//   GET  /api/content         -> the live content bundle (public)
//   GET  /api/content?meta=1  -> just { id, at, by, note, changes } of live —
//                                what open studios/editors poll to notice
//                                someone else's publish without downloading
//                                the whole bundle every 15 s
//   POST /api/content         -> publish a new version (password-gated)
// Versions are kept in KV under ver:<id> with an index for history/rollback.
//
// Publishes carry a `baseId` (the published version the publisher last synced
// from). If someone else published since that base, the server 3-way merges
// down to individual fields (_merge.js), so concurrent work on DIFFERENT
// things survives from both sides. A value BOTH sides changed is a conflict:
// the publish is refused with 409 { conflicts } and the client asks the
// person, per item, keep mine / take theirs, then resends with
// `resolutions` (Sean, 2026-11-04 — replaces silent last-writer-wins).
//
// Scoped (artist/writer) publishes merge through a PROJECTION: base and
// incoming are each overlaid onto live first, so all three sides agree on
// everything outside the scope and only in-scope fields can merge or
// conflict. Without that an artist's stale open session reverted another
// artist's newer art on every publish. No baseId (an old cached client) or a
// base pruned from history keeps the old behavior: overlay / replace.
import { mergeBundlesDetailed, groupConflicts, diffBundles, summarizeDiff } from "./_merge.js";
import { overlayArtBundle } from "./_artscope.js";
import { overlayStoryBundle } from "./_writerscope.js";

const INDEX_KEY = "index";
const LIVE_KEY = "live";
const META_KEY = "live-meta";
const MAX_VERSIONS = 60;

export async function onRequestGet({ request, env }) {
  // ?id=v… returns one past version — public like live, since every version
  // was live (public) once. Browser drafts need their base version to rebase
  // onto newer publishes on load (ContentStore.load / rebaseDraft).
  const params = new URL(request.url).searchParams;
  if (params.has("meta")) {
    let meta = await env.CONTENT.get(META_KEY);
    if (!meta) {
      // Published before live-meta existed: derive it once from live.
      const liveRaw = await env.CONTENT.get(LIVE_KEY);
      if (!liveRaw) return json({ ok: false, error: "nothing published yet" }, 404);
      meta = JSON.stringify(metaOf(JSON.parse(liveRaw)));
    }
    return new Response(meta, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const id = params.get("id");
  if (id) {
    const record = await env.CONTENT.get(`ver:${id}`);
    if (!record) return json({ ok: false, error: "unknown version" }, 404);
    return new Response(record, {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" },
    });
  }
  const live = await env.CONTENT.get(LIVE_KEY);
  if (!live) return json({ ok: false, error: "nothing published yet" }, 404);
  return new Response(live, {
    headers: {
      "content-type": "application/json",
      // Players pick up publishes on their next page load, never mid-session.
      "cache-control": "no-store",
    },
  });
}

export async function onRequestPost({ request, env }) {
  // Three credentials, three publish scopes: the editor password publishes
  // everything (with 3-way merge); the artist password publishes ART ONLY
  // (_artscope.js overlays just sprite/portrait fields onto live); the
  // writer password publishes STORY ONLY (_writerscope.js overlays dialog,
  // quests, taunts, notes and descriptions). Scoped publishes start from
  // live by construction, so they can never touch anything outside their
  // fields or clobber a concurrent design edit.
  const isArtist = !checkArtistPassword(request, env);
  const isWriter = !isArtist && !checkWriterPassword(request, env);
  const denied = isArtist || isWriter ? null : checkPassword(request, env);
  if (denied) return denied;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad json" }, 400);
  }
  if (!body?.files || typeof body.files !== "object") {
    return json({ ok: false, error: "missing files" }, 400);
  }

  const liveRaw = await env.CONTENT.get(LIVE_KEY);
  const live = liveRaw ? JSON.parse(liveRaw) : null;
  const baseId = typeof body.baseId === "string" ? body.baseId : null;
  const resolutions = isPlainObj(body.resolutions) ? body.resolutions : {};
  const by = String(body.author ?? "").trim().slice(0, 40) || null;

  const scope = isArtist ? overlayArtBundle : isWriter ? overlayStoryBundle : null;
  if (scope && !live) return json({ ok: false, error: "nothing published yet" }, 409);
  // Scoped: everything outside the scope comes from live, by construction.
  const project = (f) => (scope ? scope(live.files, f) : f);

  let files = project(body.files);
  let merged = !!scope;
  if (live && baseId && baseId !== live.id) {
    // Someone published since this draft's base — merge their work in.
    const baseRaw = await env.CONTENT.get(`ver:${baseId}`);
    if (baseRaw) {
      const r = mergeBundlesDetailed(project(JSON.parse(baseRaw).files), live.files, files, resolutions);
      const open = r.conflicts.filter((c) => !c.resolved);
      if (open.length) {
        return json({
          ok: false,
          error: "conflicts",
          liveId: live.id,
          liveBy: live.by ?? null,
          liveAt: live.publishedAt ?? null,
          conflicts: groupConflicts(open),
        }, 409);
      }
      files = r.files;
      merged = true;
    }
    // Base pruned from history: overlay / wholesale replace, as before.
  }

  const changes = summarizeDiff(diffBundles(live?.files ?? {}, files));

  const id = `v${Date.now()}`;
  const note = (isArtist ? "🎨 " : isWriter ? "✍ " : "") + String(body.note ?? "").slice(0, 200);
  const record = JSON.stringify({
    id,
    publishedAt: new Date().toISOString(),
    note,
    by,
    baseId,
    changes,
    files,
  });
  await env.CONTENT.put(`ver:${id}`, record);
  await env.CONTENT.put(LIVE_KEY, record);
  await env.CONTENT.put(META_KEY, JSON.stringify(metaOf(JSON.parse(record))));

  const index = JSON.parse((await env.CONTENT.get(INDEX_KEY)) ?? "[]");
  index.unshift({
    id,
    at: new Date().toISOString(),
    note,
    by,
    bytes: record.length,
    merged,
    changes,
  });
  for (const old of index.splice(MAX_VERSIONS)) {
    await env.CONTENT.delete(`ver:${old.id}`);
  }
  await env.CONTENT.put(INDEX_KEY, JSON.stringify(index));
  return json({ ok: true, id, merged, changes });
}

const isPlainObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** The small summary of a published record that pollers read. */
export function metaOf(record) {
  return {
    id: record.id,
    at: record.publishedAt ?? null,
    by: record.by ?? null,
    note: record.note ?? "",
    changes: record.changes ?? [],
  };
}

export function checkPassword(request, env) {
  const given = request.headers.get("x-editor-password") ?? "";
  if (!env.EDITOR_PASSWORD || given !== env.EDITOR_PASSWORD) {
    return json({ ok: false, error: "wrong password" }, 401);
  }
  return null;
}

/** The artist's own credential — grants art-scoped publishing only. */
export function checkArtistPassword(request, env) {
  const given = request.headers.get("x-artist-password") ?? "";
  if (!env.ARTIST_PASSWORD || given !== env.ARTIST_PASSWORD) {
    return json({ ok: false, error: "wrong password" }, 401);
  }
  return null;
}

/** The writer's own credential — grants story-scoped publishing only. */
export function checkWriterPassword(request, env) {
  const given = request.headers.get("x-writer-password") ?? "";
  if (!env.WRITER_PASSWORD || given !== env.WRITER_PASSWORD) {
    return json({ ok: false, error: "wrong password" }, 401);
  }
  return null;
}

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
