// Working-together plumbing shared by the studios and the editor (2026-11-04,
// when Miranda joined Casey): who's at this keyboard, other people's
// publishes arriving mid-session, and the keep-mine / take-theirs dialog when
// two people changed the same thing.
//
// The merge itself lives in functions/api/_merge.js and ContentStore
// (prepareSync / applySync); this file only decides WHEN to apply (never
// under someone's cursor) and how to ask. Self-styled so it works over both
// the studio and editor stylesheets.
import type { ContentStore, PendingSync } from "../data/content";
import type { ConflictGroup, Resolution } from "../../functions/api/_merge.js";

const WHO_KEY = "playpen.whoami";

// ---------------- identity ----------------

/** The name this browser publishes under, if it has been asked. */
export function whoAmI(): string {
  try {
    return localStorage.getItem(WHO_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The name to publish under — asks once per browser. null = cancelled. */
export async function ensureWhoAmI(): Promise<string | null> {
  const known = whoAmI();
  if (known) return known;
  return askWhoAmI();
}

/** Ask (or re-ask) for a display name. Shown on publishes and toasts. */
export function askWhoAmI(): Promise<string | null> {
  ensureStyles();
  return new Promise((resolve) => {
    const input = h("input", { className: "cb-input", placeholder: "e.g. Casey", value: whoAmI() }) as HTMLInputElement;
    const close = (v: string | null) => { wrap.remove(); resolve(v); };
    const ok = () => {
      const name = input.value.trim().slice(0, 40);
      if (!name) return void input.focus();
      try { localStorage.setItem(WHO_KEY, name); } catch { /* private window: ask again next time */ }
      close(name);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") ok();
      if (e.key === "Escape") close(null);
    });
    const wrap = h("div", { className: "cb-veil" },
      h("div", { className: "cb-card cb-small" },
        h("div", { className: "cb-title" }, "Who's publishing?"),
        h("p", { className: "cb-sub" },
          "Your name goes on what you publish, so everyone can see who changed what. Asked once on this computer."),
        input,
        h("div", { className: "cb-row" },
          h("button", { className: "cb-btn", onclick: () => close(null) }, "Cancel"),
          h("button", { className: "cb-btn cb-primary", onclick: ok }, "That's me")
        )
      )
    );
    document.body.append(wrap);
    input.focus();
  });
}

// ---------------- notices ----------------

/** A longer-lived toast than forms.ts's (other people's news needs reading time). */
export function notice(msg: string, opts: { warn?: boolean; ms?: number } = {}): void {
  ensureStyles();
  let stack = document.querySelector(".cb-notices");
  if (!stack) {
    stack = h("div", { className: "cb-notices" });
    document.body.append(stack);
  }
  const n = h("div", { className: "cb-notice" + (opts.warn ? " cb-warn" : "") }, msg);
  n.onclick = () => n.remove();
  stack.append(n);
  setTimeout(() => n.remove(), opts.ms ?? 7000);
}

/** "Casey published: art update — tiles: wall, lava …" */
export function describeIncoming(p: PendingSync): string {
  const who = p.meta.by || "Someone";
  const what = p.incoming.length
    ? ` — ${p.incoming.slice(0, 2).join("; ")}${p.incoming.length > 2 ? ` (+${p.incoming.length - 2} more)` : ""}`
    : "";
  return `${who} published${what}. It's in your view now; your own work is untouched.`;
}

// ---------------- background sync ----------------

let pointerDown = false;
let lastTyped = 0;
let listening = false;
function listenForActivity(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("pointerdown", () => { pointerDown = true; }, true);
  window.addEventListener("pointerup", () => { pointerDown = false; }, true);
  window.addEventListener("pointercancel", () => { pointerDown = false; }, true);
  window.addEventListener("keydown", () => { lastTyped = Date.now(); }, true);
  window.addEventListener("input", () => { lastTyped = Date.now(); }, true);
}

/** Someone is mid-gesture: typing in a field, dragging, or in a dialog.
 *  Applying a sync re-renders the page, which would yank that away. */
export function defaultBusy(): boolean {
  if (pointerDown || Date.now() - lastTyped < 2500) return true;
  if (document.querySelector(".pp-pixmodal, .cb-veil")) return true;
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  const tag = a.tagName;
  return tag === "TEXTAREA" || tag === "SELECT" || a.isContentEditable ||
    (tag === "INPUT" && !["button", "checkbox", "radio", "range", "color", "file"].includes((a as HTMLInputElement).type));
}

/**
 * Poll for other people's publishes (cheap meta every `intervalMs`, and on
 * tab focus). A newer publish is merged with the local draft right away but
 * APPLIED only when nobody's mid-gesture; `onApplied` then re-renders.
 * With `autoApply: false` (the editor) it hands the pending sync to
 * `onPending` and the person decides when to pull it in.
 * Returns a stop function.
 */
export function startLiveSync(
  store: ContentStore,
  opts: {
    intervalMs?: number;
    isBusy?: () => boolean;
    autoApply?: boolean;
    onApplied?: (p: PendingSync) => void;
    onPending?: (p: PendingSync) => void;
  }
): () => void {
  listenForActivity();
  const isBusy = opts.isBusy ?? defaultBusy;
  const autoApply = opts.autoApply ?? true;
  let pending: PendingSync | null = null;
  let checking = false;
  let stopped = false;

  const tryApply = () => {
    if (!pending || stopped || !autoApply || isBusy()) return;
    const p = pending;
    pending = null;
    if (store.applySync(p)) opts.onApplied?.(p);
    // else: an edit landed since — the next check recomputes on top of it.
  };
  const check = async () => {
    if (checking || stopped || document.hidden) return;
    if (pending && pending.revision !== store.revision) pending = null;
    if (pending && autoApply) return void tryApply();
    checking = true;
    try {
      // Manual mode with one already waiting: only redo the (bundle-sized)
      // merge if live moved again.
      if (pending && (await store.liveMeta())?.id === pending.meta.id) return;
      const p = await store.prepareSync();
      if (p && !stopped) {
        const fresh = p.meta.id !== pending?.meta.id;
        pending = p;
        if (autoApply) tryApply();
        else if (fresh) opts.onPending?.(p);
      }
    } finally {
      checking = false;
    }
  };

  const slow = window.setInterval(() => void check(), opts.intervalMs ?? 15000);
  // While something's waiting for a quiet moment, look for one every second.
  const fast = window.setInterval(() => { if (pending) tryApply(); }, 1000);
  const onFocus = () => void check();
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onFocus);
  return () => {
    stopped = true;
    clearInterval(slow);
    clearInterval(fast);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onFocus);
  };
}

// ---------------- keep mine / take theirs ----------------

/**
 * The publish-time dialog: one row per item both sides changed, each with
 * the two versions side by side. Resolves to { group: "mine"|"theirs" } for
 * every row, or null if they backed out (nothing is published then).
 */
export function resolveConflicts(
  groups: ConflictGroup[],
  theirName: string | null
): Promise<Record<string, Resolution> | null> {
  ensureStyles();
  const them = theirName || "the newer publish";
  return new Promise((resolve) => {
    const choice: Record<string, Resolution> = {};
    const publishBtn = h("button", { className: "cb-btn cb-primary" }, "") as HTMLButtonElement;
    const refresh = () => {
      const left = groups.filter((g) => !choice[g.group]).length;
      publishBtn.disabled = left > 0;
      publishBtn.textContent = left ? `Choose ${left} more…` : "Publish with these choices";
      for (const row of list.children) {
        const g = (row as HTMLElement).dataset.group!;
        for (const side of row.querySelectorAll<HTMLElement>("[data-side]")) {
          side.classList.toggle("cb-picked", choice[g] === side.dataset.side);
        }
      }
    };
    const list = h("div", { className: "cb-list" });
    for (const g of groups) {
      const sideCard = (side: Resolution, title: string, pick: (v: ConflictGroup["values"][number]) => unknown) => {
        const card = h("div", { className: "cb-side" }, h("div", { className: "cb-sidehead" }, title));
        card.dataset.side = side;
        for (const v of g.values) {
          const field = v.path.slice(1).join(".") || v.path.join(".");
          card.append(h("div", { className: "cb-field" }, field), preview(pick(v)));
        }
        card.onclick = () => { choice[g.group] = side; refresh(); };
        return card;
      };
      const row = h("div", { className: "cb-item" },
        h("div", { className: "cb-label" }, g.label),
        h("div", { className: "cb-sides" },
          sideCard("mine", "Keep mine", (v) => v.incoming),
          sideCard("theirs", `Take ${them}'s`, (v) => v.live)
        )
      );
      row.dataset.group = g.group;
      list.append(row);
    }
    const all = (r: Resolution) => () => { for (const g of groups) choice[g.group] = r; refresh(); };
    const close = (v: Record<string, Resolution> | null) => { wrap.remove(); resolve(v); };
    publishBtn.onclick = () => close({ ...choice });
    const wrap = h("div", { className: "cb-veil" },
      h("div", { className: "cb-card" },
        h("div", { className: "cb-title" }, `You and ${them} both changed ${groups.length === 1 ? "this" : `these ${groups.length} things`}`),
        h("p", { className: "cb-sub" },
          "Everything else you each did merges on its own. For each one below, pick which version everyone should get. " +
          "Nothing is published until you choose, and every publish stays in history."),
        h("div", { className: "cb-row cb-left" },
          h("button", { className: "cb-btn", onclick: all("mine") }, "All mine"),
          h("button", { className: "cb-btn", onclick: all("theirs") }, `All ${them}'s`)
        ),
        list,
        h("div", { className: "cb-row" },
          h("button", { className: "cb-btn", onclick: () => close(null) }, "Not now"),
          publishBtn
        )
      )
    );
    document.body.append(wrap);
    refresh();
  });
}

/** One conflicting value, readable: art as a picture, words as words. */
function preview(v: unknown): HTMLElement {
  if (v === undefined) return h("div", { className: "cb-none" }, "(removed / not set)");
  const img = (src: string, extra?: string) => {
    const wrap = h("div", { className: "cb-art" });
    const i = document.createElement("img");
    i.src = src;
    wrap.append(i);
    if (extra) wrap.append(h("span", { className: "cb-sub" }, extra));
    return wrap;
  };
  const isImg = (x: unknown): x is string => typeof x === "string" && x.startsWith("data:image");
  if (isImg(v)) return img(v);
  if (Array.isArray(v) && v.length && v.every(isImg)) return img(v[0], `${v.length} frame${v.length > 1 ? "s" : ""}`);
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    const art = isImg(o.sprite) ? o.sprite : Array.isArray(o.spriteFrames) && isImg(o.spriteFrames[0]) ? o.spriteFrames[0] : null;
    if (art) return img(art);
  }
  const text = typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (isImg(x) ? "[image]" : x), 1);
  return h("pre", { className: "cb-text" }, text.length > 400 ? text.slice(0, 400) + "…" : text);
}

// ---------------- bits ----------------

function h(tag: string, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
}

let styled = false;
function ensureStyles(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement("style");
  s.textContent = `
.cb-veil { position:fixed; inset:0; background:rgba(8,6,16,.72); z-index:1000; display:flex;
  align-items:center; justify-content:center; padding:16px; font:14px system-ui, sans-serif; }
.cb-card { background:#1c1730; color:#efeaff; border:1px solid #4a4070; border-radius:12px;
  padding:18px 20px; width:min(860px, 100%); max-height:90vh; overflow:auto; box-shadow:0 10px 40px #0008; }
.cb-small { width:min(420px, 100%); }
.cb-title { font-size:18px; font-weight:700; color:#ffd166; margin-bottom:6px; }
.cb-sub { color:#b9b0d8; font-size:13px; margin:0 0 12px; }
.cb-input { width:100%; box-sizing:border-box; padding:9px 10px; border-radius:8px; border:1px solid #4a4070;
  background:#100e1a; color:#efeaff; font:inherit; margin-bottom:12px; }
.cb-row { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; flex-wrap:wrap; }
.cb-left { justify-content:flex-start; margin:0 0 10px; }
.cb-btn { background:#2a2344; color:#efeaff; border:1px solid #4a4070; border-radius:8px; padding:8px 14px;
  font:inherit; cursor:pointer; }
.cb-btn:disabled { opacity:.5; cursor:default; }
.cb-primary { background:#ffd166; color:#1c1730; border-color:#ffd166; font-weight:700; }
.cb-list { display:flex; flex-direction:column; gap:12px; }
.cb-item { border:1px solid #3a3358; border-radius:10px; padding:10px; }
.cb-label { font-weight:700; margin-bottom:8px; }
.cb-sides { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
@media (max-width:560px) { .cb-sides { grid-template-columns:1fr; } }
.cb-side { border:2px solid #3a3358; border-radius:8px; padding:8px; cursor:pointer; min-width:0; }
.cb-side:hover { border-color:#6a5ea0; }
.cb-side.cb-picked { border-color:#ffd166; background:#2a2344; }
.cb-sidehead { font-weight:700; color:#ffd166; margin-bottom:6px; }
.cb-field { color:#9d94c4; font:12px monospace; margin-top:6px; }
.cb-art { display:flex; align-items:center; gap:8px; }
.cb-art img { width:72px; height:72px; object-fit:contain; image-rendering:pixelated; background:
  repeating-conic-gradient(#2c2640 0 25%, #221d33 0 50%) 0 0 / 12px 12px; border-radius:4px; }
.cb-text { white-space:pre-wrap; word-break:break-word; font:12px monospace; margin:2px 0 0;
  max-height:140px; overflow:auto; color:#ddd6f5; }
.cb-none { color:#8b82ad; font-style:italic; font-size:12px; }
.cb-notices { position:fixed; left:16px; bottom:16px; z-index:999; display:flex; flex-direction:column;
  gap:8px; max-width:min(440px, calc(100vw - 32px)); }
.cb-notice { background:#1c1730; color:#efeaff; border:1px solid #4a4070; border-left:4px solid #6fd6a0;
  border-radius:8px; padding:10px 12px; font:13px system-ui, sans-serif; box-shadow:0 6px 20px #0006; cursor:pointer; }
.cb-warn { border-left-color:#ffb454; }
`;
  document.head.append(s);
}
