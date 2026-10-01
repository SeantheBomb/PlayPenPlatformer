// Writers Studio — the Warden. His faces (art-owned, shown for reference),
// every taunt grouped by what triggers it, and the achievement lines. Every
// line previews through the real banner with the real portrait, typing out
// at the real speed, so "does it fit / does it land" is answered on the
// page rather than in a playthrough.
import type { AchievementDef, TauntDef, TauntTrigger, WardenEmotion } from "../data/types";
import { el } from "../editor/forms";
import { drawWardenPortrait } from "../engine/renderer";
import { lineField } from "./linepreview";
import { lintLine, worstLevel } from "./voice";
import type { WriterContext } from "./writers";

export const EMOTIONS: WardenEmotion[] = ["smug", "gleeful", "annoyed", "bored", "shocked", "proud"];

/** Plain-language trigger names, in the order they tend to happen in a run. */
export const TRIGGER_LABELS: { id: TauntTrigger; label: string; hint: string }[] = [
  { id: "game_start", label: "Starting a new game", hint: "The very first thing the player hears." },
  { id: "room_enter", label: "Entering a room", hint: "One per room — the room is fixed by Sean; the line is yours." },
  { id: "first_craft", label: "First successful craft", hint: "" },
  { id: "craft_fail", label: "A craft that fails", hint: "Plays often — a bigger pool here is the cheapest win in the game." },
  { id: "craft_item", label: "Crafting a specific item", hint: "The item is fixed by Sean." },
  { id: "first_ignite", label: "First time setting something on fire", hint: "" },
  { id: "first_melt", label: "First melt", hint: "" },
  { id: "first_extinguish", label: "First time putting fire out", hint: "" },
  { id: "first_freeze", label: "First freeze", hint: "" },
  { id: "first_shatter", label: "First shatter", hint: "" },
  { id: "first_dissolve", label: "First dissolve", hint: "" },
  { id: "first_death", label: "First death", hint: "Exactly one line — an arc beat, not a rotation." },
  { id: "death", label: "Dying (every time after)", hint: "Rotation pool: more lines = more variety." },
  { id: "idle", label: "Standing around too long", hint: "Rotation pool. He's coming." },
  { id: "hide_enter", label: "Hiding in a locker", hint: "" },
  { id: "npc_help", label: "Helping a resident", hint: "" },
  { id: "confiscate", label: "Between rooms — confiscation", hint: "He takes everything. Nursery vocabulary on a prison concept." },
  { id: "warden_chase", label: "The chase", hint: "No dialog mid-run is readable at speed — keep it to the start." },
  { id: "win", label: "Escaping", hint: "The win line. Arc-critical: exactly one, and it carries the thesis." },
];

function portraitStrip(ctx: WriterContext): HTMLElement {
  const ant = ctx.store.content.game.antagonist;
  return el("div", { className: "st-filters", style: "gap:14px" },
    ...EMOTIONS.map((emotion) => {
      const cv = el("canvas", { width: 48, height: 48, className: "st-thumb", style: "width:48px;height:48px" }) as HTMLCanvasElement;
      const c = cv.getContext("2d");
      if (c) drawWardenPortrait(c, emotion, ant.color, 0, 0, 48, ant.portraits?.[emotion]);
      return el("div", { style: "text-align:center" }, cv, el("div", { className: "st-dim" }, emotion));
    }));
}

/** Filter state survives re-renders (an emotion change re-renders the page)
 *  for the session — she shouldn't lose her place every time she edits. */
interface WardenFilter {
  q: string;
  /** "" = any, "_global" = not tied to a level, else a room id. */
  room: string;
  trigger: string;
  emotion: string;
  flagged: boolean;
  groupBy: "level" | "trigger";
}
const filter: WardenFilter = { q: "", room: "", trigger: "", emotion: "", flagged: false, groupBy: "level" };

const triggerLabel = (id: string) => TRIGGER_LABELS.find((l) => l.id === id)?.label ?? id;
const triggerOrder = (id: string) => {
  const i = TRIGGER_LABELS.findIndex((l) => l.id === id);
  return i < 0 ? 999 : i;
};

/** Does any line on this taunt carry a lint flag worth a look? */
function tauntFlagged(t: TauntDef): boolean {
  return t.lines.some((l) => worstLevel(lintLine(l, "banner", { required: true })) !== "ok");
}

export function wardenView(ctx: WriterContext): HTMLElement {
  const content = ctx.store.content;
  const ant = content.game.antagonist;
  const roomName = (id: string) => content.rooms[id]?.name ?? id;
  const wrap = el("div", {});
  wrap.append(el("div", { className: "st-card" },
    el("h2", { style: "margin:0 0 6px;color:#ffd166" }, `🎭 ${ant.name}`),
    el("p", { style: "margin:0 0 8px" },
      "Every line he says. Where a trigger has several lines the game picks one at random each time — good for deaths and " +
      "idling; the arc beats (first death, the vault, the win) get exactly one. He never talks over a resident: a line that " +
      "comes up while a dialog or note is open waits until it closes."),
    el("div", { className: "st-hint" },
      "Voice rules: bureaucratic, petty, weirdly proud of the facility. Nursery words on prison concepts. Addresses you only as " +
      "Subject #67. Lies about small things, honest about big ones. Punchline last — lines type out onto a banner, so short lands harder."),
    el("div", { style: "margin-top:10px" }, el("b", {}, "His faces"),
      el("span", { className: "st-hint" }, " — each line picks one. Drawn by the artist; pick the face here, not the art."),
      portraitStrip(ctx))
  ));

  const taunts = content.taunts;
  const save = () => ctx.save("taunts.json", taunts);
  const live = taunts.filter((t) => !t.removed);
  const removed = taunts.filter((t) => t.removed);
  const ach = content.achievements;
  const saveAch = () => ctx.save("achievements.json", ach);

  // ---- Filter bar ----
  // Filtering toggles visibility in place rather than re-rendering, so the
  // search box keeps focus while she types.
  const count = el("span", { className: "st-hint" }, "");
  const search = el("input", {
    className: "st-search", placeholder: "🔍 Search lines, rooms, triggers…", value: filter.q, style: "flex:1;min-width:220px",
    oninput: (e: Event) => { filter.q = (e.target as HTMLInputElement).value; apply(); },
  });
  const select = (value: string, opts: [string, string][], onChange: (v: string) => void) =>
    el("select", { className: "st-search", style: "min-width:0", onchange: (e: Event) => { onChange((e.target as HTMLSelectElement).value); apply(); } },
      ...opts.map(([v, label]) => el("option", { value: v, ...(v === value ? { selected: true } : {}) }, label)));
  const campaignRooms = [...new Set([...(content.campaign?.rooms ?? []), ...live.flatMap((t) => (t.roomId ? [t.roomId] : []))])];
  const presentTriggers = [...new Set(live.map((t) => t.trigger))].sort((a, b) => triggerOrder(a) - triggerOrder(b));
  const groupBtn = (mode: WardenFilter["groupBy"], label: string) =>
    el("span", {
      className: "pp-questseg" + (filter.groupBy === mode ? " pp-active" : ""),
      onclick: () => { if (filter.groupBy !== mode) { filter.groupBy = mode; ctx.render(); } },
    }, label);
  wrap.append(el("div", { className: "st-card", style: "position:sticky;top:0;z-index:2;padding:10px 14px" },
    el("div", { className: "st-row", style: "margin:0" },
      search,
      el("span", { className: "st-hint" }, "group by"),
      el("span", { className: "pp-questsegmented" }, groupBtn("level", "Level"), groupBtn("trigger", "Trigger"))),
    el("div", { className: "st-row", style: "margin:8px 0 0" },
      select(filter.room, [["", "Any level"], ["_global", "Whole game (not tied to a level)"],
        ...campaignRooms.map((id, i): [string, string] => [id, `${i + 1}. ${roomName(id)}`])], (v) => { filter.room = v; }),
      select(filter.trigger, [["", "Any trigger"], ...presentTriggers.map((id): [string, string] => [id, triggerLabel(id)])],
        (v) => { filter.trigger = v; }),
      select(filter.emotion, [["", "Any face"], ...EMOTIONS.map((e): [string, string] => [e, e])], (v) => { filter.emotion = v; }),
      el("label", { className: "st-hint", style: "display:flex;gap:5px;align-items:center;cursor:pointer" },
        el("input", { type: "checkbox", ...(filter.flagged ? { checked: true } : {}),
          onchange: (e: Event) => { filter.flagged = (e.target as HTMLInputElement).checked; apply(); } }),
        "only lines with flags"),
      el("span", { className: "st-spacer" }),
      el("button", { className: "st-btn st-quiet", onclick: () => {
        Object.assign(filter, { q: "", room: "", trigger: "", emotion: "", flagged: false });
        ctx.render();
      } }, "Clear"),
      count)));

  // ---- Taunt groups ----
  type Entry = { t: TauntDef; card: HTMLElement; group: HTMLElement };
  const entries: Entry[] = [];
  const groups: HTMLElement[] = [];
  const addGroup = (title: string, hint: string, list: TauntDef[], labelFor: (t: TauntDef) => string) => {
    if (!list.length) return;
    const group = el("div", { className: "st-card" },
      el("div", { className: "st-row", style: "margin:0" },
        el("b", { style: "font-size:15px" }, title),
        el("span", { className: "st-hint" }, hint)));
    for (const t of list) {
      const card = tauntCard(ctx, t, save, labelFor(t));
      group.append(card);
      entries.push({ t, card, group });
    }
    groups.push(group);
    wrap.append(group);
  };

  if (filter.groupBy === "level") {
    const global = live.filter((t) => !t.roomId).sort((a, b) => triggerOrder(a.trigger) - triggerOrder(b.trigger));
    addGroup("Whole game", "Lines that can come up anywhere — deaths, crafting, idling, the chase, the win.",
      global, (t) => triggerLabel(t.trigger) + (t.itemId ? ` · ${t.itemId}` : ""));
    campaignRooms.forEach((id, i) => {
      const list = live.filter((t) => t.roomId === id).sort((a, b) => triggerOrder(a.trigger) - triggerOrder(b.trigger));
      addGroup(`${i + 1}. ${roomName(id)}`, "", list,
        (t) => (t.trigger === "room_enter" ? "Entering this room" : triggerLabel(t.trigger)));
    });
  } else {
    for (const trig of presentTriggers) {
      const meta = TRIGGER_LABELS.find((l) => l.id === trig);
      addGroup(triggerLabel(trig), meta?.hint ?? "", live.filter((t) => t.trigger === trig),
        (t) => (t.roomId ? roomName(t.roomId) : t.itemId ? `item: ${t.itemId}` : ""));
    }
  }

  // ---- Achievements ----
  const achEntries: { a: AchievementDef; card: HTMLElement }[] = [];
  const achGroup = el("div", { className: "st-card" },
    el("div", { className: "st-row", style: "margin:0 0 6px" },
      el("b", { style: "font-size:15px" }, "Achievements"),
      el("span", { className: "st-hint" }, "Name, what the player sees, and the Warden's reaction. Hidden ones are counted but never named on the win screen.")));
  for (const a of ach) {
    const card = achievementCard(ctx, a, saveAch);
    achGroup.append(card);
    achEntries.push({ a, card });
  }
  wrap.append(achGroup);

  // ---- Removed ----
  if (removed.length) {
    wrap.append(el("details", { className: "st-card" },
      el("summary", { style: "cursor:pointer;color:#ffd166;font-weight:600" },
        `Removed (${removed.length}) — these never play; restore any you want back`),
      ...removed.map((t) => el("div", { className: "st-row", style: "margin:8px 0 0" },
        el("span", { className: "st-chip" }, t.roomId ? roomName(t.roomId) : triggerLabel(t.trigger)),
        el("span", { style: "flex:1;color:#9f96bd" }, t.lines[0] ?? ""),
        el("button", { className: "st-btn", onclick: () => { delete t.removed; void save().then(() => ctx.render()); } }, "Restore")))));
  }

  // ---- Apply filters (in place) ----
  const matchesText = (hay: string) => !filter.q.trim() || hay.toLowerCase().includes(filter.q.trim().toLowerCase());
  function apply(): void {
    let shown = 0;
    for (const { t, card } of entries) {
      const hay = [t.id, triggerLabel(t.trigger), t.roomId ? roomName(t.roomId) : "", t.itemId ?? "", t.emotion ?? "smug", ...t.lines].join(" ");
      const ok =
        matchesText(hay) &&
        (filter.room === "" || (filter.room === "_global" ? !t.roomId : t.roomId === filter.room)) &&
        (filter.trigger === "" || t.trigger === filter.trigger) &&
        (filter.emotion === "" || (t.emotion ?? "smug") === filter.emotion) &&
        (!filter.flagged || tauntFlagged(t));
      card.hidden = !ok;
      if (ok) shown++;
    }
    for (const g of groups) g.hidden = !entries.some((e) => e.group === g && !e.card.hidden);
    // Achievements aren't tied to a level or a trigger here; a level/trigger
    // filter means "show me taunts", so they step aside.
    let achShown = 0;
    for (const { a, card } of achEntries) {
      const ok =
        filter.room === "" && filter.trigger === "" &&
        matchesText([a.name, a.description, a.wardenLine, a.emotion].join(" ")) &&
        (filter.emotion === "" || a.emotion === filter.emotion) &&
        (!filter.flagged || worstLevel(lintLine(a.wardenLine, "banner", { required: true })) !== "ok");
      card.hidden = !ok;
      if (ok) achShown++;
    }
    achGroup.hidden = achShown === 0;
    const total = live.length;
    count.textContent = shown === total && achShown === ach.length
      ? `${total} taunts · ${ach.length} achievements`
      : `showing ${shown} of ${total} taunts${achShown ? ` · ${achShown} achievements` : ""}`;
  }
  apply();
  return wrap;
}

function emotionSelect(current: WardenEmotion | undefined, onChange: (e: WardenEmotion) => void): HTMLElement {
  return el("select", {
    onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as WardenEmotion),
  }, ...EMOTIONS.map((em) => el("option", { value: em, ...(em === (current ?? "smug") ? { selected: true } : {}) }, em)));
}

function tauntCard(ctx: WriterContext, t: TauntDef, save: () => Promise<void>, label: string): HTMLElement {
  const ant = ctx.store.content.game.antagonist;
  const card = el("div", { style: "margin:12px 0 4px;padding-top:10px;border-top:1px solid #322a4e" });
  const filters: string[] = [];
  if (t.roomId) filters.push(`room: ${ctx.store.content.rooms[t.roomId]?.name ?? t.roomId}`);
  if (t.itemId) filters.push(`item: ${t.itemId}`);
  const emotion = () => t.emotion ?? "smug";
  const linesBox = el("div", {});
  const renderLines = () => {
    linesBox.replaceChildren(...t.lines.map((line, i) => {
      const row = el("div", { style: "position:relative" });
      row.append(lineField({
        label: t.lines.length > 1 ? `Line ${i + 1} of ${t.lines.length}` : "The line",
        value: line, kind: "banner", required: true,
        onInput: (v) => { t.lines[i] = v; void save(); },
        preview: { type: "banner", antagonist: ant, emotion },
      }));
      if (t.lines.length > 1) {
        row.append(el("button", {
          className: "st-btn st-quiet", style: "position:absolute;right:0;top:-4px", title: "Remove this line",
          onclick: () => { t.lines.splice(i, 1); void save().then(() => ctx.render()); },
        }, "✕"));
      }
      return row;
    }));
  };
  renderLines();
  card.append(
    el("div", { className: "st-row wr-form", style: "margin:0 0 6px" },
      label ? el("b", {}, label) : el("span", {}),
      el("span", { className: "st-dim", style: "font-family:monospace" }, t.id),
      ...filters.map((f) => el("span", { className: "st-chip" }, f)),
      el("span", { className: "st-spacer" }),
      el("span", { className: "st-hint" }, "face"),
      emotionSelect(t.emotion, (em) => { t.emotion = em; void save().then(() => ctx.render()); }),
      el("span", { className: "st-hint", title: "Seconds before this can fire again" }, "cooldown s"),
      el("input", { type: "number", min: 0, step: 1, value: Math.round((t.cooldownMs ?? 0) / 1000),
        oninput: (e: Event) => { t.cooldownMs = Math.max(0, Number((e.target as HTMLInputElement).value)) * 1000; void save(); } }),
      el("span", { className: "st-hint", title: "Chance it fires when triggered" }, "chance %"),
      el("input", { type: "number", min: 0, max: 100, step: 5, value: Math.round((t.chance ?? 1) * 100),
        oninput: (e: Event) => { t.chance = Math.min(100, Math.max(0, Number((e.target as HTMLInputElement).value))) / 100; void save(); } })),
    linesBox,
    el("div", { className: "st-row" },
      el("button", { className: "st-btn", onclick: () => { t.lines.push(""); void save().then(() => ctx.render()); } }, "+ Another line"),
      el("span", { className: "st-spacer" }),
      el("button", {
        className: "st-btn st-danger", title: "Stop this taunt from ever playing (restorable from Removed, at the bottom)",
        onclick: () => {
          if (!confirm(`Delete this taunt?

“${t.lines[0] ?? ""}”

It will stop playing in the game. You can restore it from “Removed” at the bottom of the page.`)) return;
          t.removed = true;
          void save().then(() => ctx.render());
        },
      }, "Delete taunt"))
  );
  return card;
}

function achievementCard(ctx: WriterContext, a: AchievementDef, save: () => Promise<void>): HTMLElement {
  const ant = ctx.store.content.game.antagonist;
  const emotion = () => a.emotion ?? "smug";
  const card = el("div", { className: "wr-form", style: "margin:12px 0 4px;padding-top:10px;border-top:1px solid #322a4e" });
  card.append(
    el("div", { className: "st-row", style: "margin:0 0 6px" },
      el("input", { type: "text", value: a.name, style: "font-weight:600;max-width:260px",
        oninput: (e: Event) => { a.name = (e.target as HTMLInputElement).value; void save(); } }),
      el("span", { className: "st-chip" }, a.hidden ? "hidden" : "visible"),
      el("span", { className: "st-dim", style: "font-family:monospace" }, `${a.trigger}${a.itemId ? " · " + a.itemId : ""}`),
      el("span", { className: "st-spacer" }),
      el("span", { className: "st-hint" }, "face"),
      emotionSelect(a.emotion, (em) => { a.emotion = em; void save().then(() => ctx.render()); })),
    lineField({
      label: "What the player sees", value: a.description, kind: "blurb", required: true, rows: 2,
      onInput: (v) => { a.description = v; void save(); },
    }),
    lineField({
      label: "The Warden's reaction", value: a.wardenLine, kind: "banner", required: true,
      onInput: (v) => { a.wardenLine = v; void save(); },
      preview: { type: "banner", antagonist: ant, emotion },
    })
  );
  return card;
}
