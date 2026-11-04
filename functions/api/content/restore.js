// POST /api/content/restore {id} -> make an old version live again (password-gated)
import { checkPassword, json, metaOf } from "../content.js";

export async function onRequestPost({ request, env }) {
  const denied = checkPassword(request, env);
  if (denied) return denied;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad json" }, 400);
  }
  const id = String(body?.id ?? "");
  const record = await env.CONTENT.get(`ver:${id}`);
  if (!record) return json({ ok: false, error: "unknown version" }, 404);
  await env.CONTENT.put("live", record);
  // Open studios/editors poll this to notice the restore like any publish.
  await env.CONTENT.put("live-meta", JSON.stringify(metaOf(JSON.parse(record))));
  return json({ ok: true, id });
}
