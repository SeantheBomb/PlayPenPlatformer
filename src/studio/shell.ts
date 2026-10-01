// The shared studio shell: one CSS sheet, one login gate, one scoped
// publish, one hand-off into the running game — used by both the Art Studio
// (?art) and the Writers Studio (?write). Each studio brings its own
// credential (password header + login endpoint) and its own views; the
// server enforces the matching publish scope (_artscope.js / _writerscope.js),
// so nothing here is a security boundary — it's the shared UX contract:
// a non-technical collaborator walks in cold, gets in with one password,
// tries work in the real game, publishes when happy, can always undo.
import type { ContentStore } from "../data/content";
import { el, toast } from "../editor/forms";

export interface StudioCredential {
  /** localStorage key the password is remembered under. */
  passKey: string;
  /** Request header the server checks (x-artist-password / x-writer-password). */
  header: string;
  /** POST endpoint that verifies the password up front. */
  endpoint: string;
  title: string;
  blurb: string;
}

let styleEl: HTMLStyleElement | null = null;
export function ensureStudioStyles(): void {
  if (styleEl) return;
  styleEl = document.createElement("style");
  styleEl.textContent = STUDIO_CSS;
  document.head.append(styleEl);
}

/** Password gate. Offline (no server functions in local dev) still lets the
 *  collaborator in to draft — publishing re-checks the password anyway. */
export function loginView(cred: StudioCredential, onEntered: (online: boolean) => void): HTMLElement {
  const input = el("input", { type: "password", placeholder: "Password", autofocus: true }) as HTMLInputElement;
  const msg = el("div", { className: "st-hint" }, "");
  const go = async () => {
    const pass = input.value.trim();
    if (!pass) return;
    msg.textContent = "Checking…";
    let online = true;
    try {
      const res = await fetch(cred.endpoint, { method: "POST", headers: { [cred.header]: pass } });
      if (res.status === 401) { msg.textContent = "That's not the right password — double-check with Sean."; return; }
      online = res.ok; // 404/405 = local dev without server functions: drafting still works
    } catch {
      online = false;
    }
    localStorage.setItem(cred.passKey, pass);
    onEntered(online);
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") void go(); });
  return el(
    "div", { className: "st-card st-login" },
    el("div", { className: "st-title" }, cred.title),
    el("p", { className: "st-sub" }, cred.blurb),
    input,
    el("button", { className: "st-btn st-primary", onclick: () => void go() }, "Enter the studio"),
    msg
  );
}

/** Close the studio and resume the game with the draft content (main.ts
 *  listens). With a roomId it warps there first, so "play this room" lands
 *  where the work is. */
export function tryInGame(roomId?: string): void {
  window.dispatchEvent(new CustomEvent("pp-studio-close", { detail: roomId ? { roomId } : undefined }));
}

/** Publish the whole draft through the studio's scoped credential. The
 *  server overlays only this studio's fields onto live, so sending every
 *  file is safe by construction. Resolves true on success. */
export async function publishScoped(
  cred: StudioCredential,
  store: ContentStore,
  opts: { confirm: string; note: string; what: string }
): Promise<boolean> {
  const pass = localStorage.getItem(cred.passKey) ?? "";
  if (!confirm(opts.confirm)) return false;
  try {
    const res = await fetch("/api/content", {
      method: "POST",
      headers: { [cred.header]: pass, "content-type": "application/json" },
      body: JSON.stringify({ files: store.allFiles(), note: opts.note }),
    });
    const data = (await res.json()) as {
      ok: boolean; id?: string; error?: string; changes?: string[]; merged?: boolean;
    };
    if (!data.ok) {
      toast(res.status === 401
        ? "The password didn't work — check it with Sean (it may have changed)."
        : `Publish failed: ${data.error ?? "unknown error"}`, false);
      return false;
    }
    // Scoped publishes are always overlaid onto live server-side (merged).
    store.markPublished(data.id!, data.merged ?? true);
    const what = data.changes?.length ? ` (${data.changes.slice(0, 3).join("; ")}${data.changes.length > 3 ? "…" : ""})` : "";
    toast(`🎉 Published! Everyone gets your ${opts.what} on their next load${what}`);
    return true;
  } catch {
    toast("Couldn't reach the server — are you online? Your work is still saved as a draft here.", false);
    return false;
  }
}

export const STUDIO_CSS = `
.st-root { position:absolute; inset:0; background:#141020; color:#ece6f8; overflow:auto;
  font:14px "Segoe UI", system-ui, sans-serif; }
.st-shell { max-width:1060px; margin:0 auto; padding:18px; }
.st-header { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
.st-title { font-size:22px; font-weight:700; color:#ffd166; }
.st-sub { color:#9f96bd; }
.st-btn { background:#2a2342; border:1px solid #4a4070; color:#ece6f8; padding:8px 14px;
  border-radius:8px; cursor:pointer; font-size:14px; }
.st-btn:hover { background:#352c52; }
.st-btn.st-primary { background:#2c5140; border-color:#3e7a5c; font-weight:600; }
.st-btn.st-primary:hover { background:#356450; }
.st-btn.st-quiet { background:none; border-color:transparent; color:#9f96bd; }
.st-btn.st-on { background:#453a6e; border-color:#ffd166; color:#fff; }
.st-btn.st-danger { background:#4a2432; border-color:#7a3e50; }
.st-card { background:#1c1730; border:1px solid #322a4e; border-radius:12px; padding:16px; margin-bottom:14px; }
.st-steps { display:flex; gap:12px; flex-wrap:wrap; }
.st-step { flex:1; min-width:200px; background:#241d3c; border-radius:10px; padding:12px 14px; }
.st-step b { color:#ffd166; display:block; margin-bottom:4px; }
.st-filters { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
.st-chip { background:#241d3c; border:1px solid #3a3160; color:#bfb6dd; padding:5px 12px;
  border-radius:16px; cursor:pointer; font-size:13px; }
.st-chip.st-on { background:#453a6e; color:#fff; border-color:#ffd166; }
.st-search { background:#100d1c; color:#ece6f8; border:1px solid #3a3160; border-radius:8px;
  padding:7px 10px; min-width:180px; }
.st-grouphead { color:#ffd166; font-weight:700; margin:16px 0 8px; font-size:15px; }
.st-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:10px; }
.st-cardasset { background:#1c1730; border:1px solid #322a4e; border-radius:10px; padding:10px;
  cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:6px; text-align:center; }
.st-cardasset:hover { border-color:#ffd166; }
.st-thumb { width:56px; height:56px; border-radius:6px; background:
  repeating-conic-gradient(#221c38 0% 25%, #2a2342 0% 50%) 0 0 / 14px 14px; }
.st-name { font-size:13px; line-height:1.2; }
.st-dim { color:#9f96bd; font-size:11px; }
.st-status { font-size:10px; padding:2px 8px; border-radius:8px; }
.st-status.needs-art { background:#4a2432; color:#ffb3c5; }
.st-status.custom { background:#2c5140; color:#a5e8c3; }
.st-status.animated { background:#274a63; color:#a5d5f0; }
.st-detail-top { display:flex; gap:16px; flex-wrap:wrap; }
.st-previewcol { flex:none; }
.st-previewbig { border-radius:8px; background:
  repeating-conic-gradient(#221c38 0% 25%, #2a2342 0% 50%) 0 0 / 16px 16px; image-rendering:pixelated; }
.st-zoomrow { display:flex; gap:10px; align-items:flex-end; margin-top:8px; flex-wrap:wrap; }
.st-drop { border:2px dashed #4a4070; border-radius:10px; padding:22px; text-align:center;
  color:#bfb6dd; cursor:pointer; transition:border-color .15s; }
.st-drop.st-over { border-color:#ffd166; color:#ffd166; background:#241d3c; }
.st-frames { display:flex; gap:6px; flex-wrap:wrap; margin:10px 0; align-items:center; }
.st-frame { position:relative; width:44px; height:44px; border:1px solid #3a3160; border-radius:6px;
  background:repeating-conic-gradient(#221c38 0% 25%, #2a2342 0% 50%) 0 0 / 11px 11px; }
.st-frame canvas { width:100%; height:100%; image-rendering:pixelated; }
.st-framex { position:absolute; top:-7px; right:-7px; width:16px; height:16px; border-radius:8px;
  background:#4a2432; color:#ffb3c5; border:none; font-size:10px; cursor:pointer; line-height:1; }
.st-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:8px 0; }
.st-hint { color:#9f96bd; font-size:12px; }
.st-note { background:#241d3c; border-left:3px solid #ffd166; padding:8px 10px; border-radius:0 8px 8px 0;
  font-size:13px; color:#d5cdea; margin:6px 0; }
.st-note.st-err { border-left-color:#c84b6a; }
.st-login { max-width:420px; margin:12vh auto; }
.st-login input { width:100%; box-sizing:border-box; margin:10px 0; font-size:16px; padding:10px; }
.st-badge { background:#4a3d0d; color:#ffe95a; border-radius:6px; padding:2px 8px; font-size:11px; }
.st-spacer { flex:1; }
.st-svggrid { cursor:crosshair; border:1px solid #3a3160; border-radius:4px; }
/* The pixel/shape editor modals + toasts reuse the editor's pp-* classes;
   the studio can open them without the technical editor ever loading, so
   the styles they need are duplicated here (values kept in sync). */
.pp-btn { background:#241f36; border:1px solid #3a3550; color:#d8d2ec; padding:5px 10px;
  border-radius:4px; cursor:pointer; }
.pp-btn:hover { background:#2e2845; }
.pp-primary { background:#2c5140; border-color:#3e7a5c; }
.pp-danger { background:#4a2432; border-color:#7a3e50; }
.pp-hint { color:#8f87ad; font-size:11px; }
.pp-btnrow { display:flex; gap:8px; margin-top:12px; }
.pp-toast { position:fixed; bottom:18px; right:18px; background:#2c5140; color:#e8fff0;
  padding:8px 14px; border-radius:6px; z-index:99; font:12px monospace; }
.pp-toast-bad { background:#4a2432; color:#ffe8ee; }
.pp-pixmodal { position:fixed; inset:0; background:rgba(5,4,10,0.8); z-index:50;
  display:flex; align-items:center; justify-content:center; }
.pp-pixpanel { background:#1a1626; border:1px solid #3a3550; border-radius:8px; padding:16px;
  color:#d8d2ec; font:12px "Segoe UI", system-ui, sans-serif; max-height:92vh; overflow:auto; }
.pp-pixcols { display:flex; gap:16px; align-items:flex-start; margin-top:8px; }
.pp-pixgrid { cursor:crosshair; border:1px solid #2c2740; border-radius:4px; }
.pp-pixside { display:flex; flex-direction:column; gap:6px; width:150px; }
.pp-pixpreview { background:
  repeating-conic-gradient(#1a1626 0% 25%, #221e30 0% 50%) 0 0 / 16px 16px;
  border:1px solid #2c2740; border-radius:4px; }
.pp-paletterow { display:flex; flex-wrap:wrap; gap:4px; margin-top:8px; align-items:center; }
.pp-swatch { width:22px; height:22px; border:1px solid #3a3550; border-radius:4px; cursor:pointer; }
.pp-swatch.pp-active { outline:2px solid #ffd166; }
.pp-framestrip { display:flex; flex-wrap:wrap; gap:4px; align-items:center; }
.pp-framethumb { width:32px; height:32px; background:#100e1a; border:1px solid #3a3550;
  border-radius:4px; cursor:pointer; }
.pp-framethumb.pp-active { border-color:#ffd166; }
/* ---- Writers Studio additions (wr-*) + the quest-form classes it reuses
   from the editor's Quest Builder (values kept in sync with editor.ts). ---- */
.wr-form textarea, .wr-form input[type=text], .wr-form input[type=number], .wr-form select {
  width:100%; box-sizing:border-box; background:#100d1c; color:#ece6f8; border:1px solid #3a3160;
  border-radius:6px; padding:8px 10px; font:14px "Segoe UI", system-ui, sans-serif; }
.wr-form textarea { resize:vertical; min-height:56px; line-height:1.4; }
.wr-form input[type=number] { width:90px; }
.wr-form select { width:auto; min-width:140px; }
.wr-line { display:grid; grid-template-columns:minmax(260px,1fr) minmax(300px,1fr); gap:12px; align-items:start; margin:10px 0 14px; }
.wr-line canvas { width:100%; height:auto; border-radius:8px; background:#0d0b14; image-rendering:pixelated; }
.wr-lint { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
.wr-lint span { font-size:11px; padding:2px 8px; border-radius:8px; background:#241d3c; color:#bfb6dd; }
.wr-lint .warn { background:#4a3d0d; color:#ffe95a; }
.wr-lint .bad { background:#4a2432; color:#ffb3c5; }
.wr-lint .ok { background:#2c5140; color:#a5e8c3; }
.wr-role { font-size:10px; padding:2px 8px; border-radius:8px; background:#274a63; color:#a5d5f0; }
.wr-role.quest { background:#4a3d0d; color:#ffe95a; }
.wr-appearance { border-left:3px solid #3a3160; padding-left:14px; margin:18px 0; }
.wr-appearance.quest { border-left-color:#ffd166; }
.pp-questfield { margin-bottom:14px; }
.pp-questfieldlabel { color:#9f96bd; font-size:10px; font-weight:700; letter-spacing:0.5px; margin-bottom:5px; text-transform:uppercase; }
.pp-questfieldhint { color:#6a6485; font-size:11px; margin-top:4px; }
.pp-questrow { display:flex; align-items:center; gap:8px; margin:4px 0; flex-wrap:wrap; }
.pp-questsegmented { display:inline-flex; border:1px solid #3a3160; border-radius:8px; overflow:hidden; }
.pp-questseg { padding:6px 12px; cursor:pointer; font-size:13px; color:#bfb6dd; background:#100d1c; }
.pp-questseg.pp-active { background:#453a6e; color:#fff; }
.pp-chiplist { display:flex; flex-wrap:wrap; gap:6px; }
.pp-chip { display:flex; align-items:center; gap:4px; background:#100d1c; border:1px solid #3a3160;
  border-radius:12px; padding:3px 9px; font-size:12px; color:#bfb6dd; cursor:pointer; }
.pp-chip input { margin:0; }
.pp-questclose { color:#9f96bd; cursor:pointer; padding:0 4px; }
.pp-questclose:hover { color:#fff; }
`;
