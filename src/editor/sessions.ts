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
import { openReportDetail } from "./reports";

interface ReportMarker { step: number; id: string; type: string; message: string; }

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

async function fetchSessionData(
  apiBase: string, passKey: string, id: string
): Promise<SessionData | null> {
  try {
    const res = await fetch(`${apiBase}/api/sessions?id=${encodeURIComponent(id)}`, {
      headers: { "x-editor-password": localStorage.getItem(passKey) ?? "" },
    });
    const data = await res.json() as { ok: boolean; meta?: SessionData["meta"]; content?: SessionData["content"]; events?: SessionData["events"]; error?: string };
    if (!data.ok || !data.meta) throw new Error(data.error ?? "bad response");
    return { meta: data.meta, content: data.content ?? null, events: data.events ?? [] };
  } catch (err) {
    toast(`Fetch failed: ${String(err)}`, false);
    return null;
  }
}

/** Standalone single-session replay modal, opened at an optional starting
 *  step — used by the Reports tab's "jump to session" button and by report
 *  milestones on the sessions timeline. Simpler than renderSessionsTab's
 *  own watch modal (no queue/breadth-first advance), but the same
 *  ReplayDriver-backed player underneath. */
export async function openSessionReplay(
  apiBase: string, passKey: string, id: string, atStep?: number
): Promise<void> {
  const data = await fetchSessionData(apiBase, passKey, id);
  if (!data) return;
  const canvas = el("canvas", { width: 640, height: 360 }) as HTMLCanvasElement;
  canvas.style.width = "100%";
  canvas.style.background = "#0d0b14";
  canvas.style.borderRadius = "6px";
  const title = el("div", { className: "pp-sidehead" }, `replay — session ${id}`);
  const timeEl = el("span", { className: "pp-hint" }, "0:00");
  const roomEl = el("span", { className: "pp-hint" }, "");
  const playBtn = el("button", { className: "pp-btn" }, "⏸");
  const driver = new ReplayDriver(data, canvas);
  playBtn.onclick = () => {
    if (driver.playing) { driver.pause(); playBtn.textContent = "▶"; }
    else { driver.play(); playBtn.textContent = "⏸"; }
  };
  const closeModal = () => { driver.dispose(); modal.remove(); };
  const modal = el("div", { className: "pp-pixmodal" },
    el("div", { className: "pp-pixpanel", style: "width:720px;max-width:95vw" },
      el("div", { style: "display:flex;justify-content:space-between;align-items:center" },
        title,
        el("button", { className: "pp-btn pp-danger", onclick: closeModal }, "✕")
      ),
      canvas,
      el("div", { style: "display:flex;gap:8px;align-items:center;margin-top:8px" },
        playBtn, timeEl
      ),
      el("div", { style: "display:flex;gap:14px;align-items:center;margin-top:6px" }, roomEl)
    )
  );
  document.body.append(modal);
  driver.onFrame = () => {
    const secs = Math.floor(driver.step / 60);
    timeEl.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} / ${fmtDur(driver.totalSteps)}`;
    roomEl.textContent = `room: ${driver.game.currentRoomId}`;
  };
  if (atStep !== undefined) driver.seek(atStep);
  driver.play();
  playBtn.textContent = "⏸";
}

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
    return fetchSessionData(apiBase, passKey, id);
  }

  /** The window-in-window replay player; advances through `queue` in order. */
  function watchQueue(queue: WatchItem[], segmentRoom?: string): void {
    let qi = 0;
    let driver: ReplayDriver | null = null;
    let segEnd: number | null = null;
    let markers: ReportMarker[] = [];

    const canvas = el("canvas", { width: 640, height: 360 });
    canvas.style.width = "100%";
    canvas.style.background = "#0d0b14";
    canvas.style.borderRadius = "6px";

    const title = el("div", { className: "pp-sidehead" }, "replay");
    const timeEl = el("span", { className: "pp-hint" }, "0:00");
    const roomEl = el("span", { className: "pp-hint" }, "");
    const keysEl = el("span", { className: "pp-hint", style: "font-family:monospace" }, "");
    const driftEl = el("span", { className: "pp-hint" }, "");

    // Canvas timeline: colored idle/active bands + playhead, click/drag to
    // seek. Canvas (not a plain range input) so bug-report milestones can
    // draw and hover on the same surface later.
    const timeline = el("canvas", { width: 640, height: 22 }) as HTMLCanvasElement;
    timeline.style.width = "100%";
    timeline.style.height = "22px";
    timeline.style.cursor = "pointer";
    timeline.style.borderRadius = "4px";
    timeline.style.flex = "1";
    let draggingSeek = false;
    const stepFromEvent = (e: PointerEvent): number => {
      const rect = timeline.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      return Math.round(t * (driver?.totalSteps ?? 1));
    };
    /** Report milestone within hit range of a pointer event, if any. */
    const markerNear = (e: { clientX: number }): ReportMarker | null => {
      if (!driver) return null;
      const rect = timeline.getBoundingClientRect();
      const hitSteps = (6 / rect.width) * driver.totalSteps; // ~6px hit radius
      let best: ReportMarker | null = null;
      let bestDist = Infinity;
      for (const m of markers) {
        const t = ((e.clientX - rect.left) / rect.width) * driver.totalSteps;
        const d = Math.abs(m.step - t);
        if (d <= hitSteps && d < bestDist) { best = m; bestDist = d; }
      }
      return best;
    };
    const tooltip = el("div", {
      style: "position:fixed;z-index:2000;display:none;max-width:260px;background:#1c1828;" +
        "border:1px solid #ffd166;border-radius:6px;padding:6px 8px;font-size:11px;" +
        "color:#e8e2f4;pointer-events:none;",
    });
    document.body.append(tooltip);
    timeline.addEventListener("pointerdown", (e) => {
      const m = markerNear(e);
      if (m) { void openReportDetail(apiBase, passKey, m.id); return; }
      draggingSeek = true;
      if (driver) driver.seek(stepFromEvent(e));
    });
    timeline.addEventListener("pointermove", (e) => {
      const m = markerNear(e);
      if (m && !draggingSeek) {
        tooltip.style.display = "block";
        tooltip.style.left = `${e.clientX + 10}px`;
        tooltip.style.top = `${e.clientY - 34}px`;
        tooltip.textContent = `[${m.type}] ${m.message || "(no message)"} — click to view`;
      } else {
        tooltip.style.display = "none";
      }
    });
    timeline.addEventListener("pointerleave", () => { tooltip.style.display = "none"; });
    window.addEventListener("pointermove", (e) => {
      if (draggingSeek && driver) driver.seek(stepFromEvent(e));
    });
    window.addEventListener("pointerup", () => { draggingSeek = false; });

    function drawTimeline(): void {
      if (!driver) return;
      const tctx = timeline.getContext("2d")!;
      const w = timeline.width, h = timeline.height;
      tctx.clearRect(0, 0, w, h);
      tctx.fillStyle = "#221d30";
      tctx.fillRect(0, 0, w, h);
      tctx.fillStyle = "#3a3350";
      for (const p of driver.idlePeriods) {
        const x0 = (p.from / driver.totalSteps) * w;
        const x1 = (p.to / driver.totalSteps) * w;
        tctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
      }
      tctx.fillStyle = "#ff6b6b";
      for (const m of markers) {
        const mx = (m.step / driver.totalSteps) * w;
        tctx.beginPath();
        tctx.moveTo(mx - 3, 0);
        tctx.lineTo(mx + 3, 0);
        tctx.lineTo(mx, 6);
        tctx.closePath();
        tctx.fill();
      }
      const px = (driver.step / driver.totalSteps) * w;
      tctx.fillStyle = "#e8e2f4";
      tctx.fillRect(Math.max(0, px - 1), 0, 2, h);
    }

    const skipIdleBtn = el("button", { className: "pp-btn", style: "display:none" }, "⏭ skip idle");
    skipIdleBtn.onclick = () => {
      if (!driver) return;
      const p = driver.idlePeriodAt(driver.step);
      if (p) driver.seek(p.to);
    };

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

    const closeModal = () => {
      driver?.dispose();
      modal.remove();
      tooltip.remove();
    };
    const nextBtn = el("button", { className: "pp-btn" }, "next ▸");
    nextBtn.onclick = () => advance();

    // File a report AT THIS MOMENT in the replay — the same UI a real
    // player sees, pre-filled from the replay's own game state, tagged
    // source:"review" (vs. "player") so the two are distinguishable later.
    // One cached ReportUI per driver (rebuilt whenever start() swaps
    // drivers), mirroring how Game caches its own — a fresh instance per
    // click would leak a full-page DOM overlay on every open.
    let reportUI: import("../game/report").ReportUI | null = null;
    const reportBtn = el("button", { className: "pp-btn" }, "📝 file a report here");
    reportBtn.onclick = () => {
      if (!driver) return;
      const wasPlaying = driver.playing;
      driver.pause();
      playBtn.textContent = "▶";
      void import("../game/report").then((mod) => {
        if (!reportUI) {
          reportUI = new mod.ReportUI(driver!.game, () => {
            if (wasPlaying) { driver?.play(); playBtn.textContent = "⏸"; }
          });
        }
        reportUI.correlate = { sessionId: queue[qi].id, sessionStep: driver!.step, source: "review" };
        reportUI.open();
      });
    };

    const modal = el("div", { className: "pp-pixmodal" },
      el("div", { className: "pp-pixpanel", style: "width:720px;max-width:95vw" },
        el("div", { style: "display:flex;justify-content:space-between;align-items:center" },
          title,
          el("button", { className: "pp-btn pp-danger", onclick: closeModal }, "✕")
        ),
        canvas,
        el("div", { style: "display:flex;gap:8px;align-items:center;margin-top:8px" },
          playBtn, speedBtn, timeline, timeEl
        ),
        el("div", { style: "display:flex;gap:14px;align-items:center;margin-top:6px;flex-wrap:wrap" },
          roomEl, keysEl, driftEl, skipIdleBtn, reportBtn,
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
      reportUI = null; // bound to the old driver's Game — don't reuse across sessions
      title.textContent = `replay — ${item.label} (${qi + 1}/${queue.length})`;
      driftEl.textContent = "";
      const data = await fetchSession(item.id);
      if (!data) { advance(); return; }
      markers = [];
      try {
        const res = await fetch(`${apiBase}/api/report`, { headers: auth() });
        const rdata = await res.json() as { ok: boolean; reports?: Array<{ id: string; sid?: string; step?: number; ty?: string; m?: string }> };
        if (rdata.ok) {
          markers = (rdata.reports ?? [])
            .filter((r) => r.sid === item.id && typeof r.step === "number")
            .map((r) => ({ step: r.step!, id: r.id, type: r.ty ?? "bug", message: r.m ?? "" }));
        }
      } catch { /* milestones are a nice-to-have; a failed fetch just omits them */ }
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
        drawTimeline();
        const secs = Math.floor(d.step / 60);
        timeEl.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} / ${fmtDur(d.totalSteps)}`;
        roomEl.textContent = `room: ${d.game.currentRoomId}`;
        keysEl.textContent = d.game.input.heldCodes().join(" ") || "·";
        skipIdleBtn.style.display = d.idlePeriodAt(d.step) ? "" : "none";
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
