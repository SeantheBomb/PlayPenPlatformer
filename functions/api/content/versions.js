// GET /api/content/versions       -> publish history (password-gated)
// GET /api/content/versions?id=v… -> one full version record, for diff views
import { checkPassword, json } from "../content.js";

export async function onRequestGet({ request, env }) {
  const denied = checkPassword(request, env);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const record = await env.CONTENT.get(`ver:${id}`);
    if (!record) return json({ ok: false, error: "unknown version" }, 404);
    return new Response(record, { headers: { "content-type": "application/json" } });
  }
  const index = (await env.CONTENT.get("index")) ?? "[]";
  const live = await env.CONTENT.get("live");
  const liveId = live ? JSON.parse(live).id : null;
  return json({ ok: true, liveId, versions: JSON.parse(index) });
}
