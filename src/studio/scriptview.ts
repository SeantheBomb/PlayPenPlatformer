// Writers Studio — the Master Script page. The whole campaign as one
// screenplay, in play order: generated stage directions for what the game
// does, the writer's lines in the dialogue column, a storyboard frame for
// each scene and each meeting, and the branches (pair scenes, send-offs)
// as branch blocks, IF-HELPED / IF-NOT alternates and story threads in the
// margin. The model (what beats exist, their stable keys, threads) is
// script.ts; this file only draws it and routes edits back to the same
// content fields the other studio pages edit — nothing here is a second copy
// of the game's words.
import type { Content, RoomEntity, ScriptDoc, TauntDef, WardenEmotion } from "../data/types";
import { el } from "../editor/forms";
import { drawWardenPortrait } from "../engine/renderer";
import { bannerPreview, dialogPreview, lintStrip, npcPortraitDrawer } from "./linepreview";
import {
  buildScript, continuityFlags, diffSignature, readTarget, signatureOf, writeTarget,
  type Beat, type BeatTarget, type ScriptModel, type ScriptSignature, type StructFlag,
} from "./script";
import { closeUp, recipeCard, wideShot } from "./storyboard";
import { lintLine, type LintFlag } from "./voice";
import { EMOTIONS } from "./warden";
import type { WriterContext } from "./writers";

const SEEN_KEY = "playpen.writer.scriptSeen";
const BOARDS_KEY = "playpen.writer.scriptBoards";

/** Page state that survives re-renders for the session. */
const ui = {
  /** null = every branch; else the npcIds helped on the run being read. */
  lens: null as Set<string> | null,
  selected: "",
  /** Shared Warden pools expanded, per scene instance. */
  openShared: new Set<string>(),
  /** Keys edited this session (the gutter's "edited" marker). */
  edited: new Set<string>(),
};

const readBoards = () => { try { return localStorage.getItem(BOARDS_KEY) !== "0"; } catch { return true; } };
const readSeen = (): ScriptSignature | null => {
  try { const s = localStorage.getItem(SEEN_KEY); return s ? JSON.parse(s) as ScriptSignature : null; } catch { return null; }
};
const writeSeen = (s: ScriptSignature) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* private mode */ } };

let fontsLoaded = false;
function ensureScriptFont(): void {
  if (fontsLoaded) return;
  fontsLoaded = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400&display=swap";
  document.head.append(link);
}

interface PageCtx {
  ctx: WriterContext;
  content: Content;
  script: ScriptDoc;
  boards: boolean;
  prev: ScriptSignature | null;
  extraFlags: Map<string, StructFlag[]>;
  saveScript: () => void;
  /** Persist whichever file a target lives in. */
  saveTarget: (t: BeatTarget) => void;
}

export function scriptView(ctx: WriterContext): HTMLElement {
  ensureScriptFont();
  closeInspector(); // a re-render detached the old one
  const content = ctx.store.content;
  setCapsNames(content);
  const script = content.script;
  const full = buildScript(content, null);
  const model = ui.lens ? buildScript(content, ui.lens) : full;
  const boards = readBoards();

  // What changed since this writer last looked (kept per viewer).
  const prev = readSeen();
  const now = signatureOf(full);
  if (!prev) writeSeen(now);
  const changes = diffSignature(prev, now);

  let scriptTimer = 0;
  const saveScript = () => {
    clearTimeout(scriptTimer);
    scriptTimer = window.setTimeout(() => void ctx.save("script.json", script), 400);
  };
  const saveTarget = (t: BeatTarget) => {
    if (t.kind === "taunt") void ctx.save("taunts.json", content.taunts);
    else void ctx.save(`rooms/${t.roomId}.json`, content.rooms[t.roomId]);
  };

  // A resident now first met somewhere else: flag their first line there.
  const extraFlags = new Map<string, StructFlag[]>();
  for (const fm of changes.firstMeetMoved) {
    const scene = full.scenes.find((s) => s.roomId === fm.to);
    const ask = scene?.beats.find((b) => b.npcId === fm.npcId && b.gutter === "FIRST TALK");
    if (ask?.key) extraFlags.set(ask.key, [{ level: "warn", text:
      `This is now where #67 first meets ${ask.cue} (it used to be ${content.rooms[fm.from]?.name ?? fm.from}) — does this line still introduce them?` }]);
  }

  const pc: PageCtx = { ctx, content, script, boards, prev, extraFlags, saveScript, saveTarget };
  const page = el("div", { className: "ms-page" });
  page.append(changeBanner(pc, full, changes));
  const tray = unplacedTray(pc, full);
  const body = el("div", { className: "ms-body" });
  body.append(navColumn(pc, model, full));
  const main = el("div", { className: "ms-main" });
  if (tray) main.append(tray);
  main.append(paper(pc, model));
  body.append(main);
  page.append(body);
  return page;
}

// ---- The "since you last looked" banner ----

function changeBanner(pc: PageCtx, full: ScriptModel, ch: ReturnType<typeof diffSignature>): HTMLElement {
  const name = (id: string) => pc.content.rooms[id]?.name ?? id;
  const bits: string[] = [];
  if (ch.moved.length) bits.push(`Moved: ${ch.moved.map((m) => `${name(m.roomId)} (scene ${m.from} → ${m.to})`).join(", ")}.`);
  if (ch.added.length) bits.push(`New in the campaign: ${ch.added.map(name).join(", ")}.`);
  if (ch.removed.length) bits.push(`Taken out of the campaign: ${ch.removed.map(name).join(", ")}.`);
  if (ch.firstMeetMoved.length) bits.push(`Now met somewhere new: ${ch.firstMeetMoved.map((f) => {
    const nm = full.threads.find((t) => t.npcId === f.npcId)?.name ?? f.npcId;
    return `${nm} (${name(f.from)} → ${name(f.to)})`;
  }).join(", ")} — their first line there is flagged.`);
  if (!bits.length) return el("span", {});
  return el("div", { className: "ms-banner", role: "status" },
    el("div", { style: "flex:1 1 420px" },
      el("b", { style: "color:#ffd166;font-size:15px;display:block;margin-bottom:4px" }, "The campaign changed since you last looked"),
      el("span", {}, bits.join(" ") + " Every line went with its game event — nothing you wrote moved or was lost. Lines that may read differently now are flagged.")),
    el("button", { className: "st-btn", onclick: () => { writeSeen(signatureOf(full)); pc.ctx.render(); } }, "Got it"));
}

// ---- Lines without a place ----

function unplacedTray(pc: PageCtx, full: ScriptModel): HTMLElement | null {
  const lost = Object.entries(pc.script.lines ?? {}).filter(([k, v]) => !full.lineKeys.has(k) && v.text?.trim());
  if (!lost.length) return null;
  // Rehoming targets: every line in the campaign, the same resident first.
  const lines: Beat[] = [];
  const sceneOf = new Map<string, string>();
  for (const s of full.scenes) {
    const walk = (bs: Beat[]) => bs.forEach((b) => {
      if (b.kind === "line" && b.key) { lines.push(b); sceneOf.set(b.key, s.name); }
      b.columns?.forEach((c) => walk(c.beats));
    });
    walk(s.beats);
  }
  const box = el("section", { className: "ms-tray", "aria-label": "Lines without a place" },
    el("b", { style: "color:#ffd166;font-size:15px" }, "Lines without a place"),
    el("div", { className: "st-hint", style: "margin:4px 0 8px" },
      "The game no longer has a moment for these — usually because Sean moved or removed what they belonged to — so they'd never play. " +
      "They're kept here; nothing you wrote is deleted unless you say so."));
  for (const [key, entry] of lost) {
    const sel = el("select", {},
      el("option", { value: "" }, "Give it to…"),
      ...lines
        .slice()
        .sort((a, b) => Number(b.npcId === entry.npcId) - Number(a.npcId === entry.npcId))
        .map((b) => el("option", { value: b.key! }, `${b.cue} · ${b.gutter} · ${sceneOf.get(b.key!)}`))) as HTMLSelectElement;
    box.append(el("div", { className: "ms-trayrow" },
      el("div", { style: "flex:1 1 360px" },
        el("div", { className: "st-dim", style: "font-weight:700;letter-spacing:.05em" }, entry.label.toUpperCase()),
        el("div", { className: "ms-mono" }, entry.text)),
      el("div", { className: "st-row wr-form", style: "margin:0" },
        sel,
        el("button", { className: "st-btn", onclick: () => {
          const target = lines.find((b) => b.key === sel.value);
          if (!target?.target) return;
          const cur = readTarget(pc.content, target.target);
          if (cur.trim() && !confirm(`Replace what's there now?\n\n“${cur}”\n\nwith\n\n“${entry.text}”`)) return;
          writeTarget(pc.content, target.target, entry.text);
          pc.saveTarget(target.target);
          delete pc.script.lines[key];
          pc.script.lines[target.key!] = { ...entry, label: ledgerLabel(target, sceneOf.get(target.key!) ?? ""), roomId: roomOf(target.target) };
          void pc.ctx.save("script.json", pc.script).then(() => pc.ctx.render());
        } }, "Move it there"),
        el("button", { className: "st-btn st-danger", onclick: () => {
          if (!confirm(`Discard this line for good?\n\n“${entry.text}”`)) return;
          delete pc.script.lines[key];
          void pc.ctx.save("script.json", pc.script).then(() => pc.ctx.render());
        } }, "Discard"))));
  }
  return box;
}

const roomOf = (t: BeatTarget) => (t.kind === "taunt" ? undefined : t.roomId);

/** Screenplay caps for generated text — except residents' names, which are
 *  their identity (XxMARLAxX, TOBY.EXE) and must read exactly as written. */
let capsNames: RegExp | null = null;
function caps(text: string): string {
  if (!capsNames) return text.toUpperCase();
  return text.split(capsNames).map((part, i) => (i % 2 ? part : part.toUpperCase())).join("");
}
function setCapsNames(content: Content): void {
  const names = new Set<string>();
  for (const room of Object.values(content.rooms)) for (const e of room.entities) if (e.type === "npc" && e.name) names.add(e.name);
  const esc = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  capsNames = esc.length ? new RegExp(`(${esc.join("|")})`) : null;
}
const ledgerLabel = (b: Beat, scene: string) => `${b.cue} · ${b.gutter} · ${scene}`;

// ---- Left column: scenes, the run being read, threads, frames ----

function countLines(pc: PageCtx, beats: Beat[]): { lines: number; empty: number } {
  let lines = 0, empty = 0;
  const walk = (bs: Beat[]) => bs.forEach((b) => {
    if (b.kind === "line" && b.target) { lines++; if (!readTarget(pc.content, b.target).trim()) empty++; }
    if (b.kind === "warden" && b.target?.kind === "taunt") {
      const t = pc.content.taunts.find((x) => x.id === (b.target as { tauntId: string }).tauntId);
      for (const l of t?.lines ?? []) { lines++; if (!l.trim()) empty++; }
    }
    b.columns?.forEach((c) => walk(c.beats));
  });
  walk(beats);
  return { lines, empty };
}

function navColumn(pc: PageCtx, model: ScriptModel, full: ScriptModel): HTMLElement {
  const nav = el("nav", { className: "ms-nav", "aria-label": "Scenes" });
  let totalLines = 0, totalEmpty = 0;
  const list = el("div", { style: "display:flex;flex-direction:column;gap:4px" });
  for (const s of model.scenes) {
    const n = countLines(pc, s.beats);
    totalLines += n.lines; totalEmpty += n.empty;
    const was = pc.prev ? pc.prev.order.indexOf(s.roomId) + 1 : 0;
    const note = [`${n.lines} lines`, n.empty ? `${n.empty} empty` : "", was && was !== s.num ? `was ${was}` : "", s.inDemo ? "demo" : ""]
      .filter(Boolean).join(" · ");
    list.append(el("a", { className: "ms-navitem", href: `#ms-scene-${s.roomId}`,
      onclick: (e: Event) => {
        e.preventDefault();
        document.getElementById(`ms-scene-${s.roomId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      } },
      el("span", { className: "ms-mono", style: "color:#ffd166;min-width:20px" }, String(s.num)),
      el("span", { style: "flex:1;display:flex;flex-direction:column;gap:1px" },
        el("span", {}, s.name), el("span", { className: "st-dim" }, note))));
  }
  nav.append(
    el("div", { className: "ms-navhead" }, "THE SCRIPT"),
    el("div", { style: "font-size:13px;margin-bottom:6px" },
      `${model.scenes.length} levels · ${totalLines} lines${ui.lens ? " on this run" : ""}${totalEmpty ? ` · ${totalEmpty} empty` : ""}`),
    list);

  // Read the run where…
  const helpable = full.threads.map((t) => t.npcId);
  const setLens = (l: Set<string> | null) => { ui.lens = l; pc.ctx.render(); };
  const allOn = !!ui.lens && helpable.every((n) => ui.lens!.has(n));
  const allOff = !!ui.lens && helpable.every((n) => !ui.lens!.has(n));
  const seg = (label: string, on: boolean, go: () => void) =>
    el("button", { className: `ms-seg${on ? " on" : ""}`, "aria-pressed": on ? "true" : "false", onclick: go }, label);
  nav.append(
    el("div", { className: "ms-navhead" }, "READ THE RUN WHERE…"),
    el("div", { className: "ms-segs", role: "group" },
      seg("Every branch", !ui.lens, () => setLens(null)),
      seg("Helped everyone", allOn, () => setLens(new Set(helpable))),
      seg("Helped no one", allOff, () => setLens(new Set()))),
    el("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px" },
      ...full.threads.map((t) => {
        const on = !ui.lens || ui.lens.has(t.npcId);
        return el("button", {
          className: `ms-chip${ui.lens ? (on ? " on" : " off") : ""}`, "aria-pressed": ui.lens && on ? "true" : "false",
          title: ui.lens ? (on ? `Read the run where ${t.name} wasn't helped` : `Read the run where ${t.name} was helped`) : `Read a run without ${t.name}`,
          onclick: () => {
            const l = new Set(ui.lens ?? helpable);
            if (l.has(t.npcId)) l.delete(t.npcId); else l.add(t.npcId);
            setLens(l);
          },
        }, el("span", { className: "ms-swatch", style: `background:${t.color}` }), t.name);
      })),
    el("div", { className: "st-hint" }, ui.lens
      ? `Reading one run: ${ui.lens.size ? `#67 helped ${full.threads.filter((t) => ui.lens!.has(t.npcId)).map((t) => t.name).join(", ")}` : "#67 helped no one"}. ` +
        "What doesn't happen collapses to a dashed placeholder, and the frames drop anyone who isn't there."
      : "Every branch at once. Shaded blocks only happen on some runs. Tap a name to read a run without them."));

  // Threads legend.
  nav.append(el("div", { className: "ms-navhead" }, "STORY THREADS"));
  for (const t of full.threads) {
    const shown = model.threads.find((x) => x.npcId === t.npcId);
    const rooms = [...new Set(t.deps.map((d) => pc.content.rooms[d.roomId]?.name ?? d.roomId))];
    const early = t.deps.some((d) => d.early);
    const text = !shown ? "Not helped on this run — no thread."
      : early ? `Something pays off before #67 can have helped them — see the red dot.`
      : `Helped in ${t.startRoom ? pc.content.rooms[t.startRoom]?.name : "?"} → ${rooms.length ? rooms.join(", ") : "nothing pays it off yet"}`;
    nav.append(el("div", { className: "ms-thread" },
      el("span", { className: "ms-threadbar", style: `background:${t.color};${shown ? "" : "opacity:.3"}` }),
      el("span", {}, el("b", { style: "font-weight:600" }, t.name), el("br", {}),
        el("span", { style: `color:${early && shown ? "#ff9b8f" : shown ? "#c9c1e0" : "#8f86a8"}` }, text))));
  }
  nav.append(el("div", { className: "st-hint" }, "Each line in the margin starts where #67 helps them and runs to every beat that depends on it."));

  // Frames on / off.
  nav.append(
    el("div", { className: "ms-navhead" }, "STORYBOARD"),
    el("div", { className: "ms-segs", role: "group" },
      seg("Frames on", pc.boards, () => { try { localStorage.setItem(BOARDS_KEY, "1"); } catch { /* */ } pc.ctx.render(); }),
      seg("Script only", !pc.boards, () => { try { localStorage.setItem(BOARDS_KEY, "0"); } catch { /* */ } pc.ctx.render(); })),
    el("div", { className: "st-hint" }, "Frames are drawn by the game itself from each level, so they follow Sean's changes."));
  return nav;
}

// ---- The paper ----

interface Rails {
  /** key -> reading position of the beat element that holds it. */
  pos: Map<string, number>;
  next: number;
  els: { node: HTMLElement; p: number }[];
}

function paper(pc: PageCtx, model: ScriptModel): HTMLElement {
  const art = el("article", { className: "ms-paper", "aria-label": "The master script" });
  art.append(el("div", { className: "ms-titleblock" },
    el("div", { style: "font-weight:700;font-size:20px;letter-spacing:.12em" }, "PLAYPEN"),
    el("div", {}, "the master script"),
    el("div", { className: "ms-sans", style: "font-size:12px;color:#5b5470;margin-top:4px" },
      "Built live from the game. Capitals are what happens; everything in the dialogue column is yours to write.")));
  const rails: Rails = { pos: new Map(), next: 0, els: [] };
  const helpedForFrames = ui.lens ?? new Set(model.threads.map((t) => t.npcId));
  const pin = (node: HTMLElement, p: number) => { rails.els.push({ node, p }); return node; };

  for (const s of model.scenes) {
    const section = el("section", { id: `ms-scene-${s.roomId}`, className: "ms-scene", "aria-label": `Scene ${s.num}: ${s.name}` });
    const head = pin(el("div", { className: "ms-rowwrap" }), rails.next - 0.5);
    const was = pc.prev ? pc.prev.order.indexOf(s.roomId) + 1 : 0;
    const n = countLines(pc, s.beats);
    const noteText = pc.script.notes?.[s.roomId];
    head.append(el("div", { className: "ms-scenehead" },
      el("h2", {}, `SCENE ${s.num} — ${caps(s.name)}`),
      el("div", { className: "ms-sans ms-scenemeta" },
        was && was !== s.num ? el("span", { className: "ms-tag" }, `was scene ${was}`) : null,
        s.inDemo ? el("span", { className: "ms-tag ms-tagdemo" }, "in the demo") : null,
        el("span", {}, `${n.lines} lines${n.empty ? ` · ${n.empty} empty` : ""}`),
        noteText === undefined ? el("button", { className: "ms-small", onclick: () => { pc.script.notes[s.roomId] = ""; void pc.ctx.save("script.json", pc.script).then(() => pc.ctx.render()); } }, "+ Writer's note") : null,
        el("button", { className: "ms-small", onclick: () => pc.ctx.playRoom(s.roomId) }, "▶ Play this scene"))));
    if (pc.boards) {
      head.append(el("figure", { className: "ms-widefig" },
        wideShot(pc.content, s.roomId, helpedForFrames),
        el("figcaption", { className: "ms-sans" },
          el("b", {}, `SHOT ${s.num}A · WIDE — ${caps(s.name)}${s.cast.length ? " · " + s.cast.join(", ") : ""}`),
          el("span", {}, "drawn from the level"))));
    }
    if (noteText !== undefined) {
      const ta = el("textarea", { rows: 2, placeholder: "Continuity, ideas, questions for Sean…", value: noteText }) as HTMLTextAreaElement;
      ta.addEventListener("input", () => { pc.script.notes[s.roomId] = ta.value; pc.saveScript(); });
      head.append(el("div", { className: "ms-wnote ms-sans" },
        el("div", { style: "display:flex;justify-content:space-between;gap:8px;align-items:center" },
          el("b", { style: "font-size:11px;letter-spacing:.06em" }, "WRITER'S NOTE — STAYS IN THE STUDIO, NEVER IN THE GAME"),
          el("button", { className: "ms-small", onclick: () => { delete pc.script.notes[s.roomId]; void pc.ctx.save("script.json", pc.script).then(() => pc.ctx.render()); } }, "Remove")),
        ta));
    }
    section.append(head);
    let shot = 0;
    for (const b of s.beats) {
      const p = rails.next++;
      const node = pin(renderBeat(pc, b, s.roomId, s.name, () => `SHOT ${s.num}${String.fromCharCode(66 + shot++)}`, helpedForFrames), p);
      const mark = (bs: Beat[]) => bs.forEach((x) => { if (x.key) rails.pos.set(x.key, p); x.columns?.forEach((c) => mark(c.beats)); });
      mark([b]);
      section.append(node);
    }
    section.append(pin(el("div", { className: "ms-rowwrap ms-gap" }), rails.next - 0.5));
    art.append(section);
  }
  if (model.ending.length) {
    const end = el("section", { className: "ms-scene", "aria-label": "The end" });
    for (const b of model.ending) {
      const p = rails.next++;
      if (b.key) rails.pos.set(b.key, p);
      end.append(pin(renderBeat(pc, b, "", "The end", () => "", helpedForFrames), p));
    }
    art.append(end);
  }
  art.append(el("p", { style: "text-align:center;margin:24px 0 0;color:#4f475f" }, "— THE END —"));
  drawRails(model, rails);
  let lastW = -1;
  // The page is attached synchronously after this returns; a timeout (unlike
  // rAF or the observer) still runs in a background tab, and scrollHeight
  // forces the layout it needs.
  setTimeout(() => { if (art.isConnected) { lastW = art.clientWidth; fitAll(art); } }, 0);
  new ResizeObserver(() => {
    if (!art.isConnected || art.clientWidth === lastW) return;
    lastW = art.clientWidth;
    fitAll(art);
  }).observe(art);
  return art;
}

function drawRails(model: ScriptModel, rails: Rails): void {
  model.threads.forEach((t, i) => {
    const start = t.startKey ? rails.pos.get(t.startKey) : undefined;
    if (start === undefined) return;
    const deps = t.deps.map((d) => ({ p: rails.pos.get(d.key), early: d.early })).filter((d): d is { p: number; early: boolean } => d.p !== undefined);
    const end = deps.reduce((m, d) => Math.max(m, d.p), start);
    const L = 6 + i * 7;
    for (const { node, p } of rails.els) {
      const seg = (top: string, bottom: string) => node.append(el("span", { className: "ms-rail", "aria-hidden": "true",
        style: `left:${L}px;top:${top};bottom:${bottom};background:${t.color}` }));
      if (p > start && p < end) seg("0", "0");
      else if (p === start && end > start) seg("16px", "0");
      else if (p === end && end > start) seg("0", "calc(100% - 16px)");
      const dot = (style: string) => node.append(el("span", { className: "ms-dot", "aria-hidden": "true", style: `left:${L - 3}px;${style}` }));
      if (p === start) dot(`background:${t.color};box-shadow:0 0 0 2px #f4ead8`);
      for (const d of deps) {
        if (d.p !== p) continue;
        dot(d.early ? "background:#c0392b;border:2px solid #c0392b" : `background:#f4ead8;border:2px solid ${t.color}`);
      }
    }
  });
}

function renderBeat(
  pc: PageCtx, b: Beat, roomId: string, sceneName: string, nextShot: () => string, helped: ReadonlySet<string>
): HTMLElement {
  const wrap = el("div", { className: `ms-rowwrap${b.branch ? " ms-branch" : ""}` });
  if (b.branchHead) {
    wrap.append(el("div", { className: "ms-branchhead ms-sans" },
      el("span", { className: "ms-branchtag" }, "BRANCH"), el("span", {}, b.branchHead)));
  }
  switch (b.kind) {
    case "dir": {
      const row = el("div", { className: "ms-dir" });
      if (b.frame && pc.boards) {
        const cv = b.frame.type === "recipe"
          ? recipeCard(pc.content, b.frame.recipeId)
          : closeUp(pc.content, b.frame.roomId, b.frame.x, b.frame.y, helped);
        row.append(el("figure", { className: "ms-framefig" }, cv,
          el("figcaption", { className: "ms-sans" }, `${nextShot()} · ${b.frame.label}`)));
      }
      row.append(el("p", {}, caps(b.text ?? "")));
      wrap.append(row);
      break;
    }
    case "cond": wrap.append(el("p", { className: "ms-cond" }, caps(b.text ?? ""))); break;
    case "stub": wrap.append(el("p", { className: "ms-stub" }, b.text ?? "")); break;
    case "skip": wrap.append(el("div", { className: "ms-skip" },
      el("span", { className: "ms-sans", style: "font-size:11px;font-weight:700;letter-spacing:.06em" }, "NOT ON THIS RUN"),
      el("span", {}, caps(b.text ?? "")))); break;
    case "line": wrap.append(lineBeat(pc, b, roomId, sceneName, wrap)); break;
    case "warden": wrap.append(wardenBeat(pc, b, roomId, wrap)); break;
    case "alt": {
      const grid = el("div", { className: "ms-alt" });
      for (const c of b.columns ?? []) {
        const col = el("div", { className: `ms-altcol${c.label === "IF NOT" ? " not" : ""}` },
          el("div", { className: "ms-sans ms-altlabel" }, c.label));
        for (const x of c.beats) col.append(renderBeat(pc, x, roomId, sceneName, nextShot, helped));
        if (!c.beats.length && c.empty) col.append(el("p", { className: "ms-stub", style: "margin-left:0" }, c.empty));
        grid.append(col);
      }
      wrap.append(grid);
      break;
    }
  }
  return wrap;
}

// ---- Editable beats ----

function autoGrow(ta: HTMLTextAreaElement): void {
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
}

/** Fit every script textarea to its text. Run by a ResizeObserver on the
 *  paper — on first layout and whenever its width changes — rather than at
 *  creation (detached, so it measures nothing) or on rAF (never fires in a
 *  background tab). Heights are cleared, then read, then set, in three
 *  passes, so it's one layout instead of one per textarea. */
function fitAll(root: HTMLElement): void {
  const tas = [...root.querySelectorAll<HTMLTextAreaElement>("textarea.ms-ta")];
  for (const ta of tas) ta.style.height = "auto";
  const hs = tas.map((ta) => ta.scrollHeight);
  tas.forEach((ta, i) => { ta.style.height = `${hs[i]}px`; });
}

function scriptArea(value: string, dataKey: string, aria: string, placeholder: string): HTMLTextAreaElement {
  const ta = el("textarea", { rows: 1, "aria-label": aria, placeholder, "data-k": dataKey, value }) as HTMLTextAreaElement;
  ta.className = "ms-ta";
  ta.addEventListener("input", () => autoGrow(ta));
  return ta;
}

/** Keep every other copy of a shared line (confiscation appears in every
 *  scene) in step with the one being typed in. */
function mirror(ta: HTMLTextAreaElement): void {
  const k = ta.dataset.k;
  if (!k) return;
  for (const other of document.querySelectorAll<HTMLTextAreaElement>(`textarea[data-k="${CSS.escape(k)}"]`)) {
    if (other !== ta) { other.value = ta.value; autoGrow(other); }
  }
}

let openInspector: { key: string; node: HTMLElement; stop: () => void; update: (text: string) => void } | null = null;
function closeInspector(): void {
  openInspector?.stop();
  openInspector?.node.remove();
  openInspector = null;
}

function gutter(b: Beat): HTMLElement {
  return el("div", { className: "ms-gutter ms-sans" }, b.gutter ?? "",
    b.key && ui.edited.has(b.key) ? el("span", { className: "ms-edited" }, "edited") : null);
}

function entityOf(pc: PageCtx, t: BeatTarget | undefined): RoomEntity | undefined {
  if (!t || t.kind === "taunt") return undefined;
  return pc.content.rooms[t.roomId]?.entities[t.entityIndex];
}

function smallPortrait(draw: (c: CanvasRenderingContext2D, x: number, y: number, size: number) => void, size = 30): HTMLCanvasElement {
  const cv = el("canvas", { width: size * 2, height: size * 2, className: "ms-portrait" }) as HTMLCanvasElement;
  const c = cv.getContext("2d");
  if (c) { c.fillStyle = "#2a2340"; c.fillRect(0, 0, size * 2, size * 2); draw(c, 0, 0, size * 2); }
  return cv;
}

function lineBeat(pc: PageCtx, b: Beat, roomId: string, sceneName: string, wrap: HTMLElement): HTMLElement {
  const t = b.target!;
  const e = entityOf(pc, t);
  const row = el("div", { className: "ms-line" });
  const portrait = e && t.kind === "npc" ? npcPortraitDrawer(e) : null;
  const value = readTarget(pc.content, t);
  const ta = scriptArea(value, b.key!, `${b.cue} — ${(b.gutter ?? "").toLowerCase()}, ${sceneName}`, "Nothing is written here yet");
  const body = el("div", { className: "ms-linebody" },
    el("div", { className: "ms-cue" },
      portrait ? smallPortrait(portrait) : noteIcon(), el("span", {}, caps(b.cue ?? ""))),
    b.paren ? el("div", { className: "ms-paren" }, `(${b.paren})`) : null,
    el("div", { className: "ms-dialog" }, ta),
    b.choice ? el("div", { className: "ms-paren", style: "padding-left:10%" }, "[ HAND IT OVER ]    [ KEEP IT ]") : null);
  row.append(gutter(b), body);
  if (b.flags?.length || pc.extraFlags.get(b.key!)) {
    body.append(el("div", { className: "ms-flags" }, ...[...(b.flags ?? []), ...(pc.extraFlags.get(b.key!) ?? [])]
      .map((f) => el("span", { className: f.level }, f.text))));
  }
  const kind = t.kind === "note" ? "note" : "dialog";
  const flags = (text: string): LintFlag[] => [
    ...(b.flags ?? []).map((f) => ({ level: f.level, text: f.text })),
    ...(pc.extraFlags.get(b.key!) ?? []).map((f) => ({ level: f.level, text: f.text })),
    ...continuityFlags(pc.content, text, roomId, pc.prev).map((f) => ({ level: f.level, text: f.text })),
    ...lintLine(text, kind, { roomId, required: true }),
  ];
  const open = () => {
    if (openInspector?.key === b.key) return;
    closeInspector();
    ui.selected = b.key!;
    const insp = inspector(pc, b, roomId, ta.value, flags, () => {
      if (t.kind === "note") {
        const recipe = e?.recipe ? pc.content.recipes.find((r) => r.id === e.recipe) : undefined;
        const out = recipe ? pc.content.items.find((i) => i.id === recipe.output) : undefined;
        return dialogPreview({ title: "A note", titleColor: "#c9a86a",
          footer: out ? `Recipe: ${out.name}  ·  E / Enter — close` : "E / Enter — close" }, ta.value);
      }
      return dialogPreview({
        title: e?.name ?? b.cue ?? "", portrait: portrait ?? undefined,
        footer: b.choice ? "E — give · Esc — keep it" : "E / Enter — close", confirmButtons: !!b.choice,
      }, ta.value);
    });
    wrap.append(insp.node);
    openInspector = { key: b.key!, ...insp };
  };
  ta.addEventListener("focus", open);
  ta.addEventListener("input", () => {
    writeTarget(pc.content, t, ta.value);
    pc.saveTarget(t);
    ui.edited.add(b.key!);
    markEdited(row);
    pc.script.lines[b.key!] = { text: ta.value, label: ledgerLabel(b, sceneName), roomId: roomOf(t), npcId: b.npcId };
    pc.saveScript();
    mirror(ta);
    openInspector?.update(ta.value);
  });
  return row;
}

function noteIcon(): HTMLCanvasElement {
  return smallPortrait((c, x, y, size) => {
    c.save();
    c.translate(x + size / 2, y + size / 2);
    c.rotate(-0.08);
    c.fillStyle = "#fff6d8";
    c.fillRect(-size * 0.25, -size * 0.32, size * 0.5, size * 0.64);
    c.fillStyle = "#7a6f8f";
    for (let i = 0; i < 3; i++) c.fillRect(-size * 0.17, -size * 0.12 + i * size * 0.12, size * (i === 2 ? 0.2 : 0.34), size * 0.03);
    c.fillStyle = "#d0453a";
    c.beginPath(); c.arc(0, -size * 0.27, size * 0.05, 0, Math.PI * 2); c.fill();
    c.restore();
  });
}

function wardenBeat(pc: PageCtx, b: Beat, roomId: string, wrap: HTMLElement): HTMLElement {
  const td = pc.content.taunts.find((x) => x.id === (b.target as { tauntId: string }).tauntId) as TauntDef;
  const ant = pc.content.game.antagonist;
  const emotion = (): WardenEmotion => td.emotion ?? "smug";
  const face = smallPortrait((c, x, y, size) => drawWardenPortrait(c, emotion(), ant.color, x, y, size, ant.portraits?.[emotion()]));
  const redrawFace = () => {
    const c = face.getContext("2d");
    if (c) { c.clearRect(0, 0, face.width, face.height); drawWardenPortrait(c, emotion(), ant.color, 0, 0, face.width, ant.portraits?.[emotion()]); }
  };
  const instance = `${roomId}|${b.key}`;
  const open = !b.shared || ui.openShared.has(instance);
  const row = el("div", { className: "ms-line" });
  const faceBtn = el("button", { className: "ms-face", title: "Change his face", "aria-label": `His face: ${emotion()}. Click to change.` }, `(${emotion()})`);
  const body = el("div", { className: "ms-linebody" },
    el("div", { className: "ms-cue" }, face, el("span", {}, "THE WARDEN"),
      b.shared ? el("span", { className: "ms-tag ms-sans" }, "shared · plays in many places") : null),
    el("div", { className: "ms-paren" }, faceBtn, td.lines.length > 1 ? el("span", {}, " (one of these, at random)") : null));
  row.append(gutter(b), body);

  let activeLine = 0;
  const lineFlags = (text: string): LintFlag[] => lintLine(text, "banner", { required: true });
  const openInsp = (i: number, text: string) => {
    activeLine = i;
    const k = `${b.key}#${i}@${instance}`;
    if (openInspector?.key === k) return;
    closeInspector();
    ui.selected = k;
    let p: ReturnType<typeof bannerPreview> | null = null;
    const insp = inspector(pc, b, roomId, text, lineFlags, () => {
      p = bannerPreview(ant, text, emotion());
      return { canvas: p.canvas };
    }, `${b.mapping} · line ${i + 1} of ${td.lines.length} · face: ${emotion()}`);
    const stopAll = () => { p?.stop(); insp.stop(); };
    wrap.append(insp.node);
    openInspector = { key: k, node: insp.node, stop: stopAll, update: (v) => { p?.update(v, emotion()); insp.update(v); } };
  };
  faceBtn.addEventListener("click", () => {
    const n = EMOTIONS[(EMOTIONS.indexOf(emotion()) + 1) % EMOTIONS.length];
    td.emotion = n;
    void pc.ctx.save("taunts.json", pc.content.taunts);
    ui.edited.add(b.key!);
    markEdited(row);
    faceBtn.textContent = `(${n})`;
    faceBtn.setAttribute("aria-label", `His face: ${n}. Click to change.`);
    redrawFace();
    if (openInspector?.key.startsWith(`${b.key}#`)) { closeInspector(); openInsp(activeLine, td.lines[activeLine] ?? ""); }
  });

  if (!open) {
    body.append(el("div", { className: "ms-paren", style: "padding-left:10%;display:flex;gap:8px;align-items:center;flex-wrap:wrap" },
      el("span", {}, td.lines.length > 1 ? `One of his ${td.lines.length} lines plays here.` : "His line plays here."),
      el("button", { className: "ms-small", onclick: () => { ui.openShared.add(instance); pc.ctx.render(); } }, "Show the lines")));
    return row;
  }
  td.lines.forEach((line, i) => {
    const ta = scriptArea(line, `${b.key}#${i}`, `The Warden, ${td.lines.length > 1 ? `line ${i + 1}` : "his line"}`, "Nothing plays here yet — write his line");
    ta.addEventListener("focus", () => openInsp(i, ta.value));
    ta.addEventListener("input", () => {
      td.lines[i] = ta.value;
      void pc.ctx.save("taunts.json", pc.content.taunts);
      ui.edited.add(b.key!);
      markEdited(row);
      mirror(ta);
      openInspector?.update(ta.value);
    });
    body.append(el("div", { className: "ms-dialog ms-pool" },
      td.lines.length > 1 ? el("span", { className: "ms-num" }, `${i + 1}.`) : null, ta));
  });
  body.append(el("div", { className: "ms-sans", style: "margin:4px 0 0 10%;display:flex;gap:8px;flex-wrap:wrap" },
    el("button", { className: "ms-small", onclick: () => { td.lines.push(""); void pc.ctx.save("taunts.json", pc.content.taunts).then(() => pc.ctx.render()); } },
      "+ another line for the rotation"),
    b.shared ? el("button", { className: "ms-small", onclick: () => { ui.openShared.delete(instance); pc.ctx.render(); } }, "Hide") : null));
  return row;
}

// ---- The inspector under the selected beat ----

function inspector(
  pc: PageCtx, b: Beat, roomId: string, text: string, flags: (t: string) => LintFlag[],
  preview: () => { canvas: HTMLCanvasElement; update?: (t: string) => void }, mapping?: string
): { node: HTMLElement; stop: () => void; update: (t: string) => void } {
  const { canvas, update: redraw } = preview();
  const lint = lintStrip(flags(text));
  const playRoom = roomId || (b.target && b.target.kind !== "taunt" ? b.target.roomId : "");
  const node = el("div", { className: "ms-insp ms-sans" },
    el("div", { className: "ms-inspcol" },
      el("div", { className: "ms-insphead" }, "WHERE THIS PLAYS"),
      el("div", {}, b.where ?? ""),
      el("div", { className: "ms-mapping" }, mapping ?? b.mapping ?? ""),
      lint,
      playRoom ? el("div", {}, el("button", { className: "st-btn", onclick: () => pc.ctx.playRoom(playRoom) }, "▶ Play this scene in the game")) : null),
    el("div", { className: "ms-inspcol ms-insppreview" }, el("div", { className: "ms-insphead", style: "color:#c9c1e0" }, "HOW IT LOOKS"), canvas));
  return {
    node,
    stop: () => { /* banner previews are stopped by their owner (and stopLinePreviews) */ },
    update: (t: string) => {
      lint.replaceChildren(...lintStrip(flags(t)).childNodes);
      redraw?.(t); // dialog previews redraw in place; the banner's owner drives its own
    },
  };
}

function markEdited(row: HTMLElement): void {
  const g = row.querySelector(".ms-gutter");
  if (g && !g.querySelector(".ms-edited")) g.append(el("span", { className: "ms-edited" }, "edited"));
}
