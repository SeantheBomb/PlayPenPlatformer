// Show what `npm run content:push` WOULD change: a structural diff of local
// content/ against the live published bundle. Read-only — touches nothing.
//
//   npm run content:diff
//
// Detail lines come from the same diff module the server and editor use.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diffBundles, summarizeDiff } from "../functions/api/_merge.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.PLAYPEN_API ?? "https://playpen.pages.dev";

const files = {};
const walk = (dir, prefix) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, prefix + name + "/");
    } else if (name.endsWith(".json")) {
      files[prefix + name] = JSON.parse(readFileSync(full, "utf8"));
    }
  }
};
walk(join(root, "content"), "");

const res = await fetch(`${API}/api/content`, { headers: { "cache-control": "no-store" } });
if (!res.ok) {
  console.error(`GET ${API}/api/content failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const live = await res.json();

let baseId = null;
try {
  baseId = JSON.parse(readFileSync(join(root, ".content-base.json"), "utf8")).id ?? null;
} catch { /* no provenance */ }

console.log(`Live: ${live.id} (${live.publishedAt}${live.note ? ` — "${live.note}"` : ""})`);
if (baseId && baseId !== live.id) {
  console.log(`Repo base ${baseId} is BEHIND live — a push will 3-way merge their changes in.`);
}

const changes = diffBundles(live.files, files);
if (changes.length === 0) {
  console.log("Local content/ matches live exactly.");
  process.exit(0);
}
console.log(`\nLocal content/ vs live (${changes.length} file${changes.length === 1 ? "" : "s"} differ):`);
for (const line of summarizeDiff(changes, 200)) console.log(`  ${line}`);
