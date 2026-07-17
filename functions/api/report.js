// Cloudflare Pages Function: POST /api/report
// Stores a player-submitted bug/feedback report (with context + a screenshot)
// into KV so it can be reviewed later via tools/fetch-reports.mjs.
// No public read endpoint is exposed — reports are pulled with the
// project owner's own authenticated `wrangler` session, not over the web.

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return json({ ok: false, error: "bad body" }, 400);
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
    };
    await env.REPORTS.put(id, JSON.stringify(record));
    return json({ ok: true, id });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
