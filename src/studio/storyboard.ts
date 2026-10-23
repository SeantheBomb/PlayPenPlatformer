// Master Script storyboard frames — drawn by the REAL room renderer (the
// same drawMap + RoomRuntime.draw the game and the room editor use), so a
// frame is the level as it actually is: when Sean moves a resident or
// reshapes a room, the frame follows. Spawn gating is resolved for the run
// being read, so a scene that doesn't happen on that run drops its cast.
import type { Content, ItemDef } from "../data/types";
import { el } from "../editor/forms";
import { drawBackdrop, drawBlob, drawItemIcon, drawMap } from "../engine/renderer";
import { TILE } from "../engine/tilemap";
import { RoomRuntime } from "../game/room";
import { emptyRoomMutations } from "../game/state";

type Helped = ReadonlySet<string>;

const runtimes = new Map<string, RoomRuntime | null>();
/** Content swaps (publish, rebase, a structural edit) must drop the cache. */
let cachedFor: Content | null = null;

function runtime(content: Content, roomId: string, helped: Helped): RoomRuntime | null {
  if (cachedFor !== content) { runtimes.clear(); cachedFor = content; }
  const k = `${roomId}|${[...helped].sort().join(",")}`;
  if (!runtimes.has(k)) {
    const room = content.rooms[roomId];
    let rt: RoomRuntime | null = null;
    try { if (room) rt = new RoomRuntime(room, content, emptyRoomMutations(), helped); }
    catch (err) { console.error("Storyboard frame failed", err); }
    runtimes.set(k, rt);
  }
  return runtimes.get(k) ?? null;
}

/** Draw lazily: a long campaign is dozens of frames, and most are below the fold. */
const observer = typeof IntersectionObserver !== "undefined"
  ? new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        observer!.unobserve(en.target);
        (en.target as HTMLCanvasElement & { ppDraw?: () => void }).ppDraw?.();
      }
    }, { rootMargin: "600px 0px" })
  : null;

function lazy(cv: HTMLCanvasElement, draw: () => void): HTMLCanvasElement {
  if (!observer) { draw(); return cv; }
  (cv as HTMLCanvasElement & { ppDraw?: () => void }).ppDraw = draw;
  observer.observe(cv);
  return cv;
}

function drawView(
  c: CanvasRenderingContext2D, content: Content, roomId: string, helped: Helped,
  camX: number, camY: number, viewW: number, viewH: number, scale: number,
  player?: { x: number; feetY: number; facing: number }
): void {
  const room = content.rooms[roomId];
  const rt = runtime(content, roomId, helped);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.imageSmoothingEnabled = false;
  c.fillStyle = room?.background ?? "#17131f";
  c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  if (!room || !rt) return;
  c.setTransform(scale, 0, 0, scale, -camX * scale, -camY * scale);
  drawBackdrop(c, room.background, camX, camY, viewW, viewH);
  drawMap(c, rt.map, camX, camY, viewW, viewH, 0.4);
  rt.draw(c, 0.4);
  if (player) {
    const p = content.game.player;
    drawBlob(c, player.x - 6, player.feetY - 14, 12, 14, p.color, p.eyeColor, player.facing, { sprite: p, sketch: p.sketch });
  }
}

/** The whole level, #67 at the spawn. */
export function wideShot(content: Content, roomId: string, helped: Helped): HTMLCanvasElement {
  const room = content.rooms[roomId];
  const w = (room?.width ?? 40) * TILE, h = (room?.height ?? 22) * TILE;
  const cv = el("canvas", { width: w, height: h, className: "ms-wide" }) as HTMLCanvasElement;
  return lazy(cv, () => {
    const c = cv.getContext("2d");
    if (!c) return;
    const rt = runtime(content, roomId, helped);
    drawView(c, content, roomId, helped, 0, 0, w, h, 1,
      rt ? { x: rt.spawnX, feetY: rt.spawnY, facing: 1 } : undefined);
  });
}

const CLOSE_W = 12 * TILE, CLOSE_H = 6.75 * TILE, CLOSE_SCALE = 2;

/** A 16:9 close-up on one spot in a level (tile coords of the entity's feet
 *  tile), with #67 standing beside it. */
export function closeUp(content: Content, roomId: string, tx: number, ty: number, helped: Helped): HTMLCanvasElement {
  const cv = el("canvas", { width: CLOSE_W * CLOSE_SCALE, height: CLOSE_H * CLOSE_SCALE, className: "ms-frame" }) as HTMLCanvasElement;
  return lazy(cv, () => {
    const c = cv.getContext("2d");
    const room = content.rooms[roomId];
    if (!c || !room) return;
    const fx = (tx + 0.5) * TILE, fy = (ty + 1) * TILE;
    const camX = Math.max(0, Math.min(room.width * TILE - CLOSE_W, fx - CLOSE_W / 2));
    const camY = Math.max(0, Math.min(room.height * TILE - CLOSE_H, fy - CLOSE_H * 0.72));
    const side = fx - camX > 3 * TILE ? -1 : 1;
    drawView(c, content, roomId, helped, camX, camY, CLOSE_W, CLOSE_H, CLOSE_SCALE,
      { x: fx + side * 1.8 * TILE, feetY: fy, facing: -side });
  });
}

/** An insert shot: the recipe card, ingredients + result, real item icons. */
export function recipeCard(content: Content, recipeId: string): HTMLCanvasElement {
  const W = 384, H = 216;
  const cv = el("canvas", { width: W, height: H, className: "ms-frame" }) as HTMLCanvasElement;
  const c = cv.getContext("2d");
  const r = content.recipes.find((x) => x.id === recipeId);
  if (!c || !r) return cv;
  c.fillStyle = "#17131f";
  c.fillRect(0, 0, W, H);
  c.strokeStyle = "#ffd166";
  c.setLineDash([6, 4]);
  c.strokeRect(12, 12, W - 24, H - 24);
  c.setLineDash([]);
  const item = (id: string): ItemDef | undefined => content.items.find((i) => i.id === id);
  const slots = [...r.inputs.slice(0, 3), r.output];
  const gap = W / (slots.length + 1);
  c.font = "13px ui-monospace, monospace";
  c.textAlign = "center";
  slots.forEach((id, i) => {
    const x = gap * (i + 1), last = i === slots.length - 1;
    const it = item(id);
    c.imageSmoothingEnabled = false;
    if (it) drawItemIcon(c, it, x, 96, last ? 4 : 3);
    c.fillStyle = last ? "#ffd166" : "#ece6f8";
    c.fillText(it?.name ?? id, x, 162);
    if (i < slots.length - 1) {
      c.fillStyle = "#9f96bd";
      c.font = "22px ui-monospace, monospace";
      c.fillText(i === slots.length - 2 ? "=" : "+", x + gap / 2, 104);
      c.font = "13px ui-monospace, monospace";
    }
  });
  return cv;
}
