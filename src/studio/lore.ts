// Writers Studio — the words that aren't spoken by a character: diary notes
// (the main lore channel, where the iceberg rules bite hardest), in-world
// hints, and the item / recipe one-liners.
import type { RoomDef, RoomEntity } from "../data/types";
import { el } from "../editor/forms";
import { drawItemIcon } from "../engine/renderer";
import { lineField } from "./linepreview";
import { campaignIndex } from "./characters";
import type { WriterContext } from "./writers";

interface Placed { room: RoomDef; entity: RoomEntity; order: number }

function placed(ctx: WriterContext, type: "note" | "hint"): Placed[] {
  const content = ctx.store.content;
  const out: Placed[] = [];
  for (const room of Object.values(content.rooms)) {
    for (const entity of room.entities) {
      if (entity.type === type) out.push({ room, entity, order: campaignIndex(content, room.id) });
    }
  }
  return out.sort((a, b) => a.order - b.order || a.entity.x - b.entity.x);
}

export function notesView(ctx: WriterContext): HTMLElement {
  const content = ctx.store.content;
  const wrap = el("div", {});
  wrap.append(el("div", { className: "st-card" },
    el("h2", { style: "margin:0 0 6px;color:#ffd166" }, "📜 Notes"),
    el("p", { style: "margin:0 0 6px" },
      "Diary scraps signed “Subject #NN”, found in the rooms. Each one teaches a recipe or a mechanic — the lore rides shotgun, " +
      "it never replaces the teaching."),
    el("div", { className: "st-hint" },
      "Numbers only go up, and stay below 67 — except the one note in the Exit Wing. One crack in the iceberg per room, at most, " +
      "and it should feel like wrongness (a rattle, a missing memory, a number too big), never exposition.")
  ));
  let lastRoom = "";
  for (const p of placed(ctx, "note")) {
    const roomName = p.room.name ?? p.room.id;
    if (roomName !== lastRoom) {
      wrap.append(el("div", { className: "st-grouphead" }, `${campaignIndex(content, p.room.id) + 1}. ${roomName}`));
      lastRoom = roomName;
    }
    const e = p.entity;
    const recipe = e.recipe ? content.recipes.find((r) => r.id === e.recipe) : undefined;
    const output = recipe ? content.items.find((i) => i.id === recipe.output) : undefined;
    const card = el("div", { className: "st-card wr-form" });
    card.append(
      el("div", { className: "st-row", style: "margin:0 0 4px" },
        el("span", { className: "st-hint" }, "teaches"),
        el("select", {
          onchange: (ev: Event) => {
            const v = (ev.target as HTMLSelectElement).value;
            if (v) e.recipe = v; else delete e.recipe;
            void ctx.save(`rooms/${p.room.id}.json`, p.room).then(() => ctx.render());
          },
        },
          el("option", { value: "", ...(e.recipe ? {} : { selected: true }) }, "nothing"),
          ...content.recipes.map((r) => el("option", { value: r.id, ...(r.id === e.recipe ? { selected: true } : {}) },
            `${r.output} (${r.inputs.join(" + ")})`))),
        el("span", { className: "st-spacer" }),
        el("button", { className: "st-btn", onclick: () => ctx.playRoom(p.room.id) }, "▶ Play this room")),
      lineField({
        label: "The note", value: e.text ?? "", kind: "note", required: true, roomId: p.room.id, rows: 5,
        onInput: (v) => { e.text = v; void ctx.save(`rooms/${p.room.id}.json`, p.room); },
        preview: { type: "dialog", opts: {
          title: "A note", titleColor: "#c9a86a",
          footer: output ? `Recipe: ${output.name}  ·  E / Enter — close` : "E / Enter — close",
        } },
      })
    );
    wrap.append(card);
  }
  return wrap;
}

export function hintsView(ctx: WriterContext): HTMLElement {
  const content = ctx.store.content;
  const wrap = el("div", {});
  wrap.append(el("div", { className: "st-card" },
    el("h2", { style: "margin:0 0 6px;color:#ffd166" }, "💡 Hints"),
    el("p", { style: "margin:0" },
      "Faint in-world tutorial text, drawn right on the level. Functional first; flavor only if it stays short. " +
      "Curly-brace tokens like {use} or {interact} become the player's actual button — keep them.")
  ));
  let lastRoom = "";
  for (const p of placed(ctx, "hint")) {
    const roomName = p.room.name ?? p.room.id;
    if (roomName !== lastRoom) {
      wrap.append(el("div", { className: "st-grouphead" }, `${campaignIndex(content, p.room.id) + 1}. ${roomName}`));
      lastRoom = roomName;
    }
    const e = p.entity;
    wrap.append(el("div", { className: "st-card wr-form", style: "padding:10px 16px" },
      el("div", { className: "st-row", style: "margin:0" },
        el("input", { type: "text", value: e.text ?? "", style: "flex:1",
          oninput: (ev: Event) => { e.text = (ev.target as HTMLInputElement).value; void ctx.save(`rooms/${p.room.id}.json`, p.room); } }),
        el("span", { className: "st-dim", style: "min-width:70px" }, `at ${e.x}, ${e.y}`))));
  }
  return wrap;
}

export function itemsView(ctx: WriterContext): HTMLElement {
  const content = ctx.store.content;
  const wrap = el("div", {});
  wrap.append(el("div", { className: "st-card" },
    el("h2", { style: "margin:0 0 6px;color:#ffd166" }, "🎒 Items & recipes"),
    el("p", { style: "margin:0" },
      "One-liners: what an item is, and what a recipe feels like. Prime joke real estate — “Goo on a board. Engineering peaked here.” " +
      "When a line describes what something does, it has to be accurate; check with Sean if unsure what an item currently does.")
  ));
  const saveItems = () => ctx.save("items.json", content.items);
  const saveRecipes = () => ctx.save("recipes.json", content.recipes);
  const itemsCard = el("div", { className: "st-card wr-form" }, el("b", { style: "font-size:15px" }, "Items"));
  for (const it of content.items) {
    const cv = el("canvas", { width: 36, height: 36, className: "st-thumb", style: "width:36px;height:36px" }) as HTMLCanvasElement;
    const c = cv.getContext("2d");
    if (c) { c.imageSmoothingEnabled = false; drawItemIcon(c, it, 18, 18, 2); }
    itemsCard.append(el("div", { className: "st-row", style: "margin:10px 0 0;align-items:flex-start" },
      cv,
      el("div", { style: "flex:1" },
        el("div", { style: "font-weight:600;margin-bottom:4px" }, it.name),
        el("input", { type: "text", value: it.description ?? "", placeholder: "One line — what is it, really?",
          oninput: (ev: Event) => { it.description = (ev.target as HTMLInputElement).value; void saveItems(); } }))));
  }
  wrap.append(itemsCard);
  const recipesCard = el("div", { className: "st-card wr-form" }, el("b", { style: "font-size:15px" }, "Recipes"));
  for (const r of content.recipes) {
    const out = content.items.find((i) => i.id === r.output);
    recipesCard.append(el("div", { className: "st-row", style: "margin:10px 0 0;align-items:flex-start" },
      el("div", { style: "min-width:200px" },
        el("div", { style: "font-weight:600" }, out?.name ?? r.output),
        el("div", { className: "st-dim" }, r.inputs.join(" + "))),
      el("input", { type: "text", value: r.flavor ?? "", style: "flex:1", placeholder: "One line — the joke",
        oninput: (ev: Event) => { r.flavor = (ev.target as HTMLInputElement).value; void saveRecipes(); } })));
  }
  wrap.append(recipesCard);
  return wrap;
}
