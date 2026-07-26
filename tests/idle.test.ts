// Session-replay idle detection (Sean, 2026-07-26): "detect idle periods
// when the player is giving no input" for the sessions timeline + skip
// button. Run `npm test` before touching computeIdlePeriods in replay.ts.
import { describe, expect, it } from "vitest";
import { computeIdlePeriods } from "../src/game/replay";
import type { SessionEvent } from "../src/game/recorder";

describe("computeIdlePeriods", () => {
  it("flags a long gap with no held key as idle", () => {
    const events: SessionEvent[] = [
      { f: 0, t: "k", c: "KeyD", d: 1 },
      { f: 10, t: "k", c: "KeyD", d: 0 },
      // 300-step silent gap here — well past the 180-step threshold.
      { f: 310, t: "k", c: "KeyA", d: 1 },
      { f: 320, t: "k", c: "KeyA", d: 0 },
    ];
    const periods = computeIdlePeriods(events, 320);
    expect(periods).toEqual([{ from: 10, to: 310 }]);
  });

  it("does not flag a gap while a key is still held down", () => {
    const events: SessionEvent[] = [
      { f: 0, t: "k", c: "KeyD", d: 1 },
      // Held the whole way to the end — no idle period even though there's
      // no further event; the player is actively moving.
    ];
    const periods = computeIdlePeriods(events, 400);
    expect(periods).toEqual([]);
  });

  it("a lone tap breaks a long gap into two shorter (non-idle) ones", () => {
    const events: SessionEvent[] = [
      { f: 0, t: "tap", x: 10, y: 10 },
      { f: 100, t: "tap", x: 20, y: 20 },
      { f: 200, t: "tap", x: 30, y: 30 },
    ];
    // Each gap is only 100 steps — under the 180-step threshold.
    expect(computeIdlePeriods(events, 200)).toEqual([]);
  });

  it("includes a trailing idle stretch to the end of the recording", () => {
    const events: SessionEvent[] = [
      { f: 0, t: "k", c: "KeyD", d: 1 },
      { f: 5, t: "k", c: "KeyD", d: 0 },
    ];
    const periods = computeIdlePeriods(events, 500);
    expect(periods).toEqual([{ from: 5, to: 500 }]);
  });

  it("an empty recording with no events is idle end to end", () => {
    expect(computeIdlePeriods([], 400)).toEqual([{ from: 0, to: 400 }]);
  });
});
