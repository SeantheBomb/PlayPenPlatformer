export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const randRange = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export const randPick = <T>(arr: T[]): T => arr[(Math.random() * arr.length) | 0];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rectsOverlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const dist = (x1: number, y1: number, x2: number, y2: number) =>
  Math.hypot(x2 - x1, y2 - y1);
