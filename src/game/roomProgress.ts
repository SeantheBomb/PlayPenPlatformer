// Generic "how many of tile/entity type X have been affected, out of how
// many exist in this room" queries — powers NPC room-quests and the
// room_progress achievement trigger. Deliberately derived, not persisted:
// tile changes already live in RoomMutations.tileOverrides (via
// RoomRuntime.setTileById) and entity open/lit state already lives in
// openedDoors/brazierLit, so progress for ANY room (visited or not, loaded
// or not) is fully reconstructable from those plus the room's raw def —
// no new RoomMutations field needed. See docs/HANDOFF.md room-progress note.
import type { Content, RoomDef } from "../data/types";
import type { RoomMutations } from "./state";
import { TileMap } from "../engine/tilemap";

export interface Progress {
  total: number;
  done: number;
}

/** How many tiles that were originally `tileId` in the room's authored
 *  layout are no longer that id. */
export function tileProgress(
  room: RoomDef, content: Content, muts: RoomMutations, tileId: string
): Progress {
  const map = new TileMap(room, content.tiles); // raw decode, no overrides
  const overrideAt = new Map(muts.tileOverrides);
  let total = 0, done = 0;
  for (let ty = 0; ty < room.height; ty++) {
    for (let tx = 0; tx < room.width; tx++) {
      if (map.at(tx, ty)?.id !== tileId) continue;
      total++;
      const idx = map.index(tx, ty);
      const nowId = overrideAt.has(idx) ? overrideAt.get(idx) : tileId;
      if (nowId !== tileId) done++;
    }
  }
  return { total, done };
}

/** How many entities of `entityType` in the room currently have `field`
 *  (open/lit) truthy, out of how many exist. */
export function entityProgress(
  room: RoomDef, muts: RoomMutations, entityType: string, field: "open" | "lit"
): Progress {
  let total = 0, done = 0;
  room.entities.forEach((e, idx) => {
    if (e.type !== entityType) return;
    total++;
    if (field === "open") {
      // Mirrors RoomRuntime's own open-state derivation (room.ts): a gate
      // authored startOpen counts as open until a fuse trip has touched it.
      const isGate = e.type === "door" || e.type === "trapdoor";
      const open = isGate && !muts.gateTouched.has(idx)
        ? !!e.startOpen
        : muts.openedDoors.has(idx);
      if (open) done++;
    } else {
      const lit = muts.brazierLit.find(([i]) => i === idx)?.[1] ?? e.lit ?? true;
      if (lit) done++;
    }
  });
  return { total, done };
}
