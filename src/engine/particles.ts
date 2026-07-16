import { randRange } from "./math";

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

export class Particles {
  private pool: Particle[] = [];
  enabled = true;

  burst(opts: {
    x: number; y: number; count: number; color: string;
    speed?: number; spread?: number; upBias?: number;
    life?: number; size?: number; gravity?: number;
  }): void {
    if (!this.enabled) return;
    const {
      x, y, count, color,
      speed = 90, upBias = 0, life = 0.5, size = 3, gravity = 300,
    } = opts;
    for (let i = 0; i < count; i++) {
      const ang = randRange(0, Math.PI * 2);
      const spd = randRange(speed * 0.3, speed);
      this.pool.push({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - upBias,
        life: randRange(life * 0.6, life),
        maxLife: life,
        size: randRange(size * 0.6, size * 1.3),
        color,
        gravity,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.pool.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pool) {
      const t = p.life / p.maxLife;
      ctx.globalAlpha = Math.min(1, t * 1.6);
      ctx.fillStyle = p.color;
      const s = p.size * (0.5 + t * 0.5);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.pool.length = 0;
  }
}
