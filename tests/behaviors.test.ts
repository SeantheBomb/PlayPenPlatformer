// The behavior system's customization contract: content-authored penscript
// and field overrides actually change gameplay — no engine edits. These cover
// the three things the system exists for: composing behaviors onto defs,
// overriding script fields per attachment, and the global sim tunables
// (including the two knobs Sean asked for: melt chain range and fluid side
// bias). Plus the compiler itself.
import { describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/game/room";
import { compileScript, lintScript } from "../src/game/penscript";

const TRIGGERS_FOR_TEST = ["tick", "flowTick", "elementContact", "use", "heldTick", "carriedTick"];
import type {
  BehaviorDef, Content, EnemyDef, RoomDef, RoomEntity, RuleDef, TileDef,
} from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import { setSimTime } from "../src/engine/simclock";
import tilesJson from "../content/tiles.json";
import gameJson from "../content/game.json";
import rulesJson from "../content/rules.json";
import behaviorsJson from "../content/behaviors.json";
import entitiesJson from "../content/entities.json";
import enemiesJson from "../content/enemies.json";

const TILES = tilesJson as TileDef[];
const BEHAVIORS = behaviorsJson as unknown as BehaviorDef[];
const ENEMIES = enemiesJson as unknown as EnemyDef[];

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
    entityTypes: entitiesJson,
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

/** Deep-copy the shipped library and rewrite one doc's `var name = ...;`
 *  line — exactly the edit Sean would make in the script pane. */
function withVar(docId: string, name: string, valueSrc: string): BehaviorDef[] {
  const lib = JSON.parse(JSON.stringify(BEHAVIORS)) as BehaviorDef[];
  const doc = lib.find((b) => b.id === docId)!;
  let hit = false;
  doc.script = doc.script.map((line) => {
    if (new RegExp(`^\\s*var\\s+${name}\\b`).test(line)) {
      hit = true;
      return `var ${name} = ${valueSrc};`;
    }
    return line;
  });
  if (!hit) throw new Error(`no var ${name} in ${docId}`);
  return lib;
}

/** Deep-copy the shipped library and replace one doc's whole script — how
 *  policy-hook tests author their own handlers, same as the script pane. */
function withScript(docId: string, script: string[]): BehaviorDef[] {
  const lib = JSON.parse(JSON.stringify(BEHAVIORS)) as BehaviorDef[];
  const doc = lib.find((b) => b.id === docId)!;
  doc.script = script;
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

describe("penscript compiler", () => {
  it("compiles the whole shipped behavior library clean", () => {
    for (const doc of BEHAVIORS) {
      const { errors } = compileScript(doc.script.join("\n"));
      expect(errors, `${doc.id} should compile`).toEqual([]);
    }
  });

  it("reports syntax errors with line numbers", () => {
    const { errors } = compileScript("on tick {\n  if state == 3 { }\n}");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].line).toBe(2); // missing parens around the condition
  });

  it("anchors errors at a real column/length, not just the line (editor squiggle placement)", () => {
    // "state" is found where "(" was expected — the squiggle belongs on
    // "state" itself (col 5, length 5 in "  if state == 3 { }"), not col 0.
    const src = "on tick {\n  if state == 3 { }\n}";
    const { errors } = compileScript(src);
    const line2 = errors.find((e) => e.line === 2)!;
    expect(line2.col).toBe(5);
    expect(line2.len).toBe(5);
    expect(src.split("\n")[1].slice(line2.col, line2.col + line2.len)).toBe("state");
  });

  it("anchors an EOF error ('before end of script') at the actual end position", () => {
    const src = "on tick {\n  halt;\n"; // missing closing "}"
    const { errors } = compileScript(src);
    expect(errors.length).toBeGreaterThan(0);
    const last = errors[errors.length - 1];
    expect(last.line).toBe(3); // one line past the trailing newline
    expect(last.col).toBe(0);
  });

  it("anchors unknown-function lint errors at the call site", () => {
    const src = "on tick {\n  totallyMadeUp(1, 2);\n}";
    const { script } = compileScript(src);
    const errs = lintScript(script!, TRIGGERS_FOR_TEST, () => false);
    const e = errs.find((x) => x.message.includes("totallyMadeUp"))!;
    expect(e.line).toBe(2);
    expect(src.split("\n")[1].slice(e.col, e.col! + e.len!)).toBe("totallyMadeUp");
  });

  it("always terminates on malformed input (editor live-typing safety)", () => {
    // Regression: a stray statement keyword at the top level used to stall
    // the parser's error recovery in an infinite loop, hanging the editor.
    const nasty = [
      "if seesPlayer(range)) { state = \"chase\"; }",
      "on tick { if (x { } }",
      "var = ;",
      "} } } on { { {",
      "on tick {",
    ];
    for (const src of nasty) {
      const { errors } = compileScript(src);
      expect(errors.length, `should error, not hang: ${src}`).toBeGreaterThan(0);
    }
  });

  it("evaluates expressions with TS-style semantics (??, &&, ternary)", () => {
    // Exercised through a room: a script that computes its field from host.
    const doc: BehaviorDef = {
      id: "exprCheck", host: "enemy",
      script: [
        "var a = host.chaseSpeed ?? host.speed * 2;",
        "var b = host.missing ?? \"fallback\";",
        "var c = host.speed > 50 ? 1 : 0;",
      ],
    };
    const content = makeContent({ behaviors: [...BEHAVIORS, doc] });
    const rt = makeRoom(FLOOR_ROOM, content);
    const fields = rt.bhv.resolvedFields("exprCheck", crawler as unknown as Record<string, unknown>);
    expect(fields.a).toBe(110);         // crawler: no chaseSpeed, speed 55
    expect(fields.b).toBe("fallback");
    expect(fields.c).toBe(1);
  });
});

describe("custom behavior scripts replace engine behavior without engine changes", () => {
  it("a content-authored elementContact script overrides the reactions table", () => {
    // A crawler variant whose fire response is a 1s stun, NOT the reactions
    // table's kill — purely by swapping one attachment in content.
    const customDoc: BehaviorDef = {
      id: "fireStunsInstead",
      host: "enemy",
      script: [
        "on elementContact(element) {",
        "  if (element == \"fire\") { stun(1000); }",
        "}",
      ],
    };
    const variant: EnemyDef = {
      ...crawler,
      id: "crawler_damp",
      behaviors: [
        "hazardReactions",
        "fireStunsInstead", // <- replaces elementReactions
        { id: "stunCycle", params: { wakeTo: "patrol" } },
        "patrolRoute", "groundedMove",
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

  // -------------------------------------------------------------------------
  // REGRESSION (player report, 2026-08-05, mess_hall): the hammer reported
  // itself as "Lit!" when swung near fire even though it has no `igniteTo`
  // field, and the bucket showed the same "Lit!" instead of scooping lava.
  // Root cause: a missing host field reads back as `undefined` (plain object
  // member access), but `!=`/`==` used strict `!==`/`===`, and
  // `undefined !== null` is TRUE — so every "field != null" guard in
  // content (useSwing's igniteTo check, dousedInLiquid's dousesTo check)
  // misfired for any item that simply doesn't define that field. Fixed by
  // treating null and undefined as the same absence in `==`/`!=`, matching
  // `??`'s existing treatment.
  // -------------------------------------------------------------------------
  it("`host.<missingField> != null` reads false — a missing field is not \"set\"", () => {
    const customDoc: BehaviorDef = {
      id: "nullCheckProbe",
      host: "enemy",
      script: [
        "on elementContact(element) {",
        // crawler has no `igniteTo` field — this must NOT fire.
        "  if (host.igniteTo != null) { stun(1000); }",
        "}",
      ],
    };
    const variant: EnemyDef = { ...crawler, id: "crawler_probe", behaviors: ["nullCheckProbe"] };
    const content = makeContent({ behaviors: [...BEHAVIORS, customDoc], enemies: [...ENEMIES, variant] });
    const rt = makeRoom(FLOOR_ROOM, content, [
      { type: "enemy", enemy: "crawler_probe", x: 5, y: 2 } as RoomEntity,
    ]);
    setSimTime(10_000);
    const en = rt.enemies[0];
    const events = rt.applyElementToEnemies("fire", { x: en.x - 2, y: en.y - 2, w: 24, h: 24 }, 3000);
    expect(events.some((e) => e.effect === "enemy_stun")).toBe(false);
  });

  it("`host.<presentField> != null` still reads true — equality isn't broken for real values", () => {
    const customDoc: BehaviorDef = {
      id: "nullCheckProbePositive",
      host: "enemy",
      script: [
        "on elementContact(element) {",
        // crawler DOES define speed — this must still fire.
        "  if (host.speed != null) { stun(1000); }",
        "}",
      ],
    };
    const variant: EnemyDef = { ...crawler, id: "crawler_probe2", behaviors: ["nullCheckProbePositive"] };
    const content = makeContent({ behaviors: [...BEHAVIORS, customDoc], enemies: [...ENEMIES, variant] });
    const rt = makeRoom(FLOOR_ROOM, content, [
      { type: "enemy", enemy: "crawler_probe2", x: 5, y: 2 } as RoomEntity,
    ]);
    setSimTime(10_000);
    const en = rt.enemies[0];
    const events = rt.applyElementToEnemies("fire", { x: en.x - 2, y: en.y - 2, w: 24, h: 24 }, 3000);
    expect(events.some((e) => e.effect === "enemy_stun")).toBe(true);
  });

  it("attachment params override a script's field defaults", () => {
    const speedy: EnemyDef = {
      ...crawler,
      id: "crawler_speedy",
      behaviors: [
        { id: "patrolRoute", params: { speed: 200 } }, // vs. host.speed = 55
        "groundedMove",
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

describe("global policy hooks (behaviors.json global docs)", () => {
  const tickOnce = (rt: RoomRuntime) =>
    (rt as never as { tickWaterFlow(ev: unknown[]): void }).tickWaterFlow([]);

  // The one-tile-pillar slosh room: water must pick a side.
  const PILLAR_ROOM = [
    "#..........#",
    "#....w.....#", // water at (5,1)
    "#....#.....#", // pillar at (5,2)
    "#..........#",
    "############",
  ];

  it("an `on meltChain` handler that never calls keepHot stops the chain at direct contact", () => {
    const content = makeContent({
      rules: rulesJson as RuleDef[],
      behaviors: withScript("heatSpread", [
        "var intervalSec = 0.7;",
        "on meltChain(depth) {",
        "  // never keepHot() — only tiles touching real lava melt",
        "}",
      ]),
    });
    const rt = makeRoom(["LMMMM."], content);
    for (let i = 0; i < 8; i++) rt.update(0.7, null, 0, () => {});
    expect(charAt(rt, 1, 0)).toBe("."); // touching lava: melts
    expect(charAt(rt, 2, 0)).toBe("M"); // chain suppressed
    expect(charAt(rt, 3, 0)).toBe("M");
  });

  it("`if (depth <= 1) keepHot()` lets the melt travel exactly one tile further", () => {
    const content = makeContent({
      rules: rulesJson as RuleDef[],
      behaviors: withScript("heatSpread", [
        "on meltChain(depth) {",
        "  if (depth <= 1) { keepHot(); }",
        "}",
      ]),
    });
    const rt = makeRoom(["LMMMM."], content);
    for (let i = 0; i < 8; i++) rt.update(0.7, null, 0, () => {});
    expect(charAt(rt, 1, 0)).toBe(".");
    expect(charAt(rt, 2, 0)).toBe("."); // one tile of chain
    expect(charAt(rt, 3, 0)).toBe("M"); // no further
  });

  it("the shipped default handler melts direct contact plus one chained tile only", () => {
    // Player report (2026-08-05, mess_hall): unlimited chaining melted every
    // connected metal block in the room, including door frames far from the
    // lava. The shipped heatSpread default is now `if (depth <= 1) keepHot()`.
    const content = makeContent({ rules: rulesJson as RuleDef[] });
    const rt = makeRoom(["LMMMM."], content);
    for (let i = 0; i < 8; i++) rt.update(0.7, null, 0, () => {});
    expect(charAt(rt, 1, 0)).toBe("."); // direct contact melts
    expect(charAt(rt, 2, 0)).toBe("."); // one chained tile melts
    expect(charAt(rt, 3, 0)).toBe("M"); // the rest of the span survives
    expect(charAt(rt, 4, 0)).toBe("M");
  });

  it("a stale heatSpread doc with only the legacy chainMeltRange var still caps the chain", () => {
    const content = makeContent({
      rules: rulesJson as RuleDef[],
      behaviors: withScript("heatSpread", ["var chainMeltRange = 1;"]), // no handler
    });
    const rt = makeRoom(["LMMMM."], content);
    for (let i = 0; i < 8; i++) rt.update(0.7, null, 0, () => {});
    expect(charAt(rt, 2, 0)).toBe(".");
    expect(charAt(rt, 3, 0)).toBe("M");
  });

  it("`on pickSide` prefer() pins which side finite fluid commits to", () => {
    const pickSideScript = (side: string) => withScript("fluidFlow", [
      `on pickSide { prefer("${side}"); }`,
    ]);
    // The move lands IN the hole (one diagonal step down), not beside it.
    const left = makeRoom(PILLAR_ROOM, makeContent({ behaviors: pickSideScript("left") }));
    tickOnce(left);
    expect(charAt(left, 4, 2)).toBe("w"); // moved left, into the hole
    expect(charAt(left, 6, 2)).toBe(".");

    const right = makeRoom(PILLAR_ROOM, makeContent({ behaviors: pickSideScript("right") }));
    tickOnce(right);
    expect(charAt(right, 6, 2)).toBe("w"); // moved right, into the hole
    expect(charAt(right, 4, 2)).toBe(".");
  });

  it("a stale fluidFlow doc with only the legacy sideBias var still pins the side", () => {
    const content = makeContent({
      behaviors: withScript("fluidFlow", ['var sideBias = "left";']), // no handler
    });
    const rt = makeRoom(PILLAR_ROOM, content);
    tickOnce(rt);
    expect(charAt(rt, 4, 2)).toBe("w");
    expect(charAt(rt, 6, 2)).toBe(".");
  });

  describe("script-authored \"lower\" (sideDepth comparison in on pickSide)", () => {
    // The policy Sean asked for, now written IN the script: fall toward
    // whichever side is connected to the lower floor; tie = alternate.
    const lowerContent = () => makeContent({
      behaviors: withScript("fluidFlow", [
        "on pickSide {",
        "  var l = sideDepth(\"left\", 1);",
        "  var r = sideDepth(\"right\", 1);",
        "  if (l > r) { prefer(\"left\"); }",
        "  else if (r > l) { prefer(\"right\"); }",
        "  else { prefer(\"alternate\"); }",
        "}",
      ]),
    });

    it("prefers the side whose floor is further down when the right side is deeper", () => {
      const rows = [
        "#...........#",
        "#....w......#", // water at (5,1)
        "#....#......#", // pillar at (5,2)
        "#...#.......#", // shallow floor at x=4 (left depth = 2)
        "#...........#",
        "#############", // deep floor (right depth = 4)
      ];
      const rt = makeRoom(rows, lowerContent());
      tickOnce(rt);
      expect(charAt(rt, 6, 2)).toBe("w"); // moved to the deeper (right) side
      expect(charAt(rt, 4, 2)).toBe(".");
    });

    it("prefers the side whose floor is further down when the left side is deeper", () => {
      const rows = [
        "#...........#",
        "#....w......#",
        "#....#......#",
        "#.....#.....#", // shallow floor at x=6 (right depth = 2)
        "#...........#",
        "#############", // deep floor (left depth = 4)
      ];
      const rt = makeRoom(rows, lowerContent());
      tickOnce(rt);
      expect(charAt(rt, 4, 2)).toBe("w"); // moved to the deeper (left) side
      expect(charAt(rt, 6, 2)).toBe(".");
    });

    it("falls back to the alternating flip on an equal-depth tie", () => {
      const rt = makeRoom(PILLAR_ROOM, lowerContent());
      tickOnce(rt);
      // flowSideFlip toggles true on a fresh room's first tick -> right.
      expect(charAt(rt, 6, 2)).toBe("w");
      expect(charAt(rt, 4, 2)).toBe(".");
    });
  });

  it("`on sourcedSpread` spreadLeft() makes a fall pool fill one side only", () => {
    // Lavafall at x=6 over a flat floor: with spreadLeft, the pool creeps
    // left tick by tick and the right side stays dry.
    const rows = [
      "#.....J....#",
      "#..........#",
      "############",
    ];
    const content = makeContent({
      behaviors: withScript("fluidFlow", [
        "on sourcedSpread { spreadLeft(); }",
      ]),
    });
    const rt = makeRoom(rows, content);
    for (let i = 0; i < 10; i++) tickOnce(rt);
    expect(charAt(rt, 5, 1)).toBe("L"); // spread left of the fall column
    expect(charAt(rt, 4, 1)).toBe("L");
    expect(charAt(rt, 7, 1)).toBe("."); // right side untouched
    expect(charAt(rt, 8, 1)).toBe(".");
  });

  it("`on fluidContact` can invert the classic outcome (destroy the stationary side, keep the mover)", () => {
    // Water on a pillar moves right into (5,1), then falls into (5,2) —
    // whose neighbor (6,2) is stationary lava. Classic: the moving water
    // is destroyed and the lava hardens to cracked. Custom policy: the
    // lava is removed outright and the water completes its move.
    const rows = [
      "#.........#",
      "#...w.....#", // water at (4,1)
      "#...#.L...#", // pillar at (4,2), lava at (6,2)
      "###########",
    ];
    const content = makeContent({
      behaviors: withScript("fluidFlow", [
        "on pickSide { prefer(\"right\"); }",
        "on fluidContact(mover, other) {",
        "  keepMover();",
        "  destroyOther();",
        "}",
      ]),
    });
    const rt = makeRoom(rows, content);
    tickOnce(rt); // water steps right to (5,1)
    tickOnce(rt); // falls into (5,2); contact with the lava at (6,2) resolves
    tickOnce(rt);
    expect(charAt(rt, 6, 2)).toBe("."); // lava destroyed outright, no cracked
    expect(charAt(rt, 5, 2)).toBe("w"); // the mover completed its move
  });

  it("rules.json pattern lines drive the element table (lava + metal -> melt)", () => {
    const content = makeContent({ rules: rulesJson as RuleDef[] });
    const rt = makeRoom(["LM."], content);
    rt.update(0.7, null, 0, () => {});
    expect(charAt(rt, 1, 0)).toBe("."); // melted via the pattern line
  });

  it("legacy split-field rules (stale saves) still work", () => {
    const legacy: RuleDef[] = [
      { id: "old_style", actor: "lava", target: "metal", effect: "melt" },
    ];
    const content = makeContent({ rules: legacy });
    const rt = makeRoom(["LM."], content);
    rt.update(0.7, null, 0, () => {});
    expect(charAt(rt, 1, 0)).toBe(".");
  });
});
