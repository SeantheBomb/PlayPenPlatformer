// The Art Studio's "Environments" surface: parallax layer sets, the rooms
// bound to them, and a live preview that pans a real room at real gameplay
// speed so depth can be tuned by feel rather than by numbers.
//
// Everything here edits content/layers.json, which is wholly artist-owned
// (see functions/api/_artscope.js) — room bindings included, which is why
// dressing a room never touches rooms/*.json.
import type { ContentStore } from "../data/content";
import type { LayersFile, LayerSet, ParallaxLayer, LayerProp, RoomDef } from "../data/types";
import { el, toast } from "../editor/forms";
import { TileMap } from "../engine/tilemap";
import { drawBackdrop, drawMap, drawParallaxLayers } from "../engine/renderer";
import { DEPTH_PRESETS, resolveRoomLayers, setIdForRoom } from "../game/layers";
import { VIEW_H, VIEW_W } from "../game/game";
import { importFiles } from "./importers";
import { makePlaceholderSet, makePlaceholderStrip, PLACEHOLDER_WRAP_Y, type PlaceholderDepth } from "./placeholders";
import { openSvgEditor } from "./svgeditor";

export interface EnvContext {
  store: ContentStore;
  /** Re-render the current view (after a save that changes structure). */
  refresh: () => void;
  markDirty: () => void;
  /** Close the studio and play the given room with the draft layers. */
  playRoom: (roomId: string) => void;
  /** Navigate: null = the set list, otherwise that set's editor. */
  open: (setId: string | null) => void;
  back: () => void;
}

/** Every live preview mounts a rAF loop; the view swap has to stop them or
 *  they pile up and keep drawing into detached canvases. */
let stopPreview: (() => void) | null = null;
export function stopEnvironmentPreview(): void {
  stopPreview?.();
  stopPreview = null;
}

// ---- content/layers.json helpers ----

function file(store: ContentStore): LayersFile {
  const f = store.content.layers;
  if (!f.sets) f.sets = {};
  if (!f.rooms) f.rooms = {};
  return f;
}

async function save(ctx: EnvContext): Promise<void> {
  await ctx.store.saveFile("layers.json", file(ctx.store));
  ctx.markDirty();
}

const dataBytes = (uri?: string): number => {
  if (!uri) return 0;
  const i = uri.indexOf(",");
  return i < 0 ? 0 : Math.round((uri.length - i - 1) * 0.75);
};

function setBytes(set: LayerSet): number {
  return set.layers.reduce(
    (n, l) => n + dataBytes(l.sprite) + (l.props ?? []).reduce((m, p) => m + dataBytes(p.sprite), 0),
    0
  );
}

const kb = (n: number) => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`);

function roomsUsing(f: LayersFile, setId: string, roomIds: string[]): string[] {
  return roomIds.filter((id) => setIdForRoom(f, id) === setId);
}

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 7)}`;

// ---- The set list ----

export function environmentsView(ctx: EnvContext): HTMLElement {
  stopEnvironmentPreview();
  const f = file(ctx.store);
  const roomIds = Object.keys(ctx.store.content.rooms);
  const wrap = el("div", {});

  wrap.append(el(
    "div", { className: "st-card" },
    el("h2", { style: "margin:0 0 6px;color:#ffd166" }, "🌄 Environments"),
    el("p", { style: "margin:0 0 8px" },
      "Layered backdrops that scroll at different speeds to give rooms depth — the classic Sonic trick. " +
      "A layer is one image that repeats sideways forever, so it works in any room and stays small to download."),
    el("div", { className: "st-hint" },
      "Build a few sets and point rooms at them. Anything you leave empty simply doesn't draw, " +
      "so a half-finished set is always safe to leave in place.")
  ));

  const grid = el("div", { className: "st-grid", style: "grid-template-columns:repeat(auto-fill,minmax(230px,1fr))" });
  for (const set of Object.values(f.sets)) {
    const used = roomsUsing(f, set.id, roomIds);
    const withArt = set.layers.filter((l) => l.sprite || (l.props ?? []).some((p) => p.sprite)).length;
    const card = el(
      "div", { className: "st-cardasset", style: "align-items:stretch;text-align:left", onclick: () => ctx.open(set.id) },
      el("canvas", { className: "st-previewbig", width: 200, height: 112, style: "width:100%;height:auto" }),
      el("div", { className: "st-name", style: "font-weight:600" }, set.name || set.id),
      el("div", { className: "st-dim" },
        `${withArt}/${set.layers.length} layers drawn · ${kb(setBytes(set))}`),
      el("div", { className: "st-dim" },
        used.length ? `Used by ${used.length} room${used.length === 1 ? "" : "s"}` : "Not used by any room yet")
    );
    const cv = card.firstChild as HTMLCanvasElement;
    paintSetThumb(cv, set);
    grid.append(card);
  }
  wrap.append(grid);

  wrap.append(el(
    "div", { className: "st-row", style: "margin-top:14px" },
    el("button", {
      className: "st-btn st-primary",
      onclick: async () => {
        const f2 = file(ctx.store);
        const id = uid("set");
        f2.sets[id] = {
          id,
          name: `New set ${Object.keys(f2.sets).length + 1}`,
          layers: (["far", "mid", "near"] as const).map((d) => ({
            id: d, name: { far: "Far background", mid: "Mid background", near: "Foreground" }[d],
            depth: d, props: [], wrapX: true, wrapY: false, ...DEPTH_PRESETS[d],
          })),
        };
        await save(ctx);
        ctx.open(id);
      },
    }, "+ New layer set"),
    el("span", { className: "st-hint" }, "Starts with a far, mid, and foreground layer, ready for art."),
    el("span", { className: "st-spacer" }),
    el("button", {
      className: "st-btn",
      title: "Rough stand-in art for all three layers, so you can see and feel the effect before drawing anything",
      onclick: async () => {
        const f2 = file(ctx.store);
        const id = uid("set");
        f2.sets[id] = {
          id,
          name: "Placeholder facility",
          layers: makePlaceholderSet().map((p) => ({
            id: p.depth, name: p.name, depth: p.depth, sprite: p.sprite,
            props: [], wrapX: true, ...DEPTH_PRESETS[p.depth], wrapY: p.wrapY,
          })),
        };
        // Bind it everywhere, or it's a set nobody can see without extra
        // steps — the entire point is an immediate look at the system.
        f2.defaultSetId = id;
        await save(ctx);
        toast("Placeholder set added and switched on for every room. Delete it whenever real art lands.");
        ctx.open(id);
      },
    }, "✨ Add placeholder set")
  ));
  wrap.append(el("div", { className: "st-hint", style: "margin-top:6px" },
    "Placeholders are generated here in your browser — they cost nothing until you publish, " +
    "and deleting the set removes them completely."));
  return wrap;
}

/** Small composited thumbnail of a set: its layers stacked, no room behind. */
function paintSetThumb(cv: HTMLCanvasElement, set: LayerSet): void {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#171327";
  ctx.fillRect(0, 0, cv.width, cv.height);
  const layers = set.layers.filter((l) => l.sprite);
  if (!layers.length) {
    ctx.fillStyle = "#5a5470";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("no art yet", cv.width / 2, cv.height / 2 + 4);
    ctx.textAlign = "left";
    return;
  }
  const scale = cv.height / VIEW_H;
  ctx.save();
  ctx.scale(scale, scale);
  drawParallaxLayers(ctx, layers, 0, 0, cv.width / scale, VIEW_H, 0, null);
  ctx.restore();
}

// ---- One set's editor ----

export function layerSetView(ctx: EnvContext, setId: string): HTMLElement {
  stopEnvironmentPreview();
  const f = file(ctx.store);
  const set = f.sets[setId];
  const wrap = el("div", {});
  if (!set) {
    wrap.append(el("div", { className: "st-note st-err" }, "That layer set is gone."));
    return wrap;
  }
  const roomIds = Object.keys(ctx.store.content.rooms);
  const used = roomsUsing(f, setId, roomIds);
  // The room shown in the preview: one already using this set if possible.
  const previewRoom = used[0] ?? roomIds[0];
  /** When on, slider edits write a per-room override instead of the set. */
  let roomOnly = false;

  // Header
  const nameInput = el("input", {
    className: "st-search", value: set.name ?? set.id, style: "font-size:16px;font-weight:600;min-width:240px",
    onchange: async (e: Event) => { set.name = (e.target as HTMLInputElement).value; await save(ctx); },
  });
  // Live so dropping a strip updates the cost immediately — she should never
  // have to guess what her art is adding to everyone's download.
  const sizeEl = el("span", { className: "st-hint" }, `${kb(setBytes(set))} added to every player's download`);
  const refreshMeta = () => { sizeEl.textContent = `${kb(setBytes(set))} added to every player's download`; };
  wrap.append(el(
    "div", { className: "st-row" },
    el("button", { className: "st-btn st-quiet", onclick: () => ctx.open(null) }, "← All environments"),
    nameInput,
    el("span", { className: "st-spacer" }),
    sizeEl,
    el("button", {
      className: "st-btn st-danger",
      onclick: async () => {
        if (!confirm(`Delete "${set.name || set.id}"? Rooms using it go back to drawing no backdrop.`)) return;
        delete f.sets[setId];
        for (const [rid, b] of Object.entries(f.rooms)) if (b.setId === setId) delete f.rooms[rid];
        if (f.defaultSetId === setId) delete f.defaultSetId;
        await save(ctx);
        ctx.open(null);
      },
    }, "Delete set")
  ));

  // ---- Live preview ----
  const previewCard = el("div", { className: "st-card" });
  const previewCanvas = el("canvas", {
    width: VIEW_W, height: VIEW_H,
    style: "width:100%;max-width:640px;height:auto;border-radius:8px;image-rendering:pixelated;cursor:grab;background:#0d0b14",
  }) as HTMLCanvasElement;
  const roomSelect = el("select", { className: "st-search" }) as HTMLSelectElement;
  for (const id of roomIds) {
    const r = ctx.store.content.rooms[id];
    roomSelect.append(el("option", { value: id }, r.name ?? id));
  }
  roomSelect.value = previewRoom;
  const overrideChip = el("button", { className: "st-chip" }, "Tweak for this room only");
  const playPauseBtn = el("button", { className: "st-btn" }, "⏸ Pause pan");
  const previewNote = el("div", { className: "st-hint" }, "");

  previewCard.append(
    el("div", { className: "st-row" },
      el("b", {}, "Preview"),
      roomSelect,
      playPauseBtn,
      el("button", {
        className: "st-btn", title: "Close the studio and actually play this room with your draft layers",
        onclick: () => ctx.playRoom(roomSelect.value),
      }, "▶ Play this room"),
      el("span", { className: "st-spacer" }),
      overrideChip
    ),
    previewCanvas,
    el("div", { className: "st-hint", style: "margin-top:6px" },
      "Pans at the player's own running speed. Drag the preview to scrub the camera yourself, " +
      "and drag a placed prop to move it."),
    previewNote
  );
  wrap.append(previewCard);

  // ---- Layer stack ----
  const stack = el("div", {});
  wrap.append(stack);

  const rerenderStack = () => {
    stack.replaceChildren();
    set.layers.forEach((layer, i) => stack.append(layerCard(ctx, set, layer, i, {
      roomId: () => roomSelect.value,
      roomOnly: () => roomOnly,
      onStructureChange: () => { rerenderStack(); refreshMeta(); rebindPreview(); },
    })));
    stack.append(el(
      "div", { className: "st-row" },
      el("button", {
        className: "st-btn",
        onclick: async () => {
          set.layers.push({ id: uid("layer"), name: `Layer ${set.layers.length + 1}`, depth: "mid", props: [], wrapX: true, wrapY: false, ...DEPTH_PRESETS.mid });
          await save(ctx);
          rerenderStack();
        },
      }, "+ Add layer"),
      el("span", { className: "st-hint" }, "Drawn in this order — the first is furthest back.")
    ));
  };

  // ---- Rooms bound to this set ----
  const roomsCard = el("div", { className: "st-card" });
  const rerenderRooms = () => {
    const f2 = file(ctx.store);
    roomsCard.replaceChildren(
      el("div", { className: "st-row" },
        el("b", {}, "Rooms using this set"),
        el("span", { className: "st-spacer" }),
        el("button", {
          className: "st-chip",
          onclick: async () => {
            f2.defaultSetId = setId;
            await save(ctx);
            rerenderRooms();
          },
        }, f2.defaultSetId === setId ? "★ Default for every room" : "Make the default for every room")
      ),
      el("div", { className: "st-hint" },
        "Rooms with no set of their own use the default. Click a room to bind or unbind it."),
      el("div", { className: "st-filters", style: "margin-top:8px" },
        ...roomIds.map((id) => {
          const room = ctx.store.content.rooms[id];
          const boundHere = setIdForRoom(f2, id) === setId;
          const explicit = f2.rooms[id]?.setId === setId;
          return el("button", {
            className: `st-chip${boundHere ? " st-on" : ""}`,
            title: explicit ? "Bound to this set" : boundHere ? "Using this set as the default" : "Click to use this set here",
            onclick: async () => {
              if (explicit) delete f2.rooms[id].setId;
              else f2.rooms[id] = { ...(f2.rooms[id] ?? {}), setId };
              await save(ctx);
              rerenderRooms();
              rebindPreview();
            },
          }, `${room.name ?? id}${explicit ? " ✓" : ""}`);
        }))
    );
  };
  wrap.append(roomsCard);

  // ---- Preview driver ----
  let panT = 0;
  let panning = true;
  let manualCam: number | null = null;
  let camY = 0;
  let dragging: { startX: number; startCam: number; prop: LayerProp | null; layer: ParallaxLayer | null; offX: number; offY: number } | null = null;

  const rebindPreview = () => { previewNote.textContent = ""; };

  playPauseBtn.onclick = () => {
    panning = !panning;
    playPauseBtn.textContent = panning ? "⏸ Pause pan" : "▶ Resume pan";
  };
  roomSelect.onchange = () => { manualCam = null; panT = 0; rebindPreview(); };
  overrideChip.onclick = () => {
    roomOnly = !roomOnly;
    overrideChip.classList.toggle("st-on", roomOnly);
    overrideChip.textContent = roomOnly
      ? `Tweaking ${ctx.store.content.rooms[roomSelect.value]?.name ?? roomSelect.value} only`
      : "Tweak for this room only";
    rerenderStack();
  };

  // Drag: move a prop if one is grabbed, otherwise scrub the camera.
  previewCanvas.addEventListener("pointerdown", (e) => {
    const rect = previewCanvas.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const sy = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    const camX = currentCam();
    const hit = hitProp(ctx, set, roomSelect.value, camX, camY, sx, sy);
    dragging = hit
      ? { startX: e.clientX, startCam: camX, prop: hit.prop, layer: hit.layer, offX: hit.offX, offY: hit.offY }
      : { startX: e.clientX, startCam: camX, prop: null, layer: null, offX: 0, offY: 0 };
    previewCanvas.setPointerCapture(e.pointerId);
    previewCanvas.style.cursor = hit ? "grabbing" : "grab";
    if (hit) panning = false, playPauseBtn.textContent = "▶ Resume pan";
  });
  previewCanvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = previewCanvas.getBoundingClientRect();
    if (dragging.prop && dragging.layer) {
      const sx = ((e.clientX - rect.left) / rect.width) * VIEW_W;
      const sy = ((e.clientY - rect.top) / rect.height) * VIEW_H;
      const camX = currentCam();
      const l = dragging.layer;
      const baseX = camX * (1 - (l.scrollX ?? 0.5));
      const baseY = camY * (1 - (l.scrollY ?? 0.3)) + (l.offsetY ?? 0);
      dragging.prop.x = Math.round(camX + sx - baseX - dragging.offX);
      dragging.prop.y = Math.round(camY + sy - baseY - dragging.offY);
      previewNote.textContent = `Prop at ${dragging.prop.x}, ${dragging.prop.y}`;
    } else {
      const dx = (e.clientX - dragging.startX) / rect.width * VIEW_W;
      manualCam = Math.max(0, dragging.startCam - dx);
      panning = false;
      playPauseBtn.textContent = "▶ Resume pan";
    }
  });
  const endDrag = () => {
    if (dragging?.prop) void save(ctx);
    dragging = null;
    previewCanvas.style.cursor = "grab";
  };
  previewCanvas.addEventListener("pointerup", endDrag);
  previewCanvas.addEventListener("pointercancel", endDrag);

  function currentCam(): number {
    const room = ctx.store.content.rooms[roomSelect.value];
    if (!room) return 0;
    const span = Math.max(0, room.width * 16 - VIEW_W);
    if (manualCam !== null) return Math.min(manualCam, span);
    if (span <= 0) return 0;
    // Ping-pong at the player's real run speed so the feel matches play.
    const speed = ctx.store.content.game.player.runSpeed || 150;
    const period = (span / speed) * 2;
    const p = period > 0 ? (panT % period) / period : 0;
    return p < 0.5 ? span * (p * 2) : span * (2 - p * 2);
  }

  let raf = 0;
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (panning) panT += dt;
    drawPreview(ctx, previewCanvas, roomSelect.value, currentCam(), camY, now / 1000);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  stopPreview = () => cancelAnimationFrame(raf);

  // Vertical position follows the room's shape: start looking at the floor.
  const room0 = ctx.store.content.rooms[previewRoom];
  camY = room0 ? Math.max(0, room0.height * 16 - VIEW_H) : 0;

  rerenderStack();
  rerenderRooms();
  return wrap;
}

/** Which prop (if any) is under a preview click, plus the grab offset. */
function hitProp(
  ctx: EnvContext, set: LayerSet, roomId: string, camX: number, camY: number, sx: number, sy: number
): { prop: LayerProp; layer: ParallaxLayer; offX: number; offY: number } | null {
  const resolved = resolveRoomLayers(ctx.store.content, roomId);
  const drawn = [...resolved.behind, ...resolved.front];
  // Topmost first, so a prop drawn over another grabs first.
  for (let i = drawn.length - 1; i >= 0; i--) {
    const layer = set.layers.find((l) => l.id === drawn[i].id);
    if (!layer) continue;
    const baseX = camX * (1 - (layer.scrollX ?? 0.5));
    const baseY = camY * (1 - (layer.scrollY ?? 0.3)) + (layer.offsetY ?? 0);
    for (const prop of [...(layer.props ?? [])].reverse()) {
      const px = prop.x + baseX - camX, py = prop.y + baseY - camY;
      if (sx >= px && sx <= px + prop.w && sy >= py && sy <= py + prop.h) {
        return { prop, layer, offX: sx - px, offY: sy - py };
      }
    }
  }
  return null;
}

/** One preview frame: the real room, drawn by the real renderer, with the
 *  layers resolved exactly as the game resolves them. */
function drawPreview(
  ctx: EnvContext, cv: HTMLCanvasElement, roomId: string, camX: number, camY: number, t: number
): void {
  const c = cv.getContext("2d");
  const content = ctx.store.content;
  const room: RoomDef | undefined = content.rooms[roomId];
  if (!c || !room) return;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  c.imageSmoothingEnabled = false;
  const map = new TileMap(room, content.tiles);
  const layers = resolveRoomLayers(content, roomId);
  // A stand-in for the player, so the foreground readability guard is visible.
  const px = camX + VIEW_W / 2, py = camY + VIEW_H * 0.62;

  c.save();
  c.translate(-camX, -camY);
  drawBackdrop(c, room.background, camX, camY, VIEW_W, VIEW_H);
  drawParallaxLayers(c, layers.behind, camX, camY, VIEW_W, VIEW_H, t);
  drawMap(c, map, camX, camY, VIEW_W, VIEW_H, t);
  // Player stand-in: the sketch silhouette, just enough to judge occlusion.
  c.fillStyle = "rgba(185,189,212,0.85)";
  c.fillRect(px - 6, py - 14, 12, 14);
  drawParallaxLayers(c, layers.front, camX, camY, VIEW_W, VIEW_H, t, { x: px - camX, y: py - camY });
  c.restore();
}

// ---- One layer's card ----

interface LayerCardHooks {
  roomId: () => string;
  roomOnly: () => boolean;
  onStructureChange: () => void;
}

function layerCard(
  ctx: EnvContext, set: LayerSet, layer: ParallaxLayer, index: number, hooks: LayerCardHooks
): HTMLElement {
  const f = file(ctx.store);
  const roomOnly = hooks.roomOnly();
  const roomId = hooks.roomId();

  /** Read a knob through the room override, if we're in per-room mode. */
  const read = <K extends keyof ParallaxLayer>(k: K): ParallaxLayer[K] => {
    if (roomOnly) {
      const o = f.rooms[roomId]?.overrides?.[layer.id];
      if (o && o[k] !== undefined) return o[k] as ParallaxLayer[K];
    }
    return layer[k];
  };
  /** Write a knob to either the set or this room's override. */
  const write = async <K extends keyof ParallaxLayer>(k: K, v: ParallaxLayer[K]) => {
    if (roomOnly) {
      const binding = (f.rooms[roomId] ??= {});
      const overrides = (binding.overrides ??= {});
      const o = (overrides[layer.id] ??= {});
      o[k] = v;
    } else {
      layer[k] = v;
    }
    await save(ctx);
  };

  const card = el("div", { className: "st-card" });

  const thumb = el("canvas", {
    className: "st-previewbig", width: 120, height: 68, style: "width:120px;height:68px",
  }) as HTMLCanvasElement;
  const paintThumb = () => {
    const c = thumb.getContext("2d");
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, thumb.width, thumb.height);
    if (!layer.sprite) {
      c.fillStyle = "#5a5470";
      c.font = "11px system-ui, sans-serif";
      c.textAlign = "center";
      c.fillText("no strip", thumb.width / 2, thumb.height / 2 + 4);
      c.textAlign = "left";
      return;
    }
    const scale = thumb.height / VIEW_H;
    c.save();
    c.scale(scale, scale);
    drawParallaxLayers(c, [{ ...layer, opacity: 1, driftX: 0, driftY: 0 }], 0, 0, thumb.width / scale, VIEW_H, 0);
    c.restore();
  };
  paintThumb();

  const isFront = (read("plane") ?? "behind") === "front";

  // Header row: name, plane, presets, reorder, delete
  card.append(el(
    "div", { className: "st-row" },
    thumb,
    el("div", { style: "flex:1;min-width:180px" },
      el("input", {
        className: "st-search", value: layer.name ?? layer.id, style: "font-weight:600;width:100%",
        onchange: async (e: Event) => { layer.name = (e.target as HTMLInputElement).value; await save(ctx); },
      }),
      el("div", { className: "st-hint", style: "margin-top:4px" },
        layer.sprite ? `${kb(dataBytes(layer.sprite))} · repeats sideways forever` : "Drop a tileable strip below"),
      el("div", { className: "st-filters", style: "margin-top:6px" },
        ...(["far", "mid", "near"] as const).map((d) => el("button", {
          className: `st-chip${read("depth") === d ? " st-on" : ""}`,
          title: "Sets sensible speeds for that distance — tweak them after",
          onclick: async () => {
            for (const [k, v] of Object.entries({ ...DEPTH_PRESETS[d], depth: d })) {
              await write(k as keyof ParallaxLayer, v as never);
            }
            hooks.onStructureChange();
          },
        }, { far: "Far", mid: "Mid", near: "Foreground" }[d])))),
    el("div", {},
      el("div", { className: "st-row" },
        el("button", {
          className: "st-btn st-quiet", title: "Move back", disabled: index === 0,
          onclick: async () => {
            const [l] = set.layers.splice(index, 1);
            set.layers.splice(index - 1, 0, l);
            await save(ctx);
            hooks.onStructureChange();
          },
        }, "↑"),
        el("button", {
          className: "st-btn st-quiet", title: "Move forward", disabled: index === set.layers.length - 1,
          onclick: async () => {
            const [l] = set.layers.splice(index, 1);
            set.layers.splice(index + 1, 0, l);
            await save(ctx);
            hooks.onStructureChange();
          },
        }, "↓"),
        el("button", {
          className: "st-btn st-danger",
          onclick: async () => {
            if (!confirm(`Remove "${layer.name ?? layer.id}" from this set?`)) return;
            set.layers.splice(index, 1);
            await save(ctx);
            hooks.onStructureChange();
          },
        }, "Remove"))
    )
  ));

  if (roomOnly) {
    card.append(el("div", { className: "st-note" },
      `Editing ${ctx.store.content.rooms[roomId]?.name ?? roomId} only — these numbers override the set here and nowhere else.`));
  }

  // Sliders
  const slider = (
    label: string, key: keyof ParallaxLayer, min: number, max: number, step: number, fmt: (v: number) => string
  ) => {
    const value = (read(key) as number | undefined) ?? 0;
    const out = el("span", { className: "st-hint", style: "min-width:78px" }, fmt(value));
    return el("div", { className: "st-row" },
      el("span", { style: "min-width:132px" }, label),
      el("input", {
        type: "range", min, max, step, value, style: "flex:1;max-width:320px",
        oninput: async (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          out.textContent = fmt(v);
          await write(key, v as never);
        },
      }),
      out);
  };

  const knobs = el("div", {},
    slider("Follows camera ↔", "scrollX", 0, 2, 0.05, (v) => `${v.toFixed(2)}×`),
    slider("Follows camera ↕", "scrollY", 0, 2, 0.05, (v) => `${v.toFixed(2)}×`),
    slider("Drifts ↔", "driftX", -30, 30, 1, (v) => `${v} px/s`),
    slider("Drifts ↕", "driftY", -30, 30, 1, (v) => `${v} px/s`),
    slider("Opacity", "opacity", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
    slider("Vertical offset", "offsetY", -400, 400, 4, (v) => `${v} px`),
    el("div", { className: "st-row" },
      el("span", { style: "min-width:132px" }, "Repeats"),
      checkbox("sideways", read("wrapX") !== false, (v) => write("wrapX", v)),
      checkbox("downwards", !!read("wrapY"), (v) => write("wrapY", v)),
      el("span", { className: "st-spacer" }),
      checkbox("draw in front of the player", isFront, async (v) => {
        await write("plane", v ? "front" : "behind");
        hooks.onStructureChange();
      })),
    isFront ? el("div", { className: "st-row" },
      el("span", { style: "min-width:132px" }, "Readability"),
      checkbox("fade around the player", read("fadeNearPlayer") !== false, (v) => write("fadeNearPlayer", v)),
      el("span", { className: "st-hint" }, "Keeps foreground art from ever hiding the player or a hazard.")
    ) : el("span", {})
  );
  card.append(knobs);
  card.append(el("div", { className: "st-hint" },
    "“Follows camera” is the whole trick: 1.00× moves exactly with the level, 0.15× reads as far away, " +
    "above 1.00× rushes past in front. Drift keeps a layer alive even when you're standing still."));

  // Strip drop zone + shape editor
  const drop = el("div", { className: "st-drop", style: "padding:14px;margin-top:10px" },
    el("div", {}, layer.sprite ? "Drop a new strip to replace this one" : "Drop this layer's strip here — or click to browse"),
    el("div", { className: "st-hint" }, "PNG or SVG. Make the left and right edges match and it'll repeat seamlessly."));
  const takeFiles = async (files: File[]) => {
    const result = await importFiles(files);
    if (result.errors.length) { toast(result.errors[0]); return; }
    if (!result.frames.length) return;
    layer.sprite = result.frames[0];
    await save(ctx);
    paintThumb();
    hooks.onStructureChange();
    toast("Layer art saved to your draft.");
  };
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("st-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("st-over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("st-over");
    void takeFiles([...(e.dataTransfer?.files ?? [])]);
  });
  drop.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/webp,image/svg+xml,.svg";
    input.onchange = () => void takeFiles([...(input.files ?? [])]);
    input.click();
  });
  card.append(drop);

  card.append(el("div", { className: "st-row" },
    el("button", {
      className: "st-btn",
      title: "Draw the strip right here with vector shapes (crisp at any size)",
      onclick: () => openSvgEditor({
        title: `${set.name || set.id} — ${layer.name ?? layer.id}`,
        width: 160, height: 180,
        frames: layer.sprite?.startsWith("data:image/svg") ? [layer.sprite] : [],
        fps: 6, multiFrame: false,
        onSave: (frames) => {
          layer.sprite = frames[0];
          void save(ctx).then(() => { paintThumb(); hooks.onStructureChange(); });
        },
      }),
    }, "△ Draw a strip"),
    el("button", {
      className: "st-btn",
      title: "Drop in rough stand-in art for this layer, matched to its depth",
      onclick: async () => {
        const d = (read("depth") as PlaceholderDepth) ?? "mid";
        layer.sprite = makePlaceholderStrip(d);
        layer.wrapY = PLACEHOLDER_WRAP_Y[d];
        await save(ctx);
        paintThumb();
        hooks.onStructureChange();
        toast("Placeholder strip added — replace it whenever you like.");
      },
    }, "✨ Placeholder"),
    layer.sprite ? el("button", {
      className: "st-btn st-danger",
      onclick: async () => {
        delete layer.sprite;
        await save(ctx);
        paintThumb();
        hooks.onStructureChange();
      },
    }, "Remove strip") : el("span", {})
  ));

  // Props
  card.append(propsSection(ctx, layer, hooks));
  return card;
}

function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void | Promise<void>): HTMLElement {
  const input = el("input", {
    type: "checkbox", checked,
    onchange: (e: Event) => void onChange((e.target as HTMLInputElement).checked),
  });
  return el("label", { className: "st-hint", style: "display:flex;gap:5px;align-items:center;cursor:pointer" }, input, label);
}

function propsSection(ctx: EnvContext, layer: ParallaxLayer, hooks: LayerCardHooks): HTMLElement {
  const props = (layer.props ??= []);
  const box = el("div", { style: "margin-top:10px" });
  box.append(el("div", { className: "st-row" },
    el("b", {}, "Props"),
    el("span", { className: "st-hint" },
      "One-off objects on this layer — a pipe, a poster, a cloud. They move with the layer and can be dragged in the preview."),
    el("span", { className: "st-spacer" }),
    el("button", {
      className: "st-btn",
      onclick: () => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = "image/png,image/webp,image/svg+xml,.svg";
        input.onchange = async () => {
          const result = await importFiles([...(input.files ?? [])]);
          if (result.errors.length) { toast(result.errors[0]); return; }
          for (const uri of result.frames) {
            const size = await imageDims(uri);
            props.push({ id: uid("prop"), sprite: uri, x: 120, y: 120, w: size.w, h: size.h });
          }
          await save(ctx);
          hooks.onStructureChange();
          toast(`Added ${result.frames.length} prop${result.frames.length === 1 ? "" : "s"} — drag them in the preview.`);
        };
        input.click();
      },
    }, "+ Add props")));

  if (!props.length) {
    box.append(el("div", { className: "st-hint" }, "None yet."));
    return box;
  }
  const grid = el("div", { className: "st-frames" });
  for (const p of props) {
    const cell = el("div", { className: "st-frame", title: `${p.w}×${p.h} at ${p.x}, ${p.y}` });
    const c = el("canvas", { width: 44, height: 44 }) as HTMLCanvasElement;
    const img = new Image();
    img.onload = () => {
      const cc = c.getContext("2d");
      if (!cc) return;
      cc.imageSmoothingEnabled = false;
      const s = Math.min(44 / img.naturalWidth, 44 / img.naturalHeight);
      cc.drawImage(img, (44 - img.naturalWidth * s) / 2, (44 - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    };
    if (p.sprite) img.src = p.sprite;
    cell.append(c, el("button", {
      className: "st-framex", title: "Remove this prop",
      onclick: async (e: Event) => {
        e.stopPropagation();
        props.splice(props.indexOf(p), 1);
        await save(ctx);
        hooks.onStructureChange();
      },
    }, "✕"));
    grid.append(cell);
  }
  box.append(grid);
  return box;
}

function imageDims(uri: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 32, h: img.naturalHeight || 32 });
    img.onerror = () => resolve({ w: 32, h: 32 });
    img.src = uri;
  });
}
