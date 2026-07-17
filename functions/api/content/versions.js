// GET /api/content/versions -> publish history (password-gated)
import { checkPassword, json } from "../content.js";

export async function onRequestGet({ request, env }) {
  const denied = checkPassword(request, env);
  if (denied) return denied;
  const index = (await env.CONTENT.get("index")) ?? "[]";
  const live = await env.CONTENT.get("live");
  const liveId = live ? JSON.parse(live).id : null;
  return json({ ok: true, liveId, versions: JSON.parse(index) });
}
