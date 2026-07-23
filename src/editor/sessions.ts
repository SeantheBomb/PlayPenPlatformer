// Editor "sessions" tab: browse recorded playsessions and rewatch them.
//
// The list is fetched from /api/sessions (password-gated; terse per-session
// summaries stored as KV key metadata, so listing is one request). Filters:
// room visited, completed/incomplete, bots (hidden by default), PID search.
// Engagement signals are computed client-side across whatever is loaded:
// completion badges plus outlier flags (unusually long/short, death-heavy,
// no-progress) that mark sessions worth watching.
//
// Watching opens a window-in-window modal running the actual simulation via
// ReplayDriver (see src/game/replay.ts) — play/pause, 1/2/4x speed, seeking,
// live held-input readout, and a determinism drift check at the end.
// Depth-first: watch one session across every room it touched. Breadth-first:
// with a room filter active, watch every session's segment in that room,
// auto-advancing between sessions.
import type { Content } from "../data/types";
import { el, toast } from "./forms";
import { ReplayDriver, type SessionData } from "../game/replay";
import type { RoomSegment } from "../game/recorder";

interface Row {
  id: string;
  p?: string;  // pid
  t?: string;  // startedAt ISO
  s?: number;  // steps
  r?: string;  // room chain "a>b>c"
  w?: number;  // win
  k?: number;  // deaths
  c?: number;  // crafts
  e?: string;  // endReason
  x?: number;  // tainted (bot)
  v?: number;  // dev
  m?: string;  // scheme
}

interface WatchItem {
  id: string;
  label: string;
  segment?: { from: number; to: number };
}

const fmtDur = (steps: number | undefined) => {
  const s = Math.round((steps ?? 0) / 60);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};

export function renderSessionsTab(
  root: HTMLElement,
  content: Content,
  apiBase: string,
  passKey: string
): void {
  let rows: Row[] = [];
  let filterRoom = "";
  let filterDone = "all";
  let filterPid = "";
  let showBots = false;

  const auth = () => ({ "x-editor-password": localStorage.getItem(passKey) ?? "" });

  const listEl = el("div");
  const statusEl = el("p", { className: "pp-hint" }, "loading sessions...");

  const roomSelect = el("select", {
    onchange: (e) => { filterRoom = (e.target as HTMLSelectElement).value; renderList(); },
  },
    el("option", { value: "" }, "any room"),
    ...Object.keys(content.rooms).map((id) => el("option", { value: id }, id))
  );
  const doneSelect = el("select", {
    onchange: (e) => { filterDone = (e.target as HTMLSelectElement).value; renderList(); },
  },
    el("option", { value: "all" }, "all outcomes"),
    el("option", { value: "win" }, "completed"),
    el("option", { value: "lost" }, "incomplete")
  );
  const pidInput = el("input", {
    type: "text", placeholder: "filter by player id",
    oninput: (e) => { filterPid = (e.target as HTMLInputElement).value.trim(); renderList(); },
  });
  const botsToggle = el("label", { className: "pp-hint" },
    el("input", {
      type: "checkbox",
      onchange: (e) => { showBots = (e.target as HTMLInputElement).checked; renderList(); },
    }),
    " show bot/dev sessions"
  );
  const watchAllBtn = el("button", {
    className: "pp-btn",
    onclick: () => watchBreadthFirst(),
  }, "▶ watch all in room");

  async function load(): Promise<void> {
    statusEl.textContent = "loading sessions...";
    try {
      const res = await fetch(`${apiBase}/api/sessions`, { headers: auth() });
      if (res.status === 401) {
        statusEl.textContent = "wrong/missing editor password — set it in the publish tab first";
        return;
      }
      const data = (await res.json()) as { ok: boolean; sessions?: Row[]; error?: string };
      if (!data.ok) throw new Error(data.error);
      rows = data.sessions ?? [];
      statusEl.textContent = "";
      renderList();
    } catch (err) {
      statusEl.textContent = `couldn't load sessions (${String(err)})`;
    }
  }

  function visibleRows(): Row[] {
    return rows.filter((r) => {
      // Bot, dev, and editor-interrupted sessions are workflow noise, not
      // real play — hidden unless explicitly requested.
      if (!showBots && (r.x || r.v || r.e === "editor")) return false;
      if (filterRoom && !(r.r ?? "").split(">").includes(filterRoom)) return false;
      if (filterDone === "win" && !r.w) return false;
      if (filterDone === "lost" && r.w) return false;
      if (filterPid && !(r.p ?? "").includes(filterPid)) return false;
      return true;
    });
  }

  /** Outlier flags relative to the currently visible population. */
  function outlierBadges(r: Row, pop: Row[]): string[] {
    const badges: string[] = [];
    const durs = pop.map((q) => q.s ?? 0).sort((a, b) => a - b);
    const deaths = pop.map((q) => q.k ?? 0).sort((a, b) => a - b);
    const pct = (sorted: number[], v: number) =>
      sorted.length < 4 ? 0.5 : sorted.findIndex((x) => x >= v) / sorted.length;
    const dp = pct(durs, r.s ?? 0);
    const kp = pct(deaths, r.k ?? 0);
    if (dp >= 0.9) badges.push("⏳ marathon");
    if (r.w && dp <= 0.1 && durs.length >= 4) badges.push("⚡ speedrun");
    if (kp >= 0.9 && (r.k ?? 0) >= 3) badges.push("💀 death-heavy");
    if (!r.w && (r.r ?? "").split(">").length <= 1 && (r.s ?? 0) > 60 * 90) {
      badges.push("🧱 stuck early");
    }
    if (!r.w && (r.s ?? 0) < 60 * 20) badges.push("🚪 bounced");
    return badges;
  }

  function renderList(): void {
    listEl.replaceChildren();
    const pop = visibleRows();
    if (pop.length === 0) {
      listEl.append(el("p", { className: "pp-hint" }, "no sessions match"));
      return;
    }
    const head = el("div", { className: "pp-row", style: "font-weight:bold;color:#8f87ad;display:flex;gap:8px" },
      el("span", { style: "width:130px" }, "when"),
      el("span", { style: "width:70px" }, "player"),
      el("span", { style: "width:55px" }, "length"),
      el("span", { style: "width:44px" }, "deaths"),
      el("span", { style: "width:40px" }, "crafts"),
      el("span", { style: "flex:1" }, "rooms"),
      el("span", { style: "width:210px" }, "signals"),
      el("span", { style: "width:60px" }, "")
    );
    listEl.append(head);
    for (const r of pop) {
      const badges = outlierBadges(r, pop);
      const doneBadge = r.w
        ? el("span", { style: "color:#9be8b0" }, "✔ completed")
        : el("span", { style: "color:#e8a2b4" }, `✘ ${r.e ?? "incomplete"}`);
      const row = el("div", {
        className: "pp-row",
        style: "display:flex;gap:8px;align-items:center;border-bottom:1px solid #2c2740;padding:4px 0",
      },
        el("span", { style: "width:130px", className: "pp-hint" },
          r.t ? new Date(r.t).toLocaleString() : "?"),
        el("span", { style: "width:70px;font-family:monospace" }, (r.p ?? "?").slice(0, 8)),
        el("span", { style: "width:55px" }, fmtDur(r.s)),
        el("span", { style: "width:44px" }, String(r.k ?? 0)),
        el("span", { style: "width:40px" }, String(r.c ?? 0)),
        el("span", { style: "flex:1;font-family:monospace;font-size:10px" },
          (r.r ?? "").split(">").join(" › ") || "—"),
        el("span", { style: "width:210px;font-size:10px" },
          doneBadge, " ", badges.join(" ")),
        el("button", {
          className: "pp-btn", style: "width:60px",
          onclick: () => watchQueue([{ id: r.id, label: `session ${r.id}` }]),
        }, "▶ watch")
      );
      if (r.x || r.v) row.style.opacity = "0.55";
      listEl.append(row);
    }
  }

  /** Breadth-first: every visible session's segment inside the filtered room. */
  async function watchBreadthFirst(): Promise<void> {
    if (!filterRoom) {
      toast("Pick a room filter first — breadth-first watches one room.", false);
      return;
    }
    const pop = visibleRows().filter((r) => (r.r ?? "").split(">").includes(filterRoom));
    if (pop.length === 0) {
      toast("No sessions visited that room.", false);
      return;
    }
    watchQueue(pop.map((r) => ({
      id: r.id,
      label: `${(r.p ?? "?").slice(0, 8)} in ${filterRoom}`,
      segment: undefined, // resolved per-session from full meta at fetch time
    })), filterRoom);
  }

  async function fetchSession(id: string): Promise<SessionData | null> {
    try {
      const res = await fetch(`${apiBase}/api/sessions?id=${encodeURIComponent(id)}`, { headers: auth() });
      const data = await res.json() as { ok: boolean; meta?: SessionData["meta"]; content?: SessionData["content"]; events?: SessionData["events"]; error?: string };
      if (!data.ok || !data.meta) throw new Error(data.error ?? "bad response");
      return { meta: data.meta, content: data.content ?? null, events: data.events ?? [] };
    } catch (err) {
      toast(`Fetch failed: ${String(err)}`, false);
      return null;
    }
  }

  /** The window-in-window replay player; advances through `queue` in order. */
  function watchQueue(queue: WatchItem[], segmentRoom?: string): void {
    let qi = 0;
    let driver: ReplayDriver | null = null;
    let segEnd: number | null = null;

    const canvas = el("canvas", { width: 640, height: 360 });
    canvas.style.width = "100%";
    canvas.style.background = "#0d0b14";
    canvas.style.borderRadius = "6px";

    const title = el("div", { className: "pp-sidehead" }, "replay");
    const timeEl = el("span", { className: "pp-hint" }, "0:00");
    const roomEl = el("span", { className: "pp-hint" }, "");
    const keysEl = el("span", { className: "pp-hint", style: "font-family:monospace" }, "");
    const driftEl = el("span", { className: "pp-hint" }, "");
    const seek = el("input", { type: "range", min: 0, max: 1000, value: 0 });
    seek.style.flex = "1";

    const playBtn = el("button", { className: "pp-btn" }, "⏸");
    playBtn.onclick = () => {
      if (!driver) return;
      if (driver.playing) { driver.pause(); playBtn.textContent = "▶"; }
      else { driver.play(); playBtn.textContent = "⏸"; }
    };
    let speed = 1;
    const speedBtn = el("button", { className: "pp-btn" }, "1x");
    speedBtn.onclick = () => {
      speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
      speedBtn.textContent = `${speed}x`;
      if (driver) driver.speed = speed;
    };
    seek.oninput = () => {
      if (!driver) return;
      driver.seek(Math.round((Number(seek.value) / 1000) * driver.totalSteps));
    };

    const closeModal = () => {
      driver?.dispose();
      modal.remove();
    };
    const nextBtn = el("button", { className: "pp-btn" }, "next ▸");
    nextBtn.onclick = () => advance();
    const modal = el("div", { className: "pp-pixmodal" },
      el("div", { className: "pp-pixpanel", style: "width:720px;max-width:95vw" },
        el("div", { style: "display:flex;justify-content:space-between;align-items:center" },
          title,
          el("button", { className: "pp-btn pp-danger", onclick: closeModal }, "✕")
        ),
        canvas,
        el("div", { style: "display:flex;gap:8px;align-items:center;margin-top:8px" },
          playBtn, speedBtn, seek, timeEl
        ),
        el("div", { style: "display:flex;gap:14px;align-items:center;margin-top:6px" },
          roomEl, keysEl, driftEl,
          queue.length > 1 ? nextBtn : el("span", {})
        )
      )
    );
    document.body.append(modal);

    const advance = () => {
      qi++;
      if (qi >= queue.length) { closeModal(); return; }
      void start(queue[qi]);
    };

    async function start(item: WatchItem): Promise<void> {
      driver?.dispose();
      driver = null;
      title.textContent = `replay — ${item.label} (${qi + 1}/${queue.length})`;
      driftEl.textContent = "";
      const data = await fetchSession(item.id);
      if (!data) { advance(); return; }
      // Breadth-first: resolve this session's segment for the target room.
      let from = 0;
      segEnd = null;
      if (segmentRoom) {
        const seg = (data.meta.rooms as RoomSegment[]).find((s) => s.id === segmentRoom);
        if (seg) {
          from = seg.from;
          segEnd = seg.to ?? data.meta.steps;
        }
      }
      driver = new ReplayDriver(data, canvas);
      driver.speed = speed;
      driver.onFrame = () => {
        const d = driver!;
        seek.value = String(Math.round((d.step / d.totalSteps) * 1000));
        const secs = Math.floor(d.step / 60);
        timeEl.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} / ${fmtDur(d.totalSteps)}`;
        roomEl.textContent = `room: ${d.game.currentRoomId}`;
        keysEl.textContent = d.game.input.heldCodes().join(" ") || "·";
        if (segEnd !== null && d.step >= segEnd) {
          d.pause();
          playBtn.textContent = "▶";
          advance();
        }
      };
      driver.onEnded = () => {
        playBtn.textContent = "▶";
        const drift = driver!.drift();
        if (drift !== null) {
          driftEl.textContent = drift < 1
            ? "✔ deterministic (0px drift)"
            : `⚠ drift ${drift.toFixed(1)}px`;
          driftEl.style.color = drift < 1 ? "#9be8b0" : "#ffd166";
        }
        if (queue.length > 1) advance();
      };
      if (from > 0) driver.seek(from);
      driver.play();
      playBtn.textContent = "⏸";
    }

    void start(queue[qi]);
  }

  root.append(
    el("p", { className: "pp-hint" },
      "Every real (non-bot) playsession is recorded as a deterministic input " +
      "replay — watch any of them below, exactly as they happened. Sessions " +
      "upload in chunks while playing, so even abandoned runs appear."),
    el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0" },
      roomSelect, doneSelect, pidInput, botsToggle,
      el("button", { className: "pp-btn", onclick: () => void load() }, "↻ refresh"),
      watchAllBtn
    ),
    statusEl,
    listEl
  );
  void load();
}
