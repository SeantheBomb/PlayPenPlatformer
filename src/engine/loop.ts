// Fixed-timestep game loop (60Hz updates, rAF rendering).
const STEP = 1 / 60;
const MAX_ACCUM = 0.25; // avoid spiral of death after tab-switch

export class Loop {
  private acc = 0;
  private last = 0;
  private running = false;
  private rafId = 0;
  private fallbackId = 0;
  private lastFrameAt = 0;
  hitStopUntil = 0; // performance.now() timestamp; updates pause, renders continue

  constructor(
    private update: (dt: number) => void,
    private render: () => void
  ) {}

  private frame(now: number): void {
    this.lastFrameAt = now;
    this.acc += Math.min(MAX_ACCUM, (now - this.last) / 1000);
    this.last = now;
    if (now >= this.hitStopUntil) {
      while (this.acc >= STEP) {
        this.update(STEP);
        this.acc -= STEP;
      }
    } else {
      this.acc = 0;
    }
    this.render();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const rafTick = (now: number) => {
      if (!this.running) return;
      this.frame(now);
      this.rafId = requestAnimationFrame(rafTick);
    };
    this.rafId = requestAnimationFrame(rafTick);
    // Hidden tabs suspend rAF; keep simulating so the game (and automated
    // playtests) survive backgrounding. Renders too — nobody's looking anyway.
    this.fallbackId = window.setInterval(() => {
      if (!this.running) return;
      const now = performance.now();
      if (now - this.lastFrameAt > 50) this.frame(now);
    }, 16);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    clearInterval(this.fallbackId);
  }

  hitStop(ms: number): void {
    this.hitStopUntil = Math.max(this.hitStopUntil, performance.now() + ms);
  }
}
