// Canvas drawing helpers shared by the game and the editor's room preview.
// All art is procedural primitives — no image assets.
import type { ItemDef, TileDef } from "../data/types";
import { TILE, TileMap } from "./tilemap";

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
  animT = 0
): void {
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
      if (def) drawTile(ctx, def, tx * TILE, ty * TILE, animT);
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
  opts: { squashX?: number; squashY?: number; eyeStyle?: "dot" | "wide" | "sleepy"; blink?: boolean } = {}
): void {
  const sx = opts.squashX ?? 1;
  const sy = opts.squashY ?? 1;
  const dw = w * sx;
  const dh = h * sy;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh); // keep feet planted when squashing
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

/** Draw an item icon centered at (cx, cy). Shape comes from item data. */
export function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  item: ItemDef,
  cx: number, cy: number,
  scale = 1
): void {
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
  }
  ctx.restore();
}
