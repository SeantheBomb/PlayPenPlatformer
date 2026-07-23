// Seedable RNG (mulberry32) for gameplay-visible randomness — currently the
// taunt system (chance rolls + line picks). A recorded session stores its seed
// so a replay rolls the identical sequence. Cosmetic randomness (particles,
// blinks, screen shake, craft sparks, audio noise) stays on Math.random — it
// never feeds back into game state, so divergence there is imperceptible and
// recording it would be waste.

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  reseed(seed: number): void {
    this.s = seed >>> 0;
  }

  /** [0, 1) — drop-in for Math.random(). */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  pick<T>(arr: T[]): T {
    return arr[(this.next() * arr.length) | 0];
  }
}

/** A fresh random seed for a new live session (recorded into its metadata). */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
