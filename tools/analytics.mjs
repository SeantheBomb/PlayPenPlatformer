// Pulls telemetry batches from Cloudflare KV and prints an aggregate report:
// per-room attempts / completions / deaths / durations, plus per-room item
// craft and collect counts. Raw batches are cached in ./telemetry/ so the
// report can be re-run offline and old KV entries can be cleared safely.
//
// Usage: node tools/analytics.mjs [--clear] [--local]
//   --clear   delete each batch from KV after saving it locally
//   --local   skip KV entirely; report from previously saved ./telemetry/ files
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const OUT_DIR = path.join(process.cwd(), "telemetry");
fs.mkdirSync(OUT_DIR, { recursive: true });

function wrangler(args) {
  // --remote required (local simulated store is always empty); shell:true for
  // npx.cmd on Windows. Args are fixed literals or our own generated keys.
  return execFileSync("npx", ["wrangler", ...args, "--remote"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
    shell: process.platform === "win32",
  });
}

const clear = process.argv.includes("--clear");
const localOnly = process.argv.includes("--local");

if (!localOnly) {
  const keys = JSON.parse(wrangler(["kv", "key", "list", "--binding", "TELEMETRY"])).map((k) => k.name);
  console.log(`Fetching ${keys.length} new batch(es) from KV...`);
  for (const key of keys) {
    const raw = wrangler(["kv", "key", "get", key, "--binding", "TELEMETRY"]);
    try {
      JSON.parse(raw);
    } catch {
      console.warn("Skipping unparsable batch:", key);
      continue;
    }
    fs.writeFileSync(path.join(OUT_DIR, `${key.replace(/[^a-z0-9-]/gi, "_")}.json`), raw);
    if (clear) {
      try {
        wrangler(["kv", "key", "delete", key, "--binding", "TELEMETRY"]);
      } catch {
        // benign teardown assertion on Windows; delete usually succeeded
      }
    }
  }
}

// ---------- aggregate ----------

const batches = fs.readdirSync(OUT_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8")));

if (batches.length === 0) {
  console.log("No telemetry yet.");
  process.exit(0);
}

const sessions = new Set();
const rooms = new Map(); // roomId -> { attempts, completions, deaths, durations[], crafts:Map, collects:Map }
let wins = 0;

function roomStat(id) {
  let r = rooms.get(id);
  if (!r) {
    r = { attempts: 0, completions: 0, deaths: 0, durations: [], crafts: new Map(), collects: new Map() };
    rooms.set(id, r);
  }
  return r;
}
const bump = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);

for (const b of batches) {
  sessions.add(b.sessionId);
  for (const e of b.events ?? []) {
    switch (e.t) {
      case "room_enter": roomStat(e.room).attempts++; break;
      case "room_complete": {
        const r = roomStat(e.room);
        r.completions++;
        if (e.ms > 0) r.durations.push(e.ms);
        break;
      }
      case "death": roomStat(e.room).deaths++; break;
      case "craft": bump(roomStat(e.room).crafts, e.item); break;
      case "collect": bump(roomStat(e.room).collects, e.item); break;
      case "game_win": wins++; break;
    }
  }
}

const fmt = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};
const median = (a) => {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// Keep campaign order if we can read it; otherwise alphabetical.
let order = [...rooms.keys()].sort();
try {
  const campaign = JSON.parse(fs.readFileSync("content/campaign.json", "utf8"));
  const idx = (id) => {
    const i = campaign.rooms.indexOf(id);
    return i === -1 ? 999 : i;
  };
  order.sort((a, b) => idx(a) - idx(b));
} catch { /* content not readable here; alphabetical is fine */ }

console.log("\n===== PLAYPEN ANALYTICS =====");
console.log(`Sessions: ${sessions.size}   Batches: ${batches.length}   Full-game wins: ${wins}\n`);
console.log("ROOM                 ATTEMPT  COMPLETE  DEATHS   MEDIAN    MIN..MAX");
for (const id of order) {
  const r = rooms.get(id);
  const med = median(r.durations);
  const range = r.durations.length
    ? `${fmt(Math.min(...r.durations))}..${fmt(Math.max(...r.durations))}`
    : "-";
  console.log(
    `${id.padEnd(22)}${String(r.attempts).padStart(5)}${String(r.completions).padStart(10)}` +
    `${String(r.deaths).padStart(8)}   ${(med != null ? fmt(med) : "-").padStart(6)}    ${range}`
  );
}

console.log("\nPER-ROOM ITEMS (crafted × / collected ×):");
for (const id of order) {
  const r = rooms.get(id);
  if (r.crafts.size === 0 && r.collects.size === 0) continue;
  const crafts = [...r.crafts.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}×${n}`).join(", ");
  const collects = [...r.collects.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}×${n}`).join(", ");
  console.log(`  ${id}`);
  if (crafts) console.log(`    crafted:   ${crafts}`);
  if (collects) console.log(`    collected: ${collects}`);
}
console.log("");
