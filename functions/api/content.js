// Published game content: what every player loads on boot.
//   GET  /api/content  -> the live content bundle (public)
//   POST /api/content  -> publish a new version (password-gated)
// Versions are kept in KV under ver:<id> with an index for history/rollback.
//
// Publishes carry a `baseId` (the published version the publisher last synced
// from). If someone else published since that base, the server 3-way merges
// per file / per id-entry / per game.json key, so concurrent work on
// DIFFERENT content survives from both sides; anything both sides touched
// goes to the publisher (last-writer-wins — Sean, 2026-08-08). No baseId
// (or a pruned one) keeps the old wholesale-replace behavior.
import { mergeBundles, diffBundles, summarizeDiff } from "./_merge.js";

const INDEX_KEY = "index";
const LIVE_KEY = "live";
const MAX_VERSIONS = 30;

export async function onRequestGet({ env }) {
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
  const denied = checkPassword(request, env);
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

  let files = body.files;
  let merged = false;
  if (live && baseId && baseId !== live.id) {
    // Someone published since this draft's base — merge their work in.
    const baseRaw = await env.CONTENT.get(`ver:${baseId}`);
    if (baseRaw) {
      files = mergeBundles(JSON.parse(baseRaw).files, live.files, body.files);
      merged = true;
    }
    // Base pruned from history: fall through to wholesale replace, as before.
  }

  const changes = summarizeDiff(diffBundles(live?.files ?? {}, files));

  const id = `v${Date.now()}`;
  const record = JSON.stringify({
    id,
    publishedAt: new Date().toISOString(),
    note: String(body.note ?? "").slice(0, 200),
    baseId,
    changes,
    files,
  });
  await env.CONTENT.put(`ver:${id}`, record);
  await env.CONTENT.put(LIVE_KEY, record);

  const index = JSON.parse((await env.CONTENT.get(INDEX_KEY)) ?? "[]");
  index.unshift({
    id,
    at: new Date().toISOString(),
    note: String(body.note ?? "").slice(0, 200),
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

export function checkPassword(request, env) {
  const given = request.headers.get("x-editor-password") ?? "";
  if (!env.EDITOR_PASSWORD || given !== env.EDITOR_PASSWORD) {
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
