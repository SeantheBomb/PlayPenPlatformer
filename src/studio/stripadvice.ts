// What size should a parallax strip actually be? Pure math, no DOM — the
// Art Studio shows this live while the artist drags the layer sliders.
//
// Two rules govern it, and neither is guessable from looking at the canvas:
//
// WIDTH — how far the layer travels. A point at layer-space `p` shows up on
// screen at `p - cam * scrollX`, so over a room's whole camera travel `S` the
// viewer sees layer-space [0, S*scrollX + VIEW_W]. A strip at least that wide
// crosses the room without the repeat ever coming around; anything narrower
// repeats `(S*scrollX + VIEW_W) / width` times. Note the direction of the
// effect: a NEARER layer (higher scrollX) travels further and so needs a WIDER
// strip, which is the opposite of the intuition that distant things need more.
//
// HEIGHT — whether it still covers the view at the bottom of a tall room. The
// strip's top sits at `camY * (1 - scrollY) + offsetY`, so as the camera falls
// the strip falls more slowly and eventually runs out below. Covering the
// worst case needs `VIEW_H + SY*scrollY - offsetY`. This is the trap the
// generated placeholders hit first: a foreground layer at scrollY 1.1 needs a
// ~950px-tall strip to cover Mess Hall, or it must repeat downwards instead.
//
// Note that strips are drawn at their NATURAL pixel size (1 image px = 1 world
// px), unlike every other asset in the studio, which is fitted to a box. More
// pixels therefore means more world covered, not a crisper picture.

export interface StripRoom {
  id: string;
  name: string;
  /** Room size in world pixels. */
  worldW: number;
  worldH: number;
}

export interface StripSettings {
  scrollX: number;
  scrollY: number;
  offsetY: number;
  wrapX: boolean;
  wrapY: boolean;
  driftX: number;
  driftY: number;
}

export interface StripAdvice {
  /** Width at which the repeat never comes around in this room. */
  width: number;
  /** Height needed to cover this room's view at every camera position. */
  height: number;
  /** How many times the current strip repeats across the room (null if no art). */
  repeatsAcross: number | null;
  /** True when the current strip is too short to cover the room vertically. */
  fallsShort: boolean;
}

export interface StripGuidance {
  /** Advice for the room currently in the preview. */
  room: StripAdvice & { roomName: string };
  /** Worst case over every room this set is bound to. */
  worst: { width: number; height: number; roomCount: number; widthRoom: string; heightRoom: string };
  /** Plain-language notes: caveats and problems worth acting on. */
  notes: string[];
  problems: string[];
}

/** Camera travel available in a room, in world px. */
const travelX = (room: StripRoom, viewW: number) => Math.max(0, room.worldW - viewW);
const travelY = (room: StripRoom, viewH: number) => Math.max(0, room.worldH - viewH);

/** Slack before "too short" is worth saying out loud. Being a couple of
 *  pixels shy of the bottom of one room is invisible in play, and warning
 *  about it just trains her to ignore the panel. */
const SHORT_TOLERANCE_PX = 8;

/** Below this, tiling is a texture; above it, it reads as a repeated image
 *  whatever the art is. Between the two it depends on the art, so we report
 *  the number without calling it a problem. */
const REPEAT_OBVIOUS = 6;

export function adviceForRoom(
  room: StripRoom, s: StripSettings, current: { w: number; h: number } | null, viewW: number, viewH: number
): StripAdvice {
  const spanX = viewW + travelX(room, viewW) * Math.abs(s.scrollX);
  // A negative offset pushes the strip UP, so more height is needed below it;
  // a positive offset already starts lower and can't be counted as coverage.
  const spanY = viewH + travelY(room, viewH) * s.scrollY - Math.min(0, s.offsetY);
  const width = Math.ceil(spanX);
  const height = Math.max(viewH, Math.ceil(spanY));
  return {
    width,
    height,
    repeatsAcross: current && current.w > 0 ? spanX / current.w : null,
    fallsShort: !s.wrapY && !!current && current.h > 0 && current.h < height - SHORT_TOLERANCE_PX,
  };
}

export interface FirstPassRow {
  depth: string;
  /** Size that never repeats in ANY room. */
  width: number;
  height: number;
  /** Size that never repeats in every room but the widest one. */
  widthMost: number;
  /** Rooms covered by widthMost, and the outlier it gives up on. */
  mostCount: number;
  outlierRoom: string;
  /** How much the single widest room inflates the requirement. */
  outlierInflationPct: number;
}

/**
 * What to draw for a whole campaign in one pass. The per-layer panel answers
 * "what fits this room"; this answers "what should I actually draw", which is
 * a different question because the maximums are usually set by one outlier
 * room. Reporting both the all-rooms figure and the all-but-the-widest figure
 * lets her see what that last room is costing her before paying for it.
 */
export function firstPassPlan(
  rooms: StripRoom[], presets: Record<string, { scrollX: number; scrollY: number }>,
  viewW: number, viewH: number
): FirstPassRow[] {
  if (!rooms.length) return [];
  const byTravel = [...rooms].sort((a, b) => travelX(b, viewW) - travelX(a, viewW));
  const widest = byTravel[0];
  const secondTravel = byTravel.length > 1 ? travelX(byTravel[1], viewW) : travelX(widest, viewW);
  const maxTravelY = Math.max(...rooms.map((r) => travelY(r, viewH)));

  return Object.entries(presets).map(([depth, p]) => {
    const width = Math.ceil(viewW + travelX(widest, viewW) * p.scrollX);
    const widthMost = Math.ceil(viewW + secondTravel * p.scrollX);
    return {
      depth,
      width,
      height: Math.max(viewH, Math.ceil(viewH + maxTravelY * p.scrollY)),
      widthMost,
      mostCount: rooms.length - 1,
      outlierRoom: widest.name,
      outlierInflationPct: widthMost > 0 ? Math.round(((width - widthMost) / widthMost) * 100) : 0,
    };
  });
}

export function stripGuidance(
  rooms: StripRoom[], previewRoomId: string, s: StripSettings,
  current: { w: number; h: number } | null, viewW: number, viewH: number
): StripGuidance {
  const list = rooms.length ? rooms : [];
  const preview = list.find((r) => r.id === previewRoomId) ?? list[0];
  const previewAdvice = preview
    ? adviceForRoom(preview, s, current, viewW, viewH)
    : { width: viewW, height: viewH, repeatsAcross: null, fallsShort: false };

  let worstW = viewW, worstH = viewH, widthRoom = preview?.name ?? "", heightRoom = preview?.name ?? "";
  for (const r of list) {
    const a = adviceForRoom(r, s, current, viewW, viewH);
    if (a.width > worstW) { worstW = a.width; widthRoom = r.name; }
    if (a.height > worstH) { worstH = a.height; heightRoom = r.name; }
  }

  const notes: string[] = [];
  const problems: string[] = [];

  if (s.wrapY) {
    notes.push("Repeats downwards, so any height works — just make the top and bottom edges match.");
  } else if (previewAdvice.fallsShort && current) {
    problems.push(
      `Too short for ${preview?.name}: ${current.h}px tall, needs ${previewAdvice.height}px to reach the ` +
      `bottom of the room. Turn on “repeats downwards”, or draw it taller.`
    );
  }

  const repeats = previewAdvice.repeatsAcross;
  if (s.wrapX === false) {
    notes.push("Not repeating sideways — it draws once, so anywhere the strip doesn't reach shows the room's flat background.");
  } else if (repeats !== null && repeats > REPEAT_OBVIOUS) {
    problems.push(
      `Repeats ${repeats.toFixed(1)}× while crossing ${preview?.name} — at that rate it reads as a repeated ` +
      `image whatever the art is. ${previewAdvice.width}px wide would cross the room without repeating at all.`
    );
  } else if (repeats !== null && repeats > 1.6) {
    notes.push(
      `Repeats ${repeats.toFixed(1)}× crossing ${preview?.name} — fine for a soft texture, noticeable for ` +
      `anything with a landmark in it.`
    );
  }

  if (s.driftX || s.driftY) {
    notes.push("Drift keeps it moving, so the seam comes around eventually whatever the size — seamless edges matter more than raw width here.");
  }
  if (Math.abs(s.scrollX) < 0.05) {
    notes.push(`Barely moves sideways, so ${viewW}px is already plenty wide.`);
  }

  return {
    room: { ...previewAdvice, roomName: preview?.name ?? "—" },
    worst: { width: worstW, height: worstH, roomCount: list.length, widthRoom, heightRoom },
    notes,
    problems,
  };
}
