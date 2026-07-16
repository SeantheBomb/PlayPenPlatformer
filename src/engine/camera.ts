import { clamp, lerp, randRange } from "./math";

export class Camera {
  x = 0;
  y = 0;
  lerpFactor = 0.14;
  lookaheadX = 28;
  lookaheadY = 10;
  shakeEnabled = true;
  shakeIntensity = 1;
  private shakeTime = 0;
  private shakeMag = 0;
  offsetX = 0;
  offsetY = 0;

  snapTo(tx: number, ty: number, viewW: number, viewH: number, worldW: number, worldH: number) {
    this.x = clamp(tx - viewW / 2, 0, Math.max(0, worldW - viewW));
    this.y = clamp(ty - viewH / 2, 0, Math.max(0, worldH - viewH));
  }

  follow(
    tx: number, ty: number, facing: number,
    viewW: number, viewH: number, worldW: number, worldH: number
  ) {
    const targetX = clamp(
      tx + facing * this.lookaheadX - viewW / 2, 0, Math.max(0, worldW - viewW)
    );
    const targetY = clamp(
      ty + this.lookaheadY - viewH / 2, 0, Math.max(0, worldH - viewH)
    );
    this.x = lerp(this.x, targetX, this.lerpFactor);
    this.y = lerp(this.y, targetY, this.lerpFactor);
  }

  shake(mag: number, dur = 0.25) {
    if (!this.shakeEnabled) return;
    this.shakeMag = Math.max(this.shakeMag, mag * this.shakeIntensity);
    this.shakeTime = Math.max(this.shakeTime, dur);
  }

  update(dt: number) {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const m = this.shakeMag * Math.max(0, this.shakeTime / 0.25);
      this.offsetX = randRange(-m, m);
      this.offsetY = randRange(-m, m);
    } else {
      this.offsetX = 0;
      this.offsetY = 0;
      this.shakeMag = 0;
    }
  }
}
