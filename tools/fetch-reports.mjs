// Pulls player-submitted bug/feedback reports down from Cloudflare KV using
// Sean's already-authenticated `wrangler` session (no public API, no extra
// credentials). Writes each report's JSON + screenshot PNG into ./reports/.
//
// Usage: node tools/fetch-reports.mjs [--clear]
//   --clear   delete each report from KV after successfully saving it locally
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const OUT_DIR = path.join(process.cwd(), "reports");
fs.mkdirSync(OUT_DIR, { recursive: true });

function wrangler(args) {
  // --remote is required — without it, wrangler reads a local simulated KV
  // store (always empty) instead of the actual Cloudflare-hosted namespace.
  // shell:true is needed for npx.cmd resolution on Windows; every argument
  // here is either a fixed literal or a KV key name we generated ourselves
  // (`${timestamp}-${uuid8}`), so there's no injection surface.
  return execFileSync("npx", ["wrangler", ...args, "--remote"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
    shell: process.platform === "win32",
  });
}

const keysJson = wrangler(["kv", "key", "list", "--binding", "REPORTS"]);
const keys = JSON.parse(keysJson).map((k) => k.name);

if (keys.length === 0) {
  console.log("No reports waiting.");
  process.exit(0);
}

const clear = process.argv.includes("--clear");
let saved = 0;

for (const key of keys) {
  const raw = wrangler(["kv", "key", "get", key, "--binding", "REPORTS"]);
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    console.warn("Skipping unparsable report:", key);
    continue;
  }

  const base = key.replace(/[^a-z0-9-]/gi, "_");
  const { screenshot, ...meta } = record;
  fs.writeFileSync(path.join(OUT_DIR, `${base}.json`), JSON.stringify(meta, null, 2));
  if (screenshot) {
    const b64 = screenshot.replace(/^data:image\/\w+;base64,/, "");
    fs.writeFileSync(path.join(OUT_DIR, `${base}.png`), Buffer.from(b64, "base64"));
  }
  console.log(`[${meta.type}] ${base} — room:${meta.room ?? "?"} — "${(meta.message || "").slice(0, 60)}"`);
  saved++;

  if (clear) {
    try {
      wrangler(["kv", "key", "delete", key, "--binding", "REPORTS"]);
    } catch {
      // wrangler on Windows sometimes exits non-zero on a benign teardown
      // assertion even after the delete succeeds — verify instead of trusting the code.
    }
  }
}

console.log(`\nSaved ${saved} report(s) to ${OUT_DIR}${clear ? " (cleared from KV)" : ""}`);
