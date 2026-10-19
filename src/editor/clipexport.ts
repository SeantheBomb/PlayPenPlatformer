// Replay -> video clip export. Records what the replay plays, re-rendered at
// 1920x1080 through Game.captureFrame (no touch UI, banners and HUD kept), to
// a WebM file. Trailer and short-form footage comes from HUMAN-played runs
// this way; vertical reframing for Shorts/TikTok is a MediaWeaver job.
//
// Real-time capture: MediaRecorder timestamps frames by wall clock, so the
// replay is forced to 1x while recording.
import type { Game } from "../game/game";
import { el, toast } from "./forms";

const W = 1920;
const H = 1080;

function pickMime(): string | null {
  for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

export class ClipRecorder {
  private canvas = el("canvas", { width: W, height: H }) as HTMLCanvasElement;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.rec !== null;
  }

  start(): boolean {
    const mime = pickMime();
    if (!mime) {
      toast("This browser can't record video (no WebM MediaRecorder).", false);
      return false;
    }
    this.chunks = [];
    const stream = this.canvas.captureStream(60);
    this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
    return true;
  }

  /** Call once per displayed replay frame. */
  frame(game: Game): void {
    if (this.rec) game.captureFrame(W, H, this.canvas);
  }

  /** Stop and download the clip. */
  stop(filename: string): void {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    rec.onstop = () => {
      const blob = new Blob(this.chunks, { type: rec.mimeType });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast(`Saved ${filename} (${(blob.size / 1e6).toFixed(1)} MB)`);
    };
    rec.stop();
  }
}

/** "⏺ record clip" toggle for a replay modal. `driver()` returns the live
 *  driver (it can be swapped by queue advance); `setSpeed` forces 1x. */
export function clipButton(
  driver: () => { game: Game; speed: number; step: number } | null,
  name: () => string,
  setSpeed: (s: number) => void,
): { button: HTMLButtonElement; onFrame: () => void; stopIfRecording: () => void } {
  const rec = new ClipRecorder();
  const button = el("button", { className: "pp-btn", title: "Record the replay as a 1080p WebM" }, "⏺ record clip") as HTMLButtonElement;
  let startStep = 0;
  const stop = () => {
    const d = driver();
    rec.stop(`${name()}-${startStep}-${d?.step ?? 0}.webm`);
    button.textContent = "⏺ record clip";
    button.style.color = "";
  };
  button.onclick = () => {
    const d = driver();
    if (!d) return;
    if (rec.recording) { stop(); return; }
    setSpeed(1);
    if (!rec.start()) return;
    startStep = d.step;
    button.textContent = "⏹ stop + save";
    button.style.color = "#ff5470";
  };
  return {
    button,
    onFrame: () => { const d = driver(); if (d) rec.frame(d.game); },
    stopIfRecording: () => { if (rec.recording) stop(); },
  };
}
