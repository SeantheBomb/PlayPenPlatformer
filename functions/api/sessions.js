// Recorded playsessions (deterministic input-replay telemetry).
//   POST /api/sessions           -> player clients upload session chunks (public)
//   GET  /api/sessions           -> list session summaries (password-gated)
//   GET  /api/sessions?id=<id>   -> one full session, chunks assembled (gated)
//
// Storage layout in the SESSIONS KV namespace:
//   s:<id>:meta   -> full SessionMeta JSON; a terse subset rides in the KV
//                    key *metadata* so the list endpoint needs zero gets.
//   s:<id>:c<n>   -> chunk n: { events: [...], content?: {...} } (content
//                    — the game files as played — rides in chunk 0 only).
// Sessions expire after 90 days, same policy as the analytics telemetry.

import { checkPassword, json } from "./content.js";

const TTL = 90 * 24 * 60 * 60;
const MAX_BODY = 8 * 1024 * 1024; // one chunk; whole sessions span many
const LIST_LIMIT = 500;

// The Electron build posts from a file:// origin — answer CORS preflights.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-editor-password",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

/** ≤1024-byte summary stored as KV key metadata — powers the list view. */
function terseMeta(meta) {
  return {
    p: String(meta.pid ?? "").slice(0, 16),
    t: meta.startedAt,
    s: meta.steps | 0,
    r: (meta.rooms ?? []).map((r) => r.id).join(">").slice(0, 400),
    w: meta.win ? 1 : 0,
    k: meta.deaths | 0,
    c: meta.crafts | 0,
    e: String(meta.endReason ?? "").slice(0, 16),
    x: meta.tainted ? 1 : 0,
    v: meta.dev ? 1 : 0,
    m: String(meta.scheme ?? "").slice(0, 10),
  };
}

export async function onRequestPost({ request, env }) {
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return withCors(json({ ok: false, error: "too large" }, 413));
    const body = JSON.parse(text);
    const id = String(body?.id ?? "");
    if (!/^[a-z0-9-]{6,40}$/.test(id) || typeof body.seq !== "number" || !body.meta) {
      return withCors(json({ ok: false, error: "bad body" }, 400));
    }
    const seq = body.seq | 0;
    await env.SESSIONS.put(
      `s:${id}:c${seq}`,
      JSON.stringify({ events: body.events ?? [], content: body.content ?? undefined }),
      { expirationTtl: TTL }
    );
    await env.SESSIONS.put(`s:${id}:meta`, JSON.stringify({ ...body.meta, chunks: seq + 1 }), {
      expirationTtl: TTL,
      metadata: terseMeta(body.meta),
    });
    return withCors(json({ ok: true, id, seq }));
  } catch (e) {
    return withCors(json({ ok: false, error: String(e) }, 500));
  }
}

export async function onRequestGet({ request, env }) {
  const denied = checkPassword(request, env);
  if (denied) return withCors(denied);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  try {
    if (id) return withCors(await getSession(env, id));
    return withCors(await listSessions(env));
  } catch (e) {
    return withCors(json({ ok: false, error: String(e) }, 500));
  }
}

async function listSessions(env) {
  const out = [];
  let cursor;
  while (out.length < LIST_LIMIT) {
    const page = await env.SESSIONS.list({ prefix: "s:", cursor, limit: 1000 });
    for (const key of page.keys) {
      if (!key.name.endsWith(":meta")) continue;
      out.push({ id: key.name.slice(2, -5), ...(key.metadata ?? {}) });
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  out.sort((a, b) => String(b.t ?? "").localeCompare(String(a.t ?? "")));
  return json({ ok: true, sessions: out.slice(0, LIST_LIMIT) });
}

async function getSession(env, id) {
  if (!/^[a-z0-9-]{6,40}$/.test(id)) return json({ ok: false, error: "bad id" }, 400);
  const metaRaw = await env.SESSIONS.get(`s:${id}:meta`);
  if (!metaRaw) return json({ ok: false, error: "not found" }, 404);
  const meta = JSON.parse(metaRaw);
  const chunkCount = Math.max(1, meta.chunks | 0);
  const chunks = await Promise.all(
    Array.from({ length: chunkCount }, (_, i) => env.SESSIONS.get(`s:${id}:c${i}`))
  );
  let content = null;
  const events = [];
  for (const raw of chunks) {
    if (!raw) continue;
    const c = JSON.parse(raw);
    if (c.content) content = c.content;
    if (Array.isArray(c.events)) events.push(...c.events);
  }
  return json({ ok: true, meta, content, events });
}

function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
