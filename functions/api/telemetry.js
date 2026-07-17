// Cloudflare Pages Function: POST /api/telemetry
// Accepts a batch of anonymous gameplay events from a session and stores it
// in KV. No public read endpoint — batches are pulled and aggregated with
// tools/analytics.mjs via the owner's authenticated wrangler session.
// Batches auto-expire after 90 days so the namespace doesn't grow forever.

const MAX_EVENTS = 500;
const TTL_SECONDS = 90 * 24 * 60 * 60;

// The Electron build posts here cross-origin (from a file:// window), which
// makes this a CORS request needing a preflight response and an
// Access-Control-Allow-Origin header on the real one.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || !Array.isArray(body.events)) {
      return json({ ok: false, error: "bad body" }, 400);
    }
    const events = body.events.slice(0, MAX_EVENTS).map((e) => ({
      t: String(e.t ?? "").slice(0, 40),
      at: Number(e.at) || 0,
      room: e.room != null ? String(e.room).slice(0, 60) : undefined,
      item: e.item != null ? String(e.item).slice(0, 60) : undefined,
      ms: e.ms != null ? Number(e.ms) || 0 : undefined,
    }));
    if (events.length === 0) return json({ ok: true, stored: 0 });
    const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const record = {
      id,
      sessionId: String(body.sessionId ?? "unknown").slice(0, 64),
      receivedAt: new Date().toISOString(),
      events,
    };
    await env.TELEMETRY.put(id, JSON.stringify(record), { expirationTtl: TTL_SECONDS });
    return json({ ok: true, stored: events.length });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}
