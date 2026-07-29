// Regression test for the session-replay drift bug (2026-07-29): hit-stop
// used to arm a performance.now() deadline on Loop, so a hard hit's freeze
// was wall-clock-bound. Live play's stepCount (which every recorded input
// event is tagged by) froze along with it, but the replay driver calls
// Game.stepOnce() directly and never passed through that gate — so replaying
// a session with hit-stops in it drifted from the original run. HitStop now
// expresses the freeze as a fixed number of simulation steps instead, ticked
// identically by update() on both the live and replay paths. See
// src/engine/hitstop.ts for the full writeup.
import { describe, expect, it } from "vitest";
import { HitStop } from "../src/engine/hitstop";

describe("HitStop", () => {
  it("rounds a real-ms juice duration to a whole number of steps", () => {
    const h = new HitStop();
    h.trigger(70); // 70 / 16.667 = 4.2 -> 4 steps
    let skipped = 0;
    for (let i = 0; i < 10; i++) if (h.tick()) skipped++;
    expect(skipped).toBe(4);
  });

  it("skips the exact same number of steps no matter how ticking is paced", () => {
    // The whole point of the fix: nothing here depends on real elapsed time,
    // so a "fast" replay-style tick loop and a "slow" live-style one (with
    // real delays between ticks, simulated here by just interleaving other
    // work) produce identical results.
    const fast = new HitStop();
    fast.trigger(70);
    const fastResults: boolean[] = [];
    for (let i = 0; i < 8; i++) fastResults.push(fast.tick());

    const slow = new HitStop();
    slow.trigger(70);
    const slowResults: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      // Busy-wait a little real time between ticks — must have zero effect.
      const until = Date.now() + 2;
      while (Date.now() < until) { /* spin */ }
      slowResults.push(slow.tick());
    }

    expect(slowResults).toEqual(fastResults);
  });

  it("extends an in-progress freeze but never shortens it", () => {
    const h = new HitStop();
    h.trigger(70); // 4 steps
    h.tick(); // 3 left
    h.trigger(16); // ~1 step, shorter — must not shrink the freeze already armed
    let skipped = 1;
    while (h.tick()) skipped++;
    expect(skipped).toBe(4);
  });

  it("does nothing once the freeze has fully elapsed", () => {
    const h = new HitStop();
    h.trigger(16);
    expect(h.tick()).toBe(true);
    expect(h.tick()).toBe(false);
    expect(h.tick()).toBe(false);
  });
});
