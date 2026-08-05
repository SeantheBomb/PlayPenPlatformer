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
import { readFileSync, readdirSync, writeFileSync, statSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// From wrangler.toml [[kv_namespaces]] binding = "CONTENT" — keep in sync.
const NAMESPACE_ID = "f76627198ee34df7b6b46e4256f6b4a4";
const MAX_VERSIONS = 30; // matches functions/api/content.js

const noteIdx = process.argv.indexOf("--note");
const note = noteIdx >= 0 ? String(process.argv[noteIdx + 1] ?? "") : "repo sync";

// Collect content/**/*.json into the same rel-path file map the editor
// publishes ("game.json", "rooms/vents.json", ...).
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

const id = `v${Date.now()}`;
const publishedAt = new Date().toISOString();
const record = JSON.stringify({ id, publishedAt, note: note.slice(0, 200), files });

const wrangler = (args, input) =>
  execFileSync("npx", ["wrangler", "kv", "key", ...args, `--namespace-id=${NAMESPACE_ID}`, "--remote"], {
    cwd: root, input, encoding: "utf8", shell: process.platform === "win32",
  });

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
index.unshift({ id, at: publishedAt, note: note.slice(0, 200), bytes: record.length });
for (const old of index.splice(MAX_VERSIONS)) {
  try {
    wrangler(["delete", `ver:${old.id}`, "--force"]);
  } catch { /* already gone */ }
}
const indexPath = join(tmp, "index.json");
writeFileSync(indexPath, JSON.stringify(index));
wrangler(["put", "index", `--path=${indexPath}`]);

writeFileSync(
  join(root, ".content-base.json"),
  JSON.stringify({ id, publishedAt, note: note.slice(0, 200), pulledAt: publishedAt }, null, 2) + "\n"
);
console.log(`Published ${id} (${Object.keys(files).length} files, ${record.length} bytes) — live for all players.`);
