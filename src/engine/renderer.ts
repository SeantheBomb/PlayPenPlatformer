// Canvas drawing helpers shared by the game and the editor's room preview.
// All art is procedural primitives — no image assets.
import type { ItemDef, NpcAvatar, SpriteFields, TileDef, WardenEmotion } from "../data/types";
import { TILE, TileMap } from "./tilemap";

// ---- Custom sprite support (data-URI images stored in content) ----

const imgCache = new Map<string, HTMLImageElement>();

function getImage(uri: string): HTMLImageElement | null {
  let img = imgCache.get(uri);
  if (!img) {
    img = new Image();
    img.src = uri;
    imgCache.set(uri, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export function currentFrame(s: SpriteFields): string | null {
  if (s.spriteFrames && s.spriteFrames.length > 0) {
    const fps = s.spriteFps || 6;
    const i = Math.floor((performance.now() / 1000) * fps) % s.spriteFrames.length;
    return s.spriteFrames[i];
  }
  return s.sprite ?? null;
}

/** Draw a custom sprite if one is set and loaded. Returns true if drawn. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  s: SpriteFields,
  x: number, y: number, w: number, h: number,
  facing = 1
): boolean {
  const uri = currentFrame(s);
  if (!uri) return false;
  const img = getImage(uri);
  if (!img) return false; // still loading — procedural fallback this frame
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (facing < 0) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, w, h);
  } else {
    ctx.drawImage(img, x, y, w, h);
  }
  ctx.restore();
  return true;
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 255) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amt));
  const b = Math.min(255, Math.max(0, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawTile(
  ctx: CanvasRenderingContext2D,
  def: TileDef,
  px: number, py: number,
  animT = 0,
  capped = false
): void {
  if (drawSprite(ctx, def, px, py, TILE, TILE)) return;
  const c = def.color;
  switch (def.style) {
    case "block": {
      ctx.fillStyle = c;
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = shade(c, 18);
      ctx.fillRect(px, py, TILE, 2);
      ctx.fillStyle = shade(c, -22);
      ctx.fillRect(px, py + TILE - 2, TILE, 2);
      ctx.fillRect(px + TILE - 2, py, 2, TILE);
      break;
    }
    case "platform": {
      ctx.fillStyle = c;
      ctx.fillRect(px, py, TILE, 5);
      ctx.fillStyle = shade(c, 24);
      ctx.fillRect(px, py, TILE, 2);
      ctx.fillStyle = shade(c, -30);
      ctx.fillRect(px + 2, py + 5, 2, 3);
      ctx.fillRect(px + TILE - 4, py + 5, 2, 3);
      break;
    }
    case "spikes": {
      ctx.fillStyle = c;
      for (let i = 0; i < 4; i++) {
        const sx = px + i * 4;
        ctx.beginPath();
        ctx.moveTo(sx, py + TILE);
        ctx.lineTo(sx + 2, py + 4);
        ctx.lineTo(sx + 4, py + TILE);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "cracked": {
      ctx.fillStyle = c;
      ctx.fillRect(px, py, TILE, TILE);
      ctx.strokeStyle = shade(c, -40);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 3, py + 2);
      ctx.lineTo(px + 8, py + 7);
      ctx.lineTo(px + 5, py + 12);
      ctx.moveTo(px + 12, py + 3);
      ctx.lineTo(px + 9, py + 9);
      ctx.lineTo(px + 13, py + 14);
      ctx.stroke();
      break;
    }
    case "spring": {
      ctx.fillStyle = shade(c, -40);
      ctx.fillRect(px + 2, py + 10, TILE - 4, 6);
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + 4, py + 10);
      ctx.lineTo(px + 12, py + 7);
      ctx.moveTo(px + 4, py + 7);
      ctx.lineTo(px + 12, py + 10);
      ctx.stroke();
      ctx.fillStyle = c;
      ctx.fillRect(px + 2, py + 4, TILE - 4, 3);
      break;
    }
    case "goo": {
      const wob = Math.sin(animT * 3 + px * 0.4) * 1.5;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(px, py + TILE);
      ctx.quadraticCurveTo(px + 4, py + 6 + wob, px + 8, py + 8);
      ctx.quadraticCurveTo(px + 12, py + 10 - wob, px + TILE, py + 7);
      ctx.lineTo(px + TILE, py + TILE);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(c, 30);
      ctx.beginPath();
      ctx.arc(px + 5, py + 11 + wob * 0.5, 1.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "wood": {
      ctx.fillStyle = c;
      ctx.fillRect(px, py, TILE, TILE);
      ctx.strokeStyle = shade(c, -35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py + 5);
      ctx.lineTo(px + TILE, py + 4);
      ctx.moveTo(px, py + 11);
      ctx.lineTo(px + TILE, py + 12);
      ctx.stroke();
      ctx.fillStyle = shade(c, 16);
      ctx.fillRect(px, py, TILE, 2);
      ctx.fillStyle = shade(c, -40);
      ctx.beginPath();
      ctx.arc(px + 11, py + 8, 1.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "ice": {
      ctx.fillStyle = c;
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(px, py, TILE, 2);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 3, py + 12);
      ctx.lineTo(px + 8, py + 5);
      ctx.moveTo(px + 10, py + 13);
      ctx.lineTo(px + 13, py + 9);
      ctx.stroke();
      ctx.fillStyle = shade(c, -40);
      ctx.fillRect(px, py + TILE - 1.5, TILE, 1.5);
      break;
    }
    case "water": {
      if (capped) {
        // Fully submerged (a solid or another water tile sits above) — no
        // "surface" to speak of, so skip the wavy top and just show depth.
        ctx.fillStyle = "rgba(45,140,190,0.5)";
        ctx.fillRect(px, py, TILE, TILE);
        const bob = Math.sin(animT * 1.6 + px * 0.5) * 1.2;
        ctx.fillStyle = "rgba(200,235,255,0.35)";
        ctx.beginPath();
        ctx.arc(px + 5, py + 10 + bob, 1, 0, Math.PI * 2);
        ctx.arc(px + 11, py + 5 - bob, 0.8, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      const wave = Math.sin(animT * 2.4 + px * 0.35) * 1.6;
      ctx.fillStyle = "rgba(79,195,247,0.55)";
      ctx.beginPath();
      ctx.moveTo(px, py + 4 + wave);
      ctx.quadraticCurveTo(px + 8, py + 2 - wave, px + TILE, py + 4 + wave * 0.6);
      ctx.lineTo(px + TILE, py + TILE);
      ctx.lineTo(px, py + TILE);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 1, py + 4 + wave);
      ctx.quadraticCurveTo(px + 8, py + 2 - wave, px + TILE - 1, py + 4 + wave * 0.6);
      ctx.stroke();
      break;
    }
    case "fire": {
      // Hazard fire: jagged, fast, white-hot tips, sparks — reads as "will hurt you."
      ctx.fillStyle = "rgba(210,40,20,0.16)";
      ctx.fillRect(px, py, TILE, TILE);
      for (let i = 0; i < 3; i++) {
        const fx = px + 3 + i * 5;
        const jitter = Math.sin(animT * 17 + px + i * 2.7) * 1.3;
        const hgt = 9 + Math.sin(animT * 12 + px + i * 3.1) * 3.5;
        ctx.fillStyle = i % 2 ? "#d32f2f" : "#ff6d1f";
        ctx.beginPath();
        ctx.moveTo(fx - 2.8, py + TILE);
        ctx.lineTo(fx - 1.2 + jitter * 0.4, py + TILE - hgt * 0.95);
        ctx.lineTo(fx + jitter, py + TILE - hgt * 1.75);
        ctx.lineTo(fx + 1.2 - jitter * 0.4, py + TILE - hgt * 0.95);
        ctx.lineTo(fx + 2.8, py + TILE);
        ctx.closePath();
        ctx.fill();
        if (Math.sin(animT * 23 + i * 5) > 0.5) {
          ctx.fillStyle = "#fff3c4";
          ctx.beginPath();
          ctx.arc(fx + jitter * 0.5, py + TILE - hgt * 1.6, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // A stray ember or two, popping up off the hazard.
      for (let i = 0; i < 2; i++) {
        const t = (animT * 0.7 + i * 0.6) % 1;
        const ex = px + 4 + i * 8 + Math.sin(animT * 6 + i) * 2;
        const ey = py + TILE - t * 14;
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = "#ffb74d";
        ctx.fillRect(ex, ey, 1.4, 1.4);
        ctx.globalAlpha = 1;
      }
      break;
    }
    case "waterfall": {
      const t = animT * 60;
      ctx.fillStyle = "rgba(79,195,247,0.30)";
      ctx.fillRect(px + 1, py, TILE - 2, TILE);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        const sx = px + 3 + i * 5;
        const off = (t + i * 7 + px) % TILE;
        ctx.beginPath();
        ctx.moveTo(sx, py + off - 6);
        ctx.lineTo(sx, py + off);
        ctx.stroke();
      }
      break;
    }
    case "lava": {
      // Molten rock: reads hot/dangerous like hazard fire — dark crust,
      // bright churning seams, popping white-hot flecks.
      const wave = Math.sin(animT * 3.1 + px * 0.4) * 1.2;
      ctx.fillStyle = "rgba(120,28,10,0.92)";
      ctx.beginPath();
      ctx.moveTo(px, py + 3 + wave);
      ctx.quadraticCurveTo(px + 8, py + 1.5 - wave, px + TILE, py + 3 + wave * 0.6);
      ctx.lineTo(px + TILE, py + TILE);
      ctx.lineTo(px, py + TILE);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(px + 1, py + 4 + wave);
      ctx.quadraticCurveTo(px + 8, py + 2 - wave, px + TILE - 1, py + 4 + wave * 0.6);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,150,60,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 2, py + 9 + Math.sin(animT * 2.2 + px) * 1.5);
      ctx.quadraticCurveTo(px + 9, py + 11 - wave, px + TILE - 2, py + 9 + wave);
      ctx.stroke();
      if (Math.sin(animT * 9 + px * 1.3) > 0.55) {
        ctx.fillStyle = "#ffe9a8";
        const fx = px + 4 + ((px * 7) % 8);
        ctx.fillRect(fx, py + 5 + Math.sin(animT * 5 + px) * 2, 1.6, 1.6);
      }
      break;
    }
    case "lavafall": {
      // Falling lava: waterfall's motion language, ember-hot palette.
      const t = animT * 34;
      ctx.fillStyle = "rgba(200,60,20,0.38)";
      ctx.fillRect(px + 1, py, TILE - 2, TILE);
      ctx.strokeStyle = "rgba(255,180,80,0.75)";
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const sx = px + 3 + i * 5;
        const off = (t + i * 7 + px) % TILE;
        ctx.beginPath();
        ctx.moveTo(sx, py + off - 6);
        ctx.lineTo(sx, py + off);
        ctx.stroke();
      }
      if (Math.sin(animT * 11 + px * 2.1) > 0.6) {
        ctx.fillStyle = "#fff3c4";
        ctx.fillRect(px + 4 + ((px * 5) % 8), py + ((t * 1.3 + px) % TILE), 1.4, 1.4);
      }
      break;
    }
    case "metal": {
      ctx.fillStyle = c;
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = shade(c, 22);
      ctx.fillRect(px, py, TILE, 2);
      ctx.fillStyle = shade(c, -28);
      ctx.fillRect(px, py + TILE - 2, TILE, 2);
      ctx.fillStyle = shade(c, -18);
      for (const [rx, ry] of [[3, 4], [12, 4], [3, 12], [12, 12]] as const) {
        ctx.beginPath();
        ctx.arc(px + rx, py + ry, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "drain": {
      // A grate over a dark pit with slowly spinning slats — reads as
      // "things go in here", the opposite motion language of flowing water.
      ctx.fillStyle = shade(c, -20);
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = shade(c, 18);
      ctx.fillRect(px, py, TILE, 2);
      ctx.fillStyle = shade(c, -35);
      ctx.fillRect(px, py + TILE - 2, TILE, 2);
      const cx = px + TILE / 2, cy = py + TILE / 2;
      ctx.fillStyle = "#12101c";
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shade(c, 32);
      ctx.lineWidth = 1;
      const spin = animT * 1.1;
      for (let i = 0; i < 5; i++) {
        const a = spin + (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * 5.5, cy + Math.sin(a) * 5.5);
        ctx.stroke();
      }
      break;
    }
    // ---- Decor set: the PlayPen's playtime dressing ----
    case "balloon": {
      // A balloon bobbing on its string, tied to the tile below.
      const bx = px + TILE / 2 + Math.sin(animT * 1.3 + px * 0.3) * 1.5;
      const by = py + 6 + Math.sin(animT * 1.8 + px * 0.7) * 1;
      ctx.strokeStyle = "rgba(232,226,244,0.5)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(bx, by + 5);
      ctx.quadraticCurveTo(bx + 1.5, by + 9, px + TILE / 2, py + TILE);
      ctx.stroke();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(bx, by, 4.4, 5.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(c, 55);
      ctx.beginPath();
      ctx.ellipse(bx - 1.5, by - 1.8, 1.3, 1.8, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(c, -30); // the knot
      ctx.fillRect(bx - 1, by + 4.6, 2, 1.6);
      break;
    }
    case "stringlight": {
      // A sagging run of party lights. Bulbs breathe; one per string is
      // always dead (nobody changes them).
      const cy = py + 4;
      ctx.strokeStyle = "#3a3550";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, cy);
      ctx.quadraticCurveTo(px + TILE / 2, cy + 4, px + TILE, cy);
      ctx.stroke();
      const bulbColors = [c, "#7fd8a8", "#ffd166", "#7fb4d8"];
      for (let i = 0; i < 4; i++) {
        const bt = (i + 0.5) / 4;
        const bx = px + bt * TILE;
        const by = cy + 4 * (1 - Math.abs(bt - 0.5) * 2) * 0.9 + 2.4;
        const dead = (Math.floor(px / TILE) + i) % 7 === 3;
        const glow = dead ? 0 : 0.6 + Math.sin(animT * 2 + i * 1.9 + px) * 0.4;
        const bc = bulbColors[i % bulbColors.length];
        if (glow > 0) {
          ctx.fillStyle = bc;
          ctx.globalAlpha = 0.16 * glow;
          ctx.beginPath();
          ctx.arc(bx, by, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = dead ? "#3a3550" : bc;
        ctx.beginPath();
        ctx.ellipse(bx, by, 1.4, 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "crayon": {
      // Crayon wall-scribble: a looping doodle only a kid (or Toby) would
      // sign. Deterministic per-tile so the art holds still.
      const seed = (px * 31 + py * 17) % 97;
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      let lx = px + 3, ly = py + 4 + (seed % 5);
      ctx.moveTo(lx, ly);
      for (let i = 1; i <= 5; i++) {
        const nx = px + 2 + ((seed * i * 7) % 12);
        const ny = py + 2 + ((seed * i * 13) % 12);
        ctx.quadraticCurveTo(lx + 3, ly - 3, nx, ny);
        lx = nx; ly = ny;
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case "toyblock": {
      // Alphabet block: solid, stackable, aggressively cheerful.
      ctx.fillStyle = c;
      roundRect(ctx, px + 0.5, py + 0.5, TILE - 1, TILE - 1, 2.5);
      ctx.fill();
      ctx.fillStyle = shade(c, 35);
      roundRect(ctx, px + 0.5, py + 0.5, TILE - 1, 3.5, 2.5);
      ctx.fill();
      ctx.fillStyle = shade(c, -35);
      roundRect(ctx, px + 0.5, py + TILE - 3.5, TILE - 1, 3, 2.5);
      ctx.fill();
      // Inset face + stamped letter (varies by position: P L A Y)
      ctx.strokeStyle = shade(c, -25);
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 3, py + 3, TILE - 6, TILE - 6);
      const letters = ["P", "L", "A", "Y"];
      const ch = letters[(Math.floor(px / TILE) + Math.floor(py / TILE)) % 4];
      ctx.fillStyle = shade(c, -50);
      ctx.font = "bold 8px monospace";
      ctx.fillText(ch, px + TILE / 2 - 2.5, py + TILE / 2 + 3);
      break;
    }
  }
}

export function drawMap(
  ctx: CanvasRenderingContext2D,
  map: TileMap,
  camX: number, camY: number,
  viewW: number, viewH: number,
  animT = 0
): void {
  const tx0 = Math.max(0, Math.floor(camX / TILE));
  const ty0 = Math.max(0, Math.floor(camY / TILE));
  const tx1 = Math.min(map.width - 1, Math.ceil((camX + viewW) / TILE));
  const ty1 = Math.min(map.height - 1, Math.ceil((camY + viewH) / TILE));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const def = map.at(tx, ty);
      if (!def) continue;
      let capped = false;
      if (def.style === "water") {
        const above = map.at(tx, ty - 1);
        capped = !!above && (above.solid || above.style === "water");
      }
      drawTile(ctx, def, tx * TILE, ty * TILE, animT, capped);
    }
  }
}

/** Soft dotted backdrop so rooms don't feel like a void. */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  bg: string,
  camX: number, camY: number,
  viewW: number, viewH: number
): void {
  ctx.fillStyle = bg;
  ctx.fillRect(camX, camY, viewW, viewH);
  ctx.fillStyle = shade(bg, 12);
  const spacing = 48;
  const x0 = Math.floor(camX / spacing) * spacing;
  const y0 = Math.floor(camY / spacing) * spacing;
  for (let y = y0; y < camY + viewH + spacing; y += spacing) {
    for (let x = x0; x < camX + viewW + spacing; x += spacing) {
      // Parallax-ish drift based on world position
      ctx.fillRect(x + ((y / spacing) % 2) * 24 - camX * 0.1, y - camY * 0.05, 2, 2);
    }
  }
}

/** Draw a rounded "blob with eyes" character. Used by player, enemies, NPCs. */
export function drawBlob(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  color: string, eyeColor: string, facing: number,
  opts: {
    squashX?: number; squashY?: number;
    eyeStyle?: "dot" | "wide" | "sleepy"; blink?: boolean;
    sprite?: SpriteFields;
    /** Unfinished-construct look: dashed outline, thin fill, a missing
     *  corner that never quite loads in. */
    sketch?: boolean;
  } = {}
): void {
  const sx = opts.squashX ?? 1;
  const sy = opts.squashY ?? 1;
  const dw = w * sx;
  const dh = h * sy;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh); // keep feet planted when squashing
  if (opts.sprite && drawSprite(ctx, opts.sprite, dx, dy, dw, dh, facing)) return;
  if (opts.sketch) {
    // Half-loaded: translucent body, dashed edge, one corner missing.
    ctx.save();
    ctx.globalAlpha *= 0.82;
    ctx.fillStyle = color;
    roundRect(ctx, dx, dy, dw, dh, Math.min(5, dw / 3));
    ctx.fill();
    // The missing chunk — a bite of un-rendered corner, slowly wandering
    // (purely cosmetic, wall-clock is fine here). Painted dark rather than
    // truly cleared so the room behind isn't punched through.
    const gt = performance.now() / 1000;
    const notchW = dw * 0.34;
    const notchH = dh * 0.2;
    const top = Math.sin(gt * 0.7) > 0;
    ctx.fillStyle = "rgba(10,8,16,0.55)";
    ctx.fillRect(
      facing >= 0 ? dx : dx + dw - notchW,
      top ? dy : dy + dh - notchH,
      notchW, notchH
    );
    ctx.globalAlpha = 1;
    ctx.strokeStyle = shade(color, 60);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.lineDashOffset = -gt * 6; // crawling ants: still rendering...
    roundRect(ctx, dx + 0.5, dy + 0.5, dw - 1, dh - 1, Math.min(5, dw / 3));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  } else {
    ctx.fillStyle = color;
    roundRect(ctx, dx, dy, dw, dh, Math.min(5, dw / 3));
    ctx.fill();
    ctx.fillStyle = shade(color, 26);
    roundRect(ctx, dx, dy, dw, Math.max(2, dh * 0.22), Math.min(5, dw / 3));
    ctx.fill();
  }
  // Eyes
  const eyeY = dy + dh * 0.32;
  const gap = dw * 0.22;
  const cx = dx + dw / 2 + facing * dw * 0.12;
  ctx.fillStyle = eyeColor;
  if (opts.blink) {
    ctx.fillRect(cx - gap - 1.5, eyeY, 3, 1);
    ctx.fillRect(cx + gap - 1.5, eyeY, 3, 1);
  } else if (opts.eyeStyle === "wide") {
    ctx.beginPath();
    ctx.arc(cx - gap, eyeY, 2.6, 0, Math.PI * 2);
    ctx.arc(cx + gap, eyeY, 2.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (opts.eyeStyle === "sleepy") {
    ctx.fillRect(cx - gap - 1.5, eyeY, 3, 1.6);
    ctx.fillRect(cx + gap - 1.5, eyeY, 3, 1.6);
  } else {
    ctx.beginPath();
    ctx.arc(cx - gap, eyeY, 1.7, 0, Math.PI * 2);
    ctx.arc(cx + gap, eyeY, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The cast's signature procedural bodies. Everything is drawn on a
 * normalized 12×16 grid then scaled to (w,h), so the same code serves the
 * in-room body and the large dialog portrait. `t` animates idle life;
 * `helped` softens the pose (they've relaxed a little around you).
 */
export function drawNpcAvatar(
  ctx: CanvasRenderingContext2D,
  avatar: NpcAvatar,
  x: number, y: number, w: number, h: number,
  color: string, facing: number,
  opts: { t?: number; helped?: boolean } = {}
): void {
  const t = opts.t ?? performance.now() / 1000;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / 12, h / 16);
  if (facing < 0) { ctx.translate(12, 0); ctx.scale(-1, 1); }
  const dark = shade(color, -45);
  const lite = shade(color, 40);
  switch (avatar) {
    case "blocky": {
      // Square head over square body, chunky pixel shading. She reads as
      // imported from a much blockier game and proud of it.
      ctx.fillStyle = color;
      ctx.fillRect(2, 0, 8, 7);       // head
      ctx.fillStyle = lite;
      ctx.fillRect(2, 0, 8, 2);       // flat top light
      ctx.fillStyle = dark;
      ctx.fillRect(3.5, 3, 2, 2);     // square eyes
      ctx.fillRect(7, 3, 2, 2);
      ctx.fillStyle = color;
      ctx.fillRect(1, 8, 10, 6);      // body
      ctx.fillStyle = dark;
      ctx.fillRect(1, 8, 10, 1.4);    // shoulder shade
      ctx.fillRect(2, 14, 3, 2);      // legs
      ctx.fillRect(7, 14, 3, 2);
      // The satchel: she keeps everything. EVERYTHING.
      ctx.fillStyle = lite;
      ctx.fillRect(7.6, 9.5, 3.4, 3.4);
      ctx.fillStyle = dark;
      ctx.fillRect(7.6, 10.8, 3.4, 0.8);
      break;
    }
    case "scribble": {
      // A kid's crayon self-portrait that got up and walked off the page.
      // Jittering line-loops, never quite the same shape twice.
      const j = (n: number) => Math.sin(t * 7 + n * 3.7) * 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.beginPath(); // head scribble — overlapping wobbly circles
      for (let i = 0; i < 3; i++) {
        ctx.moveTo(9 + j(i), 4 + j(i + 5));
        ctx.arc(6, 4 + j(i), 3.4 + i * 0.5 + j(i + 1), 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.beginPath(); // body: a proud triangle-ish scrawl
      ctx.moveTo(6 + j(3), 8);
      ctx.lineTo(2.5 + j(4), 14.5);
      ctx.lineTo(9.5 + j(5), 14.5 + j(6));
      ctx.closePath();
      ctx.stroke();
      // Stick limbs mid-flail
      ctx.beginPath();
      ctx.moveTo(3.5, 10); ctx.lineTo(0.5, 8.5 + Math.sin(t * 9) * 1.2);
      ctx.moveTo(8.5, 10); ctx.lineTo(11.5, 8.5 - Math.sin(t * 9) * 1.2);
      ctx.moveTo(4.5, 14.5); ctx.lineTo(4, 16);
      ctx.moveTo(7.5, 14.5); ctx.lineTo(8, 16);
      ctx.stroke();
      // Dot eyes + big scribble grin
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(4.8, 3.6, 0.7, 0, Math.PI * 2);
      ctx.arc(7.2, 3.6, 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(6, 4.6, 1.8, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      break;
    }
    case "plush": {
      // Hand-stitched comfort object: round ears, belly patch, visible
      // mending. Soft everywhere a toy gets loved hardest.
      ctx.fillStyle = color;
      ctx.beginPath(); // ears
      ctx.arc(3.5, 2.5, 2, 0, Math.PI * 2);
      ctx.arc(8.5, 2.5, 2, 0, Math.PI * 2);
      ctx.fill();
      roundRect(ctx, 1.5, 1.5, 9, 8, 4); // head
      ctx.fill();
      roundRect(ctx, 2, 8.5, 8, 7, 3);   // body
      ctx.fill();
      ctx.fillStyle = lite; // muzzle + belly patch
      ctx.beginPath();
      ctx.ellipse(6, 6.8, 2.6, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(6, 12, 2.8, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = dark; // button eyes, stitched nose
      ctx.beginPath();
      ctx.arc(4.2, 5, 0.9, 0, Math.PI * 2);
      ctx.arc(7.8, 5, 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(5.4, 6.4, 1.2, 0.9);
      // The mend: an X of stitches on the belly patch — loved to bits,
      // sewn back together. (Same X every frame; scars don't wander.)
      ctx.strokeStyle = dark;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(4.9, 11.2); ctx.lineTo(7.1, 13);
      ctx.moveTo(7.1, 11.2); ctx.lineTo(4.9, 13);
      ctx.stroke();
      break;
    }
    case "trophy": {
      // A first-place trophy that decided it was a person. Cup head,
      // handle ears, pedestal feet, foam finger permanently attached.
      ctx.fillStyle = color;
      ctx.beginPath(); // cup bowl
      ctx.moveTo(2.5, 0.5); ctx.lineTo(9.5, 0.5);
      ctx.quadraticCurveTo(9, 5.5, 6, 6);
      ctx.quadraticCurveTo(3, 5.5, 2.5, 0.5);
      ctx.fill();
      ctx.strokeStyle = color; // handles
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(2, 2.2, 1.6, Math.PI * 0.5, Math.PI * 1.6);
      ctx.arc(10, 2.2, 1.6, Math.PI * 1.4, Math.PI * 0.5);
      ctx.stroke();
      ctx.fillStyle = dark; // engraved face — smug at rest
      ctx.fillRect(4.2, 2.2, 1.3, 1.3);
      ctx.fillRect(6.6, 2.2, 1.3, 1.3);
      ctx.fillRect(4.6, 4.3, 2.8, 0.8);
      ctx.fillStyle = lite; // gleam
      ctx.fillRect(3.3, 1, 1, 3.4);
      ctx.fillStyle = color;
      ctx.fillRect(5.2, 6, 1.6, 1.5); // stem
      ctx.fillRect(3, 7.5, 6, 6);     // plinth body
      ctx.fillStyle = dark;
      ctx.fillRect(3, 7.5, 6, 1);     // engraved plate line
      ctx.fillRect(2.2, 13.5, 7.6, 2.5); // pedestal feet
      // Foam finger: fused on. He's number one. Ask him.
      ctx.fillStyle = lite;
      roundRect(ctx, 8.8, 8.2, 3, 4.2, 1.2);
      ctx.fill();
      ctx.fillRect(9.6, 6.8, 1.4, 2.4); // the finger
      break;
    }
    case "windup": {
      // Dented tin wind-up toy: cylinder body, tape mend, turn-key in the
      // back. The key spins while she's thinking — which is always.
      ctx.fillStyle = color;
      roundRect(ctx, 2.5, 1, 7, 5.5, 2.5); // domed tin head
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(4, 3, 1.6, 1.6);   // fixed painted eyes
      ctx.fillRect(6.8, 3, 1.6, 1.6);
      ctx.fillStyle = lite;
      ctx.fillRect(4.4, 3.3, 0.6, 0.6); // determined glint
      ctx.fillRect(7.2, 3.3, 0.6, 0.6);
      ctx.fillStyle = color;
      ctx.fillRect(3, 7, 6.5, 7);       // tin can body
      ctx.fillStyle = dark;             // panel seams
      ctx.fillRect(3, 8.6, 6.5, 0.6);
      ctx.fillRect(3, 11.6, 6.5, 0.6);
      // The tape: one silver band where the dent was. It held.
      ctx.fillStyle = "#c9cdd6";
      ctx.save();
      ctx.translate(6.2, 10.4);
      ctx.rotate(-0.35);
      ctx.fillRect(-4, -0.9, 8, 1.8);
      ctx.restore();
      ctx.fillStyle = dark;
      ctx.fillRect(3.2, 14, 2.4, 2);  // stubby feet
      ctx.fillRect(6.8, 14, 2.4, 2);
      // Wind-up key (on her back, so the away side), turning steadily
      const ka = opts.helped ? t * 1.2 : t * 3.2; // she unclenches, a little
      ctx.save();
      ctx.translate(1.6, 9.5);
      ctx.rotate(ka);
      ctx.strokeStyle = lite;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(0, -2.6); ctx.lineTo(0, 2.6);
      ctx.moveTo(-1.8, -2.6); ctx.lineTo(1.8, -2.6);
      ctx.moveTo(-1.8, 2.6); ctx.lineTo(1.8, 2.6);
      ctx.stroke();
      ctx.restore();
      break;
    }
  }
  ctx.restore();
}

/**
 * The Warden's portrait: a worn mascot-costume head — molded permasmile,
 * merit-badge sash, and a frayed seam where the stitching shows. The REAL
 * feeling lives in the eyes; the smile never moves. That gap is the whole
 * character. Custom per-emotion overrides (data-URI) win when present.
 */
export function drawWardenPortrait(
  ctx: CanvasRenderingContext2D,
  emotion: WardenEmotion,
  color: string,
  x: number, y: number, size: number,
  override?: string
): void {
  if (override && drawSprite(ctx, { sprite: override }, x, y, size, size)) return;
  const s = size / 32; // designed on a 32px grid
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // Frame
  ctx.fillStyle = "#1a1020";
  roundRect(ctx, 0, 0, 32, 32, 5);
  ctx.fill();
  ctx.strokeStyle = shade(color, -60);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const t = performance.now() / 1000;
  const fuzz = shade(color, -25);
  const felt = color;
  // Costume head: over-round, slightly deflated on one side.
  ctx.fillStyle = fuzz;
  ctx.beginPath();
  ctx.ellipse(16, 16.5, 12.5, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = felt;
  ctx.beginPath();
  ctx.ellipse(15.7, 16, 11.6, 11.2, -0.06, 0, Math.PI * 2);
  ctx.fill();
  // Round mascot ears, one sitting a little wrong.
  ctx.fillStyle = fuzz;
  ctx.beginPath();
  ctx.arc(6.5, 6.5, 3.4, 0, Math.PI * 2);
  ctx.arc(25.5, 7.4, 3.4, 0, Math.PI * 2); // the crooked one
  ctx.fill();
  // THE SEAM — stitched repair line up the right temple, thread showing.
  ctx.strokeStyle = shade(color, -70);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(23.5, 26);
  ctx.quadraticCurveTo(26.5, 18, 24.5, 9.5);
  ctx.stroke();
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const sy = 24 - i * 3.4;
    const sx = 24.6 + Math.sin(i * 1.7) * 0.6;
    ctx.moveTo(sx - 1.6, sy - 1);
    ctx.lineTo(sx + 1.6, sy + 1);
  }
  ctx.stroke();
  // Muzzle patch (lighter felt, glued a hair off-center).
  ctx.fillStyle = shade(color, 35);
  ctx.beginPath();
  ctx.ellipse(15.4, 23, 7.2, 5, 0.04, 0, Math.PI * 2);
  ctx.fill();
  // The molded permasmile: NEVER changes with emotion. It can't.
  ctx.strokeStyle = "#2a1e30";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(10.5, 23);
  ctx.quadraticCurveTo(15.5, 27.5, 20.5, 23);
  ctx.stroke();
  // A tiny chip in the smile paint, bottom-left. Nobody's repainted it.
  ctx.strokeStyle = shade(color, 35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12.2, 24.6); ctx.lineTo(13.2, 24.9);
  ctx.stroke();
  // EYES — the only honest part. Plastic domes with drifting pupils;
  // emotion lives entirely in lids, pupils, and brow-creases in the felt.
  const wide = emotion === "shocked" ? 1.4 : emotion === "gleeful" ? 1.15 : 1;
  const eyeY = 14;
  ctx.fillStyle = "#f2ecdd"; // aged plastic, not white anymore
  ctx.beginPath();
  ctx.ellipse(11, eyeY, 3.4, 3.9 * wide, 0, 0, Math.PI * 2);
  ctx.ellipse(20.5, eyeY, 3.4, 3.9 * wide, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pupils (drift, hunting; bored barely bothers)
  ctx.fillStyle = "#0d0b14";
  const drift = emotion === "bored" ? 0.7 : 2;
  const px = Math.sin(t * 0.9) * drift;
  const pr = emotion === "shocked" ? 1.1 : 1.7;
  ctx.beginPath();
  ctx.arc(11 + px, eyeY + 0.4, pr, 0, Math.PI * 2);
  ctx.arc(20.5 + px, eyeY + 0.4, pr, 0, Math.PI * 2);
  ctx.fill();
  // Lids: felt eyelids sag over the plastic (how "done" he is today).
  const lid =
    emotion === "bored" ? 0.62 :
    emotion === "smug" ? 0.45 :
    emotion === "proud" ? 0.3 :
    emotion === "annoyed" ? 0.5 : 0;
  if (lid > 0) {
    ctx.fillStyle = felt;
    ctx.beginPath();
    ctx.ellipse(11, eyeY - 3.9 * wide + 3.9 * wide * lid, 3.6, 3.9 * wide * lid, 0, Math.PI, 0);
    ctx.ellipse(20.5, eyeY - 3.9 * wide + 3.9 * wide * lid, 3.6, 3.9 * wide * lid, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = fuzz;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(7.6, eyeY - 3.9 * wide + 7.8 * wide * lid * 0.5);
    ctx.lineTo(14.4, eyeY - 3.9 * wide + 7.8 * wide * lid * 0.5);
    ctx.moveTo(17.1, eyeY - 3.9 * wide + 7.8 * wide * lid * 0.5);
    ctx.lineTo(23.9, eyeY - 3.9 * wide + 7.8 * wide * lid * 0.5);
    ctx.stroke();
  }
  // Brow creases pressed into the felt (fabric remembers the feeling).
  ctx.strokeStyle = shade(color, -55);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (emotion === "annoyed") {
    ctx.moveTo(7.5, 8); ctx.lineTo(14, 10);
    ctx.moveTo(24, 8.6); ctx.lineTo(17.5, 10.3);
  } else if (emotion === "shocked") {
    ctx.moveTo(7.5, 8.5); ctx.quadraticCurveTo(11, 6, 14.5, 8.2);
    ctx.moveTo(17, 8.2); ctx.quadraticCurveTo(20.5, 6, 24, 8.5);
  } else if (emotion === "gleeful") {
    ctx.moveTo(8, 8.8); ctx.quadraticCurveTo(11, 7, 14, 8.6);
    ctx.moveTo(17.5, 8.6); ctx.quadraticCurveTo(20.5, 7, 23.5, 8.8);
  } else if (emotion === "bored") {
    ctx.moveTo(8, 9.6); ctx.lineTo(14, 9.6);
    ctx.moveTo(17.5, 9.6); ctx.lineTo(23.5, 9.6);
  } // smug/proud: smooth felt, no crease — he thinks it's going well
  ctx.stroke();
  // Merit-badge sash, lower-left: gold star stickers, one peeling.
  ctx.strokeStyle = "#b8355e";
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(1.5, 25);
  ctx.lineTo(10.5, 31.5);
  ctx.stroke();
  ctx.fillStyle = "#ffd166";
  const star = (cx: number, cy: number, r: number, rot = 0) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + (i * 4 * Math.PI) / 5 - Math.PI / 2;
      const sxp = cx + Math.cos(a) * r;
      const syp = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(sxp, syp); else ctx.lineTo(sxp, syp);
    }
    ctx.closePath();
    ctx.fill();
  };
  star(3.6, 26.2, 1.6);
  star(6.8, 28.6, 1.6);
  star(9.6, 30.8, 1.6, 0.5); // the peeling one, mid-fall
  ctx.restore();
}

/** Draw an item icon centered at (cx, cy). Shape comes from item data. */
export function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  item: ItemDef,
  cx: number, cy: number,
  scale = 1
): void {
  if (drawSprite(ctx, item, cx - 8 * scale, cy - 8 * scale, 16 * scale, 16 * scale)) return;
  const c = item.color;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  switch (item.shape) {
    case "shard":
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(-4, 3); ctx.lineTo(0, -5); ctx.lineTo(4, 1); ctx.lineTo(1, 5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(c, 30);
      ctx.fillRect(-1, -3, 2, 4);
      break;
    case "plank":
      ctx.fillStyle = c;
      ctx.fillRect(-6, -2, 12, 4);
      ctx.fillStyle = shade(c, -30);
      ctx.fillRect(-4, -2, 1, 4); ctx.fillRect(2, -2, 1, 4);
      break;
    case "ring":
      ctx.strokeStyle = c;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.stroke();
      break;
    case "cloth":
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(-5, -4); ctx.quadraticCurveTo(0, -1, 5, -4);
      ctx.lineTo(4, 4); ctx.quadraticCurveTo(0, 2, -4, 4);
      ctx.closePath(); ctx.fill();
      break;
    case "ball":
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(c, 40);
      ctx.beginPath(); ctx.arc(-1.5, -1.5, 1.5, 0, Math.PI * 2); ctx.fill();
      break;
    case "mushroom":
      ctx.fillStyle = shade(c, -50);
      ctx.fillRect(-1.5, 0, 3, 5);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(0, 0, 5, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(c, 50);
      ctx.beginPath(); ctx.arc(-2, -2, 1.2, 0, Math.PI * 2); ctx.fill();
      break;
    case "cog": {
      ctx.fillStyle = c;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.fillRect(Math.cos(a) * 4 - 1.2, Math.sin(a) * 4 - 1.2, 2.4, 2.4);
      }
      ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(c, -60);
      ctx.beginPath(); ctx.arc(0, 0, 1.4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "spring":
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        ctx.moveTo(-3, -4 + i * 2.6);
        ctx.lineTo(3, -3 + i * 2.6);
      }
      ctx.stroke();
      break;
    case "coil": {
      // Raw, unsprung wire — stacked rings, not the "boing" zigzag of an
      // installed spring. Deliberately reads as inert material, not a tool.
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.3;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(0, -4 + i * 2.6, 3.2, 1.3, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = shade(c, -35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-3.2, -4); ctx.lineTo(-3.2, 5.2);
      ctx.moveTo(3.2, -4); ctx.lineTo(3.2, 5.2);
      ctx.stroke();
      break;
    }
    case "tool":
      ctx.fillStyle = shade(c, -40);
      ctx.fillRect(-1, -1, 2.4, 7);
      ctx.fillStyle = c;
      ctx.fillRect(-4.5, -5, 9, 4);
      break;
    case "bottle":
      ctx.fillStyle = c;
      roundRect(ctx, -3, -3, 6, 8, 2); ctx.fill();
      ctx.fillStyle = shade(c, -50);
      ctx.fillRect(-1.5, -6, 3, 3);
      break;
    case "torch": {
      // Handle, always
      ctx.fillStyle = "#8a6d47";
      ctx.fillRect(-1.2, -2, 2.4, 8);
      if (item.element === "fire") {
        // Lit: a flame licking up off the tip
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(-3, -2);
        ctx.quadraticCurveTo(0, -9, 3, -2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = shade(c, 45);
        ctx.beginPath();
        ctx.arc(0, -3.5, 1.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Unlit: a wrapped cloth bundle, no flame — visually distinct from the hammer
        ctx.fillStyle = shade(c, -15);
        ctx.beginPath();
        ctx.ellipse(0, -3.5, 3.4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = shade(c, -45);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-2.8, -4.5); ctx.lineTo(2.8, -2.5);
        ctx.moveTo(-2.8, -2.5); ctx.lineTo(2.8, -4.5);
        ctx.stroke();
      }
      break;
    }
    case "bucket": {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(-5, -3);
      ctx.lineTo(-3.4, 5);
      ctx.lineTo(3.4, 5);
      ctx.lineTo(5, -3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = shade(c, 30);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, -3, 4.6, Math.PI, 0);
      ctx.stroke();
      break;
    }
    case "rod": {
      ctx.strokeStyle = shade(c, -40);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-4, 5);
      ctx.lineTo(2, -2);
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(2, -2);
      ctx.lineTo(0.5, -4);
      ctx.lineTo(4, -4.5);
      ctx.lineTo(2.5, -7);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}
