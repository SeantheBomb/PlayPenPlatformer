// Looping room music. Unlike Sfx (pure WebAudio synth, zero assets), this
// plays real uploaded MP3 clips (editor's "music" tab) via HTMLAudioElement.
// Deliberately not part of the replay/determinism system — like sfx.play(),
// it's a cosmetic side effect, not simulation state.
export class MusicPlayer {
  volume = 0.4;
  muted = false;
  private el: HTMLAudioElement | null = null;
  private currentTrackId: string | null = null;

  /** Switch to (and loop) a track by id; a no-op if it's already playing.
   *  Pass undefined/null to stop (e.g. no track resolved for the room). */
  play(trackId: string | undefined | null, dataUrl: string | undefined): void {
    if (!trackId || !dataUrl) {
      this.stop();
      return;
    }
    if (trackId === this.currentTrackId && this.el) {
      this.applyVolume();
      return;
    }
    this.stop();
    const el = new Audio(dataUrl);
    el.loop = true;
    el.volume = this.muted ? 0 : this.volume;
    // Autoplay can be blocked before the first user gesture — the title
    // screen's "press enter/click" click satisfies that before any room
    // ever loads, but swallow a rejection defensively either way.
    el.play().catch(() => {});
    this.el = el;
    this.currentTrackId = trackId;
  }

  stop(): void {
    if (this.el) {
      this.el.pause();
      this.el.src = "";
    }
    this.el = null;
    this.currentTrackId = null;
  }

  pause(): void {
    this.el?.pause();
  }

  resume(): void {
    this.el?.play().catch(() => {});
  }

  applyVolume(): void {
    if (this.el) this.el.volume = this.muted ? 0 : this.volume;
  }
}

export const music = new MusicPlayer();
