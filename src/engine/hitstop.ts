// Deterministic, step-counted freeze-frame timer for hit-stop "juice".
//
// The old implementation lived directly on Loop and armed a performance.now()
// deadline: Loop.frame() would skip calling update() (and stepCount, tucked
// inside update(), would freeze with it) for any real-time frame before that
// deadline. That's fine for live play, but the replay driver calls
// Game.stepOnce() -> update() directly, bypassing Loop and its wall-clock gate
// entirely -- so a hit-stop that happened live had no equivalent pause during
// replay, and any input transitions recorded (tagged by the now-frozen
// stepCount) during that live freeze window replayed at the wrong step index.
// The visible symptom: a recorded session's replay drifting away from the
// original run's final position, worse the more hit-stops it hit.
//
// HitStop instead expresses the freeze as a whole number of *steps*, ticked
// once per simulation step by the same update() call on both the live and
// replay paths -- so the same trigger() at the same step produces the same
// skip on both paths, with zero wall-clock involved.
export class HitStop {
  private stepsLeft = 0;

  /** Arm (or extend) the freeze from a real-ms "juice" duration. Never
   *  shortens an in-progress freeze. */
  trigger(ms: number, stepMs = 1000 / 60): void {
    this.stepsLeft = Math.max(this.stepsLeft, Math.round(ms / stepMs));
  }

  /** Call once per simulation step. Returns true if this step is a frozen
   *  beat the caller should skip (after still counting it as a step). */
  tick(): boolean {
    if (this.stepsLeft <= 0) return false;
    this.stepsLeft--;
    return true;
  }
}
