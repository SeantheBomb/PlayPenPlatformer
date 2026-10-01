// Writers Studio — the Warden. His faces (art-owned, shown for reference),
// every taunt grouped by what triggers it, and the achievement lines. Every
// line previews through the real banner with the real portrait, typing out
// at the real speed, so "does it fit / does it land" is answered on the
// page rather than in a playthrough.
import type { AchievementDef, TauntDef, TauntTrigger, WardenEmotion } from "../data/types";
import { el } from "../editor/forms";
import { drawWardenPortrait } from "../engine/renderer";
import { lineField } from "./linepreview";
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

export function wardenView(ctx: WriterContext): HTMLElement {
  const content = ctx.store.content;
  const ant = content.game.antagonist;
  const wrap = el("div", {});
  wrap.append(el("div", { className: "st-card" },
    el("h2", { style: "margin:0 0 6px;color:#ffd166" }, `🎭 ${ant.name}`),
    el("p", { style: "margin:0 0 8px" },
      "Every line he says, grouped by what makes him say it. Where a trigger has several lines the game picks one at random " +
      "each time — good for deaths and idling; the arc beats (first death, the vault, the win) get exactly one."),
    el("div", { className: "st-hint" },
      "Voice rules: bureaucratic, petty, weirdly proud of the facility. Nursery words on prison concepts. Addresses you only as " +
      "Subject #67. Lies about small things, honest about big ones. Punchline last — lines type out onto a banner, so short lands harder."),
    el("div", { style: "margin-top:10px" }, el("b", {}, "His faces"),
      el("span", { className: "st-hint" }, " — each line picks one. Drawn by the artist; pick the face here, not the art."),
      portraitStrip(ctx))
  ));

  const taunts = content.taunts;
  const save = () => ctx.save("taunts.json", taunts);
  const groups = new Map<TauntTrigger, TauntDef[]>();
  for (const t of taunts) groups.set(t.trigger, [...(groups.get(t.trigger) ?? []), t]);
  const seen = new Set<TauntTrigger>();
  const ordered = [...TRIGGER_LABELS.filter((l) => groups.has(l.id)),
    ...[...groups.keys()].filter((id) => !TRIGGER_LABELS.some((l) => l.id === id)).map((id) => ({ id, label: id, hint: "" }))];
  for (const trig of ordered) {
    if (seen.has(trig.id)) continue;
    seen.add(trig.id);
    const group = el("div", { className: "st-card" },
      el("div", { className: "st-row", style: "margin:0" },
        el("b", { style: "font-size:15px" }, trig.label),
        el("span", { className: "st-hint" }, trig.hint)));
    for (const t of groups.get(trig.id) ?? []) group.append(tauntCard(ctx, t, save));
    wrap.append(group);
  }

  // Achievements: the name/description the player sees, and his reaction.
  const ach = content.achievements;
  const saveAch = () => ctx.save("achievements.json", ach);
  const achCard = el("div", { className: "st-card" },
    el("div", { className: "st-row", style: "margin:0 0 6px" },
      el("b", { style: "font-size:15px" }, "Achievements"),
      el("span", { className: "st-hint" }, "Name, what the player sees, and the Warden's reaction. Hidden ones are counted but never named on the win screen.")));
  for (const a of ach) achCard.append(achievementCard(ctx, a, saveAch));
  wrap.append(achCard);
  return wrap;
}

function emotionSelect(current: WardenEmotion | undefined, onChange: (e: WardenEmotion) => void): HTMLElement {
  return el("select", {
    onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as WardenEmotion),
  }, ...EMOTIONS.map((em) => el("option", { value: em, ...(em === (current ?? "smug") ? { selected: true } : {}) }, em)));
}

function tauntCard(ctx: WriterContext, t: TauntDef, save: () => Promise<void>): HTMLElement {
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
    el("button", { className: "st-btn", onclick: () => { t.lines.push(""); void save().then(() => ctx.render()); } }, "+ Another line")
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
