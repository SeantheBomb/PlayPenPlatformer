// The Effects panel (2026-11-18, Casey + Miranda's ask): build and tune the
// effects a tile or placed item plays — particles, squish tweens, glows,
// shake, capped flashes — on the tile's own page in the Art Studio (and the
// editor's tile/item pages, same panel).
//
// Nothing here is an illusion of control:
//   - moments listed come from tileMoments(), pinned by tests to be what the
//     engine really raises for this tile;
//   - the preview is the real game running a stage (stage.ts) — a stage that
//     never makes the moment happen can't be saved;
//   - sliders write either THIS tile's tweak (params, gold dot, ↺) or, in the
//     separate "edit shared preset" mode, the preset every user shares — and
//     that mode says who else changes;
//   - keyframe dots are the stored value; used-by and the meter are computed
//     from real content; sound and hit-stop are shown, locked (game feel).
import type { Content, ItemDef, TileDef, VfxBinding, VfxKeys, VfxLayer, VfxLayerKind, VfxPreset, VfxStage } from "../data/types";
import { el } from "../editor/forms";
import {
  applyParams, LOCKED_FEEDBACK, MOMENT_LABEL, MOMENTS, presetUsers, resolveEffects, sampleKeys, VFX_LIMITS,
} from "../engine/vfx";
import { importFiles } from "./importers";

import { proveStage, StageRunner, type StageSource } from "./stage";
import { realSpots, stageFor, subjectMoments, worstScreenCount, type StageSubject } from "./stagebuild";

export interface EffectsCtx {
  content: Content;
  subject: StageSubject;
  /** Persist a content file (store.saveFile — live sync, board and the busy
   *  guard all work unchanged). */
  save(file: string, data: unknown): Promise<void>;
  /** Structural change: re-render the page. */
  changed(): void;
  /** Open another asset's page (the Spring twin row). */
  open?(kind: "tile" | "item", id: string): void;
}

type Scope = "tile" | "every";
interface PanelState {
  scope: Scope;
  moment: string | null;
  /** Selected effect: own binding id, or `d:<index>` for an every-tile entry. */
  pick: string | null;
  shared: boolean;
  curve: "scaleY" | "scaleX" | "offsetY";
  painting: VfxStage | null;
  brush: string;
}
const STATE = new Map<string, PanelState>();
let active: { key: string; runner: StageRunner } | null = null;

/** Never leave a stage game ticking behind a re-render or a closed page. */
export function stopEffectsPreview(): void {
  active?.runner.stop();
  active = null;
}

const subjectKey = (s: StageSubject) => `${s.kind}:${s.def.id}`;
const fileOf = (s: StageSubject) => (s.kind === "tile" ? "tiles.json" : "items.json");
const listOf = (c: Content, s: StageSubject) => (s.kind === "tile" ? c.tiles : c.items);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// ---------------- field specs ----------------

type NumSpec = { key: keyof VfxLayer; label: string; min: number; max: number; step: number; def: number; title?: string };
const NUM: Record<VfxLayerKind, NumSpec[]> = {
  particles: [
    { key: "count", label: "How many", min: 0, max: 60, step: 1, def: 8 },
    { key: "speed", label: "Speed", min: 0, max: 400, step: 5, def: 90 },
    { key: "speedMin", label: "Slowest (× speed)", min: 0, max: 1, step: 0.05, def: 0.3 },
    { key: "dir", label: "Direction °", min: -180, max: 180, step: 5, def: 0, title: "0 = right, -90 = up, 90 = down" },
    { key: "cone", label: "Spread °", min: 0, max: 360, step: 5, def: 360, title: "360 = every way" },
    { key: "upBias", label: "Extra lift", min: -200, max: 200, step: 5, def: 0 },
    { key: "gravity", label: "Gravity", min: -600, max: 600, step: 10, def: 300, title: "negative floats up" },
    { key: "life", label: "Lifetime (s)", min: 0.05, max: 3, step: 0.05, def: 0.5 },
    { key: "lifeMin", label: "Shortest (× life)", min: 0, max: 1, step: 0.05, def: 0.6 },
    { key: "size", label: "Size (px)", min: 0.5, max: 16, step: 0.5, def: 3 },
    { key: "sizeEnd", label: "Size at end (×)", min: 0, max: 3, step: 0.1, def: 0.5 },
    { key: "spreadX", label: "Spawn width (px)", min: 0, max: 32, step: 1, def: 0 },
    { key: "spreadY", label: "Spawn height (px)", min: 0, max: 32, step: 1, def: 0 },
  ],
  tween: [{ key: "ms", label: "Length (ms)", min: 30, max: 2000, step: 10, def: 260 }],
  glow: [
    { key: "radius", label: "Radius (px)", min: 2, max: 96, step: 1, def: 24 },
    { key: "alpha", label: "Strength", min: 0, max: 1, step: 0.05, def: 0.5 },
    { key: "ms", label: "Length (ms)", min: 30, max: 2000, step: 10, def: 300 },
  ],
  shake: [
    { key: "intensity", label: "Strength", min: 0, max: VFX_LIMITS.shakeIntensity, step: 0.5, def: 2 },
    { key: "seconds", label: "Length (s)", min: 0, max: VFX_LIMITS.shakeSeconds, step: 0.05, def: 0.2 },
  ],
  flash: [
    { key: "alpha", label: "Strength", min: 0, max: VFX_LIMITS.flashAlpha, step: 0.05, def: 0.35, title: `capped at ${VFX_LIMITS.flashAlpha}; at most ${VFX_LIMITS.flashesPerSec} flashes start per second, and players can turn flashes off` },
    { key: "ms", label: "Length (ms)", min: 30, max: 1000, step: 10, def: 120 },
  ],
};
const RATE: NumSpec = { key: "rate", label: "Per second, per tile", min: 0, max: 10, step: 0.1, def: 1 };
const KIND_LABEL: Record<VfxLayerKind, string> = {
  particles: "Particles", tween: "Squish / stretch", glow: "Glow", shake: "Screen shake", flash: "Screen flash",
};
const NEW_LAYER: Record<VfxLayerKind, Omit<VfxLayer, "id">> = {
  particles: { kind: "particles", count: 8, speed: 80, life: 0.5, colors: ["event"] },
  tween: { kind: "tween", ms: 260, anchor: "bottom", scaleY: [[0, 1], [0.3, 0.6], [0.65, 1.12], [1, 1]] },
  glow: { kind: "glow", color: "#ffd166", radius: 24, alpha: 0.5, ms: 300 },
  shake: { kind: "shake", intensity: 2, seconds: 0.2 },
  flash: { kind: "flash", color: "#ffffff", alpha: 0.3, ms: 120 },
};

// ---------------- styles ----------------

let styled = false;
function ensureStyles(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement("style");
  s.textContent = `
.fx-card { background:#1c1730; border:1px solid #322a4e; border-radius:12px; padding:14px; margin:0 0 14px; color:#ece6f8; font:14px "Segoe UI", system-ui, sans-serif; }
/* The studio classes this panel uses, scoped so the editor (which mounts the
   same panel) keeps its own .pp-* look untouched. */
.fx-card .st-btn { background:#2a2342; border:1px solid #4a4070; color:#ece6f8; padding:6px 12px; border-radius:8px; cursor:pointer; font-size:13px; }
.fx-card .st-btn:hover { background:#352c52; }
.fx-card .st-btn:disabled { opacity:.5; cursor:default; }
.fx-card .st-btn.st-primary { background:#2c5140; border-color:#3e7a5c; font-weight:600; }
.fx-card .st-btn.st-quiet { background:none; border-color:transparent; color:#9f96bd; }
.fx-card .st-btn.st-on { background:#453a6e; border-color:#ffd166; color:#fff; }
.fx-card .st-btn.st-danger { background:#4a2432; border-color:#7a3e50; }
.fx-card .st-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:8px 0; }
.fx-card .st-hint { color:#9f96bd; font-size:12px; }
.fx-card .st-spacer { flex:1; }
.fx-card .st-search { background:#100d1c; color:#ece6f8; border:1px solid #3a3160; border-radius:8px; padding:6px 9px; min-width:160px; }
.fx-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px; }
.fx-head b { color:#ffd166; font-size:16px; }
.fx-cols { display:grid; grid-template-columns: 210px minmax(0,1fr); gap:14px; }
@media (max-width: 820px) { .fx-cols { grid-template-columns: 1fr; } }
.fx-moments { display:flex; flex-direction:column; gap:4px; }
.fx-moment { text-align:left; background:#241d3c; border:1px solid #3a3160; color:#d9d2f0; border-radius:8px; padding:7px 10px; cursor:pointer; display:flex; justify-content:space-between; gap:6px; }
.fx-moment.on { border-color:#ffd166; background:#352c52; color:#fff; }
.fx-count { color:#9f96bd; font-size:12px; }
.fx-stack { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }
.fx-row { display:flex; align-items:center; gap:8px; background:#241d3c; border:1px solid #3a3160; border-radius:8px; padding:6px 10px; cursor:pointer; flex-wrap:wrap; }
.fx-row.on { border-color:#ffd166; }
.fx-row.locked { cursor:default; opacity:.7; background:#1a1530; border-style:dashed; }
.fx-row.muted { text-decoration:line-through; opacity:.55; }
.fx-tag { font-size:11px; padding:1px 7px; border-radius:7px; background:#2f2750; color:#bfb6dd; }
.fx-tag.own { background:#2c5140; color:#a5e8c3; }
.fx-insp { border:1px solid #3a3160; border-radius:10px; padding:10px 12px; margin:8px 0; }
.fx-insp.shared { border-color:#c0506a; box-shadow:0 0 0 1px #c0506a inset; }
.fx-layer { border-top:1px solid #2f2750; padding-top:8px; margin-top:8px; }
.fx-field { display:grid; grid-template-columns: 150px minmax(0,1fr) 64px 22px; align-items:center; gap:6px; margin:3px 0; font-size:13px; }
.fx-field input[type=range] { width:100%; }
.fx-field input[type=number] { width:60px; background:#100d1c; color:#ece6f8; border:1px solid #3a3160; border-radius:5px; padding:2px 4px; }
.fx-dot { width:8px; height:8px; border-radius:4px; background:#ffd166; display:inline-block; margin-right:4px; }
.fx-reset { background:none; border:none; color:#ffd166; cursor:pointer; font-size:14px; padding:0; }
.fx-swatches { display:flex; gap:4px; align-items:center; flex-wrap:wrap; }
.fx-swatches input[type=color] { width:28px; height:24px; border:none; background:none; padding:0; }
.fx-stage { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-start; }
.fx-stage canvas { border-radius:8px; background:#0d0b14; max-width:100%; }
.fx-meter { height:8px; border-radius:4px; background:#2a2342; overflow:hidden; margin:4px 0; width:220px; }
.fx-meter > div { height:100%; background:#5ad1a5; }
.fx-ok { color:#a5e8c3; } .fx-bad { color:#ffb3c5; }
.fx-grid { display:inline-grid; gap:1px; background:#2a2342; padding:1px; user-select:none; }
.fx-cell { width:18px; height:18px; font:11px monospace; display:flex; align-items:center; justify-content:center; color:#fff; cursor:crosshair; }
.fx-select { background:#100d1c; color:#ece6f8; border:1px solid #3a3160; border-radius:6px; padding:5px 8px; }
`;
  document.head.append(s);
}

// ---------------- the panel ----------------

export function effectsPanel(ctx: EffectsCtx): HTMLElement {
  ensureStyles();
  const c = ctx.content;
  const subj = ctx.subject;
  const def = subj.def as (TileDef | ItemDef);
  const key = subjectKey(subj);
  const moments = subjectMoments(c, subj);
  const st: PanelState = STATE.get(key) ?? {
    scope: "tile", moment: null, pick: null, shared: false, curve: "scaleY", painting: null, brush: "#",
  };
  STATE.set(key, st);
  if (st.scope === "tile" && (!st.moment || !moments.some((m) => m.key === st.moment))) st.moment = moments[0]?.key ?? null;
  const everyKeys = [...new Set([...MOMENTS.map((m) => m.key), ...Object.keys(c.vfx.defaults)])];
  if (st.scope === "every" && (!st.moment || !everyKeys.includes(st.moment))) st.moment = everyKeys[0];

  // ---- saving ----
  const timers = new Map<string, number>();
  const saveNow = (file: string) => {
    const t = timers.get(file); if (t) clearTimeout(t); timers.delete(file);
    return ctx.save(file, file === "vfx.json" ? c.vfx : file === "tiles.json" ? c.tiles : c.items);
  };
  const saveSoon = (file: string) => {
    const t = timers.get(file); if (t) clearTimeout(t);
    timers.set(file, window.setTimeout(() => { timers.delete(file); void saveNow(file); }, 350));
  };
  const structural = async (...files: string[]) => { for (const f of files) await saveNow(f); ctx.changed(); };

  const preset = (id: string) => c.vfx.presets.find((p) => p.id === id);
  const allDefs = () => [
    ...c.tiles.map((t) => ({ kind: "tile" as const, id: t.id, name: t.name, vfx: t.vfx })),
    ...c.items.map((t) => ({ kind: "item" as const, id: t.id, name: t.name, vfx: t.vfx })),
  ];
  const ownFor = (m: string) => (def.vfx ?? []).filter((b) => b.on === m);

  const root = el("div", { className: "fx-card" });
  const scopeBtn = (s: Scope, label: string, title: string) =>
    el("button", {
      className: `st-btn ${st.scope === s ? "st-on" : ""}`, title,
      onclick: () => { st.scope = s; st.moment = null; st.pick = null; st.shared = false; st.painting = null; ctx.changed(); },
    }, label);
  root.append(el("div", { className: "fx-head" },
    el("b", {}, "✨ Effects"),
    scopeBtn("tile", `This ${subj.kind === "tile" ? "tile" : "item"}`, "Effects only this one plays"),
    scopeBtn("every", "Every tile", "Game-wide defaults: what plays for a moment unless a tile replaces it"),
    el("span", { className: "st-hint" }, st.scope === "tile"
      ? "Pick a moment, then add or tune what plays. The preview is the real game."
      : "Changing these changes every tile that doesn't replace them — the built-in looks live here.")));

  if (st.scope === "tile" && moments.length === 0) {
    root.append(el("p", { className: "st-hint" }, "This item has no moments to put effects on (only placed items do — the Spring)."));
    return root;
  }

  const cols = el("div", { className: "fx-cols" });
  root.append(cols);

  // ---- moment list ----
  const momentCol = el("div", { className: "fx-moments" });
  const momentList = st.scope === "tile"
    ? moments.map((m) => ({ key: m.key, why: m.why }))
    : everyKeys.map((k) => ({ key: k, why: "every tile" }));
  for (const m of momentList) {
    const n = st.scope === "tile" ? resolveEffects(c.vfx, def, m.key).length : (c.vfx.defaults[m.key] ?? []).length;
    momentCol.append(el("button", {
      className: `fx-moment ${st.moment === m.key ? "on" : ""}`, title: `Offered because ${m.why}`,
      onclick: () => { st.moment = m.key; st.pick = null; st.shared = false; st.painting = null; ctx.changed(); },
    }, el("span", {}, MOMENT_LABEL[m.key] ?? m.key), el("span", { className: "fx-count" }, n ? `${n}` : "—")));
  }
  cols.append(momentCol);

  const main = el("div", {});
  cols.append(main);
  const moment = st.moment!;
  const continuous = !!MOMENTS.find((m) => m.key === moment)?.continuous;

  // ---- the stack ----
  const stack = el("div", { className: "fx-stack" });
  main.append(el("div", { className: "st-hint", style: "margin-bottom:4px" }, `${MOMENT_LABEL[moment] ?? moment} — what plays, top to bottom:`), stack);

  if (st.scope === "tile") {
    const own = ownFor(moment);
    const replaced = own.some((b) => b.mode === "replace");
    (c.vfx.defaults[moment] ?? []).forEach((d) => {
      const p = preset(d.preset);
      stack.append(el("div", { className: `fx-row ${replaced ? "muted" : ""}`, title: "A game-wide default — edit it under Every tile", onclick: () => { st.scope = "every"; st.moment = moment; st.pick = null; ctx.changed(); } },
        el("span", { className: "fx-tag" }, "every tile"), el("span", {}, p?.name ?? d.preset),
        el("span", { className: "st-hint" }, replaced ? "silenced for this tile" : "")));
    });
    for (const b of own) {
      if (b.preset === "none") continue;
      const p = preset(b.preset);
      const row = el("div", { className: `fx-row ${st.pick === b.id ? "on" : ""}`, onclick: () => { st.pick = b.id; st.shared = false; ctx.changed(); } },
        el("span", { className: "fx-tag own" }, "this tile"), el("span", {}, p?.name ?? `${b.preset} (deleted preset)`),
        b.params && Object.keys(b.params).length ? el("span", { className: "st-hint" }, "· tweaked") : null);
      if (continuous && moment !== "ambient") {
        const cb = el("input", { type: "checkbox", title: "Keep playing every time it repeats (a fall meets its pool every flow tick). Off = once per spot until it pauses." }) as HTMLInputElement;
        cb.checked = !!b.while;
        cb.onclick = (e) => e.stopPropagation();
        cb.onchange = () => { if (cb.checked) b.while = true; else delete b.while; void structural(fileOf(subj)); };
        row.append(el("label", { className: "st-hint", title: cb.title }, cb, " keeps streaming"));
      }
      row.append(el("button", { className: "st-btn st-quiet", title: "Remove from this tile (the preset stays in the library)", onclick: (e: Event) => {
        e.stopPropagation();
        def.vfx = (def.vfx ?? []).filter((x) => x !== b);
        if (!def.vfx.length) delete def.vfx;
        if (st.pick === b.id) st.pick = null;
        void structural(fileOf(subj));
      } }, "✕"));
      stack.append(row);
    }
    for (const line of LOCKED_FEEDBACK[moment] ?? []) {
      stack.append(el("div", { className: "fx-row locked", title: "Game feel, set in code — ask Sean to change it" }, el("span", {}, "🔒"), el("span", {}, line)));
    }
    // add / silence
    const sel = el("select", { className: "fx-select" }) as HTMLSelectElement;
    sel.append(el("option", { value: "" }, "+ Add an effect…"), el("option", { value: "__new" }, "✚ A new effect of my own"));
    for (const p of c.vfx.presets) sel.append(el("option", { value: p.id }, p.name));
    sel.onchange = () => {
      const v = sel.value;
      if (!v) return;
      let pid = v;
      const files = [fileOf(subj)];
      if (v === "__new") {
        pid = uniqueId(c.vfx.presets.map((p) => p.id), slug(`${def.name} ${MOMENT_LABEL[moment] ?? moment}`));
        c.vfx.presets.push({ id: pid, name: `${def.name}: ${MOMENT_LABEL[moment] ?? moment}`, layers: [{ id: "burst", ...NEW_LAYER.particles }] });
        files.push("vfx.json");
      }
      const id = uniqueId((def.vfx ?? []).map((b) => b.id), pid);
      (def.vfx ??= []).push({ id, on: moment, preset: pid, ...(replaced ? { mode: "replace" as const } : {}) });
      st.pick = id;
      st.shared = v === "__new"; // a brand-new effect is edited as itself
      void structural(...files);
    };
    const silence = el("label", { className: "st-hint", title: "Stop the every-tile default from playing on this tile (yours still play)" }) as HTMLLabelElement;
    const scb = el("input", { type: "checkbox" }) as HTMLInputElement;
    scb.checked = replaced;
    scb.disabled = (c.vfx.defaults[moment] ?? []).length === 0 && !replaced;
    scb.onchange = () => {
      const list = def.vfx ?? [];
      if (scb.checked) {
        const mine = list.filter((b) => b.on === moment && b.preset !== "none");
        if (mine.length) for (const b of mine) b.mode = "replace";
        else list.push({ id: uniqueId(list.map((b) => b.id), "silence"), on: moment, preset: "none", mode: "replace" });
        def.vfx = list;
      } else {
        def.vfx = list.filter((b) => !(b.on === moment && b.preset === "none"));
        for (const b of def.vfx) if (b.on === moment) delete b.mode;
        if (!def.vfx.length) delete def.vfx;
      }
      void structural(fileOf(subj));
    };
    silence.append(scb, " silence the every-tile effect here");
    main.append(el("div", { className: "st-row", style: "gap:10px;flex-wrap:wrap" }, sel, silence));
  } else {
    const list = (c.vfx.defaults[moment] ??= []);
    list.forEach((d, i) => {
      const p = preset(d.preset);
      stack.append(el("div", { className: `fx-row ${st.pick === `d:${i}` ? "on" : ""}`, onclick: () => { st.pick = `d:${i}`; st.shared = false; ctx.changed(); } },
        el("span", { className: "fx-tag" }, "every tile"), el("span", {}, p?.name ?? d.preset),
        el("button", { className: "st-btn st-quiet", title: "Stop this playing on every tile", onclick: (e: Event) => {
          e.stopPropagation(); list.splice(i, 1); st.pick = null; void structural("vfx.json");
        } }, "✕")));
    });
    if (!list.length) stack.append(el("div", { className: "st-hint" }, "Nothing plays by default here."));
    for (const line of LOCKED_FEEDBACK[moment] ?? []) {
      stack.append(el("div", { className: "fx-row locked", title: "Game feel, set in code — ask Sean to change it" }, el("span", {}, "🔒"), el("span", {}, line)));
    }
    const sel = el("select", { className: "fx-select" }) as HTMLSelectElement;
    sel.append(el("option", { value: "" }, "+ Add an every-tile effect…"));
    for (const p of c.vfx.presets) sel.append(el("option", { value: p.id }, p.name));
    sel.onchange = () => { if (!sel.value) return; list.push({ preset: sel.value }); st.pick = `d:${list.length - 1}`; void structural("vfx.json"); };
    main.append(sel);
  }

  // ---- inspector ----
  const target = pickTarget();
  if (target) main.append(inspector(target));

  // ---- Spring twin ----
  const twin = twinRow();
  if (twin) main.append(twin);

  // ---- preview ----
  main.append(previewBlock());
  return root;

  // ================= pieces =================

  function pickTarget(): { preset: VfxPreset; params: () => Record<string, Partial<VfxLayer>> | undefined; setParams: (p: Record<string, Partial<VfxLayer>> | undefined) => void; file: string } | null {
    if (!st.pick) return null;
    if (st.pick.startsWith("d:")) {
      const entry = (c.vfx.defaults[moment] ?? [])[Number(st.pick.slice(2))];
      const p = entry && preset(entry.preset);
      if (!entry || !p) return null;
      return { preset: p, params: () => entry.params, setParams: (x) => { if (x) entry.params = x; else delete entry.params; }, file: "vfx.json" };
    }
    const b = (def.vfx ?? []).find((x) => x.id === st.pick);
    const p = b && preset(b.preset);
    if (!b || !p) return null;
    return { preset: p, params: () => b.params, setParams: (x) => { if (x) b.params = x; else delete b.params; }, file: fileOf(subj) };
  }

  function inspector(t: NonNullable<ReturnType<typeof pickTarget>>): HTMLElement {
    const p = t.preset;
    const users = presetUsers(c.vfx, allDefs(), p.id);
    const box = el("div", { className: `fx-insp ${st.shared ? "shared" : ""}` });
    const modeBtn = (shared: boolean, label: string, title: string) =>
      el("button", { className: `st-btn ${st.shared === shared ? "st-on" : ""}`, style: "padding:4px 10px", title, onclick: () => { st.shared = shared; ctx.changed(); } }, label);
    box.append(el("div", { className: "st-row", style: "gap:8px;flex-wrap:wrap" },
      el("b", {}, p.name),
      el("span", { className: "st-hint", title: users.join("\n") || "nothing" }, `used by ${users.length}`),
      el("span", { className: "st-spacer" }),
      modeBtn(false, st.scope === "tile" ? "Tweak for this tile" : "Tweak for every tile", "Changes are stored here only, on top of the preset (gold dot = changed, ↺ = back to the preset)"),
      modeBtn(true, "Edit shared preset", "Changes the preset itself — every user of it changes")));
    if (st.shared) {
      const others = users.length - 1;
      box.append(el("p", { className: "fx-bad", style: "margin:6px 0" },
        others > 0 ? `Editing the shared preset: this also changes ${others} other place${others > 1 ? "s" : ""} — ${users.join(", ")}.` : "Editing the shared preset (nothing else uses it yet)."));
      const name = el("input", { className: "st-search", value: p.name, title: "Preset name" }) as HTMLInputElement;
      name.oninput = () => { p.name = name.value || p.id; saveSoon("vfx.json"); };
      const addSel = el("select", { className: "fx-select" }) as HTMLSelectElement;
      addSel.append(el("option", { value: "" }, "+ Add a layer…"));
      for (const k of Object.keys(KIND_LABEL) as VfxLayerKind[]) addSel.append(el("option", { value: k }, KIND_LABEL[k]));
      addSel.onchange = () => {
        const k = addSel.value as VfxLayerKind;
        if (!k) return;
        p.layers.push({ id: uniqueId(p.layers.map((l) => l.id), k), ...clone(NEW_LAYER[k]) } as VfxLayer);
        void structural("vfx.json");
      };
      const del = el("button", { className: "st-btn st-danger", title: users.length ? `In use: ${users.join(", ")}` : "Delete this preset" }, "Delete preset") as HTMLButtonElement;
      del.disabled = users.length > 0;
      del.onclick = () => { c.vfx.presets = c.vfx.presets.filter((x) => x !== p); st.pick = null; void structural("vfx.json"); };
      box.append(el("div", { className: "st-row", style: "gap:8px;flex-wrap:wrap" }, name, addSel, del,
        users.length ? el("span", { className: "st-hint" }, "(remove it everywhere to delete it)") : null));
    } else {
      const fork = el("button", { className: "st-btn st-quiet", title: "Copy the preset with this tile's tweaks folded in, as a new preset only this uses" }, "⎘ Make it its own preset");
      fork.onclick = () => {
        const id = uniqueId(c.vfx.presets.map((x) => x.id), slug(`${p.id} ${def.id}`));
        c.vfx.presets.push({ id, name: `${p.name} (${st.scope === "tile" ? def.name : "every tile"})`, layers: clone(applyParams(p.layers, t.params())) });
        if (st.pick?.startsWith("d:")) {
          const entry = c.vfx.defaults[moment][Number(st.pick.slice(2))];
          entry.preset = id; delete entry.params;
        } else {
          const b = (def.vfx ?? []).find((x) => x.id === st.pick)!;
          b.preset = id; delete b.params;
        }
        st.shared = true;
        void structural("vfx.json", t.file);
      };
      box.append(el("div", { className: "st-row" }, fork));
    }
    for (const layer of p.layers) box.append(layerEditor(t, layer));
    if (!p.layers.length) box.append(el("p", { className: "st-hint" }, "No layers yet — switch to Edit shared preset and add one."));
    return box;
  }

  function layerEditor(t: NonNullable<ReturnType<typeof pickTarget>>, layer: VfxLayer): HTMLElement {
    const wrap = el("div", { className: "fx-layer" });
    const head = el("div", { className: "st-row", style: "gap:8px" }, el("b", {}, KIND_LABEL[layer.kind]), el("span", { className: "st-hint" }, layer.id));
    if (st.shared) {
      head.append(el("button", { className: "st-btn st-quiet", title: "Delete this layer from the preset", onclick: () => {
        t.preset.layers = t.preset.layers.filter((l) => l !== layer); void structural("vfx.json");
      } }, "✕ layer"));
    }
    wrap.append(head);
    const over = () => t.params()?.[layer.id] ?? {};
    const valueOf = <K extends keyof VfxLayer>(k: K): VfxLayer[K] => (st.shared ? layer[k] : (over()[k] ?? layer[k])) as VfxLayer[K];
    const isOver = (k: keyof VfxLayer) => !st.shared && over()[k] !== undefined;
    const setVal = (k: keyof VfxLayer, v: unknown, soon = true) => {
      if (st.shared) {
        if (v === undefined) delete (layer as unknown as Record<string, unknown>)[k];
        else (layer as unknown as Record<string, unknown>)[k] = v;
        soon ? saveSoon("vfx.json") : void saveNow("vfx.json");
        return;
      }
      const all = { ...(t.params() ?? {}) };
      const mine = { ...(all[layer.id] ?? {}) } as Record<string, unknown>;
      if (v === undefined) delete mine[k]; else mine[k] = v;
      if (Object.keys(mine).length) all[layer.id] = mine as Partial<VfxLayer>; else delete all[layer.id];
      t.setParams(Object.keys(all).length ? all : undefined);
      soon ? saveSoon(t.file) : void saveNow(t.file);
    };
    const specs = [...NUM[layer.kind], ...(layer.kind === "particles" && moment === "ambient" ? [RATE] : [])];
    for (const s of specs) wrap.append(numField(s, valueOf(s.key) as number | undefined, isOver(s.key), (v) => setVal(s.key, v), () => { setVal(s.key, undefined, false); ctx.changed(); }));
    if (layer.kind === "particles") {
      wrap.append(colorsField(valueOf("colors") ?? ["event"], isOver("colors"), (v) => setVal("colors", v, false), () => { setVal("colors", undefined, false); ctx.changed(); }));
      wrap.append(colorField("Fades to", valueOf("fadeTo"), isOver("fadeTo"), true, (v) => setVal("fadeTo", v), () => { setVal("fadeTo", undefined, false); ctx.changed(); }));
      wrap.append(choiceField("Shape", ["square", "round", "streak", "art"], valueOf("shape") ?? "square", isOver("shape"), (v) => { setVal("shape", v, false); ctx.changed(); }, () => { setVal("shape", undefined, false); ctx.changed(); }));
      wrap.append(choiceField("Blend", ["normal", "add"], valueOf("blend") ?? "normal", isOver("blend"), (v) => setVal("blend", v, false), () => { setVal("blend", undefined, false); ctx.changed(); }));
      if ((valueOf("shape") ?? "square") === "art") wrap.append(artField(layer, st.shared));
    }
    if (layer.kind === "tween") {
      wrap.append(choiceField("Anchored at", ["bottom", "center", "top"], valueOf("anchor") ?? "bottom", isOver("anchor"), (v) => setVal("anchor", v, false), () => { setVal("anchor", undefined, false); ctx.changed(); }));
      wrap.append(curveEditor(layer, valueOf, isOver, setVal));
    }
    if (layer.kind === "glow" || layer.kind === "flash") {
      wrap.append(colorField("Colour", valueOf("color") ?? (layer.kind === "glow" ? "#ffd166" : "#ffffff"), isOver("color"), false, (v) => setVal("color", v), () => { setVal("color", undefined, false); ctx.changed(); }));
    }
    return wrap;
  }

  function curveEditor(
    layer: VfxLayer,
    valueOf: <K extends keyof VfxLayer>(k: K) => VfxLayer[K],
    isOver: (k: keyof VfxLayer) => boolean,
    setVal: (k: keyof VfxLayer, v: unknown, soon?: boolean) => void
  ): HTMLElement {
    const wrap = el("div", { style: "margin-top:6px" });
    const tabs = el("div", { className: "st-row", style: "gap:6px" });
    for (const k of ["scaleY", "scaleX", "offsetY"] as const) {
      const label = { scaleY: "Height", scaleX: "Width", offsetY: "Up / down" }[k];
      tabs.append(el("button", { className: `st-btn ${st.curve === k ? "st-on" : ""}`, style: "padding:3px 9px", onclick: () => { st.curve = k; ctx.changed(); } },
        isOver(k) ? el("span", { className: "fx-dot" }) : "", label));
    }
    if (isOver(st.curve)) tabs.append(el("button", { className: "fx-reset", title: "Back to the preset's curve", onclick: () => { setVal(st.curve, undefined, false); ctx.changed(); } }, "↺"));
    wrap.append(tabs);
    const k = st.curve;
    const cur = valueOf(k) as VfxKeys | undefined;
    if (!cur || cur.length === 0) {
      wrap.append(el("button", { className: "st-btn", style: "margin-top:6px", onclick: () => { setVal(k, k === "offsetY" ? [[0, 0], [1, 0]] : [[0, 1], [1, 1]], false); ctx.changed(); } }, "Animate this"));
      return wrap;
    }
    const keys: VfxKeys = clone(cur);
    const [lo, hi] = k === "offsetY" ? [-16, 16] : [0, 2];
    const W = 300, H = 120, pad = 10;
    const cv = el("canvas", { width: W, height: H, style: "display:block;margin-top:6px;background:#100d1c;border-radius:6px;cursor:pointer;touch-action:none", title: "Drag the dots. Double-click to add one; right-click a middle dot to remove it. The dots ARE the saved curve." }) as HTMLCanvasElement;
    const X = (t: number) => pad + t * (W - pad * 2);
    const Y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
    const fromXY = (x: number, y: number): [number, number] => [
      Math.max(0, Math.min(1, (x - pad) / (W - pad * 2))),
      Math.round((lo + ((H - pad - y) / (H - pad * 2)) * (hi - lo)) * 100) / 100,
    ];
    const draw = () => {
      const g = cv.getContext("2d")!;
      g.clearRect(0, 0, W, H);
      g.strokeStyle = "#2f2750"; g.lineWidth = 1;
      const rest = k === "offsetY" ? 0 : 1;
      g.beginPath(); g.moveTo(pad, Y(rest)); g.lineTo(W - pad, Y(rest)); g.stroke();
      g.strokeStyle = "#ffd166"; g.lineWidth = 2; g.beginPath();
      for (let i = 0; i <= 60; i++) { const t = i / 60; const v = sampleKeys(keys, t, rest); i ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v)); }
      g.stroke();
      g.fillStyle = "#fff";
      for (const [t, v] of keys) { g.beginPath(); g.arc(X(t), Y(v), 5, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = "#9f96bd"; g.font = "10px monospace";
      g.fillText(`${hi}`, 2, pad + 4); g.fillText(`${lo}`, 2, H - 2);
    };
    draw();
    let drag = -1;
    const pos = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)] as const; };
    const near = (x: number, y: number) => keys.findIndex(([t, v]) => Math.hypot(X(t) - x, Y(v) - y) < 8);
    const commit = (soon: boolean) => setVal(k, clone(keys), soon);
    cv.onpointerdown = (e) => { const [x, y] = pos(e); drag = near(x, y); if (drag >= 0) cv.setPointerCapture(e.pointerId); };
    cv.onpointermove = (e) => {
      if (drag < 0) return;
      const [x, y] = pos(e);
      let [t, v] = fromXY(x, y);
      v = Math.max(lo, Math.min(hi, v));
      if (drag === 0) t = 0; else if (drag === keys.length - 1) t = 1;
      else t = Math.max(keys[drag - 1][0] + 0.01, Math.min(keys[drag + 1][0] - 0.01, t));
      keys[drag] = [Math.round(t * 100) / 100, v];
      draw(); commit(true);
    };
    cv.onpointerup = () => { if (drag >= 0) { drag = -1; commit(false); } };
    cv.ondblclick = (e) => {
      const [x, y] = pos(e as unknown as PointerEvent);
      const [t, v] = fromXY(x, y);
      if (t <= 0 || t >= 1) return;
      keys.push([Math.round(t * 100) / 100, v]); keys.sort((a, b) => a[0] - b[0]);
      draw(); commit(false);
    };
    cv.oncontextmenu = (e) => {
      e.preventDefault();
      const [x, y] = pos(e as unknown as PointerEvent);
      const i = near(x, y);
      if (i > 0 && i < keys.length - 1) { keys.splice(i, 1); draw(); commit(false); }
    };
    wrap.append(cv, el("div", { className: "st-hint" }, k === "offsetY" ? "px up (−) / down (+) over the effect's length" : "1 = normal size; the left edge is the moment it happens"));
    return wrap;
  }

  function twinRow(): HTMLElement | null {
    if (st.scope !== "tile" || moment !== "bounce") return null;
    const springItem = c.items.find((i) => i.placeType === "spring");
    const pads = c.tiles.filter((t) => t.bounce);
    const other: (TileDef | ItemDef)[] = subj.kind === "tile" ? (springItem ? [springItem] : []) : pads;
    if (!other.length) return null;
    const mine = JSON.stringify(ownFor("bounce").map(({ id: _id, ...b }) => b));
    const row = el("div", { className: "fx-row", style: "cursor:default;margin:8px 0" });
    for (const o of other) {
      const theirs = JSON.stringify((o.vfx ?? []).filter((b) => b.on === "bounce").map(({ id: _id, ...b }) => b));
      const same = mine === theirs;
      row.append(
        el("span", {}, subj.kind === "tile"
          ? `The crafted ${o.name} (placed item) is its own object — it bounces separately.`
          : `The ${o.name} tile is its own object — it bounces separately.`),
        el("span", { className: same ? "fx-ok" : "fx-bad" }, same ? "✓ same bounce effects" : "✗ different bounce effects"),
        same ? "" : el("button", { className: "st-btn", onclick: () => {
          const copy = ownFor("bounce").map((b) => clone(b));
          o.vfx = [...(o.vfx ?? []).filter((b) => b.on !== "bounce"), ...copy];
          if (!o.vfx.length) delete o.vfx;
          void structural(subj.kind === "tile" ? "items.json" : "tiles.json");
        } }, `Give the ${o.name} these too`),
        ctx.open ? el("button", { className: "st-btn st-quiet", onclick: () => ctx.open!(subj.kind === "tile" ? "item" : "tile", o.id) }, "open →") : "");
    }
    return row;
  }

  function previewBlock(): HTMLElement {
    const box = el("div", { className: "fx-layer" });
    // Every-tile previews on a real tile that has this moment.
    let pSubj: StageSubject = subj;
    if (st.scope === "every") {
      const t = c.tiles.find((x) => subjectMoments(c, { kind: "tile", def: x }).some((m) => m.key === moment));
      if (!t) {
        box.append(el("p", { className: "st-hint" }, "No tile has this moment (it's a game event — capacitor, fuse, enemy…). It plays when that happens in a level."));
        return box;
      }
      pSubj = { kind: "tile", def: t };
    }
    const pdef = pSubj.def as TileDef | ItemDef;
    const pick = pdef.vfxStage?.[moment];
    const stages = c.vfx.stages.filter((s) => s.moments?.includes(moment) || s.id === pick);
    const spots = pSubj.kind === "tile" ? realSpots(c, pSubj.def) : [];
    const sel = el("select", { className: "fx-select" }) as HTMLSelectElement;
    for (const s of stages) sel.append(el("option", { value: s.id }, `Stage: ${s.name}`));
    for (const r of spots.slice(0, 8)) sel.append(el("option", { value: `room:${r.roomId}` }, `Real spot: ${r.name} (${r.count} here)`));
    sel.append(el("option", { value: "__paint" }, "✎ Paint my own stage…"));
    const cur = st.painting ? "__paint" : pick && (stages.some((s) => s.id === pick) || pick.startsWith("room:")) ? pick : stageFor(c.vfx.stages, pdef, moment)?.id ?? (spots[0] ? `room:${spots[0].roomId}` : "__paint");
    sel.value = cur;
    sel.onchange = () => {
      if (sel.value === "__paint") {
        const base = stageFor(c.vfx.stages, pdef, moment);
        st.painting = clone(base ?? { id: "", name: "", rows: ["#........#", "#........#", "#...@....#", "##########"], seconds: 4, moments: [moment] });
        st.painting.id = ""; st.painting.name = `${pdef.name}: ${MOMENT_LABEL[moment] ?? moment}`;
        st.painting.moments = [moment];
        ctx.changed();
        return;
      }
      st.painting = null;
      (pdef.vfxStage ??= {})[moment] = sel.value;
      void structural(pSubj.kind === "tile" ? "tiles.json" : "items.json");
    };
    box.append(el("div", { className: "st-row", style: "gap:8px;flex-wrap:wrap" }, el("b", {}, "Preview"), sel,
      el("span", { className: "st-hint" }, st.scope === "every" ? `on ${pdef.name}` : "the real game, running this")));

    let source: StageSource | null = null;
    if (st.painting) source = { kind: "stage", stage: st.painting };
    else if (cur.startsWith("room:")) {
      const r = spots.find((s) => `room:${s.roomId}` === cur);
      if (r) source = { kind: "room", roomId: r.roomId, tx: r.tx, ty: r.ty };
    } else {
      const s = c.vfx.stages.find((x) => x.id === cur);
      if (s) source = { kind: "stage", stage: s };
    }
    const area = el("div", { className: "fx-stage" });
    box.append(area);
    if (!source) { area.append(el("p", { className: "st-hint" }, "No stage for this yet — paint one.")); return box; }

    const runKey = `${subjectKey(pSubj)}|${moment}|${cur}|${st.painting ? JSON.stringify(st.painting) : ""}`;
    let runner: StageRunner;
    if (active && active.key === runKey && (active.runner as unknown as { content: Content }).content === c) runner = active.runner;
    else {
      stopEffectsPreview();
      runner = new StageRunner(c, source, pSubj, moment);
      active = { key: runKey, runner };
      runner.start();
    }
    const status = el("div", { className: "st-hint" }, "Running…");
    const meterBar = el("div", {});
    const meterText = el("div", { className: "st-hint" });
    const report = (r: { moments: number; peakParticles: number }) => {
      status.className = r.moments ? "fx-ok" : "fx-bad";
      status.textContent = r.moments
        ? `✓ The game raised "${MOMENT_LABEL[moment] ?? moment}" ${r.moments}× in the last loop — this is what it plays.`
        : `✗ "${MOMENT_LABEL[moment] ?? moment}" didn't happen in the last loop — this stage doesn't trigger it.`;
    };
    runner.onLoop = report;
    if (runner.errors.length) { status.className = "fx-bad"; status.textContent = runner.errors.join(" "); }
    const worst = worstCase(pSubj);
    const poll = window.setInterval(() => {
      if (!runner.running || !document.body.contains(area)) { clearInterval(poll); return; }
      const n = runner.particles;
      meterBar.style.width = `${Math.min(100, (n / VFX_LIMITS.particles) * 100)}%`;
      meterText.textContent = `Preview: ${n} particles live (cap ${VFX_LIMITS.particles}).` + (worst ? ` ${worst}` : "");
    }, 250);
    const fire = el("button", { className: "st-btn st-quiet", title: "Plays the effect right now at the tile — a shortcut, NOT the real event (use it to look at the effect, not to check it triggers)", onclick: () => runner.fireNow() }, "▶ Fire now (shortcut)");
    const side = el("div", { style: "min-width:240px;flex:1" }, status, el("div", { className: "fx-meter" }, meterBar), meterText, el("div", { className: "st-row", style: "gap:6px;margin-top:6px" }, fire,
      el("button", { className: "st-btn st-quiet", onclick: () => { stopEffectsPreview(); ctx.changed(); } }, "↻ Restart")));
    area.append(runner.canvas, side);
    if (st.painting) box.append(painter(st.painting, pSubj, runner));
    return box;
  }

  function worstCase(s: StageSubject): string {
    if (s.kind !== "tile") return "";
    const fx = resolveEffects(c.vfx, s.def, moment);
    const perPlay = fx.reduce((n, f) => n + f.layers.filter((l) => l.kind === "particles").reduce((m, l) => m + (l.count ?? 8) * (l.life ?? 0.5), 0), 0);
    if (!perPlay) return "";
    const w = worstScreenCount(c, s.def.char);
    if (!w.count || !w.roomId) return "";
    const room = c.rooms[w.roomId]?.name ?? w.roomId;
    let live: number;
    if (moment === "ambient") {
      const rate = fx.reduce((n, f) => n + f.layers.filter((l) => l.kind === "particles").reduce((m, l) => m + (l.count ?? 8) * (l.life ?? 0.5) * (l.rate ?? 1), 0), 0);
      live = w.count * rate;
    } else if (moment.startsWith("fallImpact")) {
      const streaming = fx.some((f) => f.binding?.while);
      const columns = countFallHeads(w.roomId, s.def.char);
      live = columns * perPlay * (streaming ? 1 / flowIntervalSec() : 1);
    } else live = perPlay * Math.min(w.count, 4);
    const n = Math.round(live);
    return n > VFX_LIMITS.particles
      ? `⚠ Worst place, ${room}: about ${n} live — over the cap, so the oldest get dropped.`
      : `Worst place, ${room}: about ${n} live from this.`;
  }

  /** The fluid sim's flow tick (behaviors.json fluidFlow `intervalSec`) —
   *  a streaming fall effect plays once per tick. */
  function flowIntervalSec(): number {
    const doc = c.behaviors.find((b) => b.id === "fluidFlow") as unknown as { script?: string[] } | undefined;
    const line = doc?.script?.find((l) => /var\s+intervalSec\s*=/.test(l));
    const n = line ? Number(/=\s*([\d.]+)/.exec(line)?.[1]) : NaN;
    return n > 0 ? n : 0.5;
  }

  function countFallHeads(roomId: string, ch: string): number {
    const r = c.rooms[roomId];
    let n = 0;
    r.tiles.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === ch && (y === 0 || r.tiles[y - 1][x] !== ch)) n++; });
    return Math.max(1, n);
  }

  function painter(stage: VfxStage, pSubj: StageSubject, runner: StageRunner): HTMLElement {
    const box = el("div", { className: "fx-layer" });
    box.append(el("p", { className: "st-hint" },
      "Paint a small room: @ is this tile, P where the player starts, E an element source for this moment, ~ water, # wall — or any tile. ",
      "Record a clip to move the player. It only saves if the real game raises the moment in it."));
    const palette = el("div", { className: "st-row", style: "gap:4px;flex-wrap:wrap" });
    const chars = [".", "#", "~", "@", "P", "E", ...c.tiles.map((t) => t.char).filter((ch) => !"#.".includes(ch))];
    for (const ch of [...new Set(chars)]) {
      const t = c.tiles.find((x) => x.char === ch);
      palette.append(el("button", { className: `st-btn ${st.brush === ch ? "st-on" : ""}`, style: "padding:2px 8px;font-family:monospace", title: t?.name ?? { ".": "empty", "~": "water", "@": "this tile", P: "player start", E: "element source" }[ch] ?? ch, onclick: () => { st.brush = ch; ctx.changed(); } }, ch));
    }
    const w = Math.max(...stage.rows.map((r) => r.length)), h = stage.rows.length;
    const grid = el("div", { className: "fx-grid", style: `grid-template-columns:repeat(${w},18px)` });
    let down = false;
    const paint = (x: number, y: number, cell: HTMLElement) => {
      const row = stage.rows[y].padEnd(w, ".").split("");
      if (st.brush === "@" || st.brush === "P") stage.rows = stage.rows.map((r) => r.split(st.brush).join("."));
      const r2 = stage.rows[y].padEnd(w, ".").split("");
      r2[x] = st.brush;
      stage.rows[y] = r2.join("");
      void row;
      cell.textContent = st.brush === "." ? "" : st.brush;
    };
    const colorOf = (ch: string) => ch === "@" ? "#ffd166" : ch === "P" ? "#7fd8ff" : ch === "E" ? "#ff7043" : ch === "~" ? "#2e6fa0" : c.tiles.find((t) => t.char === ch)?.color ?? "#141020";
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = stage.rows[y][x] ?? ".";
      const cell = el("div", { className: "fx-cell", style: `background:${colorOf(ch)}` }, ch === "." ? "" : ch);
      cell.onpointerdown = (e) => { e.preventDefault(); down = true; paint(x, y, cell); };
      cell.onpointerenter = () => { if (down) paint(x, y, cell); };
      grid.append(cell);
    }
    grid.onpointerup = grid.onpointerleave = () => { if (down) { down = false; ctx.changed(); } };
    const size = (dw: number, dh: number) => {
      const nw = Math.max(4, Math.min(28, w + dw)), nh = Math.max(3, Math.min(16, h + dh));
      stage.rows = Array.from({ length: nh }, (_, y) => (stage.rows[y] ?? "").padEnd(nw, ".").slice(0, nw));
      ctx.changed();
    };
    const secs = el("input", { type: "number", min: 1, max: 12, step: 0.5, value: stage.seconds ?? 4, style: "width:54px", title: "Loop length (s)" }) as HTMLInputElement;
    secs.onchange = () => { stage.seconds = Math.max(1, Math.min(12, Number(secs.value) || 4)); ctx.changed(); };
    const apply = el("input", { type: "checkbox", title: "Every 1.5 s, apply the element that causes this moment to the @ tile (the same call a tool makes)" }) as HTMLInputElement;
    apply.checked = !!stage.apply;
    apply.onchange = () => { if (apply.checked) stage.apply = 1.5; else delete stage.apply; ctx.changed(); };
    const msg = el("div", { className: "st-hint" }, stage.clip?.length ? `Clip: ${stage.clip.length} key changes.` : "No clip — the player stands still.");
    const rec = el("button", { className: "st-btn" }, "⏺ Record a clip") as HTMLButtonElement;
    rec.onclick = () => {
      msg.textContent = "Recording: click the preview, then play with arrows + Space until the loop ends…";
      runner.onRecorded = (clip) => { stage.clip = clip; ctx.changed(); };
      runner.record();
    };
    const save = el("button", { className: "st-btn st-primary" }, "Save stage") as HTMLButtonElement;
    save.onclick = () => {
      const r = proveStage(c, stage, pSubj, moment);
      if (r.errors.length || r.moments === 0) {
        msg.className = "fx-bad";
        msg.textContent = r.errors.length ? `Can't save: ${r.errors.join(" ")}` : `Can't save: the game never raised "${MOMENT_LABEL[moment] ?? moment}" in ${stage.seconds ?? 4} s on this stage.`;
        return;
      }
      const id = uniqueId(c.vfx.stages.map((s) => s.id), slug(stage.name || "stage"));
      c.vfx.stages.push({ ...clone(stage), id });
      ((pSubj.def as TileDef | ItemDef).vfxStage ??= {})[moment] = id;
      st.painting = null;
      void structural("vfx.json", pSubj.kind === "tile" ? "tiles.json" : "items.json");
    };
    const name = el("input", { className: "st-search", value: stage.name, title: "Stage name" }) as HTMLInputElement;
    name.oninput = () => { stage.name = name.value; };
    box.append(palette, el("div", { style: "margin:8px 0" }, grid),
      el("div", { className: "st-row", style: "gap:6px;flex-wrap:wrap" },
        el("button", { className: "st-btn st-quiet", onclick: () => size(1, 0) }, "wider"), el("button", { className: "st-btn st-quiet", onclick: () => size(-1, 0) }, "narrower"),
        el("button", { className: "st-btn st-quiet", onclick: () => size(0, 1) }, "taller"), el("button", { className: "st-btn st-quiet", onclick: () => size(0, -1) }, "shorter"),
        el("label", { className: "st-hint" }, "loop ", secs, " s"), el("label", { className: "st-hint", title: apply.title }, apply, " apply the element"),
      ),
      el("div", { className: "st-row", style: "gap:6px;flex-wrap:wrap;margin-top:6px" }, name, rec, save,
        el("button", { className: "st-btn st-quiet", onclick: () => { st.painting = null; ctx.changed(); } }, "Cancel")),
      msg);
    return box;
  }

  // ---- small widgets ----
  function numField(s: NumSpec, value: number | undefined, over: boolean, set: (v: number) => void, reset: () => void): HTMLElement {
    const v = value ?? s.def;
    const range = el("input", { type: "range", min: s.min, max: s.max, step: s.step, value: v }) as HTMLInputElement;
    const num = el("input", { type: "number", min: s.min, max: s.max, step: s.step, value: v }) as HTMLInputElement;
    const label = el("span", { title: s.title ?? "" }, over ? el("span", { className: "fx-dot", title: "Changed for this tile" }) : "", s.label);
    const on = (x: number) => { const n = Math.max(s.min, Math.min(s.max, x)); range.value = String(n); num.value = String(n); set(n); if (!label.querySelector(".fx-dot") && !st.shared) label.prepend(el("span", { className: "fx-dot" })); };
    range.oninput = () => on(Number(range.value));
    num.onchange = () => on(Number(num.value));
    return el("div", { className: "fx-field" }, label, range, num, over ? el("button", { className: "fx-reset", title: "Back to the preset's value", onclick: reset }, "↺") : el("span", {}));
  }
  function colorsField(colors: string[], over: boolean, set: (v: string[]) => void, reset: () => void): HTMLElement {
    const sw = el("div", { className: "fx-swatches" });
    const list = [...colors];
    const redraw = () => {
      sw.replaceChildren();
      list.forEach((col, i) => {
        if (col === "event") {
          sw.append(el("button", { className: "st-btn", style: "padding:2px 8px", title: "The colour of whatever caused it (the tile's own colour) — click to remove", onclick: () => { list.splice(i, 1); if (!list.length) list.push("#ffffff"); set([...list]); redraw(); } }, "tile's colour ✕"));
          return;
        }
        const inp = el("input", { type: "color", value: col, title: "Right-click to remove" }) as HTMLInputElement;
        inp.oninput = () => { list[i] = inp.value; set([...list]); };
        inp.oncontextmenu = (e) => { e.preventDefault(); if (list.length > 1) { list.splice(i, 1); set([...list]); redraw(); } };
        sw.append(inp);
      });
      sw.append(el("button", { className: "st-btn st-quiet", style: "padding:2px 6px", title: "Add a colour (each particle picks one)", onclick: () => { list.push(list.find((x) => x !== "event") ?? "#ffffff"); set([...list]); redraw(); } }, "+"));
      if (!list.includes("event")) sw.append(el("button", { className: "st-btn st-quiet", style: "padding:2px 6px", onclick: () => { list.push("event"); set([...list]); redraw(); } }, "+ tile's colour"));
    };
    redraw();
    return el("div", { className: "fx-field" }, el("span", {}, over ? el("span", { className: "fx-dot" }) : "", "Colours"), sw, el("span", {}), over ? el("button", { className: "fx-reset", onclick: reset }, "↺") : el("span", {}));
  }
  function colorField(label: string, value: string | undefined, over: boolean, optional: boolean, set: (v: string | undefined) => void, reset: () => void): HTMLElement {
    const inp = el("input", { type: "color", value: value ?? "#ffffff" }) as HTMLInputElement;
    inp.oninput = () => set(inp.value);
    const wrap = el("div", { className: "fx-swatches" }, inp);
    if (optional) {
      const cb = el("input", { type: "checkbox", title: "On = particles fade toward this colour" }) as HTMLInputElement;
      cb.checked = value !== undefined;
      inp.disabled = !cb.checked;
      cb.onchange = () => { inp.disabled = !cb.checked; set(cb.checked ? inp.value : undefined); };
      wrap.prepend(cb);
    }
    return el("div", { className: "fx-field" }, el("span", {}, over ? el("span", { className: "fx-dot" }) : "", label), wrap, el("span", {}), over ? el("button", { className: "fx-reset", onclick: reset }, "↺") : el("span", {}));
  }
  function choiceField(label: string, options: string[], value: string, over: boolean, set: (v: string) => void, reset: () => void): HTMLElement {
    const sel = el("select", { className: "fx-select" }) as HTMLSelectElement;
    for (const o of options) sel.append(el("option", { value: o }, o));
    sel.value = value;
    sel.onchange = () => set(sel.value);
    return el("div", { className: "fx-field" }, el("span", {}, over ? el("span", { className: "fx-dot" }) : "", label), sel, el("span", {}), over ? el("button", { className: "fx-reset", onclick: reset }, "↺") : el("span", {}));
  }
  function artField(layer: VfxLayer, shared: boolean): HTMLElement {
    // Particle art is layer art (SpriteFields on the preset layer — the same
    // importers as every other asset: PNG, GIF, numbered frames, .aseprite).
    const has = !!(layer.sprite || layer.spriteFrames?.length);
    const input = el("input", { type: "file", accept: "image/*,.gif,.aseprite,.ase", multiple: true }) as HTMLInputElement;
    input.disabled = !shared;
    input.onchange = async () => {
      const r = await importFiles([...(input.files ?? [])]);
      if (!r.frames.length) return;
      delete layer.sprite; delete layer.spriteFrames; delete layer.spriteFps; delete layer.spriteDurations;
      if (r.frames.length === 1) layer.sprite = r.frames[0];
      else { layer.spriteFrames = r.frames; layer.spriteFps = 8; }
      void structural("vfx.json");
    };
    return el("div", { className: "fx-field" }, el("span", {}, "Particle art"),
      el("div", {}, input, el("div", { className: "st-hint" }, shared ? (has ? "Art set — drop new files to replace." : "No art yet — until there is, it draws squares.") : "Art belongs to the shared preset — switch to Edit shared preset.")),
      el("span", {}), el("span", {}));
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "fx";
}
function uniqueId(taken: string[], base: string): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}_${i}`)) return `${base}_${i}`;
}
export type { VfxBinding };
