// "Which animation from this .aseprite?" — the studio's tag picker. Shows every
// tag as a live, correctly-timed preview so she picks by eye, not by name.
//
// It only asks when it has to. It decides silently when:
//   - the file has no tags (the whole timeline is the only option),
//   - this slot came from the same file last time and that tag still exists
//     (save in Aseprite, drop again → same tag, like Unity's reimport), or
//   - exactly one tag is named after the slot ("open" for a door's Open look).
// Every silent decision is reported back so the studio can say what it did
// and offer "use a different tag".
import { el } from "../editor/forms";
import { timedFrameIndex } from "../engine/renderer";
import {
  choiceFrames, rememberedChoice, tagSequence, tagsMatchingLabel, type AseImport, type AseTag,
} from "./aseprite";

export interface AseChoice {
  /** null = the whole timeline */
  tag: string | null;
  frames: string[];
  durations: number[];
}

export type AutoReason = "remembered" | "matched" | "only";

export interface PickOptions {
  /** Shown in the dialog: what's being filled ("The Player", "Door — Open"). */
  title: string;
  /** The slot takes a single image — the chosen tag's first frame is used. */
  still?: boolean;
  /** This slot's previous source ("file.aseprite#tag"). */
  remembered?: string;
  /** A label to match tag names against (the second look's name). */
  matchLabel?: string;
  /** Always show the dialog (the "use a different tag" path). */
  forceAsk?: boolean;
}

const DIRECTION = ["", "reversed", "ping-pong", "ping-pong, reversed"];

/** Resolve a choice, asking only if needed. null = she cancelled. */
export async function chooseFromAseprite(
  ase: AseImport, opts: PickOptions
): Promise<{ choice: AseChoice; auto: AutoReason | null } | null> {
  const pick = (tag: string | null): AseChoice => ({ tag, ...choiceFrames(ase, tag) });
  if (!ase.tags.length) return { choice: pick(null), auto: "only" };
  if (!opts.forceAsk) {
    const remembered = rememberedChoice(opts.remembered, ase.fileName, ase.tags);
    if (remembered !== undefined) return { choice: pick(remembered), auto: "remembered" };
    if (opts.matchLabel) {
      const matches = tagsMatchingLabel(opts.matchLabel, ase.tags);
      if (matches.length === 1) return { choice: pick(matches[0].name), auto: "matched" };
    }
  }
  const tag = await askForTag(ase, opts);
  return tag === undefined ? null : { choice: pick(tag), auto: null };
}

/** The dialog. Resolves to a tag name, null (whole timeline), or undefined
 *  (cancelled). */
function askForTag(ase: AseImport, opts: PickOptions): Promise<string | null | undefined> {
  return new Promise((resolve) => {
    const images = new Map<string, HTMLImageElement>();
    for (const uri of new Set(ase.frames)) {
      const img = new Image();
      img.src = uri;
      images.set(uri, img);
    }
    const remembered = rememberedChoice(opts.remembered, ase.fileName, ase.tags);
    const suggested = new Set(opts.matchLabel ? tagsMatchingLabel(opts.matchLabel, ase.tags).map((t) => t.name) : []);
    const previews: { cv: HTMLCanvasElement; frames: string[]; durations: number[] }[] = [];

    let raf = 0;
    const close = (result: string | null | undefined) => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(undefined); }
    };

    const option = (tag: AseTag | null) => {
      const seq = tag ? tagSequence(tag) : ase.frames.map((_, i) => i);
      const frames = seq.map((i) => ase.frames[i]);
      const durations = seq.map((i) => ase.durations[i] ?? 100);
      const ms = durations.reduce((a, b) => a + b, 0);
      const cv = el("canvas", {
        width: 96, height: 96,
        style: "width:96px;height:96px;image-rendering:pixelated;border-radius:6px;" +
          "background:repeating-conic-gradient(#221c38 0% 25%, #2a2342 0% 50%) 0 0 / 12px 12px",
      }) as HTMLCanvasElement;
      previews.push({ cv, frames: opts.still ? frames.slice(0, 1) : frames, durations });
      const name = tag ? tag.name : "Whole timeline";
      const isRemembered = tag ? remembered === tag.name : remembered === null;
      const badge = isRemembered ? "last used" : tag && suggested.has(tag.name) ? `matches “${opts.matchLabel}”` : "";
      const detail = opts.still
        ? (frames.length > 1 ? `uses its first frame` : `1 frame`)
        : `${frames.length} frame${frames.length === 1 ? "" : "s"} · ${(ms / 1000).toFixed(ms < 1000 ? 2 : 1)}s` +
          (tag && DIRECTION[tag.direction] ? ` · ${DIRECTION[tag.direction]}` : "");
      return el("button", {
        className: "st-cardasset",
        style: "border:1px solid " + (badge ? "#ffd166" : "#322a4e") + ";color:#ece6f8;font:inherit",
        onclick: () => close(tag ? tag.name : null),
      },
        cv,
        el("div", { className: "st-name", style: "font-weight:600" }, name),
        el("div", { className: "st-dim" }, detail),
        badge ? el("div", { className: "st-status custom" }, badge) : el("span", {}));
    };

    const card = el("div", {
      className: "st-card",
      style: "max-width:760px;width:calc(100% - 40px);max-height:calc(100% - 60px);overflow:auto;margin:0",
    },
      el("div", { className: "st-row", style: "margin:0 0 4px" },
        el("b", { style: "color:#ffd166;font-size:16px" },
          opts.still ? `Which look for ${opts.title}?` : `Which animation for ${opts.title}?`),
        el("span", { className: "st-spacer" }),
        el("button", { className: "st-btn st-quiet", onclick: () => close(undefined) }, "Cancel")),
      el("div", { className: "st-hint", style: "margin-bottom:10px" },
        `“${ase.fileName}” has ${ase.tags.length} tag${ase.tags.length === 1 ? "" : "s"}. ` +
        (opts.still
          ? "This slot is a single still, so the tag's first frame is used."
          : "Previews play at the timing you set in Aseprite. Pick one — dropping an updated copy of this file later re-applies the same tag automatically.")),
      el("div", { className: "st-grid", style: "grid-template-columns:repeat(auto-fill,minmax(150px,1fr))" },
        ...ase.tags.map((t) => option(t)),
        option(null)));

    const overlay = el("div", {
      style: "position:fixed;inset:0;z-index:60;background:rgba(8,6,16,.78);display:flex;" +
        "align-items:center;justify-content:center;font:14px 'Segoe UI', system-ui, sans-serif;color:#ece6f8",
      onclick: (e: Event) => { if (e.target === overlay) close(undefined); },
    }, card);
    document.body.append(overlay);
    window.addEventListener("keydown", onKey, true);

    const tick = () => {
      const now = performance.now();
      for (const p of previews) {
        const i = p.frames.length > 1 ? Math.max(0, timedFrameIndex(p.durations, p.frames.length, now)) : 0;
        const img = images.get(p.frames[i]);
        const c = p.cv.getContext("2d");
        if (!c || !img || !img.complete || !img.naturalWidth) continue;
        c.clearRect(0, 0, 96, 96);
        c.imageSmoothingEnabled = false;
        const s = Math.min(96 / img.naturalWidth, 96 / img.naturalHeight);
        c.drawImage(img, (96 - img.naturalWidth * s) / 2, (96 - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}
