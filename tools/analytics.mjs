// Pulls telemetry batches from Cloudflare KV and prints an aggregate report:
// per-room attempts / completions / deaths / durations, plus per-room item
// craft and collect counts. Raw batches are cached in ./telemetry/ so the
// report can be re-run offline and old KV entries can be cleared safely.
//
// Usage: node tools/analytics.mjs [--clear] [--local] [--all] [--platform=steam]
//   --clear       delete each batch from KV after saving it locally
//   --local       skip KV entirely; report from previously saved ./telemetry/ files
//   --all         include dev/collaborator and bot-tainted batches (excluded by default)
//   --platform=X  only batches from one build: browser | electron | steam | steam-demo
//                 (batches from before the platform tag existed report as "unknown")
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
const includeAll = process.argv.includes("--all");
const onlyPlatform = process.argv.find((a) => a.startsWith("--platform="))?.split("=")[1] ?? null;
const localOnly = process.argv.includes("--local");

// wrangler can print auth chatter on stdout ahead of the payload; parse from
// the first JSON bracket instead of trusting the whole stream.
function parseJsonOut(text) {
  const start = text.search(/[[{]/);
  if (start === -1) throw new Error("wrangler returned no JSON:\n" + text.slice(0, 400));
  return JSON.parse(text.slice(start));
}

const fileFor = (key) => path.join(OUT_DIR, `${key.replace(/[^a-z0-9-]/gi, "_")}.json`);
// KV bulk get/delete accept at most 100 keys per call. One wrangler spawn per
// chunk instead of per key is what makes a 1,000+ batch pull finish in a
// minute rather than an hour.
const CHUNK = 100;

if (!localOnly) {
  const keys = parseJsonOut(wrangler(["kv", "key", "list", "--binding", "TELEMETRY"])).map((k) => k.name);
  // Batches are immutable once written, so anything already cached is skipped.
  const fresh = keys.filter((k) => !fs.existsSync(fileFor(k)));
  console.log(`KV holds ${keys.length} batch(es); fetching ${fresh.length} not cached yet...`);
  const tmp = path.join(OUT_DIR, ".keys.tmp.json");
  try {
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const chunk = fresh.slice(i, i + CHUNK);
      fs.writeFileSync(tmp, JSON.stringify(chunk));
      const got = parseJsonOut(wrangler(["kv", "bulk", "get", tmp, "--binding", "TELEMETRY"]));
      for (const key of chunk) {
        const raw = got[key];
        if (typeof raw !== "string") continue; // expired between list and get
        try {
          JSON.parse(raw);
        } catch {
          console.warn("Skipping unparsable batch:", key);
          continue;
        }
        fs.writeFileSync(fileFor(key), raw);
      }
      process.stdout.write(`  ${Math.min(i + CHUNK, fresh.length)}/${fresh.length}\r`);
    }
    if (fresh.length) process.stdout.write("\n");
    if (clear) {
      // Only delete what is safely on disk.
      const saved = keys.filter((k) => fs.existsSync(fileFor(k)));
      for (let i = 0; i < saved.length; i += CHUNK) {
        fs.writeFileSync(tmp, JSON.stringify(saved.slice(i, i + CHUNK)));
        try {
          wrangler(["kv", "bulk", "delete", tmp, "--binding", "TELEMETRY", "--force"]);
        } catch {
          // benign teardown assertion on Windows; delete usually succeeded
        }
      }
      console.log(`Cleared ${saved.length} batch(es) from KV.`);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---------- aggregate ----------

const allBatches = fs.readdirSync(OUT_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8")));

// Platform split + organic filter. Batches recorded before the dev/bot flags
// existed can't be filtered, so they stay in — the header says how many.
const platformOf = (b) => b.platform ?? "unknown";
const byPlatform = new Map();
let excluded = 0, unflagged = 0;
const batches = allBatches.filter((b) => {
  if (b.dev === undefined && b.bot === undefined) unflagged++;
  if (!includeAll && (b.dev || b.bot)) { excluded++; return false; }
  if (onlyPlatform && platformOf(b) !== onlyPlatform) return false;
  return true;
});
for (const b of batches) {
  const p = platformOf(b);
  if (!byPlatform.has(p)) byPlatform.set(p, new Set());
  byPlatform.get(p).add(b.sessionId);
}

if (batches.length === 0) {
  console.log(allBatches.length ? "No batches match the filters." : "No telemetry yet.");
  process.exit(0);
}

const sessions = new Set();
const rooms = new Map(); // roomId -> { attempts, completions, deaths, durations[], crafts:Map, collects:Map }
let wins = 0;

function roomStat(id) {
  let r = rooms.get(id);
  if (!r) {
    r = {
      attempts: 0, completions: 0, deaths: 0, durations: [],
      crafts: new Map(), collects: new Map(), interactions: new Map(),
    };
    rooms.set(id, r);
  }
  return r;
}
const bump = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);

// Per-session view for playtime: sessionId -> { rooms: Map(room -> first clear ms), winAt }
const perSession = new Map();
function sessionStat(id) {
  let s = perSession.get(id);
  if (!s) {
    s = { rooms: new Map(), winAt: null };
    perSession.set(id, s);
  }
  return s;
}

for (const b of batches) {
  sessions.add(b.sessionId);
  for (const e of b.events ?? []) {
    switch (e.t) {
      case "room_enter": roomStat(e.room).attempts++; break;
      case "room_complete": {
        const r = roomStat(e.room);
        r.completions++;
        if (e.ms > 0) {
          r.durations.push(e.ms);
          const s = sessionStat(b.sessionId);
          if (!s.rooms.has(e.room)) s.rooms.set(e.room, e.ms);
        }
        break;
      }
      case "death": roomStat(e.room).deaths++; break;
      case "craft": bump(roomStat(e.room).crafts, e.item); break;
      case "collect": bump(roomStat(e.room).collects, e.item); break;
      case "interaction": bump(roomStat(e.room).interactions, e.extra?.effect ?? "?"); break;
      case "game_win": {
        wins++;
        const s = sessionStat(b.sessionId);
        if (s.winAt == null && e.at > 0) s.winAt = e.at;
        break;
      }
    }
  }
}

const fmt = (ms) => {
  const s = Math.round(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, "0")}m`;
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
console.log(`Sessions: ${sessions.size}   Batches: ${batches.length}   Full-game wins: ${wins}`);
console.log(`By platform (sessions): ${[...byPlatform].map(([p, s]) => `${p} ${s.size}`).join(", ") || "-"}`);
console.log(includeAll
  ? "Including dev/bot batches (--all)."
  : `Excluded ${excluded} dev/bot batch(es); ${unflagged} older batch(es) predate the flags and can't be filtered.`);
console.log("");
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

// ---------- playtime (Steam refund-window check) ----------
// Steam refunds anything under 2 h played, so the number that matters is how
// fast a FAST player clears the campaign, not the median. p10 = the quickest
// tenth of first clears. Durations are wall clock (room entry -> exit), so they
// include pauses and hidden-tab time: read them as upper bounds.
const quantile = (a, q) => {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const firstClears = new Map(); // room -> first-clear ms per session
for (const s of perSession.values()) {
  for (const [room, ms] of s.rooms) {
    if (!firstClears.has(room)) firstClears.set(room, []);
    firstClears.get(room).push(ms);
  }
}
let campaignRooms = order;
try {
  campaignRooms = JSON.parse(fs.readFileSync("content/campaign.json", "utf8")).rooms;
} catch { /* fall back to rooms seen in telemetry */ }

console.log("\nPLAYTIME — first clear per session (wall clock, so an upper bound):");
console.log("ROOM                 CLEARS     P10    MEDIAN      P90");
let sumP10 = 0, sumMed = 0, missing = [];
for (const id of campaignRooms) {
  const d = firstClears.get(id) ?? [];
  const p10 = quantile(d, 0.1), med = quantile(d, 0.5), p90 = quantile(d, 0.9);
  if (med == null) missing.push(id);
  else { sumP10 += p10; sumMed += med; }
  const cell = (v) => (v != null ? fmt(v) : "-").padStart(8);
  console.log(`${id.padEnd(22)}${String(d.length).padStart(6)}${cell(p10)}${cell(med)}${cell(p90)}`);
}
console.log(`Campaign sum — fast (p10): ${fmt(sumP10)}   typical (median): ${fmt(sumMed)}` +
  (missing.length ? `   [no clears yet: ${missing.join(", ")}]` : ""));
const winTimes = [...perSession.values()].map((s) => s.winAt).filter((v) => v != null);
if (winTimes.length) {
  console.log(`Full runs to the win screen: ${winTimes.length}   fastest ${fmt(Math.min(...winTimes))}` +
    `   median ${fmt(quantile(winTimes, 0.5))}  (session clock, includes menus)`);
}
const REFUND_MS = 2 * 60 * 60 * 1000;
console.log(`Refund window check: fast-player campaign ${sumP10 >= REFUND_MS ? "clears" : "is UNDER"} the 2 h line` +
  ` (${fmt(sumP10)} vs 2h00m).`);

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

// Which of a gate's documented multi-solution paths (see OPPORTUNITY_MATRIX.md
// "Multi-solution gates") players actually take, in aggregate — e.g. a room
// showing "melt×41, shatter×3" says the shatter path is barely being found.
console.log("\nPER-ROOM ELEMENT INTERACTIONS (ignite/melt/extinguish/freeze/shatter/dissolve):");
for (const id of order) {
  const r = rooms.get(id);
  if (r.interactions.size === 0) continue;
  const interactions = [...r.interactions.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}×${n}`).join(", ");
  console.log(`  ${id}: ${interactions}`);
}
console.log("");
