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
import { TILE } from "../engine/tilemap";
import { artBox, buildAssets, assetStatus, GROUP_ORDER, withEditedFrames, type ArtAsset, type AssetGroup } from "./assets";
import { sourceRef, timingFor, type AseImport } from "./aseprite";
import { chooseFromAseprite } from "./asepick";
import { patternPanel } from "./tilepattern";
import { importFiles, sliceStrip, imageSize } from "./importers";
import { downloadFrame, downloadStrip, downloadContactSheet } from "./exporters";
import { openSvgEditor, rasterizeSeedTight } from "./svgeditor";
import { environmentsView, layerSetView, stopEnvironmentPreview, type EnvContext } from "./environments";
import { ensureStudioStyles, loginView, publishScoped, tryInGame, type StudioCredential } from "./shell";

const PASS_KEY = "playpen.artist.password";
const SEEN_KEY = "playpen.artist.welcomed";
/** The artist's credential + login copy; the shell handles the rest. */
const ARTIST: StudioCredential = {
  passKey: PASS_KEY,
  header: "x-artist-password",
  endpoint: "/api/artist",
  title: "🎨 PlayPen Art Studio",
  blurb: "Welcome! This is where all of PlayPen's artwork lives. Enter the studio password Sean gave you to get started.",
};


let active: Studio | null = null;

export function openStudio(root: HTMLElement, store: ContentStore, game: Game): void {
  ensureStudioStyles();
  active = new Studio(root, store, game);
  active.render();
}

export function closeStudio(root: HTMLElement): void {
  active?.dispose();
  root.replaceChildren();
  active = null;
}

type Filter = "all" | "needs-art" | "custom" | "animated";
type View = "login" | "welcome" | "gallery" | "detail" | "environments" | "layerset";

class Studio {
  private assets: ArtAsset[] = [];
  private view: View = "gallery";
  private layerSetId: string | null = null;
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
  /** A tile image whose size fits several pattern layouts, just imported —
   *  the pattern panel asks which one she meant (never guessed). */
  private pendingLayout: { key: string; w: number; h: number } | null = null;
  /** The last .aseprite dropped on an asset this session — lets "use a
   *  different tag" re-pick without asking her to find the file again. */
  private recentAse: { key: string; slot: "main" | "alt"; ase: AseImport } | null = null;

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

  private lastRendered = "";

  render(): void {
    stopEnvironmentPreview(); // never leave a rAF loop drawing into a detached canvas
    // Re-rendering the SAME page (a setting changed, art saved) keeps her
    // scroll position — tweaking a control near the bottom must not jump
    // the page back to the top. Navigating somewhere new starts at the top.
    const here = `${this.view}|${this.selectedKey}|${this.layerSetId}`;
    const prevScroll = here === this.lastRendered
      ? (this.root.querySelector(".st-root") as HTMLElement | null)?.scrollTop ?? 0
      : 0;
    this.lastRendered = here;
    this.root.replaceChildren();
    const shell = el("div", { className: "st-root" }, el("div", { className: "st-shell" }));
    const inner = shell.firstChild as HTMLElement;
    this.root.append(shell);
    if (this.view === "login") return void inner.append(this.loginView());
    inner.append(this.header());
    if (this.view === "welcome") inner.append(this.welcomeView());
    else if (this.view === "environments") inner.append(environmentsView(this.envContext()));
    else if (this.view === "layerset" && this.layerSetId) inner.append(layerSetView(this.envContext(), this.layerSetId));
    else if (this.view === "detail" && this.asset(this.selectedKey)) inner.append(this.detailView(this.asset(this.selectedKey)!));
    else inner.append(this.galleryView());
    this.repaintCanvases();
    if (prevScroll) shell.scrollTop = prevScroll;
  }

  private header(): HTMLElement {
    const pubInfo = this.store.publishedInfo;
    // Sections on the left, actions on the right. Both sections are always
    // reachable from anywhere — there used to be no way back to the gallery
    // except via "How it works", which is a detour through onboarding.
    const inGallery = this.view === "gallery" || this.view === "detail";
    const inEnv = this.view === "environments" || this.view === "layerset";
    const nav = (label: string, title: string, active: boolean, go: () => void) =>
      el("button", {
        className: `st-btn${active ? " st-on" : ""}`, title,
        onclick: () => { go(); this.render(); },
      }, label);
    return el(
      "div", { className: "st-header" },
      el("span", { className: "st-title" }, "🎨 PlayPen Art Studio"),
      nav("🖼 Gallery", "Every drawable thing in the game", inGallery, () => { this.view = "gallery"; }),
      nav("🌄 Environments", "Layered scrolling backdrops that give rooms depth", inEnv, () => {
        this.view = "environments";
        this.layerSetId = null; // top-level nav lands on the set list, not the last set
      }),
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
    return loginView(ARTIST, (online) => {
      this.online = online;
      this.view = localStorage.getItem(SEEN_KEY) ? "gallery" : "welcome";
      this.render();
    });
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
      el("span", { className: "st-dim" }, (() => {
        const b = artBox(a);
        return b.spanX > 1 || b.spanY > 1
          ? `${a.drawnW}×${a.drawnH} tiles · ${b.spanX}×${b.spanY} pattern`
          : `drawn at ${a.drawnW}×${a.drawnH}`;
      })()),
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

    // Tiles: the pattern panel comes first — it decides how big the art is,
    // which everything below (zoom, editors, sizes) follows.
    if (a.pattern) {
      const justImported = this.pendingLayout?.key === a.key ? this.pendingLayout : null;
      wrap.append(patternPanel({
        asset: a,
        content: this.store.content,
        changed: () => this.render(),
        playRoom: (roomId) => this.tryInGame(roomId),
        repeatArtToFill: () => this.repeatArtToFill(a),
        justImported: justImported ? { w: justImported.w, h: justImported.h } : null,
        dismissImport: () => { this.pendingLayout = null; },
      }));
    }
    const box = artBox(a);
    const isPattern = box.spanX > 1 || box.spanY > 1;

    // Big preview at the in-game box, shown at 3 zooms so stretching and
    // detail are obvious before she ever hits play.
    const zoomRow = el("div", { className: "st-zoomrow" });
    for (const z of isPattern ? [1, 2, 4] : [2, 4, 8]) {
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
      const cell = Math.max(box.w, box.h) * z;
      const PAD = isPattern ? 1 : 2; // tiles never draw outside their box
      const side = cell * PAD;
      const cv = el("canvas", {
        className: "st-previewbig", width: side, height: side,
        style: "max-width:200px;max-height:200px",
        title: isPattern
          ? `${z}× zoom of one full copy of the pattern (${box.spanX}×${box.spanY} tiles), assembled from the pieces the game draws`
          : `${z}× zoom of the in-game ${a.drawnW}×${a.drawnH} box`,
      }) as HTMLCanvasElement;
      (cv as unknown as { ppDraw: () => void }).ppDraw = () => {
        const ctx = cv.getContext("2d")!;
        ctx.clearRect(0, 0, cv.width, cv.height);
        if (isPattern && a.pattern) {
          // Through the real per-tile slicing, starting at the world tile
          // whose piece is the image's top-left — so a wrong-sized image
          // shows here exactly as wrong as it would in a room.
          const pt = a.pattern.read();
          a.pattern.drawWorld(ctx, 0, 0, TILE * z, pt.spanX, pt.spanY, pt.offsetX, pt.offsetY);
          return;
        }
        const current = a.read();
        const uri = this.animFrame(current);
        if (uri) {
          const img = getImage(uri);
          if (img) {
            // Custom art still previews at its TRUE stretched box aspect
            // (matching real in-game rendering exactly, distortion and
            // all), just centered within the padded canvas instead of
            // filling it — the canvas is a viewport, not the box.
            const bw = box.w * z, bh = box.h * z;
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
      el("div", { className: "st-hint" }, isPattern
        ? `One copy of your pattern covers ${box.spanX}×${box.spanY} tiles (${box.w}×${box.h} at 1×). Any resolution works — ${box.w * 2}×${box.h * 2} or bigger just looks crisper. Keep the ${box.spanX}:${box.spanY} shape so each tile's piece stays square.`
        : `The game draws this in a ${a.drawnW}×${a.drawnH} box. Any resolution works — art is fitted to the box (higher res = crisper on screen). Match the ${a.drawnW}:${a.drawnH} shape to avoid stretching.`),
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
                  // Keep per-frame timing aligned with the frames that remain.
                  const durations = current.durations?.filter((_, j) => j !== i);
                  await a.write({ ...current, frames: next, durations });
                  this.refresh();
                },
              }, "✕"));
            }
            return cell;
          })),
        current.frames.length > 1 ? (() => {
          // Per-frame timing from Aseprite plays exactly as authored; the
          // slider is the way out to one even speed, and says so.
          const timed = !!current.durations && current.durations.length === current.frames.length;
          const label = el("span", { className: "st-hint" },
            timed ? "timing from Aseprite (each frame as you set it)" : `${current.fps} frames/sec`);
          return el("div", { className: "st-row" },
            el("span", { className: "st-hint" }, "Speed:"),
            el("input", {
              type: "range", min: 1, max: 24, value: current.fps,
              title: timed ? "Moving this switches to one even speed for every frame" : "",
              oninput: async (ev: Event) => {
                const fps = Number((ev.target as HTMLInputElement).value);
                label.textContent = `${fps} frames/sec`;
                await a.write({ ...a.read(), fps, durations: undefined });
              },
            }),
            label);
        })() : el("span", {}),
        this.asepriteRow(a, "main", current.source)
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
          ? "PNG · SVG · GIF · .aseprite (pick a tag) · Aseprite strip (auto-split) · several numbered PNGs = animation frames"
          : "PNG, SVG or .aseprite — this slot is a single image (no animation)")
    );
    const handleFiles = async (files: File[]) => {
      const result = await importFiles(files);
      if (result.aseprite) {
        const said = await this.applyAseprite(a, result.aseprite, "main");
        showNotes([...result.notes, ...(said ?? ["Import cancelled — nothing changed."])], result.errors);
        if (!said) return;
        if (a.pattern) {
          const dims = await imageSize(a.read().frames[0]);
          this.pendingLayout = dims ? { key: a.key, w: dims.w, h: dims.h } : null;
        }
        toast("Art saved to your draft — hit “Try in game” to see it live.");
        this.refresh();
        return;
      }
      if (result.stripCandidate && a.animatable) {
        const { uri, count } = result.stripCandidate;
        const dims = await imageSize(uri);
        if (dims && confirm(
          `This image is ${dims.w}×${dims.h} — it looks like an animation strip of ${count} frames of ${dims.h}×${dims.h}.\n\n` +
          `OK = split it into ${count} animation frames\nCancel = keep it as one still image` +
          (a.pattern ? " (e.g. a wide pattern spread across several tiles — you'll be asked next)" : "")
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
      await a.write({ ...a.read(), frames, fps: a.read().fps, durations: undefined, source: undefined });
      this.dirty = true;
      if (a.pattern) {
        // A 32×32 image on a 16×16 tile could be extra detail OR a 2×2
        // pattern — ambiguous by nature, so ask instead of guessing.
        const dims = await imageSize(frames[0]);
        this.pendingLayout = dims ? { key: a.key, w: dims.w, h: dims.h } : null;
      }
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
      input.accept = "image/png,image/gif,image/webp,image/svg+xml,.svg,.aseprite,.ase";
      input.onchange = () => void handleFiles([...(input.files ?? [])]);
      input.click();
    });
    wrap.append(drop, notes);

    // Built-in editors + downloads + revert
    const mults = [1, 2, 4].filter((m) => m === 1 || Math.max(box.w, box.h) * m <= 128);
    const mult = mults.includes(this.pixelResMult.get(a.key) ?? 1) ? (this.pixelResMult.get(a.key) ?? 1) : 1;
    const resSelect = el(
      "select", {
        className: "st-chip",
        title: "Draw at higher resolution for extra detail — the game fits it into the box either way, so a higher resolution just looks crisper on screen",
        onchange: (ev: Event) => this.pixelResMult.set(a.key, Number((ev.target as HTMLSelectElement).value)),
      },
      ...mults.map((m) => el(
        "option", { value: m, selected: mult === m },
        `${m}× (${box.w * m}×${box.h * m}px)`
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

  /**
   * Route a dropped .aseprite into one slot: pick the tag (silently when it
   * safely can — see asepick.ts), carry Aseprite's timing across, and record
   * the file#tag so dropping an updated copy re-applies it. Returns what to
   * tell her, or null if she cancelled.
   */
  private async applyAseprite(
    a: ArtAsset, ase: AseImport, slot: "main" | "alt", forceAsk = false
  ): Promise<string[] | null> {
    const art = a.read();
    const still = slot === "alt" || !a.animatable;
    const res = await chooseFromAseprite(ase, {
      title: slot === "alt" ? `${a.label} — ${a.altLabel}` : a.label,
      still,
      remembered: slot === "alt" ? art.altSource : art.source,
      matchLabel: slot === "alt" ? a.altLabel : undefined,
      forceAsk,
    });
    if (!res) return null;
    const { choice, auto } = res;
    const ref = sourceRef(ase.fileName, choice.tag);
    const said: string[] = [];
    const name = choice.tag === null ? "the whole timeline" : `the “${choice.tag}” tag`;
    if (auto === "remembered") said.push(`Re-imported ${name} from “${ase.fileName}” — same as last time.`);
    else if (auto === "matched") said.push(`Used ${name} — it matches the ${a.altLabel} look.`);
    else if (auto === "only") {
      if (ase.frames.length > 1) said.push(`“${ase.fileName}” has no tags, so the whole timeline was used.`);
    } else said.push(`Using ${name} from “${ase.fileName}”.`);

    if (slot === "alt") {
      await a.write({ ...a.read(), alt: choice.frames[0], altSource: ref });
      if (choice.frames.length > 1) said.push("This look is a single still, so its first frame was used.");
    } else if (still) {
      await a.write({ ...a.read(), frames: [choice.frames[0]], durations: undefined, source: ref });
      if (choice.frames.length > 1) said.push("This slot takes a single image, so the first frame was used.");
    } else {
      const timing = timingFor(choice.durations);
      await a.write({ ...a.read(), frames: choice.frames, fps: timing.fps, durations: timing.durations, source: ref });
      if (timing.durations) said.push("Kept your per-frame timing from Aseprite — every frame plays for exactly as long as you set it.");
      else if (choice.frames.length > 1) said.push(`Plays at ${timing.fps} frames/sec, as set in Aseprite.`);
    }
    this.dirty = true;
    this.recentAse = { key: a.key, slot, ase };
    return said;
  }

  /** Where this slot's art came from, plus "use a different tag" while the
   *  file is still in hand this session. */
  private asepriteRow(a: ArtAsset, slot: "main" | "alt", source: string | undefined): HTMLElement {
    const recent = this.recentAse && this.recentAse.key === a.key && this.recentAse.slot === slot
      ? this.recentAse.ase : null;
    if (!source && !recent) return el("span", {});
    return el("div", { className: "st-row" },
      source ? el("span", { className: "st-hint" },
        `From ${source.replace("#", " → tag ")}. Save it in Aseprite and drop it here again to update — the same tag is re-applied.`) : el("span", {}),
      recent && recent.tags.length ? el("button", {
        className: "st-btn",
        onclick: async () => {
          const said = await this.applyAseprite(a, recent, slot, true);
          if (!said) return;
          toast(said[0]);
          this.refresh();
        },
      }, "Use a different tag…") : el("span", {}));
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
        el("div", { className: "st-hint" }, "PNG, SVG or .aseprite — a single still image, no animation"));
      const handleAltFiles = async (files: File[]) => {
        const result = await importFiles(files);
        const said = result.aseprite ? await this.applyAseprite(a, result.aseprite, "alt") : [];
        notes.replaceChildren(
          ...result.errors.map((m) => el("div", { className: "st-note st-err" }, `⚠ ${m}`)),
          ...[...result.notes, ...(said ?? ["Import cancelled — nothing changed."])].map((m) => el("div", { className: "st-note" }, m))
        );
        if (result.aseprite) {
          if (!said) return;
          // This slot re-renders on save, so say which tag was used in the
          // toast — especially when it was picked automatically.
          toast(`${said[0]} Saved to your draft.`);
          this.refresh();
          return;
        }
        if (!result.frames[0]) return;
        await a.write({ ...a.read(), alt: result.frames[0], altSource: undefined });
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
        input.accept = "image/png,image/webp,image/svg+xml,.svg,.aseprite,.ase";
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
        this.asepriteRow(a, "alt", art.altSource),
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
    const box = artBox(a);
    const isPattern = box.spanX > 1 || box.spanY > 1;
    if (a.pattern && isPattern) return this.openPixelForPattern(a);
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
      // Tiles repeat edge to edge in every room — show that while painting.
      tiledPreview: !!a.pattern,
      onSave: (frames, fps) => {
        void a.write(withEditedFrames(a.read(), frames, fps)).then(() => { this.dirty = true; this.refresh(); });
      },
    });
  }

  /** Pixel editor for a pattern tile: a grid the size of one full copy of
   *  the pattern, gold guides where each in-game tile's piece falls, and a
   *  preview that repeats it the way rooms will. */
  private openPixelForPattern(a: ArtAsset): void {
    const art = a.read();
    const box = artBox(a);
    const mult = this.pixelResMult.get(a.key) ?? 1;
    const GW = box.w * mult, GH = box.h * mult;
    const hiRes = art.frames.some((f) => {
      if (f.startsWith("data:image/svg")) return true;
      const img = getImage(f);
      return !!img && (img.naturalWidth > GW || img.naturalHeight > GH);
    });
    if (hiRes && !confirm(
      `This art is bigger than the pixel editor's ${GW}×${GH} grid — editing here will flatten it to ${GW}×${GH} when saved.\n\n` +
      `Tip: pick a higher resolution next to the editor button first.\n` +
      `Your original file on your computer is untouched either way. Continue?`
    )) return;
    let seed = art.frames;
    if (!seed.length) {
      // Start from the built-in look repeated over the whole block.
      const cv = document.createElement("canvas");
      cv.width = GW;
      cv.height = GH;
      a.pattern!.drawProceduralBlock(cv.getContext("2d")!, 0, 0, TILE * mult);
      seed = [cv.toDataURL("image/png")];
    }
    openPixelEditor({
      title: `${a.label} — ${box.spanX}×${box.spanY} pattern (${GW}×${GH})`,
      width: GW,
      height: GH,
      frames: seed,
      fps: art.fps,
      multiFrame: a.animatable,
      tileLines: { everyX: TILE * mult, everyY: TILE * mult },
      tiledPreview: true,
      note: `This canvas is one full copy of the pattern. The gold dashed lines show where each 16×16 tile's piece begins — anything you paint crosses into the neighbouring tile in the game. The preview on the right repeats it like a wall does.`,
      onSave: (frames, fps) => {
        void a.write(withEditedFrames(a.read(), frames, fps)).then(() => { this.dirty = true; this.refresh(); });
      },
    });
  }

  private openShapesFor(a: ArtAsset): void {
    const art = a.read();
    const box = artBox(a);
    const isPattern = !!a.pattern && (box.spanX > 1 || box.spanY > 1);
    openSvgEditor({
      title: isPattern ? `${a.label} — ${box.spanX}×${box.spanY} pattern` : a.label,
      width: box.w,
      height: box.h,
      frames: art.frames,
      fps: art.fps,
      multiFrame: a.animatable,
      seedDraw: isPattern && !art.frames.length
        // Built-in look repeated over the whole block, fitted into the
        // square cell the vectorizer hands over (centered, like drawCurrent).
        ? (ctx, x, y, cell) => {
          const tilePx = cell / Math.max(box.spanX, box.spanY);
          a.pattern!.drawProceduralBlock(ctx,
            x + (cell - tilePx * box.spanX) / 2, y + (cell - tilePx * box.spanY) / 2, tilePx);
        }
        : (ctx, x, y, cell) => a.drawCurrent(ctx, x, y, cell),
      tileLines: isPattern ? { everyX: TILE, everyY: TILE } : undefined,
      tiledPreview: !!a.pattern,
      note: isPattern
        ? "This canvas is one full copy of the pattern. Gold dashed lines = where each 16×16 tile's piece begins. The preview repeats it like a wall does."
        : undefined,
      onSave: (frames, fps) => {
        void a.write(withEditedFrames(a.read(), frames, fps)).then(() => { this.dirty = true; this.refresh(); });
      },
    });
  }

  /** Rebuild every frame as the current image repeated across the pattern
   *  block, at the image's own resolution — turns a one-tile image into a
   *  full-size pattern she can then vary piece by piece. */
  private async repeatArtToFill(a: ArtAsset): Promise<void> {
    const art = a.read();
    const box = artBox(a);
    const out: string[] = [];
    for (const uri of art.frames) {
      const img = await new Promise<HTMLImageElement | null>((res) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => res(null);
        i.src = uri;
      });
      if (!img) return void toast("Couldn't read the current art to repeat it.", false);
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth * box.spanX;
      cv.height = img.naturalHeight * box.spanY;
      const g = cv.getContext("2d")!;
      g.imageSmoothingEnabled = false;
      for (let r = 0; r < box.spanY; r++) {
        for (let c = 0; c < box.spanX; c++) g.drawImage(img, c * img.naturalWidth, r * img.naturalHeight);
      }
      out.push(cv.toDataURL("image/png"));
    }
    await a.write({ ...art, frames: out });
    this.dirty = true;
    toast(`Your art now fills the whole ${box.spanX}×${box.spanY} pattern — it looks the same in-game until you change a piece.`);
    this.refresh();
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

  private tryInGame(roomId?: string): void {
    tryInGame(roomId);
  }

  private envContext(): EnvContext {
    return {
      store: this.store,
      refresh: () => this.render(),
      markDirty: () => { this.dirty = true; },
      playRoom: (roomId) => this.tryInGame(roomId),
      open: (setId) => {
        this.layerSetId = setId;
        this.view = setId ? "layerset" : "environments";
        this.render();
      },
      back: () => { this.view = "gallery"; this.render(); },
    };
  }

  private async publish(): Promise<void> {
    const ok = await publishScoped(ARTIST, this.store, {
      confirm:
        "Publish your artwork to everyone playing PlayPen?\n\n" +
        "Only artwork is ever published from the studio — levels and game rules stay exactly as they are. " +
        "Every publish is kept in history, so this can always be undone.",
      note: "art update from the studio",
      what: "art",
    });
    if (ok) this.dirty = false;
  }
}
