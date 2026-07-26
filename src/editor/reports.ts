// Editor "reports" tab: review player-submitted bug/feedback reports.
//
// The list is fetched from /api/report (password-gated; terse per-report
// summaries stored as KV key metadata, so listing is one request). Reports
// filed while a session was recording carry sessionId + sessionStep, so a
// row can jump straight into that session's replay at the moment it fired
// (via sessions.ts's openSessionReplay) — same mechanism the sessions
// timeline's report milestones use (see renderReportMilestones there).
import { el, toast } from "./forms";
import { openSessionReplay } from "./sessions";

interface ReportRow {
  id: string;
  t?: string;   // receivedAt ISO
  ty?: string;  // type
  m?: string;   // message snippet
  room?: string | null;
  sid?: string | null;   // sessionId
  step?: number | null;  // sessionStep
  src?: string;          // "player" | "review"
}

interface FullReport {
  id: string;
  receivedAt: string;
  type: string;
  message: string;
  room: string | null;
  position: { x: number; y: number } | null;
  health: number | null;
  inventory: Record<string, number> | null;
  recipes: string[] | null;
  achievements: string[] | null;
  stats: Record<string, number> | null;
  scheme: string | null;
  appVersion: string | null;
  userAgent: string | null;
  viewport: { w: number; h: number } | null;
  screenshot: string | null;
  sessionId: string | null;
  sessionStep: number | null;
  source: string;
}

async function fetchReportById(apiBase: string, passKey: string, id: string): Promise<FullReport | null> {
  try {
    const res = await fetch(`${apiBase}/api/report?id=${encodeURIComponent(id)}`, {
      headers: { "x-editor-password": localStorage.getItem(passKey) ?? "" },
    });
    const data = await res.json() as { ok: boolean; report?: FullReport; error?: string };
    if (!data.ok || !data.report) throw new Error(data.error ?? "bad response");
    return data.report;
  } catch (err) {
    toast(`Fetch failed: ${String(err)}`, false);
    return null;
  }
}

/** Full-detail report modal — shared by the Reports tab's row click and the
 *  sessions timeline's report-milestone popup (see sessions.ts). */
export async function openReportDetail(apiBase: string, passKey: string, id: string): Promise<void> {
  const r = await fetchReportById(apiBase, passKey, id);
  if (!r) return;
  const closeModal = () => modal.remove();
  const jumpBtn = r.sessionId
    ? el("button", {
        className: "pp-btn",
        onclick: () => {
          closeModal();
          void openSessionReplay(apiBase, passKey, r.sessionId!, r.sessionStep ?? undefined);
        },
      }, "▶ watch session at this moment")
    : el("span", { className: "pp-hint" }, "no session recorded for this report");
  const modal = el("div", { className: "pp-pixmodal" },
    el("div", { className: "pp-pixpanel", style: "width:640px;max-width:95vw;max-height:85vh;overflow:auto" },
      el("div", { style: "display:flex;justify-content:space-between;align-items:center" },
        el("div", { className: "pp-sidehead" }, `${r.type} — ${new Date(r.receivedAt).toLocaleString()}`),
        el("button", { className: "pp-btn pp-danger", onclick: closeModal }, "✕")
      ),
      el("p", {}, r.message || "(no message)"),
      r.screenshot
        ? el("img", { src: r.screenshot, style: "width:100%;border-radius:6px;margin:8px 0" })
        : el("span", {}),
      el("div", { style: "font-size:11px;color:#bbb3d6;line-height:1.7" },
        el("div", {}, `room: ${r.room ?? "—"}  ·  position: ${r.position ? `${r.position.x}, ${r.position.y}` : "—"}`),
        el("div", {}, `health: ${r.health ?? "—"}  ·  scheme: ${r.scheme ?? "—"}  ·  app: ${r.appVersion ?? "—"}`),
        el("div", {}, `inventory: ${r.inventory ? Object.entries(r.inventory).map(([k, v]) => `${k}×${v}`).join(", ") || "—" : "—"}`),
        el("div", {}, `recipes known: ${(r.recipes ?? []).join(", ") || "—"}`),
        el("div", {}, `achievements: ${(r.achievements ?? []).join(", ") || "—"}`),
        el("div", {}, `source: ${r.source}  ·  viewport: ${r.viewport ? `${r.viewport.w}×${r.viewport.h}` : "—"}`),
        el("div", {}, `user agent: ${r.userAgent ?? "—"}`)
      ),
      el("div", { style: "margin-top:10px" }, jumpBtn)
    )
  );
  document.body.append(modal);
}

export function renderReportsTab(
  root: HTMLElement,
  apiBase: string,
  passKey: string
): void {
  let rows: ReportRow[] = [];
  let filterType = "all";

  const auth = () => ({ "x-editor-password": localStorage.getItem(passKey) ?? "" });

  const listEl = el("div");
  const statusEl = el("p", { className: "pp-hint" }, "loading reports...");

  const typeSelect = el("select", {
    onchange: (e) => { filterType = (e.target as HTMLSelectElement).value; renderList(); },
  },
    el("option", { value: "all" }, "all types"),
    el("option", { value: "bug" }, "bug"),
    el("option", { value: "stuck" }, "I'm stuck"),
    el("option", { value: "feedback" }, "feedback"),
    el("option", { value: "idea" }, "feature idea")
  );

  async function load(): Promise<void> {
    statusEl.textContent = "loading reports...";
    try {
      const res = await fetch(`${apiBase}/api/report`, { headers: auth() });
      if (res.status === 401) {
        statusEl.textContent = "wrong/missing editor password — set it in the publish tab first";
        return;
      }
      const data = await res.json() as { ok: boolean; reports?: ReportRow[]; error?: string };
      if (!data.ok) throw new Error(data.error);
      rows = data.reports ?? [];
      statusEl.textContent = "";
      renderList();
    } catch (err) {
      statusEl.textContent = `couldn't load reports (${String(err)})`;
    }
  }

  function visibleRows(): ReportRow[] {
    return rows.filter((r) => filterType === "all" || r.ty === filterType);
  }

  function renderList(): void {
    listEl.replaceChildren();
    const pop = visibleRows();
    if (pop.length === 0) {
      listEl.append(el("p", { className: "pp-hint" }, "no reports match"));
      return;
    }
    const head = el("div", { className: "pp-row", style: "font-weight:bold;color:#8f87ad;display:flex;gap:8px" },
      el("span", { style: "width:130px" }, "when"),
      el("span", { style: "width:70px" }, "type"),
      el("span", { style: "width:80px" }, "room"),
      el("span", { style: "flex:1" }, "message"),
      el("span", { style: "width:60px" }, "source"),
      el("span", { style: "width:60px" }, "")
    );
    listEl.append(head);
    for (const r of pop) {
      const row = el("div", {
        className: "pp-row",
        style: "display:flex;gap:8px;align-items:center;border-bottom:1px solid #2c2740;padding:4px 0;cursor:pointer",
        onclick: () => void openReportDetail(apiBase, passKey, r.id),
      },
        el("span", { style: "width:130px", className: "pp-hint" },
          r.t ? new Date(r.t).toLocaleString() : "?"),
        el("span", { style: "width:70px" }, r.ty ?? "?"),
        el("span", { style: "width:80px;font-size:10px" }, r.room ?? "—"),
        el("span", { style: "flex:1;font-size:11px" }, (r.m ?? "").slice(0, 90) || "(no message)"),
        el("span", { style: "width:60px;font-size:10px" }, r.src === "review" ? "review" : "player"),
        el("span", { style: "width:60px" }, r.sid ? "▶ jump" : "")
      );
      listEl.append(row);
    }
  }

  root.append(
    el("p", { className: "pp-hint" },
      "Player-submitted bug/feedback reports. Reports filed during a recorded " +
      "session can jump straight into that session's replay at the moment " +
      "they fired."),
    el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0" },
      typeSelect,
      el("button", { className: "pp-btn", onclick: () => void load() }, "↻ refresh")
    ),
    statusEl,
    listEl
  );
  void load();
}
