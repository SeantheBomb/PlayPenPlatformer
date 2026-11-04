// Which levels each art asset shows up in (Miranda's ask, 2026-11-04: filter
// the gallery by level). PURE — no DOM — and pinned by tests/asset-levels.
// test.ts. Keys match the gallery's ArtAsset keys (tile:<id>, item:<id>,
// entity:<type>, enemy:<id>, npc:<npcId>, npc-portrait:<npcId>, player,
// warden, warden-portrait:<emotion>).
//
// "Appears in" means anything the player can SEE there, not just what was
// placed: a tile reached by a transform (wall → burning → ash, cracked stone
// → lava), a fall's spawned fluid, an item dropped by a tile, handed out by a
// source / converter / resident / checkpoint, or craftable from what the room
// supplies. Spawn gating (requiresHelped) is ignored — the art has to exist
// for every run that could show it.
import type { Content, ItemDef, RoomDef, TileDef } from "../data/types";
import { WARDEN_EMOTIONS } from "./assets";

const TILE_LINKS = ["burnsTo", "meltsTo", "freezesTo", "shattersTo", "dissolvesTo", "extinguishesTo", "fallSpawns"] as const;
const ITEM_LINKS = ["dousesTo", "igniteTo", "emptiesTo"] as const;

/** Rooms in campaign order, then any room the campaign doesn't list. */
export function levelOrder(c: Content): { id: string; name: string }[] {
  const listed = (c.campaign?.rooms ?? []).filter((id) => c.rooms[id]);
  const rest = Object.keys(c.rooms).filter((id) => !listed.includes(id)).sort();
  return [...listed, ...rest].map((id) => ({ id, name: c.rooms[id].name || id }));
}

/** Asset key → the room ids it appears in. Keys absent = not in any level. */
export function assetLevels(c: Content): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (key: string, roomId: string) => {
    let s = out.get(key);
    if (!s) out.set(key, (s = new Set()));
    s.add(roomId);
  };
  const tileByChar = new Map<string, TileDef>();
  for (const t of c.tiles) if (t.char) tileByChar.set(t.char, t);
  const tileById = new Map(c.tiles.map((t) => [t.id, t]));
  const itemById = new Map<string, ItemDef>(c.items.map((i) => [i.id, i]));

  for (const room of Object.values(c.rooms) as RoomDef[]) {
    const id = room.id;
    // Everyone sees the player; the Warden talks (portraits) in every room
    // and chases in person only where the room says so.
    add("player", id);
    for (const emo of WARDEN_EMOTIONS) add(`warden-portrait:${emo}`, id);
    if (room.wardenChase) add("warden", id);

    // ---- tiles: placed, then everything they can turn into ----
    const tiles = new Set<string>();
    for (const row of room.tiles ?? []) {
      for (const ch of row) {
        const t = tileByChar.get(ch);
        if (t) tiles.add(t.id);
      }
    }
    const items = new Set<string>();
    const tileQueue = [...tiles];
    while (tileQueue.length) {
      const t = tileById.get(tileQueue.pop()!);
      if (!t) continue;
      if (t.dropsItem) items.add(t.dropsItem);
      for (const f of TILE_LINKS) {
        const next = t[f];
        if (typeof next === "string" && tileById.has(next) && !tiles.has(next)) {
          tiles.add(next);
          tileQueue.push(next);
        }
      }
    }
    for (const t of tiles) add(`tile:${t}`, id);

    // ---- entities, enemies, residents, and the items they hand out ----
    for (const e of room.entities ?? []) {
      add(`entity:${e.type}`, id);
      if (e.type === "enemy" && e.enemy) add(`enemy:${e.enemy}`, id);
      if (e.type === "npc" && e.npcId) {
        add(`npc:${e.npcId}`, id);
        add(`npc-portrait:${e.npcId}`, id);
      }
      if (e.item) items.add(e.item);
      if (e.sourceItem) items.add(e.sourceItem);
      if (e.convertInput) items.add(e.convertInput);
      if (e.convertOutput) items.add(e.convertOutput);
      if (e.wants?.item) items.add(e.wants.item);
      for (const r of e.rewardItems ?? []) items.add(r.item);
      for (const l of e.loadout ?? []) items.add(l.item);
    }

    // ---- items: what the room supplies, its transforms, and crafting ----
    for (let grew = true; grew; ) {
      grew = false;
      for (const it of [...items]) {
        const def = itemById.get(it);
        if (!def) continue;
        for (const f of ITEM_LINKS) {
          const next = def[f];
          if (typeof next === "string" && !items.has(next)) { items.add(next); grew = true; }
        }
      }
      for (const r of c.recipes) {
        if (!items.has(r.output) && r.inputs.length && r.inputs.every((i) => items.has(i))) {
          items.add(r.output);
          grew = true;
        }
      }
    }
    for (const it of items) if (itemById.has(it)) add(`item:${it}`, id);
  }
  return out;
}
