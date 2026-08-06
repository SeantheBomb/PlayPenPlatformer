// Enemy-behavior characterization tests — pin the CURRENT patrol/chase/stun/
// trap/reaction behavior headlessly before (and after) the behavior-grammar
// port. These must pass unchanged against both the legacy engine code and the
// behaviors.json port: they are the "nothing functionally changes" net.
// (tests/enemies.test.ts holds the older locked patrol-freeze requirements —
// this file is the broad sweep added for the port.)
import { beforeEach, describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/game/room";
import type { Content, EnemyDef, RoomDef, RoomEntity, TileDef } from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import { setSimTime } from "../src/engine/simclock";
import tilesJson from "../content/tiles.json";
import gameJson from "../content/game.json";
import behaviorsJson from "../content/behaviors.json";
import enemiesJson from "../content/enemies.json";

const TILES = tilesJson as TileDef[];
const ENEMIES = enemiesJson as EnemyDef[];
const STUN_MS = 3000;
const STEP = 1 / 60;

function makeContent(): Content {
  return {
    game: gameJson as Content["game"],
    elements: [], behaviors: behaviorsJson as never,
    rules: [],
    achievements: [],
    tiles: TILES,
    items: [],
    recipes: [],
    enemies: ENEMIES,
    taunts: [],
    campaign: { rooms: [] },
    rooms: {},
  } as unknown as Content;
}

function makeMuts(): RoomMutations {
  return {
    collected: new Set(),
    tileOverrides: [],
    openedDoors: new Set(),
    gateTouched: new Set(),
    helpedNpcs: new Set(),
    disabledEnemies: new Set(),
    drops: [],
    placedItems: [],
    brazierLit: [],
    sourceAmounts: [],
  };
}

function makeRoom(rows: string[], entities: RoomEntity[] = []): { rt: RoomRuntime; muts: RoomMutations } {
  const room: RoomDef = {
    id: "test",
    name: "test",
    width: rows[0].length,
    height: rows.length,
    background: "#000",
    tiles: rows,
    entities,
  } as RoomDef;
  const muts = makeMuts();
  return { rt: new RoomRuntime(room, makeContent(), muts), muts };
}

type PlayerStub = { centerX: number; centerY: number; hidden: boolean } | null;

/** Fixed-step driver mirroring Game's update loop: advances simNow one step
 *  per update, exactly like the real fixed-timestep loop does. */
class Sim {
  t = 10_000; // start well past 0 so cooldowns keyed to `now - 0` are live
  constructor(private rt: RoomRuntime) {
    setSimTime(this.t);
  }
  step(player: PlayerStub = null, n = 1): void {
    for (let i = 0; i < n; i++) {
      this.t += STEP * 1000;
      setSimTime(this.t);
      this.rt.update(STEP, player, STUN_MS, () => {});
    }
  }
  /** Step for approximately `seconds` of sim time. */
  run(seconds: number, player: PlayerStub = null): void {
    this.step(player, Math.round(seconds / STEP));
  }
}

const enemyEntity = (x: number, y: number, id: string, extra: Partial<RoomEntity> = {}): RoomEntity =>
  ({ type: "enemy", x, y, enemy: id, ...extra }) as RoomEntity;

beforeEach(() => setSimTime(0));

// ---------------------------------------------------------------------------
// Patrol
// ---------------------------------------------------------------------------
describe("patrol behavior", () => {
  // 30-wide flat floor room, walls at both ends.
  const rows = [
    "#............................#",
    "#............................#",
    "#............................#",
    "##############################",
  ];

  it("drifts back and forth inside its patrol range, flipping at each end", () => {
    const { rt } = makeRoom(rows, [enemyEntity(14, 2, "crawler", { patrolMinX: 10, patrolMaxX: 18 })]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    expect(en.state).toBe("patrol");
    expect(en.facing).toBe(1);
    const turnsAt: number[] = [];
    let prevFacing = en.facing;
    for (let i = 0; i < 60 * 12; i++) {
      sim.step();
      if (en.facing !== prevFacing) {
        turnsAt.push(en.x + en.def.width / 2);
        prevFacing = en.facing;
      }
    }
    // It turned around repeatedly...
    expect(turnsAt.length).toBeGreaterThanOrEqual(3);
    // ...and every turn happened at (or just past) a patrol boundary.
    for (const cx of turnsAt) {
      const atMin = Math.abs(cx - 10 * 16) < 20;
      const atMax = Math.abs(cx - 18 * 16) < 20;
      expect(atMin || atMax, `turned at cx=${cx}, expected near a patrol end`).toBe(true);
    }
  });

  it("flips its facing when it walks into a wall", () => {
    const { rt } = makeRoom(rows, [enemyEntity(27, 2, "crawler", { patrolMinX: 2, patrolMaxX: 40 })]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    en.facing = 1;
    sim.run(2);
    expect(en.facing).toBe(-1); // bounced off the right wall
  });

  it("refuses drops deeper than one tile (won't strand itself)", () => {
    const rows2 = [
      "#............#",
      "#............#",
      "#....####....#", // ledge x5..x8 at y2
      "#............#",
      "#............#",
      "##############",
    ];
    const { rt } = makeRoom(rows2, [enemyEntity(6, 1, "crawler", { patrolMinX: 1, patrolMaxX: 12 })]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    sim.run(6);
    // Still on the ledge: never walked off the 3-tile drop on either side.
    expect(en.y + en.def.height).toBeLessThanOrEqual(2 * 16 + 1);
    expect(en.x).toBeGreaterThan(4 * 16);
    expect(en.x + en.def.width).toBeLessThan(9 * 16 + 8);
  });

  it("a patrol-only enemy never escalates to chase, even staring at the player", () => {
    const { rt } = makeRoom(rows, [enemyEntity(10, 2, "crawler", { patrolMinX: 8, patrolMaxX: 12 })]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    sim.step({ centerX: 13 * 16 + 8, centerY: 2 * 16 + 8, hidden: false }, 20);
    expect(en.state).toBe("patrol");
  });
});

// ---------------------------------------------------------------------------
// Chase (spotter)
// ---------------------------------------------------------------------------
describe("chase behavior", () => {
  const rows = [
    "#............................#",
    "#............................#",
    "#............................#",
    "##############################",
  ];
  const spotterAt = (x: number) => enemyEntity(x, 2, "spotter", { patrolMinX: x - 2, patrolMaxX: x + 2 });
  const playerAt = (tx: number): PlayerStub => ({ centerX: tx * 16 + 8, centerY: 2 * 16 + 8, hidden: false });

  it("escalates to chase when the player is ahead, in range, with line of sight", () => {
    const { rt } = makeRoom(rows, [spotterAt(10)]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    en.facing = 1;
    sim.step(playerAt(15)); // ~80px ahead, facing it
    expect(en.state).toBe("chase");
  });

  it("does not see the player behind its back", () => {
    const { rt } = makeRoom(rows, [spotterAt(10)]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    en.facing = 1;
    sim.step(playerAt(6), 5); // behind it; patrol keeps facing 1 these frames
    expect(en.state).toBe("patrol");
  });

  it("does not see the player beyond sightRange", () => {
    const { rt } = makeRoom(rows, [spotterAt(4)]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    en.facing = 1;
    sim.step(playerAt(24), 5); // ~320px away, range is 130
    expect(en.state).toBe("patrol");
  });

  it("cannot see through solid walls", () => {
    const rows2 = [
      "#............................#",
      "#............................#",
      "#.........#..................#",
      "#.........#..................#", // wall column at x10
      "##############################",
    ];
    const { rt } = makeRoom(rows2, [enemyEntity(7, 3, "spotter", { patrolMinX: 5, patrolMaxX: 9 })]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    en.facing = 1;
    sim.step({ centerX: 13 * 16 + 8, centerY: 3 * 16 + 8, hidden: false }, 5);
    expect(en.state).toBe("patrol");
  });

  // -------------------------------------------------------------------------
  // REGRESSION (player report, 2026-08-06, the_yard): "Spotters shouldn't be
  // able to see or walk through doors". A closed door/trapdoor is an entity
  // overlay, not a solid tile — room construction deliberately never carves
  // a solid tile under a gate's own footprint (so it isn't structurally
  // impassable once opened). Tilemap.lineOfSight and canStepAhead only ever
  // checked the tile grid, so they had zero door awareness: a spotter could
  // see and walk straight through a shut door, unlike the player (game.ts's
  // explicit closed-gate collision pass) and fluid (doorBlocksFluid).
  // -------------------------------------------------------------------------
  it("cannot see through a closed door (but can once it's open)", () => {
    const door: RoomEntity = { type: "door", x: 10, y: 2, gate: true } as RoomEntity;
    const { rt } = makeRoom(rows, [spotterAt(7), door]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    en.facing = 1;
    sim.step(playerAt(13), 5);
    expect(en.state).toBe("patrol");
    const inst = rt.entities.find((e) => e.kind === "door")!;
    inst.open = true;
    sim.step(playerAt(13));
    expect(en.state).toBe("chase");
  });

  it("cannot walk through a closed door while patrolling", () => {
    const door: RoomEntity = { type: "door", x: 12, y: 2, gate: true } as RoomEntity;
    const { rt } = makeRoom(rows, [enemyEntity(9, 2, "spotter", { patrolMinX: 5, patrolMaxX: 20 }), door]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    en.facing = 1;
    sim.run(3); // plenty of time to reach the door if nothing stopped it
    expect(en.x + en.def.width).toBeLessThanOrEqual(12 * 16);
  });

  it("ignores a hidden player entirely", () => {
    const { rt } = makeRoom(rows, [spotterAt(10)]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    en.facing = 1;
    sim.step({ centerX: 15 * 16 + 8, centerY: 2 * 16 + 8, hidden: true }, 5);
    expect(en.state).toBe("patrol");
  });

  it("moves toward the player at chaseSpeed while chasing", () => {
    const { rt } = makeRoom(rows, [spotterAt(8)]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    en.facing = 1;
    const player = playerAt(15);
    sim.step(player);
    expect(en.state).toBe("chase");
    const x0 = en.x;
    sim.step(player, 30); // half a second
    const moved = en.x - x0;
    // chaseSpeed lives in content/enemies.json's spotter.chaseOnSight params
    // now (not a flat EnemyDef field) — 128, matching that content value.
    const expected = 128 * 0.5;
    expect(moved).toBeGreaterThan(expected * 0.8);
    expect(moved).toBeLessThan(expected * 1.2);
  });

  it("smoke breaks sight (a smoked player is invisible)", () => {
    const { rt } = makeRoom(rows, [spotterAt(10)]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    en.facing = 1;
    const player = playerAt(15);
    rt.addSmokeCloud(player!.centerX, player!.centerY, 24, 60_000);
    sim.step(player, 5);
    expect(en.state).toBe("patrol");
  });

  it("loses a vanished player and returns home", () => {
    const { rt } = makeRoom(rows, [spotterAt(10)]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    en.facing = 1;
    const player = playerAt(15);
    sim.step(player);
    expect(en.state).toBe("chase");
    // Chase long enough to actually clear home by more than returnHome's
    // arrival threshold, or losing sight immediately would already count as
    // "arrived" and skip straight past "return" into "patrol" this same tick.
    sim.step(player, 15);
    const gone: PlayerStub = { ...player!, hidden: true };
    sim.step(gone);
    expect(en.state).toBe("return"); // hidden = instantly lost; returnsHome -> return
    sim.run(6, gone);
    // Back at its post, and resumed patrolling from there instead of
    // standing frozen in "return" forever (the reported bug this fixed:
    // returnHome had no arrival check to hand control back to patrolRoute).
    expect(en.state).toBe("patrol");
    const cx = en.x + en.def.width / 2;
    expect(cx).toBeGreaterThanOrEqual(en.patrolMin);
    expect(cx).toBeLessThanOrEqual(en.patrolMax);
  });
});

// ---------------------------------------------------------------------------
// Element reactions (reactions map)
// ---------------------------------------------------------------------------
describe("element reactions", () => {
  const rows = [
    "#..........#",
    "#..........#",
    "#..........#",
    "############",
  ];

  const hit = (rt: RoomRuntime, en: { x: number; y: number }, element: string) =>
    rt.applyElementToEnemies(element, { x: en.x - 2, y: en.y - 2, w: 24, h: 24 }, STUN_MS);

  it("crawler: fire kills (removed from play, persisted)", () => {
    const { rt, muts } = makeRoom(rows, [enemyEntity(5, 2, "crawler")]);
    new Sim(rt);
    const en = rt.enemies[0];
    const events = hit(rt, en, "fire");
    expect(events.some((e) => e.effect === "enemy_kill")).toBe(true);
    expect(rt.enemies.length).toBe(0);
    expect(muts.disabledEnemies.has(en.index)).toBe(true);
  });

  it("crawler: water does nothing", () => {
    const { rt } = makeRoom(rows, [enemyEntity(5, 2, "crawler")]);
    new Sim(rt);
    const events = hit(rt, rt.enemies[0], "water");
    expect(events.length).toBe(0);
    expect(rt.enemies[0].state).toBe("patrol");
  });

  it("crawler: ice stuns for stunMs, then wakes back to patrol", () => {
    const { rt } = makeRoom(rows, [enemyEntity(5, 2, "crawler")]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    const events = hit(rt, en, "ice");
    expect(events.some((e) => e.effect === "enemy_stun")).toBe(true);
    expect(en.state).toBe("stunned");
    const xStunned = en.x;
    sim.run(1);
    expect(en.state).toBe("stunned"); // still under
    expect(en.x).toBeCloseTo(xStunned, 3); // stunned enemies don't move
    sim.run(2.2);
    expect(en.state).toBe("patrol"); // crawler wakes to patrol
  });

  it("spotter: water stuns, then wakes homeward and straight back to patrol (never having left home)", () => {
    const { rt } = makeRoom(rows, [enemyEntity(5, 2, "spotter")]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    hit(rt, en, "water");
    expect(en.state).toBe("stunned");
    sim.run(3.2);
    // Wakes to "return" (stunCycle), but returnHome sees it's already at its
    // post and hands off to patrol the same tick — never visibly stuck.
    expect(en.state).toBe("patrol");
  });

  it("spotter: fire does nothing (fireproof)", () => {
    const { rt } = makeRoom(rows, [enemyEntity(5, 2, "spotter")]);
    new Sim(rt);
    const events = hit(rt, rt.enemies[0], "fire");
    expect(events.length).toBe(0);
  });

  it("metal knocks back against facing", () => {
    const { rt } = makeRoom(rows, [enemyEntity(5, 2, "crawler")]);
    new Sim(rt);
    const en = rt.enemies[0];
    en.facing = 1;
    const events = hit(rt, en, "metal");
    expect(events.some((e) => e.effect === "enemy_knockback")).toBe(true);
    expect(en.vx).toBe(-120);
  });

  it("trapped enemies are immune to element application", () => {
    const { rt } = makeRoom(rows, [enemyEntity(5, 2, "crawler")]);
    new Sim(rt);
    const en = rt.enemies[0];
    en.state = "trapped";
    const events = hit(rt, en, "fire");
    expect(events.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Environmental hazards (tiles acting on enemies)
// ---------------------------------------------------------------------------
describe("environmental hazards", () => {
  it("a crawler overlapping a fire tile dies to it", () => {
    const rows = [
      "#..........#",
      "#..........#",
      "#....f.....#", // fire tile at x5, y2
      "############",
    ];
    const { rt } = makeRoom(rows, [enemyEntity(5, 2, "crawler", { patrolMinX: 4, patrolMaxX: 6 })]);
    const sim = new Sim(rt);
    sim.run(1);
    expect(rt.enemies.length).toBe(0); // reaction "kill"
  });

  it("a spotter shrugs fire off (reaction none)", () => {
    const rows = [
      "#..........#",
      "#..........#",
      "#....f.....#",
      "############",
    ];
    const { rt } = makeRoom(rows, [enemyEntity(5, 2, "spotter", { patrolMinX: 4, patrolMaxX: 6 })]);
    const sim = new Sim(rt);
    sim.run(1);
    expect(rt.enemies.length).toBe(1); // fireproof
  });

  it("hazard application respects the re-application cooldown", () => {
    const rows = [
      "#..........#",
      "#....f.....#",
      "############",
    ];
    const { rt } = makeRoom(rows, [enemyEntity(5, 1, "spotter", { patrolMinX: 5, patrolMaxX: 5 })]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    sim.step();
    const first = en.lastHazardAt;
    expect(first).toBeGreaterThan(0); // fire applied (reaction "none", still counts as applied)
    sim.step(null, 10); // ~166ms later — inside the 500ms cooldown
    expect(en.lastHazardAt).toBe(first);
    sim.run(0.6);
    expect(en.lastHazardAt).toBeGreaterThan(first); // re-applied after cooldown
  });
});

// ---------------------------------------------------------------------------
// Traps, stun radius, reset
// ---------------------------------------------------------------------------
describe("traps and resets", () => {
  const rows = [
    "#..........#",
    "#..........#",
    "#..........#",
    "############",
  ];

  it("a trappable enemy walking onto a placed trap is trapped (trap consumed)", () => {
    const { rt, muts } = makeRoom(rows, [enemyEntity(5, 2, "crawler", { patrolMinX: 3, patrolMaxX: 8 })]);
    const sim = new Sim(rt);
    const en = rt.enemies[0];
    rt.placeItem("trap", en.x + 20, 2 * 16 + 8); // in its path
    sim.run(2);
    expect(en.state).toBe("trapped");
    expect(rt.placed[0].data.used).toBe(true);
    expect(muts.disabledEnemies.has(en.index)).toBe(true);
  });

  it("stunEnemiesNear stuns stunnable enemies in radius only", () => {
    const { rt } = makeRoom(rows, [
      enemyEntity(2, 2, "crawler", { patrolMinX: 2, patrolMaxX: 2 }),
      enemyEntity(9, 2, "crawler", { patrolMinX: 9, patrolMaxX: 9 }),
    ]);
    new Sim(rt);
    const near = rt.enemies[0];
    const hitCount = rt.stunEnemiesNear(near.x + 8, near.y + 8, 40, STUN_MS);
    expect(hitCount).toBe(1);
    expect(rt.enemies[0].state).toBe("stunned");
    expect(rt.enemies[1].state).toBe("patrol");
  });

  it("resetEnemies sends everyone home; patrollers resume patrol, chasers return", () => {
    const { rt } = makeRoom(rows, [
      enemyEntity(3, 2, "crawler"),
      enemyEntity(8, 2, "spotter"),
    ]);
    const sim = new Sim(rt);
    const [crawler, spotter] = rt.enemies;
    sim.run(1.5, { centerX: 9 * 16, centerY: 2 * 16 + 8, hidden: false });
    crawler.state = "chase"; // force weird states before reset
    spotter.state = "chase";
    rt.resetEnemies();
    expect(crawler.state).toBe("patrol");
    expect(spotter.state).toBe("return");
    expect(crawler.x + crawler.def.width / 2).toBeCloseTo(crawler.homeX, 3);
    expect(spotter.x + spotter.def.width / 2).toBeCloseTo(spotter.homeX, 3);
    expect(crawler.vx).toBe(0);
    expect(spotter.vy).toBe(0);
  });

  it("trapped enemies stay trapped through resetEnemies", () => {
    const { rt } = makeRoom(rows, [enemyEntity(5, 2, "crawler")]);
    new Sim(rt);
    const en = rt.enemies[0];
    en.state = "trapped";
    en.x = 999;
    rt.resetEnemies();
    expect(en.state).toBe("trapped");
    expect(en.x).toBe(999); // untouched
  });
});
