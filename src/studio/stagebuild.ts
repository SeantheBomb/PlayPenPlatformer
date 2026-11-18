// Preview stages, the pure half (no DOM): turn a vfx.json stage + the tile or
// item being previewed into a real one-room level the actual game can run
// (src/studio/stage.ts runs it in a replay-mode Game). tests/vfx-stages.test.ts
// proves every default stage raises the moments it claims, with the same
// builder — so a preview is never a drawing of an effect, it's the effect
// happening in the engine.
import type { Content, ItemDef, RoomDef, RoomEntity, TileDef, VfxStage } from "../data/types";
import { itemMoments, tileMoments } from "../game/vfxmoments";

export const STAGE_ROOM_ID = "__stage";

/** Moments that need the player in the stage to happen at all. */
export const PLAYER_MOMENTS = new Set(["bounce", "land", "enter", "exit"]);

export type StageSubject = { kind: "tile"; def: TileDef } | { kind: "item"; def: ItemDef };

export interface BuiltStage {
  room: RoomDef;
  /** The previewed cell (the '@'). */
  at: { tx: number; ty: number } | null;
  /** A placed item standing in the '@' cell (placed Spring). */
  placed?: { type: "spring" | "trap"; x: number; y: number };
  /** Element applied on the stage's `apply` beat (element moments). */
  actor?: string;
  /** Applied half a second before `actor` (a tile must burn to be put out). */
  prime?: string;
  errors: string[];
}

/** Painter aliases on top of tiles.json chars. */
export const STAGE_ALIASES: Record<string, string> = { "~": "water" };

function sourceTileFor(tiles: TileDef[], element: string): TileDef | undefined {
  // Something that radiates the element passively: a fire tile, a lava pool…
  return tiles.find((t) => t.element === element && (t.spreads || t.style === "fire"))
    ?? tiles.find((t) => t.element === element && t.fluid)
    ?? tiles.find((t) => t.element === element);
}

export function subjectMoments(content: Pick<Content, "rules">, s: StageSubject) {
  return s.kind === "tile" ? tileMoments(content, s.def) : itemMoments(s.def);
}

export function buildStage(
  content: Pick<Content, "tiles" | "rules">,
  stage: VfxStage,
  subject: StageSubject,
  moment: string
): BuiltStage {
  const errors: string[] = [];
  const byChar = new Map(content.tiles.map((t) => [t.char, t]));
  const byId = new Map(content.tiles.map((t) => [t.id, t]));
  const mInfo = subjectMoments(content, subject).find((m) => m.key === moment);
  const actor = mInfo?.actor;
  const prime = mInfo?.prime;
  const width = Math.max(...stage.rows.map((r) => r.length));
  let at: BuiltStage["at"] = null;
  let spawn: { x: number; y: number } | null = null;
  const rows = stage.rows.map((row, ty) => {
    let out = "";
    for (let tx = 0; tx < width; tx++) {
      const ch = row[tx] ?? ".";
      if (ch === "@") {
        if (!at) at = { tx, ty };
        out += subject.kind === "tile" ? subject.def.char : ".";
      } else if (ch === "P") {
        spawn ??= { x: tx, y: ty };
        out += ".";
      } else if (ch === "E") {
        const src = actor ? sourceTileFor(content.tiles, actor) : undefined;
        out += src?.char ?? ".";
      } else if (STAGE_ALIASES[ch]) {
        out += byId.get(STAGE_ALIASES[ch])?.char ?? ".";
      } else if (ch === "." || ch === " ") {
        out += ".";
      } else if (byChar.has(ch)) {
        out += ch;
      } else {
        errors.push(`"${ch}" isn't a tile`);
        out += ".";
      }
    }
    return out;
  });
  if (!at) errors.push("No @ — mark where the tile goes.");
  if (PLAYER_MOMENTS.has(moment) && !spawn) errors.push("This moment needs the player — paint a P.");
  if (!spawn) {
    // Somewhere harmless for the player to stand: the first open cell with
    // floor under it, from the left.
    outer: for (let ty = 0; ty < rows.length - 1; ty++) {
      for (let tx = 0; tx < width; tx++) {
        if (rows[ty][tx] === "." && byChar.get(rows[ty + 1][tx])?.solid) { spawn = { x: tx, y: ty }; break outer; }
      }
    }
  }
  const entities: RoomEntity[] = [{ type: "spawn", x: spawn?.x ?? 1, y: spawn?.y ?? 1 } as RoomEntity];
  const placed = subject.kind === "item" && subject.def.placeType && at
    ? { type: subject.def.placeType, x: (at as { tx: number }).tx * 16, y: (at as { ty: number }).ty * 16 + 8 }
    : undefined;
  const room = {
    id: STAGE_ROOM_ID, name: stage.name, width, height: rows.length,
    background: "#1b1726", tiles: rows, entities,
  } as RoomDef;
  return { room, at, placed, actor, prime, errors };
}

/** Which stage previews `moment` for this subject: its own pick, else the
 *  first stage built for that moment. */
export function stageFor(
  stages: VfxStage[],
  def: { vfxStage?: Record<string, string> },
  moment: string
): VfxStage | undefined {
  const pick = def.vfxStage?.[moment];
  return (pick && stages.find((s) => s.id === pick)) || stages.find((s) => s.moments?.includes(moment));
}

/** Rooms where this tile appears, with its first cell — "a real spot". */
export function realSpots(content: Pick<Content, "rooms" | "campaign">, tile: TileDef): { roomId: string; name: string; tx: number; ty: number; count: number }[] {
  const out: { roomId: string; name: string; tx: number; ty: number; count: number }[] = [];
  const order = [...(content.campaign?.rooms ?? []), ...Object.keys(content.rooms)];
  for (const id of [...new Set(order)]) {
    const r = content.rooms[id];
    if (!r) continue;
    let first: { tx: number; ty: number } | null = null;
    let count = 0;
    r.tiles.forEach((row, ty) => {
      for (let tx = 0; tx < row.length; tx++) if (row[tx] === tile.char) { count++; first ??= { tx, ty }; }
    });
    if (first) {
      const spot = first as { tx: number; ty: number };
      // A fall is framed where it lands, not where it starts: rooms author
      // only its head, and it grows down through open cells at runtime.
      if (tile.fallSpawns) {
        while ([tile.char, "."].includes(r.tiles[spot.ty + 1]?.[spot.tx] ?? "#")) spot.ty++;
      }
      out.push({ roomId: id, name: r.name, ...spot, count });
    }
  }
  return out;
}

/** The most copies of this tile inside one screen (40×23 tiles), over every
 *  room — what an "Always" effect really costs in the worst place. */
export function worstScreenCount(content: Pick<Content, "rooms">, char: string, vw = 40, vh = 23): { count: number; roomId: string | null } {
  let best = { count: 0, roomId: null as string | null };
  for (const r of Object.values(content.rooms)) {
    const H = r.tiles.length, W = Math.max(0, ...r.tiles.map((x) => x.length));
    // 2D prefix sums.
    const P = Array.from({ length: H + 1 }, () => new Int32Array(W + 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      P[y + 1][x + 1] = (r.tiles[y][x] === char ? 1 : 0) + P[y][x + 1] + P[y + 1][x] - P[y][x];
    }
    const wx = Math.min(vw, W), wy = Math.min(vh, H);
    for (let y = 0; y + wy <= H; y++) for (let x = 0; x + wx <= W; x++) {
      const n = P[y + wy][x + wx] - P[y][x + wx] - P[y + wy][x] + P[y][x];
      if (n > best.count) best = { count: n, roomId: r.id };
    }
  }
  return best;
}
