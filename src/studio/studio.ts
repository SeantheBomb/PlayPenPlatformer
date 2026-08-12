// PlayPen Art Studio — the artist-facing home for ALL game art. Lives on
// the same site as the game (?art), gated by its own password
// (ARTIST_PASSWORD, separate from the editor's), and publishes through the
// server's art-scoped path so it can only ever change how things look.
//
// UX contract (Sean, 2026-08-12): a non-technical artist should be able to
// walk in cold and follow the journey — see what needs art, download
// templates, draw in her own tools (Aseprite/Photoshop/Illustrator), drop
// the results in, try them in the real game, publish when happy.
import type { ContentStore } from "../data/content";
import type { Game } from "../game/game";
import { el, toast } from "../editor/forms";
import { openPixelEditor } from "../editor/pixeleditor";
import { getImage } from "../engine/renderer";
import { buildAssets, assetStatus, GROUP_ORDER, type ArtAsset, type AssetGroup } from "./assets";
import { importFiles, sliceStrip, imageSize } from "./importers";
import { downloadFrame, downloadStrip, downloadContactSheet } from "./exporters";
import { openSvgEditor, rasterizeSeedTight } from "./svgeditor";

const PASS_KEY = "playpen.artist.password";
const SEEN_KEY = "playpen.artist.welcomed";

const CSS = `
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
.st-zoomrow { display:flex; gap:10px; align-items:flex-end; margin-top:8px; }
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
`;

let styleEl: HTMLStyleElement | null = null;
let active: Studio | null = null;

export function openStudio(root: HTMLElement, store: ContentStore, game: Game): void {
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.textContent = CSS;
    document.head.append(styleEl);
  }
  active = new Studio(root, store, game);
  active.render();
}

export function closeStudio(root: HTMLElement): void {
  active?.dispose();
  root.replaceChildren();
  active = null;
}

type Filter = "all" | "needs-art" | "custom" | "animated";

class Studio {
  private assets: ArtAsset[] = [];
  private view: "login" | "welcome" | "gallery" | "detail" = "gallery";
  private selectedKey: string | null = null;
  private filter: Filter = "all";
  private group: AssetGroup | "all" = "all";
  private search = "";
  private online = true;
  private timer: number | undefined;
  private dirty = false;
  /** Per-asset pixel-editor resolution choice (1×/2×/4× the drawn box) —
   *  in-memory only, defaults to 1×. This is what "adjust the resolution"
   *  means for the BUILT-IN pixel editor; importing an already-sized file
   *  from Aseprite/Photoshop is the other route and needs no control here. */
  private pixelResMult = new Map<string, number>();
  /** Import feedback that must survive the post-import re-render. */
  private pendingNotes: { key: string; notes: string[]; errors: string[] } | null = null;

  constructor(
    private root: HTMLElement,
    private store: ContentStore,
    private game: Game
  ) {
    this.assets = buildAssets(store);
    const pass = localStorage.getItem(PASS_KEY);
    this.view = !pass ? "login" : localStorage.getItem(SEEN_KEY) ? "gallery" : "welcome";
    // Animated thumbnails: cheap periodic repaint of whatever's on screen.
    this.timer = window.setInterval(() => this.repaintCanvases(), 180);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private refresh(): void {
    this.assets = buildAssets(this.store);
    this.render();
  }

  private asset(key: string | null): ArtAsset | undefined {
    return this.assets.find((a) => a.key === key);
  }

  // ================= RENDER =================

  render(): void {
    this.root.replaceChildren();
    const shell = el("div", { className: "st-root" }, el("div", { className: "st-shell" }));
    const inner = shell.firstChild as HTMLElement;
    this.root.append(shell);
    if (this.view === "login") return void inner.append(this.loginView());
    inner.append(this.header());
    if (this.view === "welcome") inner.append(this.welcomeView());
    else if (this.view === "detail" && this.asset(this.selectedKey)) inner.append(this.detailView(this.asset(this.selectedKey)!));
    else inner.append(this.galleryView());
    this.repaintCanvases();
  }

  private header(): HTMLElement {
    const pubInfo = this.store.publishedInfo;
    return el(
      "div", { className: "st-header" },
      el("span", { className: "st-title" }, "🎨 PlayPen Art Studio"),
      this.online ? null : el("span", { className: "st-badge" }, "offline — publishing unavailable"),
      el("span", { className: "st-spacer" }),
      el("button", { className: "st-btn st-quiet", onclick: () => { this.view = "welcome"; this.render(); } }, "How it works"),
      el("button", {
        className: "st-btn", title: "One PNG with every asset's current look — reference for your art app",
        onclick: () => this.downloadSheet(),
      }, "⬇ Reference sheet"),
      el("button", {
        className: "st-btn", title: "Close the studio and play the game with your draft art",
        onclick: () => this.tryInGame(),
      }, "🎮 Try in game"),
      el("button", {
        className: "st-btn st-primary",
        title: pubInfo ? `Everyone playing the game gets your art. Last publish: ${pubInfo.publishedAt.slice(0, 16).replace("T", " ")}` : "Everyone playing the game gets your art",
        onclick: () => this.publish(),
      }, "🚀 Publish art")
    );
  }

  // ---- Login ----

  private loginView(): HTMLElement {
    const input = el("input", { type: "password", placeholder: "Password", autofocus: true }) as HTMLInputElement;
    const msg = el("div", { className: "st-hint" }, "");
    const go = async () => {
      const pass = input.value.trim();
      if (!pass) return;
      msg.textContent = "Checking…";
      try {
        const res = await fetch("/api/artist", { method: "POST", headers: { "x-artist-password": pass } });
        if (res.status === 401) { msg.textContent = "That's not the right password — double-check with Sean."; return; }
        // 404/405 = local dev without server functions: drafting still works.
        this.online = res.ok;
      } catch {
        // Offline: let her in to draft; publishing re-checks the password.
        this.online = false;
      }
      localStorage.setItem(PASS_KEY, pass);
      this.view = localStorage.getItem(SEEN_KEY) ? "gallery" : "welcome";
      this.render();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") void go(); });
    return el(
      "div", { className: "st-card st-login" },
      el("div", { className: "st-title" }, "🎨 PlayPen Art Studio"),
      el("p", { className: "st-sub" },
        "Welcome! This is where all of PlayPen's artwork lives. Enter the studio password Sean gave you to get started."),
      input,
      el("button", { className: "st-btn st-primary", onclick: () => void go() }, "Enter the studio"),
      msg
    );
  }

  // ---- Welcome / journey ----

  private welcomeView(): HTMLElement {
    const needs = this.assets.filter((a) => assetStatus(a) === "needs-art").length;
    return el(
      "div", {},
      el(
        "div", { className: "st-card" },
        el("h2", { style: "margin:0 0 6px;color:#ffd166" }, "Welcome to the studio 👋"),
        el("p", {},
          "Every piece of art in PlayPen is listed in the gallery here — characters, tiles, objects, items, enemies. ",
          `Right now the game draws most things itself with simple shapes ("procedural"), and ${needs} slots are waiting for real art. `,
          "You can replace as much or as little as you like: tweak one tile, or overhaul the whole game's look. Your call."),
        el(
          "div", { className: "st-steps" },
          el("div", { className: "st-step" }, el("b", {}, "1 · Browse & pick"),
            "Open the gallery, find something you want to draw. Its card shows the exact size the game draws it at (e.g. 16×16). Bigger art works too — it gets fitted to that box, and shows up extra crisp."),
          el("div", { className: "st-step" }, el("b", {}, "2 · Draw it your way"),
            "Download the current look as a template, or start fresh in Aseprite, Photoshop, Illustrator — anything. PNGs, animation strips, numbered frame sequences, GIFs, and SVGs all import. There are quick built-in pixel & shape editors here too."),
          el("div", { className: "st-step" }, el("b", {}, "3 · Drop it in & try it"),
            "Drag your file onto the asset's page. Then hit “Try in game” — the real game runs right here with your art, before anyone else sees it."),
          el("div", { className: "st-step" }, el("b", {}, "4 · Publish"),
            "Happy with it? “Publish art” ships your work to everyone playing PlayPen. Publishing only ever touches artwork — you can't break the game, promise. Every publish is saved, so anything can be undone.")
        ),
        el("div", { className: "st-row", style: "margin-top:12px" },
          el("button", {
            className: "st-btn st-primary",
            onclick: () => { localStorage.setItem(SEEN_KEY, "1"); this.view = "gallery"; this.render(); },
          }, "Open the gallery →"))
      )
    );
  }

  // ---- Gallery ----

  private galleryView(): HTMLElement {
    const wrap = el("div", {});
    const filters: [Filter, string][] = [
      ["all", "All"], ["needs-art", "Needs art"], ["custom", "Has art"], ["animated", "Animated"],
    ];
    const searchBox = el("input", {
      className: "st-search", placeholder: "🔍 Search…", value: this.search,
      oninput: (ev: Event) => {
        this.search = (ev.target as HTMLInputElement).value.toLowerCase();
        list.replaceChildren(...this.galleryGroups());
      },
    });
    wrap.append(
      el("div", { className: "st-filters" },
        ...filters.map(([f, label]) => el("button", {
          className: `st-chip ${this.filter === f ? "st-on" : ""}`,
          onclick: () => { this.filter = f; this.render(); },
        }, label)),
        el("span", { className: "st-sep" }, " "),
        ...(["all", ...GROUP_ORDER] as (AssetGroup | "all")[]).map((g) => el("button", {
          className: `st-chip ${this.group === g ? "st-on" : ""}`,
          onclick: () => { this.group = g; this.render(); },
        }, g === "all" ? "Everything" : g)),
        searchBox)
    );
    const list = el("div", {});
    list.append(...this.galleryGroups());
    wrap.append(list);
    return wrap;
  }

  private visibleAssets(): ArtAsset[] {
    return this.assets.filter((a) => {
      if (this.group !== "all" && a.group !== this.group) return false;
      if (this.filter !== "all" && assetStatus(a) !== this.filter) return false;
      if (this.search && !(`${a.label} ${a.sublabel ?? ""} ${a.key}`.toLowerCase().includes(this.search))) return false;
      return true;
    });
  }

  private galleryGroups(): HTMLElement[] {
    const out: HTMLElement[] = [];
    const visible = this.visibleAssets();
    for (const g of GROUP_ORDER) {
      const inGroup = visible.filter((a) => a.group === g);
      if (!inGroup.length) continue;
      const done = inGroup.filter((a) => assetStatus(a) !== "needs-art").length;
      out.push(el("div", { className: "st-grouphead" }, `${g} · ${done}/${inGroup.length} have art`));
      out.push(el("div", { className: "st-grid" }, ...inGroup.map((a) => this.assetCard(a))));
    }
    if (!out.length) out.push(el("p", { className: "st-hint" }, "Nothing matches — try a different filter or search."));
    return out;
  }

  private assetCard(a: ArtAsset): HTMLElement {
    const cv = el("canvas", { className: "st-thumb", width: 56, height: 56 }) as HTMLCanvasElement;
    (cv as unknown as { ppDraw: () => void }).ppDraw = () => {
      const ctx = cv.getContext("2d")!;
      ctx.clearRect(0, 0, 56, 56);
      a.drawCurrent(ctx, 4, 4, 48);
    };
    const status = assetStatus(a);
    const statusLabel = status === "needs-art" ? "needs art" : status === "animated" ? "animated" : "has art";
    return el(
      "div", { className: "st-cardasset", onclick: () => { this.selectedKey = a.key; this.view = "detail"; this.render(); } },
      cv,
      el("span", { className: "st-name" }, a.label),
      el("span", { className: "st-dim" }, `drawn at ${a.drawnW}×${a.drawnH}`),
      el("span", { className: `st-status ${status}` }, statusLabel)
    );
  }

  // ---- Detail ----

  private detailView(a: ArtAsset): HTMLElement {
    const art = a.read();
    const wrap = el("div", {});
    const notes = el("div", {});
    const showNotes = (msgs: string[], errs: string[]) => {
      // Stash too: a successful import re-renders the view, and the artist
      // still needs to see "I fixed your SVG's size" / "this file was
      // rejected" afterwards.
      this.pendingNotes = { key: a.key, notes: msgs, errors: errs };
      notes.replaceChildren(
        ...errs.map((m) => el("div", { className: "st-note st-err" }, `⚠ ${m}`)),
        ...msgs.map((m) => el("div", { className: "st-note" }, m))
      );
    };
    if (this.pendingNotes?.key === a.key) {
      const p = this.pendingNotes;
      notes.replaceChildren(
        ...p.errors.map((m) => el("div", { className: "st-note st-err" }, `⚠ ${m}`)),
        ...p.notes.map((m) => el("div", { className: "st-note" }, m))
      );
      this.pendingNotes = null;
    }

    wrap.append(el("div", { className: "st-row" },
      el("button", { className: "st-btn st-quiet", onclick: () => { this.view = "gallery"; this.render(); } }, "← Back to gallery"),
      el("span", { className: "st-title", style: "font-size:17px" }, a.label),
      el("span", { className: "st-hint" }, a.sublabel ?? "")
    ));

    // Big preview at the in-game box, shown at 3 zooms so stretching and
    // detail are obvious before she ever hits play.
    const zoomRow = el("div", { className: "st-zoomrow" });
    for (const z of [2, 4, 8]) {
      // Two earlier attempts at this both broke on assets whose procedural
      // look deliberately draws OUTSIDE its nominal box — checkpoint's
      // flag reaches ~2x its own declared width, brazier's halo extends
      // a 15px-radius glow around a 16px box (Sean, 2026-08-12, twice).
      // cell=min(w,h) only filled a square corner; a plain cell=max(w,h)
      // SQUARE canvas centered correctly but still clipped brazier's
      // halo, because making the canvas bigger alongside cell scales
      // both together and the extra room cancels out.
      //
      // The fix has to DECOUPLE the two: `cell` sets the content's scale
      // (kept at the box's own larger dimension × z, same "1 logical
      // unit = z screen px" a plain zoom implies) while the CANVAS is
      // made bigger than that and the (cell×cell) square is centered
      // inside it — so extra canvas room actually becomes extra headroom
      // around the content instead of just re-scaling it back down.
      // PAD=2 covers the worst case seen (brazier's halo needs ~1.9x).
      const cell = Math.max(a.drawnW, a.drawnH) * z;
      const PAD = 2;
      const side = cell * PAD;
      const cv = el("canvas", {
        className: "st-previewbig", width: side, height: side,
        style: "max-width:200px;max-height:200px",
        title: `${z}× zoom of the in-game ${a.drawnW}×${a.drawnH} box`,
      }) as HTMLCanvasElement;
      (cv as unknown as { ppDraw: () => void }).ppDraw = () => {
        const ctx = cv.getContext("2d")!;
        ctx.clearRect(0, 0, cv.width, cv.height);
        const current = a.read();
        const uri = this.animFrame(current);
        if (uri) {
          const img = getImage(uri);
          if (img) {
            // Custom art still previews at its TRUE stretched box aspect
            // (matching real in-game rendering exactly, distortion and
            // all), just centered within the padded canvas instead of
            // filling it — the canvas is a viewport, not the box.
            const bw = a.drawnW * z, bh = a.drawnH * z;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, (cv.width - bw) / 2, (cv.height - bh) / 2, bw, bh);
            return;
          }
        }
        a.drawCurrent(ctx, (cv.width - cell) / 2, (cv.height - cell) / 2, cell);
      };
      zoomRow.append(el("div", {}, cv, el("div", { className: "st-hint", style: "text-align:center" }, `${z}×`)));
    }
    wrap.append(el("div", { className: "st-card" },
      el("div", { className: "st-hint" },
        `The game draws this in a ${a.drawnW}×${a.drawnH} box. Any resolution works — art is fitted to the box (higher res = crisper on screen). Match the ${a.drawnW}:${a.drawnH} shape to avoid stretching.`),
      zoomRow));

    // Frames + fps
    const framesCard = el("div", { className: "st-card" });
    const renderFrames = () => {
      const current = a.read();
      framesCard.replaceChildren(
        el("b", {}, current.frames.length > 1 ? `Animation — ${current.frames.length} frames` : current.frames.length === 1 ? "Current art" : "No custom art yet"),
        el("div", { className: "st-frames" },
          ...current.frames.map((uri, i) => {
            const cell = el("div", { className: "st-frame" });
            const cv = el("canvas", { width: 44, height: 44 }) as HTMLCanvasElement;
            const ctx = cv.getContext("2d")!;
            const img = getImage(uri);
            if (img) {
              ctx.imageSmoothingEnabled = false;
              const s = Math.min(44 / img.naturalWidth, 44 / img.naturalHeight);
              ctx.drawImage(img, (44 - img.naturalWidth * s) / 2, (44 - img.naturalHeight * s) / 2,
                img.naturalWidth * s, img.naturalHeight * s);
            }
            cell.append(cv);
            if (current.frames.length > 0) {
              cell.append(el("button", {
                className: "st-framex", title: "Remove this frame",
                onclick: async (ev: Event) => {
                  ev.stopPropagation();
                  const next = current.frames.filter((_, j) => j !== i);
                  await a.write({ ...current, frames: next });
                  this.refresh();
                },
              }, "✕"));
            }
            return cell;
          })),
        current.frames.length > 1 ? el("div", { className: "st-row" },
          el("span", { className: "st-hint" }, "Speed:"),
          el("input", {
            type: "range", min: 1, max: 24, value: current.fps,
            oninput: async (ev: Event) => {
              await a.write({ ...current, fps: Number((ev.target as HTMLInputElement).value) });
            },
          }),
          el("span", { className: "st-hint" }, `${current.fps} frames/sec`)
        ) : el("span", {})
      );
    };
    renderFrames();
    wrap.append(framesCard);

    // Drop zone
    const drop = el("div", { className: "st-drop" },
      el("div", { style: "font-size:26px" }, "⬇"),
      el("div", {}, "Drop art here — or click to browse"),
      el("div", { className: "st-hint" },
        a.animatable
          ? "PNG · SVG · GIF · Aseprite strip (auto-split) · several numbered PNGs = animation frames"
          : "PNG or SVG — this slot is a single image (no animation)")
    );
    const handleFiles = async (files: File[]) => {
      const result = await importFiles(files);
      if (result.stripCandidate && a.animatable) {
        const { uri, count } = result.stripCandidate;
        const dims = await imageSize(uri);
        if (dims && confirm(
          `This image is ${dims.w}×${dims.h} — it looks like an animation strip of ${count} frames of ${dims.h}×${dims.h}.\n\n` +
          `OK = split it into ${count} animation frames\nCancel = keep it as one still image`
        )) {
          result.frames = await sliceStrip(uri, count);
          result.notes.push(`Split into ${count} frames.`);
        }
      }
      showNotes(result.notes, result.errors);
      if (!result.frames.length) return;
      const frames = a.animatable ? result.frames : [result.frames[0]];
      if (!a.animatable && result.frames.length > 1) {
        showNotes([...result.notes, "This slot takes a single image — used the first file."], result.errors);
      }
      await a.write({ ...a.read(), frames, fps: a.read().fps });
      this.dirty = true;
      toast("Art saved to your draft — hit “Try in game” to see it live.");
      this.refresh();
    };
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("st-over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("st-over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("st-over");
      void handleFiles([...(e.dataTransfer?.files ?? [])]);
    });
    drop.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = a.animatable;
      input.accept = "image/png,image/gif,image/webp,image/svg+xml,.svg";
      input.onchange = () => void handleFiles([...(input.files ?? [])]);
      input.click();
    });
    wrap.append(drop, notes);

    // Built-in editors + downloads + revert
    const mult = this.pixelResMult.get(a.key) ?? 1;
    const resSelect = el(
      "select", {
        className: "st-chip",
        title: "Draw at higher resolution for extra detail — the game fits it into the box either way, so a higher resolution just looks crisper on screen",
        onchange: (ev: Event) => this.pixelResMult.set(a.key, Number((ev.target as HTMLSelectElement).value)),
      },
      ...[1, 2, 4].map((m) => el(
        "option", { value: m, selected: mult === m },
        `${m}× (${a.drawnW * m}×${a.drawnH * m}px)`
      ))
    );
    wrap.append(el("div", { className: "st-row", style: "margin-top:12px" },
      resSelect,
      el("button", {
        className: "st-btn", title: "Quick pixel art, right here, at the resolution picked to the left",
        onclick: () => this.openPixelFor(a),
      }, "✏️ Pixel editor"),
      el("button", {
        className: "st-btn", title: "Quick vector shapes, right here — always crisp at any size, no resolution to pick",
        onclick: () => this.openShapesFor(a),
      }, "△ Shape editor"),
      el("span", { className: "st-spacer" }),
      art.frames.length ? el("button", {
        className: "st-btn", onclick: () => void downloadStrip(a.read().frames, a.key.replace(/\W+/g, "-")),
      }, "⬇ Download") : null,
      art.frames.length || art.alt ? el("button", {
        className: "st-btn st-danger",
        onclick: async () => {
          if (!confirm(`Remove the custom art from “${a.label}” and go back to the game's built-in look?`)) return;
          await a.clear();
          this.dirty = true;
          this.refresh();
        },
      }, "Revert to built-in look") : null
    ));

    // Secondary-state slot (open door, unlit brazier, …)
    if (a.altLabel) wrap.append(this.altSlot(a));
    return wrap;
  }

  private altSlot(a: ArtAsset): HTMLElement {
    const card = el("div", { className: "st-card" });
    const notes = el("div", {});
    const render = () => {
      const art = a.read();
      const swatch = el("canvas", { className: "st-frame", width: 44, height: 44 }) as HTMLCanvasElement;
      const sctx = swatch.getContext("2d")!;
      a.drawAlt?.(sctx, 0, 0, 44);
      const drop = el("div", { className: "st-drop", style: "padding:12px" },
        el("div", {}, `⬇ Drop ${a.altLabel!.toLowerCase()} art here — or click`),
        el("div", { className: "st-hint" }, "PNG or SVG — a single still image, no animation"));
      const handleAltFiles = async (files: File[]) => {
        const result = await importFiles(files);
        notes.replaceChildren(
          ...result.errors.map((m) => el("div", { className: "st-note st-err" }, `⚠ ${m}`)),
          ...result.notes.map((m) => el("div", { className: "st-note" }, m))
        );
        if (!result.frames[0]) return;
        await a.write({ ...a.read(), alt: result.frames[0] });
        this.dirty = true;
        toast("Second-look art saved to your draft.");
        this.refresh();
      };
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("st-over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("st-over"));
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        drop.classList.remove("st-over");
        void handleAltFiles([...(e.dataTransfer?.files ?? [])]);
      });
      drop.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/webp,image/svg+xml,.svg";
        input.onchange = () => void handleAltFiles([...(input.files ?? [])]);
        input.click();
      });
      card.replaceChildren(
        el("b", {}, `Second look — ${a.altLabel}`),
        el("p", { className: "st-hint" },
          `This object changes state in-game. The main art above is its normal look; this shows when it's “${a.altLabel!.toLowerCase()}”. Shown below: ${art.alt ? "your custom art for this state" : "the game's built-in look for this state (no custom art yet)"}. Without custom art, the game falls back to its own drawing for that state so players are never misled.`),
        el("div", { className: "st-row" }, swatch),
        drop,
        notes,
        el("div", { className: "st-row" },
          el("button", { className: "st-btn", onclick: () => this.openPixelForAlt(a) }, "✏️ Pixel editor"),
          el("button", { className: "st-btn", onclick: () => this.openShapesForAlt(a) }, "△ Shape editor"),
          art.alt ? el("button", {
            className: "st-btn st-danger",
            onclick: async () => { await a.write({ ...a.read(), alt: undefined }); this.dirty = true; this.refresh(); },
          }, "Revert to built-in look") : el("span", {})
        )
      );
    };
    render();
    return card;
  }

  private openPixelForAlt(a: ArtAsset): void {
    const art = a.read();
    const mult = this.pixelResMult.get(`${a.key}:alt`) ?? 1;
    const size = Math.max(a.drawnW, a.drawnH, 16) * mult;
    const existing = art.alt;
    const hiRes = !!existing && (existing.startsWith("data:image/svg") || (() => {
      const img = getImage(existing);
      return !!img && (img.naturalWidth > size || img.naturalHeight > size);
    })());
    if (hiRes && !confirm(
      `This art is bigger than the pixel editor's ${size}×${size} grid — editing here will flatten it to ${size}×${size} when saved.\n\n` +
      `Your original file on your computer is untouched either way. Continue?`
    )) return;
    const tightSeed = a.drawAlt && rasterizeSeedTight(a.drawAlt, a.drawnW, a.drawnH, size);
    const seed = existing ? [existing] : (tightSeed ? [tightSeed] : []);
    openPixelEditor({
      title: `${a.label} — ${a.altLabel} (${size}×${size})`,
      size,
      frames: seed,
      fps: 6,
      multiFrame: false,
      onSave: (frames) => {
        void a.write({ ...a.read(), alt: frames[0] }).then(() => { this.dirty = true; this.refresh(); });
      },
    });
  }

  private openShapesForAlt(a: ArtAsset): void {
    const art = a.read();
    openSvgEditor({
      title: `${a.label} — ${a.altLabel}`,
      width: a.drawnW,
      height: a.drawnH,
      frames: art.alt ? [art.alt] : [],
      fps: 6,
      multiFrame: false,
      seedDraw: a.drawAlt,
      onSave: (frames) => {
        void a.write({ ...a.read(), alt: frames[0] }).then(() => { this.dirty = true; this.refresh(); });
      },
    });
  }

  // ---- Built-in editors ----

  private openPixelFor(a: ArtAsset): void {
    const art = a.read();
    const size = Math.max(a.drawnW, a.drawnH, 16) * (this.pixelResMult.get(a.key) ?? 1);
    const hiRes = art.frames.some((f) => {
      if (f.startsWith("data:image/svg")) return true;
      const img = getImage(f);
      return !!img && (img.naturalWidth > size || img.naturalHeight > size);
    });
    if (hiRes && !confirm(
      `This art is bigger than the pixel editor's ${size}×${size} grid — editing here will flatten it to ${size}×${size} when saved.\n\n` +
      `Your original file on your computer is untouched either way. Continue?`
    )) return;
    // No custom art yet? Seed the grid from the current in-game look so
    // she's tweaking, never staring at a blank canvas. Cropped tightly to
    // the actual content (rasterizeSeedTight) rather than drawn at the
    // asset's own gallery-thumbnail scale (a big fixed margin meant for
    // card/zoom views) -- that mismatch was the "sprite editor frame and
    // the shapes editor frame are inconsistent" report (Sean, 2026-08-12):
    // the shape editor's seed already crops to content, so this now
    // matches it instead of looking padded and small by comparison.
    const tightSeed = rasterizeSeedTight((ctx, x, y, cell) => a.drawCurrent(ctx, x, y, cell), a.drawnW, a.drawnH, size);
    const seed = art.frames.length
      ? art.frames
      : (tightSeed ? [tightSeed] : []);
    openPixelEditor({
      title: `${a.label} (${size}×${size})`,
      size,
      frames: seed,
      fps: art.fps,
      multiFrame: a.animatable,
      onSave: (frames, fps) => {
        void a.write({ ...a.read(), frames, fps }).then(() => { this.dirty = true; this.refresh(); });
      },
    });
  }

  private openShapesFor(a: ArtAsset): void {
    const art = a.read();
    openSvgEditor({
      title: a.label,
      width: a.drawnW,
      height: a.drawnH,
      frames: art.frames,
      fps: art.fps,
      multiFrame: a.animatable,
      seedDraw: (ctx, x, y, cell) => a.drawCurrent(ctx, x, y, cell),
      onSave: (frames, fps) => {
        void a.write({ ...a.read(), frames, fps }).then(() => { this.dirty = true; this.refresh(); });
      },
    });
  }

  // ---- Actions ----

  private animFrame(art: { frames: string[]; fps: number }): string | null {
    if (!art.frames.length) return null;
    if (art.frames.length === 1) return art.frames[0];
    return art.frames[Math.floor((performance.now() / 1000) * (art.fps || 6)) % art.frames.length];
  }

  private repaintCanvases(): void {
    for (const cv of this.root.querySelectorAll("canvas")) {
      const draw = (cv as unknown as { ppDraw?: () => void }).ppDraw;
      if (draw) draw();
    }
  }

  private downloadSheet(): void {
    const list = this.visibleAssets();
    downloadContactSheet(
      list.map((a) => ({
        label: a.label,
        size: `${a.drawnW}×${a.drawnH}`,
        draw: (ctx, x, y, cell) => a.drawCurrent(ctx, x, y, cell),
      })),
      this.group === "all" ? "all art" : this.group
    );
    toast("Reference sheet downloaded — open it next to your art app.");
  }

  private tryInGame(): void {
    // main.ts closes the studio and resumes the game with the draft content;
    // the floating 🎨 button brings her back.
    window.dispatchEvent(new CustomEvent("pp-studio-close"));
  }

  private async publish(): Promise<void> {
    const pass = localStorage.getItem(PASS_KEY) ?? "";
    if (!confirm(
      "Publish your artwork to everyone playing PlayPen?\n\n" +
      "Only artwork is ever published from the studio — levels and game rules stay exactly as they are. " +
      "Every publish is kept in history, so this can always be undone."
    )) return;
    try {
      const res = await fetch("/api/content", {
        method: "POST",
        headers: { "x-artist-password": pass, "content-type": "application/json" },
        body: JSON.stringify({ files: this.store.allFiles(), note: "art update from the studio" }),
      });
      const data = (await res.json()) as { ok: boolean; id?: string; error?: string; changes?: string[] };
      if (!data.ok) {
        toast(res.status === 401
          ? "The password didn't work — check it with Sean (it may have changed)."
          : `Publish failed: ${data.error ?? "unknown error"}`, false);
        return;
      }
      this.store.markPublished(data.id!);
      this.dirty = false;
      const what = data.changes?.length ? ` (${data.changes.slice(0, 3).join("; ")}${data.changes.length > 3 ? "…" : ""})` : "";
      toast(`🎉 Published! Everyone gets your art on their next load${what}`);
    } catch {
      toast("Couldn't reach the server — are you online? Your work is still saved as a draft here.", false);
    }
  }
}
