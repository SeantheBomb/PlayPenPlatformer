// The behavior grammar's customization contract: content-authored docs and
// param overrides actually change gameplay — no engine edits. These cover the
// three things the system exists for: composing behaviors onto entities,
// overriding params per attachment, and the global sim tunables (including
// the two knobs Sean asked for: melt chain range and fluid side bias).
import { describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/game/room";
import type {
  BehaviorDef, Content, EnemyDef, RoomDef, RoomEntity, RuleDef, TileDef,
} from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import { setSimTime } from "../src/engine/simclock";
import tilesJson from "../content/tiles.json";
import gameJson from "../content/game.json";
import rulesJson from "../content/rules.json";
import behaviorsJson from "../content/behaviors.json";
import enemiesJson from "../content/enemies.json";

const TILES = tilesJson as TileDef[];
const BEHAVIORS = behaviorsJson as unknown as BehaviorDef[];
const ENEMIES = enemiesJson as EnemyDef[];

function makeContent(opts: {
  behaviors?: BehaviorDef[];
  enemies?: EnemyDef[];
  rules?: RuleDef[];
} = {}): Content {
  return {
    game: gameJson as Content["game"],
    elements: [],
    rules: opts.rules ?? [],
    behaviors: opts.behaviors ?? BEHAVIORS,
    achievements: [],
    tiles: TILES,
    items: [],
    recipes: [],
    enemies: opts.enemies ?? ENEMIES,
    taunts: [],
    campaign: { rooms: [] },
    rooms: {},
  } as unknown as Content;
}

function makeMuts(): RoomMutations {
  return {
    collected: new Set(), tileOverrides: [], openedDoors: new Set(),
    gateTouched: new Set(), helpedNpcs: new Set(), disabledEnemies: new Set(),
    drops: [], placedItems: [], brazierLit: [],
  };
}

function makeRoom(rows: string[], content: Content, entities: RoomEntity[] = []): RoomRuntime {
  const room: RoomDef = {
    id: "test", name: "test", width: rows[0].length, height: rows.length,
    background: "#000", tiles: rows, entities,
  } as RoomDef;
  return new RoomRuntime(room, content, makeMuts());
}

/** Patch one behavior doc's params (deep-copied library). */
function withParams(id: string, params: Record<string, unknown>): BehaviorDef[] {
  const lib = JSON.parse(JSON.stringify(BEHAVIORS)) as BehaviorDef[];
  const doc = lib.find((b) => b.id === id)!;
  doc.params = { ...doc.params, ...params };
  return lib;
}

const crawler = ENEMIES.find((e) => e.id === "crawler")!;
const charAt = (rt: RoomRuntime, x: number, y: number) => rt.map.at(x, y)?.char ?? ".";

const FLOOR_ROOM = [
  "#..........#",
  "#..........#",
  "#..........#",
  "############",
];

describe("custom behavior docs replace engine behavior without engine changes", () => {
  it("a content-authored elementContact doc overrides the reactions table", () => {
    // A crawler variant whose fire response is a 1s stun, NOT the reactions
    // table's kill — purely by swapping one attachment in content.
    const customDoc: BehaviorDef = {
      id: "fire_stuns_instead",
      host: "enemy",
      rules: [
        { on: "elementContact", if: [["elementIs", "fire"]], do: [["stun", { ms: 1000 }]] },
      ],
    };
    const variant: EnemyDef = {
      ...crawler,
      id: "crawler_damp",
      behaviors: [
        "hazard_reactions",
        "fire_stuns_instead", // <- replaces element_reactions
        { id: "stun_cycle", params: { wakeTo: "patrol" } },
        "patrol_route", "grounded_move",
      ],
    };
    const content = makeContent({
      behaviors: [...BEHAVIORS, customDoc],
      enemies: [...ENEMIES, variant],
    });
    const rt = makeRoom(FLOOR_ROOM, content, [
      { type: "enemy", enemy: "crawler_damp", x: 5, y: 2 } as RoomEntity,
    ]);
    setSimTime(10_000);
    const en = rt.enemies[0];
    const events = rt.applyElementToEnemies("fire", { x: en.x - 2, y: en.y - 2, w: 24, h: 24 }, 3000);
    expect(events.some((e) => e.effect === "enemy_stun")).toBe(true);
    expect(rt.enemies.length).toBe(1); // NOT killed, unlike a stock crawler
    expect(en.state).toBe("stunned");
    // The custom stun used its own 1000ms, not the passed stunMs (3000).
    setSimTime(11_100);
    rt.update(1 / 60, null, 3000, () => {});
    expect(en.state).toBe("patrol");
  });

  it("attachment params override behavior defaults ($host refs included)", () => {
    const speedy: EnemyDef = {
      ...crawler,
      id: "crawler_speedy",
      behaviors: [
        { id: "patrol_route", params: { speed: 200 } }, // vs. $host.speed = 55
        "grounded_move",
      ],
    };
    const content = makeContent({ enemies: [...ENEMIES, speedy] });
    const rt = makeRoom(FLOOR_ROOM, content, [
      { type: "enemy", enemy: "crawler_speedy", x: 2, y: 2, patrolMinX: 1, patrolMaxX: 20 } as RoomEntity,
    ]);
    setSimTime(10_000);
    const en = rt.enemies[0];
    const x0 = en.x;
    for (let i = 0; i < 30; i++) rt.update(1 / 60, null, 0, () => {});
    const moved = en.x - x0;
    expect(moved).toBeGreaterThan(200 * 0.5 * 0.8); // ~100px in half a second
  });
});

describe("global sim tunables (behaviors.json global docs)", () => {
  it("heat_spread.chainMeltRange = 0 stops the melt at direct lava contact", () => {
    const content = makeContent({
      rules: rulesJson as RuleDef[],
      behaviors: withParams("heat_spread", { chainMeltRange: 0 }),
    });
    const rt = makeRoom(["LMMMM."], content);
    for (let i = 0; i < 8; i++) rt.update(0.7, null, 0, () => {});
    expect(charAt(rt, 1, 0)).toBe("."); // touching lava: melts
    expect(charAt(rt, 2, 0)).toBe("M"); // chain suppressed
    expect(charAt(rt, 3, 0)).toBe("M");
  });

  it("heat_spread.chainMeltRange = 1 lets the melt travel exactly one tile further", () => {
    const content = makeContent({
      rules: rulesJson as RuleDef[],
      behaviors: withParams("heat_spread", { chainMeltRange: 1 }),
    });
    const rt = makeRoom(["LMMMM."], content);
    for (let i = 0; i < 8; i++) rt.update(0.7, null, 0, () => {});
    expect(charAt(rt, 1, 0)).toBe(".");
    expect(charAt(rt, 2, 0)).toBe("."); // one tile of chain
    expect(charAt(rt, 3, 0)).toBe("M"); // no further
  });

  it("default chainMeltRange (-1) keeps the unlimited chain (the shipped behavior)", () => {
    const content = makeContent({ rules: rulesJson as RuleDef[] });
    const rt = makeRoom(["LMMMM."], content);
    for (let i = 0; i < 8; i++) rt.update(0.7, null, 0, () => {});
    for (let x = 1; x <= 4; x++) expect(charAt(rt, x, 0)).toBe(".");
  });

  it("fluid_flow.sideBias pins which side finite fluid commits to (the slosh knob)", () => {
    // One water tile perched on a one-tile pillar, open holes both sides —
    // exactly the can't-pick-a-direction shape. A pinned bias must commit.
    const rows = [
      "#..........#",
      "#....w.....#", // water at (5,1)
      "#....#.....#", // pillar at (5,2)
      "#..........#",
      "############",
    ];
    const tickOnce = (rt: RoomRuntime) =>
      (rt as never as { tickWaterFlow(ev: unknown[]): void }).tickWaterFlow([]);

    const left = makeRoom(rows, makeContent({ behaviors: withParams("fluid_flow", { sideBias: "left" }) }));
    tickOnce(left);
    expect(charAt(left, 4, 1)).toBe("w"); // moved left
    expect(charAt(left, 6, 1)).toBe(".");

    const right = makeRoom(rows, makeContent({ behaviors: withParams("fluid_flow", { sideBias: "right" }) }));
    tickOnce(right);
    expect(charAt(right, 6, 1)).toBe("w"); // moved right
    expect(charAt(right, 4, 1)).toBe(".");
  });
});
