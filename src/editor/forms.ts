// Tiny DOM + auto-form helpers for the editor. Forms are generated from the
// current shape of the data, so new JSON fields show up without editor changes.
import type { Content } from "../data/types";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((ev: Event) => void)> = {},
  ...children: (HTMLElement | string | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") {
      node.addEventListener(k.replace(/^on/, ""), v as EventListener);
    } else if (k === "className") {
      node.className = String(v);
    } else if (k === "value" && "value" in node) {
      (node as HTMLInputElement).value = String(v);
    } else if (typeof v === "boolean") {
      if (v) node.setAttribute(k, "");
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null) continue;
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

const isColor = (v: unknown): v is string =>
  typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

/**
 * Maps well-known field key names — across every content schema — to the
 * list of currently-valid values, so autoForm can offer them as a filterable
 * dropdown (native <input list> + <datalist>: type to narrow, or open the
 * arrow for the full list) instead of a bare text field prone to typos.
 * Keyed by field name rather than schema, since the same name (item, enemy,
 * element...) always references the same list everywhere it appears. The one
 * genuine collision — "trigger" means different things on taunts vs.
 * achievements — is resolved by offering the union of both; the field stays
 * free text, so an unmatched suggestion never blocks saving.
 */
export function fieldOptionsFor(content: Content): (key: string) => string[] | undefined {
  const itemIds = content.items.map((i) => i.id);
  const roomIds = Object.keys(content.rooms);
  const elementIds = content.elements.map((e) => e.id);
  const enemyIds = content.enemies.map((e) => e.id);
  const tileIds = ["", ...content.tiles.map((t) => t.id)]; // "" = becomes empty/none
  const recipeIds = content.recipes.map((r) => r.id);

  const map: Record<string, string[]> = {
    // References to other content definitions
    item: itemIds, itemId: itemIds, igniteTo: itemIds, dousesTo: itemIds,
    fillsTo: itemIds, emptiesTo: itemIds, output: itemIds,
    to: [...roomIds, "next"], roomId: roomIds,
    element: elementIds, actor: elementIds, target: elementIds, dousedBy: elementIds,
    enemy: enemyIds,
    burnsTo: tileIds, meltsTo: tileIds, freezesTo: tileIds,
    shattersTo: tileIds, dissolvesTo: tileIds, extinguishesTo: tileIds,
    fallSpawns: tileIds, dropsItem: itemIds,
    recipe: recipeIds,
    // Closed enums from the schema itself
    kind: ["material", "tool", "consumable", "curio"],
    shape: ["shard", "plank", "ring", "cloth", "ball", "mushroom", "cog",
      "spring", "coil", "tool", "bottle", "torch", "bucket", "rod"],
    useMode: ["swing", "splash", "place", "burst"],
    placeType: ["spring", "trap"],
    effect: ["ignite", "melt", "extinguish", "dissolve", "freeze", "shatter",
      "energize", "ignite_self", "fizzle"],
    targetProperty: ["flammable", "brittle", "conductive"],
    behavior: ["patrol", "chase"],
    style: ["block", "platform", "spikes", "cracked", "spring", "goo",
      "wood", "ice", "water", "fire", "metal", "waterfall", "drain",
      "lava", "lavafall"],
    trigger: ["game_start", "room_enter", "first_death", "death", "craft_fail",
      "first_craft", "craft_item", "idle", "hide_enter", "npc_help",
      "confiscate", "warden_chase", "win", "pickup_item", "counter"],
    emotion: ["smug", "gleeful", "annoyed", "bored", "shocked", "proud"],
  };
  return (key) => map[key];
}

let datalistSeq = 0;

/**
 * Build editable fields for every property of `obj`, writing changes back
 * into `obj` in place. `onChange` fires after any edit. `fieldOptions`
 * (see fieldOptionsFor) turns matching string fields into filterable
 * dropdowns instead of bare text inputs.
 */
export function autoForm(
  obj: Record<string, unknown>,
  onChange: () => void,
  skipKeys: string[] = [],
  onBefore?: () => void,
  fieldOptions?: (key: string) => string[] | undefined
): HTMLElement {
  const wrap = el("div", { className: "pp-form" });
  if (onBefore) {
    // Capture phase: runs before the field handlers mutate `obj`,
    // so undo snapshots capture the pre-edit state.
    wrap.addEventListener("input", () => onBefore(), true);
    wrap.addEventListener("change", () => onBefore(), true);
  }
  for (const key of Object.keys(obj)) {
    if (skipKeys.includes(key)) continue;
    const val = obj[key];
    const row = el("div", { className: "pp-row" });
    const label = el("label", {}, key);
    row.append(label);

    if (typeof val === "number") {
      row.append(
        el("input", {
          type: "number", step: "any", value: val,
          oninput: (e) => {
            const n = parseFloat((e.target as HTMLInputElement).value);
            if (!Number.isNaN(n)) { obj[key] = n; onChange(); }
          },
        })
      );
    } else if (typeof val === "boolean") {
      row.append(
        el("input", {
          type: "checkbox", ...(val ? { checked: true } : {}),
          onchange: (e) => {
            obj[key] = (e.target as HTMLInputElement).checked;
            onChange();
          },
        })
      );
    } else if (isColor(val)) {
      const picker = el("input", {
        type: "color", value: val,
        oninput: (e) => {
          obj[key] = (e.target as HTMLInputElement).value;
          text.value = obj[key] as string;
          onChange();
        },
      });
      const text = el("input", {
        type: "text", value: val, className: "pp-colortext",
        oninput: (e) => {
          const v = (e.target as HTMLInputElement).value;
          if (isColor(v)) { obj[key] = v; picker.value = v; onChange(); }
        },
      });
      row.append(picker, text);
    } else if (typeof val === "string") {
      const options = fieldOptions?.(key);
      if (options && options.length > 0) {
        const listId = `pp-dl-${++datalistSeq}`;
        row.append(
          el("input", {
            type: "text", value: val, list: listId,
            oninput: (e) => {
              obj[key] = (e.target as HTMLInputElement).value;
              onChange();
            },
          }),
          el("datalist", { id: listId }, ...options.map((o) => el("option", { value: o })))
        );
      } else {
        const long = val.length > 42;
        row.append(
          el(long ? "textarea" : "input", {
            ...(long ? { rows: 3 } : { type: "text" }),
            value: val,
            oninput: (e) => {
              obj[key] = (e.target as HTMLInputElement).value;
              onChange();
            },
          })
        );
      }
    } else if (Array.isArray(val) && val.every((v) => typeof v === "string")) {
      row.append(
        el("textarea", {
          rows: Math.min(6, Math.max(2, val.length + 1)),
          value: (val as string[]).join("\n"),
          title: "one entry per line",
          oninput: (e) => {
            obj[key] = (e.target as HTMLTextAreaElement).value
              .split("\n").map((s) => s.trim()).filter(Boolean);
            onChange();
          },
        })
      );
    } else if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const fs = el("fieldset", {}, el("legend", {}, key));
      fs.append(autoForm(val as Record<string, unknown>, onChange, [], onBefore, fieldOptions));
      wrap.append(fs);
      continue;
    } else {
      // Arrays of objects / nulls: raw JSON editing
      row.append(
        el("textarea", {
          rows: 4, className: "pp-json",
          value: JSON.stringify(val, null, 1),
          oninput: (e) => {
            try {
              obj[key] = JSON.parse((e.target as HTMLTextAreaElement).value);
              (e.target as HTMLElement).classList.remove("pp-bad");
              onChange();
            } catch {
              (e.target as HTMLElement).classList.add("pp-bad");
            }
          },
        })
      );
    }
    wrap.append(row);
  }
  return wrap;
}

export function toast(msg: string, ok = true): void {
  const t = el("div", { className: "pp-toast" + (ok ? "" : " pp-toast-bad") }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}
