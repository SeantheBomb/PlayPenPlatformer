// Parallax layer resolution: which layers a given room actually draws, after
// picking its set and applying its per-layer overrides. Pure data work, no
// canvas — shared by the game (game.ts) and the Art Studio's preview so the
// studio can never disagree with what players see.
//
// Layers are cosmetic-only by construction (see ParallaxLayer in types.ts).
// Nothing here is read by the simulation.
import type { Content, LayerSet, LayersFile, ParallaxLayer } from "../data/types";

/** Every knob's default, in one place — a layer authored before a field
 *  existed (or a set hand-written without it) still renders sanely. */
export const LAYER_DEFAULTS: Required<Omit<ParallaxLayer, "id" | "name" | "sprite" | "props">> = {
  plane: "behind",
  depth: "mid",
  scrollX: 0.5,
  scrollY: 0.3,
  driftX: 0,
  driftY: 0,
  opacity: 1,
  offsetY: 0,
  wrapX: true,
  wrapY: false,
  fadeNearPlayer: false,
};

/** The depth presets the studio offers. Picking one stamps these numbers;
 *  she's free to tweak them afterward (`depth` just records the origin). */
export const DEPTH_PRESETS: Record<"far" | "mid" | "near", Partial<ParallaxLayer>> = {
  far: { scrollX: 0.15, scrollY: 0.08, driftX: -3, driftY: 0, opacity: 1, plane: "behind" },
  mid: { scrollX: 0.45, scrollY: 0.3, driftX: -1, driftY: 0, opacity: 1, plane: "behind" },
  near: { scrollX: 1.25, scrollY: 1.1, driftX: 0, driftY: 0, opacity: 0.75, plane: "front", fadeNearPlayer: true },
};

export interface ResolvedLayers {
  behind: ParallaxLayer[];
  front: ParallaxLayer[];
  /** Set actually used, for the studio to display. */
  setId: string | null;
}

const EMPTY: ResolvedLayers = { behind: [], front: [], setId: null };

/** Fill in every unset knob so render code can read fields unconditionally. */
export function withLayerDefaults(layer: ParallaxLayer): Required<Omit<ParallaxLayer, "name" | "sprite" | "props">> &
  Pick<ParallaxLayer, "name" | "sprite" | "props"> {
  return { ...LAYER_DEFAULTS, ...stripUndefined(layer) } as never;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Which set does this room use? Explicit binding wins, then the file default. */
export function setIdForRoom(layersFile: LayersFile | undefined, roomId: string): string | null {
  if (!layersFile) return null;
  const bound = layersFile.rooms?.[roomId]?.setId;
  if (bound && layersFile.sets?.[bound]) return bound;
  if (bound) return null; // bound to a set that no longer exists — draw nothing
  const def = layersFile.defaultSetId;
  return def && layersFile.sets?.[def] ? def : null;
}

/**
 * Resolve an explicit set (rather than whichever one a room is bound to):
 * overrides -> defaults -> split by plane. The Art Studio previews the set
 * being EDITED through this, which matters because a set that isn't bound to
 * any room yet would otherwise preview as whatever the previewed room does
 * use — silently showing someone else's art while you work.
 */
export function resolveLayerSet(
  set: LayerSet | undefined,
  overrides: Record<string, Partial<ParallaxLayer>> = {}
): { behind: ParallaxLayer[]; front: ParallaxLayer[] } {
  const behind: ParallaxLayer[] = [];
  const front: ParallaxLayer[] = [];
  for (const raw of set?.layers ?? []) {
    const merged = withLayerDefaults({ ...raw, ...stripUndefined(overrides[raw.id] ?? {}) });
    const hasArt = !!merged.sprite || !!merged.props?.some((p) => p.sprite);
    if (!hasArt || merged.opacity <= 0) continue;
    (merged.plane === "front" ? front : behind).push(merged);
  }
  return { behind, front };
}

/**
 * Resolve a room's drawable layers: set lookup -> per-layer overrides ->
 * defaults -> split by plane. Layers with no sprite AND no props are dropped,
 * which is what makes the shipped (art-free) default set render exactly like
 * the game did before parallax existed.
 */
export function resolveRoomLayers(content: Content, roomId: string): ResolvedLayers {
  const file = content.layers;
  const setId = setIdForRoom(file, roomId);
  if (!setId) return EMPTY;
  return {
    ...resolveLayerSet(file.sets[setId], file.rooms?.[roomId]?.overrides ?? {}),
    setId,
  };
}
