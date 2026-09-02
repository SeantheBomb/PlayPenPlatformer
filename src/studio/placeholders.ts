// Procedurally generated placeholder strips for parallax layers, so the
// depth system can be seen and felt before any real art exists — and so the
// artist has a concrete reference for what each plane is FOR.
//
// Generated in the browser rather than committed as files: they cost nothing
// in the published bundle until someone actually publishes them, and the
// shipped content/layers.json stays deliberately art-free (see CLAUDE.md).
//
// Drawn in the same language as the rest of the game's art — flat primitives
// from the PlayPen palette, no gradients, no smoothing — and themed to the
// facility (distant silos and towers, interior pillars and shelving, crib
// bars up front). Every strip is seamlessly TILEABLE: `wrapped()` draws each
// element again one strip-width to either side, so anything crossing an edge
// meets itself exactly when the strip repeats.

export type PlaceholderDepth = "far" | "mid" | "near";

/** View-height strips: tall enough to fill the 640×360 view without needing
 *  vertical wrap, wide enough that the repeat isn't obvious at a glance. */
const SIZES: Record<PlaceholderDepth, { w: number; h: number }> = {
  far: { w: 192, h: 360 },
  mid: { w: 160, h: 360 },
  near: { w: 320, h: 360 },
};

/**
 * Whether each placeholder also tiles VERTICALLY. This matters more than it
 * looks: a layer with scrollY near 1 barely moves relative to the world, so a
 * 360-tall strip only ever covers the top 360px of the room — in Mess Hall
 * (896px tall) the foreground would simply vanish below the first screen.
 * The mid and near patterns are therefore built to repeat down the page
 * (stacked floors, continuous bars); the far one is a horizon and must NOT
 * repeat, since a second horizon halfway down reads as broken.
 */
export const PLACEHOLDER_WRAP_Y: Record<PlaceholderDepth, boolean> = {
  far: false,
  mid: true,
  near: true,
};

function strip(
  depth: PlaceholderDepth,
  draw: (g: CanvasRenderingContext2D, w: number, h: number, wrapped: (fn: (dx: number) => void) => void) => void
): string {
  const { w, h } = SIZES[depth];
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  // Draw each element three times (−w, 0, +w) so shapes that overhang an
  // edge reappear on the opposite side and the strip tiles seamlessly.
  const wrapped = (fn: (dx: number) => void) => {
    for (const dx of [-w, 0, w]) {
      g.save();
      g.translate(dx, 0);
      fn(dx);
      g.restore();
    }
  };
  draw(g, w, h, wrapped);
  return cv.toDataURL("image/png");
}

/** Distant facility: a low horizon, silos and towers, a few dim windows.
 *  Deliberately low-contrast — a far layer that competes with the level
 *  reads as clutter rather than distance. */
function farStrip(): string {
  return strip("far", (g, w, h, wrapped) => {
    const horizon = Math.round(h * 0.56);
    // Sky wash + a scatter of faint specks for texture.
    g.fillStyle = "#191430";
    g.fillRect(0, 0, w, horizon);
    g.fillStyle = "#221c3d";
    for (let i = 0; i < 26; i++) {
      const x = (i * 37) % w, y = (i * 53) % horizon;
      g.fillRect(x, y, 2, 2);
    }
    // Silhouettes along the horizon: alternating silos (domed) and towers.
    const units = [
      { x: 10, w: 34, top: 96, dome: true },
      { x: 58, w: 22, top: 132, dome: false },
      { x: 88, w: 40, top: 74, dome: true },
      { x: 140, w: 26, top: 118, dome: false },
      { x: 176, w: 30, top: 100, dome: true },
    ];
    for (const u of units) {
      wrapped(() => {
        g.fillStyle = "#241f3a";
        g.fillRect(u.x, u.top, u.w, horizon - u.top);
        if (u.dome) {
          g.beginPath();
          g.arc(u.x + u.w / 2, u.top, u.w / 2, Math.PI, 0);
          g.fill();
        } else {
          g.fillStyle = "#2a2444";
          g.fillRect(u.x - 3, u.top - 5, u.w + 6, 5); // water-tower cap
          g.fillStyle = "#241f3a";
        }
        // A couple of dim windows so it reads as built, not as hills.
        g.fillStyle = "#2f2851";
        for (let wy = u.top + 14; wy < horizon - 10; wy += 18) {
          g.fillRect(u.x + 6, wy, 4, 6);
          if (u.w > 28) g.fillRect(u.x + u.w - 10, wy, 4, 6);
        }
      });
    }
    // Ground haze below the horizon.
    g.fillStyle = "#1d1834";
    g.fillRect(0, horizon, w, h - horizon);
    g.fillStyle = "#221c3d";
    g.fillRect(0, horizon, w, 3);
  });
}

/** Facility interior one plane back: full-height pillars, a shelf, and a
 *  string of lights. Built to repeat DOWN as well as across — the vertical
 *  repeat reads as another storey of the same building, which is why the
 *  pillars run edge to edge and the detail bands sit well clear of the seam. */
function midStrip(): string {
  return strip("mid", (g, w, h, wrapped) => {
    for (const px of [12, 76, 132]) {
      wrapped(() => {
        g.fillStyle = "#332e4a";
        g.fillRect(px, 0, 18, h);          // continuous across the top/bottom seam
        g.fillStyle = "#3d3a52";
        g.fillRect(px, 0, 6, h);           // lit edge
        g.fillStyle = "#4a4668";
        g.fillRect(px - 4, 44, 26, 8);     // capital, one per storey
        g.fillRect(px - 4, 300, 26, 6);    // base band
      });
    }
    // Shelving suspended between the pillars.
    for (const s of [{ x: 34, y: 130 }, { x: 96, y: 196 }]) {
      wrapped(() => {
        g.fillStyle = "#2e2a45";
        g.fillRect(s.x, s.y, 40, 7);
        g.fillStyle = "#39344f";
        g.fillRect(s.x, s.y, 40, 2);
        for (let i = 0; i < 3; i++) g.fillRect(s.x + 4 + i * 13, s.y - 9, 8, 9); // boxes
      });
    }
    // String lights — the same pink family as the stringlight tile. Ends meet
    // at the same height on both edges so the swag continues when it repeats.
    wrapped(() => {
      const y0 = 84, sag = 22;
      g.strokeStyle = "#3a3355";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, y0);
      g.quadraticCurveTo(w / 2, y0 + sag * 2, w, y0);
      g.stroke();
      g.fillStyle = "#5c4a63";
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const x = t * w;
        const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * (y0 + sag * 2) + t * t * y0;
        g.fillRect(Math.round(x) - 1, Math.round(y) + 2, 3, 4);
      }
    });
  });
}

/** Foreground: crib bars, mostly empty so the level still reads through it.
 *  Uniform down the whole strip so it tiles vertically without banding, and
 *  sparse across so it never becomes a fence — it pairs with the layer's
 *  fade-around-the-player guard rather than relying on it. */
function nearStrip(): string {
  return strip("near", (g, w, h, wrapped) => {
    // One wide bar and one thin one, well apart: at 320px wide this is about
    // four bars across a 640px view, which reads as depth rather than clutter.
    wrapped(() => {
      g.fillStyle = "#100d1a";
      g.fillRect(24, 0, 18, h);
      g.fillStyle = "#191430";
      g.fillRect(38, 0, 4, h);   // rim light down one side
      g.fillStyle = "#0c0a14";
      g.fillRect(29, 0, 3, h);   // seam
    });
    wrapped(() => {
      g.fillStyle = "#12101c";
      g.fillRect(198, 0, 8, h);
      g.fillStyle = "#191430";
      g.fillRect(204, 0, 2, h);
    });
    // Bolts, spaced down the bars — placed on a divisor of the height so the
    // rhythm survives the vertical repeat.
    g.fillStyle = "#0c0a14";
    for (let y = 30; y < h; y += 90) {
      wrapped(() => {
        g.fillRect(28, y, 10, 4);
        g.fillRect(199, y + 45, 6, 3);
      });
    }
  });
}

/** One placeholder strip for the given depth. */
export function makePlaceholderStrip(depth: PlaceholderDepth): string {
  return depth === "far" ? farStrip() : depth === "mid" ? midStrip() : nearStrip();
}

export interface PlaceholderLayer {
  depth: PlaceholderDepth;
  name: string;
  sprite: string;
  wrapY: boolean;
}

/** The full three-plane set: far silos, mid pillars, foreground bars. */
export function makePlaceholderSet(): PlaceholderLayer[] {
  return (["far", "mid", "near"] as const).map((depth) => ({
    depth,
    name: {
      far: "Far — distant facility (placeholder)",
      mid: "Mid — pillars & shelving (placeholder)",
      near: "Foreground — bars (placeholder)",
    }[depth],
    sprite: makePlaceholderStrip(depth),
    wrapY: PLACEHOLDER_WRAP_Y[depth],
  }));
}
