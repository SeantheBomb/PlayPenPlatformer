// The coordination board, client side (Casey + Miranda, 2026-11-04): who's on
// which asset, where it is in the workflow, and a short note. Live for every
// open studio via /api/board (D1) — polled every few seconds and on focus,
// never published, never part of content. Asset keys are the gallery's
// (tile:wall, npc:toby…) plus `layerset:<id>` for environment sets.
import { el, toast } from "../editor/forms";
import { ensureWhoAmI, whoAmI } from "./collab";

export type BoardStatus = "todo" | "doing" | "review" | "changes" | "done";
export const STATUS_ORDER: BoardStatus[] = ["todo", "doing", "review", "changes", "done"];
export const STATUS_LABEL: Record<BoardStatus, string> = {
  todo: "To do", doing: "In progress", review: "Ready for review", changes: "Changes requested", done: "Done",
};
const STATUS_COLOR: Record<BoardStatus, string> = {
  todo: "#8b82ad", doing: "#5aa9ff", review: "#ffd166", changes: "#ff7a7a", done: "#6fd6a0",
};

export interface BoardItem {
  key: string;
  status: BoardStatus | null;
  owner: string | null;
  note: string | null;
  updatedBy: string | null;
  updatedAt: number;
}

export class Board {
  items = new Map<string, BoardItem>();
  /** False until the first successful fetch (or forever offline/local dev). */
  online = false;
  private since = 0;
  private timer: number | undefined;
  private listeners = new Set<(changed: BoardItem[]) => void>();
  private readonly onFocus = () => void this.poll();

  constructor(private auth: () => Record<string, string>, private intervalMs = 5000) {}

  start(): void {
    void this.poll();
    this.timer = window.setInterval(() => void this.poll(), this.intervalMs);
    window.addEventListener("focus", this.onFocus);
    document.addEventListener("visibilitychange", this.onFocus);
  }

  stop(): void {
    clearInterval(this.timer);
    window.removeEventListener("focus", this.onFocus);
    document.removeEventListener("visibilitychange", this.onFocus);
  }

  /** Called with the rows that changed (from anyone, including this tab). */
  onChange(fn: (changed: BoardItem[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(key: string): BoardItem | undefined {
    return this.items.get(key);
  }

  /** Every name that owns something, for the owner filter / suggestions. */
  owners(): string[] {
    const s = new Set<string>();
    for (const i of this.items.values()) if (i.owner) s.add(i.owner);
    const me = whoAmI();
    if (me) s.add(me);
    return [...s].sort((a, b) => a.localeCompare(b));
  }

  private polling = false;
  async poll(): Promise<void> {
    if (this.polling || document.hidden) return;
    this.polling = true;
    try {
      const res = await fetch(`/api/board?since=${this.since}`, { headers: this.auth(), cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { ok: boolean; now: number; items: BoardItem[] };
      if (!data.ok) return;
      this.online = true;
      // Overlap a little: rows written in the same ms as `now` aren't lost.
      this.since = Math.max(0, data.now - 2000);
      this.absorb(data.items);
    } catch {
      /* offline / local dev without functions — the board just stays empty */
    } finally {
      this.polling = false;
    }
  }

  private absorb(rows: BoardItem[]): void {
    const changed = rows.filter((r) => {
      const had = this.items.get(r.key);
      if (had && had.updatedAt >= r.updatedAt) return false;
      this.items.set(r.key, r);
      return true;
    });
    if (changed.length) for (const fn of this.listeners) fn(changed);
  }

  /** Change some fields of one row. Shows immediately here; everyone else
   *  sees it on their next poll (seconds). */
  async set(key: string, patch: Partial<Pick<BoardItem, "status" | "owner" | "note">>): Promise<boolean> {
    const by = await ensureWhoAmI();
    if (by === null) return false;
    try {
      const res = await fetch("/api/board", {
        method: "POST",
        headers: { ...this.auth(), "content-type": "application/json" },
        body: JSON.stringify({ key, ...patch, by }),
      });
      const data = (await res.json()) as { ok: boolean; item?: BoardItem; error?: string };
      if (!data.ok || !data.item) {
        toast(res.status === 401 ? "The board didn't accept your password." : `Couldn't save: ${data.error ?? "error"}`, false);
        return false;
      }
      this.absorb([data.item]);
      return true;
    } catch {
      toast("Couldn't reach the board — are you online?", false);
      return false;
    }
  }
}

// ---------------- views ----------------

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/** The little status + owner badge on a gallery card ("" when unset). */
export function boardBadge(item: BoardItem | undefined): HTMLElement | null {
  if (!item || (!item.status && !item.owner)) return null;
  const wrap = el("span", { className: "st-board-badge" });
  if (item.status) {
    wrap.append(el("span", {
      className: "st-board-status", style: `background:${STATUS_COLOR[item.status]}`,
      title: STATUS_LABEL[item.status],
    }, STATUS_LABEL[item.status]));
  }
  if (item.owner) {
    wrap.append(el("span", {
      className: "st-board-owner" + (item.owner === whoAmI() ? " st-me" : ""), title: `Owner: ${item.owner}`,
    }, initials(item.owner)));
  }
  if (item.note) wrap.title = item.note;
  return wrap;
}

/** Status / owner / note controls for one asset (detail pages). */
export function boardPanel(board: Board, key: string): HTMLElement {
  const item = board.get(key);
  const status = el("select", { className: "st-search" }) as HTMLSelectElement;
  status.append(el("option", { value: "" }, "— no status —"));
  for (const s of STATUS_ORDER) {
    const o = el("option", { value: s }, STATUS_LABEL[s]) as HTMLOptionElement;
    o.selected = item?.status === s;
    status.append(o);
  }
  status.onchange = () => void board.set(key, { status: (status.value || null) as BoardStatus | null });

  const listId = `st-owners-${Math.random().toString(36).slice(2)}`;
  const owner = el("input", {
    className: "st-search", placeholder: "Owner", value: item?.owner ?? "", style: "width:140px",
  }) as HTMLInputElement;
  owner.setAttribute("list", listId);
  const owners = el("datalist", { id: listId }, ...board.owners().map((n) => el("option", { value: n })));
  const saveOwner = () => {
    if ((owner.value.trim() || null) !== (board.get(key)?.owner ?? null)) void board.set(key, { owner: owner.value.trim() || null });
  };
  owner.onchange = saveOwner;
  owner.onkeydown = (e) => { if (e.key === "Enter") owner.blur(); };

  const mine = el("button", {
    className: "st-btn st-quiet",
    onclick: async () => {
      const me = await ensureWhoAmI();
      if (me) { owner.value = me; saveOwner(); }
    },
  }, "I'll take it");

  const note = el("input", {
    className: "st-search", placeholder: "Note (e.g. needs the lit version too)", value: item?.note ?? "",
    style: "flex:1;min-width:180px", maxLength: 280,
  }) as HTMLInputElement;
  note.onchange = () => void board.set(key, { note: note.value.trim() || null });
  note.onkeydown = (e) => { if (e.key === "Enter") note.blur(); };

  const meta = el("span", { className: "st-hint" },
    !board.online ? "Board offline — changes can't be saved right now."
      : item?.updatedBy ? `Last changed by ${item.updatedBy} ${ago(item.updatedAt)}` : "Everyone sees changes here within seconds.");
  return el("div", { className: "st-card st-board-panel" },
    el("div", { className: "st-row", style: "flex-wrap:wrap;gap:8px;align-items:center" },
      el("strong", {}, "📋 Board"), status, owner, owners, mine, note),
    meta
  );
}

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

export const BOARD_CSS = `
.st-board-badge { display:flex; gap:4px; align-items:center; flex-wrap:wrap; justify-content:center; }
.st-board-status { color:#14101f; font-size:10px; font-weight:700; border-radius:8px; padding:1px 6px; }
.st-board-owner { background:#2a2344; color:#efeaff; border:1px solid #4a4070; font-size:10px; font-weight:700;
  border-radius:50%; width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center; }
.st-board-owner.st-me { border-color:#ffd166; color:#ffd166; }
.st-board-panel { margin:0 0 12px; padding:10px 12px; }
`;
