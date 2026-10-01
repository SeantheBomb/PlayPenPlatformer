// Writers Studio — the cast. One page per resident, listing every room they
// appear in, in campaign order, so a character's arc reads top to bottom:
// soft intro → quest → pair scenes → the send-off. Each appearance carries
// its own four dialog slots (that's how the game stores them: per room
// instance), its quest & rewards, and its spawn gating — the quest and
// gating forms are the editor's own Quest Builder tabs, embedded.
import type { Content, RoomDef, RoomEntity } from "../data/types";
import { el } from "../editor/forms";
import { gatingTabEl, questTabEl, type QuestFormCtx } from "../editor/questbuilder";
import { drawNpcAvatar } from "../engine/renderer";
import { lineField, npcPortraitDrawer } from "./linepreview";
import { lintLine, worstLevel, type LintLevel } from "./voice";
import type { WriterContext } from "./writers";

export interface Appearance {
  room: RoomDef;
  entity: RoomEntity;
  /** Position in campaign.json (rooms outside the campaign sort last). */
  order: number;
}

export interface CastMember {
  npcId: string;
  name: string;
  avatar: RoomEntity["avatar"];
  color: string;
  appearances: Appearance[];
}

export function campaignIndex(content: Content, roomId: string): number {
  const i = content.campaign?.rooms?.indexOf(roomId) ?? -1;
  return i < 0 ? 999 : i;
}

/** Every resident with a stable npcId, with their appearances in the order
 *  the player meets them. */
export function buildCast(content: Content): CastMember[] {
  const byId = new Map<string, CastMember>();
  for (const room of Object.values(content.rooms)) {
    for (const e of room.entities) {
      if (e.type !== "npc" || !e.npcId) continue;
      let m = byId.get(e.npcId);
      if (!m) {
        m = { npcId: e.npcId, name: e.name ?? e.npcId, avatar: e.avatar, color: e.color ?? "#7fd8e8", appearances: [] };
        byId.set(e.npcId, m);
      }
      if (!m.avatar && e.avatar) m.avatar = e.avatar;
      m.appearances.push({ room, entity: e, order: campaignIndex(content, room.id) });
    }
  }
  for (const m of byId.values()) m.appearances.sort((a, b) => a.order - b.order);
  // Cast order = first appearance order.
  return [...byId.values()].sort((a, b) => (a.appearances[0]?.order ?? 999) - (b.appearances[0]?.order ?? 999));
}

const isQuest = (e: RoomEntity) => !!e.wants || !!e.roomQuest;

/** What this appearance IS, from its data — never guessed from narrative. */
export function roleBadges(e: RoomEntity): { text: string; quest: boolean }[] {
  const out: { text: string; quest: boolean }[] = [];
  if (isQuest(e)) out.push({ text: e.wants ? `Quest · wants ${e.wants.count}× ${e.wants.item}` : "Quest · room progress", quest: true });
  else out.push({ text: "Talk only", quest: false });
  if (e.requiresHelped?.length) out.push({ text: `after helping ${e.requiresHelped.join(" + ")}`, quest: false });
  if (e.hiddenIfHelped?.length) out.push({ text: `unless ${e.hiddenIfHelped.join(" / ")} helped`, quest: false });
  return out;
}

/** Can the player actually get this item in this room? Every room supplies
 *  everything its own gates need (confiscation between rooms), so a quest
 *  wanting something the room never offers is a softlock. Checked one level
 *  deep: a direct pickup/source/converter, or a recipe that outputs it. */
export function roomSuppliesItem(room: RoomDef, content: Content, itemId: string): boolean {
  for (const e of room.entities) {
    if (e.type === "pickup" && e.item === itemId) return true;
    if (e.type === "source" && e.sourceItem === itemId) return true;
    if (e.type === "converter" && e.convertOutput === itemId) return true;
    if (e.type === "npc" && e.rewardItems?.some((r) => r.item === itemId)) return true;
  }
  return content.recipes.some((r) => r.output === itemId);
}

/** Card-level health of a character: worst lint across every slot that
 *  matters, so the cast page shows where the gaps are at a glance. */
export function castHealth(m: CastMember): { level: LintLevel; empty: number } {
  let level: LintLevel = "ok";
  let empty = 0;
  for (const a of m.appearances) {
    const e = a.entity;
    const slots: [string | undefined, boolean][] = [
      [e.dialogAsk, true],
      [e.dialogConfirm, !!e.wants],
      [e.dialogDone, isQuest(e)],
      [e.dialogAfter, isQuest(e)],
    ];
    for (const [text, required] of slots) {
      if (!text?.trim()) { if (required) empty++; continue; }
      const w = worstLevel(lintLine(text, "dialog", { roomId: a.room.id }));
      if (w === "bad" || (w === "warn" && level === "ok")) level = w;
    }
  }
  if (empty && level === "ok") level = "warn";
  return { level, empty };
}

function avatarCanvas(m: CastMember, size: number): HTMLCanvasElement {
  const cv = el("canvas", { width: size, height: size }) as HTMLCanvasElement;
  const ctx = cv.getContext("2d");
  if (ctx && m.avatar) {
    const s = (size - 6) / 16;
    drawNpcAvatar(ctx, m.avatar, (size - 12 * s) / 2, 3, 12 * s, 16 * s, m.color, 1, { t: 0.4 });
  }
  return cv;
}

// ---- The cast list ----

export function castView(ctx: WriterContext): HTMLElement {
  const cast = buildCast(ctx.store.content);
  const wrap = el("div", {});
  wrap.append(el("div", { className: "st-card" },
    el("h2", { style: "margin:0 0 6px;color:#ffd166" }, "✍ The cast"),
    el("p", { style: "margin:0" },
      "Every resident, in the order the player meets them. Open one to read their whole arc top to bottom — " +
      "each room they appear in has its own lines, and one of those rooms carries their quest."),
    el("div", { className: "st-hint", style: "margin-top:6px" },
      "The Warden has his own page. Everything you write here is a draft until you publish; publishing only ever changes words and quests — never levels, art, or rules.")
  ));
  const grid = el("div", { className: "st-grid", style: "grid-template-columns:repeat(auto-fill,minmax(200px,1fr))" });
  for (const m of cast) {
    const health = castHealth(m);
    const questRoom = m.appearances.find((a) => isQuest(a.entity));
    grid.append(el("div", { className: "st-cardasset", onclick: () => ctx.openCharacter(m.npcId) },
      avatarCanvas(m, 56),
      el("div", { className: "st-name", style: "font-weight:600" }, m.name),
      el("div", { className: "st-dim" }, `${m.appearances.length} room${m.appearances.length === 1 ? "" : "s"}` +
        (questRoom ? ` · quest in ${questRoom.room.name ?? questRoom.room.id}` : " · no quest")),
      el("span", { className: `st-status ${health.level === "ok" ? "custom" : health.level === "warn" ? "animated" : "needs-art"}` },
        health.level === "ok" ? "reads clean" : health.empty ? `${health.empty} line${health.empty === 1 ? "" : "s"} missing` : health.level === "bad" ? "needs a look" : "worth a look")
    ));
  }
  wrap.append(grid);
  return wrap;
}

// ---- One character ----

export function characterView(ctx: WriterContext, npcId: string): HTMLElement {
  const content = ctx.store.content;
  const m = buildCast(content).find((c) => c.npcId === npcId);
  const wrap = el("div", {});
  if (!m) {
    wrap.append(el("div", { className: "st-note st-err" }, "That character isn't in any room."));
    return wrap;
  }
  const saveRoom = (room: RoomDef) => ctx.save(`rooms/${room.id}.json`, room);

  // Header: avatar, one display name that writes to every appearance (one
  // identity, however many rooms), the arc as a strip of room chips.
  const nameInput = el("input", {
    className: "st-search", value: m.name, style: "font-size:16px;font-weight:600;min-width:240px",
    onchange: async (e: Event) => {
      const v = (e.target as HTMLInputElement).value;
      for (const a of m.appearances) { a.entity.name = v; await saveRoom(a.room); }
      ctx.render();
    },
  });
  wrap.append(el("div", { className: "st-row" },
    el("button", { className: "st-btn st-quiet", onclick: () => ctx.openCast() }, "← The cast"),
    avatarCanvas(m, 40),
    nameInput,
    el("span", { className: "st-hint" }, `npcId ${m.npcId} · the name shows in every room they're in`),
  ));
  wrap.append(el("div", { className: "st-filters", style: "margin:4px 0 12px" },
    ...m.appearances.map((a, i) => el("span", { className: "st-chip" },
      `${i + 1}. ${a.room.name ?? a.room.id}${isQuest(a.entity) ? " ★" : ""}`))));

  for (const [i, a] of m.appearances.entries()) wrap.append(appearanceCard(ctx, m, a, i, saveRoom));
  return wrap;
}

function appearanceCard(
  ctx: WriterContext, m: CastMember, a: Appearance, index: number, saveRoom: (room: RoomDef) => Promise<void>
): HTMLElement {
  const content = ctx.store.content;
  const e = a.entity;
  const quest = isQuest(e);
  const card = el("div", { className: `st-card wr-appearance${quest ? " quest" : ""}` });

  card.append(el("div", { className: "st-row", style: "margin:0 0 4px" },
    el("b", { style: "font-size:15px" }, `${index + 1} · ${a.room.name ?? a.room.id}`),
    ...roleBadges(e).map((b) => el("span", { className: `wr-role${b.quest ? " quest" : ""}` }, b.text)),
    el("span", { className: "st-spacer" }),
    el("button", { className: "st-btn", title: "Close the studio and play this room with your draft lines",
      onclick: () => ctx.playRoom(a.room.id) }, "▶ Play this room")));

  // The four slots, each previewed through the real dialog box with this
  // appearance's own portrait. Which slots matter depends on the quest.
  const portrait = npcPortraitDrawer(e);
  const slots: { key: "dialogAsk" | "dialogConfirm" | "dialogDone" | "dialogAfter"; label: string; hint: string; required: boolean; confirm?: boolean }[] = [
    { key: "dialogAsk", label: "1 · First meeting", required: true,
      hint: quest ? "The pitch — what they want and why." : "Their only line here: this appearance has no quest." },
    { key: "dialogConfirm", label: "2 · Has the item", required: !!e.wants, confirm: true,
      hint: e.wants ? "Shown with the Give / Keep choice once the player is carrying it." : "Unused — this appearance isn't an item trade." },
    { key: "dialogDone", label: "3 · Just completed", required: quest,
      hint: quest ? "Right after the trade, this visit only. Where they teach their recipe." : "Unused — no quest here." },
    { key: "dialogAfter", label: "4 · Quest done", required: quest,
      hint: quest ? "Every later visit. One line, evergreen." : "Unused — no quest here." },
  ];
  for (const s of slots) {
    if (!quest && s.key !== "dialogAsk") continue; // don't show four boxes for a one-line cameo
    if (quest && s.key === "dialogConfirm" && !e.wants) continue;
    card.append(lineField({
      label: s.label, hint: s.hint, value: e[s.key] ?? "", kind: "dialog", required: s.required, roomId: a.room.id,
      onInput: (v) => { e[s.key] = v; void saveRoom(a.room); },
      preview: { type: "dialog", opts: {
        title: e.name || m.name, portrait,
        footer: s.confirm ? "E — give · Esc — keep it" : "E / Enter — close",
        confirmButtons: !!s.confirm,
      } },
    }));
  }

  // Quest & rewards + gating: the editor's own forms. `mutate` re-renders
  // the page (structural change); `edited` just saves (a keystroke).
  const form: QuestFormCtx = {
    sel: e, content, roomId: a.room.id,
    mutate: (fn) => { fn(); void saveRoom(a.room).then(() => ctx.render()); },
    edited: () => { void saveRoom(a.room); },
  };
  const questBox = el("div", { className: "wr-form" }, questTabEl(form));
  if (e.wants && !roomSuppliesItem(a.room, content, e.wants.item)) {
    questBox.prepend(el("div", { className: "st-note st-err" },
      `⚠ Nothing in ${a.room.name ?? a.room.id} gives the player ${e.wants.item} — no pickup, dispenser, or recipe — ` +
      "and inventory is confiscated between rooms. As written this quest can't be completed."));
  }
  card.append(el("details", { open: quest },
    el("summary", { style: "cursor:pointer;color:#ffd166;font-weight:600;margin:8px 0" }, "Quest & rewards"),
    questBox));
  card.append(el("details", {},
    el("summary", { style: "cursor:pointer;color:#ffd166;font-weight:600;margin:8px 0" }, "When they appear (spawn gating)"),
    el("div", { className: "wr-form" }, gatingTabEl(form)),
    el("div", { className: "st-hint" },
      "Pair scenes and the send-off only exist if the player earned them — a scene that doesn't trigger is never mentioned, " +
      "so never write a line that assumes another scene definitely happened.")));
  return card;
}
