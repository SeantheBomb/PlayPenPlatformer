// Publish content/ to the CONTENT KV as a new restorable version — the same
// record + version-index shape the /api/content POST endpoint writes, but
// authenticated by the local wrangler login (the same machine trust that
// `wrangler pages deploy` already carries) instead of the editor password.
//
//   npm run content:push                     (note defaults to "repo sync")
//   npm run content:push -- --note "why"
//
// `npm run deploy` chains this after the Pages deploy so code and content
// ship TOGETHER — the recurring "new code, stale published bundle" masking
// class (Sean, 2026-08-05) is structurally closed as long as deploys go
// through that one command. The published version appears in the editor's
// publish-tab history like any other publish and can be restored from there.
//
// Like the server endpoint, this 3-way merges against the live published
// bundle when someone (usually Sean, in the browser editor) published since
// this repo's base (.content-base.json): per file / per id-entry / per
// game.json key, our side winning anything both changed. The merged result
// is written BACK into content/ so the repo mirrors exactly what went live —
// review the absorbed edits with `git diff content/` afterwards.
import { readFileSync, readdirSync, writeFileSync, statSync, mkdtempSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { mergeBundles, diffBundles, summarizeDiff } from "../functions/api/_merge.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.PLAYPEN_API ?? "https://playpen.pages.dev";
// From wrangler.toml [[kv_namespaces]] binding = "CONTENT" — keep in sync.
const NAMESPACE_ID = "f76627198ee34df7b6b46e4256f6b4a4";
const MAX_VERSIONS = 30; // matches functions/api/content.js

const noteIdx = process.argv.indexOf("--note");
const note = noteIdx >= 0 ? String(process.argv[noteIdx + 1] ?? "") : "repo sync";
// --wholesale skips the 3-way merge and publishes content/ exactly as-is —
// the recovery hatch for when live itself holds a bad/stale publish that a
// merge would faithfully preserve.
const wholesale = process.argv.includes("--wholesale");

// Collect content/**/*.json into the same rel-path file map the editor
// publishes ("game.json", "rooms/vents.json", ...).
let files = {};
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

const wrangler = (args, input) =>
  execFileSync("npx", ["wrangler", "kv", "key", ...args, `--namespace-id=${NAMESPACE_ID}`, "--remote"], {
    cwd: root, input, encoding: "utf8", shell: process.platform === "win32",
  });

let baseId = null;
try {
  baseId = JSON.parse(readFileSync(join(root, ".content-base.json"), "utf8")).id ?? null;
} catch { /* no provenance yet — wholesale publish, as before */ }

let live = null;
try {
  const res = await fetch(`${API}/api/content`, { headers: { "cache-control": "no-store" } });
  if (res.ok) live = await res.json();
} catch { /* offline / nothing published — wholesale publish */ }

let merged = false;
if (wholesale) {
  console.log("(--wholesale: skipping merge, publishing content/ exactly as-is)");
} else if (live && baseId && baseId !== live.id) {
  let base = null;
  try {
    base = JSON.parse(wrangler(["get", `ver:${baseId}`]));
  } catch { /* base pruned from history — fall through to wholesale */ }
  if (base) {
    console.log(`Live is ${live.id} but repo base is ${baseId} — merging their changes in.`);
    files = mergeBundles(base.files, live.files, files);
    merged = true;
    // Mirror the merged truth back into the repo so content/ matches what
    // players will get (their edits we just absorbed become a git diff).
    let written = 0;
    for (const [rel, data] of Object.entries(files)) {
      if (rel.includes("..")) continue;
      const path = join(root, "content", rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
      written++;
    }
    console.log(`Wrote ${written} merged files back into content/ — review with: git diff content/`);
  } else {
    console.warn(`Base ${baseId} no longer in version history — publishing repo content wholesale.`);
  }
}

const changes = summarizeDiff(diffBundles(live?.files ?? {}, files));

const id = `v${Date.now()}`;
const publishedAt = new Date().toISOString();
const record = JSON.stringify({ id, publishedAt, note: note.slice(0, 200), baseId, changes, files });

const tmp = mkdtempSync(join(tmpdir(), "pp-publish-"));
const recordPath = join(tmp, "record.json");
writeFileSync(recordPath, record);

wrangler(["put", `ver:${id}`, `--path=${recordPath}`]);
wrangler(["put", "live", `--path=${recordPath}`]);

let index = [];
try {
  index = JSON.parse(wrangler(["get", "index"]));
} catch {
  // no index yet — fine, we create it
}
index.unshift({ id, at: publishedAt, note: note.slice(0, 200), bytes: record.length, merged, changes });
for (const old of index.splice(MAX_VERSIONS)) {
  try {
    // (no --force: wrangler 4.x kv key delete rejects it and never prompts)
    wrangler(["delete", `ver:${old.id}`]);
  } catch { /* already gone */ }
}
const indexPath = join(tmp, "index.json");
writeFileSync(indexPath, JSON.stringify(index));
wrangler(["put", "index", `--path=${indexPath}`]);

writeFileSync(
  join(root, ".content-base.json"),
  JSON.stringify({ id, publishedAt, note: note.slice(0, 200), pulledAt: publishedAt }, null, 2) + "\n"
);
console.log(`Published ${id}${merged ? " (merged with live)" : ""} (${Object.keys(files).length} files, ${record.length} bytes) — live for all players.`);
if (changes.length === 0) console.log("No content changes vs previous live version.");
else for (const line of changes) console.log(`  ${line}`);
