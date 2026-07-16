// Zero-asset SFX: every sound is synthesized with WebAudio primitives.
type SfxName =
  | "jump" | "land" | "pickup" | "hurt" | "death" | "craft" | "craftFail"
  | "discover" | "note" | "door" | "locked" | "unlock" | "checkpoint"
  | "bounce" | "break" | "stun" | "trap" | "hide" | "taunt" | "npc" | "win"
  | "swing"
  | "uiMove" | "uiSelect";

export class Sfx {
  private ctx: AudioContext | null = null;
  volume = 0.5;
  muted = false;

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = "square",
    vol = 0.18,
    slideTo?: number,
    delay = 0
  ) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    }
    gain.gain.setValueAtTime(vol * this.volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol = 0.12, delay = 0) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol * this.volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(gain).connect(ctx.destination);
    src.start(t0);
  }

  play(name: SfxName): void {
    switch (name) {
      case "jump": this.tone(280, 0.12, "square", 0.14, 520); break;
      case "land": this.noise(0.06, 0.1); this.tone(120, 0.06, "sine", 0.12, 70); break;
      case "pickup": this.tone(660, 0.07, "square", 0.12); this.tone(990, 0.09, "square", 0.12, undefined, 0.06); break;
      case "hurt": this.tone(220, 0.15, "sawtooth", 0.2, 110); this.noise(0.1, 0.08); break;
      case "death": this.tone(330, 0.5, "sawtooth", 0.22, 55); this.noise(0.3, 0.1, 0.05); break;
      case "craft": this.tone(440, 0.08, "square", 0.14); this.tone(550, 0.08, "square", 0.14, undefined, 0.07); this.tone(660, 0.14, "square", 0.14, undefined, 0.14); break;
      case "craftFail": this.tone(200, 0.2, "sawtooth", 0.14, 140); break;
      case "discover": this.tone(523, 0.1, "triangle", 0.2); this.tone(659, 0.1, "triangle", 0.2, undefined, 0.09); this.tone(784, 0.1, "triangle", 0.2, undefined, 0.18); this.tone(1047, 0.24, "triangle", 0.2, undefined, 0.27); break;
      case "note": this.tone(700, 0.1, "sine", 0.14, 880); break;
      case "door": this.tone(180, 0.2, "sine", 0.16, 90); this.noise(0.12, 0.05); break;
      case "locked": this.tone(140, 0.1, "square", 0.16); this.tone(120, 0.14, "square", 0.16, undefined, 0.11); break;
      case "unlock": this.tone(500, 0.06, "square", 0.14); this.tone(750, 0.14, "square", 0.16, undefined, 0.08); break;
      case "checkpoint": this.tone(587, 0.1, "triangle", 0.18); this.tone(880, 0.18, "triangle", 0.18, undefined, 0.1); break;
      case "bounce": this.tone(200, 0.16, "square", 0.16, 700); break;
      case "break": this.noise(0.18, 0.18); this.tone(160, 0.12, "square", 0.12, 60); break;
      case "swing": this.noise(0.07, 0.06); this.tone(520, 0.08, "sine", 0.07, 240); break;
      case "stun": this.tone(880, 0.3, "sine", 0.14, 220); this.noise(0.25, 0.06); break;
      case "trap": this.tone(300, 0.12, "square", 0.14, 150); break;
      case "hide": this.tone(240, 0.12, "sine", 0.12, 160); break;
      case "taunt": this.tone(392, 0.07, "square", 0.08); this.tone(311, 0.09, "square", 0.08, undefined, 0.08); break;
      case "npc": this.tone(520, 0.07, "sine", 0.12); this.tone(640, 0.08, "sine", 0.12, undefined, 0.08); break;
      case "win": [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.2, undefined, i * 0.12)); break;
      case "uiMove": this.tone(500, 0.04, "square", 0.06); break;
      case "uiSelect": this.tone(700, 0.07, "square", 0.1); break;
    }
  }
}

export const sfx = new Sfx();
