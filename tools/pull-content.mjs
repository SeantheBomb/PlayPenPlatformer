// Pull the LIVE published content bundle into content/ — the repo MIRRORS
// the published truth (Sean's rule, 2026-08-05: "the published content is
// always the primary source of truth"). Run this before any content or
// schema work so migrations and design changes apply to the game as actually
// authored, not to a stale generic copy. The pull overwrites content/ files
// wholesale; use git diff afterward to see (and reconcile) what the editor
// authored since the last sync.
//
//   npm run content:pull
//
// Provenance lands in .content-base.json (repo root, committed) so any
// session can see which published version the repo content derives from.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.PLAYPEN_API ?? "https://playpen.pages.dev";

const res = await fetch(`${API}/api/content`, { headers: { "cache-control": "no-store" } });
if (!res.ok) {
  console.error(`GET ${API}/api/content failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { id, publishedAt, note, files } = await res.json();

let written = 0;
for (const [rel, data] of Object.entries(files)) {
  if (rel.includes("..")) continue; // paranoia against a hostile bundle
  const path = join(root, "content", rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  written++;
}
writeFileSync(
  join(root, ".content-base.json"),
  JSON.stringify({ id, publishedAt, note: note ?? "", pulledAt: new Date().toISOString() }, null, 2) + "\n"
);
console.log(`Pulled published ${id} (${publishedAt}${note ? ` — "${note}"` : ""}): ${written} files into content/`);
console.log("Review with: git diff content/");
