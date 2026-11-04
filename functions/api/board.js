// The Art Studio's coordination board (Casey + Miranda, 2026-11-04): a manual
// workflow status, owner and short note per art asset, live for everyone
// with the studio open — no publish, no sync button.
//   GET  /api/board?since=<ms>  -> { ok, now, items: [...] } changed since
//   POST /api/board {key, status?, owner?, note?, by}  -> upsert one row
// Lives in D1 (BOARD binding), NOT in published content: it's about the
// work, not the game, so it never reaches players, never versions, and
// never takes part in the publish merge. Gated by the artist or editor
// password (the repo is public; the board says who's working on what).
import { checkArtistPassword, checkPassword, json } from "./content.js";

export const STATUSES = ["todo", "doing", "review", "changes", "done"];

let ready = false;
async function ensureTable(db) {
  if (ready) return;
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS board (" +
    " key TEXT PRIMARY KEY, status TEXT, owner TEXT, note TEXT," +
    " updated_by TEXT, updated_at INTEGER NOT NULL)"
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS board_updated ON board(updated_at)").run();
  ready = true;
}

function gate(request, env) {
  if (!checkArtistPassword(request, env)) return null;
  return checkPassword(request, env); // editor password works too
}

const row = (r) => ({
  key: r.key, status: r.status ?? null, owner: r.owner ?? null, note: r.note ?? null,
  updatedBy: r.updated_by ?? null, updatedAt: r.updated_at,
});

export async function onRequestGet({ request, env }) {
  const denied = gate(request, env);
  if (denied) return denied;
  if (!env.BOARD) return json({ ok: false, error: "board not configured" }, 503);
  await ensureTable(env.BOARD);
  const since = Number(new URL(request.url).searchParams.get("since")) || 0;
  const now = Date.now();
  const { results } = await env.BOARD
    .prepare("SELECT * FROM board WHERE updated_at > ?1 ORDER BY updated_at")
    .bind(since).all();
  return new Response(JSON.stringify({ ok: true, now, items: results.map(row) }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  const denied = gate(request, env);
  if (denied) return denied;
  if (!env.BOARD) return json({ ok: false, error: "board not configured" }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad json" }, 400);
  }
  const key = String(body?.key ?? "").slice(0, 160);
  if (!key) return json({ ok: false, error: "missing key" }, 400);
  const clean = (v, n) => (v === null || v === undefined || v === "" ? null : String(v).trim().slice(0, n) || null);
  const status = clean(body.status, 20);
  if (status && !STATUSES.includes(status)) return json({ ok: false, error: "bad status" }, 400);
  await ensureTable(env.BOARD);
  // Only the fields sent change; the rest of the row is kept.
  const prev = await env.BOARD.prepare("SELECT * FROM board WHERE key = ?1").bind(key).first();
  const next = {
    status: "status" in body ? status : prev?.status ?? null,
    owner: "owner" in body ? clean(body.owner, 40) : prev?.owner ?? null,
    note: "note" in body ? clean(body.note, 280) : prev?.note ?? null,
  };
  const at = Math.max(Date.now(), (prev?.updated_at ?? 0) + 1);
  await env.BOARD.prepare(
    "INSERT INTO board (key, status, owner, note, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
    "ON CONFLICT(key) DO UPDATE SET status=?2, owner=?3, note=?4, updated_by=?5, updated_at=?6"
  ).bind(key, next.status, next.owner, next.note, clean(body.by, 40), at).run();
  return json({ ok: true, item: row({ key, ...next, updated_by: clean(body.by, 40), updated_at: at }) });
}
