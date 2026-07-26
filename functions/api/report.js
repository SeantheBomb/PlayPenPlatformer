// Cloudflare Pages Function: /api/report
//   POST /api/report          -> player/review-authored report (public)
//   GET  /api/report          -> list report summaries (password-gated)
//   GET  /api/report?id=<id>  -> one full report, incl. screenshot (gated)
//
// A report correlates to a session via sessionId + sessionStep (the
// session-relative sim step it fired at) whenever a recording was active at
// submit time — the editor's sessions tab uses this to draw a milestone on
// the timeline and jump playback straight to that moment. Reports filed
// from playback review (not live play) carry source:"review" instead of
// the default "player".

import { checkPassword, json } from "./content.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-editor-password",
};
const LIST_LIMIT = 500;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return withCors(json({ ok: false, error: "bad body" }, 400));
    }
    const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const record = {
      id,
      receivedAt: new Date().toISOString(),
      type: String(body.type ?? "bug").slice(0, 40),
      message: String(body.message ?? "").slice(0, 4000),
      room: body.room ?? null,
      position: body.position ?? null,
      health: body.health ?? null,
      inventory: body.inventory ?? null,
      recipes: body.recipes ?? null,
      achievements: body.achievements ?? null,
      stats: body.stats ?? null,
      scheme: body.scheme ?? null,
      appVersion: body.appVersion ?? null,
      userAgent: request.headers.get("user-agent") ?? null,
      viewport: body.viewport ?? null,
      screenshot: typeof body.screenshot === "string" ? body.screenshot.slice(0, 3_000_000) : null,
      sessionId: typeof body.sessionId === "string" ? body.sessionId.slice(0, 40) : null,
      sessionStep: Number.isFinite(body.sessionStep) ? body.sessionStep | 0 : null,
      source: body.source === "review" ? "review" : "player",
    };
    await env.REPORTS.put(id, JSON.stringify(record), { metadata: terseMeta(record) });
    return withCors(json({ ok: true, id }));
  } catch (e) {
    return withCors(json({ ok: false, error: String(e) }, 500));
  }
}

/** Small enough to ride as KV key metadata — the list view needs zero gets. */
function terseMeta(r) {
  return {
    t: r.receivedAt,
    ty: r.type,
    m: (r.message ?? "").slice(0, 120),
    room: r.room,
    sid: r.sessionId,
    step: r.sessionStep,
    src: r.source,
  };
}

export async function onRequestGet({ request, env }) {
  const denied = checkPassword(request, env);
  if (denied) return withCors(denied);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  try {
    if (id) return withCors(await getReport(env, id));
    return withCors(await listReports(env));
  } catch (e) {
    return withCors(json({ ok: false, error: String(e) }, 500));
  }
}

async function listReports(env) {
  const out = [];
  let cursor;
  while (out.length < LIST_LIMIT) {
    const page = await env.REPORTS.list({ cursor, limit: 1000 });
    for (const key of page.keys) out.push({ id: key.name, ...(key.metadata ?? {}) });
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  out.sort((a, b) => String(b.t ?? "").localeCompare(String(a.t ?? "")));
  return json({ ok: true, reports: out.slice(0, LIST_LIMIT) });
}

async function getReport(env, id) {
  if (!/^[0-9]+-[a-z0-9]{4,10}$/.test(id)) return json({ ok: false, error: "bad id" }, 400);
  const raw = await env.REPORTS.get(id);
  if (!raw) return json({ ok: false, error: "not found" }, 404);
  return json({ ok: true, report: JSON.parse(raw) });
}

function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
