// Canvas drawing helpers shared by the game and the editor's room preview.
// All art is procedural primitives — no image assets.
import type { ItemDef, SpriteFields, TileDef, WardenEmotion } from "../data/types";
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
  } = {}
): void {
  const sx = opts.squashX ?? 1;
  const sy = opts.squashY ?? 1;
  const dw = w * sx;
  const dh = h * sy;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh); // keep feet planted when squashing
  if (opts.sprite && drawSprite(ctx, opts.sprite, dx, dy, dw, dh, facing)) return;
  ctx.fillStyle = color;
  roundRect(ctx, dx, dy, dw, dh, Math.min(5, dw / 3));
  ctx.fill();
  ctx.fillStyle = shade(color, 26);
  roundRect(ctx, dx, dy, dw, Math.max(2, dh * 0.22), Math.min(5, dw / 3));
  ctx.fill();
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
 * The Warden's portrait: a single lidded eye with emotion-specific brow,
 * lid, and mouth. Custom per-emotion overrides (data-URI) win when present.
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
  // The eye
  const eyeY = 15;
  const wide = emotion === "shocked" ? 1.35 : emotion === "gleeful" ? 1.15 : 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(16, eyeY, 10, 6.5 * wide, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pupil (drifts, hunting)
  ctx.fillStyle = "#0d0b14";
  const px = 16 + Math.sin(t * 0.9) * (emotion === "bored" ? 1 : 3);
  ctx.beginPath();
  ctx.arc(px, eyeY, emotion === "shocked" ? 2 : 3, 0, Math.PI * 2);
  ctx.fill();
  // Lid (how much the eye is closed)
  const lid =
    emotion === "bored" ? 0.55 :
    emotion === "smug" ? 0.4 :
    emotion === "proud" ? 0.85 :
    emotion === "annoyed" ? 0.3 : 0;
  if (lid > 0) {
    ctx.fillStyle = "#1a1020";
    ctx.fillRect(5, eyeY - 8, 22, 8 * lid + (8 - 8 * wide));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6, eyeY - 8 + 8 * lid);
    ctx.lineTo(26, eyeY - 8 + 8 * lid);
    ctx.stroke();
  }
  // Brow
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (emotion === "annoyed") {
    ctx.moveTo(7, 4); ctx.lineTo(25, 8);
  } else if (emotion === "shocked") {
    ctx.moveTo(8, 3); ctx.quadraticCurveTo(16, 0, 24, 3);
  } else if (emotion === "smug" || emotion === "proud") {
    ctx.moveTo(8, 6); ctx.quadraticCurveTo(16, 3.5, 24, 6);
  } else if (emotion === "bored") {
    ctx.moveTo(8, 7); ctx.lineTo(24, 7);
  } else { // gleeful
    ctx.moveTo(8, 4); ctx.quadraticCurveTo(16, 1, 24, 4);
  }
  ctx.stroke();
  // Mouth
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  if (emotion === "gleeful") {
    ctx.moveTo(10, 25); ctx.quadraticCurveTo(16, 30, 22, 25);
  } else if (emotion === "smug") {
    ctx.moveTo(12, 26); ctx.quadraticCurveTo(18, 28, 22, 25);
  } else if (emotion === "proud") {
    ctx.moveTo(11, 26); ctx.quadraticCurveTo(16, 29, 21, 26);
  } else if (emotion === "annoyed") {
    ctx.moveTo(11, 27); ctx.lineTo(21, 27);
  } else if (emotion === "shocked") {
    ctx.arc(16, 26, 3, 0, Math.PI * 2);
  } else { // bored
    ctx.moveTo(12, 27); ctx.lineTo(20, 27.8);
  }
  ctx.stroke();
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
