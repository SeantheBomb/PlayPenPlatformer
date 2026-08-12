// The Art Studio's asset registry: one flat, auto-derived list of every
// art slot in the game — what it's called, how big it draws in-game, what
// art it currently has, and how to read/write that art back into content.
// Deriving everything from live content means the tracking list can never
// go stale: add a tile in the editor and it appears here needing art.
import type { ContentStore } from "../data/content";
import type {
  Content, EnemyDef, EntityTypeDef, ItemDef, RoomDef, RoomEntity,
  SpriteFields, TileDef, WardenEmotion,
} from "../data/types";
import {
  currentFrame, drawBlob, drawEntityPreview, drawItemIcon, drawNpcAvatar,
  drawTile, getImage, PREVIEWABLE_ALT_ENTITY_KINDS, PREVIEWABLE_ENTITY_KINDS,
} from "../engine/renderer";

export type AssetGroup = "Tiles" | "Items" | "Enemies" | "Characters" | "Objects";
export const GROUP_ORDER: AssetGroup[] = ["Characters", "Tiles", "Objects", "Items", "Enemies"];

export interface AssetArt {
  frames: string[];
  fps: number;
  /** Secondary-state art where the slot supports one (open door, unlit
   *  brazier…) — always a single still. */
  alt?: string;
}

export interface ArtAsset {
  key: string;
  group: AssetGroup;
  label: string;
  sublabel?: string;
  drawnW: number;
  drawnH: number;
  /** Present when this slot supports secondary-state art ("Open", "Unlit"…). */
  altLabel?: string;
  /** Portraits and alt slots are stills; false = no animation UI. */
  animatable: boolean;
  read(): AssetArt;
  write(art: AssetArt): Promise<void>;
  clear(): Promise<void>;
  /** Draw the CURRENT look (custom art, else procedural, else placeholder)
   *  into a cell×cell box. */
  drawCurrent(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number): void;
  /** Same, but for the SECOND state (open door, tripped fusebox, …) —
   *  only present when altLabel is. Falls back to the procedural alt look
   *  when no custom alt art is set yet, so the second-look slot is never
   *  just a blank swatch. */
  drawAlt?(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number): void;
}

export function assetStatus(a: ArtAsset): "needs-art" | "custom" | "animated" {
  const art = a.read();
  if (art.frames.length > 1) return "animated";
  if (art.frames.length === 1 || art.alt) return "custom";
  return "needs-art";
}

const spriteArt = (s: SpriteFields & { spriteAlt?: string }): AssetArt => ({
  frames: s.spriteFrames?.length ? [...s.spriteFrames] : s.sprite ? [s.sprite] : [],
  fps: s.spriteFps ?? 6,
  alt: s.spriteAlt,
});

function applySpriteArt(s: SpriteFields & { spriteAlt?: string }, art: AssetArt, withAlt: boolean): void {
  delete s.sprite;
  delete s.spriteFrames;
  delete s.spriteFps;
  if (art.frames.length > 1) {
    s.spriteFrames = art.frames;
    s.spriteFps = art.fps;
  } else if (art.frames.length === 1) {
    s.sprite = art.frames[0];
  }
  if (withAlt) {
    if (art.alt) s.spriteAlt = art.alt;
    else delete s.spriteAlt;
  }
}

function drawUri(ctx: CanvasRenderingContext2D, uri: string, x: number, y: number, cell: number): boolean {
  const img = getImage(uri);
  if (!img) return false;
  ctx.imageSmoothingEnabled = false;
  // Fit, preserving the art's own aspect inside the cell.
  const s = Math.min(cell / img.naturalWidth, cell / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  ctx.drawImage(img, x + (cell - w) / 2, y + (cell - h) / 2, w, h);
  return true;
}

function drawSpriteOr(
  s: SpriteFields,
  fallback: (ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) => void
) {
  return (ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) => {
    const uri = currentFrame(s);
    if (uri && drawUri(ctx, uri, x, y, cell)) return;
    fallback(ctx, x, y, cell);
  };
}

/** Neutral placeholder for slots whose procedural look lives deep in the
 *  game loop (entities): a labeled box, honest about "no art yet". */
function placeholder(label: string) {
  return (ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) => {
    ctx.strokeStyle = "#5a5080";
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x + 4.5, y + 4.5, cell - 9, cell - 9);
    ctx.setLineDash([]);
    ctx.fillStyle = "#8f87ad";
    ctx.font = `${Math.max(8, cell / 5)}px monospace`;
    const short = label.slice(0, 6);
    ctx.fillText(short, x + cell / 2 - ctx.measureText(short).width / 2, y + cell / 2 + 3);
  };
}

/** Friendly names for entity types + which secondary state they support. */
const ENTITY_META: Record<string, { label: string; alt?: string }> = {
  door: { label: "Door (gate)", alt: "Open" },
  trapdoor: { label: "Trapdoor", alt: "Open" },
  locker: { label: "Hiding Locker", alt: "Occupied (optional)" },
  note: { label: "Note / Recipe Scrap" },
  checkpoint: { label: "Checkpoint Flag", alt: "Active" },
  brazier: { label: "Brazier (lit)", alt: "Unlit / cold" },
  fusebox: { label: "Fusebox", alt: "Tripped (green)" },
  capacitor: { label: "Capacitor (off)", alt: "Powered on" },
  exit: { label: "Exit Door" },
  source: { label: "Dispenser Machine" },
  converter: { label: "Converter Machine" },
};
const SKIP_ENTITY_IDS = new Set(["pickup", "npc", "hint"]); // art comes from elsewhere

export const WARDEN_EMOTIONS: WardenEmotion[] = ["smug", "gleeful", "annoyed", "bored", "shocked", "proud"];

export function buildAssets(store: ContentStore): ArtAsset[] {
  const c = store.content;
  const assets: ArtAsset[] = [];
  const saveArr = (file: string, arr: unknown) => store.saveFile(file, arr);

  // ---- Characters ----
  const player = c.game.player;
  assets.push({
    key: "player", group: "Characters", label: "The Player", sublabel: "Subject #67",
    drawnW: player.width, drawnH: player.height, animatable: true,
    read: () => spriteArt(player),
    write: async (art) => { applySpriteArt(player, art, false); await store.saveFile("game.json", c.game); },
    clear: async () => { applySpriteArt(player, { frames: [], fps: 6 }, false); await store.saveFile("game.json", c.game); },
    drawCurrent: drawSpriteOr(player, (ctx, x, y, cell) => {
      const s = (cell - 8) / 14;
      drawBlob(ctx, x + (cell - 12 * s) / 2, y + (cell - 14 * s) / 2, 12 * s, 14 * s, player.color, player.eyeColor, 1, {});
    }),
  });
  const warden = c.game.antagonist;
  assets.push({
    key: "warden", group: "Characters", label: "The Warden", sublabel: "boss chase body",
    drawnW: 52, drawnH: 44, animatable: true,
    read: () => spriteArt(warden),
    write: async (art) => { applySpriteArt(warden, art, false); await store.saveFile("game.json", c.game); },
    clear: async () => { applySpriteArt(warden, { frames: [], fps: 6 }, false); await store.saveFile("game.json", c.game); },
    drawCurrent: drawSpriteOr(warden, (ctx, x, y, cell) => {
      const s = (cell - 8) / 52;
      drawBlob(ctx, x + 4, y + (cell - 44 * s) / 2, 52 * s, 44 * s, warden.color, "#2a1020", 1, {});
    }),
  });
  for (const emo of WARDEN_EMOTIONS) {
    assets.push({
      key: `warden-portrait:${emo}`, group: "Characters",
      label: `Warden face — ${emo}`, sublabel: "taunt banner portrait",
      drawnW: 32, drawnH: 32, animatable: false,
      read: () => ({ frames: warden.portraits?.[emo] ? [warden.portraits[emo]!] : [], fps: 6 }),
      write: async (art) => {
        warden.portraits = { ...(warden.portraits ?? {}) };
        if (art.frames[0]) warden.portraits[emo] = art.frames[0];
        else delete warden.portraits[emo];
        await store.saveFile("game.json", c.game);
      },
      clear: async () => {
        if (warden.portraits) delete warden.portraits[emo];
        await store.saveFile("game.json", c.game);
      },
      drawCurrent: (ctx, x, y, cell) => {
        const uri = warden.portraits?.[emo];
        if (uri && drawUri(ctx, uri, x, y, cell)) return;
        placeholder(emo)(ctx, x, y, cell);
      },
    });
  }
  // NPCs — grouped by stable npcId. The SAME character appears in several
  // rooms (priya is in three), so each npcId gets ONE card and every write
  // fans out to every room instance — the artist skins the character, not
  // one room's copy of them.
  const npcInstances = new Map<string, { room: RoomDef; e: RoomEntity }[]>();
  for (const room of Object.values(c.rooms)) {
    for (const e of room.entities) {
      if (e.type !== "npc" || !e.npcId) continue;
      const list = npcInstances.get(e.npcId) ?? [];
      list.push({ room, e });
      npcInstances.set(e.npcId, list);
    }
  }
  for (const [npcId, instances] of npcInstances) {
    const first = instances[0].e;
    const name = first.name ?? npcId;
    const roomNames = instances.map((i) => i.room.name ?? i.room.id).join(", ");
    const saveAll = async () => {
      for (const { room } of instances) await saveRoom(store, room, `rooms/${room.id}.json`);
    };
    const fallback = (ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) => {
      if (first.avatar) {
        const s = (cell - 8) / 16;
        drawNpcAvatar(ctx, first.avatar, x + (cell - 12 * s) / 2, y + 4, 12 * s, 16 * s, first.color ?? "#7fd8e8", 1, {});
      } else placeholder(name)(ctx, x, y, cell);
    };
    assets.push({
      key: `npc:${npcId}`, group: "Characters",
      label: `${name} — body`, sublabel: `NPC in ${roomNames}`,
      drawnW: 12, drawnH: 16, animatable: true,
      read: () => spriteArt(first),
      write: async (art) => {
        for (const { e } of instances) applySpriteArt(e, art, false);
        await saveAll();
      },
      clear: async () => {
        for (const { e } of instances) applySpriteArt(e, { frames: [], fps: 6 }, false);
        await saveAll();
      },
      drawCurrent: drawSpriteOr(first, fallback),
    });
    assets.push({
      key: `npc-portrait:${npcId}`, group: "Characters",
      label: `${name} — dialog face`, sublabel: `NPC in ${roomNames}`,
      drawnW: 32, drawnH: 32, animatable: false,
      read: () => ({ frames: first.portrait ? [first.portrait] : [], fps: 6 }),
      write: async (art) => {
        for (const { e } of instances) {
          if (art.frames[0]) e.portrait = art.frames[0];
          else delete e.portrait;
        }
        await saveAll();
      },
      clear: async () => {
        for (const { e } of instances) delete e.portrait;
        await saveAll();
      },
      drawCurrent: (ctx, x, y, cell) => {
        if (first.portrait && drawUri(ctx, first.portrait, x, y, cell)) return;
        fallback(ctx, x, y, cell);
      },
    });
  }

  // ---- Tiles ----
  for (const t of c.tiles) {
    assets.push({
      key: `tile:${t.id}`, group: "Tiles", label: t.name, sublabel: `tile '${t.char}'`,
      drawnW: 16, drawnH: 16, animatable: true,
      read: () => spriteArt(t),
      write: async (art) => { applySpriteArt(t, art, false); await saveArr("tiles.json", c.tiles); },
      clear: async () => { applySpriteArt(t, { frames: [], fps: 6 }, false); await saveArr("tiles.json", c.tiles); },
      drawCurrent: (ctx, x, y, cell) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(cell / 16, cell / 16);
        drawTile(ctx, t, 0, 0, performance.now() / 1000);
        ctx.restore();
      },
    });
  }

  // ---- Objects (entity types) ----
  // drawEntityPreview's internal geometry uses hardcoded pixel offsets
  // (matching room.ts's real draw code, which only ever runs at native 1:1
  // scale) — passing it an ENLARGED w/h scales only the outer box while
  // those offsets stay tiny, scattering flames/bolts/coals off in a
  // corner. Scale the canvas transform uniformly instead (same trick
  // drawTile's thumbnail already uses) so every offset scales together.
  const drawEntityPreviewScaled = (ctx: CanvasRenderingContext2D, kind: string, w: number, h: number, x: number, y: number, cell: number, alt: boolean) => {
    const s = (cell - 8) / Math.max(w, h);
    ctx.save();
    ctx.translate(x + cell / 2 - (w * s) / 2, y + cell / 2 - (h * s) / 2);
    ctx.scale(s, s);
    drawEntityPreview(ctx, kind, 0, 0, w, h, undefined, alt);
    ctx.restore();
  };
  for (const et of c.entityTypes) {
    if (SKIP_ENTITY_IDS.has(et.id)) continue;
    const meta = ENTITY_META[et.id] ?? { label: et.id };
    assets.push({
      key: `entity:${et.id}`, group: "Objects", label: meta.label,
      sublabel: et.note ? undefined : undefined,
      drawnW: et.width, drawnH: et.height, altLabel: meta.alt, animatable: true,
      read: () => spriteArt(et),
      write: async (art) => { applySpriteArt(et, art, true); await saveArr("entities.json", c.entityTypes); },
      clear: async () => { applySpriteArt(et, { frames: [], fps: 6 }, true); await saveArr("entities.json", c.entityTypes); },
      // The real procedural look (same drawing code the game itself uses
      // for these kinds — see engine/renderer.ts drawEntityPreview and
      // room.ts's drawEntity, which calls the live version of the same
      // cases) instead of a generic placeholder box.
      drawCurrent: drawSpriteOr(
        et,
        PREVIEWABLE_ENTITY_KINDS.has(et.id)
          ? (ctx, x, y, cell) => drawEntityPreviewScaled(ctx, et.id, et.width, et.height, x, y, cell, false)
          : placeholder(et.id)
      ),
      drawAlt: meta.alt ? (ctx, x, y, cell) => {
        const art = spriteArt(et);
        if (art.alt && drawUri(ctx, art.alt, x, y, cell)) return;
        if (PREVIEWABLE_ALT_ENTITY_KINDS.has(et.id)) {
          drawEntityPreviewScaled(ctx, et.id, et.width, et.height, x, y, cell, true);
        } else {
          placeholder(et.id)(ctx, x, y, cell);
        }
      } : undefined,
    });
  }

  // ---- Items ----
  for (const it of c.items) {
    assets.push({
      key: `item:${it.id}`, group: "Items", label: it.name, sublabel: it.kind,
      drawnW: 16, drawnH: 16, animatable: true,
      read: () => spriteArt(it),
      write: async (art) => { applySpriteArt(it, art, false); await saveArr("items.json", c.items); },
      clear: async () => { applySpriteArt(it, { frames: [], fps: 6 }, false); await saveArr("items.json", c.items); },
      drawCurrent: (ctx, x, y, cell) => drawItemIcon(ctx, it, x + cell / 2, y + cell / 2, cell / 18),
    });
  }

  // ---- Enemies ----
  for (const en of c.enemies) {
    assets.push({
      key: `enemy:${en.id}`, group: "Enemies", label: en.name, sublabel: en.description?.slice(0, 40),
      drawnW: en.width, drawnH: en.height, animatable: true,
      read: () => spriteArt(en),
      write: async (art) => { applySpriteArt(en, art, false); await saveArr("enemies.json", c.enemies); },
      clear: async () => { applySpriteArt(en, { frames: [], fps: 6 }, false); await saveArr("enemies.json", c.enemies); },
      drawCurrent: drawSpriteOr(en, (ctx, x, y, cell) => {
        const s = (cell - 10) / Math.max(en.width, en.height);
        drawBlob(ctx, x + (cell - en.width * s) / 2, y + (cell - en.height * s) / 2,
          en.width * s, en.height * s, en.color, en.eyeColor, 1, {});
      }),
    });
  }

  return assets;
}

async function saveRoom(store: ContentStore, room: RoomDef, file: string): Promise<void> {
  await store.saveFile(file, room);
}

// Re-exported for the studio's typecheck convenience.
export type { Content, TileDef, ItemDef, EnemyDef, EntityTypeDef, RoomEntity };
