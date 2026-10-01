// Warden taunt sequencing (Sean, 2026-10-01 feedback):
//   - the welcome must play before the first room's entry line
//   - the Warden never talks over a resident's dialog or a note: his lines
//     wait (and a line already on screen pauses) until the box closes
//   - a taunt deleted from the Writers Studio never fires
import { beforeEach, describe, expect, it } from "vitest";
import type { TauntDef } from "../src/data/types";
import { setSimTime } from "../src/engine/simclock";
import { TauntManager } from "../src/game/taunts";

const taunt = (id: string, trigger: TauntDef["trigger"], line: string, over: Partial<TauntDef> = {}): TauntDef =>
  ({ id, trigger, lines: [line], cooldownMs: 0, chance: 1, ...over });

let now = 0;
const at = (ms: number) => { now = ms; setSimTime(ms); };

describe("TauntManager queueing", () => {
  beforeEach(() => at(0));

  it("plays lines in the order they were fired", () => {
    const m = new TauntManager([taunt("welcome", "game_start", "Welcome."), taunt("room", "room_enter", "This room.")]);
    m.fire("game_start");
    m.fire("room_enter");
    m.update();
    expect(m.active?.line).toBe("Welcome.");
    at(now + m.active!.duration + 1);
    m.update();
    expect(m.active?.line).toBe("This room.");
  });

  it("holds new lines while a dialog is open, then plays them when it closes", () => {
    const m = new TauntManager([taunt("help", "npc_help", "Friendship is a slower escape.")]);
    m.fire("npc_help");
    m.update(true); // dialog open
    expect(m.active).toBeNull();
    expect(m.held).toBe(true);
    at(5000);
    m.update(true);
    expect(m.active).toBeNull();
    m.update(false); // dialog closed
    expect(m.held).toBe(false);
    expect(m.active?.line).toBe("Friendship is a slower escape.");
  });

  it("pauses a line already on screen, keeping its full reading time", () => {
    const m = new TauntManager([taunt("t", "idle", "Still here, #67?")]);
    m.fire("idle");
    m.update();
    const { duration } = m.active!;
    at(500);
    m.update();
    const shownBefore = m.visibleText().length;
    m.update(true); // a note opens at 500ms
    at(500 + 60_000); // she reads it for a minute
    m.update(true);
    m.update(false); // closed: the line resumes where it was
    expect(m.visibleText().length).toBe(shownBefore);
    // ...and still has the rest of its reading time left, not expired.
    at(now + duration - 500 - 1);
    m.update();
    expect(m.active?.line).toBe("Still here, #67?");
  });

  it("a removed taunt never fires", () => {
    const m = new TauntManager([taunt("gone", "death", "Ouch.", { removed: true })]);
    m.fire("death");
    m.update();
    expect(m.active).toBeNull();
  });

  it("reset clears a hold", () => {
    const m = new TauntManager([]);
    m.update(true);
    m.reset();
    expect(m.held).toBe(false);
  });
});
