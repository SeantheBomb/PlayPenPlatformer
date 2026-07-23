// Simulated game clock — the foundation of deterministic session replay.
//
// Gameplay code must never read wall-clock time (performance.now()) for
// anything that affects state: a replayed session runs the same fixed-timestep
// updates at a different wall time (or faster, when seeking), so every timer
// keyed to real time would diverge. Instead, gameplay reads simNow(), which the
// owning Game advances by exactly one fixed step per update and re-asserts at
// the top of update() and render() — so two Game instances (the live game and
// a replay player) can coexist, each seeing its own clock while its own code
// runs. Wall clock remains correct for pure pacing/juice (loop hit-stop, touch
// tap timing, craft FX) and for anything user-facing outside the sim.
//
// Side benefit: sim time freezes while the game is paused (editor open), so
// invulnerability windows, stuns, and Warden timers no longer silently expire
// during a pause.

let current = 0;

/** Milliseconds of simulated time for the Game whose code is currently running. */
export function simNow(): number {
  return current;
}

/** Called by a Game at the top of update()/render() and when advancing. */
export function setSimTime(ms: number): void {
  current = ms;
}
